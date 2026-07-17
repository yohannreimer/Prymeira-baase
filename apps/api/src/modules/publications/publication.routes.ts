import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { canAccessOwnerStudio, canManageKnowledge } from "@prymeira/baase-shared";
import { z } from "zod";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext, requireOperationalMembership } from "../../http/auth-context";
import { attachmentContentDisposition } from "../../storage/object-storage";
import { canReadAreaResource } from "../company/access-policy";
import type { ProcessRepository } from "../processes/process.types";
import type { Publication } from "./publication.types";
import type { PublicationService } from "./publication.service";

const createBody = z.object({
  resource_type: z.enum(["studio_document", "process"]), resource_id: z.string().trim().min(1).max(200),
  format: z.enum(["pdf", "zip"]).default("pdf")
}).strict();
const idParams = z.object({ id: z.string().trim().min(1).max(200) }).strict();
const grantParams = idParams.extend({ grantId: z.string().trim().min(1).max(200) });
const tokenParams = z.object({ token: z.string().trim().min(20).max(200) }).strict();
const grantBody = z.object({ expires_at: z.string().datetime() }).strict();

export async function registerPublicationRoutes(app: FastifyInstance, service: PublicationService, processRepository: ProcessRepository) {
  app.get("/publications/public/:token", async (request, reply) => {
    const { token } = tokenParams.parse(request.params);
    const resolved = await safe(() => service.resolveExternal(token));
    return sendPublication(reply, resolved.publication, resolved.object);
  });
  app.post("/studio/publications", async (request, reply) => {
    const context = readRequestContext(request);
    const body = createBody.parse(request.body);
    await assertCanPublish(request, body.resource_type, body.resource_id, processRepository);
    const publication = await safe(() => service.create({
      workspaceId: context.workspaceId, ownerProfileId: context.profileId,
      resourceType: body.resource_type, resourceId: body.resource_id, format: body.format,
      workspaceName: context.workspaceName ?? "Prymeira Baase", profileName: context.profileName ?? "Dono"
    }));
    return reply.code(201).send({ publication });
  });
  app.get("/studio/publications/:id", async (request) => {
    const context = readRequestContext(request); const { id } = idParams.parse(request.params);
    return { publication: await safe(() => service.find({ workspaceId: context.workspaceId, ownerProfileId: context.profileId }, id)) };
  });
  app.get("/studio/publications/:id/download", async (request) => {
    const context = readRequestContext(request); const { id } = idParams.parse(request.params);
    return { url: await safe(() => service.createDownloadUrl({ workspaceId: context.workspaceId, ownerProfileId: context.profileId }, id)) };
  });
  app.post("/studio/publications/:id/external-links", async (request, reply) => {
    const context = readRequestContext(request); if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
    const { id } = idParams.parse(request.params); const { expires_at } = grantBody.parse(request.body);
    const result = await safe(() => service.createExternalGrant({ workspaceId: context.workspaceId, ownerProfileId: context.profileId }, id, expires_at));
    return reply.code(201).send({ grant: result.grant, token: result.token });
  });
  app.delete("/studio/publications/:id/external-links/:grantId", async (request, reply) => {
    const context = readRequestContext(request); if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
    const { id, grantId } = grantParams.parse(request.params);
    await safe(() => service.revokeExternalGrant({ workspaceId: context.workspaceId, ownerProfileId: context.profileId }, id, grantId));
    return reply.code(204).send();
  });
}

function sendPublication(
  reply: FastifyReply,
  publication: Publication,
  object: Awaited<ReturnType<PublicationService["resolveExternal"]>>["object"]
) {
  reply.header("Content-Type", object.contentType ?? publication.contentType ?? "application/octet-stream");
  reply.header("Content-Disposition", attachmentContentDisposition(`${publication.title}.${publication.format}`));
  reply.header("Cache-Control", "private, no-store");
  if (object.sizeBytes !== null) reply.header("Content-Length", String(object.sizeBytes));
  return reply.send(object.body);
}

async function assertCanPublish(
  request: FastifyRequest,
  resourceType: "studio_document" | "process",
  resourceId: string,
  processRepository: ProcessRepository
) {
  const { role } = readRequestContext(request);
  if (resourceType === "studio_document") {
    if (!canAccessOwnerStudio(role)) throw forbiddenError();
    return;
  }
  if (canManageKnowledge(role)) return;

  const process = await processRepository.findProcess(readRequestContext(request).workspaceId, resourceId);
  if (!process) throw new ApiError(404, "PROCESS_NOT_FOUND", "Processo não encontrado.");
  if (process.status !== "published" || !canReadAreaResource(requireOperationalMembership(request), process.areaId)) throw forbiddenError();
}
async function safe<T>(operation: () => Promise<T>) { try { return await operation(); } catch (error) { throw routeError(error); } }
function routeError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
  if (["PUBLICATION_NOT_FOUND", "PUBLICATION_SOURCE_NOT_FOUND", "PUBLICATION_GRANT_NOT_FOUND"].includes(code)) return new ApiError(404, code, "Publicação não encontrada.");
  if (code === "PUBLICATION_LINK_UNAVAILABLE") return new ApiError(410, code, "Este link expirou ou foi desativado.");
  if (["PUBLICATION_FORMAT_UNSUPPORTED", "PUBLICATION_EXPIRY_INVALID"].includes(code)) return new ApiError(422, code, "Não foi possível criar esta publicação.");
  if (code === "PUBLICATION_RENDER_FAILED") return new ApiError(503, code, "Não foi possível gerar o arquivo agora.");
  return error;
}
