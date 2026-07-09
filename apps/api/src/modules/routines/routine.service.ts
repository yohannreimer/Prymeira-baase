import { canSubmitTask, readNextTaskStatus } from "@prymeira/baase-shared";
import type {
  CompanyRoutine,
  CreateManualTaskInput,
  CreateRoutineInput,
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

const BUSINESS_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
const WEEKDAY_BY_DATE_INDEX: RoutineWeekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MUTABLE_OCCURRENCE_STATUSES = new Set<TaskOccurrence["status"]>(["pending", "in_progress", "needs_adjustment", "late"]);

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
  index: number,
  input: CreateRoutineInput["taskTemplates"][number]
): RoutineTaskTemplate {
  const sortOrder = index + 1;
  return {
    id: `template___routine___${sortOrder}`,
    routineId: "__routine__",
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

function attachRoutineId(routineId: string, template: RoutineTaskTemplate): RoutineTaskTemplate {
  return {
    ...template,
    id: template.id.replace("__routine__", routineId),
    routineId
  };
}

function buildTemplates(workspaceId: string, routineId: string, input: CreateRoutineInput["taskTemplates"]) {
  if (input.length === 0) throw new Error("ROUTINE_TASKS_REQUIRED");
  return input.map((template, index) => attachRoutineId(routineId, buildTemplate(workspaceId, index, template)));
}

function normalizedFrequency(input: CreateRoutineInput) {
  return input.frequency ?? "daily";
}

function normalizedWeekdays(input: CreateRoutineInput) {
  if (input.weekdays?.length) return [...new Set(input.weekdays)];
  return normalizedFrequency(input) === "daily" ? [...BUSINESS_WEEKDAYS] : [];
}

function normalizedExecutionMode(input: CreateRoutineInput) {
  if (input.executionMode) return input.executionMode;
  return uniqueOptionalTexts(input.assigneeProfileIds).length > 1 ? "individual" : "shared";
}

function normalizedRoutineFields(input: CreateRoutineInput) {
  return {
    frequency: normalizedFrequency(input),
    weekdays: normalizedWeekdays(input),
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

function isMutableOccurrence(task: TaskOccurrence) {
  return MUTABLE_OCCURRENCE_STATUSES.has(task.status);
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

function mergeOccurrenceTemplate(
  current: TaskOccurrence,
  next: Omit<TaskOccurrence, "id" | "createdAt" | "updatedAt">
): TaskOccurrence {
  return {
    ...current,
    origin: next.origin,
    routineId: next.routineId,
    taskTemplateId: next.taskTemplateId,
    title: next.title,
    areaId: next.areaId,
    processId: next.processId,
    assigneeProfileId: next.assigneeProfileId,
    dueHint: next.dueHint,
    approvalMode: next.approvalMode,
    evidencePolicy: next.evidencePolicy,
    checklistItems: next.checklistItems
      ? normalizedChecklistItems(next.checklistItems.map((item) => item.title), current.checklistItems)
      : undefined
  };
}

async function createOrReuseRoutineOccurrences(
  repository: RoutineRepository,
  routine: CompanyRoutine,
  dueDate: string
) {
  const generated: TaskOccurrence[] = [];
  for (const input of buildRoutineOccurrenceInputs(routine, dueDate)) {
    if (!input.taskTemplateId) continue;
    const existing = await repository.findTaskOccurrenceForTemplate(routine.workspaceId, routine.id, input.taskTemplateId, dueDate);
    if (existing) {
      generated.push(existing);
      continue;
    }

    generated.push(await repository.createTaskOccurrence(input));
  }

  return generated;
}

async function ensureTodayOccurrences(repository: RoutineRepository, workspaceId: string, dueDate: string) {
  const routines = await repository.listRoutines(workspaceId);
  for (const routine of routines.filter(shouldAutoGenerateRoutine)) {
    await createOrReuseRoutineOccurrences(repository, routine, dueDate);
  }
}

async function syncMutableRoutineOccurrences(repository: RoutineRepository, routine: CompanyRoutine) {
  const existingTasks = (await repository.listTaskOccurrences(routine.workspaceId))
    .filter((task) => task.routineId === routine.id);
  const dates = [...new Set(existingTasks.map((task) => task.dueDate))];

  for (const dueDate of dates) {
    const desiredInputs = buildRoutineOccurrenceInputs(routine, dueDate);
    const desiredByTemplateId = new Map(desiredInputs
      .filter((input) => input.taskTemplateId)
      .map((input) => [input.taskTemplateId as string, input]));
    const tasksForDate = existingTasks.filter((task) => task.dueDate === dueDate);

    for (const task of tasksForDate) {
      if (!isMutableOccurrence(task)) continue;
      const desired = task.taskTemplateId ? desiredByTemplateId.get(task.taskTemplateId) : null;
      if (!desired) {
        await repository.deleteTaskOccurrence(routine.workspaceId, task.id);
        continue;
      }
      await repository.updateTaskOccurrence(mergeOccurrenceTemplate(task, desired));
    }

    const taskByTemplateId = new Map(tasksForDate
      .filter((task) => task.taskTemplateId)
      .map((task) => [task.taskTemplateId as string, task]));
    for (const desired of desiredInputs) {
      if (!desired.taskTemplateId || taskByTemplateId.has(desired.taskTemplateId)) continue;
      await repository.createTaskOccurrence(desired);
    }
  }
}

export function createRoutineService(repository: RoutineRepository) {
  return {
    listRoutines(workspaceId: string) {
      return repository.listRoutines(workspaceId);
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
        taskTemplates: input.taskTemplates.map((template, index) => buildTemplate(workspaceId, index, template))
      });
    },

    async updateRoutine(workspaceId: string, routineId: string, input: UpdateRoutineInput): Promise<CompanyRoutine> {
      const routine = await readRoutineOrThrow(repository, workspaceId, routineId);
      const title = requiredText(input.title, "ROUTINE_TITLE_REQUIRED");

      const updatedRoutine = await repository.updateRoutine({
        ...routine,
        title,
        areaId: input.areaId ?? null,
        ...normalizedRoutineFields(input),
        taskTemplates: buildTemplates(workspaceId, routine.id, input.taskTemplates)
      });
      await syncMutableRoutineOccurrences(repository, updatedRoutine);
      return updatedRoutine;
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

    async listTodayTasks(workspaceId: string, profileId: string, dueDate: string) {
      await ensureTodayOccurrences(repository, workspaceId, dueDate);
      return repository.listTaskOccurrences(workspaceId, { dueDate, profileId });
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
      input: { checklistItems: TaskChecklistItem[] }
    ): Promise<TaskOccurrence> {
      const task = await readTaskOrThrow(repository, workspaceId, taskId);
      if (task.assigneeProfileId && task.assigneeProfileId !== actorProfileId) throw new Error("TASK_NOT_ASSIGNED_TO_PROFILE");

      return repository.updateTaskOccurrence({
        ...task,
        checklistItems: normalizedChecklistState(input.checklistItems)
      });
    },

    async deleteTask(workspaceId: string, taskId: string): Promise<TaskOccurrence> {
      const task = await readTaskOrThrow(repository, workspaceId, taskId);
      await repository.deleteTaskOccurrence(workspaceId, taskId);
      return task;
    },

    async submitTask(
      workspaceId: string,
      taskId: string,
      actorProfileId: string,
      input: SubmitTaskInput
    ): Promise<TaskOccurrence> {
      const task = await readTaskOrThrow(repository, workspaceId, taskId);
      if (!canSubmitTask(task.status)) throw new Error("TASK_CANNOT_BE_SUBMITTED");
      if (task.assigneeProfileId && task.assigneeProfileId !== actorProfileId) throw new Error("TASK_NOT_ASSIGNED_TO_PROFILE");

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
