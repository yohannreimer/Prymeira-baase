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
        id: `task_${tasks.length + 1}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      tasks.push(task);
      return task;
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
      if (index >= 0) tasks.splice(index, 1);
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

function nextTimestamp(candidate: string, previous: string) {
  if (new Date(candidate).getTime() > new Date(previous).getTime()) return candidate;
  return new Date(new Date(previous).getTime() + 1).toISOString();
}
