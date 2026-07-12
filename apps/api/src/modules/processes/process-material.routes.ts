import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canManageKnowledge } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext, requireOperationalMembership } from "../../http/auth-context";
import { canManageAreaResource, canReadAreaResource } from "../company/access-policy";
import type { ObjectStorage } from "../../storage/object-storage";
import type { ProcessRepository } from "./process.types";

const processParamsSchema = z.object({ id: z.string().min(1) });
const materialParamsSchema = processParamsSchema.extend({ materialId: z.string().min(1) });
const linkMaterialSchema = z.object({
  title: z.string().trim().min(1).max(160),
  url: z.string().url().max(2_000)
});
const downloadLifetimeSeconds = 10 * 60;

export async function registerProcessMaterialRoutes(
  app: FastifyInstance,
  repository: ProcessRepository,
  objectStorage: ObjectStorage
) {
  app.post("/processes/:id/materials/links", async (request, reply) => {
    const context = requireKnowledgeManager(request);
    const params = processParamsSchema.parse(request.params);
    const body = linkMaterialSchema.parse(request.body);
    const process = await requireProcess(repository, context.workspaceId, params.id);
    requireManagedProcess(request, process.areaId);

    try {
      const material = await repository.addProcessMaterial({
        workspaceId: context.workspaceId,
        processId: params.id,
        kind: "link",
        title: body.title,
        url: body.url,
        objectKey: null,
        contentType: null,
        sizeBytes: null
      });
      return reply.status(201).send({ material });
    } catch (error) {
      throw materialMutationError(error);
    }
  });

  app.post("/processes/:id/materials/files", async (request, reply) => {
    const context = requireKnowledgeManager(request);
    const params = processParamsSchema.parse(request.params);
    const process = await requireProcess(repository, context.workspaceId, params.id);
    requireManagedProcess(request, process.areaId);
    const file = await request.file();
    if (!file) throw new ApiError(400, "PROCESS_MATERIAL_FILE_REQUIRED", "Selecione um arquivo para anexar.");

    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "O arquivo enviado é grande demais para esta operação.");
    }
    if (!buffer.length) throw new ApiError(400, "PROCESS_MATERIAL_FILE_EMPTY", "O arquivo não pode estar vazio.");

    const contentType = file.mimetype.trim().toLowerCase() || "application/octet-stream";
    const key = createProcessMaterialKey(context.workspaceId, params.id, file.filename);
    let stored = false;
    try {
      await objectStorage.put({ key, body: Readable.from(buffer), contentType, sizeBytes: buffer.length });
      stored = true;
      const material = await repository.addProcessMaterial({
        workspaceId: context.workspaceId,
        processId: params.id,
        kind: "file",
        title: sanitizeFilename(file.filename),
        url: null,
        objectKey: key,
        contentType,
        sizeBytes: buffer.length
      });
      return reply.status(201).send({ material });
    } catch (error) {
      if (stored) {
        try {
          await objectStorage.delete(key);
        } catch {
          // Keep the original persistence error; an orphaned object can be reconciled by its workspace-scoped key.
        }
      }
      throw materialMutationError(error, stored);
    }
  });

  app.get("/processes/:id/materials/:materialId/download", async (request) => {
    const context = readRequestContext(request);
    const params = materialParamsSchema.parse(request.params);
    const process = await requireProcess(repository, context.workspaceId, params.id);
    if (!canReadAreaResource(requireOperationalMembership(request), process.areaId)) throw scopeForbidden();
    const material = await requireMaterial(repository, context.workspaceId, params.id, params.materialId);
    if (material.kind !== "file" || !material.objectKey) {
      throw new ApiError(400, "PROCESS_MATERIAL_NOT_A_FILE", "Este material não é um arquivo para download.");
    }
    try {
      const url = await objectStorage.createDownloadUrl(material.objectKey, downloadLifetimeSeconds);
      return { url, expires_in_seconds: downloadLifetimeSeconds };
    } catch (error) {
      throw materialStorageError(error);
    }
  });

  app.delete("/processes/:id/materials/:materialId", async (request) => {
    const context = requireKnowledgeManager(request);
    const params = materialParamsSchema.parse(request.params);
    const process = await requireProcess(repository, context.workspaceId, params.id);
    requireManagedProcess(request, process.areaId);
    const material = await requireMaterial(repository, context.workspaceId, params.id, params.materialId);

    try {
      if (material.objectKey) await objectStorage.delete(material.objectKey);
      const removed = await repository.removeProcessMaterial(context.workspaceId, params.id, params.materialId);
      if (!removed) throw new ApiError(404, "PROCESS_MATERIAL_NOT_FOUND", "Material não encontrado.");
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw materialStorageError(error);
    }
  });
}

function requireKnowledgeManager(request: Parameters<typeof readRequestContext>[0]) {
  const context = readRequestContext(request);
  if (!canManageKnowledge(context.role)) throw forbiddenError();
  return context;
}

function requireManagedProcess(request: Parameters<typeof readRequestContext>[0], areaId: string | null) {
  if (!canManageAreaResource(requireOperationalMembership(request), areaId)) throw scopeForbidden();
}

function scopeForbidden() {
  return new ApiError(403, "BAASE_SCOPE_FORBIDDEN", "Você não tem acesso a esta área.");
}

async function requireProcess(repository: ProcessRepository, workspaceId: string, processId: string) {
  const process = await repository.findProcess(workspaceId, processId);
  if (!process) throw new ApiError(404, "PROCESS_NOT_FOUND", "Processo não encontrado.");
  return process;
}

async function requireMaterial(repository: ProcessRepository, workspaceId: string, processId: string, materialId: string) {
  await requireProcess(repository, workspaceId, processId);
  const material = await repository.findProcessMaterial(workspaceId, processId, materialId);
  if (!material) throw new ApiError(404, "PROCESS_MATERIAL_NOT_FOUND", "Material não encontrado.");
  return material;
}

function materialMutationError(error: unknown, stored = false) {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && error.message === "PROCESS_NOT_FOUND") {
    return new ApiError(404, "PROCESS_NOT_FOUND", "Processo não encontrado.");
  }
  if (stored) return new ApiError(503, "PROCESS_MATERIAL_PERSISTENCE_FAILED", "Não foi possível salvar o material. Tente novamente.");
  return materialStorageError(error);
}

function materialStorageError(_error: unknown) {
  return new ApiError(503, "OBJECT_STORAGE_UNAVAILABLE", "Não foi possível acessar o armazenamento de arquivos. Tente novamente.");
}

function createProcessMaterialKey(workspaceId: string, processId: string, filename: string) {
  return `workspaces/${workspaceId}/processes/${processId}/${randomUUID()}-${sanitizeFilename(filename)}`;
}

function sanitizeFilename(filename: string) {
  const normalized = filename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return safe || "arquivo";
}
