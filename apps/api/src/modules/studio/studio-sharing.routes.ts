import type { FastifyInstance, FastifyRequest } from "fastify";
import { canAccessOwnerStudio } from "@prymeira/baase-shared";
import { z } from "zod";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import type { StudioOwnerScope } from "./studio.types";
import type { StudioSharingService } from "./studio-sharing.service";

const documentParams = z.object({ documentId: z.string().trim().min(1).max(200) }).strict();
const commentParams = z.object({ commentId: z.string().trim().min(1).max(200) }).strict();
const moderateParams = documentParams.extend({ commentId: z.string().trim().min(1).max(200) });
const shareBody = z.object({ audiences: z.array(z.discriminatedUnion("type", [
  z.object({ type: z.literal("owner"), profileId: z.string().trim().min(1).max(200) }).strict(),
  z.object({ type: z.literal("all_owners") }).strict()
])).max(100) }).strict();
const commentBody = z.object({ body: z.string().min(1).max(4000) }).strict();

function requireScope(request: FastifyRequest): StudioOwnerScope {
  const context = readRequestContext(request);
  if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
  return { workspaceId: context.workspaceId, ownerProfileId: context.profileId };
}

export async function registerStudioSharingRoutes(app: FastifyInstance, service: StudioSharingService) {
  app.put("/studio/documents/:documentId/shares", async (request) => {
    const scope = requireScope(request);
    const { documentId } = documentParams.parse(request.params);
    const { audiences } = shareBody.parse(request.body);
    return { shares: await safe(() => service.replaceShares(scope, documentId, audiences)) };
  });
  app.get("/studio/documents/:documentId/shares", async (request) => {
    const scope = requireScope(request);
    const { documentId } = documentParams.parse(request.params);
    return { shares: await safe(() => service.listSourceShares(scope, documentId)) };
  });
  app.get("/studio/documents/shared", async (request) => ({ documents: await safe(() => service.listSharedWithMe(requireScope(request))) }));
  app.get("/studio/shared-documents/:documentId", async (request) => {
    const { documentId } = documentParams.parse(request.params);
    return safe(() => service.getSharedDocument(requireScope(request), documentId));
  });
  app.get("/studio/documents/:documentId/comments", async (request) => {
    const { documentId } = documentParams.parse(request.params);
    return { comments: await safe(() => service.listComments(requireScope(request), documentId)) };
  });
  app.post("/studio/documents/:documentId/comments", async (request, reply) => {
    const { documentId } = documentParams.parse(request.params);
    const { body } = commentBody.parse(request.body);
    return reply.code(201).send({ comment: await safe(() => service.addComment(requireScope(request), documentId, body)) });
  });
  app.patch("/studio/comments/:commentId", async (request) => {
    const { commentId } = commentParams.parse(request.params);
    const { body } = commentBody.parse(request.body);
    return { comment: await safe(() => service.editOwnComment(requireScope(request), commentId, body)) };
  });
  app.delete("/studio/comments/:commentId", async (request, reply) => {
    const { commentId } = commentParams.parse(request.params);
    await safe(() => service.deleteOwnComment(requireScope(request), commentId));
    return reply.code(204).send();
  });
  app.delete("/studio/documents/:documentId/comments/:commentId/moderate", async (request, reply) => {
    const { documentId, commentId } = moderateParams.parse(request.params);
    await safe(() => service.moderateComment(requireScope(request), documentId, commentId));
    return reply.code(204).send();
  });
  app.post("/studio/documents/:documentId/import", async (request, reply) => {
    const { documentId } = documentParams.parse(request.params);
    const key = request.headers["idempotency-key"];
    const document = await safe(() => service.importSheet(requireScope(request), documentId, typeof key === "string" ? key : ""));
    return reply.code(201).send({ document });
  });
  app.get("/studio/documents/:documentId/import-update", async (request) => {
    const { documentId } = documentParams.parse(request.params);
    return { update: await safe(() => service.readImportUpdate(requireScope(request), documentId)) };
  });
  app.post("/studio/documents/:documentId/import-update/dismiss", async (request) => {
    const { documentId } = documentParams.parse(request.params);
    return { update: await safe(() => service.dismissImportUpdate(requireScope(request), documentId)) };
  });
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { throw routeError(error); }
}

function routeError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
  if (["STUDIO_COMMENT_FORBIDDEN", "STUDIO_SHARE_RECIPIENT_INVALID", "STUDIO_IMPORT_OWN_DOCUMENT"].includes(code)) return forbiddenError();
  if (["STUDIO_SHARED_DOCUMENT_NOT_FOUND", "STUDIO_COMMENT_NOT_FOUND", "STUDIO_IMPORT_NOT_FOUND"].includes(code)) {
    return new ApiError(404, code, "Folha compartilhada não encontrada.");
  }
  if (["STUDIO_COMMENT_INVALID", "STUDIO_IMPORT_KEY_REQUIRED"].includes(code)) {
    return new ApiError(400, code, "Dados inválidos para esta operação.");
  }
  return error;
}

