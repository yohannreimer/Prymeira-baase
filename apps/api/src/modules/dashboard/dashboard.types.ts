import type { BaaseRole } from "@prymeira/baase-shared";

export type DashboardMetricSummary = {
  todayTotal: number;
  todayCompleted: number;
  executionRate: number;
  lateTasks: number;
  awaitingApproval: number;
  pendingTrainingAssignments: number;
  incompleteProcesses: number;
};

export type DashboardAreaMetric = {
  areaId: string | null;
  name: string;
  total: number;
  completed: number;
  awaitingApproval: number;
  late: number;
  completionRate: number;
};

export type DashboardAttentionItem = {
  id: string;
  title: string;
  subtitle: string;
  tag: string;
  tone: "danger" | "warn" | "info" | "accent";
  icon: string;
  targetScreen: "rotinas" | "treinamentos" | "processos" | "painel-gestor" | "hoje";
};

export type EmployeeTodaySummary = {
  total: number;
  completed: number;
  pending: number;
  awaitingApproval: number;
  late: number;
  pendingTrainings: number;
};

export type DashboardSummary = {
  date: string;
  role: BaaseRole;
  metrics: DashboardMetricSummary;
  areaMetrics: DashboardAreaMetric[];
  attentionItems: DashboardAttentionItem[];
  employeeToday: EmployeeTodaySummary;
};

export type OperationalMetricItem = {
  id: string;
  profileId: string | null;
  assigneeProfileId?: string | null;
  profileName: string | null;
  areaId: string | null;
  areaName: string;
  title: string;
  status?: string;
  dueDate?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  publishedAt?: string | null;
  daysLate?: number;
};

export type OperationalTrend = {
  profileId?: string;
  profileName?: string;
  areaId: string | null;
  areaName: string;
  completionOnTimeRate: number | null;
  averageApprovalDurationHours: number | null;
};

export type OperationalOverview = {
  from: string;
  to: string;
  metrics: {
    lateTasks: number;
    awaitingApprovals: number;
    pendingRequiredAnnouncements: number;
  };
  lateTasks: OperationalMetricItem[];
  openTasks: OperationalMetricItem[];
  awaitingApprovals: OperationalMetricItem[];
  pendingRequiredAnnouncements: OperationalMetricItem[];
  trends: {
    people: OperationalTrend[];
    areas: OperationalTrend[];
  };
};
