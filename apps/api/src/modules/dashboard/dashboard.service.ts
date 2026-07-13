import type { BaaseRole, TaskStatus } from "@prymeira/baase-shared";
import type { CompanyRepository, TeamMember } from "../company/company.types";
import { canManageAreaResource, canReadAreaResource, canReadTask } from "../company/access-policy";
import type { OperationalMembership } from "../company/company.types";
import type { ProcessRepository } from "../processes/process.types";
import type { CompanyRoutine, RoutineRepository, TaskOccurrence } from "../routines/routine.types";
import type { TrainingAssignment, TrainingRepository } from "../trainings/training.types";
import type { AnnouncementRepository } from "../announcements/announcement.types";
import type { DashboardAreaMetric, DashboardAttentionItem, DashboardSummary, OperationalMetricItem, OperationalOverview, OperationalTrend } from "./dashboard.types";
import { ApiError, forbiddenError } from "../../http/api-error";

type DashboardRepositories = {
  companyRepository: CompanyRepository;
  processRepository: ProcessRepository;
  routineRepository: RoutineRepository;
  trainingRepository: TrainingRepository;
  announcementRepository: AnnouncementRepository;
};

type DashboardInput = {
  workspaceId: string;
  profileId: string;
  role: BaaseRole;
  membership: OperationalMembership;
  date: string;
};

type OperationalOverviewInput = Pick<DashboardInput, "workspaceId" | "membership"> & {
  from: string;
  to: string;
};

type PersonOperationalOverviewInput = OperationalOverviewInput & {
  profileId: string;
};

type DashboardServiceOptions = {
  now?: () => Date;
};

const executedStatuses = new Set<TaskStatus>(["completed", "awaiting_approval"]);

export function createDashboardService(repositories: DashboardRepositories, options: DashboardServiceOptions = {}) {
  const now = options.now ?? (() => new Date());

  const service: {
    readDashboard(input: DashboardInput): Promise<DashboardSummary>;
    readOperationalOverview(input: OperationalOverviewInput): Promise<OperationalOverview>;
    readPersonOperationalOverview(input: PersonOperationalOverviewInput): Promise<OperationalOverview>;
  } = {
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

      const visibleRoutines = routines.filter((routine) => canReadAreaResource(input.membership, routine.areaId));
      const routineById = new Map(visibleRoutines.map((routine) => [routine.id, routine]));
      const visibleProcesses = processes.filter((process) => canReadAreaResource(input.membership, process.areaId));
      const visibleTasks = tasks.filter((task) => canReadTask(input.membership, {
        assigneeProfileId: task.assigneeProfileId,
        areaId: task.areaId ?? (task.routineId ? routineById.get(task.routineId)?.areaId ?? null : null)
      }));
      const todayTasks = visibleTasks.filter((task) => task.dueDate === input.date);
      const todayCompleted = todayTasks.filter(isExecutedTask).length;
      const lateTasks = visibleTasks.filter((task) => isLateTask(task, input.date));
      const awaitingApproval = visibleTasks.filter((task) => task.status === "awaiting_approval");
      const pendingTrainingAssignments = countPendingTrainingAssignments({
        assignments,
        people,
        publishedTrainingIds: new Set(trainings.filter((training) => training.status === "published").map((training) => training.id)),
        passingAttemptKeys: new Set(attempts.filter((attempt) => attempt.passed).map((attempt) => `${attempt.trainingId}:${attempt.profileId}`))
      });
      const incompleteProcesses = visibleProcesses.filter((process) => process.status !== "published" && process.status !== "archived");
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
    },

    async readOperationalOverview(input: OperationalOverviewInput): Promise<OperationalOverview> {
      const [areas, people, routines, tasks, announcements, receipts] = await Promise.all([
        repositories.companyRepository.listAreas(input.workspaceId),
        repositories.companyRepository.listTeamMembers(input.workspaceId),
        repositories.routineRepository.listRoutines(input.workspaceId),
        repositories.routineRepository.listTaskOccurrences(input.workspaceId),
        repositories.announcementRepository.listAnnouncements(input.workspaceId),
        repositories.announcementRepository.listAnnouncementReceipts(input.workspaceId)
      ]);
      const routineById = new Map(routines.map((routine) => [routine.id, routine]));
      const areaNames = new Map(areas.map((area) => [area.id, area.name]));
      const peopleById = new Map(people.map((person) => [person.id, person]));
      const visiblePeople = people.filter((person) => canManageAreaResource(input.membership, person.areaId));
      const visiblePeopleById = new Map(visiblePeople.map((person) => [person.id, person]));
      const visibleTasks = tasks.filter((task) => canManageAreaResource(input.membership, taskAreaId(task, routineById)));
      const periodTasks = visibleTasks.filter((task) => isWithinPeriod(task.dueDate, input));
      const completedTasksInPeriod = visibleTasks.filter((task) => task.status === "completed" && isWithinPeriod(completionDate(task), input));
      const decisionsInPeriod = visibleTasks.filter((task) => task.reviewedAt && isWithinPeriod(operationalDate(task.reviewedAt), input));
      const trendTasks = [...new Map([...periodTasks, ...completedTasksInPeriod, ...decisionsInPeriod].map((task) => [task.id, task])).values()];
      const today = operationalToday(now());
      const lateTasks = periodTasks
        .filter((task) => task.dueDate < today && task.status !== "completed")
        .map((task) => operationalTaskItem(task, peopleById, routineById, areaNames, today));
      const awaitingApprovals = periodTasks
        .filter((task) => task.status === "awaiting_approval")
        .map((task) => operationalTaskItem(task, peopleById, routineById, areaNames, today));
      const receiptsByAnnouncementAndProfile = new Map(receipts.map((receipt) => [`${receipt.announcementId}:${receipt.profileId}`, receipt]));
      const pendingRequiredAnnouncements = announcements
        .filter((announcement) => announcement.status === "published")
        .filter((announcement) => announcement.requirement === "read_confirmation" || announcement.requirement === "quiz_confirmation")
        .filter((announcement) => !announcement.publishedAt || announcement.publishedAt.slice(0, 10) <= input.to)
        .flatMap((announcement) => visiblePeople
          .filter((person) => announcementAudienceMatchesPerson(announcement.audience, person))
          .filter((person) => {
            const receipt = receiptsByAnnouncementAndProfile.get(`${announcement.id}:${person.id}`);
            return receipt?.status !== "confirmed" && receipt?.status !== "quiz_completed";
          })
          .map((person): OperationalMetricItem => ({
            id: announcement.id,
            profileId: person.id,
            profileName: person.name,
            areaId: person.areaId,
            areaName: person.areaId ? areaNames.get(person.areaId) ?? person.areaId : "Sem área",
            title: announcement.title,
            publishedAt: announcement.publishedAt
          }))
        );

      return {
        from: input.from,
        to: input.to,
        metrics: {
          lateTasks: lateTasks.length,
          awaitingApprovals: awaitingApprovals.length,
          pendingRequiredAnnouncements: pendingRequiredAnnouncements.length
        },
        lateTasks,
        awaitingApprovals,
        pendingRequiredAnnouncements,
        trends: {
          people: buildOperationalTrends(trendTasks, peopleById, routineById, areaNames, "person", input),
          areas: buildOperationalTrends(trendTasks, visiblePeopleById, routineById, areaNames, "area", input)
        }
      };
    },

    async readPersonOperationalOverview(input: PersonOperationalOverviewInput): Promise<OperationalOverview> {
      const person = await repositories.companyRepository.findTeamMember(input.workspaceId, input.profileId);
      if (!person) throw new ApiError(404, "TEAM_MEMBER_NOT_FOUND", "Pessoa não encontrada.");
      if (!canManageAreaResource(input.membership, person.areaId)) throw forbiddenError();

      const overview = await service.readOperationalOverview(input);
      const lateTasks = overview.lateTasks.filter((task) => task.profileId === person.id);
      const awaitingApprovals = overview.awaitingApprovals.filter((task) => task.profileId === person.id);
      const pendingRequiredAnnouncements = overview.pendingRequiredAnnouncements.filter((announcement) => announcement.profileId === person.id);

      return {
        ...overview,
        metrics: {
          lateTasks: lateTasks.length,
          awaitingApprovals: awaitingApprovals.length,
          pendingRequiredAnnouncements: pendingRequiredAnnouncements.length
        },
        lateTasks,
        awaitingApprovals,
        pendingRequiredAnnouncements,
        trends: {
          people: overview.trends.people.filter((trend) => trend.profileId === person.id),
          areas: overview.trends.areas.filter((trend) => trend.areaId === person.areaId)
        }
      };
    }
  };

  return service;
}

function taskAreaId(task: TaskOccurrence, routineById: Map<string, CompanyRoutine>) {
  return task.areaId ?? (task.routineId ? routineById.get(task.routineId)?.areaId ?? null : null);
}

function operationalTaskItem(
  task: TaskOccurrence,
  peopleById: Map<string, TeamMember>,
  routineById: Map<string, CompanyRoutine>,
  areaNames: Map<string, string>,
  today: string
): OperationalMetricItem {
  const areaId = taskAreaId(task, routineById);
  const person = task.assigneeProfileId ? peopleById.get(task.assigneeProfileId) : null;
  return {
    id: task.id,
    profileId: task.assigneeProfileId,
    assigneeProfileId: task.assigneeProfileId,
    profileName: person?.name ?? null,
    areaId,
    areaName: areaId ? areaNames.get(areaId) ?? areaId : "Sem área",
    title: task.title,
    dueDate: task.dueDate,
    submittedAt: task.submittedAt,
    reviewedAt: task.reviewedAt,
    ...(task.dueDate < today && task.status !== "completed" ? { daysLate: daysBetween(task.dueDate, today) } : {})
  };
}

function isWithinPeriod(date: string, period: Pick<OperationalOverviewInput, "from" | "to">) {
  return date >= period.from && date <= period.to;
}

function daysBetween(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

function operationalToday(now: Date) {
  return operationalDate(now);
}

function operationalDate(date: string | Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(typeof date === "string" ? new Date(date) : date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function announcementAudienceMatchesPerson(
  audience: import("../announcements/announcement.types").AnnouncementAudience,
  person: TeamMember
) {
  if (audience.type === "all") return true;
  if (audience.type === "person") return audience.profileId === person.id;
  if (audience.type === "area") return audience.areaId === person.areaId;
  return audience.roleTemplateId === person.roleTemplateId;
}

function buildOperationalTrends(
  tasks: TaskOccurrence[],
  peopleById: Map<string, TeamMember>,
  routinesById: Map<string, CompanyRoutine>,
  areaNames: Map<string, string>,
  grouping: "person" | "area",
  period: Pick<OperationalOverviewInput, "from" | "to">
): OperationalTrend[] {
  const groups = new Map<string, { tasks: TaskOccurrence[]; profile?: TeamMember; areaId: string | null }>();
  for (const task of tasks) {
    const areaId = taskAreaId(task, routinesById);
    const profile = task.assigneeProfileId ? peopleById.get(task.assigneeProfileId) : undefined;
    const key = grouping === "person" ? task.assigneeProfileId ?? "__unassigned__" : areaId ?? "__none__";
    const current = groups.get(key) ?? { tasks: [], profile, areaId };
    current.tasks.push(task);
    groups.set(key, current);
  }
  return [...groups.values()].map(({ tasks: groupTasks, profile, areaId }) => ({
    ...(grouping === "person" && profile ? { profileId: profile.id, profileName: profile.name } : {}),
    areaId: grouping === "person" ? profile?.areaId ?? areaId : areaId,
    areaName: areaId ? areaNames.get(areaId) ?? areaId : "Sem área",
    completionOnTimeRate: completionOnTimeRate(groupTasks, period),
    averageApprovalDurationHours: averageApprovalDurationHours(groupTasks, period)
  })).sort((left, right) => (left.profileName ?? left.areaName).localeCompare(right.profileName ?? right.areaName, "pt-BR"));
}

function completionOnTimeRate(tasks: TaskOccurrence[], period: Pick<OperationalOverviewInput, "from" | "to">) {
  const completed = tasks.filter((task) => task.status === "completed" && Boolean(task.dueDate) && isWithinPeriod(completionDate(task), period));
  if (!completed.length) return null;
  const onTime = completed.filter((task) => completionDate(task) <= task.dueDate).length;
  return Math.round((onTime / completed.length) * 100);
}

function completionDate(task: TaskOccurrence) {
  return operationalDate(task.reviewedAt ?? task.submittedAt ?? task.updatedAt);
}

function averageApprovalDurationHours(tasks: TaskOccurrence[], period: Pick<OperationalOverviewInput, "from" | "to">) {
  const durations = tasks.flatMap((task) => {
    if (!task.submittedAt || !task.reviewedAt || !isWithinPeriod(operationalDate(task.reviewedAt), period)) return [];
    return [(Date.parse(task.reviewedAt) - Date.parse(task.submittedAt)) / 3_600_000];
  });
  if (!durations.length) return null;
  return Math.round((durations.reduce((total, duration) => total + duration, 0) / durations.length) * 100) / 100;
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
