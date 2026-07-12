import { canSubmitTask, readNextTaskStatus } from "@prymeira/baase-shared";
import { randomUUID } from "node:crypto";
import { normalizeRoutineRecurrence } from "./routine-recurrence";
import type {
  CompanyRoutine,
  CreateManualTaskInput,
  CreateRoutineInput,
  CreateRoutineTaskTemplateInput,
  EvidencePolicy,
  RoutineRepository,
  RoutineWeekday,
  RoutineTaskTemplate,
  SubmitTaskInput,
  TaskEvidence,
  TaskChecklistItem,
  TaskOccurrence,
  UpdateManualTaskInput,
  UpdateRoutineInput
} from "./routine.types";

const WEEKDAY_BY_DATE_INDEX: RoutineWeekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function requiredText(value: string, errorCode: string) {
  const text = value.trim();
  if (!text) throw new Error(errorCode);
  return text;
}

function optionalText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function uniqueOptionalTexts(values: string[] | null | undefined) {
  return [...new Set((values ?? []).map((value) => optionalText(value)).filter((value): value is string => Boolean(value)))];
}

function normalizedChecklistItems(items: string[] | null | undefined, previousItems: TaskChecklistItem[] = []) {
  const previousDoneByTitle = new Map(previousItems.map((item) => [item.title, item.done]));
  return uniqueOptionalTexts(items).map((title) => ({
    title,
    done: previousDoneByTitle.get(title) ?? false
  }));
}

function normalizedChecklistState(items: TaskChecklistItem[] | null | undefined) {
  const seen = new Set<string>();
  const normalized: TaskChecklistItem[] = [];

  for (const item of items ?? []) {
    const title = optionalText(item.title);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    normalized.push({ title, done: Boolean(item.done) });
  }

  return normalized;
}

function normalizeEvidence(input: SubmitTaskInput): TaskEvidence {
  return {
    comment: optionalText(input.comment),
    photoUrl: optionalText(input.photoUrl)
  };
}

function hasRequiredEvidence(policy: EvidencePolicy, evidence: TaskEvidence) {
  if (policy === "optional") return true;
  if (policy === "photo_required") return Boolean(evidence.photoUrl);
  if (policy === "comment_required") return Boolean(evidence.comment);
  return Boolean(evidence.comment || evidence.photoUrl);
}

function buildTemplate(
  workspaceId: string,
  routineId: string,
  index: number,
  input: CreateRoutineInput["taskTemplates"][number],
  id = input.id ?? `step_${randomUUID()}`
): RoutineTaskTemplate {
  const sortOrder = index + 1;
  return {
    id,
    routineId,
    workspaceId,
    title: requiredText(input.title, "ROUTINE_TASK_TITLE_REQUIRED"),
    processId: input.processId ?? null,
    assigneeProfileId: input.assigneeProfileId ?? null,
    dueHint: optionalText(input.dueHint),
    approvalMode: input.approvalMode ?? "direct",
    evidencePolicy: input.evidencePolicy ?? "optional",
    sortOrder
  };
}

function buildTemplates(
  workspaceId: string,
  routineId: string,
  input: CreateRoutineInput["taskTemplates"],
  existing: RoutineTaskTemplate[] = []
) {
  if (input.length === 0) throw new Error("ROUTINE_TASKS_REQUIRED");
  const unused = new Map(existing.map((template) => [template.id, template]));
  return input.map((template, index) => {
    let matched = template.id ? unused.get(template.id) : undefined;
    if (template.id && !matched) throw new Error("ROUTINE_TASK_ID_INVALID");
    matched ??= [...unused.values()].find((candidate) => sameTemplate(candidate, template));
    if (!matched && unused.size === 1 && input.length === 1) matched = [...unused.values()][0];
    if (matched) unused.delete(matched.id);
    return buildTemplate(workspaceId, routineId, index, template, matched?.id);
  });
}

function sameTemplate(current: RoutineTaskTemplate, input: CreateRoutineTaskTemplateInput) {
  return current.title === input.title.trim()
    && current.processId === (input.processId ?? null)
    && current.assigneeProfileId === (input.assigneeProfileId ?? null)
    && (current.dueHint ?? null) === optionalText(input.dueHint)
    && current.approvalMode === (input.approvalMode ?? "direct")
    && current.evidencePolicy === (input.evidencePolicy ?? "optional");
}

function normalizedExecutionMode(input: CreateRoutineInput) {
  if (input.executionMode) return input.executionMode;
  return uniqueOptionalTexts(input.assigneeProfileIds).length > 1 ? "individual" : "shared";
}

function normalizedRoutineFields(input: CreateRoutineInput) {
  const recurrence = normalizeRoutineRecurrence(input);
  return {
    ...recurrence,
    dueHint: optionalText(input.dueHint),
    assigneeProfileIds: uniqueOptionalTexts(input.assigneeProfileIds),
    executionMode: normalizedExecutionMode(input),
    approvalMode: input.approvalMode ?? "direct",
    evidencePolicy: input.evidencePolicy ?? "optional"
  };
}

function checklistItemsFromRoutine(routine: CompanyRoutine) {
  return routine.taskTemplates.map((template) => ({
    title: template.title,
    done: false
  }));
}

function weekdayFromDate(date: string) {
  return WEEKDAY_BY_DATE_INDEX[new Date(`${date}T00:00:00.000Z`).getUTCDay()] ?? "mon";
}

function shouldGenerateOnDate(routine: CompanyRoutine, dueDate: string) {
  if (routine.frequency === "on_demand") return false;
  if ((routine.frequency === "daily" || routine.frequency === "weekly" || !routine.frequency) && routine.weekdays?.length) {
    return routine.weekdays.includes(weekdayFromDate(dueDate));
  }
  return true;
}

function shouldAutoGenerateRoutine(routine: CompanyRoutine) {
  return routine.status === "active" && Boolean(routine.frequency);
}

function buildRoutineOccurrenceInputs(
  routine: CompanyRoutine,
  dueDate: string
): Array<Omit<TaskOccurrence, "id" | "createdAt" | "updatedAt">> {
  if (!shouldGenerateOnDate(routine, dueDate)) return [];

  if (routine.executionMode === "individual" && routine.assigneeProfileIds?.length) {
    return routine.assigneeProfileIds.map((assigneeProfileId) => ({
      workspaceId: routine.workspaceId,
      origin: "routine",
      routineId: routine.id,
      taskTemplateId: `${routine.id}__execution__${assigneeProfileId}`,
      title: routine.title,
      routineTitleSnapshot: routine.title,
      stepTitleSnapshot: routine.title,
      routineRevisionSnapshot: routine.updatedAt,
      areaId: routine.areaId,
      processId: null,
      assigneeProfileId,
      dueHint: routine.dueHint,
      approvalMode: routine.approvalMode ?? "direct",
      evidencePolicy: routine.evidencePolicy ?? "optional",
      checklistItems: checklistItemsFromRoutine(routine),
      status: "pending",
      dueDate,
      evidence: null,
      submittedByProfileId: null,
      submittedAt: null,
      reviewedByProfileId: null,
      reviewedAt: null,
      reviewComment: null
    }));
  }

  return routine.taskTemplates.map((template) => ({
    workspaceId: routine.workspaceId,
    origin: "routine",
    routineId: routine.id,
    taskTemplateId: template.id,
    title: template.title,
    routineTitleSnapshot: routine.title,
    stepTitleSnapshot: template.title,
    routineRevisionSnapshot: routine.updatedAt,
    areaId: routine.areaId,
    processId: template.processId,
    assigneeProfileId: template.assigneeProfileId,
    dueHint: template.dueHint,
    approvalMode: template.approvalMode,
    evidencePolicy: template.evidencePolicy,
    status: "pending",
    dueDate,
    evidence: null,
    submittedByProfileId: null,
    submittedAt: null,
    reviewedByProfileId: null,
    reviewedAt: null,
    reviewComment: null
  }));
}

function isMutableRoutineOccurrence(task: TaskOccurrence) {
  return task.status === "pending" && task.submittedAt === null;
}

function requirePendingTask(task: TaskOccurrence) {
  if (!isMutableRoutineOccurrence(task)) throw new Error("TASK_NOT_PENDING");
}

async function createOrReuseRoutineOccurrences(
  repository: RoutineRepository,
  routine: CompanyRoutine,
  dueDate: string
) {
  return repository.reconcileRoutineOccurrences(routine, dueDate, buildRoutineOccurrenceInputs(routine, dueDate));
}

async function ensureTodayOccurrences(repository: RoutineRepository, workspaceId: string, dueDate: string) {
  const routines = await repository.listRoutines(workspaceId);
  for (const routine of routines.filter(shouldAutoGenerateRoutine)) {
    await createOrReuseRoutineOccurrences(repository, routine, dueDate);
  }
}

export function createRoutineService(repository: RoutineRepository) {
  return {
    listRoutines(workspaceId: string) {
      return repository.listRoutines(workspaceId);
    },

    async getRoutine(workspaceId: string, routineId: string): Promise<CompanyRoutine> {
      return readRoutineOrThrow(repository, workspaceId, routineId);
    },

    async createRoutine(workspaceId: string, actorProfileId: string, input: CreateRoutineInput): Promise<CompanyRoutine> {
      const title = requiredText(input.title, "ROUTINE_TITLE_REQUIRED");
      if (input.taskTemplates.length === 0) throw new Error("ROUTINE_TASKS_REQUIRED");

      return repository.createRoutine({
        workspaceId,
        areaId: input.areaId ?? null,
        title,
        status: "active",
        ...normalizedRoutineFields(input),
        createdByProfileId: actorProfileId,
        taskTemplates: buildTemplates(
          workspaceId,
          "__routine__",
          input.taskTemplates.map(({ id: _id, ...template }) => template)
        )
      });
    },

    async updateRoutine(workspaceId: string, routineId: string, input: UpdateRoutineInput): Promise<CompanyRoutine> {
      const routine = await readRoutineOrThrow(repository, workspaceId, routineId);
      const title = requiredText(input.title, "ROUTINE_TITLE_REQUIRED");

      return repository.updateRoutine({
        ...routine,
        title,
        areaId: input.areaId ?? null,
        ...normalizedRoutineFields(input),
        taskTemplates: buildTemplates(workspaceId, routine.id, input.taskTemplates, routine.taskTemplates)
      });
    },

    async archiveRoutine(workspaceId: string, routineId: string): Promise<CompanyRoutine> {
      const routine = await readRoutineOrThrow(repository, workspaceId, routineId);
      return repository.updateRoutine({
        ...routine,
        status: "archived"
      });
    },

    async deleteRoutine(workspaceId: string, routineId: string): Promise<CompanyRoutine> {
      const routine = await readRoutineOrThrow(repository, workspaceId, routineId);
      await repository.deleteRoutine(workspaceId, routineId);
      return routine;
    },

    async generateRoutineOccurrences(workspaceId: string, routineId: string, dueDate: string): Promise<TaskOccurrence[]> {
      const routine = await readRoutineOrThrow(repository, workspaceId, routineId);
      return createOrReuseRoutineOccurrences(repository, routine, dueDate);
    },

    async listTodayTasks(workspaceId: string, dueDate: string) {
      await ensureTodayOccurrences(repository, workspaceId, dueDate);
      return repository.listTaskOccurrences(workspaceId, { dueDate });
    },

    async getTask(workspaceId: string, taskId: string): Promise<TaskOccurrence> {
      return readTaskOrThrow(repository, workspaceId, taskId);
    },

    async createManualTask(
      workspaceId: string,
      actorProfileId: string,
      input: CreateManualTaskInput
    ): Promise<TaskOccurrence> {
      return repository.createTaskOccurrence({
        workspaceId,
        origin: "manual",
        routineId: null,
        taskTemplateId: null,
        title: requiredText(input.title, "TASK_TITLE_REQUIRED"),
        areaId: input.areaId ?? null,
        processId: null,
        assigneeProfileId: input.assigneeProfileId ?? actorProfileId,
        dueHint: optionalText(input.dueHint),
        approvalMode: input.approvalMode ?? "direct",
        evidencePolicy: input.evidencePolicy ?? "optional",
        checklistItems: normalizedChecklistItems(input.checklistItems),
        status: "pending",
        dueDate: requiredText(input.dueDate, "TASK_DUE_DATE_REQUIRED"),
        evidence: null,
        submittedByProfileId: null,
        submittedAt: null,
        reviewedByProfileId: null,
        reviewedAt: null,
        reviewComment: null
      });
    },

    async listApprovalTasks(workspaceId: string): Promise<TaskOccurrence[]> {
      const tasks = await repository.listTaskOccurrences(workspaceId);
      return tasks.filter((task) => task.status === "awaiting_approval");
    },

    async updateManualTask(workspaceId: string, taskId: string, input: UpdateManualTaskInput): Promise<TaskOccurrence> {
      const task = await readTaskOrThrow(repository, workspaceId, taskId);
      if (task.origin !== "manual" && task.routineId) throw new Error("TASK_NOT_MANUAL");
      requirePendingTask(task);

      return repository.updateTaskOccurrence({
        ...task,
        origin: "manual",
        routineId: null,
        taskTemplateId: null,
        title: requiredText(input.title, "TASK_TITLE_REQUIRED"),
        areaId: input.areaId ?? null,
        assigneeProfileId: input.assigneeProfileId ?? task.assigneeProfileId,
        dueDate: requiredText(input.dueDate, "TASK_DUE_DATE_REQUIRED"),
        dueHint: optionalText(input.dueHint),
        approvalMode: input.approvalMode ?? "direct",
        evidencePolicy: input.evidencePolicy ?? "optional",
        checklistItems: normalizedChecklistItems(input.checklistItems, task.checklistItems)
      });
    },

    async updateTaskChecklist(
      workspaceId: string,
      taskId: string,
      actorProfileId: string,
      input: { checklistItems: TaskChecklistItem[] },
      options: { allowAssigneeOverride?: boolean } = {}
    ): Promise<TaskOccurrence> {
      const task = await readTaskOrThrow(repository, workspaceId, taskId);
      requirePendingTask(task);
      if (task.assigneeProfileId && task.assigneeProfileId !== actorProfileId && !options.allowAssigneeOverride) {
        throw new Error("TASK_NOT_ASSIGNED_TO_PROFILE");
      }

      return repository.updateTaskOccurrence({
        ...task,
        checklistItems: normalizedChecklistState(input.checklistItems)
      });
    },

    async deleteTask(workspaceId: string, taskId: string): Promise<TaskOccurrence> {
      const task = await readTaskOrThrow(repository, workspaceId, taskId);
      if (!isMutableRoutineOccurrence(task) || !(await repository.deleteTaskOccurrence(workspaceId, taskId))) {
        throw new Error("TASK_NOT_PENDING");
      }
      return task;
    },

    async submitTask(
      workspaceId: string,
      taskId: string,
      actorProfileId: string,
      input: SubmitTaskInput,
      options: { allowAssigneeOverride?: boolean } = {}
    ): Promise<TaskOccurrence> {
      const task = await readTaskOrThrow(repository, workspaceId, taskId);
      if (!canSubmitTask(task.status)) throw new Error("TASK_CANNOT_BE_SUBMITTED");
      if (task.assigneeProfileId && task.assigneeProfileId !== actorProfileId && !options.allowAssigneeOverride) {
        throw new Error("TASK_NOT_ASSIGNED_TO_PROFILE");
      }

      const evidence = normalizeEvidence(input);
      if (!hasRequiredEvidence(task.evidencePolicy, evidence)) throw new Error("TASK_EVIDENCE_REQUIRED");

      return repository.updateTaskOccurrence({
        ...task,
        evidence,
        submittedByProfileId: actorProfileId,
        submittedAt: new Date().toISOString(),
        reviewedByProfileId: null,
        reviewedAt: null,
        reviewComment: null,
        status: readNextTaskStatus({
          approvalMode: task.approvalMode,
          hasRequiredEvidence: true
        })
      });
    },

    async approveTask(workspaceId: string, taskId: string, reviewerProfileId: string): Promise<TaskOccurrence> {
      const task = await readTaskOrThrow(repository, workspaceId, taskId);
      if (task.status !== "awaiting_approval") throw new Error("TASK_NOT_AWAITING_APPROVAL");

      return repository.updateTaskOccurrence({
        ...task,
        status: "completed",
        reviewedByProfileId: reviewerProfileId,
        reviewedAt: new Date().toISOString(),
        reviewComment: null
      });
    },

    async returnTask(
      workspaceId: string,
      taskId: string,
      reviewerProfileId: string,
      input: { comment?: string | null }
    ): Promise<TaskOccurrence> {
      const task = await readTaskOrThrow(repository, workspaceId, taskId);
      if (task.status !== "awaiting_approval") throw new Error("TASK_NOT_AWAITING_APPROVAL");

      return repository.updateTaskOccurrence({
        ...task,
        status: "needs_adjustment",
        reviewedByProfileId: reviewerProfileId,
        reviewedAt: new Date().toISOString(),
        reviewComment: optionalText(input.comment)
      });
    }
  };
}

async function readRoutineOrThrow(repository: RoutineRepository, workspaceId: string, routineId: string) {
  const routine = await repository.findRoutine(workspaceId, routineId);
  if (!routine) throw new Error("ROUTINE_NOT_FOUND");
  return routine;
}

async function readTaskOrThrow(repository: RoutineRepository, workspaceId: string, taskId: string) {
  const task = await repository.findTaskOccurrence(workspaceId, taskId);
  if (!task) throw new Error("TASK_NOT_FOUND");
  return task;
}
