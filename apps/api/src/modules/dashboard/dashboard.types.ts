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

