import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canManageKnowledge } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import { createProcessService } from "./process.service";
import type { ProcessRepository } from "./process.types";

const createProcessSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1),
  area_id: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  owner_profile_id: z.string().optional().nullable()
});

const createProcessVersionSchema = z.object({
  body: z.string().min(1),
  change_note: z.string().min(1).max(240),
  title: z.string().min(1).max(120).optional().nullable(),
  area_id: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  owner_profile_id: z.string().optional().nullable()
});

function processMutationError(error: unknown) {
  if (error instanceof Error && error.message === "PROCESS_NOT_FOUND") {
    return new ApiError(404, "PROCESS_NOT_FOUND", "Processo não encontrado.");
  }
  return error;
}

export async function registerProcessRoutes(app: FastifyInstance, repository: ProcessRepository) {
  const service = createProcessService(repository);

  app.get("/processes", async (request) => {
    const context = readRequestContext(request);
    const processes = await service.listProcesses(context.workspaceId);
    return { processes };
  });

  app.post("/processes", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const body = createProcessSchema.parse(request.body);
    const process = await service.createProcess(context.workspaceId, context.profileId, {
      title: body.title,
      body: body.body,
      areaId: body.area_id,
      summary: body.summary,
      ownerProfileId: body.owner_profile_id
    });

    return reply.status(201).send({ process });
  });

  app.post("/processes/:id/versions", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = createProcessVersionSchema.parse(request.body);
    const process = await service.createProcessVersion(context.workspaceId, params.id, context.profileId, {
      body: body.body,
      changeNote: body.change_note,
      title: body.title,
      areaId: body.area_id,
      summary: body.summary,
      ownerProfileId: body.owner_profile_id
    });

    return reply.status(201).send({ process });
  });

  app.post("/processes/:id/publish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const process = await service.publishProcess(context.workspaceId, params.id);
    return { process };
  });

  app.post("/processes/:id/unpublish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const process = await service.unpublishProcess(context.workspaceId, params.id);
    return { process };
  });

  app.delete("/processes/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    try {
      await service.deleteProcess(context.workspaceId, params.id);
      return { ok: true };
    } catch (error) {
      throw processMutationError(error);
    }
  });
}
