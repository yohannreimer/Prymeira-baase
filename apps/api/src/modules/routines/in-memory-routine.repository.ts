import type { CompanyRoutine, RoutineRepository, TaskOccurrence } from "./routine.types";
import { normalizeRoutineRecurrence } from "./routine-recurrence";

type InMemoryRoutineRepositoryOptions = {
  now?: () => string;
  initialRoutines?: CompanyRoutine[];
  initialTasks?: TaskOccurrence[];
};

export function createInMemoryRoutineRepository(
  options: InMemoryRoutineRepositoryOptions = {}
): RoutineRepository {
  const routines: CompanyRoutine[] = [...(options.initialRoutines ?? [])];
  const tasks: TaskOccurrence[] = [...(options.initialTasks ?? [])];
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async listRoutines(workspaceId) {
      return routines.filter((routine) => routine.workspaceId === workspaceId);
    },

    async findRoutine(workspaceId, routineId) {
      return routines.find((routine) => routine.workspaceId === workspaceId && routine.id === routineId) ?? null;
    },

    async createRoutine(input) {
      const timestamp = now();
      const routineId = `routine_${routines.length + 1}`;
      const recurrence = normalizeRoutineRecurrence(input);
      const routine: CompanyRoutine = {
        ...input,
        ...recurrence,
        id: routineId,
        taskTemplates: input.taskTemplates.map((template) => ({
          ...template,
          id: template.id.replace("__routine__", routineId),
          routineId
        })),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      routines.push(routine);
      return routine;
    },

    async updateRoutine(routine) {
      const index = routines.findIndex((item) => item.workspaceId === routine.workspaceId && item.id === routine.id);
      if (index === -1) throw new Error("ROUTINE_NOT_FOUND");
      const recurrence = normalizeRoutineRecurrence(routine);
      const updated = {
        ...routine,
        ...recurrence,
        updatedAt: nextTimestamp(now(), routine.updatedAt)
      };
      routines[index] = updated;
      return updated;
    },

    async deleteRoutine(workspaceId, routineId) {
      const index = routines.findIndex((item) => item.workspaceId === workspaceId && item.id === routineId);
      if (index >= 0) routines.splice(index, 1);
      for (let taskIndex = tasks.length - 1; taskIndex >= 0; taskIndex -= 1) {
        const task = tasks[taskIndex];
        if (task?.workspaceId === workspaceId && task.routineId === routineId) tasks.splice(taskIndex, 1);
      }
    },

    async listTaskOccurrences(workspaceId, filters = {}) {
      return tasks.filter((task) => {
        if (task.workspaceId !== workspaceId) return false;
        if (filters.dueDate && task.dueDate !== filters.dueDate) return false;
        return true;
      });
    },

    async findTaskOccurrence(workspaceId, taskId) {
      return tasks.find((task) => task.workspaceId === workspaceId && task.id === taskId) ?? null;
    },

    async findTaskOccurrenceForTemplate(workspaceId, routineId, taskTemplateId, dueDate) {
      return (
        tasks.find(
          (task) =>
            task.workspaceId === workspaceId &&
            task.routineId === routineId &&
            task.taskTemplateId === taskTemplateId &&
            task.dueDate === dueDate
        ) ?? null
      );
    },

    async createTaskOccurrence(input) {
      const timestamp = now();
      const task: TaskOccurrence = {
        ...input,
        origin: input.origin ?? (input.routineId ? "routine" : "manual"),
        routineRevisionSnapshot: input.routineRevisionSnapshot ?? (input.routineId
          ? routines.find((routine) => routine.workspaceId === input.workspaceId && routine.id === input.routineId)?.updatedAt ?? null
          : null),
        id: `task_${tasks.length + 1}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      tasks.push(task);
      return task;
    },

    async reconcileRoutineOccurrences(routine, dueDate, desired) {
      const persistedRoutine = routines.find((item) => item.workspaceId === routine.workspaceId && item.id === routine.id);
      if (!persistedRoutine) throw new Error("ROUTINE_NOT_FOUND");
      if (persistedRoutine.updatedAt !== routine.updatedAt) throw new Error("ROUTINE_STALE");

      const existing = tasks.filter((task) => task.workspaceId === routine.workspaceId && task.routineId === routine.id && task.dueDate === dueDate);
      const existingByKey = new Map(existing.map((task) => [routineOccurrenceKey(task), task]));
      const desiredByKey = new Map(desired.map((task) => [routineOccurrenceKey(task), task]));
      const removedObjectKeys = new Set<string>();

      for (const [key, input] of desiredByKey) {
        const task = existingByKey.get(key);
        if (!task) {
          const timestamp = now();
          tasks.push({ ...input, routineRevisionSnapshot: input.routineRevisionSnapshot ?? routine.updatedAt, id: `task_${tasks.length + 1}`, createdAt: timestamp, updatedAt: timestamp });
          continue;
        }
        if (!isPending(task)) continue;
        const revisionChanged = task.routineRevisionSnapshot !== routine.updatedAt;
        const next: TaskOccurrence = {
          ...task,
          ...input,
          checklistItems: revisionChanged ? input.checklistItems : task.checklistItems,
          routineRevisionSnapshot: routine.updatedAt,
          id: task.id,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt
        };
        if (sameRoutineOccurrence(task, next)) continue;
        const index = tasks.indexOf(task);
        tasks[index] = {
          ...next,
          updatedAt: nextTimestamp(now(), task.updatedAt)
        };
        const previousObjectKey = task.evidence?.attachment?.objectKey;
        const nextObjectKey = next.evidence?.attachment?.objectKey;
        if (previousObjectKey && previousObjectKey !== nextObjectKey) removedObjectKeys.add(previousObjectKey);
      }

      for (const task of existing) {
        if (!desiredByKey.has(routineOccurrenceKey(task)) && isPending(task)) {
          tasks.splice(tasks.indexOf(task), 1);
          const objectKey = task.evidence?.attachment?.objectKey;
          if (objectKey) removedObjectKeys.add(objectKey);
        }
      }

      const activeObjectKeys = new Set(tasks.flatMap((task) => task.evidence?.attachment?.objectKey ? [task.evidence.attachment.objectKey] : []));
      return {
        tasks: tasks.filter((task) => task.workspaceId === routine.workspaceId && task.routineId === routine.id && task.dueDate === dueDate),
        removedObjectKeys: [...removedObjectKeys].filter((objectKey) => !activeObjectKeys.has(objectKey))
      };
    },

    async updateTaskOccurrence(task) {
      const index = tasks.findIndex((item) => item.workspaceId === task.workspaceId && item.id === task.id);
      if (index === -1) throw new Error("TASK_NOT_FOUND");
      const updated = {
        ...task,
        updatedAt: now()
      };
      tasks[index] = updated;
      return updated;
    },

    async deleteTaskOccurrence(workspaceId, taskId) {
      const index = tasks.findIndex((item) => item.workspaceId === workspaceId && item.id === taskId);
      if (index < 0 || !isPending(tasks[index]!)) return false;
      tasks.splice(index, 1);
      return true;
    },

    getLifecycleState() {
      return structuredClone({ routines, tasks });
    },

    commitLifecycleState(state) {
      routines.splice(0, routines.length, ...state.routines);
      tasks.splice(0, tasks.length, ...state.tasks);
    }
  };
}

function routineOccurrenceKey(task: Pick<TaskOccurrence, "routineId" | "taskTemplateId" | "assigneeProfileId">) {
  return `${task.taskTemplateId ?? `${task.routineId ?? "manual"}__shared`}__${task.assigneeProfileId ?? "shared"}`;
}

function isPending(task: TaskOccurrence) {
  return task.status === "pending" && task.submittedAt === null;
}

function sameRoutineOccurrence(left: TaskOccurrence, right: TaskOccurrence) {
  return left.origin === right.origin
    && left.routineId === right.routineId
    && left.taskTemplateId === right.taskTemplateId
    && left.title === right.title
    && left.areaNameSnapshot === right.areaNameSnapshot
    && left.routineTitleSnapshot === right.routineTitleSnapshot
    && left.stepTitleSnapshot === right.stepTitleSnapshot
    && left.routineRevisionSnapshot === right.routineRevisionSnapshot
    && left.areaId === right.areaId
    && left.processId === right.processId
    && left.assigneeProfileId === right.assigneeProfileId
    && left.dueHint === right.dueHint
    && left.approvalMode === right.approvalMode
    && left.evidencePolicy === right.evidencePolicy
    && left.status === right.status
    && left.dueDate === right.dueDate
    && JSON.stringify(left.checklistItems ?? []) === JSON.stringify(right.checklistItems ?? []);
}

function nextTimestamp(candidate: string, previous: string) {
  if (new Date(candidate).getTime() > new Date(previous).getTime()) return candidate;
  return new Date(new Date(previous).getTime() + 1).toISOString();
}
