import type { FastifyInstance, FastifyRequest } from "fastify";
import { canAccessOwnerStudio } from "@prymeira/baase-shared";
import { z } from "zod";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import {
  STUDIO_DELETE_CONFIRMATION,
  type StudioPortabilityActor,
  type StudioPortabilityService
} from "./studio-portability.service";

const deleteSchema = z.object({
  confirmation: z.literal(STUDIO_DELETE_CONFIRMATION)
}).strict();

function requireOwnerActor(request: FastifyRequest): StudioPortabilityActor {
  const context = readRequestContext(request);
  if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
  return { workspaceId: context.workspaceId, profileId: context.profileId, role: context.role };
}

export async function registerStudioPortabilityRoutes(app: FastifyInstance, service: StudioPortabilityService) {
  app.post("/studio/export", async (request, reply) => {
    const actor = requireOwnerActor(request);
    try {
      const exported = await service.exportData(actor);
      return reply.code(202).send({ export: exported });
    } catch (error) {
      throw portabilityRouteError(error);
    }
  });

  app.get<{ Params: { exportId: string } }>("/studio/export/:exportId", async (request, reply) => {
    const actor = requireOwnerActor(request);
    try {
      const exported = await service.getExport(actor, request.params.exportId);
      return reply.send({ export: exported });
    } catch (error) {
      throw portabilityRouteError(error);
    }
  });

  app.delete("/studio/data", async (request, reply) => {
    const actor = requireOwnerActor(request);
    const parsed = deleteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, "STUDIO_DELETE_CONFIRMATION_INVALID", "Digite a confirmação exata para excluir o Estúdio.");
    }
    try {
      const deletion = await service.deleteData(actor, parsed.data.confirmation);
      return reply.code(202).send({ deletion });
    } catch (error) {
      throw portabilityRouteError(error);
    }
  });
}

function portabilityRouteError(error: unknown): unknown {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "STUDIO_PORTABILITY_FORBIDDEN") return forbiddenError();
  if (code === "STUDIO_DELETE_CONFIRMATION_INVALID") {
    return new ApiError(400, code, "Digite a confirmação exata para excluir o Estúdio.");
  }
  if (code === "STUDIO_PORTABILITY_DELETION_ACTIVE") {
    return new ApiError(409, code, "A exclusão privada ainda está sendo reconciliada.");
  }
  if (code === "STUDIO_EXPORT_TOO_LARGE") {
    return new ApiError(413, code, "A exportação excede o limite seguro.");
  }
  if (code === "STUDIO_EXPORT_NOT_FOUND") {
    return new ApiError(404, code, "Exportação não encontrada.");
  }
  if (code === "STUDIO_EXPORT_NOT_READY") {
    return new ApiError(409, code, "A exportação ainda está sendo preparada.");
  }
  if (code === "STUDIO_EXPORT_EXPIRED") {
    return new ApiError(410, code, "Esta exportação expirou.");
  }
  return error;
}
