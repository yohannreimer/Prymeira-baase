import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canManageKnowledge } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import { requireOperationalMembership } from "../../http/auth-context";
import { canExecuteTask, canManageAreaResource, canReadAreaResource, canReadTask } from "../company/access-policy";
import type { CompanyRepository, OperationalMembership } from "../company/company.types";
import { createAnnouncementService } from "../announcements/announcement.service";
import type { AnnouncementRepository } from "../announcements/announcement.types";
import { createTrainingService } from "../trainings/training.service";
import type { TrainingRepository } from "../trainings/training.types";
import { createRoutineService } from "./routine.service";
import type { RoutineRepository, TaskOccurrence } from "./routine.types";
import type { ObjectStorage } from "../../storage/object-storage";

const taskTemplateSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1).max(140),
  process_id: z.string().optional().nullable(),
  assignee_profile_id: z.string().optional().nullable(),
  due_hint: z.string().max(80).optional().nullable(),
  approval_mode: z.enum(["direct", "approval_required"]).optional(),
  evidence_policy: z.enum(["optional", "photo_required", "comment_required", "photo_or_comment_required"]).optional()
});

const createRoutineSchema = z.object({
  title: z.string().min(1).max(140),
  area_id: z.string().optional().nullable(),
  frequency: z.enum(["daily", "weekly", "monthly", "on_demand"]).optional(),
  weekdays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).optional(),
  due_hint: z.string().max(80).optional().nullable(),
  assignee_profile_ids: z.array(z.string().min(1)).optional(),
  execution_mode: z.enum(["shared", "individual"]).optional(),
  approval_mode: z.enum(["direct", "approval_required"]).optional(),
  evidence_policy: z.enum(["optional", "photo_required", "comment_required", "photo_or_comment_required"]).optional(),
  task_templates: z.array(taskTemplateSchema).min(1)
});

const generateOccurrencesSchema = z.object({
  due_date: z.string().min(10).max(10)
});

const createManualTaskSchema = z.object({
  title: z.string().min(1).max(160),
  area_id: z.string().optional().nullable(),
  assignee_profile_id: z.string().optional().nullable(),
  due_date: z.string().min(10).max(10),
  due_hint: z.string().max(80).optional().nullable(),
  approval_mode: z.enum(["direct", "approval_required"]).optional(),
  evidence_policy: z.enum(["optional", "photo_required", "comment_required", "photo_or_comment_required"]).optional(),
  checklist_items: z.array(z.string().min(1).max(180)).optional()
});

const updateTaskChecklistSchema = z.object({
  checklist_items: z.array(z.object({
    title: z.string().min(1).max(180),
    done: z.boolean()
  }))
});

const todayQuerySchema = z.object({
  date: z.string().min(10).max(10).optional()
});

const submitTaskSchema = z.object({
  comment: z.string().optional().nullable(),
  photo_url: z.string().optional().nullable()
});

const returnTaskSchema = z.object({
  comment: z.string().optional().nullable()
});

function routineMutationError(error: unknown) {
  if (error instanceof Error && error.message === "ROUTINE_WEEKLY_WEEKDAY_INVALID") {
    return new ApiError(
      400,
      "ROUTINE_WEEKLY_WEEKDAY_INVALID",
      "Rotinas semanais precisam ter exatamente um dia da semana."
    );
  }
  if (error instanceof Error && error.message === "ROUTINE_NOT_FOUND") {
    return new ApiError(404, "ROUTINE_NOT_FOUND", "Rotina não encontrada.");
  }
  return error;
}

function taskMutationError(error: unknown) {
  if (error instanceof Error && error.message === "TASK_NOT_FOUND") {
    return new ApiError(404, "TASK_NOT_FOUND", "Tarefa não encontrada.");
  }
  if (error instanceof Error && error.message === "TASK_NOT_MANUAL") {
    return new ApiError(400, "TASK_NOT_MANUAL", "Somente tarefas pontuais podem ser editadas por aqui.");
  }
  if (error instanceof Error && error.message === "TASK_NOT_PENDING") {
    return new ApiError(409, "TASK_NOT_PENDING", "Somente tarefas pendentes podem ser alteradas ou removidas.");
  }
  if (error instanceof Error && error.message === "TASK_NOT_ASSIGNED_TO_PROFILE") {
    return new ApiError(403, "TASK_NOT_ASSIGNED_TO_PROFILE", "Tarefa não atribuída a este perfil.");
  }
  if (error instanceof Error && error.message === "TASK_EVIDENCE_REQUIRED") {
    return new ApiError(400, "TASK_EVIDENCE_REQUIRED", "Envie a evidência exigida para concluir a tarefa.");
  }
  return error;
}

type RoutineRouteOptions = {
  companyRepository: CompanyRepository;
  objectStorage: ObjectStorage;
  trainingRepository?: TrainingRepository;
  announcementRepository?: AnnouncementRepository;
};

export async function registerRoutineRoutes(app: FastifyInstance, repository: RoutineRepository, options: RoutineRouteOptions) {
  const service = createRoutineService(repository);
  const trainingService = options.trainingRepository ? createTrainingService(options.trainingRepository) : null;
  const announcementService = options.announcementRepository ? createAnnouncementService(options.announcementRepository) : null;

  app.get("/routines", async (request) => {
    const context = readRequestContext(request);
    const membership = requireOperationalMembership(request);
    const routines = await service.listRoutines(context.workspaceId);
    return { routines: routines.filter((routine) => canReadRoutineOrTaskArea(membership, routine.areaId)) };
  });

  app.post("/routines", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const body = createRoutineSchema.parse(request.body);
    if (!canManageRoutineOrTaskArea(requireOperationalMembership(request), body.area_id ?? null)) throw scopeForbidden();
    await assertRoutineAssigneesEligible(
      options.companyRepository,
      context.workspaceId,
      body.assignee_profile_ids,
      body.task_templates.map((template) => template.assignee_profile_id),
      body.area_id ?? null
    );
    let routine;
    try {
      routine = await service.createRoutine(context.workspaceId, context.profileId, {
        title: body.title,
        areaId: body.area_id,
        frequency: body.frequency,
        weekdays: body.weekdays,
        dueHint: body.due_hint,
        assigneeProfileIds: body.assignee_profile_ids,
        executionMode: body.execution_mode,
        approvalMode: body.approval_mode,
        evidencePolicy: body.evidence_policy,
        taskTemplates: body.task_templates.map((template) => ({
          id: template.id,
          title: template.title,
          processId: template.process_id,
          assigneeProfileId: template.assignee_profile_id,
          dueHint: template.due_hint,
          approvalMode: template.approval_mode,
          evidencePolicy: template.evidence_policy
        }))
      });
    } catch (error) {
      throw routineMutationError(error);
    }

    return reply.status(201).send({ routine });
  });

  app.patch("/routines/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = createRoutineSchema.parse(request.body);
    let routine;
    try {
      const membership = requireOperationalMembership(request);
      const existingRoutine = await service.getRoutine(context.workspaceId, params.id);
      if (!canManageRoutineOrTaskArea(membership, existingRoutine.areaId)) throw scopeForbidden();
      if (!canManageRoutineOrTaskArea(membership, body.area_id ?? null)) throw scopeForbidden();
      await assertRoutineAssigneesEligible(
        options.companyRepository,
        context.workspaceId,
        body.assignee_profile_ids,
        body.task_templates.map((template) => template.assignee_profile_id),
        body.area_id ?? null
      );
      routine = await service.updateRoutine(context.workspaceId, params.id, {
        title: body.title,
        areaId: body.area_id,
        frequency: body.frequency,
        weekdays: body.weekdays,
        dueHint: body.due_hint,
        assigneeProfileIds: body.assignee_profile_ids,
        executionMode: body.execution_mode,
        approvalMode: body.approval_mode,
        evidencePolicy: body.evidence_policy,
        taskTemplates: body.task_templates.map((template) => ({
          id: template.id,
          title: template.title,
          processId: template.process_id,
          assigneeProfileId: template.assignee_profile_id,
          dueHint: template.due_hint,
          approvalMode: template.approval_mode,
          evidencePolicy: template.evidence_policy
        }))
      });
    } catch (error) {
      throw routineMutationError(error);
    }

    return { routine };
  });

  app.post("/routines/:id/archive", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      const routine = await service.getRoutine(context.workspaceId, params.id);
      if (!canManageRoutineOrTaskArea(requireOperationalMembership(request), routine.areaId)) throw scopeForbidden();
      return { routine: await service.archiveRoutine(context.workspaceId, params.id) };
    } catch (error) {
      throw routineMutationError(error);
    }
  });

  app.delete("/routines/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    try {
      const routine = await service.getRoutine(context.workspaceId, params.id);
      if (!canManageRoutineOrTaskArea(requireOperationalMembership(request), routine.areaId)) throw scopeForbidden();
      await service.deleteRoutine(context.workspaceId, params.id);
      return { ok: true };
    } catch (error) {
      throw routineMutationError(error);
    }
  });

  app.post("/routines/:id/occurrences/generate", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = generateOccurrencesSchema.parse(request.body);
    try {
      const routine = await service.getRoutine(context.workspaceId, params.id);
      if (!canManageRoutineOrTaskArea(requireOperationalMembership(request), routine.areaId)) throw scopeForbidden();
      const tasks = await service.generateRoutineOccurrences(context.workspaceId, params.id, body.due_date);
      return reply.status(201).send({ tasks });
    } catch (error) {
      throw routineMutationError(error);
    }
  });

  app.get("/today", async (request) => {
    const context = readRequestContext(request);
    const query = todayQuerySchema.parse(request.query);
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const membership = requireOperationalMembership(request);
    const [tasks, trainingAssignments, announcements] = await Promise.all([
      service.listTodayTasks(context.workspaceId, date),
      trainingService
        ? trainingService.listTrainingProgress(context.workspaceId, {
          profileId: context.profileId,
          date
        })
        : Promise.resolve([]),
      announcementService
        ? announcementService.listAnnouncementsForProfile(context.workspaceId, {
          profileId: context.profileId,
          role: context.role
        })
        : Promise.resolve([])
    ]);
    return {
      tasks: await presentTasks(tasks.filter((task) => canReadTask(membership, task)), options.objectStorage),
      training_assignments: trainingAssignments,
      announcements
    };
  });

  app.get("/approvals", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const tasks = await service.listApprovalTasks(context.workspaceId);
    const membership = requireOperationalMembership(request);
    return { tasks: await presentTasks(tasks.filter((task) => canManageRoutineOrTaskArea(membership, task.areaId ?? null)), options.objectStorage) };
  });

  app.post("/tasks", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const body = createManualTaskSchema.parse(request.body);
    const membership = requireOperationalMembership(request);
    const areaId = body.area_id ?? null;
    if (!canManageRoutineOrTaskArea(membership, areaId)) throw scopeForbidden();
    await assertTaskAssigneeEligible(options.companyRepository, context.workspaceId, body.assignee_profile_id, areaId);
    const task = await service.createManualTask(context.workspaceId, context.profileId, {
      title: body.title,
      areaId: body.area_id,
      assigneeProfileId: body.assignee_profile_id,
      dueDate: body.due_date,
      dueHint: body.due_hint,
      approvalMode: body.approval_mode,
      evidencePolicy: body.evidence_policy,
      checklistItems: body.checklist_items
    });

    return reply.status(201).send({ task });
  });

  app.delete("/tasks/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    try {
      const task = await service.getTask(context.workspaceId, params.id);
      if (!canManageRoutineOrTaskArea(requireOperationalMembership(request), task.areaId ?? null)) throw scopeForbidden();
      const deletedTask = await service.deleteTask(context.workspaceId, params.id);
      await deleteEvidenceObject(options.objectStorage, deletedTask.evidence?.attachment?.objectKey);
      return { ok: true };
    } catch (error) {
      throw taskMutationError(error);
    }
  });

  app.patch("/tasks/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = createManualTaskSchema.parse(request.body);

    try {
      const membership = requireOperationalMembership(request);
      const existingTask = await service.getTask(context.workspaceId, params.id);
      const areaId = body.area_id ?? null;
      if (!canManageRoutineOrTaskArea(membership, existingTask.areaId ?? null)) throw scopeForbidden();
      if (!canManageRoutineOrTaskArea(membership, areaId)) throw scopeForbidden();
      await assertTaskAssigneeEligible(
        options.companyRepository,
        context.workspaceId,
        body.assignee_profile_id ?? existingTask.assigneeProfileId,
        areaId
      );
      const task = await service.updateManualTask(context.workspaceId, params.id, {
        title: body.title,
        areaId: body.area_id,
        assigneeProfileId: body.assignee_profile_id,
        dueDate: body.due_date,
        dueHint: body.due_hint,
        approvalMode: body.approval_mode,
        evidencePolicy: body.evidence_policy,
        checklistItems: body.checklist_items
      });
      return { task: await presentTask(task, options.objectStorage) };
    } catch (error) {
      throw taskMutationError(error);
    }
  });

  app.patch("/tasks/:id/checklist", async (request) => {
    const context = readRequestContext(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = updateTaskChecklistSchema.parse(request.body);

    try {
      const membership = requireOperationalMembership(request);
      const existingTask = await service.getTask(context.workspaceId, params.id);
      assertCanExecuteTask(membership, existingTask);
      const task = await service.updateTaskChecklist(context.workspaceId, params.id, context.profileId, {
        checklistItems: body.checklist_items
      }, { allowAssigneeOverride: membership.role === "owner" });
      return { task: await presentTask(task, options.objectStorage) };
    } catch (error) {
      throw taskMutationError(error);
    }
  });

  app.post("/tasks/:id/submit", async (request) => {
    const context = readRequestContext(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = submitTaskSchema.parse(request.body);
    try {
      const membership = requireOperationalMembership(request);
      const task = await service.getTask(context.workspaceId, params.id);
      assertCanExecuteTask(membership, task);
      const submittedTask = await service.submitTask(context.workspaceId, params.id, context.profileId, {
        comment: body.comment,
        photoUrl: body.photo_url
      }, { allowAssigneeOverride: membership.role === "owner" });
      return { task: await presentTask(submittedTask, options.objectStorage) };
    } catch (error) {
      throw taskMutationError(error);
    }
  });

  app.post("/tasks/:id/evidence", async (request, reply) => {
    const context = readRequestContext(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const membership = requireOperationalMembership(request);
    let task: TaskOccurrence;
    try {
      task = await service.getTask(context.workspaceId, params.id);
    } catch (error) {
      throw taskEvidenceMutationError(error);
    }
    assertCanExecuteTask(membership, task);

    const file = await request.file();
    if (!file) throw new ApiError(400, "TASK_EVIDENCE_FILE_REQUIRED", "Selecione um arquivo para anexar.");
    if (file.file.truncated) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "O arquivo enviado é grande demais para esta operação.");
    }

    const buffer = await file.toBuffer();
    if (!buffer.length) throw new ApiError(400, "TASK_EVIDENCE_FILE_EMPTY", "O arquivo não pode estar vazio.");
    if (buffer.length > TASK_EVIDENCE_MAX_BYTES) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "O arquivo enviado é grande demais para esta operação.");
    }
    const contentType = file.mimetype.trim().toLowerCase();
    if (!isValidTaskEvidenceFile(file.filename, contentType, buffer)) {
      throw new ApiError(415, "TASK_EVIDENCE_TYPE_INVALID", "Este tipo de arquivo não pode ser usado como evidência.");
    }
    if (file.fields.photo_url) {
      throw new ApiError(400, "REQUEST_VALIDATION_ERROR", "A URL de foto não é aceita para anexos de evidência.");
    }

    const fileName = sanitizeFilename(file.filename);
    const objectKey = `workspaces/${context.workspaceId}/task-evidence/${params.id}/${randomUUID()}-${fileName}`;
    let stored = false;
    let persisted = false;
    try {
      await options.objectStorage.put({ key: objectKey, body: Readable.from(buffer), contentType, sizeBytes: buffer.length });
      stored = true;
      const evidence = await service.attachTaskEvidence(context.workspaceId, params.id, context.profileId, {
        attachment: { objectKey, fileName, contentType, sizeBytes: buffer.length }
      }, { allowAssigneeOverride: membership.role === "owner" });
      persisted = true;
      await deleteEvidenceObject(options.objectStorage, task.evidence?.attachment?.objectKey, objectKey);
      const presented = await presentTask(evidence, options.objectStorage);
      return reply.status(201).send({ evidence: presented.evidence });
    } catch (error) {
      if (stored && !persisted) {
        try { await options.objectStorage.delete(objectKey); } catch { /* preserve the original error */ }
      }
      throw taskEvidenceMutationError(error);
    }
  });

  app.post("/tasks/:id/approve", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      const existingTask = await service.getTask(context.workspaceId, params.id);
      if (!canManageRoutineOrTaskArea(requireOperationalMembership(request), existingTask.areaId ?? null)) throw scopeForbidden();
      const task = await service.approveTask(context.workspaceId, params.id, context.profileId);
      return { task: await presentTask(task, options.objectStorage) };
    } catch (error) {
      throw taskMutationError(error);
    }
  });

  app.post("/tasks/:id/return", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = returnTaskSchema.parse(request.body);
    try {
      const existingTask = await service.getTask(context.workspaceId, params.id);
      if (!canManageRoutineOrTaskArea(requireOperationalMembership(request), existingTask.areaId ?? null)) throw scopeForbidden();
      const task = await service.returnTask(context.workspaceId, params.id, context.profileId, {
        comment: body.comment
      });
      return { task: await presentTask(task, options.objectStorage) };
    } catch (error) {
      throw taskMutationError(error);
    }
  });
}

const TASK_EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;
const TASK_EVIDENCE_URL_TTL_SECONDS = 10 * 60;
const taskEvidenceFormats = [
  { contentType: "image/png", extensions: ["png"], matches: (buffer: Buffer) => hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { contentType: "image/jpeg", extensions: ["jpg", "jpeg"], matches: (buffer: Buffer) => hasPrefix(buffer, [0xff, 0xd8, 0xff]) },
  { contentType: "image/gif", extensions: ["gif"], matches: (buffer: Buffer) => buffer.subarray(0, 6).equals(Buffer.from("GIF87a")) || buffer.subarray(0, 6).equals(Buffer.from("GIF89a")) },
  { contentType: "image/webp", extensions: ["webp"], matches: (buffer: Buffer) => buffer.subarray(0, 4).equals(Buffer.from("RIFF")) && buffer.subarray(8, 12).equals(Buffer.from("WEBP")) },
  { contentType: "application/pdf", extensions: ["pdf"], matches: (buffer: Buffer) => buffer.subarray(0, 5).equals(Buffer.from("%PDF-")) },
  { contentType: "application/msword", extensions: ["doc"], matches: isCompoundDocument },
  { contentType: "application/vnd.ms-excel", extensions: ["xls"], matches: isCompoundDocument },
  { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extensions: ["docx"], matches: (buffer: Buffer) => isOfficeZip(buffer, "word/") },
  { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extensions: ["xlsx"], matches: (buffer: Buffer) => isOfficeZip(buffer, "xl/") }
] as const;

function isValidTaskEvidenceFile(filename: string, contentType: string, buffer: Buffer) {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  const format = taskEvidenceFormats.find((candidate) => candidate.contentType === contentType && (candidate.extensions as readonly string[]).includes(extension ?? ""));
  return Boolean(format?.matches(buffer));
}

function hasPrefix(buffer: Buffer, signature: number[]) {
  return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);
}

function isCompoundDocument(buffer: Buffer) {
  return hasPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function isOfficeZip(buffer: Buffer, entryPrefix: string) {
  return hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04]) && buffer.includes(Buffer.from(entryPrefix));
}

async function presentTasks(tasks: TaskOccurrence[], objectStorage: ObjectStorage) {
  return Promise.all(tasks.map((task) => presentTask(task, objectStorage)));
}

async function presentTask(task: TaskOccurrence, objectStorage: ObjectStorage): Promise<TaskOccurrence> {
  const attachment = task.evidence?.attachment;
  if (!attachment) return task;
  try {
    const url = await objectStorage.createDownloadUrl(attachment.objectKey, TASK_EVIDENCE_URL_TTL_SECONDS);
    return { ...task, evidence: { ...task.evidence!, attachment: { ...attachment, url } } };
  } catch {
    return { ...task, evidence: { ...task.evidence!, attachment: { ...attachment } } };
  }
}

async function deleteEvidenceObject(objectStorage: ObjectStorage, objectKey: string | undefined, exceptObjectKey?: string) {
  if (!objectKey || objectKey === exceptObjectKey) return;
  try {
    await objectStorage.delete(objectKey);
  } catch {
    // Metadata mutation already committed; a failed cleanup must not restore stale metadata.
  }
}

function sanitizeFilename(filename: string) {
  const normalized = filename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return safe || "arquivo";
}

function taskEvidenceMutationError(error: unknown) {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && error.message === "TASK_NOT_FOUND") return new ApiError(404, "TASK_NOT_FOUND", "Tarefa não encontrada.");
  if (error instanceof Error && error.message === "TASK_NOT_ASSIGNED_TO_PROFILE") return new ApiError(403, "TASK_NOT_ASSIGNED_TO_PROFILE", "Tarefa não atribuída a este perfil.");
  if (error instanceof Error && error.message === "TASK_CANNOT_BE_SUBMITTED") return new ApiError(409, "TASK_CANNOT_BE_SUBMITTED", "A tarefa não pode receber evidências neste estado.");
  return new ApiError(503, "OBJECT_STORAGE_UNAVAILABLE", "Não foi possível salvar a evidência. Tente novamente.");
}

function scopeForbidden() {
  return new ApiError(403, "BAASE_SCOPE_FORBIDDEN", "Você não tem acesso a esta área.");
}

function canReadRoutineOrTaskArea(membership: OperationalMembership, areaId: string | null) {
  return membership.role === "owner" || (areaId !== null && canReadAreaResource(membership, areaId));
}

function canManageRoutineOrTaskArea(membership: OperationalMembership, areaId: string | null) {
  return membership.role === "owner" || (areaId !== null && canManageAreaResource(membership, areaId));
}

async function assertTaskAssigneeEligible(
  companyRepository: CompanyRepository,
  workspaceId: string,
  assigneeProfileId: string | null | undefined,
  areaId: string | null
) {
  if (!assigneeProfileId) return;
  const person = await companyRepository.findTeamMember(workspaceId, assigneeProfileId);
  if (!person || person.status !== "active") {
    throw new ApiError(404, "TEAM_MEMBER_NOT_FOUND", "Pessoa não encontrada.");
  }
  if (person.areaId === areaId || (areaId !== null && person.areaAccessIds.includes(areaId))) return;
  throw scopeForbidden();
}

async function assertRoutineAssigneesEligible(
  companyRepository: CompanyRepository,
  workspaceId: string,
  assigneeProfileIds: string[] | undefined,
  taskTemplateAssigneeProfileIds: Array<string | null | undefined>,
  areaId: string | null
) {
  const assignees = new Set([
    ...(assigneeProfileIds ?? []),
    ...taskTemplateAssigneeProfileIds.filter((profileId): profileId is string => Boolean(profileId))
  ]);

  for (const assigneeProfileId of assignees) {
    await assertTaskAssigneeEligible(companyRepository, workspaceId, assigneeProfileId, areaId);
  }
}

function assertCanExecuteTask(
  membership: OperationalMembership,
  task: TaskOccurrence
) {
  if (canExecuteTask(membership, task)) return;
  throw scopeForbidden();
}
