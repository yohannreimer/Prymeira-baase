import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canManageKnowledge } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import { requireOperationalMembership } from "../../http/auth-context";
import { canManageAreaResource, canReadAreaResource } from "../company/access-policy";
import { createProcessService } from "./process.service";
import type { ProcessRepository } from "./process.types";
import type { CompanyRepository } from "../company/company.types";

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

const ownerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("person"), person_id: z.string().min(1) }),
  z.object({ type: z.literal("role"), role_template_id: z.string().min(1) })
]);

const materialSchema = z.object({
  kind: z.literal("link"),
  title: z.string().min(1).max(160),
  url: z.string().url().max(2_000)
});

const editProcessSchema = z.object({
  body: z.string().min(1),
  change_note: z.string().trim().min(1).max(240),
  title: z.string().min(1).max(120).optional().nullable(),
  area_id: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  owner: ownerSchema.nullable().optional(),
  materials: z.array(materialSchema).max(50).optional()
});

function processMutationError(error: unknown) {
  if (error instanceof Error && error.message === "PROCESS_NOT_FOUND") {
    return new ApiError(404, "PROCESS_NOT_FOUND", "Processo não encontrado.");
  }
  if (error instanceof Error && [
    "PROCESS_AREA_NOT_FOUND",
    "PROCESS_OWNER_PERSON_NOT_FOUND",
    "PROCESS_OWNER_ROLE_NOT_FOUND",
    "PROCESS_OWNER_AREA_MISMATCH",
    "PROCESS_MATERIAL_TITLE_REQUIRED",
    "PROCESS_MATERIAL_URL_REQUIRED",
    "PROCESS_MATERIAL_URL_INVALID",
    "PROCESS_MATERIAL_SIZE_INVALID",
    "AREA_NOT_FOUND",
    "PERSON_NOT_FOUND",
    "ROLE_TEMPLATE_NOT_FOUND",
    "ROLE_TEMPLATE_AREA_MISMATCH"
  ].includes(error.message)) {
    return new ApiError(422, error.message, "Os vínculos do processo não são válidos para esta empresa.");
  }
  return error;
}

export async function registerProcessRoutes(
  app: FastifyInstance,
  repository: ProcessRepository,
  companyRepository: CompanyRepository
) {
  const service = createProcessService(repository, { companyRepository });

  app.get("/processes", async (request) => {
    const context = readRequestContext(request);
    const membership = requireOperationalMembership(request);
    const processes = await service.listProcesses(context.workspaceId);
    return { processes: processes.filter((process) => {
      if (membership.role === "employee" && process.status !== "published") return false;
      return canReadAreaResource(membership, process.areaId);
    }) };
  });

  app.post("/processes", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const body = createProcessSchema.parse(request.body);
    if (!canManageAreaResource(requireOperationalMembership(request), body.area_id ?? null)) throw scopeForbidden();
    try {
      const process = await service.createProcess(context.workspaceId, context.profileId, {
        title: body.title,
        body: body.body,
        areaId: body.area_id,
        summary: body.summary,
        ownerProfileId: body.owner_profile_id
      });

      return reply.status(201).send({ process });
    } catch (error) {
      throw processMutationError(error);
    }
  });

  app.post("/processes/:id/versions", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = createProcessVersionSchema.parse(request.body);
    const existingProcess = await requireManagedProcess(repository, context.workspaceId, params.id, requireOperationalMembership(request));
    const targetAreaId = body.area_id === undefined ? existingProcess.areaId : body.area_id;
    if (!canManageAreaResource(requireOperationalMembership(request), targetAreaId ?? null)) throw scopeForbidden();
    try {
      const process = await service.createProcessVersion(context.workspaceId, params.id, context.profileId, {
        body: body.body,
        changeNote: body.change_note,
        title: body.title,
        areaId: body.area_id,
        summary: body.summary,
        ownerProfileId: body.owner_profile_id
      });

      return reply.status(201).send({ process });
    } catch (error) {
      throw processMutationError(error);
    }
  });

  app.patch("/processes/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = editProcessSchema.parse(request.body);
    const existingProcess = await requireManagedProcess(repository, context.workspaceId, params.id, requireOperationalMembership(request));
    const targetAreaId = body.area_id === undefined ? existingProcess.areaId : body.area_id;
    if (!canManageAreaResource(requireOperationalMembership(request), targetAreaId ?? null)) throw scopeForbidden();
    const owner = body.owner === undefined ? undefined : body.owner === null ? null : body.owner.type === "person"
      ? { type: "person" as const, personId: body.owner.person_id }
      : { type: "role" as const, roleTemplateId: body.owner.role_template_id };

    try {
      const process = await service.createProcessVersion(context.workspaceId, params.id, context.profileId, {
        body: body.body,
        changeNote: body.change_note,
        title: body.title,
        areaId: body.area_id,
        summary: body.summary,
        owner,
        materials: body.materials
      });
      return { process };
    } catch (error) {
      throw processMutationError(error);
    }
  });

  app.post("/processes/:id/publish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await requireManagedProcess(repository, context.workspaceId, params.id, requireOperationalMembership(request));
    const process = await service.publishProcess(context.workspaceId, params.id);
    return { process };
  });

  app.post("/processes/:id/unpublish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await requireManagedProcess(repository, context.workspaceId, params.id, requireOperationalMembership(request));
    const process = await service.unpublishProcess(context.workspaceId, params.id);
    return { process };
  });

  app.delete("/processes/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await requireManagedProcess(repository, context.workspaceId, params.id, requireOperationalMembership(request));

    try {
      await service.deleteProcess(context.workspaceId, params.id);
      return { ok: true };
    } catch (error) {
      throw processMutationError(error);
    }
  });
}

async function requireManagedProcess(
  repository: ProcessRepository,
  workspaceId: string,
  processId: string,
  membership: ReturnType<typeof requireOperationalMembership>
) {
  const process = await repository.findProcess(workspaceId, processId);
  if (!process) throw new ApiError(404, "PROCESS_NOT_FOUND", "Processo não encontrado.");
  if (!canManageAreaResource(membership, process.areaId)) throw scopeForbidden();
  return process;
}

function scopeForbidden() {
  return new ApiError(403, "BAASE_SCOPE_FORBIDDEN", "Você não tem acesso a esta área.");
}
