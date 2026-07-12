import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canManageKnowledge } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import { requireOperationalMembership } from "../../http/auth-context";
import { canExecuteTask, canManageAreaResource, canReadAreaResource, canReadTask } from "../company/access-policy";
import type { OperationalMembership } from "../company/company.types";
import { createAnnouncementService } from "../announcements/announcement.service";
import type { AnnouncementRepository } from "../announcements/announcement.types";
import { createTrainingService } from "../trainings/training.service";
import type { TrainingRepository } from "../trainings/training.types";
import { createRoutineService } from "./routine.service";
import type { RoutineRepository, TaskOccurrence } from "./routine.types";

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
  if (error instanceof Error && error.message === "TASK_NOT_ASSIGNED_TO_PROFILE") {
    return new ApiError(403, "TASK_NOT_ASSIGNED_TO_PROFILE", "Tarefa não atribuída a este perfil.");
  }
  return error;
}

type RoutineRouteOptions = {
  trainingRepository?: TrainingRepository;
  announcementRepository?: AnnouncementRepository;
};

export async function registerRoutineRoutes(app: FastifyInstance, repository: RoutineRepository, options: RoutineRouteOptions = {}) {
  const service = createRoutineService(repository);
  const trainingService = options.trainingRepository ? createTrainingService(options.trainingRepository) : null;
  const announcementService = options.announcementRepository ? createAnnouncementService(options.announcementRepository) : null;

  app.get("/routines", async (request) => {
    const context = readRequestContext(request);
    const membership = requireOperationalMembership(request);
    const routines = await service.listRoutines(context.workspaceId);
    return { routines: routines.filter((routine) => canReadAreaResource(membership, routine.areaId)) };
  });

  app.post("/routines", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const body = createRoutineSchema.parse(request.body);
    if (!canManageAreaResource(requireOperationalMembership(request), body.area_id ?? null)) throw scopeForbidden();
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
    const routine = await service.archiveRoutine(context.workspaceId, params.id);
    return { routine };
  });

  app.delete("/routines/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    try {
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
    const tasks = await service.generateRoutineOccurrences(context.workspaceId, params.id, body.due_date);
    return reply.status(201).send({ tasks });
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
      tasks: tasks.filter((task) => canReadTask(membership, task)),
      training_assignments: trainingAssignments,
      announcements
    };
  });

  app.get("/approvals", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const tasks = await service.listApprovalTasks(context.workspaceId);
    const membership = requireOperationalMembership(request);
    return { tasks: tasks.filter((task) => canManageAreaResource(membership, task.areaId ?? null)) };
  });

  app.post("/tasks", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const body = createManualTaskSchema.parse(request.body);
    if (!canManageAreaResource(requireOperationalMembership(request), body.area_id ?? null)) throw scopeForbidden();
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
      if (!canManageAreaResource(requireOperationalMembership(request), task.areaId ?? null)) throw scopeForbidden();
      await service.deleteTask(context.workspaceId, params.id);
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
      if (!canManageAreaResource(membership, existingTask.areaId ?? null)) throw scopeForbidden();
      if (!canManageAreaResource(membership, body.area_id ?? null)) throw scopeForbidden();
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
      return { task };
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
      return { task };
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
      return { task: submittedTask };
    } catch (error) {
      throw taskMutationError(error);
    }
  });

  app.post("/tasks/:id/approve", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      const existingTask = await service.getTask(context.workspaceId, params.id);
      if (!canManageAreaResource(requireOperationalMembership(request), existingTask.areaId ?? null)) throw scopeForbidden();
      const task = await service.approveTask(context.workspaceId, params.id, context.profileId);
      return { task };
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
      if (!canManageAreaResource(requireOperationalMembership(request), existingTask.areaId ?? null)) throw scopeForbidden();
      const task = await service.returnTask(context.workspaceId, params.id, context.profileId, {
        comment: body.comment
      });
      return { task };
    } catch (error) {
      throw taskMutationError(error);
    }
  });
}

function scopeForbidden() {
  return new ApiError(403, "BAASE_SCOPE_FORBIDDEN", "Você não tem acesso a esta área.");
}

function assertCanExecuteTask(
  membership: OperationalMembership,
  task: TaskOccurrence
) {
  if (canExecuteTask(membership, task)) return;
  if (task.assigneeProfileId && membership.role === "manager" && canManageAreaResource(membership, task.areaId ?? null)) {
    throw new ApiError(403, "TASK_NOT_ASSIGNED_TO_PROFILE", "Tarefa não atribuída a este perfil.");
  }
  throw scopeForbidden();
}
