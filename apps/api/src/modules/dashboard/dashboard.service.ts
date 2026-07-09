import type { BaaseRole, TaskStatus } from "@prymeira/baase-shared";
import type { CompanyRepository, TeamMember } from "../company/company.types";
import type { ProcessRepository } from "../processes/process.types";
import type { CompanyRoutine, RoutineRepository, TaskOccurrence } from "../routines/routine.types";
import type { TrainingAssignment, TrainingRepository } from "../trainings/training.types";
import type { DashboardAreaMetric, DashboardAttentionItem, DashboardSummary } from "./dashboard.types";

type DashboardRepositories = {
  companyRepository: CompanyRepository;
  processRepository: ProcessRepository;
  routineRepository: RoutineRepository;
  trainingRepository: TrainingRepository;
};

type DashboardInput = {
  workspaceId: string;
  profileId: string;
  role: BaaseRole;
  date: string;
};

const executedStatuses = new Set<TaskStatus>(["completed", "awaiting_approval"]);

export function createDashboardService(repositories: DashboardRepositories) {
  return {
    async readDashboard(input: DashboardInput): Promise<DashboardSummary> {
      const [areas, people, processes, routines, trainings, assignments, attempts, tasks] = await Promise.all([
        repositories.companyRepository.listAreas(input.workspaceId),
        repositories.companyRepository.listTeamMembers(input.workspaceId),
        repositories.processRepository.listProcesses(input.workspaceId),
        repositories.routineRepository.listRoutines(input.workspaceId),
        repositories.trainingRepository.listTrainings(input.workspaceId),
        repositories.trainingRepository.listTrainingAssignments(input.workspaceId),
        repositories.trainingRepository.listQuizAttempts(input.workspaceId),
        repositories.routineRepository.listTaskOccurrences(input.workspaceId)
      ]);

      const routineById = new Map(routines.map((routine) => [routine.id, routine]));
      const todayTasks = tasks.filter((task) => task.dueDate === input.date);
      const todayCompleted = todayTasks.filter(isExecutedTask).length;
      const lateTasks = tasks.filter((task) => isLateTask(task, input.date));
      const awaitingApproval = tasks.filter((task) => task.status === "awaiting_approval");
      const pendingTrainingAssignments = countPendingTrainingAssignments({
        assignments,
        people,
        publishedTrainingIds: new Set(trainings.filter((training) => training.status === "published").map((training) => training.id)),
        passingAttemptKeys: new Set(attempts.filter((attempt) => attempt.passed).map((attempt) => `${attempt.trainingId}:${attempt.profileId}`))
      });
      const incompleteProcesses = processes.filter((process) => process.status !== "published" && process.status !== "archived");
      const employeeTasks = todayTasks.filter((task) => task.assigneeProfileId === input.profileId || !task.assigneeProfileId);
      const employeeCompleted = employeeTasks.filter(isExecutedTask).length;
      const areaMetrics = buildAreaMetrics(todayTasks, routineById, new Map(areas.map((area) => [area.id, area.name])), input.date);
      const metrics = {
        todayTotal: todayTasks.length,
        todayCompleted,
        executionRate: percentage(todayCompleted, todayTasks.length),
        lateTasks: lateTasks.length,
        awaitingApproval: awaitingApproval.length,
        pendingTrainingAssignments,
        incompleteProcesses: incompleteProcesses.length
      };

      return {
        date: input.date,
        role: input.role,
        metrics,
        areaMetrics,
        attentionItems: buildAttentionItems({
          lateTasks,
          awaitingApproval,
          pendingTrainingAssignments,
          incompleteProcesses
        }),
        employeeToday: {
          total: employeeTasks.length,
          completed: employeeCompleted,
          pending: employeeTasks.filter((task) => task.status === "pending" || task.status === "in_progress" || task.status === "needs_adjustment").length,
          awaitingApproval: employeeTasks.filter((task) => task.status === "awaiting_approval").length,
          late: employeeTasks.filter((task) => isLateTask(task, input.date)).length,
          pendingTrainings: pendingTrainingAssignments
        }
      };
    }
  };
}

function isExecutedTask(task: TaskOccurrence) {
  return executedStatuses.has(task.status);
}

function isLateTask(task: TaskOccurrence, date: string) {
  if (task.status === "late") return true;
  if (isExecutedTask(task) || task.status === "dismissed") return false;
  return task.dueDate < date;
}

function percentage(completed: number, total: number) {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

function areaNameForTask(task: TaskOccurrence, routineById: Map<string, CompanyRoutine>, areaNames: Map<string, string>) {
  const areaId = task.areaId ?? (task.routineId ? routineById.get(task.routineId)?.areaId : null) ?? null;
  if (!areaId) return { areaId: null, name: "Sem área" };
  return { areaId, name: areaNames.get(areaId) ?? areaId };
}

function buildAreaMetrics(
  tasks: TaskOccurrence[],
  routineById: Map<string, CompanyRoutine>,
  areaNames: Map<string, string>,
  date: string
): DashboardAreaMetric[] {
  const byArea = new Map<string, DashboardAreaMetric>();

  for (const task of tasks) {
    const area = areaNameForTask(task, routineById, areaNames);
    const key = area.areaId ?? "__none__";
    const current = byArea.get(key) ?? {
      areaId: area.areaId,
      name: area.name,
      total: 0,
      completed: 0,
      awaitingApproval: 0,
      late: 0,
      completionRate: 0
    };

    current.total += 1;
    current.completed += isExecutedTask(task) ? 1 : 0;
    current.awaitingApproval += task.status === "awaiting_approval" ? 1 : 0;
    current.late += isLateTask(task, date) ? 1 : 0;
    current.completionRate = percentage(current.completed, current.total);
    byArea.set(key, current);
  }

  return [...byArea.values()].sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, "pt-BR"));
}

function countPendingTrainingAssignments(input: {
  assignments: TrainingAssignment[];
  people: TeamMember[];
  publishedTrainingIds: Set<string>;
  passingAttemptKeys: Set<string>;
}) {
  return input.assignments
    .filter((assignment) => input.publishedTrainingIds.has(assignment.trainingId))
    .reduce((total, assignment) => {
      const profileIds = profileIdsForAudience(assignment, input.people);
      if (profileIds.length === 0) {
        return total + (hasAnyPassingAttemptForTraining(assignment.trainingId, input.passingAttemptKeys) ? 0 : 1);
      }
      return total + profileIds.filter((profileId) => !input.passingAttemptKeys.has(`${assignment.trainingId}:${profileId}`)).length;
    }, 0);
}

function profileIdsForAudience(assignment: TrainingAssignment, people: TeamMember[]) {
  const audience = assignment.audience;
  if (audience.type === "person") return [audience.profileId];
  if (audience.type === "all") return people.map((person) => person.id);
  if (audience.type === "area") {
    return people.filter((person) => person.areaId === audience.areaId).map((person) => person.id);
  }
  return people.filter((person) => person.roleTemplateId === audience.roleTemplateId).map((person) => person.id);
}

function hasAnyPassingAttemptForTraining(trainingId: string, passingAttemptKeys: Set<string>) {
  return [...passingAttemptKeys].some((key) => key.startsWith(`${trainingId}:`));
}

function buildAttentionItems(input: {
  lateTasks: TaskOccurrence[];
  awaitingApproval: TaskOccurrence[];
  pendingTrainingAssignments: number;
  incompleteProcesses: Array<{ id: string; title: string }>;
}): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [];

  if (input.lateTasks.length) {
    items.push({
      id: "late_tasks",
      title: `${input.lateTasks.length} tarefa(s) atrasada(s)`,
      subtitle: "Atrasos travam a rotina do funcionário e mostram gargalo operacional.",
      tag: "Atraso",
      tone: "danger",
      icon: "ph-clock-countdown",
      targetScreen: "rotinas"
    });
  }

  if (input.awaitingApproval.length) {
    items.push({
      id: "approval_backlog",
      title: `${input.awaitingApproval.length} tarefa(s) aguardando aprovação`,
      subtitle: "Evidências enviadas precisam de aprovação ou devolução.",
      tag: "Aprovar",
      tone: "warn",
      icon: "ph-seal-check",
      targetScreen: "painel-gestor"
    });
  }

  if (input.pendingTrainingAssignments > 0) {
    items.push({
      id: "pending_trainings",
      title: `${input.pendingTrainingAssignments} treinamento(s) pendente(s)`,
      subtitle: "Treinamentos pendentes deixam o padrão preso no dono ou gestor.",
      tag: "Treinar",
      tone: "warn",
      icon: "ph-graduation-cap",
      targetScreen: "treinamentos"
    });
  }

  for (const process of input.incompleteProcesses.slice(0, 3)) {
    items.push({
      id: `draft_process_${process.id}`,
      title: `Processo "${process.title}" incompleto`,
      subtitle: "Processos não publicados ainda não chegam à execução diária da equipe.",
      tag: "Revisar",
      tone: "info",
      icon: "ph-file-text",
      targetScreen: "processos"
    });
  }

  return items.slice(0, 8);
}
