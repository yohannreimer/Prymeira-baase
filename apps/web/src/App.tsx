import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { defaultProcessSopBody, formatProcessSopBody } from "@prymeira/baase-shared";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { createPublication, downloadPublication } from "./studio/publication-api";
import {
  archiveRoutine,
  approveTask,
  assignTraining,
  completeOnboardingSession,
  createOnboardingSession,
  confirmAnnouncement,
  createArea,
  archiveArea,
  getAreaImpact,
  createAnnouncementDraft,
  deleteArea,
  deleteAnnouncement,
  deleteInvite,
  deletePerson,
  deleteProcess,
  deleteRoleTemplate,
  deleteRoutine,
  deleteTask,
  createInvite,
  createPerson,
  createProcessDraft,
  createProcessVersion,
  updateProcess,
  uploadProcessMaterial,
  createRoutine,
  createRoleTemplate,
  createTask,
  createTrainingDraft,
  deleteTraining,
  blobToBase64,
  generateAiDraft,
  generateOnboardingDiagnosis,
  generateOnboardingSetup,
  generateOnboardingSuggestion,
  loadBaaseWorkspace,
  loadFirstRunState,
  readAnnouncements,
  readOperationalOverview,
  readPersonOperationalOverview,
  readTask,
  patchOnboardingSession,
  publishProcess,
  publishAnnouncement,
  publishTraining,
  returnTask,
  saveOnboardingSuggestionWorkspace,
  saveOnboardingFollowupAnswer,
  saveOnboardingReviewDecision,
  saveReviewWorkspace,
  skipOnboardingSession,
  submitTaskExecution,
  uploadTaskEvidence,
  submitTrainingQuizAttempt,
  transcribeAudioBlob,
  unpublishProcess,
  unpublishTraining,
  updateArea,
  updatePerson,
  updateRoutine,
  updateTask,
  updateTaskChecklist,
  updateTraining,
  useTemplate as useLibraryTemplate,
  type ApiProcess,
  type ApiArea,
  type ApiAreaImpact,
  type ApiInvite,
  type ApiPerson,
  type ApiQuizQuestionInput,
  type ApiProactiveSuggestion,
  type ApiRoleTemplate,
  type ApiRoutine,
  type ApiRoutineFrequency,
  type ApiRoutineInput,
  type ApiRoutineTaskTemplate,
  type ApiRoutineWeekday,
  type ApiTask,
  type ApiTaskInput,
  type ApiDashboard,
  type ApiOperationalOverview,
  type ApiOperationalMetricItem,
  type ApiTemplate,
  type ApiTemplateKind,
  type ApiAnnouncement,
  type ApiTrainingAssignment,
  type ApiTraining,
  type ApiTrainingAudience,
  type ApiTrainingMaterial,
  type ApiTrainingSource,
  type BaaseSession,
  type BaaseWorkspaceBundle,
  type AiGeneratedDraft,
  type AiDraftAttachmentInput,
  type OnboardingSuggestion,
  type OnboardingSession,
  type OnboardingSetupResult
} from "./api";
import { OnboardingShell, createEmptyOnboardingDraft, onboardingConversationQuestions, type OnboardingDraftState } from "./onboarding";
import { readBaaseAuthConfig } from "./auth-config";
import "./styles.css";

const StudioPage = lazy(() => import("./studio/StudioPage"));

type Role = "dono" | "gestor" | "func";
type Screen =
  | "painel-dono"
  | "painel-gestor"
  | "pessoa-operacional"
  | "hoje"
  | "estudio"
  | "mapa"
  | "equipe"
  | "processos"
  | "rotinas"
  | "treinamentos"
  | "comunicados"
  | "modelos"
  | "criar"
  | "onboarding"
  | "revisao";

type NavItem = {
  key: Screen;
  label: string;
  icon: string;
  badge?: string;
};

type NotificationItem = {
  title: string;
  meta: string;
  screen: Screen;
  tone: "warn" | "danger" | "info";
};

type AppProps = {
  initialRole?: Role;
  apiEnabled?: boolean;
};

type BootstrapStatus = "loading" | "ready" | "error";

type Identity = { name: string; initials: string; label: string };

type TodayTaskRow = {
  id: string;
  apiId?: string;
  origin?: ApiTask["origin"];
  routineId?: string | null;
  routineTitle?: string | null;
  label: string;
  meta: string;
  prio?: string;
  evid: boolean;
  done: boolean;
  status?: string;
  approvalMode?: string;
  evidencePolicy?: string;
  reviewComment?: string | null;
  areaId?: string | null;
  assigneeProfileId?: string | null;
  dueDate?: string;
  dueHint?: string | null;
  checklistItems?: NonNullable<ApiTask["checklistItems"]>;
  submitting?: boolean;
};

type RoutineFormInput = ApiRoutineInput & {
  id?: string;
  taskTemplates: ApiRoutineTaskTemplate[];
};

type TrainingFormInput = {
  id?: string;
  title: string;
  description: string;
  source: ApiTrainingSource;
  audience: ApiTrainingAudience | null;
  dueDate: string | null;
  materials: ApiTrainingMaterial[];
  quizQuestions: ApiQuizQuestionInput[];
  publish: boolean;
};

type AnnouncementFormInput = {
  title: string;
  body: string;
  type: ApiAnnouncement["type"];
  requirement: ApiAnnouncement["requirement"];
  audience: NonNullable<ApiAnnouncement["audience"]>;
  quizQuestions: ApiQuizQuestionInput[];
  publish: boolean;
};

type TaskFormInput = ApiTaskInput & { id?: string };

type CrudModal =
  | { kind: "task"; mode: "create" }
  | { kind: "task"; mode: "edit"; task: ApiTask }
  | { kind: "area"; mode: "create" }
  | { kind: "area"; mode: "edit"; area: ApiArea }
  | { kind: "role" }
  | { kind: "person"; mode: "create" }
  | { kind: "person"; mode: "edit"; person: ApiPerson }
  | { kind: "process"; mode: "create" }
  | { kind: "process"; mode: "edit"; process: ApiProcess }
  | { kind: "routine"; mode: "create" }
  | { kind: "routine"; mode: "edit"; routine: ApiRoutine }
  | { kind: "training"; mode: "create" }
  | { kind: "training"; mode: "edit"; training: ApiTraining }
  | { kind: "announcement"; mode: "create" }
  | { kind: "invite" };

type AreaArchiveDialogState = { area: AreaDisplayRow; impact: ApiAreaImpact };

type OnboardingAudioState = {
  status: "idle" | "recording" | "transcribing" | "ready" | "error";
  message?: string;
};

type TopPanel = "search" | "notifications" | null;
type CreateAiMode = "process" | "routine" | "training" | "announcement";
type CreateAiPreset = CreateAiMode | "audio_sop" | "pdf_training";
type CreateAiInputMode = "text" | "audio" | "pdf" | "mixed";
type TemplateFilterValue = "Todos";
type CreateAiAttachment = AiDraftAttachmentInput & { size: number };
type AiGenerationState = {
  mode: CreateAiMode;
  phase: "draft" | "content";
  message: string;
};

type BaaseTemplate = ApiTemplate;

const identities = {
  dono: { name: "Marina Alves", initials: "MA", label: "Dono" },
  gestor: { name: "Rafael Nunes", initials: "RN", label: "Gestor · Criação" },
  func: { name: "Bruno Costa", initials: "BC", label: "Funcionário · Criação" }
} satisfies Record<Role, Identity>;

const titles: Record<Screen, [string, string]> = {
  "painel-dono": ["Painel do Dono", "Visão geral"],
  "painel-gestor": ["Painel da Área", "Criação"],
  "pessoa-operacional": ["Visão da Pessoa", "Acompanhamento operacional"],
  hoje: ["Hoje", "Sua execução do dia"],
  estudio: ["Estúdio", "Espaço privado do dono"],
  mapa: ["Mapa da Empresa", "Estrutura organizacional"],
  equipe: ["Equipe", "Pessoas e convites"],
  processos: ["Processos / SOPs", "Manual vivo da empresa"],
  rotinas: ["Rotinas", "Execução recorrente"],
  treinamentos: ["Treinamentos", "Aprendizado da equipe"],
  comunicados: ["Comunicados", "Comunicação rastreável"],
  modelos: ["Biblioteca de Modelos", "Comece pronto"],
  criar: ["Criar com IA", "Geração operacional"],
  onboarding: ["Onboarding Inteligente", "Configuração inicial"],
  revisao: ["Revisão da empresa", "Sugerido pela IA"]
};

const navByRole: Record<Role, NavItem[]> = {
  dono: [
    { key: "painel-dono", label: "Painel", icon: "ph-squares-four" },
    { key: "hoje", label: "Hoje", icon: "ph-sun" },
    { key: "estudio", label: "Estúdio", icon: "ph-notebook" },
    { key: "mapa", label: "Mapa da Empresa", icon: "ph-tree-structure" },
    { key: "equipe", label: "Equipe", icon: "ph-users-three" },
    { key: "processos", label: "Processos", icon: "ph-file-text" },
    { key: "rotinas", label: "Rotinas", icon: "ph-arrows-clockwise" },
    { key: "treinamentos", label: "Treinamentos", icon: "ph-graduation-cap", badge: "1" },
    { key: "comunicados", label: "Comunicados", icon: "ph-megaphone", badge: "2" },
    { key: "modelos", label: "Modelos", icon: "ph-books" },
    { key: "criar", label: "Criar com IA", icon: "ph-sparkle" }
  ],
  gestor: [
    { key: "painel-gestor", label: "Painel da Área", icon: "ph-squares-four" },
    { key: "hoje", label: "Hoje", icon: "ph-sun" },
    { key: "equipe", label: "Equipe da área", icon: "ph-users-three" },
    { key: "processos", label: "Processos", icon: "ph-file-text" },
    { key: "rotinas", label: "Rotinas", icon: "ph-arrows-clockwise" },
    { key: "treinamentos", label: "Treinamentos", icon: "ph-graduation-cap", badge: "1" },
    { key: "comunicados", label: "Comunicados", icon: "ph-megaphone", badge: "2" }
  ],
  func: [
    { key: "hoje", label: "Hoje", icon: "ph-sun" },
    { key: "processos", label: "Processos", icon: "ph-file-text" },
    { key: "treinamentos", label: "Treinamentos", icon: "ph-graduation-cap", badge: "1" },
    { key: "comunicados", label: "Comunicados", icon: "ph-megaphone", badge: "2" }
  ]
};

type TeamDisplayRow = { id?: string; n: string; r: string; area: string; role: Role; ini: string };
type AreaRoleDisplayRow = { id?: string; name: string };
type AreaMemberDisplayRow = { name: string; role: string; roleId?: string };
const EMPTY_ROLE_LABEL = "Sem cargo definido";
const NO_ROLES_LABEL = "Nenhum cargo criado";
type AreaDisplayRow = {
  id?: string;
  name: string;
  description?: string | null;
  people: number;
  color: string;
  roles: AreaRoleDisplayRow[];
  cargos: string[];
  names: string[];
  members: AreaMemberDisplayRow[];
  gap?: boolean;
};

const people: TeamDisplayRow[] = [
  { n: "Marina Alves", r: "Fundadora", area: "Direção", role: "dono", ini: "MA" },
  { n: "Rafael Nunes", r: "Head de Operações", area: "Projetos", role: "gestor", ini: "RN" },
  { n: "Bruno Costa", r: "Designer", area: "Criação", role: "func", ini: "BC" },
  { n: "Carla Dias", r: "Social Media", area: "Criação", role: "func", ini: "CD" },
  { n: "Diego Melo", r: "Gestor de Tráfego", area: "Mídia", role: "func", ini: "DM" },
  { n: "Elisa Rocha", r: "Atendimento / CS", area: "Atendimento", role: "func", ini: "ER" },
  { n: "Felipe Souza", r: "Financeiro", area: "Financeiro", role: "func", ini: "FS" }
];

const areas: AreaDisplayRow[] = [
  { name: "Atendimento & CS", people: 1, color: "var(--accent)", roles: [{ name: "Atendimento / CS" }], cargos: ["Atendimento / CS"], names: ["Elisa Rocha"], members: [{ role: "Atendimento / CS", name: "Elisa Rocha" }] },
  { name: "Criação", people: 2, color: "var(--info-ink)", roles: [{ name: "Designer" }, { name: "Social Media" }], cargos: ["Designer", "Social Media"], names: ["Bruno Costa", "Carla Dias"], members: [{ role: "Designer", name: "Bruno Costa" }, { role: "Social Media", name: "Carla Dias" }] },
  { name: "Mídia & Tráfego", people: 1, color: "var(--warn-ink)", roles: [{ name: "Gestor de Tráfego" }], cargos: ["Gestor de Tráfego"], names: ["Diego Melo"], members: [{ role: "Gestor de Tráfego", name: "Diego Melo" }] },
  { name: "Financeiro", people: 1, color: "var(--danger-ink)", roles: [{ name: "Financeiro" }], cargos: ["Financeiro"], names: ["Felipe Souza"], members: [{ role: "Financeiro", name: "Felipe Souza" }], gap: true },
  { name: "Projetos / Operações", people: 1, color: "var(--accent)", roles: [{ name: "Head de Operações" }], cargos: ["Head de Operações"], names: ["Rafael Nunes"], members: [{ role: "Head de Operações", name: "Rafael Nunes" }] }
];

const defaultAiPrompt = "Criar um processo de aprovação de peças, do envio interno até o ok do cliente";

function aiPlaceholderForMode(mode: CreateAiMode) {
  if (mode === "routine") return "Criar uma rotina diária com checklist, responsável, prazo e evidência";
  if (mode === "training") return "Gerar um treinamento curto com aula, material de apoio e quiz";
  if (mode === "announcement") return "Escrever um comunicado claro para a equipe confirmar leitura";
  return defaultAiPrompt;
}

const baaseTemplates: BaaseTemplate[] = [
  {
    id: "process_client_onboarding",
    category: "Atendimento",
    kind: "process",
    segment: "marketing_agency",
    area: "Atendimento",
    title: "Onboarding de cliente novo",
    description: "Do fechamento ao kickoff, com checklist de assets e acessos.",
    tag: "12 etapas",
    icon: "ph-handshake",
    adaptPrompt: "Adapte este onboarding para ticket médio, serviços vendidos, canais de atendimento e SLA."
  },
  {
    id: "process_proposal_followup",
    category: "Vendas",
    kind: "process",
    segment: "marketing_agency",
    area: "Vendas",
    title: "Follow-up de proposta",
    description: "Cadência de contato após envio de proposta comercial.",
    tag: "5 etapas",
    icon: "ph-trend-up",
    adaptPrompt: "Adapte a cadência para ciclo de vendas, objeções comuns e canais preferidos."
  },
  {
    id: "routine_daily_social",
    category: "Operação",
    kind: "routine",
    segment: "marketing_agency",
    area: "Operação",
    title: "Abertura do dia — Social",
    description: "Checklist diário para o time de social media.",
    tag: "Diária",
    icon: "ph-sun",
    adaptPrompt: "Adapte esta rotina para quantidade de clientes, canais e horários de publicação."
  },
  {
    id: "routine_finance_reconciliation",
    category: "Financeiro",
    kind: "routine",
    segment: "general_ops",
    area: "Financeiro",
    title: "Conciliação semanal",
    description: "Fechamento e conferência de entradas e saídas.",
    tag: "Semanal",
    icon: "ph-calculator",
    adaptPrompt: "Adapte para meios de pagamento, dia de fechamento e política de cobrança."
  },
  {
    id: "training_approval_standard",
    category: "Gestão",
    kind: "training",
    segment: "general_ops",
    area: "Gestão",
    title: "Padrão de aprovação de peças",
    description: "Como submeter, revisar e aprovar entregas no Baase.",
    tag: "+ quiz",
    icon: "ph-graduation-cap",
    adaptPrompt: "Adapte o treinamento para critérios de qualidade, evidência e aprovação."
  },
  {
    id: "training_evidence_standard",
    category: "Gestão",
    kind: "training",
    segment: "marketing_agency",
    area: "Gestão",
    title: "Como registrar evidências",
    description: "Treinamento curto para funcionário saber quando comentar, fotografar e pedir aprovação.",
    tag: "+ quiz",
    icon: "ph-graduation-cap",
    adaptPrompt: "Adapte para os tipos de evidência aceitos, exemplos reais e tom interno."
  }
];

function currentOperationalDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function operationalDayLabel(date: string) {
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(`${date}T12:00:00-03:00`));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

type OperationalPeriodPreset = "7d" | "30d" | "month" | "custom";
type OperationalPeriod = { from: string; to: string };

function periodForPreset(preset: Exclude<OperationalPeriodPreset, "custom">, to = currentOperationalDate()): OperationalPeriod {
  const end = new Date(`${to}T12:00:00Z`);
  if (preset === "month") {
    return { from: `${to.slice(0, 8)}01`, to };
  }
  end.setUTCDate(end.getUTCDate() - (preset === "7d" ? 6 : 29));
  return { from: end.toISOString().slice(0, 10), to };
}

function initialOperationalNavigation() {
  const fallback = periodForPreset("7d");
  if (typeof window === "undefined") return { period: fallback, preset: "7d" as OperationalPeriodPreset, personId: null as string | null };
  const params = new URLSearchParams(window.location.search);
  const from = params.get("from");
  const to = params.get("to");
  const isDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const hasValidPeriod = isDate(from) && isDate(to) && from <= to;
  return {
    period: hasValidPeriod ? { from, to } : fallback,
    preset: hasValidPeriod ? "custom" as const : "7d" as const,
    personId: params.get("person")
  };
}

function updateOperationalUrl(input: { screen?: Screen; period?: OperationalPeriod; personId?: string | null }) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (input.period) {
    url.searchParams.set("from", input.period.from);
    url.searchParams.set("to", input.period.to);
  }
  if (input.personId) url.searchParams.set("person", input.personId);
  else if (input.personId === null) url.searchParams.delete("person");
  if (input.screen) url.hash = input.screen;
  window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function replaceOperationalScreen(screen: Screen) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("person");
  url.hash = screen;
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function isOperationalOverview(value: unknown): value is ApiOperationalOverview {
  return value !== null
    && typeof value === "object"
    && "metrics" in value
    && "lateTasks" in value
    && "awaitingApprovals" in value
    && "pendingRequiredAnnouncements" in value
    && "trends" in value;
}
const onboardingQuestions = [
  "Descreva sua empresa em poucas frases: o que vende e para quem.",
  "Quais são as principais áreas e quem cuida de cada uma?",
  "O que mais te tira da operação hoje / mais dá dor de cabeça?"
];

function fallbackOnboardingAnswer(question: string, segment: string) {
  if (question.includes("poucas frases")) {
    return `Empresa do segmento ${segment}, com equipe em crescimento e necessidade de padronizar a entrega.`;
  }
  if (question.includes("principais áreas")) {
    return "O dono ainda centraliza decisões, com áreas de atendimento, execução e gestão precisando de papéis mais claros.";
  }
  return "Os maiores gargalos são tirar processos da cabeça do dono, criar rotinas diárias e treinar funcionários para executar com padrão.";
}

function roleLabelFromSession(role: Role, session: BaaseSession): string {
  const area = session.profile.area_name;
  if (role === "dono") return "Dono";
  if (role === "gestor") return `Gestor${area ? ` · ${area}` : ""}`;
  return `Funcionário${area ? ` · ${area}` : ""}`;
}

function identityFromSession(role: Role, session: BaaseSession | null, liveWorkspaceMode: boolean): Identity {
  const fallback = liveWorkspaceMode
    ? { name: "Usuário", initials: "UB", label: role === "dono" ? "Dono" : role === "gestor" ? "Gestor" : "Funcionário" }
    : identities[role];
  if (!session) return fallback;

  return {
    name: session.profile.display_name?.trim() || fallback.name,
    initials: session.profile.initials?.trim() || fallback.initials,
    label: roleLabelFromSession(role, session)
  };
}

function firstName(name: string) {
  return name.split(" ")[0] ?? name;
}

function isTaskDone(task: ApiTask) {
  return task.status === "completed" || task.status === "awaiting_approval";
}

function taskNeedsEvidence(task: ApiTask) {
  return Boolean(task.evidencePolicy && task.evidencePolicy !== "optional");
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "Ativa",
    archived: "Arquivada",
    draft: "Rascunho",
    published: "Publicado",
    pending: "Pendente",
    completed: "Concluído",
    awaiting_approval: "Aguardando"
  };
  return labels[status] ?? status;
}

const safeEvidencePreviewTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function hasSafeEvidencePreview(attachment: NonNullable<NonNullable<ApiTask["evidence"]>["attachment"]>) {
  return safeEvidencePreviewTypes.has(attachment.contentType) && Boolean(attachment.url);
}

function processItems(processes: ApiProcess[], areas: ApiArea[] = []): Array<[string, string, string, boolean]> {
  const areaNames = areaNameMap(areas);
  return processes.map((process, index) => [
    process.title,
    areaLabel(process.areaId, areaNames),
    statusLabel(process.status),
    index === 0
  ]);
}

function routineItems(routines: ApiRoutine[], areas: ApiArea[] = []): Array<[string, string, string, boolean]> {
  const areaNames = areaNameMap(areas);
  return routines.map((routine, index) => [
    routine.title,
    routine.areaId ? `Área: ${areaLabel(routine.areaId, areaNames)}` : "Empresa inteira",
    statusLabel(routine.status),
    index === 0
  ]);
}

function trainingItems(trainings: ApiTraining[]): Array<[string, string, string, boolean]> {
  return trainings.map((training, index) => [
    training.title,
    training.description ?? "Aula curta + material",
    statusLabel(training.status),
    index === 0
  ]);
}

function initialsFromName(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "BB";
}

function setupTeamRows(setup: OnboardingSetupResult | null): TeamDisplayRow[] {
  if (!setup) return people;

  return setup.people.map((person) => {
    const area = setup.areas.find((item) => item.id === person.areaId);
    const roleTemplate = setup.role_templates.find((item) => item.id === person.roleTemplateId);

    return {
      n: person.name,
      r: roleTemplate?.name ?? (person.role === "manager" ? "Gestor" : person.role === "owner" ? "Dono" : "Funcionário"),
      area: area?.name ?? "Empresa",
      role: person.role === "owner" ? "dono" : person.role === "manager" ? "gestor" : "func",
      ini: initialsFromName(person.name)
    };
  });
}

function setupAreaRows(setup: OnboardingSetupResult | null): AreaDisplayRow[] {
  if (!setup) return areas;

  const colors = ["var(--accent)", "var(--info-ink)", "var(--warn-ink)", "var(--danger-ink)"];

  return setup.areas.map((area, index) => {
    const roleTemplates = setup.role_templates.filter((roleTemplate) => roleTemplate.areaId === area.id);
    const areaPeople = setup.people.filter((person) => person.areaId === area.id);
    const members = areaPeople.map((person) => {
        const roleTemplate = roleTemplates.find((role) => role.id === person.roleTemplateId);
        return {
          name: person.name,
          role: roleTemplate?.name ?? EMPTY_ROLE_LABEL,
          roleId: roleTemplate?.id
        };
      });

    return {
      id: area.id,
      name: area.name,
      description: area.description,
      people: areaPeople.length,
      color: colors[index % colors.length] ?? "var(--accent)",
      roles: roleTemplates.map((roleTemplate) => ({ id: roleTemplate.id, name: roleTemplate.name })),
      cargos: roleTemplates.map((roleTemplate) => roleTemplate.name),
      names: areaPeople.map((person) => person.name),
      members,
      gap: areaPeople.length === 0
    };
  });
}

function apiRoleToUiRole(role: ApiPerson["role"]): Role {
  if (role === "owner") return "dono";
  if (role === "manager") return "gestor";
  return "func";
}

function apiRoleLabel(role: ApiPerson["role"]) {
  if (role === "owner") return "Dono";
  if (role === "manager") return "Gestor";
  return "Funcionário";
}

function companyTeamRows(apiPeople: ApiPerson[], apiAreas: ApiArea[], apiRoles: ApiRoleTemplate[]): TeamDisplayRow[] {
  if (!apiPeople.length) return [];

  return apiPeople.map((person) => {
    const area = apiAreas.find((item) => item.id === person.areaId);
    const roleTemplate = apiRoles.find((item) => item.id === person.roleTemplateId);

    return {
      id: person.id,
      n: person.name,
      r: roleTemplate?.name ?? apiRoleLabel(person.role),
      area: area?.name ?? "Empresa",
      role: apiRoleToUiRole(person.role),
      ini: initialsFromName(person.name)
    };
  });
}

function companyAreaRows(apiAreas: ApiArea[], apiRoles: ApiRoleTemplate[], apiPeople: ApiPerson[]): AreaDisplayRow[] {
  if (!apiAreas.length) return [];

  const colors = ["var(--accent)", "var(--info-ink)", "var(--warn-ink)", "var(--danger-ink)"];
  return apiAreas.map((area, index) => {
    const roles = apiRoles.filter((roleTemplate) => roleTemplate.areaId === area.id);
    const peopleInArea = apiPeople.filter((person) => person.areaId === area.id);
    const members = peopleInArea.map((person) => {
        const roleTemplate = roles.find((role) => role.id === person.roleTemplateId);
        return {
          name: person.name,
          role: roleTemplate?.name ?? EMPTY_ROLE_LABEL,
          roleId: roleTemplate?.id
        };
      });

    return {
      id: area.id,
      name: area.name,
      description: area.description,
      people: peopleInArea.length,
      color: colors[index % colors.length] ?? "var(--accent)",
      roles: roles.map((roleTemplate) => ({ id: roleTemplate.id, name: roleTemplate.name })),
      cargos: roles.map((roleTemplate) => roleTemplate.name),
      names: peopleInArea.map((person) => person.name),
      members,
      gap: roles.length === 0 || peopleInArea.length === 0
    };
  });
}

function customAreaRows(apiAreas: ApiArea[]): AreaDisplayRow[] {
  const colors = ["var(--accent)", "var(--info-ink)", "var(--warn-ink)", "var(--danger-ink)"];
  return apiAreas.map((area, index) => ({
    id: area.id,
    name: area.name,
    description: area.description,
    people: 0,
    color: colors[index % colors.length] ?? "var(--accent)",
    roles: [],
    cargos: [],
    names: [],
    members: [],
    gap: true
  }));
}

function mergeAreaRows(baseRows: AreaDisplayRow[], apiAreas: ApiArea[]) {
  const extraRows = customAreaRows(apiAreas).filter((area) => !baseRows.some((base) => base.name === area.name));
  return [...extraRows, ...baseRows];
}

function areaDisplayKey(area: AreaDisplayRow) {
  return area.id ?? area.name;
}

function areaMemberGroups(area: AreaDisplayRow) {
  const groups: Array<{ key: string; role: string; people: AreaMemberDisplayRow[] }> = [];

  area.members.forEach((member) => {
    const key = member.roleId ?? member.role;
    const currentGroup = groups.find((group) => group.key === key);
    if (currentGroup) {
      currentGroup.people.push(member);
      return;
    }

    groups.push({
      key,
      role: member.role,
      people: [member]
    });
  });

  return groups;
}

type ProcessStepCard = {
  title: string;
  detail?: string;
  expectedResult?: string;
  attentionPoints?: string[];
};

type ParsedProcessBody = {
  objective?: string;
  trigger?: string;
  rule?: string;
  steps: ProcessStepCard[];
};

function cleanProcessTitle(title: string) {
  return title
    .replace(/^Rascunho\s+de\s+/i, "")
    .replace(/^Rascunho\s*[-—:]\s*/i, "")
    .trim();
}

function cleanTrainingTitle(title: string) {
  const cleaned = title
    .replace(/^Rascunho\s+de\s+treinamento\s*[-—:]\s*/i, "")
    .replace(/^Rascunho\s*[-—:]\s*/i, "")
    .trim();

  return cleaned || title.trim();
}

type TrainingLessonBlock =
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "divider" };

function stripInlineMarkdown(text: string) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .trim();
}

function parseTrainingLessonBody(body: string | null | undefined): TrainingLessonBlock[] {
  const lines = (body ?? "").replace(/\r/g, "").split("\n");
  const blocks: TrainingLessonBlock[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    const text = stripInlineMarkdown(paragraph.join(" "));
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    if (/^[-*_]{3,}$/.test(line)) {
      flushParagraph();
      blocks.push({ type: "divider" });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(Math.max(heading[1]!.length, 2), 4) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, text: stripInlineMarkdown(heading[2]!) });
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      const previous = blocks[blocks.length - 1];
      const item = stripInlineMarkdown(unordered[1]!);
      if (previous?.type === "list" && !previous.ordered) previous.items.push(item);
      else blocks.push({ type: "list", ordered: false, items: [item] });
      continue;
    }

    const ordered = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      const previous = blocks[blocks.length - 1];
      const item = stripInlineMarkdown(`${ordered[1]}. ${ordered[2]}`);
      if (previous?.type === "list" && previous.ordered) previous.items.push(item);
      else blocks.push({ type: "list", ordered: true, items: [item] });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

function TrainingLessonBody({ body }: { body: string }) {
  const blocks = parseTrainingLessonBody(body);
  if (!blocks.length) return null;

  return (
    <div className="training-material-body">
      {blocks.map((block, index) => {
        if (block.type === "divider") return <hr key={`divider-${index}`} />;
        if (block.type === "paragraph") return <p key={`paragraph-${index}`}>{block.text}</p>;
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={`list-${index}`}>
              {block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}
            </ListTag>
          );
        }
        const HeadingTag = block.level <= 2 ? "h4" : "h5";
        return <HeadingTag className={`lesson-heading level-${block.level}`} key={`heading-${index}`}>{block.text}</HeadingTag>;
      })}
    </div>
  );
}

function readLabeledValue(line: string, label: string) {
  const match = line.match(new RegExp(`^${label}:\\s*(.+)$`, "i"));
  return match?.[1]?.trim() ?? null;
}

function isProcessExecutionPolicyLine(line: string) {
  return /^Evid[eê]ncia:/i.test(line) || /^Aprova[cç][aã]o:/i.test(line);
}

function normalizeProcessBodyLines(body: string) {
  return body
    .replace(/\r/g, "")
    .replace(/\s+(\d+[.)]\s+)/g, "\n$1")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseProcessBody(body?: string | null): ParsedProcessBody {
  if (!body) {
    return {
      steps: [
        { title: "Registrar fechamento e coletar acessos", detail: "Marcar cliente como ativo e solicitar logins, marca e materiais." },
        { title: "Criar pasta e board do cliente", detail: "Estrutura padrão de pastas + board com colunas do fluxo." },
        { title: "Kickoff interno", detail: "Reunião de alinhamento com criação, mídia e atendimento." },
        { title: "Aprovação dupla antes do envio", detail: "Toda peça passa por revisão do responsável e do gestor da área." }
      ]
    };
  }

  const parsed: ParsedProcessBody = { steps: [] };
  const fallbackSteps: ProcessStepCard[] = [];
  let currentStep: ProcessStepCard | null = null;
  let readingAttentionPoints = false;

  function commitCurrentStep() {
    if (!currentStep) return;
    parsed.steps.push(currentStep);
    currentStep = null;
  }

  for (const line of normalizeProcessBodyLines(body)) {
    const objective = readLabeledValue(line, "Objetivo");
    if (objective) {
      parsed.objective = objective;
      continue;
    }

    const trigger = readLabeledValue(line, "Gatilho");
    if (trigger) {
      parsed.trigger = trigger;
      continue;
    }

    const rule = readLabeledValue(line, "Regra operacional");
    if (rule) {
      parsed.rule = rule;
      continue;
    }

    if (/^Fluxo sugerido:?$/i.test(line)) continue;

    const stepMatch = line.match(/^(\d+)[.)]\s*(.+)$/);
    if (stepMatch?.[2]) {
      commitCurrentStep();
      currentStep = { title: stepMatch[2].trim() };
      readingAttentionPoints = false;
      continue;
    }

    if (isProcessExecutionPolicyLine(line)) {
      readingAttentionPoints = false;
      continue;
    }

    const instruction = readLabeledValue(line, "Instrução");
    if (instruction && currentStep) {
      currentStep.detail = instruction;
      readingAttentionPoints = false;
      continue;
    }

    const expectedResult = readLabeledValue(line, "Resultado esperado");
    if (expectedResult && currentStep) {
      currentStep.expectedResult = expectedResult;
      readingAttentionPoints = false;
      continue;
    }

    if (/^Pontos de aten[cç][aã]o:?$/i.test(line) && currentStep) {
      currentStep.attentionPoints = currentStep.attentionPoints ?? [];
      readingAttentionPoints = true;
      continue;
    }

    if (readingAttentionPoints && currentStep && /^[-•]\s+/.test(line)) {
      currentStep.attentionPoints = [...(currentStep.attentionPoints ?? []), line.replace(/^[-•]\s+/, "").trim()];
      continue;
    }

    if (currentStep) {
      if (readingAttentionPoints) {
        currentStep.attentionPoints = [...(currentStep.attentionPoints ?? []), line];
      } else {
        currentStep.detail = [currentStep.detail, line].filter(Boolean).join(" ");
      }
      continue;
    }

    if (!isProcessExecutionPolicyLine(line)) {
      fallbackSteps.push({ title: line });
    }
  }

  commitCurrentStep();
  if (!parsed.steps.length) parsed.steps = fallbackSteps;
  return parsed;
}

function processStepFromAiRecord(step: Record<string, unknown>, index: number) {
  const detail = textFrom(step.instruction, textFrom(step.detail, "Execute conforme o padrão definido."));
  return {
    title: textFrom(step.title, `Etapa ${index + 1}`),
    instruction: detail,
    expectedResult: textFrom(step.expectedResult, "A etapa fica concluída com clareza para a próxima pessoa continuar."),
    attentionPoints: recordsFrom(step.attentionPoints).map((point) => textFrom(point)).filter(Boolean).slice(0, 3)
  };
}

function processSopBodyFromAiContent(content: Record<string, unknown>, prompt: string) {
  const steps = recordsFrom(content.steps);
  if (!steps.length) return defaultProcessSopBody(titleFromPrompt(prompt, "Processo criado com IA"));

  return formatProcessSopBody({
    objective: textFrom(content.objective, "Transformar o pedido em um roteiro operacional executável pela equipe."),
    trigger: textFrom(content.trigger, "Sempre que este fluxo operacional for iniciado."),
    operationalRule: textFrom(content.operationalRule) || null,
    steps: steps.map(processStepFromAiRecord)
  });
}

function areaNameMap(areas: ApiArea[]) {
  return new Map(areas.map((area) => [area.id, area.name]));
}

function areaLabel(areaId: string | null | undefined, areaNames: Map<string, string>, areaNameSnapshot?: string | null) {
  if (!areaId) return "Sem área definida";
  const savedName = areaNames.get(areaId) ?? areaNameSnapshot?.trim();
  if (savedName) return savedName;
  if (/^area[_-]/i.test(areaId) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(areaId)) return "Área removida";
  return areaId;
}

function roleLabel(roleTemplateId: string | null | undefined, roleTemplates: ApiRoleTemplate[]) {
  if (!roleTemplateId) return "Cargo não definido";
  return roleTemplates.find((role) => role.id === roleTemplateId)?.name ?? roleTemplateId;
}

function personLabel(profileId: string | null | undefined, people: ApiPerson[]) {
  if (!profileId) return "Pessoa não definida";
  return people.find((person) => person.id === profileId)?.name ?? profileId;
}

function trainingAudienceLabel(audience: ApiTrainingAudience | null | undefined, areas: ApiArea[], roleTemplates: ApiRoleTemplate[], people: ApiPerson[]) {
  if (!audience || audience.type === "all") return "Empresa inteira";
  if (audience.type === "area") return areaLabel(audience.areaId, areaNameMap(areas));
  if (audience.type === "role") return roleLabel(audience.roleTemplateId, roleTemplates);
  return personLabel(audience.profileId, people);
}

function trainingAssignmentInput(audience: ApiTrainingAudience, dueDate: string | null) {
  if (audience.type === "area") return { audienceType: "area" as const, areaId: audience.areaId, dueDate };
  if (audience.type === "role") return { audienceType: "role" as const, roleTemplateId: audience.roleTemplateId, dueDate };
  if (audience.type === "person") return { audienceType: "person" as const, profileId: audience.profileId, dueDate };
  return { audienceType: "all" as const, dueDate };
}

function trainingSourceLabel(training: Pick<ApiTraining, "source">) {
  const source = training.source;
  if (source?.type === "process") return source.title ? `Processo · ${source.title}` : "Processo vinculado";
  if (source?.type === "material") return source.title ? `Material · ${source.title}` : "Material externo";
  return "Manual";
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function processVersionHistory(process: ApiProcess | null) {
  if (!process) return [];

  const versions = [...(process.versions ?? [])];
  const currentVersion = process.currentVersion;
  if (currentVersion?.version && !versions.some((version) => version.version === currentVersion.version)) {
    versions.push({
      version: currentVersion.version,
      title: process.title,
      body: currentVersion.body,
      changeNote: "Versão atual"
    });
  }

  return versions.sort((a, b) => b.version - a.version);
}

type ProcessPdfInput = {
  title: string;
  summary: string;
  area: string;
  status: string;
  version: string;
  parsed: ParsedProcessBody;
};

function compactPdfText(value?: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function processPdfFileName(title: string) {
  const fileName = cleanProcessTitle(title).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sop";
  return `${fileName}.pdf`;
}

function processPdfCard(label: string, value?: string | null): Content | null {
  const text = compactPdfText(value);
  if (!text) return null;

  return {
    table: {
      widths: ["*"],
      body: [[{
        stack: [
          { text: label.toUpperCase(), style: "cardLabel" },
          { text, style: "cardText", margin: [0, 6, 0, 0] }
        ],
        margin: [12, 10, 12, 11]
      }]]
    },
    layout: {
      hLineColor: () => "#E5DED3",
      vLineColor: () => "#E5DED3",
      hLineWidth: () => 0.8,
      vLineWidth: () => 0.8,
      fillColor: () => "#F8F6F1"
    },
    margin: [0, 0, 0, 0]
  };
}

function processPdfStep(step: ProcessStepCard, index: number, allSteps: ProcessStepCard[]): Content {
  const isLastStep = index === allSteps.length - 1;
  const hasSupportingContent = Boolean(step.detail || step.expectedResult || step.attentionPoints?.length);
  const stepStack: Content[] = [
    { text: compactPdfText(step.title), style: "stepTitle" }
  ];

  if (step.detail) {
    stepStack.push({ text: compactPdfText(step.detail), style: "stepBody", margin: [0, 4, 0, 0] });
  }

  if (step.expectedResult) {
    stepStack.push({
      table: {
        widths: ["*"],
        body: [[{
          stack: [
            { text: "RESULTADO ESPERADO", style: "resultLabel" },
            { text: compactPdfText(step.expectedResult), style: "resultText", margin: [0, 4, 0, 0] }
          ],
          margin: [10, 8, 10, 9]
        }]]
      },
      layout: {
        hLineColor: () => "#C9DDD4",
        vLineColor: () => "#C9DDD4",
        hLineWidth: () => 0.7,
        vLineWidth: () => 0.7,
        fillColor: () => "#EFF7F3"
      },
      margin: [0, 9, 0, 0]
    });
  }

  if (step.attentionPoints?.length) {
    stepStack.push({
      stack: [
        { text: "PONTOS DE ATENÇÃO", style: "attentionLabel" },
        { ul: step.attentionPoints.map((point) => compactPdfText(point)), style: "attentionList", margin: [0, 4, 0, 0] }
      ],
      margin: [0, 7, 0, 0]
    });
  }

  return {
    stack: [
      {
        columns: [
          {
            width: 30,
            table: {
              widths: [24],
              body: [[{
                text: String(index + 1),
                style: "stepNumber",
                alignment: "center",
                margin: [0, 5, 0, 5]
              }]]
            },
            layout: {
              hLineColor: () => "#BBD9CE",
              vLineColor: () => "#BBD9CE",
              hLineWidth: () => 0.8,
              vLineWidth: () => 0.8,
              fillColor: () => "#EAF6F1"
            }
          },
          { width: "*", stack: stepStack }
        ],
        columnGap: 12
      },
      ...(!isLastStep ? [{ canvas: [{ type: "line", x1: 42, y1: 0, x2: 507, y2: 0, lineWidth: 0.7, lineColor: "#E8E4DC" }], margin: [0, hasSupportingContent ? 12 : 8, 0, 0] } as Content] : [])
    ],
    margin: [0, 0, 0, hasSupportingContent ? 12 : 9],
    unbreakable: true
  };
}

function processPdfDefinition(input: ProcessPdfInput): TDocumentDefinitions {
  const cards = [
    processPdfCard("Objetivo", input.parsed.objective),
    processPdfCard("Gatilho", input.parsed.trigger),
    processPdfCard("Regra operacional", input.parsed.rule)
  ].filter(Boolean) as Content[];
  const cardRows: Content[] = [];

  for (let index = 0; index < cards.length; index += 2) {
    const pair = cards.slice(index, index + 2);
    cardRows.push({
      columns: pair.map((card, pairIndex) => ({
        width: "*",
        stack: [card],
        margin: pairIndex === 0 && pair.length > 1 ? [0, 0, 5, 0] : [5, 0, 0, 0]
      })),
      columnGap: 8,
      margin: [0, 0, 0, 10]
    });
  }

  return {
    pageSize: "A4",
    pageMargins: [44, 42, 44, 52],
    info: {
      title: input.title,
      author: "Prymeira Baase",
      subject: "SOP operacional"
    },
    background: () => ({
      canvas: [{ type: "rect", x: 0, y: 0, w: 595.28, h: 841.89, color: "#FBFAF7" }]
    }),
    defaultStyle: {
      font: "Roboto",
      fontSize: 10.5,
      color: "#1B1A17",
      lineHeight: 1.25
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `${input.area} · ${input.status} · ${input.version}`, color: "#8B8881", fontSize: 8.2 },
        { text: `${currentPage}/${pageCount}`, alignment: "right", color: "#8B8881", fontSize: 8.2 }
      ],
      margin: [44, 0, 44, 27]
    }),
    content: [
      { canvas: [{ type: "rect", x: 0, y: 0, w: 507, h: 3, color: "#3F7D69" }], margin: [0, 0, 0, 14] },
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "PRYMEIRA BAASE", style: "brand" },
              { text: input.title, style: "title", margin: [0, 7, 0, 0] },
              { text: compactPdfText(input.summary), style: "summary", margin: [0, 8, 18, 0] },
              { text: input.area, style: "areaMeta", margin: [0, 9, 0, 0] }
            ]
          },
          {
            width: 112,
            table: {
              widths: ["*"],
              body: [[{
                stack: [
                  { text: "SOP", style: "badgeTitle", alignment: "right" },
                  { text: `${input.status} · ${input.version}`, style: "badgeText", alignment: "right", margin: [0, 5, 0, 0] }
                ],
                margin: [11, 10, 11, 10]
              }]]
            },
            layout: {
              hLineColor: () => "#C7DDD4",
              vLineColor: () => "#C7DDD4",
              hLineWidth: () => 0.8,
              vLineWidth: () => 0.8,
              fillColor: () => "#EEF8F3"
            },
            margin: [0, 3, 0, 0]
          }
        ],
        columnGap: 22
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 507, y2: 0, lineWidth: 0.7, lineColor: "#E5DED3" }], margin: [0, 16, 0, 14] },
      ...cardRows,
      { text: "Etapas", style: "sectionTitle", margin: [0, cards.length ? 8 : 0, 0, 11] },
      ...input.parsed.steps.map(processPdfStep)
    ],
    styles: {
      brand: { color: "#3F7D69", fontSize: 8.5, bold: true, characterSpacing: 1.5 },
      title: { fontSize: 25, bold: false, lineHeight: 1.07 },
      summary: { color: "#67645E", fontSize: 10.4, lineHeight: 1.32 },
      areaMeta: { color: "#8B8881", fontSize: 8.8 },
      badgeTitle: { color: "#356D5E", fontSize: 16, bold: true, characterSpacing: 1.2 },
      badgeText: { color: "#567E6E", fontSize: 8.4, bold: true },
      cardLabel: { color: "#918D86", fontSize: 8.2, bold: true, characterSpacing: 1.3 },
      cardText: { fontSize: 10, lineHeight: 1.28 },
      sectionTitle: { fontSize: 15.2, bold: true },
      stepNumber: { color: "#356D5E", fontSize: 9.8, bold: true },
      stepTitle: { fontSize: 11.7, bold: true, lineHeight: 1.18 },
      stepBody: { color: "#5E5B55", fontSize: 9.9, lineHeight: 1.3 },
      resultLabel: { color: "#356D5E", fontSize: 8.2, bold: true, characterSpacing: 0.55 },
      resultText: { color: "#1B1A17", fontSize: 9.8, lineHeight: 1.25 },
      attentionLabel: { color: "#8A6B35", fontSize: 8, bold: true, characterSpacing: 0.65 },
      attentionList: { color: "#765A2B", fontSize: 9.5, lineHeight: 1.25 }
    }
  };
}

async function downloadProcessPdf(input: ProcessPdfInput) {
  const [{ default: pdfMake }, { default: pdfFonts }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts")
  ]);
  pdfMake.addVirtualFileSystem(pdfFonts);
  await pdfMake.createPdf(processPdfDefinition(input)).download(processPdfFileName(input.title));
}

async function downloadEditorialProcessPdf(processId: string) {
  const publication = await createPublication("process", processId, "pdf");
  globalThis.location.assign(await downloadPublication(publication.id));
}

function templateMode(kind: ApiTemplateKind): CreateAiMode {
  if (kind === "routine") return "routine";
  if (kind === "training") return "training";
  return "process";
}

function createAiPresetForMode(mode: CreateAiMode): CreateAiPreset {
  return mode;
}

function templateTone(kind: ApiTemplateKind): "info" | "accent" | "warn" {
  if (kind === "process") return "info";
  if (kind === "routine") return "accent";
  return "warn";
}

function templateKindLabel(kind: ApiTemplateKind) {
  if (kind === "process") return "Processo";
  if (kind === "routine") return "Rotina";
  return "Treinamento";
}

function templateKindPluralLabel(kind: ApiTemplateKind) {
  if (kind === "process") return "Processos";
  if (kind === "routine") return "Rotinas";
  return "Treinamentos";
}

function segmentLabel(segment: string) {
  const labels: Record<string, string> = {
    marketing_agency: "Agência de marketing",
    general_ops: "Operação geral",
    local_services: "Serviços locais"
  };
  return labels[segment] ?? segment;
}

function modeFromSuggestion(suggestion: ApiProactiveSuggestion): CreateAiMode | null {
  if (suggestion.action.type === "create_routine" || suggestion.action.type === "review_routines") return "routine";
  if (suggestion.action.type === "create_training") return "training";
  if (suggestion.action.type === "review_process") return "process";
  return null;
}

function screenFromSuggestion(suggestion: ApiProactiveSuggestion): Screen {
  const target = suggestion.action.targetScreen;
  if (target === "painel-gestor") return "painel-gestor";
  return target;
}

function titleFromPrompt(prompt: string, fallback: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  return normalized.slice(0, 78) || fallback;
}

function createAiInputModeWith(currentMode: CreateAiInputMode, nextMode: CreateAiInputMode): CreateAiInputMode {
  if (currentMode === nextMode) return currentMode;
  if (currentMode === "text") return nextMode;
  if (nextMode === "text") return currentMode;
  return "mixed";
}

function guessFileMimeType(file: File) {
  const lowerName = file.name.toLowerCase();
  if (file.type) return file.type;
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".md")) return "text/markdown";
  return "text/plain";
}

const preferredRecordingMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/ogg;codecs=opus",
  "audio/aac"
];

const recordingAudioBitsPerSecond = 64_000;

function selectAudioRecorderOptions(): MediaRecorderOptions | undefined {
  const canCheckSupport = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function";
  if (!canCheckSupport) return { audioBitsPerSecond: recordingAudioBitsPerSecond };

  const mimeType = preferredRecordingMimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType
    ? { mimeType, audioBitsPerSecond: recordingAudioBitsPerSecond }
    : { audioBitsPerSecond: recordingAudioBitsPerSecond };
}

function createRecordedAudioBlob(chunks: Blob[], recorder: MediaRecorder) {
  const recordedType = chunks.find((chunk) => chunk.type)?.type || recorder.mimeType || "audio/webm";
  return new Blob(chunks, { type: recordedType });
}

function isSupportedAiMaterial(file: File) {
  const mimeType = guessFileMimeType(file).toLowerCase();
  const lowerName = file.name.toLowerCase();
  return mimeType === "application/pdf"
    || mimeType.startsWith("text/")
    || lowerName.endsWith(".pdf")
    || lowerName.endsWith(".txt")
    || lowerName.endsWith(".md");
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordsFrom(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function textFrom(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

const evidencePolicies: NonNullable<ApiRoutineTaskTemplate["evidencePolicy"]>[] = [
  "optional",
  "photo_required",
  "comment_required",
  "photo_or_comment_required"
];

function evidencePolicyFrom(value: unknown): NonNullable<ApiRoutineTaskTemplate["evidencePolicy"]> {
  return evidencePolicies.includes(value as NonNullable<ApiRoutineTaskTemplate["evidencePolicy"]>)
    ? value as NonNullable<ApiRoutineTaskTemplate["evidencePolicy"]>
    : "optional";
}

function evidencePolicyLabel(policy: NonNullable<ApiRoutineTaskTemplate["evidencePolicy"]>) {
  const labels: Record<NonNullable<ApiRoutineTaskTemplate["evidencePolicy"]>, string> = {
    optional: "opcional",
    photo_required: "foto obrigatória",
    comment_required: "comentário obrigatório",
    photo_or_comment_required: "foto ou comentário"
  };
  return labels[policy];
}

function approvalModeFrom(value: unknown): NonNullable<ApiRoutineTaskTemplate["approvalMode"]> {
  return value === "approval_required" ? "approval_required" : "direct";
}

function quizFromDraft(value: unknown, fallbackPrompt: string): ApiQuizQuestionInput[] {
  const questions = recordsFrom(value);
  if (!questions.length) {
    return [{
      prompt: fallbackPrompt,
      options: [
        { id: "a", label: "Executar o padrão combinado" },
        { id: "b", label: "Improvisar sem registro" }
      ],
      correctOptionId: "a",
      explanation: "O Baase existe para transformar padrão em execução diária."
    }];
  }

  return questions.map((question, questionIndex) => {
    const options = recordsFrom(question.options).map((option, optionIndex) => ({
      id: textFrom(option.id, String.fromCharCode(97 + optionIndex)),
      label: textFrom(option.label, `Opção ${optionIndex + 1}`)
    }));
    const safeOptions = options.length >= 2 ? options : [
      { id: "a", label: "Executar o padrão combinado" },
      { id: "b", label: "Improvisar sem registro" }
    ];
    const correctOptionId = textFrom(question.correctOptionId, safeOptions[0]?.id ?? "a");

    return {
      id: textFrom(question.id, `q${questionIndex + 1}`),
      prompt: textFrom(question.prompt, fallbackPrompt),
      options: safeOptions,
      correctOptionId: safeOptions.some((option) => option.id === correctOptionId) ? correctOptionId : safeOptions[0]?.id ?? "a",
      explanation: textFrom(question.explanation, "Resposta alinhada ao padrão operacional esperado.")
    };
  });
}

function processInputFromAiDraft(draft: AiGeneratedDraft, prompt: string) {
  const content = draft.content;

  return {
    title: cleanProcessTitle(textFrom(content.title, titleFromPrompt(prompt, "Processo criado com IA"))),
    summary: textFrom(content.summary, "Gerado pela IA do Baase para revisão do dono."),
    body: processSopBodyFromAiContent(content, prompt)
  };
}

function routineInputFromAiDraft(draft: AiGeneratedDraft, prompt: string) {
  const content = draft.content;
  const tasks = recordsFrom(content.tasks);
  const taskTemplates = (tasks.length ? tasks : [
    { title: "Conferir o gatilho da rotina", evidencePolicy: "optional", approvalMode: "direct" },
    { title: "Executar a etapa principal", evidencePolicy: "comment_required", approvalMode: "direct" },
    { title: "Registrar evidência ou bloqueio", evidencePolicy: "photo_or_comment_required", approvalMode: "approval_required" }
  ]).map((task, index): ApiRoutineTaskTemplate => {
    const dueHint = textFrom(task.dueHint);
    const title = textFrom(task.title, `Etapa ${index + 1}`);
    return {
      title,
      dueHint: dueHint || null,
      approvalMode: approvalModeFrom(task.approvalMode),
      evidencePolicy: evidencePolicyFrom(task.evidencePolicy)
    };
  });

  return {
    title: textFrom(content.title, titleFromPrompt(prompt, "Rotina criada com IA")),
    areaId: null,
    taskTemplates
  };
}

function trainingInputFromAiDraft(draft: AiGeneratedDraft, prompt: string) {
  const content = draft.content;
  const lesson = isRecord(content.lesson) ? content.lesson : {};

  return {
    title: cleanTrainingTitle(textFrom(content.title, titleFromPrompt(prompt, "Treinamento criado com IA"))),
    description: textFrom(content.description, "Rascunho gerado pela IA do Baase para revisão."),
    source: { type: "manual" as const, processId: null, title: "Criado com IA" },
    audience: null,
    dueDate: null,
    materials: [{
      kind: "lesson" as const,
      title: textFrom(lesson.title, "Aula curta"),
      body: textFrom(lesson.body, `Material inicial gerado a partir do pedido: ${prompt}`),
      url: null
    }],
    quizQuestions: quizFromDraft(content.quiz, "Qual é o comportamento esperado depois deste treinamento?")
  };
}

function announcementInputFromAiDraft(draft: AiGeneratedDraft, prompt: string) {
  const content = draft.content;
  const audience = isRecord(content.audience) ? content.audience : { type: "all" };
  const audienceType = textFrom(audience.type, "all");
  const safeAudienceType = ["all", "area", "role", "person"].includes(audienceType)
    ? audienceType as "all" | "area" | "role" | "person"
    : "all";
  const announcementType = ["simple", "process_change", "mandatory_training"].includes(textFrom(content.type))
    ? textFrom(content.type) as ApiAnnouncement["type"]
    : "simple";
  const requirement = ["none", "read_confirmation", "quiz_confirmation"].includes(textFrom(content.requirement))
    ? textFrom(content.requirement) as ApiAnnouncement["requirement"]
    : "read_confirmation";

  return {
    title: textFrom(content.title, titleFromPrompt(prompt, "Comunicado criado com IA")),
    body: textFrom(content.body, `Rascunho gerado a partir do pedido: ${prompt}`),
    type: announcementType,
    requirement,
    audienceType: safeAudienceType,
    areaId: textFrom(audience.areaId) || null,
    roleTemplateId: textFrom(audience.roleTemplateId) || null,
    profileId: textFrom(audience.profileId) || null,
    quizQuestions: requirement === "quiz_confirmation" ? quizFromDraft(content.quiz, "Qual é a ação esperada após este comunicado?") : []
  };
}

function homeFor(role: Role): Screen {
  if (role === "dono") return "painel-dono";
  if (role === "gestor") return "painel-gestor";
  return "hoje";
}

function uiRoleFromSession(session: BaaseSession): Role {
  if (session.profile.role === "owner") return "dono";
  if (session.profile.role === "manager") return "gestor";
  return "func";
}

function Icon({ name, fill = false, bold = false }: { name: string; fill?: boolean; bold?: boolean }) {
  const weight = fill ? "ph-fill" : bold ? "ph-bold" : name.includes("ph-light") ? "" : "ph-light";
  return <i aria-hidden="true" className={[weight, name].filter(Boolean).join(" ")} />;
}

function PercentBar({ value, color = "var(--accent)" }: { value: string; color?: string }) {
  return (
    <div className="progress">
      <div style={{ width: value, background: color }} />
    </div>
  );
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "danger" | "warn" | "info" | "accent" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function EmptyState({ icon = "ph-tray", title, text }: { icon?: string; title: string; text: string }) {
  return (
    <div className="empty-state">
      <Icon name={icon} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export function App({ initialRole = "dono", apiEnabled = true }: AppProps) {
  const operationalDate = useMemo(() => currentOperationalDate(), []);
  const initialOperationalState = useMemo(() => initialOperationalNavigation(), []);
  const accountMode = readBaaseAuthConfig(import.meta.env).mode === "account";
  const [role, setRoleState] = useState<Role>(initialRole);
  const [screen, setScreen] = useState<Screen>(homeFor(initialRole));
  const [menuOpen, setMenuOpen] = useState(false);
  const [tasks, setTasks] = useState<Record<string, boolean>>({ t1: false, t2: true, t3: false, t4: false });
  const [checks, setChecks] = useState<Record<string, boolean>>({ c1: true, c2: true, c3: false, c4: false, c5: false });
  const [apiBundle, setApiBundle] = useState<BaaseWorkspaceBundle | null>(null);
  const [apiStatus, setApiStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [operationalPeriodPreset, setOperationalPeriodPreset] = useState<OperationalPeriodPreset>(initialOperationalState.preset);
  const [operationalPeriod, setOperationalPeriod] = useState<OperationalPeriod>(initialOperationalState.period);
  const [operationalOverview, setOperationalOverview] = useState<ApiOperationalOverview | null>(null);
  const [operationalOverviewStatus, setOperationalOverviewStatus] = useState<"idle" | "loading" | "error">("idle");
  const [operationalPersonId, setOperationalPersonId] = useState<string | null>(initialOperationalState.personId);
  const [personOperationalOverview, setPersonOperationalOverview] = useState<ApiOperationalOverview | null>(null);
  const [personOperationalOverviewStatus, setPersonOperationalOverviewStatus] = useState<"idle" | "loading" | "error">("idle");
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus>(apiEnabled ? "loading" : "ready");
  const [submittedApiTasks, setSubmittedApiTasks] = useState<Record<string, boolean>>({});
  const [submittingTasks, setSubmittingTasks] = useState<Record<string, boolean>>({});
  const [actionBusy, setActionBusy] = useState(false);
  const [crudModal, setCrudModal] = useState<CrudModal | null>(null);
  const [areaArchiveDialog, setAreaArchiveDialog] = useState<AreaArchiveDialogState | null>(null);
  const [executionTask, setExecutionTask] = useState<TodayTaskRow | null>(null);
  const [operationalTaskDetail, setOperationalTaskDetail] = useState<ApiTask | null>(null);
  const [selectedOperationalAnnouncementId, setSelectedOperationalAnnouncementId] = useState<string | null>(null);
  const [returningTask, setReturningTask] = useState<ApiTask | null>(null);
  const [topPanel, setTopPanel] = useState<TopPanel>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customAreas, setCustomAreas] = useState<ApiArea[]>([]);
  const [createdRoleTemplates, setCreatedRoleTemplates] = useState<ApiRoleTemplate[]>([]);
  const [createdPeople, setCreatedPeople] = useState<ApiPerson[]>([]);
  const [createdInvites, setCreatedInvites] = useState<ApiInvite[]>([]);
  const [createdProcesses, setCreatedProcesses] = useState<ApiProcess[]>([]);
  const [createdRoutines, setCreatedRoutines] = useState<ApiRoutine[]>([]);
  const [createdTrainings, setCreatedTrainings] = useState<ApiTraining[]>([]);
  const [createdAnnouncements, setCreatedAnnouncements] = useState<ApiAnnouncement[]>([]);
  const [createdSetup, setCreatedSetup] = useState<OnboardingSetupResult | null>(null);
  const [comRead, setComRead] = useState(false);
  const [tplSegment, setTplSegment] = useState<string | TemplateFilterValue>("Todos");
  const [tplArea, setTplArea] = useState<string | TemplateFilterValue>("Todos");
  const [tplKind, setTplKind] = useState<ApiTemplateKind | TemplateFilterValue>("Todos");
  const [aiMode, setAiMode] = useState<CreateAiMode>("process");
  const [aiPreset, setAiPreset] = useState<CreateAiPreset>("process");
  const [aiInputMode, setAiInputMode] = useState<CreateAiInputMode>("text");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiPromptPlaceholder, setAiPromptPlaceholder] = useState(defaultAiPrompt);
  const [aiAttachments, setAiAttachments] = useState<CreateAiAttachment[]>([]);
  const [aiTemplateContext, setAiTemplateContext] = useState<BaaseTemplate | null>(null);
  const [aiGenerationState, setAiGenerationState] = useState<AiGenerationState | null>(null);
  const [aiAudioState, setAiAudioState] = useState<OnboardingAudioState>({ status: "idle" });
  const [obSegment, setObSegment] = useState("Agência de marketing");
  const [obMode, setObMode] = useState<"audio" | "texto">("audio");
  const [obAnswers, setObAnswers] = useState<Record<string, string>>(() => Object.fromEntries(onboardingQuestions.map((question) => [question, ""])));
  const audioRecordingsRef = useRef<Record<string, { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[] }>>({});
  const createAiRecordingRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[] } | null>(null);
  const [obAudioStates, setObAudioStates] = useState<Record<string, OnboardingAudioState>>({});
  const [onboardingSuggestion, setOnboardingSuggestion] = useState<OnboardingSuggestion | null>(null);
  const [onboardingAiRunId, setOnboardingAiRunId] = useState<string | null>(null);
  const [onboardingSession, setOnboardingSession] = useState<OnboardingSession | null>(null);
  const [onboardingSessionLoadError, setOnboardingSessionLoadError] = useState(false);
  const [onboardingSessionStatus, setOnboardingSessionStatus] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [onboardingDraft, setOnboardingDraft] = useState<OnboardingDraftState>(() => createEmptyOnboardingDraft());
  const [onboardingActionError, setOnboardingActionError] = useState<string | null>(null);
  const [onboardingReadyDismissed, setOnboardingReadyDismissed] = useState(false);

  useEffect(() => {
    if (!apiEnabled) {
      setBootstrapStatus("ready");
      return;
    }

    let cancelled = false;

    setBootstrapStatus("loading");
    setApiStatus("loading");
    setApiBundle(null);
    setSubmittedApiTasks({});
    setOnboardingSession(null);
    setOnboardingSessionLoadError(false);
    setOnboardingReadyDismissed(false);
    setOnboardingSessionStatus(role === "dono" ? "loading" : "unavailable");
    void loadFirstRunState(role, operationalDate)
      .then(({ bundle, onboardingSession, onboardingSessionLoadError }) => {
        if (cancelled) return;
        setApiBundle(bundle);
        setOperationalOverview(bundle.operationalOverview);
        setOperationalOverviewStatus("idle");
        setOnboardingSession(onboardingSession);
        setOnboardingSessionLoadError(onboardingSessionLoadError);
        setOnboardingDraft(createEmptyOnboardingDraft(onboardingSession));
        setOnboardingReadyDismissed(onboardingSession?.status === "completed");
        setOnboardingSessionStatus(role === "dono" ? "ready" : "unavailable");
        setApiStatus("ready");
        setBootstrapStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setApiStatus("error");
        setBootstrapStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [apiEnabled, bootstrapAttempt, role]);

  useEffect(() => {
    if (!accountMode || !apiBundle?.session) return;
    const authenticatedRole = uiRoleFromSession(apiBundle.session);
    if (role === authenticatedRole) return;
    const authenticatedHome = homeFor(authenticatedRole);
    setRoleState(authenticatedRole);
    setScreen(authenticatedHome);
    replaceOperationalScreen(authenticatedHome);
  }, [accountMode, apiBundle?.session, role]);

  useEffect(() => {
    if (!notice) return;

    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const liveWorkspaceMode = apiEnabled;
  const identity = identityFromSession(role, apiBundle?.session ?? null, liveWorkspaceMode);
  const workspaceName = onboardingSession?.companyName?.trim()
    || apiBundle?.session.workspace.name?.trim()
    || (liveWorkspaceMode ? "Sua empresa" : "Estúdio Norte");
  const workspaceSubtitle = onboardingSession?.normalizedSegment ?? onboardingSession?.customSegment ?? onboardingSession?.segment ?? "Base operacional";
  const liveWorkspaceLoaded = liveWorkspaceMode && apiBundle !== null;
  const [headerTitle] = titles[screen];
  const baseNav = navByRole[role];
  const sessionRole = accountMode && apiBundle?.session ? uiRoleFromSession(apiBundle.session) : null;
  const navigationRole = sessionRole ?? role;
  const navigationReady = !accountMode || sessionRole !== null;
  const canAccessStudio = navigationReady && role === "dono" && navigationRole === "dono";
  const roleNav = useMemo(
    () => canAccessStudio ? baseNav : baseNav.filter((item) => item.key !== "estudio"),
    [baseNav, canAccessStudio]
  );
  const visibleProcesses = useMemo(() => {
    const loaded = apiBundle?.processes ?? [];
    return [...createdProcesses, ...loaded.filter((process) => !createdProcesses.some((created) => created.id === process.id))];
  }, [apiBundle?.processes, createdProcesses]);
  const visibleRoutines = useMemo(() => {
    const loaded = apiBundle?.routines ?? [];
    return [...createdRoutines, ...loaded.filter((routine) => !createdRoutines.some((created) => created.id === routine.id))];
  }, [apiBundle?.routines, createdRoutines]);
  const visibleTrainings = useMemo(() => {
    const loaded = apiBundle?.trainings ?? [];
    return [...createdTrainings, ...loaded.filter((training) => !createdTrainings.some((created) => created.id === training.id))];
  }, [apiBundle?.trainings, createdTrainings]);
  const visibleTemplates = useMemo(() => {
    const loaded = apiBundle?.templates ?? [];
    return loaded.length ? loaded : baaseTemplates;
  }, [apiBundle?.templates]);
  const visibleAnnouncements = useMemo(() => {
    const loaded = apiBundle?.announcements ?? [];
    return [...createdAnnouncements, ...loaded.filter((announcement) => !createdAnnouncements.some((created) => created.id === announcement.id))];
  }, [apiBundle?.announcements, createdAnnouncements]);
  const pendingTrainingAssignments = useMemo(() => {
    return (apiBundle?.trainingAssignments ?? []).filter((assignment) => assignment.status !== "completed");
  }, [apiBundle?.trainingAssignments]);
  const pendingAnnouncements = useMemo(() => {
    return visibleAnnouncements.filter((announcement) => announcement.receipt?.status === "pending");
  }, [visibleAnnouncements]);
  const canManageOperationalTasks = role !== "func";
  const canManageWorkspace = role === "dono" || (role === "gestor" && apiBundle?.session.profile.access_scope === "workspace");
  const canAdministerCompany = role === "dono";
  const nav = useMemo(() => {
    if (!liveWorkspaceMode) return roleNav;

    return roleNav.map((item) => {
      if (item.key === "treinamentos") {
        return pendingTrainingAssignments.length ? { ...item, badge: String(pendingTrainingAssignments.length) } : { ...item, badge: undefined };
      }
      if (item.key === "comunicados") {
        return pendingAnnouncements.length ? { ...item, badge: String(pendingAnnouncements.length) } : { ...item, badge: undefined };
      }
      return { ...item, badge: undefined };
    });
  }, [liveWorkspaceMode, pendingAnnouncements.length, pendingTrainingAssignments.length, roleNav]);
  const notificationItems = useMemo<NotificationItem[]>(() => {
    if (!liveWorkspaceMode) {
      return [
        { title: "3 evidências aguardando aprovação", meta: "Revise tarefas enviadas pela equipe", screen: "painel-gestor", tone: "warn" },
        { title: "Financeiro sem rotina publicada", meta: "Sugestão disponível na biblioteca", screen: "modelos", tone: "danger" },
        { title: "Comunicado com leitura pendente", meta: "Cobrar confirmação da equipe", screen: "comunicados", tone: "info" }
      ];
    }

    const items: NotificationItem[] = [];
    const approvalCount = (apiBundle?.approvals ?? []).filter((task) => task.status === "awaiting_approval").length;
    const lateTaskCount = apiBundle?.dashboard?.metrics?.lateTasks ?? 0;
    const approvalScreen: Screen = role === "gestor" ? "painel-gestor" : role === "func" ? "hoje" : "painel-dono";

    if (approvalCount > 0) {
      items.push({
        title: approvalCount === 1 ? "1 evidência aguardando aprovação" : `${approvalCount} evidências aguardando aprovação`,
        meta: "Revise tarefas enviadas pela equipe",
        screen: approvalScreen,
        tone: "warn"
      });
    }

    if (lateTaskCount > 0) {
      items.push({
        title: lateTaskCount === 1 ? "1 tarefa atrasada" : `${lateTaskCount} tarefas atrasadas`,
        meta: "Veja atrasos e rotinas críticas",
        screen: "rotinas",
        tone: "danger"
      });
    }

    if (pendingAnnouncements.length > 0) {
      items.push({
        title: pendingAnnouncements.length === 1 ? "1 comunicado pendente" : `${pendingAnnouncements.length} comunicados pendentes`,
        meta: "Confirmações de leitura aguardando",
        screen: "comunicados",
        tone: "info"
      });
    }

    if (pendingTrainingAssignments.length > 0) {
      items.push({
        title: pendingTrainingAssignments.length === 1 ? "1 treinamento pendente" : `${pendingTrainingAssignments.length} treinamentos pendentes`,
        meta: "Acompanhe treinamentos da equipe",
        screen: "treinamentos",
        tone: "warn"
      });
    }

    return items;
  }, [apiBundle?.approvals, apiBundle?.dashboard?.metrics?.lateTasks, liveWorkspaceMode, pendingAnnouncements.length, pendingTrainingAssignments.length, role]);
  const companyAreas = useMemo(() => {
    const loaded = apiBundle?.areas ?? [];
    return [...customAreas, ...loaded.filter((area) => !customAreas.some((created) => created.id === area.id))];
  }, [apiBundle?.areas, customAreas]);
  const companyRoleTemplates = useMemo(() => {
    const loaded = apiBundle?.roleTemplates ?? [];
    return [...createdRoleTemplates, ...loaded.filter((roleTemplate) => !createdRoleTemplates.some((created) => created.id === roleTemplate.id))];
  }, [apiBundle?.roleTemplates, createdRoleTemplates]);
  const companyPeople = useMemo(() => {
    const loaded = apiBundle?.people ?? [];
    return [...createdPeople, ...loaded.filter((person) => !createdPeople.some((created) => created.id === person.id))];
  }, [apiBundle?.people, createdPeople]);
  const companyInvites = useMemo(() => {
    const loaded = apiBundle?.invites ?? [];
    return [...createdInvites, ...loaded.filter((invite) => !createdInvites.some((created) => created.id === invite.id))];
  }, [apiBundle?.invites, createdInvites]);
  const visibleAreas = useMemo(() => {
    if (companyAreas.length) return companyAreaRows(companyAreas, companyRoleTemplates, companyPeople);
    if (createdSetup) return setupAreaRows(createdSetup);
    if (liveWorkspaceMode) return [];
    return mergeAreaRows(setupAreaRows(null), customAreas);
  }, [companyAreas, companyRoleTemplates, companyPeople, createdSetup, customAreas, liveWorkspaceMode]);
  const visiblePeople = useMemo(() => {
    if (companyPeople.length) return companyTeamRows(companyPeople, companyAreas, companyRoleTemplates);
    if (createdSetup) return setupTeamRows(createdSetup);
    if (liveWorkspaceMode) return [];
    return setupTeamRows(null);
  }, [companyPeople, companyAreas, companyRoleTemplates, createdSetup, liveWorkspaceMode]);
  const workspaceIsEmpty = liveWorkspaceLoaded
    && companyAreas.length === 0
    && companyPeople.length === 0
    && visibleProcesses.length === 0
    && visibleRoutines.length === 0;
  const shouldShowFirstRunOnboarding = role === "dono"
    && onboardingSessionStatus === "ready"
    && !onboardingReadyDismissed
    && onboardingSession?.status !== "skipped"
    && (onboardingSession?.status === "completed" || workspaceIsEmpty);

  function setRole(nextRole: Role) {
    if (accountMode) return;
    const nextHome = homeFor(nextRole);
    setRoleState(nextRole);
    setScreen(nextHome);
    replaceOperationalScreen(nextHome);
    setMenuOpen(false);
    setOperationalPersonId(null);
  }

  function go(nextScreen: Screen) {
    if (nextScreen === "estudio" && !canAccessStudio) {
      showNotice("Esta área não está disponível para o seu perfil.");
      return;
    }
    const isRoleNavigation = navByRole[role].some((item) => item.key === nextScreen);
    const isOperationalPerson = nextScreen === "pessoa-operacional" && role !== "func";
    const isOwnerWorkflow = role === "dono" && (nextScreen === "onboarding" || nextScreen === "revisao");
    if (!isRoleNavigation && !isOperationalPerson && !isOwnerWorkflow) {
      showNotice("Esta área não está disponível para o seu perfil.");
      return;
    }
    setScreen(nextScreen);
    updateOperationalUrl({ screen: nextScreen, personId: nextScreen === "pessoa-operacional" ? operationalPersonId : null });
    setMenuOpen(false);
  }

  useEffect(() => {
    function restoreScreenFromUrl(event?: Event) {
      if (!navigationReady) return;
      const candidate = window.location.hash.slice(1).split("/")[0] as Screen;
      if (!candidate) {
        if (!event) return;
        const safeScreen = homeFor(navigationRole);
        setScreen(safeScreen);
        replaceOperationalScreen(safeScreen);
        return;
      }
      const allowed = (candidate !== "estudio" || canAccessStudio)
        && (navByRole[navigationRole].some((item) => item.key === candidate)
          || (candidate === "pessoa-operacional" && navigationRole !== "func"));
      if (allowed) {
        setScreen(candidate);
        return;
      }
      const safeScreen = homeFor(navigationRole);
      setScreen(safeScreen);
      replaceOperationalScreen(safeScreen);
    }
    restoreScreenFromUrl();
    window.addEventListener("popstate", restoreScreenFromUrl);
    window.addEventListener("hashchange", restoreScreenFromUrl);
    return () => {
      window.removeEventListener("popstate", restoreScreenFromUrl);
      window.removeEventListener("hashchange", restoreScreenFromUrl);
    };
  }, [canAccessStudio, navigationReady, navigationRole]);

  function readOverviewForPeriod(nextPeriod: OperationalPeriod) {
    if (!apiEnabled || role === "func") return;
    setOperationalOverviewStatus("loading");
    void readOperationalOverview(role, nextPeriod)
      .then((overview) => {
        if (!isOperationalOverview(overview)) throw new Error("INVALID_OPERATIONAL_OVERVIEW");
        setOperationalOverview(overview);
        setOperationalOverviewStatus("idle");
      })
      .catch(() => setOperationalOverviewStatus("error"));
  }

  function readPersonOverviewForPeriod(profileId: string, nextPeriod: OperationalPeriod) {
    if (!apiEnabled || role === "func") return;
    setPersonOperationalOverviewStatus("loading");
    void readPersonOperationalOverview(role, profileId, nextPeriod)
      .then((overview) => {
        if (!isOperationalOverview(overview)) throw new Error("INVALID_PERSON_OPERATIONAL_OVERVIEW");
        setPersonOperationalOverview(overview);
        setPersonOperationalOverviewStatus("idle");
      })
      .catch(() => setPersonOperationalOverviewStatus("error"));
  }

  function selectOperationalPeriod(preset: Exclude<OperationalPeriodPreset, "custom">) {
    const nextPeriod = periodForPreset(preset, operationalPeriod.to);
    setOperationalPeriodPreset(preset);
    setOperationalPeriod(nextPeriod);
    updateOperationalUrl({ period: nextPeriod });
    readOverviewForPeriod(nextPeriod);
    if (operationalPersonId) readPersonOverviewForPeriod(operationalPersonId, nextPeriod);
  }

  function applyCustomOperationalPeriod(nextPeriod: OperationalPeriod) {
    if (!nextPeriod.from || !nextPeriod.to || nextPeriod.from > nextPeriod.to) return;
    setOperationalPeriodPreset("custom");
    setOperationalPeriod(nextPeriod);
    updateOperationalUrl({ period: nextPeriod });
    readOverviewForPeriod(nextPeriod);
    if (operationalPersonId) readPersonOverviewForPeriod(operationalPersonId, nextPeriod);
  }

  function openOperationalPerson(profileId: string) {
    if (role === "func") return;
    setOperationalPersonId(profileId);
    setPersonOperationalOverview(null);
    setScreen("pessoa-operacional");
    updateOperationalUrl({ screen: "pessoa-operacional", period: operationalPeriod, personId: profileId });
    setMenuOpen(false);
    readPersonOverviewForPeriod(profileId, operationalPeriod);
  }

  function openOperationalTask(taskId: string) {
    if (role === "func") return;
    void readTask(role, taskId)
      .then(setOperationalTaskDetail)
      .catch(() => showNotice("Não foi possível abrir esta tarefa. Verifique o acesso e tente novamente."));
  }

  function openOperationalAnnouncement(announcementId: string) {
    if (role === "func") return;
    void readAnnouncements(role)
      .then((announcements) => {
        setApiBundle((current) => current ? { ...current, announcements } : current);
        setSelectedOperationalAnnouncementId(announcementId);
        go("comunicados");
      })
      .catch(() => showNotice("Não foi possível abrir este comunicado. Verifique o acesso e tente novamente."));
  }

  const taskRows = useMemo(() => {
    const loadedTasks = apiBundle?.tasks;
    if (loadedTasks?.length) {
      const taskAreaNames = areaNameMap(companyAreas);
      return loadedTasks.map((task): TodayTaskRow => {
        const areaName = task.areaId
          ? areaLabel(task.areaId, taskAreaNames, task.areaNameSnapshot)
          : null;
        const assigneeName = task.assigneeProfileId ? companyPeople.find((person) => person.id === task.assigneeProfileId)?.name : null;
        const originLabel = task.origin === "manual" || !task.routineId ? "Tarefa pontual" : task.processId ? "Processo vinculado" : "Rotina";
        const meta = [originLabel, areaName, assigneeName, task.dueHint ?? task.dueDate ?? operationalDate].filter(Boolean).join(" · ");

        return {
          id: `api-${task.id}`,
          apiId: task.id,
          origin: task.origin,
          routineId: task.routineId,
          routineTitle: task.routineTitleSnapshot ?? apiBundle?.routines.find((routine) => routine.id === task.routineId)?.title ?? null,
          label: task.title,
          meta,
          evid: taskNeedsEvidence(task),
          done: submittedApiTasks[task.id] ?? isTaskDone(task),
          status: task.status,
          approvalMode: task.approvalMode,
          evidencePolicy: task.evidencePolicy,
          reviewComment: task.reviewComment,
          areaId: task.areaId,
          assigneeProfileId: task.assigneeProfileId,
          dueDate: task.dueDate,
          dueHint: task.dueHint,
          checklistItems: task.checklistItems,
          submitting: submittingTasks[task.id]
        };
      });
    }
    if (liveWorkspaceMode) return [];

    return [
      { id: "t1", label: "Enviar peças finais — campanha Loja Vitta", meta: "Criação · vence 12:00", prio: "Alta", evid: true },
      { id: "t2", label: "Atualizar board do cliente Café Aurora", meta: "Atendimento · vence 15:00", prio: "Média", evid: false },
      { id: "t3", label: "Revisar copy do anúncio — Loja Vitta", meta: "Criação · vence 17:00", prio: "Média", evid: false },
      { id: "t4", label: "Publicar carrossel — Café Aurora", meta: "Criação · vence 18:00", prio: "Baixa", evid: true }
    ].map((task) => ({ ...task, done: Boolean(tasks[task.id]) })) satisfies TodayTaskRow[];
  }, [apiBundle?.tasks, companyAreas, companyPeople, liveWorkspaceMode, submittedApiTasks, submittingTasks, tasks]);

  const checkRows = useMemo(() => {
    return [
      { id: "c1", label: "Verificar agenda de postagens do dia" },
      { id: "c2", label: "Conferir aprovações pendentes do cliente" },
      { id: "c3", label: "Responder comentários e DMs prioritários" },
      { id: "c4", label: "Atualizar planilha de status dos clientes" },
      { id: "c5", label: "Registrar evidência da abertura" }
    ].map((check) => ({ ...check, done: Boolean(checks[check.id]) }));
  }, [checks]);
  const checkDone = checkRows.filter((check) => check.done).length;
  const checkPct = `${Math.round((checkDone / checkRows.length) * 100)}%`;

  function toggleTask(task: TodayTaskRow) {
    const apiId = task.apiId;
    if (!apiId) {
      setTasks((current) => ({ ...current, [task.id]: !current[task.id] }));
      return;
    }

    if (submittingTasks[apiId]) return;
    setExecutionTask(task);
  }

  async function handleSubmitExecution(task: TodayTaskRow, evidence: { comment?: string | null; file?: File | null }) {
    const apiId = task.apiId;
    if (!apiId || submittingTasks[apiId]) return;

    setSubmittingTasks((current) => ({ ...current, [apiId]: true }));
    try {
      if (evidence.file) await uploadTaskEvidence(role, apiId, evidence.file);
      const updatedTask = await submitTaskExecution(role, apiId, { comment: evidence.comment });
      setSubmittedApiTasks((current) => ({ ...current, [apiId]: isTaskDone(updatedTask) }));
      setApiBundle((current) => {
        if (!current) return current;
        return {
          ...current,
          tasks: current.tasks.map((currentTask) => currentTask.id === updatedTask.id ? updatedTask : currentTask)
        };
      });
      setApiStatus("ready");
      setExecutionTask(null);
    } finally {
      setSubmittingTasks((current) => ({ ...current, [apiId]: false }));
    }
  }

  function handleSaveTask(input: TaskFormInput) {
    void runAction(async () => {
      const task = input.id ? await updateTask(role, input.id, input) : await createTask(role, input);
      setApiBundle((current) => {
        if (!current) return current;
        return {
          ...current,
          tasks: input.id
            ? current.tasks.map((currentTask) => currentTask.id === task.id ? task : currentTask)
            : [task, ...current.tasks.filter((currentTask) => currentTask.id !== task.id)],
          approvals: current.approvals.map((currentTask) => currentTask.id === task.id ? task : currentTask)
        };
      });
      setCrudModal(null);
      showNotice(input.id ? "Tarefa pontual atualizada." : "Tarefa pontual criada.");
    });
  }

  function handleEditExecutionTask(task: TodayTaskRow) {
    const apiTask = apiBundle?.tasks.find((currentTask) => currentTask.id === task.apiId);
    if (!apiTask) return;
    setExecutionTask(null);
    setCrudModal({ kind: "task", mode: "edit", task: apiTask });
  }

  async function handleUpdateExecutionChecklist(task: TodayTaskRow, checklistItems: NonNullable<ApiTask["checklistItems"]>) {
    const apiId = task.apiId;
    if (!apiId) return;

    await runAction(async () => {
      const updatedTask = await updateTaskChecklist(role, apiId, checklistItems);
      setApiBundle((current) => {
        if (!current) return current;
        return {
          ...current,
          tasks: current.tasks.map((currentTask) => currentTask.id === updatedTask.id ? updatedTask : currentTask),
          approvals: current.approvals.map((currentTask) => currentTask.id === updatedTask.id ? updatedTask : currentTask)
        };
      });
      setExecutionTask((current) => current?.apiId === updatedTask.id ? {
        ...current,
        checklistItems: updatedTask.checklistItems,
        status: updatedTask.status,
        done: isTaskDone(updatedTask)
      } : current);
    }, () => showNotice("Não foi possível atualizar o checklist. Tente novamente."));
  }

  function handleDeleteExecutionTask(task: TodayTaskRow) {
    const apiId = task.apiId;
    if (!apiId) return;
    const confirmed = window.confirm(`Excluir a tarefa "${task.label}"?`);
    if (!confirmed) return;

    void runAction(async () => {
      await deleteTask(role, apiId);
      setApiBundle((current) => {
        if (!current) return current;
        return {
          ...current,
          tasks: current.tasks.filter((currentTask) => currentTask.id !== apiId),
          approvals: current.approvals.filter((currentTask) => currentTask.id !== apiId)
        };
      });
      setExecutionTask(null);
      showNotice("Tarefa excluída.");
    });
  }

  function appendOperationalContent(input: {
    process?: ApiProcess;
    processes?: ApiProcess[];
    routine?: ApiRoutine;
    routines?: ApiRoutine[];
    training?: ApiTraining;
    trainings?: ApiTraining[];
    announcement?: ApiAnnouncement;
    announcements?: ApiAnnouncement[];
  }) {
    const nextProcesses = [...(input.processes ?? []), ...(input.process ? [input.process] : [])];
    const nextRoutines = [...(input.routines ?? []), ...(input.routine ? [input.routine] : [])];
    const nextTrainings = [...(input.trainings ?? []), ...(input.training ? [input.training] : [])];
    const nextAnnouncements = [...(input.announcements ?? []), ...(input.announcement ? [input.announcement] : [])];

    if (nextProcesses.length) {
      setCreatedProcesses((current) => [...nextProcesses, ...current.filter((process) => !nextProcesses.some((created) => created.id === process.id))]);
    }
    if (nextRoutines.length) {
      setCreatedRoutines((current) => [...nextRoutines, ...current.filter((routine) => !nextRoutines.some((created) => created.id === routine.id))]);
    }
    if (nextTrainings.length) {
      setCreatedTrainings((current) => [...nextTrainings, ...current.filter((training) => !nextTrainings.some((created) => created.id === training.id))]);
    }
    if (nextAnnouncements.length) {
      setCreatedAnnouncements((current) => [...nextAnnouncements, ...current.filter((announcement) => !nextAnnouncements.some((created) => created.id === announcement.id))]);
    }

    setApiBundle((current) => {
      if (!current) return current;
      return {
        ...current,
        processes: nextProcesses.length ? [...nextProcesses, ...current.processes.filter((process) => !nextProcesses.some((created) => created.id === process.id))] : current.processes,
        routines: nextRoutines.length ? [...nextRoutines, ...current.routines.filter((routine) => !nextRoutines.some((created) => created.id === routine.id))] : current.routines,
        trainings: nextTrainings.length ? [...nextTrainings, ...current.trainings.filter((training) => !nextTrainings.some((created) => created.id === training.id))] : current.trainings,
        announcements: nextAnnouncements.length ? [...nextAnnouncements, ...current.announcements.filter((announcement) => !nextAnnouncements.some((created) => created.id === announcement.id))] : current.announcements
      };
    });
  }

  function replaceApprovalTask(updatedTask: ApiTask) {
    setApiBundle((current) => {
      if (!current) return current;
      return {
        ...current,
        approvals: current.approvals.map((task) => task.id === updatedTask.id ? updatedTask : task)
      };
    });
  }

  function handleApproveTask(task: ApiTask) {
    void runAction(async () => {
      replaceApprovalTask(await approveTask(role, task.id));
    });
  }

  function handleReturnTask(task: ApiTask, comment: string) {
    void runAction(async () => {
      replaceApprovalTask(await returnTask(role, task.id, comment));
      setReturningTask(null);
    });
  }

  async function runAction(action: () => Promise<void>, onError?: (error: unknown) => void) {
    setActionBusy(true);
    try {
      await action();
      setApiStatus("ready");
    } catch (error) {
      if (!apiBundle) setApiStatus("error");
      if (onError) onError(error);
      else setNotice(error instanceof Error && error.message ? error.message : "Não foi possível concluir esta ação. Tente novamente.");
    } finally {
      setActionBusy(false);
    }
  }

  function showNotice(message: string) {
    setNotice(message);
  }

  function clearLocalWorkspaceOverrides() {
    setCustomAreas([]);
    setCreatedRoleTemplates([]);
    setCreatedPeople([]);
    setCreatedInvites([]);
    setCreatedProcesses([]);
    setCreatedRoutines([]);
    setCreatedTrainings([]);
    setCreatedAnnouncements([]);
    setCreatedSetup(null);
  }

  async function reloadWorkspaceBundle() {
    const bundle = await loadBaaseWorkspace(role, operationalDate, fetch, operationalPeriod);
    clearLocalWorkspaceOverrides();
    setSubmittedApiTasks({});
    setApiBundle(bundle);
    setOperationalOverview(bundle.operationalOverview);
    setOperationalOverviewStatus("idle");
    if (operationalPersonId) {
      if (bundle.people.some((person) => person.id === operationalPersonId)) {
        setPersonOperationalOverview(null);
        readPersonOverviewForPeriod(operationalPersonId, operationalPeriod);
      } else {
        setOperationalPersonId(null);
        setPersonOperationalOverview(null);
        setPersonOperationalOverviewStatus("idle");
      }
    }
    setApiStatus("ready");
    return bundle;
  }

  function startOnboardingSession() {
    void runAction(async () => {
      setOnboardingActionError(null);
      const session = await createOnboardingSession(role);
      setOnboardingSession(session);
      setOnboardingSessionLoadError(false);
      setOnboardingDraft(createEmptyOnboardingDraft(session));
      setOnboardingSessionStatus("ready");
    }, () => setOnboardingActionError("Não conseguimos iniciar o onboarding agora. Tente novamente."));
  }

  function patchOnboardingDraft(patch: Partial<OnboardingDraftState> & { currentStep?: string }) {
    setOnboardingActionError(null);
    const next = { ...onboardingDraft, ...patch };
    const normalizedSegment = next.segment === "Outro" ? next.customSegment : next.segment;
    setOnboardingDraft(next);
    void patchOnboardingSession(role, {
      currentStep: patch.currentStep ?? next.currentStep,
      companyName: next.companyName,
      segment: next.segment,
      customSegment: next.customSegment,
      normalizedSegment,
      teamSizeRange: next.teamSizeRange,
      goals: next.goals,
      mainAnswers: next.answers
    })
      .then((session) => {
        setOnboardingSession(session);
        setOnboardingSessionStatus("ready");
      })
      .catch(() => showNotice("Não conseguimos salvar o onboarding agora."));
  }

  async function persistOnboardingDraft(currentStep = onboardingDraft.currentStep) {
    const normalizedSegment = onboardingDraft.segment === "Outro" ? onboardingDraft.customSegment : onboardingDraft.segment;
    const session = await patchOnboardingSession(role, {
      currentStep,
      companyName: onboardingDraft.companyName,
      segment: onboardingDraft.segment,
      customSegment: onboardingDraft.customSegment,
      normalizedSegment,
      teamSizeRange: onboardingDraft.teamSizeRange,
      goals: onboardingDraft.goals,
      mainAnswers: onboardingDraft.answers
    });
    setOnboardingSession(session);
    setOnboardingSessionStatus("ready");
    return session;
  }

  function generateOnboardingDiagnosisFromDraft() {
    void runAction(async () => {
      setOnboardingActionError(null);
      const persisted = await persistOnboardingDraft("conversation");
      setOnboardingSession({ ...persisted, currentStep: "generating_diagnosis" });
      setOnboardingDraft((current) => ({ ...current, currentStep: "generating_diagnosis" }));
      const session = await generateOnboardingDiagnosis(role);
      setOnboardingSession(session);
      setOnboardingDraft(createEmptyOnboardingDraft(session));
    }, () => {
      setOnboardingActionError("Não conseguimos entender sua empresa agora. Tente novamente em alguns segundos.");
      setOnboardingSession((current) => current ? { ...current, currentStep: "conversation" } : current);
      setOnboardingDraft((current) => ({ ...current, currentStep: "conversation" }));
    });
  }

  function saveOnboardingFollowup(input: { questionId: string; question: string; answer: string; inputMode: "text" | "audio" }) {
    void runAction(async () => {
      setOnboardingActionError(null);
      const session = await saveOnboardingFollowupAnswer(role, input);
      setOnboardingSession(session);
      setOnboardingDraft(createEmptyOnboardingDraft(session));
    }, () => setOnboardingActionError("Não conseguimos salvar essa resposta agora. Tente novamente."));
  }

  function generateOnboardingSetupFromSession() {
    void runAction(async () => {
      setOnboardingActionError(null);
      setOnboardingSession((current) => current ? { ...current, status: "generating_setup", currentStep: "generating_setup" } : current);
      const session = await generateOnboardingSetup(role);
      setOnboardingSession(session);
      setOnboardingDraft(createEmptyOnboardingDraft(session));
    }, () => {
      setOnboardingActionError("Não conseguimos gerar a primeira versão agora. Tente novamente em alguns segundos.");
      setOnboardingSession((current) => current ? { ...current, currentStep: "diagnosis" } : current);
    });
  }

  function saveOnboardingDecision(input: Parameters<typeof saveOnboardingReviewDecision>[1]) {
    void runAction(async () => {
      const session = await saveOnboardingReviewDecision(role, input);
      setOnboardingSession(session);
      setOnboardingDraft(createEmptyOnboardingDraft(session));
    });
  }

  function completeOnboarding() {
    void runAction(async () => {
      const session = await completeOnboardingSession(role);
      setOnboardingSession(session);
      setOnboardingDraft(createEmptyOnboardingDraft(session));
      setOnboardingReadyDismissed(false);
      await reloadWorkspaceBundle();
    });
  }

  function goToPanelAfterOnboarding() {
    setOnboardingReadyDismissed(true);
    go("painel-dono");
  }

  function skipOnboarding() {
    void runAction(async () => {
      const session = await skipOnboardingSession(role);
      setOnboardingSession(session);
      setOnboardingSessionStatus("ready");
      showNotice("Você pode retomar o onboarding quando quiser.");
    });
  }

  function resumeOnboardingFromDashboard() {
    setOnboardingSession(null);
    setOnboardingDraft(createEmptyOnboardingDraft());
    setOnboardingSessionStatus("ready");
  }

  function handleSaveArea(input: { id?: string; name: string; description: string }) {
    void runAction(async () => {
      const area = input.id
        ? await updateArea(role, input.id, {
          name: input.name,
          description: input.description
        })
        : await createArea(role, {
          name: input.name,
          description: input.description
        });
      setCustomAreas((current) => [area, ...current.filter((item) => item.id !== area.id)]);
      setCrudModal(null);
      showNotice(input.id ? `Área ${area.name} atualizada.` : `Área ${area.name} criada.`);
    });
  }

  function handleDeleteArea(area: AreaDisplayRow) {
    if (!area.id) return;
    const areaId = area.id;
    void runAction(async () => {
      const impact = await getAreaImpact(role, areaId);
      if (!impact) throw new Error("Área não encontrada.");
      setAreaArchiveDialog({ area, impact });
    });
  }

  function handleConfirmAreaArchive(resolution: { strategy: "reassign"; targetAreaId: string } | { strategy: "unassign" }) {
    if (!areaArchiveDialog?.area.id) return;
    const area = areaArchiveDialog.area;
    void runAction(async () => {
      await archiveArea(role, area.id!, resolution);
      await reloadWorkspaceBundle();
      setAreaArchiveDialog(null);
      setCrudModal(null);
      showNotice(`Área ${area.name} arquivada.`);
    });
  }

  function handleSaveRoleTemplate(input: { areaId: string; name: string; description: string }) {
    void runAction(async () => {
      const roleTemplate = await createRoleTemplate(role, {
        areaId: input.areaId,
        name: input.name,
        description: input.description
      });
      setCreatedRoleTemplates((current) => [roleTemplate, ...current.filter((item) => item.id !== roleTemplate.id)]);
      setCrudModal(null);
      showNotice(`Cargo ${roleTemplate.name} criado.`);
    });
  }

  function handleDeleteRoleTemplate(roleTemplate: AreaRoleDisplayRow) {
    if (!roleTemplate.id) return;
    const roleTemplateId = roleTemplate.id;
    const confirmed = window.confirm(`Excluir o cargo "${roleTemplate.name}"? As pessoas vinculadas continuarão na área, mas sem esse cargo.`);
    if (!confirmed) return;

    void runAction(async () => {
      await deleteRoleTemplate(role, roleTemplateId);
      await reloadWorkspaceBundle();
      showNotice(`Cargo ${roleTemplate.name} excluído.`);
    });
  }

  function handleSavePerson(input: { id?: string; name: string; email: string; role: ApiPerson["role"]; areaId?: string | null; areaAccessIds?: string[]; roleTemplateId?: string | null; accessScope?: "workspace" | "area" | "assigned_only"; status?: string }) {
    void runAction(async () => {
      const person = input.id
        ? await updatePerson(role, input.id, {
          name: input.name,
          email: input.email,
          role: input.role,
          areaId: input.areaId,
          areaAccessIds: input.areaAccessIds,
          roleTemplateId: input.roleTemplateId,
          accessScope: input.accessScope,
          status: input.status
        })
        : await createPerson(role, {
          name: input.name,
          email: input.email,
          role: input.role,
          areaId: input.areaId,
          areaAccessIds: input.areaAccessIds,
          roleTemplateId: input.roleTemplateId
          ,accessScope: input.accessScope
        });
      setCreatedPeople((current) => [person, ...current.filter((item) => item.id !== person.id)]);
      setCrudModal(null);
      showNotice(input.id ? `${person.name} atualizado.` : `${person.name} entrou na equipe.`);
    });
  }

  function handleDeletePerson(person: ApiPerson) {
    const confirmed = window.confirm(`Excluir ${person.name} da equipe?`);
    if (!confirmed) return;

    void runAction(async () => {
      await deletePerson(role, person.id);
      setCreatedPeople((current) => current.filter((item) => item.id !== person.id));
      setApiBundle((current) => current ? {
        ...current,
        people: current.people.filter((item) => item.id !== person.id)
      } : current);
      setCrudModal(null);
      showNotice(`${person.name} excluído da equipe.`);
    });
  }

  function handleRunProactiveSuggestion(suggestion: ApiProactiveSuggestion) {
    const nextMode = modeFromSuggestion(suggestion);
    if (!nextMode) {
      go(screenFromSuggestion(suggestion));
      return;
    }

    setAiMode(nextMode);
    setAiPreset(createAiPresetForMode(nextMode));
    setAiPrompt(suggestion.action.prompt);
    setAiInputMode("text");
    setAiAttachments([]);
    setAiAudioState({ status: "idle" });
    setAiTemplateContext(null);
    showNotice("Sugestão carregada no Criar com IA.");
    go("criar");
  }

  function stopCreateAiAudioStream() {
    const active = createAiRecordingRef.current;
    if (!active) return;
    active.stream.getTracks().forEach((track) => track.stop());
    createAiRecordingRef.current = null;
  }

  function handleToggleCreateAiRecording() {
    const active = createAiRecordingRef.current;
    if (active) {
      active.recorder.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setAiAudioState({
        status: "error",
        message: "Microfone indisponível neste navegador."
      });
      return;
    }

    void runAction(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream, selectAudioRecorderOptions());
        createAiRecordingRef.current = { recorder, stream, chunks };
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => {
          const audio = createRecordedAudioBlob(chunks, recorder);
          stopCreateAiAudioStream();
          if (audio.size === 0) {
            setAiAudioState({
              status: "error",
              message: "Não capturamos áudio."
            });
            return;
          }
          transcribeCreateAiRecording(audio);
        };
        recorder.start();
        setAiInputMode((current) => createAiInputModeWith(current, "audio"));
        setAiAudioState({
          status: "recording",
          message: "gravando"
        });
      } catch {
        setAiAudioState({
          status: "error",
          message: "Não foi possível acessar o microfone."
        });
      }
    });
  }

  function transcribeCreateAiRecording(audio: Blob) {
    void runAction(async () => {
      setAiAudioState({
        status: "transcribing",
        message: "transcrevendo"
      });

      try {
        const transcript = await transcribeAudioBlob(role, {
          source: "create_with_ai",
          audio,
          language: "pt-BR",
          keyterms: ["Prymeira Baase", "SOP", "processos", "rotinas", "evidências"]
        });
        const text = transcript.text.trim();
        if (!text) {
          setAiAudioState({
            status: "error",
            message: "A transcrição veio vazia."
          });
          return;
        }
        setAiPrompt((current) => {
          const existing = current.trim();
          return existing ? `${existing}\n\n${text}` : text;
        });
        setAiInputMode((current) => createAiInputModeWith(current, "audio"));
        setAiAudioState({
          status: "ready",
          message: "áudio transcrito"
        });
        showNotice("Áudio transcrito para o rascunho.");
      } catch {
        setAiAudioState({
          status: "error",
          message: "Não conseguimos transcrever agora."
        });
      }
    });
  }

  function handleAttachAiMaterial(file: File) {
    void runAction(async () => {
      if (!isSupportedAiMaterial(file)) {
        showNotice("Use PDF, TXT ou Markdown como material.");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showNotice("Material muito grande para este rascunho.");
        return;
      }

      const attachment: CreateAiAttachment = {
        name: file.name,
        mimeType: guessFileMimeType(file),
        contentBase64: await blobToBase64(file),
        size: file.size
      };
      setAiMode("training");
      setAiPreset("pdf_training");
      setAiPromptPlaceholder("Transformar um PDF em treinamento curto com quiz");
      setAiInputMode((current) => createAiInputModeWith(current, "pdf"));
      setAiAttachments([attachment]);
      setAiPrompt((current) => {
        const base = current.trim() || "Transformar material em treinamento operacional";
        return base.includes(file.name) ? base : `${base}\n\nMaterial anexado: ${file.name}`;
      });
      showNotice("Material anexado ao rascunho.");
    });
  }

  function handleRemoveAiAttachment(name: string) {
    setAiAttachments((current) => current.filter((attachment) => attachment.name !== name));
    setAiInputMode((current) => current === "pdf" ? "text" : current === "mixed" ? "audio" : current);
  }

  function resetCreateAiComposer() {
    stopCreateAiAudioStream();
    setAiMode("process");
    setAiPreset("process");
    setAiInputMode("text");
    setAiPrompt("");
    setAiPromptPlaceholder(defaultAiPrompt);
    setAiAttachments([]);
    setAiTemplateContext(null);
    setAiAudioState({ status: "idle" });
  }

  function handleGenerateAiContent(prompt: string, mode: CreateAiMode, inputMode: CreateAiInputMode, attachments: CreateAiAttachment[]) {
    void runAction(async () => {
      const promptText = prompt.trim() || aiPromptPlaceholder;
      setAiGenerationState({
        mode,
        phase: "draft",
        message: "Lendo o pedido, identificando área, etapas, evidências e pontos de revisão."
      });

      try {
        const draft = await generateAiDraft(role, {
          type: mode,
          inputMode,
          input: promptText,
          context: {
            workspaceName,
            sourceAttachments: attachments.map((attachment) => ({
              name: attachment.name,
              mimeType: attachment.mimeType,
              size: attachment.size
            })),
            template: aiTemplateContext ? {
              id: aiTemplateContext.id,
              title: aiTemplateContext.title,
              kind: aiTemplateContext.kind,
              segment: aiTemplateContext.segment,
              area: aiTemplateContext.area,
              adaptPrompt: aiTemplateContext.adaptPrompt
            } : null,
            areas: companyAreas.map((area) => ({ id: area.id, name: area.name })),
            roles: companyRoleTemplates.map((roleTemplate) => ({ id: roleTemplate.id, name: roleTemplate.name, areaId: roleTemplate.areaId }))
          },
          attachments
        });

        setAiGenerationState({
          mode,
          phase: "content",
          message: "Transformando a sugestão em conteúdo editável dentro da sua operação."
        });

        if (mode === "routine") {
          const routine = await createRoutine(role, routineInputFromAiDraft(draft, promptText));
          appendOperationalContent({ routine });
          resetCreateAiComposer();
          showNotice("Rotina criada como rascunho operacional.");
          go("rotinas");
          return;
        }

        if (mode === "training") {
          const training = await createTrainingDraft(role, trainingInputFromAiDraft(draft, promptText));
          appendOperationalContent({ training });
          resetCreateAiComposer();
          showNotice("Treinamento criado para revisão.");
          go("treinamentos");
          return;
        }

        if (mode === "announcement") {
          const announcement = await createAnnouncementDraft(role, announcementInputFromAiDraft(draft, promptText));
          appendOperationalContent({ announcement });
          resetCreateAiComposer();
          showNotice("Comunicado criado como rascunho.");
          go("comunicados");
          return;
        }

        const process = await createProcessDraft(role, processInputFromAiDraft(draft, promptText));
        appendOperationalContent({ process });
        resetCreateAiComposer();
        showNotice("Processo criado como rascunho.");
        go("processos");
      } catch (error) {
        showNotice("Não conseguimos gerar o rascunho agora. Tente novamente em alguns instantes.");
        throw error;
      } finally {
        setAiGenerationState(null);
      }
    });
  }

  function handleUseTemplate(template: BaaseTemplate) {
    void runAction(async () => {
      const result = await useLibraryTemplate(role, template.id);
      if (result.kind === "routine") {
        appendOperationalContent({ routine: result.routine });
        showNotice(`Modelo ${template.title} aplicado.`);
        go("rotinas");
        return;
      }

      if (result.kind === "training") {
        appendOperationalContent({ training: result.training });
        showNotice(`Modelo ${template.title} aplicado.`);
        go("treinamentos");
        return;
      }

      appendOperationalContent({ process: result.process });
      showNotice(`Modelo ${template.title} aplicado.`);
      go("processos");
    });
  }

  function handleAdaptTemplate(template: BaaseTemplate) {
    const nextMode = templateMode(template.kind);
    setAiMode(nextMode);
    setAiPreset(createAiPresetForMode(nextMode));
    setAiInputMode("text");
    setAiAttachments([]);
    setAiAudioState({ status: "idle" });
    setAiTemplateContext(template);
    setAiPrompt([
      `Adapte o modelo "${template.title}" para a minha empresa.`,
      `Tipo: ${templateKindLabel(template.kind)}.`,
      `Segmento base: ${segmentLabel(template.segment)}.`,
      `Área: ${template.area}.`,
      `Contexto do modelo: ${template.description}`,
      template.adaptPrompt ? `Orientação de adaptação: ${template.adaptPrompt}` : ""
    ].filter(Boolean).join("\n"));
    showNotice("Modelo carregado no Criar com IA.");
    go("criar");
  }

  function handleCommunicateProcessChange(process: ApiProcess) {
    void runAction(async () => {
      const announcement = await createAnnouncementDraft(role, {
        title: `Mudança no processo: ${process.title}`,
        body: `O processo ${process.title} foi atualizado. Revise o novo padrão antes da próxima execução.${process.summary ? ` Resumo: ${process.summary}` : ""}`,
        type: "process_change",
        requirement: "read_confirmation",
        audienceType: "all",
        relatedProcessId: process.id
      });
      appendOperationalContent({ announcement });
      showNotice("Comunicado de mudança criado.");
      go("comunicados");
    });
  }

  function handleCreateChecklistSuggestion() {
    void runAction(async () => {
      const routine = await createRoutine(role, {
        title: "Checklist de relatório semanal de mídia",
        areaId: "area_midia",
        taskTemplates: [
          { title: "Abrir resultados da semana", evidencePolicy: "comment_required", approvalMode: "direct" },
          { title: "Anexar print dos principais indicadores", evidencePolicy: "photo_required", approvalMode: "approval_required" },
          { title: "Registrar próximos ajustes", evidencePolicy: "comment_required", approvalMode: "direct" }
        ]
      });
      appendOperationalContent({ routine });
      showNotice("Checklist sugerido criado.");
      go("rotinas");
    });
  }

  function handleSaveProcess(input: {
    id?: string; title: string; summary: string; body: string; publish: boolean; areaId?: string | null;
    owner?: ApiProcess["owner"] | null; changeNote: string; links: Array<{ title: string; url: string }>; files: File[];
  }) {
    void runAction(async () => {
      let process: ApiProcess;
      if (input.id) {
        process = await updateProcess(role, input.id, {
          title: input.title,
          summary: input.summary,
          body: input.body,
          areaId: input.areaId,
          owner: input.owner,
          changeNote: input.changeNote,
          links: input.links
        });
      } else {
        const draft = await createProcessDraft(role, {
          title: input.title,
          body: input.body,
          summary: input.summary,
          areaId: input.areaId
        });
        process = input.owner || input.links.length
          ? await updateProcess(role, draft.id, {
            title: input.title,
            summary: input.summary,
            body: input.body,
            areaId: input.areaId,
            owner: input.owner,
            links: input.links,
            changeNote: "Define a configuração inicial do processo."
          })
          : draft;
        if (input.publish) process = await publishProcess(role, process.id);
      }
      for (const file of input.files) {
        const material = await uploadProcessMaterial(role, process.id, file);
        process = { ...process, materials: [...(process.materials ?? []), material] };
      }
      appendOperationalContent({ process });
      setCrudModal(null);
    });
  }

  function handleUnpublishProcess(process: ApiProcess) {
    void runAction(async () => {
      appendOperationalContent({ process: await unpublishProcess(role, process.id) });
    });
  }

  function handlePublishProcess(process: ApiProcess) {
    void runAction(async () => {
      appendOperationalContent({ process: await publishProcess(role, process.id) });
    });
  }

  function handleDeleteProcess(process: ApiProcess) {
    const confirmed = window.confirm(`Excluir o processo "${cleanProcessTitle(process.title)}"?`);
    if (!confirmed) return;

    void runAction(async () => {
      await deleteProcess(role, process.id);
      setCreatedProcesses((current) => current.filter((item) => item.id !== process.id));
      setApiBundle((current) => current ? {
        ...current,
        processes: current.processes.filter((item) => item.id !== process.id)
      } : current);
      showNotice(`Processo ${cleanProcessTitle(process.title)} excluído.`);
    });
  }

  function handleSaveRoutine(input: RoutineFormInput) {
    void runAction(async () => {
      const routine = input.id
        ? await updateRoutine(role, input.id, input)
        : await createRoutine(role, input);
      appendOperationalContent({ routine });
      setCrudModal(null);
    });
  }

  function handleArchiveRoutine(routine: ApiRoutine) {
    void runAction(async () => {
      appendOperationalContent({ routine: await archiveRoutine(role, routine.id) });
    });
  }

  function handleDeleteRoutine(routine: ApiRoutine) {
    const confirmed = window.confirm(`Excluir a rotina "${routine.title}"? As tarefas geradas por ela também serão removidas.`);
    if (!confirmed) return;

    void runAction(async () => {
      await deleteRoutine(role, routine.id);
      setCreatedRoutines((current) => current.filter((item) => item.id !== routine.id));
      setApiBundle((current) => current ? {
        ...current,
        routines: current.routines.filter((item) => item.id !== routine.id),
        tasks: current.tasks.filter((task) => task.routineId !== routine.id),
        approvals: current.approvals.filter((task) => task.routineId !== routine.id)
      } : current);
      showNotice(`Rotina ${routine.title} excluída.`);
    });
  }

  function handleSaveTraining(input: TrainingFormInput) {
    void runAction(async () => {
      if (input.id) {
        const updated = await updateTraining(role, input.id, {
          title: input.title,
          description: input.description,
          source: input.source,
          audience: input.audience,
          dueDate: input.dueDate,
          materials: input.materials,
          quizQuestions: input.quizQuestions
        });
        const training = input.publish && updated.status !== "published" ? await publishTraining(role, input.id) : updated;
        if (input.publish && input.audience && updated.status !== "published") {
          await assignTraining(role, input.id, trainingAssignmentInput(input.audience, input.dueDate));
        }
        appendOperationalContent({
          training
        });
      } else {
        const draft = await createTrainingDraft(role, {
          title: input.title,
          description: input.description,
          source: input.source,
          audience: input.audience,
          dueDate: input.dueDate,
          materials: input.materials,
          quizQuestions: input.quizQuestions
        });
        const training = input.publish ? await publishTraining(role, draft.id) : draft;
        if (input.publish && input.audience) {
          await assignTraining(role, draft.id, trainingAssignmentInput(input.audience, input.dueDate));
        }
        appendOperationalContent({ training });
      }
      setCrudModal(null);
    });
  }

  function handleUnpublishTraining(training: ApiTraining) {
    void runAction(async () => {
      appendOperationalContent({ training: await unpublishTraining(role, training.id) });
    });
  }

  function handleDeleteTraining(training: ApiTraining) {
    void runAction(async () => {
      await deleteTraining(role, training.id);
      setCreatedTrainings((current) => current.filter((item) => item.id !== training.id));
      setApiBundle((current) => current ? {
        ...current,
        trainings: current.trainings.filter((item) => item.id !== training.id),
        trainingAssignments: current.trainingAssignments.filter((assignment) => assignment.trainingId !== training.id)
      } : current);
    });
  }

  function handleSubmitTrainingQuiz(training: ApiTraining, answers: Array<{ questionId: string; optionId: string }>) {
    if (!answers.length) return;

    void runAction(async () => {
      const attempt = await submitTrainingQuizAttempt(role, training.id, answers);
      setApiBundle((current) => {
        if (!current) return current;
        return {
          ...current,
          trainingAssignments: current.trainingAssignments.map((assignment) => {
            if (assignment.trainingId !== training.id) return assignment;
            return {
              ...assignment,
              status: attempt.passed ? "completed" : assignment.status,
              score: attempt.score,
              passed: attempt.passed,
              completedAt: attempt.passed ? new Date().toISOString() : assignment.completedAt
            };
          })
        };
      });
    });
  }

  function handleSaveAnnouncement(input: AnnouncementFormInput) {
    void runAction(async () => {
      const draft = await createAnnouncementDraft(role, {
        title: input.title,
        body: input.body,
        type: input.type,
        requirement: input.requirement,
        audienceType: input.audience.type,
        areaId: input.audience.type === "area" ? input.audience.areaId : null,
        roleTemplateId: input.audience.type === "role" ? input.audience.roleTemplateId : null,
        profileId: input.audience.type === "person" ? input.audience.profileId : null,
        quizQuestions: input.requirement === "quiz_confirmation" ? input.quizQuestions : []
      });
      appendOperationalContent({ announcement: input.publish ? await publishAnnouncement(role, draft.id) : draft });
      setCrudModal(null);
    });
  }

  function handleConfirmAnnouncement(announcement: ApiAnnouncement, answers: Array<{ questionId: string; optionId: string }> = []) {
    void runAction(async () => {
      const receipt = await confirmAnnouncement(role, announcement.id, answers);
      const updatedAnnouncement = {
        ...announcement,
        receipt
      };
      appendOperationalContent({ announcement: updatedAnnouncement });
    });
  }

  function handleDeleteAnnouncement(announcement: ApiAnnouncement) {
    const confirmed = window.confirm(`Excluir o comunicado "${announcement.title}"?`);
    if (!confirmed) return;

    void runAction(async () => {
      await deleteAnnouncement(role, announcement.id);
      setCreatedAnnouncements((current) => current.filter((item) => item.id !== announcement.id));
      setApiBundle((current) => current ? {
        ...current,
        announcements: current.announcements.filter((item) => item.id !== announcement.id)
      } : current);
      showNotice(`Comunicado ${announcement.title} excluído.`);
    });
  }

  function handleCreateInvite(input: { name: string; email: string; role: "owner" | "manager" | "employee"; areaId: string; areaAccessIds: string[]; roleTemplateId: string; accessScope: "workspace" | "area" | "assigned_only" }) {
    void runAction(async () => {
      const invite = await createInvite(role, {
        name: input.name,
        email: input.email,
        role: input.role,
        areaId: input.areaId,
        areaAccessIds: input.areaAccessIds,
        roleTemplateId: input.roleTemplateId,
        accessScope: input.accessScope
      });
      setCreatedInvites((current) => [invite, ...current.filter((item) => item.id !== invite.id)]);
      setCrudModal(null);
      showNotice(`Convite enviado para ${input.email}.`);
    });
  }

  function handleDeleteInvite(invite: ApiInvite) {
    const confirmed = window.confirm(`Excluir o convite de ${invite.name ?? invite.code}?`);
    if (!confirmed) return;

    void runAction(async () => {
      await deleteInvite(role, invite.id);
      setCreatedInvites((current) => current.filter((item) => item.id !== invite.id));
      setApiBundle((current) => current ? {
        ...current,
        invites: current.invites.filter((item) => item.id !== invite.id)
      } : current);
      showNotice("Convite excluído.");
    });
  }

  function setQuestionAudioState(question: string, state: OnboardingAudioState) {
    setObAudioStates((current) => ({ ...current, [question]: state }));
  }

  function setOnboardingConversationAudioState(questionId: string, state: OnboardingAudioState) {
    setObAudioStates((current) => ({ ...current, [questionId]: state }));
  }

  function stopQuestionAudioStream(question: string) {
    const active = audioRecordingsRef.current[question];
    if (!active) return;
    active.stream.getTracks().forEach((track) => track.stop());
    delete audioRecordingsRef.current[question];
  }

  function updateOnboardingConversationAnswer(questionId: string, answer: string, inputMode: "text" | "audio") {
    const question = onboardingConversationQuestions.find((item) => item.id === questionId);
    if (!question) return;
    patchOnboardingDraft({
      currentStep: "conversation",
      answers: [
        ...onboardingDraft.answers.filter((item) => item.questionId !== question.id),
        {
          questionId: question.id,
          theme: question.theme,
          question: question.label,
          answer,
          inputMode
        }
      ]
    });
  }

  function handleToggleOnboardingConversationRecording(questionId: string) {
    const active = audioRecordingsRef.current[questionId];
    if (active) {
      active.recorder.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setOnboardingConversationAudioState(questionId, {
        status: "error",
        message: "microfone indisponível"
      });
      return;
    }

    void runAction(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream, selectAudioRecorderOptions());
        audioRecordingsRef.current[questionId] = { recorder, stream, chunks };
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => {
          const audio = createRecordedAudioBlob(chunks, recorder);
          stopQuestionAudioStream(questionId);
          if (audio.size === 0) {
            setOnboardingConversationAudioState(questionId, {
              status: "error",
              message: "áudio vazio"
            });
            return;
          }
          transcribeOnboardingConversationRecording(questionId, audio);
        };
        recorder.start();
        setOnboardingConversationAudioState(questionId, {
          status: "recording",
          message: "gravando"
        });
      } catch {
        setOnboardingConversationAudioState(questionId, {
          status: "error",
          message: "não foi possível acessar o microfone"
        });
      }
    });
  }

  function transcribeOnboardingConversationRecording(questionId: string, audio: Blob) {
    void runAction(async () => {
      setOnboardingConversationAudioState(questionId, {
        status: "transcribing",
        message: "transcrevendo"
      });

      try {
        const transcript = await transcribeAudioBlob(role, {
          source: "onboarding",
          audio,
          language: "pt-BR",
          keyterms: ["Prymeira Baase", "processos", "rotinas", "treinamentos", "áreas", "cargos"]
        });
        const answer = transcript.text.trim();
        if (!answer) {
          setOnboardingConversationAudioState(questionId, {
            status: "error",
            message: "transcrição vazia"
          });
          return;
        }
        updateOnboardingConversationAnswer(questionId, answer, "audio");
        setOnboardingConversationAudioState(questionId, {
          status: "ready",
          message: "transcrição salva"
        });
      } catch {
        setOnboardingConversationAudioState(questionId, {
          status: "error",
          message: "não conseguimos transcrever"
        });
        throw new Error("ONBOARDING_CONVERSATION_AUDIO_TRANSCRIPTION_FAILED");
      }
    });
  }

  function handleToggleQuestionRecording(question: string) {
    const active = audioRecordingsRef.current[question];
    if (active) {
      active.recorder.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setQuestionAudioState(question, {
        status: "error",
        message: "Microfone indisponível neste navegador. Use o modo texto."
      });
      return;
    }

    void runAction(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream, selectAudioRecorderOptions());
        audioRecordingsRef.current[question] = { recorder, stream, chunks };
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => {
          const audio = createRecordedAudioBlob(chunks, recorder);
          stopQuestionAudioStream(question);
          if (audio.size === 0) {
            setQuestionAudioState(question, {
              status: "error",
              message: "Não capturamos áudio. Tente gravar de novo ou escreva a resposta."
            });
            return;
          }
          transcribeQuestionRecording(question, audio);
        };
        recorder.start();
        setQuestionAudioState(question, {
          status: "recording",
          message: "gravando"
        });
      } catch {
        setQuestionAudioState(question, {
          status: "error",
          message: "Não foi possível acessar o microfone. Use o modo texto."
        });
      }
    });
  }

  function transcribeQuestionRecording(question: string, audio: Blob) {
    void runAction(async () => {
      setQuestionAudioState(question, {
        status: "transcribing",
        message: "transcrevendo"
      });

      try {
        const transcript = await transcribeAudioBlob(role, {
          source: "onboarding",
          audio,
          language: "pt-BR",
          keyterms: ["Prymeira Baase", "processos", "rotinas", "treinamentos"]
        });
        const answer = transcript.text.trim();
        if (!answer) {
          setQuestionAudioState(question, {
            status: "error",
            message: "A transcrição veio vazia. Grave de novo ou escreva a resposta."
          });
          return;
        }
        setObAnswers((current) => ({ ...current, [question]: answer }));
        setQuestionAudioState(question, {
          status: "ready",
          message: "resposta capturada"
        });
      } catch {
        setQuestionAudioState(question, {
          status: "error",
          message: "Não conseguimos transcrever agora. Grave de novo ou escreva."
        });
        throw new Error("ONBOARDING_AUDIO_TRANSCRIPTION_FAILED");
      }
    });
  }

  function handleGenerateOnboardingSuggestion() {
    void runAction(async () => {
      const result = await generateOnboardingSuggestion(role, {
        segment: obSegment,
        answers: onboardingQuestions.map((question) => ({
          question,
          answer: (obAnswers[question] ?? "").trim() || fallbackOnboardingAnswer(question, obSegment),
          inputMode: obMode === "audio" ? "audio" : "text"
        })),
        context: {
          workspaceName,
          role,
          existingProcessCount: visibleProcesses.length,
          existingRoutineCount: visibleRoutines.length,
          existingTrainingCount: visibleTrainings.length
        }
      });
      setOnboardingSuggestion(result.suggestion);
      setOnboardingAiRunId(result.ai_run.id);
      go("revisao");
    });
  }

  function handleCreateReviewedCompany() {
    void runAction(async () => {
      const created = onboardingSuggestion
        ? await saveOnboardingSuggestionWorkspace(role, onboardingSuggestion)
        : await saveReviewWorkspace(role, obSegment);
      setCreatedSetup(created);
      appendOperationalContent({
        processes: created.processes,
        routines: created.routines,
        trainings: created.trainings,
        announcements: created.announcements ?? []
      });
      go("mapa");
    });
  }

  if (apiEnabled && bootstrapStatus === "loading") {
    return (
      <main className="bootstrap-state" aria-busy="true">
        <div className="bootstrap-state__mark" aria-hidden="true"><Icon name="ph-spinner-gap" /></div>
        <p className="mono">Prymeira Baase</p>
        <h1>Carregando sua empresa</h1>
      </main>
    );
  }

  if (apiEnabled && bootstrapStatus === "error") {
    return (
      <main className="bootstrap-state">
        <div className="bootstrap-state__mark bootstrap-state__mark--error" aria-hidden="true"><Icon name="ph-warning-circle" /></div>
        <p className="mono">Prymeira Baase</p>
        <h1>Não foi possível carregar sua empresa</h1>
        <button className="accent-solid" type="button" onClick={() => setBootstrapAttempt((attempt) => attempt + 1)}>Tentar novamente</button>
      </main>
    );
  }

  if (shouldShowFirstRunOnboarding) {
    return (
      <OnboardingShell
        session={onboardingSession}
        sessionLoadError={onboardingSessionLoadError}
        draft={onboardingDraft}
        onStart={startOnboardingSession}
        onRetrySession={() => setBootstrapAttempt((attempt) => attempt + 1)}
        onPatch={patchOnboardingDraft}
        onSkip={skipOnboarding}
        onGenerateDiagnosis={generateOnboardingDiagnosisFromDraft}
        onSaveFollowup={saveOnboardingFollowup}
        onGenerateSetup={generateOnboardingSetupFromSession}
        onSaveDecision={saveOnboardingDecision}
        onComplete={completeOnboarding}
        onGoPanel={goToPanelAfterOnboarding}
        conversationAudioStates={obAudioStates}
        onToggleConversationRecording={handleToggleOnboardingConversationRecording}
        actionBusy={actionBusy}
        actionError={onboardingActionError}
      />
    );
  }

  return (
    <div className="app">
      <div className={`menu-overlay ${menuOpen ? "show" : ""}`} onClick={() => setMenuOpen(false)} />
      <Sidebar nav={nav} screen={screen} go={go} menuOpen={menuOpen} workspaceName={workspaceName} workspaceSubtitle={workspaceSubtitle} />
      {role === "func" ? <EmployeeBottomNav nav={nav} screen={screen} go={go} /> : null}
      <div className="app-body">
        <header className="topbar">
          <button className="menu-btn icon-btn" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Abrir menu">
            <Icon name="ph-list" />
          </button>
          <div className="header-title">
            <div className="mono kicker">{workspaceName}</div>
            <div className="header-heading">{headerTitle}</div>
          </div>
          {!accountMode ? <div className="role-switch" aria-label="Visualização">
            {[
              ["dono", "Dono"],
              ["gestor", "Gestor"],
              ["func", "Funcionário"]
            ].map(([key, label]) => (
              <button key={key} className={role === key ? "active" : ""} type="button" onClick={() => setRole(key as Role)}>
                {label}
              </button>
            ))}
          </div> : null}
          <div className="top-actions">
            <button className="icon-btn" type="button" aria-label="Buscar" onClick={() => setTopPanel((panel) => panel === "search" ? null : "search")}><Icon name="ph-magnifying-glass" /></button>
            <button className={`icon-btn ${notificationItems.length ? "has-dot" : ""}`} type="button" aria-label="Notificações" onClick={() => setTopPanel((panel) => panel === "notifications" ? null : "notifications")}><Icon name="ph-bell" /></button>
            <div className="user-chip">
              <span>{identity.initials}</span>
              <div>
                <strong>{identity.name}</strong>
                <small>{identity.label}</small>
              </div>
            </div>
          </div>
        </header>
        {notice ? <div className="app-notice" role="status"><Icon name="ph-info" />{notice}</div> : null}
        {topPanel === "search" ? <SearchPanel go={go} nav={nav} onClose={() => setTopPanel(null)} /> : null}
        {topPanel === "notifications" ? <NotificationsPanel go={go} onClose={() => setTopPanel(null)} notifications={notificationItems} /> : null}
        <main className="app-main" aria-label={screen === "estudio" ? "Estúdio" : undefined}>
          <span className="sr-only" aria-live="polite">API Baase: {apiStatus}</span>
          {screen === "painel-dono" && (
            <>
              {onboardingSession?.status === "skipped" ? (
                <section className="screen panel padded onboarding-resume-panel">
                  <PanelHeader title="Monte sua empresa com IA" aside="Onboarding" />
                  <p>Transforme suas respostas em áreas, cargos, processos, rotinas e treinamentos revisáveis.</p>
                  <button className="accent-solid" type="button" onClick={resumeOnboardingFromDashboard}>Retomar onboarding</button>
                </section>
              ) : null}
              <OperationalOverviewPanel
                overview={operationalOverview}
                status={operationalOverviewStatus}
                preset={operationalPeriodPreset}
                period={operationalPeriod}
                identity={identity}
                dashboard={apiBundle?.dashboard ?? null}
                onCreateWithAi={() => go("criar")}
                onSelectPreset={selectOperationalPeriod}
                onApplyCustomPeriod={applyCustomOperationalPeriod}
                onOpenPerson={openOperationalPerson}
                onOpenTask={openOperationalTask}
                onOpenAnnouncement={openOperationalAnnouncement}
              />
              <OwnerDashboard
                go={go}
                dashboard={apiBundle?.dashboard ?? null}
                proactiveSuggestions={apiBundle?.proactiveSuggestions ?? []}
                isLiveWorkspace={liveWorkspaceMode}
                areas={companyAreas}
                routines={visibleRoutines}
                runProactiveSuggestion={handleRunProactiveSuggestion}
                createChecklistSuggestion={handleCreateChecklistSuggestion}
              />
            </>
          )}
          {screen === "painel-gestor" && (
            <>
              <OperationalOverviewPanel
                overview={operationalOverview}
                status={operationalOverviewStatus}
                preset={operationalPeriodPreset}
                period={operationalPeriod}
                onSelectPreset={selectOperationalPeriod}
                onApplyCustomPeriod={applyCustomOperationalPeriod}
                onOpenPerson={openOperationalPerson}
                onOpenTask={openOperationalTask}
                onOpenAnnouncement={openOperationalAnnouncement}
              />
              <ManagerDashboard
                identity={identity}
                dashboard={apiBundle?.dashboard ?? null}
                approvals={apiBundle?.approvals ?? []}
                isLiveWorkspace={liveWorkspaceMode}
                peopleRows={visiblePeople}
                approveTask={handleApproveTask}
                returnTask={(task) => setReturningTask(task)}
              />
            </>
          )}
          {screen === "pessoa-operacional" && role !== "func" && (
            <PersonOperationalPage
              person={companyPeople.find((person) => person.id === operationalPersonId) ?? null}
              overview={personOperationalOverview}
              status={personOperationalOverviewStatus}
              preset={operationalPeriodPreset}
              period={operationalPeriod}
              onSelectPreset={selectOperationalPeriod}
              onApplyCustomPeriod={applyCustomOperationalPeriod}
              onOpenTask={openOperationalTask}
              onOpenAnnouncement={openOperationalAnnouncement}
              onBack={() => go(homeFor(role))}
            />
          )}
          {screen === "hoje" && (
            <TodayPage
              operationalDate={operationalDate}
              identity={identity}
              taskRows={taskRows}
              trainingAssignments={pendingTrainingAssignments}
              announcements={pendingAnnouncements}
              isLiveWorkspace={liveWorkspaceMode}
              canCreateTask={canManageOperationalTasks}
              createTask={() => setCrudModal({ kind: "task", mode: "create" })}
              toggleTask={toggleTask}
              manageTask={toggleTask}
              onChecklistChange={handleUpdateExecutionChecklist}
              go={go}
            />
          )}
          {screen === "estudio" && canAccessStudio ? (
            <Suspense fallback={(
              <div className="studio-loading" role="status" aria-label="Carregando Estúdio" aria-busy="true">
                <span />
                <span />
                <span />
              </div>
            )}>
              <StudioPage onOpenInternalSource={(target) => {
                if (target.kind === "task" && target.resourceId) openOperationalTask(target.resourceId);
                else if (target.kind === "announcement" && target.resourceId) openOperationalAnnouncement(target.resourceId);
                else if (target.kind === "person" && target.resourceId) openOperationalPerson(target.resourceId);
                else if (target.kind === "routine") go("rotinas");
                else if (target.kind === "process") go("processos");
                else if (target.kind === "training") go("treinamentos");
                else go("painel-dono");
              }} />
            </Suspense>
          ) : null}
          {screen === "mapa" && (
            <CompanyMap
              canCreateArea={canAdministerCompany}
              canArchiveArea={canAdministerCompany}
              areaRows={visibleAreas}
              workspaceName={workspaceName}
              workspaceSubtitle={workspaceSubtitle}
              openAreaForm={() => setCrudModal({ kind: "area", mode: "create" })}
              openRoleForm={() => setCrudModal({ kind: "role" })}
              openPersonForm={() => setCrudModal({ kind: "person", mode: "create" })}
              editArea={(area) => {
                if (!area.id) return;
                setCrudModal({
                  kind: "area",
                  mode: "edit",
                  area: { id: area.id, name: area.name, description: area.description ?? null }
                });
              }}
              deleteArea={handleDeleteArea}
              deleteRoleTemplate={handleDeleteRoleTemplate}
            />
          )}
          {screen === "equipe" && (
            <TeamPage
              openInvite={() => setCrudModal({ kind: "invite" })}
              actionBusy={actionBusy}
              peopleRows={visiblePeople}
              invites={companyInvites}
              deleteInvite={handleDeleteInvite}
              people={companyPeople}
              areas={companyAreas}
              canEditPerson={(person) => canAdministerCompany || (role === "gestor" && person.role === "employee" && person.id !== apiBundle?.session.profile.id)}
              editPerson={(person) => setCrudModal({ kind: "person", mode: "edit", person })}
            />
          )}
          {screen === "processos" && (
            <ProcessesPage
              canManage={canManageOperationalTasks}
              canManageWorkspace={canManageWorkspace}
              go={go}
              processes={visibleProcesses}
              areas={companyAreas}
              isLiveWorkspace={liveWorkspaceMode}
              createProcess={() => setCrudModal({ kind: "process", mode: "create" })}
              editProcess={(process) => setCrudModal({ kind: "process", mode: "edit", process })}
              publishProcess={handlePublishProcess}
              unpublishProcess={handleUnpublishProcess}
              deleteProcess={handleDeleteProcess}
              communicateProcess={handleCommunicateProcessChange}
              actionBusy={actionBusy}
            />
          )}
          {screen === "rotinas" && (
            <RoutinesPage
              canManage={canManageOperationalTasks}
              canManageWorkspace={canManageWorkspace}
              go={go}
              showNotice={showNotice}
              routines={visibleRoutines}
              isLiveWorkspace={liveWorkspaceMode}
              createRoutine={() => setCrudModal({ kind: "routine", mode: "create" })}
              editRoutine={(routine) => setCrudModal({ kind: "routine", mode: "edit", routine })}
              archiveRoutine={handleArchiveRoutine}
              deleteRoutine={handleDeleteRoutine}
              actionBusy={actionBusy}
              checkRows={checkRows}
              checks={checks}
              checkDone={checkDone}
              checkPct={checkPct}
              setChecks={setChecks}
              areas={companyAreas}
              people={companyPeople}
            />
          )}
          {screen === "treinamentos" && (
            <TrainingPage
              canManage={canManageOperationalTasks}
              canManageWorkspace={canManageWorkspace}
              trainings={visibleTrainings}
              isLiveWorkspace={liveWorkspaceMode}
              createTraining={() => setCrudModal({ kind: "training", mode: "create" })}
              editTraining={(training) => setCrudModal({ kind: "training", mode: "edit", training })}
              unpublishTraining={handleUnpublishTraining}
              deleteTraining={handleDeleteTraining}
              actionBusy={actionBusy}
              submitQuiz={handleSubmitTrainingQuiz}
              processes={visibleProcesses}
              areas={companyAreas}
              roleTemplates={companyRoleTemplates}
              people={companyPeople}
            />
          )}
          {screen === "comunicados" && (
            <AnnouncementsPage
              canManage={canManageOperationalTasks}
              canManageWorkspace={canManageWorkspace}
              announcements={visibleAnnouncements}
              isLiveWorkspace={liveWorkspaceMode}
              areas={companyAreas}
              roleTemplates={companyRoleTemplates}
              people={companyPeople}
              currentProfile={{ id: apiBundle?.session.profile.id ?? null, name: identity.name }}
              createAnnouncement={() => setCrudModal({ kind: "announcement", mode: "create" })}
              confirmAnnouncement={handleConfirmAnnouncement}
              deleteAnnouncement={handleDeleteAnnouncement}
              actionBusy={actionBusy}
              comRead={comRead}
              setComRead={setComRead}
              selectedAnnouncementId={selectedOperationalAnnouncementId}
              onSelectAnnouncement={() => setSelectedOperationalAnnouncementId(null)}
            />
          )}
          {screen === "modelos" && (
            <TemplatesPage
              templates={visibleTemplates}
              segmentFilter={tplSegment}
              setSegmentFilter={setTplSegment}
              areaFilter={tplArea}
              setAreaFilter={setTplArea}
              kindFilter={tplKind}
              setKindFilter={setTplKind}
              useTemplate={handleUseTemplate}
              adaptTemplate={handleAdaptTemplate}
            />
          )}
          {screen === "criar" && (
            <CreateWithAiPage
              prompt={aiPrompt}
              setPrompt={setAiPrompt}
              promptPlaceholder={aiPromptPlaceholder}
              setPromptPlaceholder={setAiPromptPlaceholder}
              mode={aiMode}
              setMode={setAiMode}
              preset={aiPreset}
              setPreset={setAiPreset}
              inputMode={aiInputMode}
              attachments={aiAttachments}
              audioState={aiAudioState}
              toggleRecording={handleToggleCreateAiRecording}
              attachMaterial={handleAttachAiMaterial}
              removeAttachment={handleRemoveAiAttachment}
              generateContent={handleGenerateAiContent}
              showNotice={showNotice}
              actionBusy={actionBusy}
              generationState={aiGenerationState}
            />
          )}
          {screen === "onboarding" && (
            <OnboardingPage
              obSegment={obSegment}
              setObSegment={setObSegment}
              obMode={obMode}
              setObMode={setObMode}
              answers={obAnswers}
              setAnswer={(question, answer) => setObAnswers((current) => ({ ...current, [question]: answer }))}
              audioStates={obAudioStates}
              toggleRecording={handleToggleQuestionRecording}
              generateSuggestion={handleGenerateOnboardingSuggestion}
              actionBusy={actionBusy}
              go={go}
            />
          )}
          {screen === "revisao" && (
            <ReviewPage
              go={go}
              suggestion={onboardingSuggestion}
              aiRunId={onboardingAiRunId}
              createReviewedCompany={handleCreateReviewedCompany}
              actionBusy={actionBusy}
            />
          )}
        </main>
        {crudModal ? (
          <CrudModalView
            modal={crudModal}
            canAssignManagementRoles={canAdministerCompany}
            canManageWorkspace={canManageWorkspace}
            actionBusy={actionBusy}
            onClose={() => setCrudModal(null)}
            onSaveArea={handleSaveArea}
            onSaveTask={handleSaveTask}
            onSaveRoleTemplate={handleSaveRoleTemplate}
            onSavePerson={handleSavePerson}
            onDeletePerson={handleDeletePerson}
            onSaveProcess={handleSaveProcess}
            onSaveRoutine={handleSaveRoutine}
            onSaveTraining={handleSaveTraining}
            onSaveAnnouncement={handleSaveAnnouncement}
            onCreateInvite={handleCreateInvite}
            areas={companyAreas}
            roleTemplates={companyRoleTemplates}
            people={companyPeople}
            processes={visibleProcesses}
            currentProfileId={apiBundle?.session.profile.id ?? null}
            currentProfileName={identity.name}
          />
        ) : null}
        {areaArchiveDialog ? (
          <AreaArchiveDialog
            area={areaArchiveDialog.area}
            impact={areaArchiveDialog.impact}
            areas={companyAreas.filter((area) => area.id !== areaArchiveDialog.area.id)}
            actionBusy={actionBusy}
            onClose={() => setAreaArchiveDialog(null)}
            onConfirm={handleConfirmAreaArchive}
          />
        ) : null}
        {executionTask ? (
          <ExecutionModal
            task={executionTask}
            actionBusy={actionBusy || Boolean(executionTask.apiId && submittingTasks[executionTask.apiId])}
            onClose={() => setExecutionTask(null)}
            onSubmit={handleSubmitExecution}
            canDelete={canManageOperationalTasks && executionTask.origin === "manual"}
            canEdit={canManageOperationalTasks && executionTask.origin === "manual"}
            onEdit={handleEditExecutionTask}
            onDelete={handleDeleteExecutionTask}
            onChecklistChange={handleUpdateExecutionChecklist}
          />
        ) : null}
        {operationalTaskDetail ? <TaskDetailModal task={operationalTaskDetail} onClose={() => setOperationalTaskDetail(null)} /> : null}
        {returningTask ? (
          <ReturnTaskModal
            task={returningTask}
            actionBusy={actionBusy}
            onClose={() => setReturningTask(null)}
            onSubmit={handleReturnTask}
          />
        ) : null}
      </div>
    </div>
  );
}

function Sidebar({
  nav,
  screen,
  go,
  menuOpen,
  workspaceName,
  workspaceSubtitle
}: {
  nav: NavItem[];
  screen: Screen;
  go: (screen: Screen) => void;
  menuOpen: boolean;
  workspaceName: string;
  workspaceSubtitle: string;
}) {
  return (
    <aside className={`app-side ${menuOpen ? "open" : ""}`}>
      <div className="brand">
        <div className="brand-mark">b</div>
        <div>
          <strong>Prymeira Baase</strong>
          <span className="mono">base operacional</span>
        </div>
      </div>
      <nav className="side-nav" aria-label="Navegação interna">
        {nav.map((item) => (
          <a
            key={item.key}
            href={`#${item.key}`}
            className={`navitem ${screen === item.key ? "active" : ""}`}
            aria-current={screen === item.key ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              go(item.key);
            }}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
          </a>
        ))}
      </nav>
      <div className="workspace-card">
        <div className="workspace-mark">{workspaceName.slice(0, 2).toUpperCase()}</div>
        <div>
          <strong>{workspaceName}</strong>
          <span>{workspaceSubtitle}</span>
        </div>
        <Icon name="ph-caret-up-down" />
      </div>
    </aside>
  );
}

function SearchPanel({ go, nav, onClose }: { go: (screen: Screen) => void; nav: NavItem[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const results = nav.filter((item) => !normalizedQuery || item.label.toLocaleLowerCase("pt-BR").includes(normalizedQuery));

  function openResult(screen: Screen) {
    go(screen);
    onClose();
  }

  return (
    <div className="floating-panel search-pop" role="dialog" aria-label="Buscar no Baase">
      <header><strong>Buscar no Baase</strong><button className="icon-btn" type="button" aria-label="Fechar busca" onClick={onClose}><Icon name="ph-x" /></button></header>
      <label className="search-input"><Icon name="ph-magnifying-glass" /><input aria-label="Termo de busca" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar uma área do Baase..." value={query} /></label>
      <div className="quick-results">
        {results.map((result) => (
          <button type="button" key={result.key} onClick={() => openResult(result.key)}>
            <span><Icon name={result.icon} /></span>
            <div><strong>Ir para {result.label}</strong><small>Disponível no seu perfil</small></div>
          </button>
        ))}
        {!results.length ? <div className="search-empty">Nenhuma área encontrada.</div> : null}
      </div>
    </div>
  );
}

function EmployeeBottomNav({ nav, screen, go }: { nav: NavItem[]; screen: Screen; go: (screen: Screen) => void }) {
  return <nav className="employee-bottom-nav" aria-label="Navegação rápida">
    {nav.map((item) => <button className={screen === item.key ? "active" : ""} key={item.key} onClick={() => go(item.key)} type="button">
      <Icon name={item.icon} />
      <span>{item.key === "processos" ? "Como fazer" : item.label}</span>
    </button>)}
  </nav>;
}

function NotificationsPanel({ go, onClose, notifications }: { go: (screen: Screen) => void; onClose: () => void; notifications: NotificationItem[] }) {
  function openNotification(screen: Screen) {
    go(screen);
    onClose();
  }

  return (
    <div className="floating-panel notify-pop" role="dialog" aria-label="Notificações">
      <header><strong>Notificações</strong><button className="icon-btn" type="button" aria-label="Fechar notificações" onClick={onClose}><Icon name="ph-x" /></button></header>
      {notifications.length === 0 ? (
        <EmptyState icon="ph-bell" title="Sem notificações agora" text="Quando algo precisar de atenção, aparece aqui." />
      ) : null}
      {notifications.map((notification) => (
        <button className="notification-row" type="button" key={notification.title} onClick={() => openNotification(notification.screen)}>
          <span className={`square square-${notification.tone}`}><Icon name={notification.tone === "danger" ? "ph-warning" : notification.tone === "warn" ? "ph-seal-check" : "ph-megaphone"} /></span>
          <div><strong>{notification.title}</strong><small>{notification.meta}</small></div>
          <Icon name="ph-caret-right" />
        </button>
      ))}
    </div>
  );
}

type OperationalListKind = "lateTasks" | "awaitingApprovals" | "pendingRequiredAnnouncements";

function OperationalPeriodControls({
  preset,
  period,
  onSelectPreset,
  onApplyCustomPeriod
}: {
  preset: OperationalPeriodPreset;
  period: OperationalPeriod;
  onSelectPreset: (preset: Exclude<OperationalPeriodPreset, "custom">) => void;
  onApplyCustomPeriod: (period: OperationalPeriod) => void;
}) {
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);

  useEffect(() => {
    setFrom(period.from);
    setTo(period.to);
  }, [period.from, period.to]);

  return (
    <div className="operational-period" aria-label="Filtro de período operacional">
      <div className="operational-period-presets">
        {([
          ["7d", "7 dias"],
          ["30d", "30 dias"],
          ["month", "Mês atual"]
        ] as const).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={preset === value ? "active" : ""}
            aria-pressed={preset === value}
            onClick={() => onSelectPreset(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <label>De<input aria-label="Data inicial do período" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Até<input aria-label="Data final do período" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className={preset === "custom" ? "active" : ""} type="button" onClick={() => onApplyCustomPeriod({ from, to })}>Aplicar período</button>
    </div>
  );
}

function OperationalMetricList({
  items,
  kind,
  onOpenPerson,
  onOpenItem,
  pageSize = 5
}: {
  items: ApiOperationalMetricItem[];
  kind: OperationalListKind;
  onOpenPerson: (profileId: string) => void;
  onOpenItem: (itemId: string) => void;
  pageSize?: number;
}) {
  const isAnnouncement = kind === "pendingRequiredAnnouncements";
  const [visibleCount, setVisibleCount] = useState(pageSize);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [kind, pageSize]);

  if (!items.length) {
    return <EmptyState icon={isAnnouncement ? "ph-megaphone" : "ph-check-circle"} title="Nenhuma pendência neste período" text="Quando houver itens para acompanhar, as pessoas e os detalhes aparecem aqui." />;
  }

  return (
    <div className="operational-list">
      {items.slice(0, visibleCount).map((item) => (
        <div className="operational-list-row" key={`${item.id}:${item.profileId ?? "sem-responsavel"}`}>
          <div>
            {item.profileId && item.profileName ? <button className="operational-person-link" type="button" onClick={() => onOpenPerson(item.profileId!)}>{item.profileName}</button> : <strong>Sem responsável</strong>}
            <small>{item.areaName}{item.daysLate ? ` · ${item.daysLate} dia(s) de atraso` : item.dueDate ? ` · vence em ${formatOperationalDate(item.dueDate)}` : item.publishedAt ? ` · publicado em ${formatOperationalDate(item.publishedAt)}` : ""}</small>
          </div>
          <button className="operational-item-link" type="button" onClick={() => onOpenItem(item.id)} aria-label={`Abrir ${isAnnouncement ? "comunicado" : "tarefa"}: ${item.title}`}>
            <span>{item.title}</span><Icon name="ph-arrow-up-right" />
          </button>
        </div>
      ))}
      {items.length > visibleCount ? <button className="panel-link operational-show-more" type="button" onClick={() => setVisibleCount((current) => current + pageSize)}>Ver mais ({items.length - visibleCount})</button> : null}
    </div>
  );
}

function OperationalOverviewPanel({
  overview,
  status,
  preset,
  period,
  onSelectPreset,
  onApplyCustomPeriod,
  onOpenPerson,
  onOpenTask,
  onOpenAnnouncement,
  identity,
  dashboard,
  onCreateWithAi
}: {
  overview: ApiOperationalOverview | null;
  status: "idle" | "loading" | "error";
  preset: OperationalPeriodPreset;
  period: OperationalPeriod;
  onSelectPreset: (preset: Exclude<OperationalPeriodPreset, "custom">) => void;
  onApplyCustomPeriod: (period: OperationalPeriod) => void;
  onOpenPerson: (profileId: string) => void;
  onOpenTask: (taskId: string) => void;
  onOpenAnnouncement: (announcementId: string) => void;
  identity?: Identity;
  dashboard?: ApiDashboard | null;
  onCreateWithAi?: () => void;
}) {
  const [listKind, setListKind] = useState<OperationalListKind>("lateTasks");
  const metrics = overview?.metrics ?? {
    lateTasks: dashboard?.metrics.lateTasks ?? 0,
    awaitingApprovals: dashboard?.metrics.awaitingApproval ?? 0,
    pendingRequiredAnnouncements: 0
  };
  const definitions: Array<{ kind: OperationalListKind; label: string; value: number; icon: string }> = [
    { kind: "lateTasks", label: "Tarefas atrasadas", value: metrics.lateTasks, icon: "ph-clock-countdown" },
    { kind: "awaitingApprovals", label: "Aguardando aprovação", value: metrics.awaitingApprovals, icon: "ph-seal-check" },
    { kind: "pendingRequiredAnnouncements", label: "Comunicados obrigatórios", value: metrics.pendingRequiredAnnouncements, icon: "ph-megaphone" }
  ];
  const selectedDefinition = definitions.find((definition) => definition.kind === listKind)!;
  const selectedItems = overview?.[listKind] ?? [];

  return (
    <section className="screen operational-overview" aria-label="Acompanhamento operacional">
      <div className="page-head compact">
        <div>
          <h1 className="serif">{identity ? `Bom dia, ${firstName(identity.name)}.` : "Acompanhamento operacional"}</h1>
          <p>{identity ? "Acompanhe a execução, abra pendências e navegue até cada pessoa." : "Identifique pendências, abra os detalhes e acompanhe cada pessoa no período selecionado."}</p>
        </div>
        {onCreateWithAi ? <button className="accent-btn" type="button" onClick={onCreateWithAi}><Icon name="ph-sparkle" />Criar com IA</button> : null}
      </div>
      <OperationalPeriodControls preset={preset} period={period} onSelectPreset={onSelectPreset} onApplyCustomPeriod={onApplyCustomPeriod} />
      <div className={`operational-metric-cards ${identity ? "owner-operational-metrics" : ""}`}>
        {identity ? (
          <div>
            <span>Execução hoje<Icon name="ph-chart-line-up" /></span>
            <strong className="serif num">{dashboard?.metrics.executionRate ?? 0}%</strong>
            <small>{dashboard?.metrics.todayCompleted ?? 0} de {dashboard?.metrics.todayTotal ?? 0} tarefas</small>
          </div>
        ) : null}
        {definitions.map((definition) => (
          <button key={definition.kind} type="button" className={listKind === definition.kind ? "active" : ""} onClick={() => setListKind(definition.kind)} aria-pressed={listKind === definition.kind}>
            <span>{definition.label}<Icon name={definition.icon} /></span>
            <strong className="serif num">{definition.value}</strong>
            <small>Ver lista nominal</small>
          </button>
        ))}
      </div>
      <div className="two-col operational-details">
        <section className="panel flush">
          <PanelHeader title={selectedDefinition.label} aside={`${period.from} — ${period.to}`} />
          {status === "loading" ? <EmptyState icon="ph-spinner-gap" title="Atualizando acompanhamento" text="Buscando as pendências do período selecionado." /> : status === "error" ? <EmptyState icon="ph-warning" title="Não foi possível carregar o acompanhamento" text="Tente ajustar o período novamente." /> : <OperationalMetricList items={selectedItems} kind={listKind} onOpenPerson={onOpenPerson} onOpenItem={listKind === "pendingRequiredAnnouncements" ? onOpenAnnouncement : onOpenTask} />}
        </section>
        <section className="panel flush">
          <PanelHeader title="Tendência por pessoa" aside="No período" />
          {overview?.trends.people.length ? overview.trends.people.map((trend) => (
            <button className="operational-trend-row" key={trend.profileId ?? trend.areaName} type="button" onClick={() => trend.profileId && onOpenPerson(trend.profileId)} disabled={!trend.profileId}>
              <span><strong>{trend.profileName ?? trend.areaName}</strong><small>{trend.areaName}</small></span>
              <span><b>{formatPercent(trend.completionOnTimeRate)}</b><small>no prazo</small></span>
              <span><b>{formatHours(trend.averageApprovalDurationHours)}</b><small>aprovação</small></span>
            </button>
          )) : <EmptyState icon="ph-chart-line-up" title="Sem tendência no período" text="As tendências aparecem depois que a equipe registrar tarefas e aprovações." />}
        </section>
      </div>
    </section>
  );
}

function PersonOperationalPage({
  person,
  overview,
  status,
  preset,
  period,
  onSelectPreset,
  onApplyCustomPeriod,
  onOpenTask,
  onOpenAnnouncement,
  onBack
}: {
  person: ApiPerson | null;
  overview: ApiOperationalOverview | null;
  status: "idle" | "loading" | "error";
  preset: OperationalPeriodPreset;
  period: OperationalPeriod;
  onSelectPreset: (preset: Exclude<OperationalPeriodPreset, "custom">) => void;
  onApplyCustomPeriod: (period: OperationalPeriod) => void;
  onOpenTask: (taskId: string) => void;
  onOpenAnnouncement: (announcementId: string) => void;
  onBack: () => void;
}) {
  const metrics = overview?.metrics ?? { lateTasks: 0, awaitingApprovals: 0, pendingRequiredAnnouncements: 0 };
  const trend = overview?.trends.people[0] ?? null;
  return (
    <div className="screen operational-person-page">
      <div className="page-head compact">
        <div>
          <button className="panel-link" type="button" onClick={onBack}><Icon name="ph-arrow-left" /> Voltar ao painel</button>
          <h1 className="serif">{person?.name ?? "Pessoa"}</h1>
          <p>{person?.areaId ? "Visão individual de execução, aprovações e comunicados." : "Visão individual de acompanhamento operacional."}</p>
        </div>
      </div>
      <OperationalPeriodControls preset={preset} period={period} onSelectPreset={onSelectPreset} onApplyCustomPeriod={onApplyCustomPeriod} />
      {status === "loading" ? <EmptyState icon="ph-spinner-gap" title="Carregando visão da pessoa" text="Atualizando os dados do período selecionado." /> : status === "error" ? <EmptyState icon="ph-warning" title="Não foi possível abrir esta pessoa" text="Verifique o acesso e tente novamente." /> : <>
        <div className="operational-metric-cards person-metric-cards">
          <div><span>Tarefas abertas</span><strong className="serif num">{overview?.openTasks?.length ?? 0}</strong><small>pendentes, em ajuste ou aguardando aprovação</small></div>
          <div><span>Conclusão no prazo</span><strong className="serif num">{formatPercent(trend?.completionOnTimeRate ?? null)}</strong><small>tarefas concluídas no período</small></div>
          <div><span>Tempo até aprovação</span><strong className="serif num">{formatHours(trend?.averageApprovalDurationHours ?? null)}</strong><small>média das decisões</small></div>
        </div>
        <div className="two-col operational-details">
          <section className="panel flush"><PanelHeader title="Tarefas abertas" aside={`${overview?.openTasks?.length ?? 0} no período`} /><OperationalMetricList items={overview?.openTasks ?? []} kind="lateTasks" onOpenPerson={() => undefined} onOpenItem={onOpenTask} /></section>
          <section className="panel flush"><PanelHeader title="Tarefas atrasadas" /><OperationalMetricList items={overview?.lateTasks ?? []} kind="lateTasks" onOpenPerson={() => undefined} onOpenItem={onOpenTask} /></section>
          <section className="panel flush"><PanelHeader title="Aguardando aprovação" /><OperationalMetricList items={overview?.awaitingApprovals ?? []} kind="awaitingApprovals" onOpenPerson={() => undefined} onOpenItem={onOpenTask} /></section>
          <section className="panel flush"><PanelHeader title="Comunicados obrigatórios pendentes" /><OperationalMetricList items={overview?.pendingRequiredAnnouncements ?? []} kind="pendingRequiredAnnouncements" onOpenPerson={() => undefined} onOpenItem={onOpenAnnouncement} /></section>
          <section className="panel padded person-trend-summary"><PanelHeader title="Tendência do período" /><p><strong>{formatPercent(trend?.completionOnTimeRate ?? null)}</strong> das tarefas concluídas no prazo.</p><p><strong>{formatHours(trend?.averageApprovalDurationHours ?? null)}</strong> em média até uma decisão de aprovação.</p></section>
        </div>
      </>}
    </div>
  );
}

function formatOperationalDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

function formatHours(value: number | null) {
  return value === null ? "—" : `${value}h`;
}

function OwnerDashboard({
  go,
  dashboard,
  proactiveSuggestions,
  isLiveWorkspace,
  areas,
  routines,
  runProactiveSuggestion,
  createChecklistSuggestion
}: {
  go: (screen: Screen) => void;
  dashboard: ApiDashboard | null;
  proactiveSuggestions: ApiProactiveSuggestion[];
  isLiveWorkspace: boolean;
  areas: ApiArea[];
  routines: ApiRoutine[];
  runProactiveSuggestion: (suggestion: ApiProactiveSuggestion) => void;
  createChecklistSuggestion: () => void;
}) {
  const dashboardMetrics = dashboard?.metrics;
  const effectiveMetrics = dashboardMetrics ?? (isLiveWorkspace ? {
    todayTotal: 0,
    todayCompleted: 0,
    executionRate: 0,
    lateTasks: 0,
    awaitingApproval: 0,
    pendingTrainingAssignments: 0,
    incompleteProcesses: 0
  } : null);
  const fallbackAttention = [
    { title: "Fechamento de campanha — Loja Vitta", sub: "Rotina crítica sem aprovação há 2 dias", tag: "Crítico", icon: "ph-warning", tone: "danger", go: "rotinas" },
    { title: "3 evidências aguardando sua aprovação", sub: "Criação · enviado por Bruno e Carla", tag: "Aprovar", icon: "ph-seal-check", tone: "warn", go: "rotinas" },
    { title: "Processo \"Aprovação de peças\" gerou 5 dúvidas", sub: "IA sugere revisar a etapa 3", tag: "Revisar", icon: "ph-chat-circle-dots", tone: "info", go: "processos" },
    { title: "Comunicado sem confirmação de 4 pessoas", sub: "Novo fluxo de aprovação · enviado ontem", tag: "Cobrar", icon: "ph-megaphone", tone: "info", go: "comunicados" },
    { title: "Cargo \"Gestor de Tráfego\" sem treinamento", sub: "Área Mídia · 1 pessoa", tag: "Atenção", icon: "ph-graduation-cap", tone: "warn", go: "treinamentos" }
  ] as const;
  const attention = dashboard?.attentionItems.length
    ? dashboard.attentionItems.map((item) => ({
      title: item.title,
      sub: item.subtitle,
      tag: item.tag,
      icon: item.icon,
      tone: item.tone,
      go: item.targetScreen
    }))
    : isLiveWorkspace ? [] : fallbackAttention;
  const areaProgressRows = dashboard?.areaMetrics.length
    ? dashboard.areaMetrics.map((area) => [
      area.name,
      `${area.completionRate}%`,
      area.late > 0 ? "var(--danger-ink)" : area.completionRate < 70 ? "var(--warn-ink)" : "var(--accent)"
    ] as const)
    : isLiveWorkspace
      ? areas.map((area) => [area.name, "0%", "var(--faint)"] as const)
      : ([
      ["Atendimento & CS", "88%", "var(--accent)"],
      ["Criação", "64%", "var(--warn-ink)"],
      ["Mídia & Tráfego", "80%", "var(--accent)"],
      ["Financeiro", "40%", "var(--danger-ink)"]
    ] as const);
  const fallbackSuggestions: ApiProactiveSuggestion[] = [
    {
      id: "fallback_late_media_report",
      signal: "late_tasks",
      priority: "high",
      title: "Relatório semanal de mídia atrasou 3 vezes",
      reason: "Transforme a rotina em checklist com prazo fixo e evidência.",
      action: {
        type: "create_routine",
        label: "Gerar checklist",
        prompt: "Criar checklist para relatório semanal de mídia com prazo, responsável e evidência",
        targetScreen: "rotinas"
      },
      target: {}
    },
    {
      id: "fallback_financial_routine",
      signal: "area_without_routine",
      priority: "medium",
      title: "Financeiro foi criado sem rotina ativa",
      reason: "A IA pode sugerir rotinas essenciais para manter fechamento, conciliação e cobrança em dia.",
      action: {
        type: "create_routine",
        label: "Ver sugestões",
        prompt: "Sugerir rotinas essenciais para a área financeira de uma agência",
        targetScreen: "rotinas"
      },
      target: {}
    }
  ];
  const suggestions = proactiveSuggestions.length ? proactiveSuggestions : isLiveWorkspace ? [] : fallbackSuggestions;
  const areaNameById = new Map(areas.map((area) => [area.id, area.name]));
  const criticalRoutines = isLiveWorkspace
    ? routines.filter((routine) => routine.status === "active").slice(0, 3).map((routine) => [
      routine.title,
      routine.areaId ? areaNameById.get(routine.areaId) ?? "Área definida" : "Empresa inteira",
      statusLabel(routine.status),
      routine.status === "archived" ? "var(--faint)" : routine.status === "active" ? "var(--accent)" : "var(--warn-ink)"
    ] as const)
    : ([
      ["Fechamento de campanha", "Mídia · Diego", "Atrasada", "var(--danger-ink)"],
      ["Backup de arquivos", "Operações · Rafael", "Ok", "var(--accent)"],
      ["Conciliação financeira", "Financeiro · Felipe", "Pendente", "var(--warn-ink)"]
    ] as const);
  return (
    <div className="screen owner-supporting-dashboard">
      <div className="owner-grid">
        <div className="stack">
          <section className="panel flush">
            <PanelHeader title="Precisa de você agora" aside={`${attention.length} itens`} />
            {attention.length ? attention.map((item) => (
              <button className="attention-row rowh" key={item.title} type="button" onClick={() => go(item.go as Screen)}>
                <span className={`square square-${item.tone}`}><Icon name={item.icon} /></span>
                <span><strong>{item.title}</strong><small>{item.sub}</small></span>
                <Pill tone={item.tone}>{item.tag}</Pill>
                <Icon name="ph-caret-right" />
              </button>
            )) : <EmptyState icon="ph-check-circle" title="Nada urgente agora" text="Quando houver atraso, aprovação ou conteúdo incompleto, aparece aqui." />}
          </section>
          <section className="ai-panel">
            <h2><Icon name="ph-sparkle" />Sugestões da IA</h2>
            {suggestions.length ? suggestions.map((suggestion, index) => (
              <div className="ai-row" key={suggestion.id}>
                <Icon name="ph-lightbulb" />
                <p><strong>{suggestion.title}</strong><span>{suggestion.reason}</span></p>
                <button
                  type="button"
                  onClick={() => proactiveSuggestions.length ? runProactiveSuggestion(suggestion) : index === 0 ? createChecklistSuggestion() : go("modelos")}
                >
                  {suggestion.action.label}
                </button>
              </div>
            )) : <EmptyState icon="ph-sparkle" title="Sem sugestões no momento" text="A IA vai aparecer quando detectar gargalos, áreas sem rotina ou conteúdo incompleto." />}
          </section>
        </div>
        <div className="stack">
          <section className="panel padded">
            <h2>Execução por área hoje</h2>
            <div className="metric-line">
              <strong className="serif">{effectiveMetrics ? `${effectiveMetrics.executionRate}%` : "72%"}</strong>
              <span>{effectiveMetrics ? `${effectiveMetrics.todayCompleted} de ${effectiveMetrics.todayTotal} tarefas` : "36 de 50 tarefas"}</span>
            </div>
            <PercentBar value={effectiveMetrics ? `${effectiveMetrics.executionRate}%` : "72%"} />
            {areaProgressRows.length ? areaProgressRows.map(([name, pct, color]) => (
              <div className="area-progress" key={name}>
                <span>{name}</span><PercentBar value={pct} color={color} /><small>{pct}</small>
              </div>
            )) : <EmptyState icon="ph-chart-line-up" title="Sem áreas com execução hoje" text="Quando tarefas forem geradas para as rotinas, o progresso por área aparece aqui." />}
          </section>
          <section className="panel padded">
            <PanelHeader title="Rotinas ativas" link="Ver todas" onLinkClick={() => go("rotinas")} />
            {criticalRoutines.length ? criticalRoutines.map(([name, owner, status, color]) => (
              <div className="critical-row" key={name}>
                <span style={{ background: color }} />
                <div><strong>{name}</strong><small>{owner}</small></div>
                <b style={{ color }}>{status}</b>
              </div>
            )) : <EmptyState icon="ph-arrows-clockwise" title="Nenhuma rotina ativa" text="Crie ou ative uma rotina para começar a acompanhar a operação." />}
          </section>
        </div>
      </div>
    </div>
  );
}

function ManagerDashboard({
  identity,
  dashboard,
  approvals,
  isLiveWorkspace,
  peopleRows,
  approveTask,
  returnTask
}: {
  identity: Identity;
  dashboard: ApiDashboard | null;
  approvals: ApiTask[];
  isLiveWorkspace: boolean;
  peopleRows: TeamDisplayRow[];
  approveTask: (task: ApiTask) => void;
  returnTask: (task: ApiTask) => void;
}) {
  const pendingApprovals = approvals.filter((task) => task.status === "awaiting_approval");
  const dashboardMetrics = dashboard?.metrics;
  const effectiveMetrics = dashboardMetrics ?? (isLiveWorkspace ? {
    todayTotal: 0,
    todayCompleted: 0,
    lateTasks: 0,
    awaitingApproval: 0,
    pendingTrainingAssignments: 0,
    incompleteProcesses: 0
  } : null);
  const stats = effectiveMetrics ? [
    ["Tarefas da área hoje", String(effectiveMetrics.todayTotal), `${effectiveMetrics.todayCompleted} concluídas`, "ph-list-checks"],
    ["Atrasos da equipe", String(effectiveMetrics.lateTasks), effectiveMetrics.lateTasks === 1 ? "1 tarefa" : `${effectiveMetrics.lateTasks} tarefas`, "ph-clock-countdown"],
    ["Aprovações pendentes", String(effectiveMetrics.awaitingApproval), "aguardando você", "ph-seal-check"],
    ["Treinos pendentes", String(effectiveMetrics.pendingTrainingAssignments), "atribuições ainda não concluídas", "ph-graduation-cap"]
  ] as const : [
    ["Tarefas da área hoje", "18", "11 concluídas", "ph-list-checks"],
    ["Atrasos da equipe", "2", "Bruno e Carla", "ph-clock-countdown"],
    ["Aprovações pendentes", "3", "aguardando você", "ph-seal-check"],
    ["Dúvidas abertas", "4", "em 2 processos", "ph-chat-circle-dots"]
  ] as const;
  const demoTeamRows = [
    ["BC", "Bruno Costa", "Designer", "57%", "4/7 tarefas", "var(--warn-ink)"],
    ["CD", "Carla Dias", "Social Media", "83%", "5/6 tarefas", "var(--accent)"],
    ["DM", "Diego Melo", "Gestor de Tráfego", "100%", "3/3 tarefas", "var(--accent)"]
  ] as const;
  const demoApprovalRows: ApiTask[] = [
    { id: "demo_1", title: "Peças finais — Loja Vitta", status: "awaiting_approval", evidence: { comment: "Bruno Costa · há 20 min", photoUrl: null } },
    { id: "demo_2", title: "Carrossel — Café Aurora", status: "awaiting_approval", evidence: { comment: "Carla Dias · há 1h", photoUrl: null } },
    { id: "demo_3", title: "Banner de campanha — Loja Vitta", status: "awaiting_approval", evidence: { comment: "Bruno Costa · há 3h", photoUrl: null } }
  ];
  const approvalRows = pendingApprovals.length ? pendingApprovals : isLiveWorkspace ? [] : demoApprovalRows;
  return (
    <div className="screen">
      <div className="page-head compact">
        <div>
          <h1 className="serif">Painel da área · Criação</h1>
          <p>Bom dia, {firstName(identity.name)}. Acompanhe a execução do seu time sem ruído.</p>
        </div>
      </div>
      <div className="stats-grid">
        {stats.map(([label, value, hint, icon]) => (
          <div className="stat-card lift" key={label}>
            <div><span>{label}</span><Icon name={icon} /></div>
            <strong className="serif num">{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="two-col">
        <section className="panel flush">
          <PanelHeader title="Sua equipe hoje" />
          {isLiveWorkspace ? (
            peopleRows.length ? peopleRows.map((person) => {
              const metric = dashboard?.peopleMetrics?.find((item) => item.profileId === person.id);
              return (
              <div className="person-row" key={person.id ?? person.n}>
                <span className="avatar muted">{person.ini}</span>
                <div><strong>{person.n}</strong><small>{person.r}</small></div>
                <div className="row-right"><b>{metric?.completionRate ?? 0}%</b><small>{metric?.completed ?? 0}/{metric?.total ?? 0} tarefas</small></div>
              </div>
            );}) : <EmptyState icon="ph-users-three" title="Nenhuma pessoa nesta visão" text="Convide ou cadastre funcionários para acompanhar a execução da área." />
          ) : demoTeamRows.map((person) => (
            <div className="person-row" key={person[1]}>
              <span className="avatar muted">{person[0]}</span>
              <div><strong>{person[1]}</strong><small>{person[2]}</small></div>
              <div className="row-right"><b style={{ color: person[5] }}>{person[3]}</b><small>{person[4]}</small></div>
            </div>
          ))}
        </section>
        <div className="stack">
          <section className="panel flush">
            <PanelHeader title="Aprovações pendentes" aside={String(approvalRows.length)} />
            {approvalRows.length ? approvalRows.map((task) => {
              const isDemo = task.id.startsWith("demo_");
              const attachment = task.evidence?.attachment;
              return (
                <div className="approval-row approval-row-actions" key={task.id}>
                  <span className="square square-warn"><Icon name="ph-seal-check" /></span>
                  <div>
                    <strong>{task.title}</strong>
                    <small>{task.evidence?.comment ?? "Evidência enviada pelo funcionário"}</small>
                    {attachment ? <div className="approval-evidence">
                      {attachment.url ? <a href={attachment.url} target="_blank" rel="noreferrer">{attachment.fileName}</a> : <span>{attachment.fileName}</span>}
                      {hasSafeEvidencePreview(attachment) ? <img src={attachment.url} alt={`Prévia de ${attachment.fileName}`} referrerPolicy="no-referrer" /> : null}
                    </div> : null}
                  </div>
                  <button type="button" disabled={isDemo} onClick={() => approveTask(task)}>Aprovar {pendingApprovals.length ? task.title : ""}</button>
                  {pendingApprovals.length ? <button className="ghost-action" type="button" onClick={() => returnTask(task)}>Devolver {task.title}</button> : null}
                </div>
              );
            }) : <EmptyState icon="ph-seal-check" title="Nada para aprovar" text="As evidências enviadas pela equipe aparecem aqui." />}
          </section>
          {!isLiveWorkspace ? <section className="panel flush">
            <PanelHeader title="Dúvidas da área" />
            {[
              "A etapa 3 vale para clientes com aprovação por WhatsApp?",
              "Preciso registrar evidência mesmo em ajuste pequeno?"
            ].map((q, index) => (
              <div className="question-row" key={q}>
                <p>“{q}”</p>
                <small>{index === 0 ? "Carla Dias" : "Bruno Costa"} · {index === 0 ? "Processo · Aprovação de peças" : "Rotina · Abertura do dia"}</small>
              </div>
            ))}
          </section> : null}
        </div>
      </div>
    </div>
  );
}

function TodayTaskButton({ task, toggleTask, nested = false }: { task: TodayTaskRow; toggleTask: (task: TodayTaskRow) => void; nested?: boolean }) {
  return (
    <button
      className={`task-row rowh${nested ? " routine-task-row" : ""}`}
      type="button"
      onClick={() => toggleTask(task)}
    >
      <span className={`check ${task.done ? "done" : ""}`}>{task.submitting ? <Icon name="ph-clock" /> : task.done ? <Icon name="ph-check" bold /> : null}</span>
      <span><strong className={task.done ? "done-text" : ""}>{task.label}</strong><small>{task.meta}</small></span>
      {task.evid ? <Pill><Icon name="ph-camera" /> evidência</Pill> : null}
      {task.status === "awaiting_approval" ? <Pill tone="warn">Enviado para aprovação</Pill> : null}
      {task.status === "needs_adjustment" ? <Pill tone="danger">Devolvido</Pill> : null}
      {task.prio ? <Pill tone={task.prio === "Alta" ? "danger" : task.prio === "Média" ? "warn" : "neutral"}>{task.prio}</Pill> : null}
    </button>
  );
}

function TodayPage({
  operationalDate,
  identity,
  taskRows,
  trainingAssignments,
  announcements,
  isLiveWorkspace,
  canCreateTask,
  createTask,
  toggleTask,
  manageTask,
  onChecklistChange,
  go
}: {
  operationalDate: string;
  identity: Identity;
  taskRows: TodayTaskRow[];
  trainingAssignments: ApiTrainingAssignment[];
  announcements: ApiAnnouncement[];
  isLiveWorkspace: boolean;
  canCreateTask: boolean;
  createTask: () => void;
  toggleTask: (task: TodayTaskRow) => void;
  manageTask: (task: TodayTaskRow) => void;
  onChecklistChange: (task: TodayTaskRow, checklistItems: NonNullable<ApiTask["checklistItems"]>) => Promise<void>;
  go: (screen: Screen) => void;
}) {
  const [expandedOccurrenceIds, setExpandedOccurrenceIds] = useState<Set<string>>(() => new Set());
  const [updatingChecklistIds, setUpdatingChecklistIds] = useState<Set<string>>(() => new Set());
  const announcementRows = announcements.length ? announcements : [];
  const trainingRows = trainingAssignments.length ? trainingAssignments : [];
  const effectiveTasksDone = taskRows.filter((task) => task.done).length;
  const effectiveTaskTotal = taskRows.length;
  const effectiveTasksPct = effectiveTaskTotal > 0 ? `${Math.round((effectiveTasksDone / effectiveTaskTotal) * 100)}%` : "0%";
  const { manualTasks, routineGroups } = useMemo(() => {
    const manualTasks: TodayTaskRow[] = [];
    const routines = new Map<string, { id: string; title: string; tasks: TodayTaskRow[] }>();

    for (const task of taskRows) {
      if (!task.routineId) {
        manualTasks.push(task);
        continue;
      }

      const group = routines.get(task.routineId) ?? {
        id: task.routineId,
        title: task.routineTitle ?? "Rotina sem título",
        tasks: []
      };
      group.tasks.push(task);
      routines.set(task.routineId, group);
    }

    return { manualTasks, routineGroups: [...routines.values()] };
  }, [taskRows]);

  function toggleOccurrenceExpansion(taskId: string) {
    setExpandedOccurrenceIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  async function toggleOccurrenceChecklistItem(task: TodayTaskRow, itemIndex: number) {
    if (!task.checklistItems?.length || updatingChecklistIds.has(task.id)) return;
    const nextItems = task.checklistItems.map((item, index) => index === itemIndex ? { ...item, done: !item.done } : item);
    setUpdatingChecklistIds((current) => new Set(current).add(task.id));
    try {
      await onChecklistChange(task, nextItems);
    } finally {
      setUpdatingChecklistIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  function renderChecklistTask(task: TodayTaskRow, kind: "manual" | "routine") {
    const expanded = expandedOccurrenceIds.has(task.id);
    const checklistTotal = task.checklistItems?.length ?? 0;
    const checklistDone = task.checklistItems?.filter((item) => item.done).length ?? 0;

    return (
      <article className={`today-routine-occurrence${kind === "manual" ? " today-manual-occurrence" : ""}`} key={task.id}>
        <div className="today-routine-occurrence-head">
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "Recolher" : "Expandir"} checklist de ${task.label}`}
            className="today-routine-occurrence-toggle"
            type="button"
            onClick={() => toggleOccurrenceExpansion(task.id)}
          >
            <span className="today-routine-caret"><Icon name={expanded ? "ph-caret-down" : "ph-caret-right"} /></span>
            <span className="today-routine-copy"><strong className={task.done ? "done-text" : ""}>{task.label}</strong><small>{task.meta}</small></span>
            <span className="today-routine-progress">{checklistDone}/{checklistTotal} concluídos</span>
            {kind === "manual" && task.prio ? <Pill tone={task.prio === "Alta" ? "danger" : task.prio === "Média" ? "warn" : "neutral"}>{task.prio}</Pill> : null}
          </button>
          {kind === "manual" && canCreateTask ? (
            <button
              aria-label={`Gerenciar tarefa: ${task.label}`}
              className="today-manual-manage"
              title="Gerenciar tarefa"
              type="button"
              onClick={() => manageTask(task)}
            >
              <Icon name="ph-pencil-simple" />
            </button>
          ) : null}
        </div>
        {expanded ? (
          <div className="today-routine-checklist" aria-label={`Checklist de ${task.label}`}>
            {task.checklistItems!.map((item, index) => (
              <label className={item.done ? "done" : ""} key={`${task.id}-${item.title}-${index}`}>
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={task.done || updatingChecklistIds.has(task.id)}
                  onChange={() => void toggleOccurrenceChecklistItem(task, index)}
                />
                <span>{item.title}</span>
              </label>
            ))}
            {!task.done && checklistDone === checklistTotal ? (
              <button className="today-routine-finish" type="button" onClick={() => toggleTask(task)}>Finalizar execução</button>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <div className="screen today-grid">
      <div>
        <div className="page-head compact">
          <div>
            <h1 className="serif">Seu dia, {firstName(identity.name)}.</h1>
            <p>{operationalDayLabel(operationalDate)} · foque no que é seu. O resto o Baase organiza.</p>
          </div>
        </div>
        <section className="panel padded progress-card">
          <div><strong>Progresso do dia</strong><span>{effectiveTasksDone} de {effectiveTaskTotal}</span></div>
          <PercentBar value={effectiveTasksPct} />
        </section>
        <section className="panel flush">
          <PanelHeader title="Tarefas de hoje" link={canCreateTask ? "Nova tarefa" : undefined} onLinkClick={createTask} />
          {taskRows.length ? (
            <div className="today-task-groups">
              {manualTasks.length ? (
                <div className="today-task-section">
                  {routineGroups.length ? <p className="today-task-section-label">Tarefas pontuais</p> : null}
                  {manualTasks.map((task) => task.checklistItems?.length
                    ? renderChecklistTask(task, "manual")
                    : <TodayTaskButton key={task.id} task={task} toggleTask={toggleTask} />)}
                </div>
              ) : null}
              {routineGroups.map((routine) => {
                return (
                  <div className="today-routine-group" key={routine.id}>
                    <div className="today-routine-head">
                      <span className="today-routine-copy"><strong>{routine.title}</strong><small>{routine.tasks.length === 1 ? "1 execução de hoje" : `${routine.tasks.length} execuções independentes hoje`}</small></span>
                    </div>
                    <div className="today-routine-tasks">
                      {routine.tasks.map((task) => renderChecklistTask(task, "routine"))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState icon="ph-sun" title="Nenhuma tarefa para hoje" text="Quando uma rotina ou tarefa pontual gerar execução, ela aparece aqui para a equipe concluir." />}
        </section>
        <section className="panel flush">
          <PanelHeader title="Pendências" />
          {(announcementRows.length ? announcementRows : isLiveWorkspace ? [] : [{ id: "demo_announcement", title: "Novo fluxo de aprovação", type: "simple", status: "published", requirement: "read_confirmation" } as ApiAnnouncement]).map((announcement) => (
            <button className="attention-row rowh" type="button" onClick={() => go("comunicados")} key={announcement.id}>
              <span className="square square-info"><Icon name="ph-megaphone" /></span>
              <strong>Confirmar leitura: {announcement.title}</strong>
              <Pill tone="info">Comunicado</Pill>
              <Icon name="ph-caret-right" />
            </button>
          ))}
          {(trainingRows.length ? trainingRows : isLiveWorkspace ? [] : [{ assignmentId: "demo_training", trainingId: "demo_training", profileId: "demo", dueDate: null, status: "pending", completedAt: null, score: null, passed: null, training: { id: "demo_training", title: "Padrão de aprovação de peças", status: "published" } } as ApiTrainingAssignment]).map((assignment) => (
            <button className="attention-row rowh" type="button" onClick={() => go("treinamentos")} key={assignment.assignmentId}>
              <span className="square square-warn"><Icon name="ph-graduation-cap" /></span>
              <strong>Treinamento: {assignment.training.title}</strong>
              <Pill tone="warn">{assignment.dueDate ? `até ${assignment.dueDate.slice(5)}` : "pendente"}</Pill>
              <Icon name="ph-caret-right" />
            </button>
          ))}
          {isLiveWorkspace && !announcementRows.length && !trainingRows.length ? <EmptyState icon="ph-check-circle" title="Sem pendências" text="Comunicados e treinamentos pendentes aparecem aqui." /> : null}
        </section>
      </div>
    </div>
  );
}

function AreaArchiveDialog({
  area,
  impact,
  areas,
  actionBusy,
  onClose,
  onConfirm
}: {
  area: AreaDisplayRow;
  impact: ApiAreaImpact;
  areas: ApiArea[];
  actionBusy: boolean;
  onClose: () => void;
  onConfirm: (resolution: { strategy: "reassign"; targetAreaId: string } | { strategy: "unassign" }) => void;
}) {
  const affected = [
    { label: "processo", count: impact.processes.length },
    { label: "rotina", count: impact.routines.length },
    { label: "cargo", count: impact.roleTemplates.length },
    { label: "pessoa", count: impact.people.length },
    { label: "convite", count: impact.pendingInvites.length }
  ].filter((item) => item.count > 0);
  const [strategy, setStrategy] = useState<"reassign" | "unassign">(affected.length ? "reassign" : "unassign");
  const [targetAreaId, setTargetAreaId] = useState(areas[0]?.id ?? "");
  const disabled = actionBusy || (strategy === "reassign" && !targetAreaId);

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-card area-archive-modal" role="dialog" aria-modal="true" aria-labelledby="archive-area-title">
        <div className="modal-form">
          <ModalHeader title="Arquivar área" icon="ph-warning" onClose={onClose} />
          <p className="archive-copy">Você está arquivando <strong>{area.name}</strong>. Escolha o destino dos vínculos ativos antes de continuar.</p>
          {affected.length ? <div className="archive-impact-list">{affected.map(({ label, count }) => <span key={label}><strong>{count}</strong> {label}{count > 1 ? "s" : ""}</span>)}</div> : <p className="archive-copy">Não há vínculos ativos nesta área.</p>}
          <fieldset className="archive-resolution"><legend>Como resolver os vínculos?</legend><label><input type="radio" checked={strategy === "reassign"} onChange={() => setStrategy("reassign")} />Transferir para outra área</label>{strategy === "reassign" ? <select aria-label="Área de destino" value={targetAreaId} onChange={(event) => setTargetAreaId(event.target.value)}><option value="">Selecionar área</option>{areas.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select> : null}<label><input type="radio" checked={strategy === "unassign"} onChange={() => setStrategy("unassign")} />Deixar sem área</label></fieldset>
          <footer><button className="secondary-btn" type="button" disabled={actionBusy} onClick={onClose}>Cancelar</button><button className="danger-btn" type="button" disabled={disabled} onClick={() => onConfirm(strategy === "reassign" ? { strategy, targetAreaId } : { strategy })}>Arquivar área</button></footer>
        </div>
      </div>
    </div>
  );
}

function CompanyMap({
  canCreateArea,
  canArchiveArea,
  areaRows,
  workspaceName,
  workspaceSubtitle,
  openAreaForm,
  openRoleForm,
  openPersonForm,
  editArea,
  deleteArea,
  deleteRoleTemplate
}: {
  canCreateArea: boolean;
  canArchiveArea: boolean;
  areaRows: AreaDisplayRow[];
  workspaceName: string;
  workspaceSubtitle: string;
  openAreaForm: () => void;
  openRoleForm: () => void;
  openPersonForm: () => void;
  editArea: (area: AreaDisplayRow) => void;
  deleteArea: (area: AreaDisplayRow) => void;
  deleteRoleTemplate: (roleTemplate: AreaRoleDisplayRow) => void;
}) {
  const [selectedAreaKey, setSelectedAreaKey] = useState<string | null>(null);
  const selectedArea = selectedAreaKey ? areaRows.find((area) => areaDisplayKey(area) === selectedAreaKey) ?? null : null;

  return (
    <div className="screen">
      <div className="page-head">
        <div><h1 className="serif">Mapa da Empresa</h1><p>Áreas, cargos e pessoas criados para a operação. As rotinas se atribuem a qualquer nível.</p></div>
        <div className="button-row">
          {canCreateArea ? <button className="secondary-btn" type="button" onClick={openAreaForm}><Icon name="ph-plus" />Nova área</button> : null}
          <button className="secondary-btn" type="button" onClick={openRoleForm}><Icon name="ph-identification-card" />Novo cargo</button>
          <button className="accent-btn" type="button" onClick={openPersonForm}><Icon name="ph-user-plus" />Nova pessoa</button>
        </div>
      </div>
      <div className="org-root"><strong>{workspaceName}</strong><small>Empresa · {workspaceSubtitle}</small></div>
      {areaRows.length ? <div className="area-grid">
        {areaRows.map((area) => (
          <button className={`area-card lift ${selectedArea && areaDisplayKey(selectedArea) === areaDisplayKey(area) ? "active" : ""}`} type="button" key={areaDisplayKey(area)} onClick={() => setSelectedAreaKey(areaDisplayKey(area))} aria-label={`Abrir área ${area.name}`}>
            <header><span style={{ background: area.color }} /><div><strong>{area.name}</strong><small>{area.people} pessoa(s)</small></div>{area.gap ? <Icon name="ph-warning" fill /> : null}</header>
            <div>
              {area.members.length ? areaMemberGroups(area).map((group) => (
                <div className="area-member-group" key={group.key}>
                  <small className="mono area-member-role">{group.role}</small>
                  {group.people.map((member) => (
                    <div className="area-member" key={`${group.key}-${member.name}`}>
                      <span className="mini-user"><Icon name="ph-user" /></span>
                      <span className="area-member-name">{member.name}</span>
                    </div>
                  ))}
                </div>
              )) : (area.roles.length ? area.roles.map((roleTemplate) => roleTemplate.name) : area.cargos.length ? area.cargos : [NO_ROLES_LABEL]).map((cargo) => <small className="mono area-role" key={cargo}>{cargo}</small>)}
            </div>
          </button>
        ))}
      </div> : <EmptyState icon="ph-squares-four" title="Mapa ainda vazio" text="Crie áreas, cargos e pessoas ou finalize o onboarding para montar a empresa." />}
      {selectedArea ? (
        <section className="panel padded area-detail">
          <div>
            <span className="mono faint">Área selecionada</span>
            <h2>{selectedArea.name}</h2>
            <p>{selectedArea.people} pessoa(s) · {(selectedArea.roles.length || selectedArea.cargos.length)} cargo(s)</p>
          </div>
          <div className="area-detail-list">
            <strong>Cargos</strong>
            {selectedArea.roles.length ? selectedArea.roles.map((roleTemplate) => (
              <div className="area-role-row" key={roleTemplate.id ?? roleTemplate.name}>
                <span className="mono area-role">{roleTemplate.name}</span>
                {roleTemplate.id ? (
                  <button
                    aria-label={`Excluir cargo ${roleTemplate.name}`}
                    className="tiny-icon danger-icon"
                    title={`Excluir cargo ${roleTemplate.name}`}
                    type="button"
                    onClick={() => deleteRoleTemplate(roleTemplate)}
                  >
                    <Icon name="ph-trash" />
                  </button>
                ) : null}
              </div>
            )) : selectedArea.cargos.length ? selectedArea.cargos.map((cargo) => <span className="mono area-role" key={cargo}>{cargo}</span>) : <span className="mono area-role">{NO_ROLES_LABEL}</span>}
          </div>
          <div className="area-detail-list">
            <strong>Pessoas</strong>
            {selectedArea.names.length ? selectedArea.names.map((name) => <span key={name}>{name}</span>) : <span>Nenhuma pessoa vinculada</span>}
          </div>
          <div className="button-row">
            {selectedArea.id ? (
              <>
                <button className="secondary-btn" type="button" onClick={() => editArea(selectedArea)}><Icon name="ph-pencil-simple" />Renomear área</button>
                {canArchiveArea ? <button className="secondary-btn danger-btn" type="button" onClick={() => deleteArea(selectedArea)}><Icon name="ph-trash" />Excluir área</button> : null}
              </>
            ) : null}
            <button className="secondary-btn" type="button" onClick={openRoleForm}><Icon name="ph-identification-card" />Adicionar cargo</button>
            <button className="accent-btn" type="button" onClick={openPersonForm}><Icon name="ph-user-plus" />Adicionar pessoa</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

type AccessReach = "assigned_only" | "primary_area" | "specific_areas" | "workspace";

function accessReachFromStored(accessScope: "workspace" | "area" | "assigned_only" | undefined, areaId: string | null | undefined, areaAccessIds: string[] | undefined): AccessReach {
  if (!accessScope) return "workspace";
  if (accessScope === "workspace") return "workspace";
  if (accessScope === "assigned_only") return "assigned_only";
  const uniqueAreas = [...new Set(areaAccessIds ?? [])];
  return uniqueAreas.some((id) => id !== areaId) ? "specific_areas" : "primary_area";
}

function accessPayloadForReach(reach: AccessReach, areaId: string, areaAccessIds: string[]) {
  const selectedAreas = [...new Set([areaId, ...areaAccessIds].filter(Boolean))];
  if (reach === "workspace") return { accessScope: "workspace" as const, areaAccessIds: [] };
  if (reach === "assigned_only") return { accessScope: "assigned_only" as const, areaAccessIds: [] };
  if (reach === "primary_area") return { accessScope: "area" as const, areaAccessIds: areaId ? [areaId] : [] };
  return { accessScope: "area" as const, areaAccessIds: selectedAreas };
}

function accessReachSummary(reach: AccessReach, areaId: string, areas: ApiArea[]) {
  if (reach === "workspace") return "Pode consultar toda a empresa.";
  if (reach === "assigned_only") return "Vê apenas tarefas e conteúdos atribuídos diretamente.";
  const areaName = areas.find((area) => area.id === areaId)?.name ?? "a área principal";
  if (reach === "primary_area") return `Vê processos, rotinas e treinamentos de ${areaName}.`;
  return "Vê as áreas selecionadas abaixo, incluindo a área principal.";
}

function inviteAccessLabel(invite: ApiInvite, areas: ApiArea[]) {
  const areaNames = areaNameMap(areas);
  if (invite.accessScope === "workspace") return "Empresa inteira";
  if (invite.accessScope === "assigned_only") return "Somente atribuídos";
  const selectedAreas = [...new Set(invite.areaAccessIds?.length ? invite.areaAccessIds : invite.areaId ? [invite.areaId] : [])];
  if (!selectedAreas.length) return "Sem área definida";
  const labels = selectedAreas.map((id) => areaLabel(id, areaNames));
  return labels.length === 1 ? labels[0]! : `${labels[0]} + ${labels.length - 1} área${labels.length > 2 ? "s" : ""}`;
}

function TeamPage({
  openInvite,
  actionBusy,
  peopleRows,
  invites,
  deleteInvite,
  people,
  areas,
  canEditPerson,
  editPerson
}: {
  openInvite: () => void;
  actionBusy: boolean;
  peopleRows: TeamDisplayRow[];
  invites: ApiInvite[];
  deleteInvite: (invite: ApiInvite) => void;
  people: ApiPerson[];
  areas: ApiArea[];
  canEditPerson: (person: ApiPerson) => boolean;
  editPerson: (person: ApiPerson) => void;
}) {
  const pendingInvites = invites.filter((invite) => invite.status === "pending");

  return (
    <div className="screen">
      <div className="page-head">
        <div><h1 className="serif">Equipe</h1><p>{peopleRows.length} pessoas · convide por e-mail e defina o acesso antes da primeira entrada.</p></div>
        <button className="accent-btn" type="button" onClick={openInvite} disabled={actionBusy}><Icon name="ph-user-plus" />Convidar</button>
      </div>
      {pendingInvites.length ? (
        <section className="panel flush invite-list">
          <PanelHeader title="Convites pendentes" aside={String(pendingInvites.length)} />
          {pendingInvites.map((invite) => (
            <div className="invite-row" key={invite.id}>
              <div><strong>{invite.name}</strong><small>{invite.email ?? "Sem email"} · {apiRoleLabel(invite.role)}</small></div>
              <span className="invite-access">{inviteAccessLabel(invite, areas)}</span>
              <Pill tone="warn">Aguardando entrada</Pill>
              <button className="tiny-icon danger-icon" type="button" aria-label={`Cancelar convite de ${invite.name ?? invite.email ?? "pessoa"}`} disabled={actionBusy} onClick={() => deleteInvite(invite)}><Icon name="ph-trash" /></button>
            </div>
          ))}
        </section>
      ) : null}
      <section className="panel flush table-panel">
        <div className="team-head"><span>Pessoa</span><span>Área / cargo</span><span>Papel</span><span /></div>
        {peopleRows.length ? peopleRows.map((person) => {
          const apiPerson = person.id ? people.find((item) => item.id === person.id) : null;
          const editable = Boolean(apiPerson && canEditPerson(apiPerson));

          return (
            <button className="team-row" type="button" key={person.id ?? person.n} aria-label={editable ? `Editar ${person.n}` : person.n} disabled={!editable} onClick={() => editable && apiPerson && editPerson(apiPerson)}>
              <div><span className="avatar">{person.ini}</span><div><strong>{person.n}</strong><small>{person.r}</small></div></div>
              <span>{person.area}</span>
              <Pill tone={person.role === "gestor" ? "info" : person.role === "dono" ? "neutral" : "neutral"}>{person.role === "dono" ? "Dono" : person.role === "gestor" ? "Gestor" : "Funcionário"}</Pill>
              {editable ? <Icon name="ph-pencil-simple" /> : <span />}
            </button>
          );
        }) : <EmptyState icon="ph-users-three" title="Equipe ainda vazia" text="Convide funcionários ou cadastre pessoas para montar a operação real." />}
      </section>
    </div>
  );
}

function ProcessesPage({
  canManage,
  canManageWorkspace,
  go,
  processes,
  areas,
  isLiveWorkspace,
  createProcess,
  editProcess,
  publishProcess,
  unpublishProcess,
  deleteProcess,
  communicateProcess,
  actionBusy
}: {
  canManage: boolean;
  canManageWorkspace: boolean;
  go: (screen: Screen) => void;
  processes: ApiProcess[];
  areas: ApiArea[];
  isLiveWorkspace: boolean;
  createProcess: () => void;
  editProcess: (process: ApiProcess) => void;
  publishProcess: (process: ApiProcess) => void;
  unpublishProcess: (process: ApiProcess) => void;
  deleteProcess: (process: ApiProcess) => void;
  communicateProcess: (process: ApiProcess) => void;
  actionBusy: boolean;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<number | null>(null);
  const [exportingProcess, setExportingProcess] = useState(false);
  const [processExportMessage, setProcessExportMessage] = useState("");
  const fallbackProcesses: ApiProcess[] = [
    {
      id: "fallback_onboarding",
      title: "Onboarding de cliente novo",
      areaId: "Atendimento",
      status: "published",
      summary: "Do fechamento ao kickoff. Garante que todo cliente entre com acessos, pasta, board e responsável definidos.",
      currentVersion: { version: 3, body: "1. Registrar fechamento e coletar acessos\n2. Criar pasta e board do cliente\n3. Kickoff interno\n4. Publicar próximos passos" }
    },
    {
      id: "fallback_aprovacao",
      title: "Aprovação de peças",
      areaId: "Criação",
      status: "published",
      summary: "Fluxo de revisão interna para aprovar peças antes de qualquer envio ao cliente.",
      currentVersion: { version: 2, body: "1. Subir a peça no Baase\n2. Marcar responsável pela revisão\n3. Ajustar apontamentos\n4. Registrar aprovação final" }
    },
    {
      id: "fallback_fechamento",
      title: "Fechamento de campanha",
      areaId: "Mídia",
      status: "published",
      summary: "Como fechar campanha, consolidar resultados e registrar próximos passos.",
      currentVersion: { version: 1, body: "1. Consolidar indicadores\n2. Anexar relatório\n3. Registrar aprendizados\n4. Criar próximos ajustes" }
    },
    {
      id: "fallback_financeiro",
      title: "Conciliação financeira",
      areaId: "Financeiro",
      status: "draft",
      summary: "Rascunho inicial para conferência de entradas e saídas.",
      currentVersion: { version: 1, body: "1. Conferir entradas\n2. Conferir saídas\n3. Marcar divergências\n4. Enviar para o dono" }
    }
  ];
  const records = processes.length ? processes : isLiveWorkspace ? [] : fallbackProcesses;
  const safeIndex = Math.min(selectedIndex, Math.max(records.length - 1, 0));
  const selectedProcess = records[safeIndex] ?? null;
  const selectedApiProcess = selectedProcess && processes.some((process) => process.id === selectedProcess.id) ? selectedProcess : null;
  const versions = processVersionHistory(selectedProcess);
  const selectedVersion = versions.find((version) => version.version === selectedVersionNumber) ?? versions[0] ?? null;
  const selectedVersionLabel = selectedVersion?.version ?? selectedProcess?.currentVersion?.version ?? 1;
  const selectedVersionBody = selectedVersion?.body ?? selectedProcess?.currentVersion?.body;
  const canManageSelectedProcess = canManage && Boolean(selectedProcess && (selectedProcess.areaId || canManageWorkspace));
  const parsedProcessBody = parseProcessBody(selectedVersionBody);
  const areaNames = areaNameMap(areas);
  const items = records.map((process, index) => [
    cleanProcessTitle(process.title),
    areaLabel(process.areaId, areaNames),
    statusLabel(process.status),
    index === safeIndex
  ] satisfies [string, string, string, boolean]);
  const selectedAreaLabel = selectedProcess ? areaLabel(selectedProcess.areaId, areaNames) : "Sem área definida";

  useEffect(() => {
    setSelectedVersionNumber(null);
  }, [selectedProcess?.id]);

  async function exportSelectedProcess() {
    if (!selectedProcess) return;
    setExportingProcess(true);
    setProcessExportMessage("");
    try {
      if (!selectedApiProcess) throw new Error("PROCESS_NOT_PERSISTED");
      await downloadEditorialProcessPdf(selectedApiProcess.id);
    } catch {
      setProcessExportMessage("Não foi possível preparar o PDF agora. Tente novamente.");
    } finally {
      setExportingProcess(false);
    }
  }

  return (
    <div className="screen split-page">
      <SideList title="Processos" icon={canManage ? "ph-plus" : undefined} items={items} onCreate={canManage ? createProcess : undefined} onSelect={setSelectedIndex} />
      <section className="panel detail-panel">
        {selectedProcess ? (
          <>
            <header className="process-detail-head">
              <div className="process-title-block">
                <div className="meta-line">
                  <Pill tone={selectedProcess.status === "published" ? "accent" : "neutral"}>{statusLabel(selectedProcess.status)}</Pill>
                  <span className="mono">v{selectedVersionLabel} · {selectedAreaLabel}</span>
                </div>
                <h1 className="serif">{cleanProcessTitle(selectedProcess.title)}</h1>
                <p>{selectedProcess.summary ?? parsedProcessBody.objective ?? "Processo criado para revisão. Edite as etapas antes de publicar para a equipe."}</p>
              </div>
              <div className="button-row process-actions">
                {canManageSelectedProcess ? <>
                <button className="secondary-btn" type="button" onClick={() => selectedApiProcess && editProcess(selectedApiProcess)} disabled={!selectedApiProcess}><Icon name="ph-pencil-simple" />Editar</button>
                </> : null}
                <button className="secondary-btn" type="button" disabled={exportingProcess} onClick={() => void exportSelectedProcess()}><Icon name="ph-download-simple" />{exportingProcess ? "Preparando…" : "Baixar PDF"}</button>
                {canManageSelectedProcess && (selectedProcess.status === "published" ? (
                  <button className="secondary-btn" type="button" disabled={actionBusy || !selectedApiProcess} onClick={() => selectedApiProcess && unpublishProcess(selectedApiProcess)}><Icon name="ph-eye-slash" />Despublicar</button>
                ) : (
                  <button className="accent-btn" type="button" disabled={actionBusy || !selectedApiProcess} onClick={() => selectedApiProcess && publishProcess(selectedApiProcess)}><Icon name="ph-check-circle" />Publicar SOP</button>
                ))}
                {canManageSelectedProcess ? <>
                  <button className="secondary-btn danger-btn" type="button" disabled={actionBusy || !selectedApiProcess} onClick={() => selectedApiProcess && deleteProcess(selectedApiProcess)}><Icon name="ph-trash" />Excluir</button>
                  <button className="accent-solid" type="button" disabled={actionBusy || !selectedProcess} onClick={() => communicateProcess(selectedProcess)}><Icon name="ph-megaphone" />Comunicar mudança</button>
                </> : null}
              </div>
            </header>
            {processExportMessage ? <p className="form-error" role="alert">{processExportMessage}</p> : null}
            <div className="inline-meta">
              <span><Icon name="ph-users-three" />{selectedAreaLabel}</span>
              <span><Icon name="ph-user" />Responsável a definir</span>
              <span><Icon name="ph-paperclip" />Materiais opcionais</span>
            </div>
            {(parsedProcessBody.objective || parsedProcessBody.trigger || parsedProcessBody.rule) ? (
              <section className="process-brief">
                {parsedProcessBody.objective ? <div><span>Objetivo</span><p>{parsedProcessBody.objective}</p></div> : null}
                {parsedProcessBody.trigger ? <div><span>Gatilho</span><p>{parsedProcessBody.trigger}</p></div> : null}
                {parsedProcessBody.rule ? <div><span>Regra operacional</span><p>{parsedProcessBody.rule}</p></div> : null}
              </section>
            ) : null}
            <div className="steps process-steps">
              <h2>Etapas</h2>
              {parsedProcessBody.steps.map((step, index) => (
                <div className="step process-step" key={`${index}_${step.title}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    {step.detail ? <p>{step.detail}</p> : null}
                    {step.expectedResult ? (
                      <div className="process-step-result">
                        <span>Resultado esperado</span>
                        <p>{step.expectedResult}</p>
                      </div>
                    ) : null}
                    {step.attentionPoints?.length ? (
                      <ul className="process-step-attention">
                        {step.attentionPoints.map((point) => <li key={point}>{point}</li>)}
                      </ul>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <footer className="version-box">
              <h2><Icon name="ph-clock-counter-clockwise" />Histórico de versões <small className="mono">clique para comparar</small></h2>
              {versions.map((version) => {
                const note = version.changeNote ?? "Versão registrada";
                const date = version.createdAt ? new Date(version.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "Sem data";
                const editor = version.editorProfileId === "profile_manager" ? "Gestor" : version.editorProfileId === "profile_owner" ? "Dono" : "Baase";

                return (
                  <button
                    aria-label={`v${version.version} · ${note}`}
                    className={selectedVersion?.version === version.version ? "active" : ""}
                    key={version.id ?? version.version}
                    type="button"
                    onClick={() => setSelectedVersionNumber(version.version)}
                  >
                    <strong>v{version.version}</strong>
                    <span>{note}</span>
                    <small>{editor} · {date}</small>
                  </button>
                );
              })}
            </footer>
          </>
        ) : <EmptyState icon="ph-file-text" title="Nenhum processo criado" text="Crie um processo do zero, use um modelo ou gere com IA para começar a base operacional." />}
      </section>
    </div>
  );
}

const WEEKDAY_LABELS: Record<ApiRoutineWeekday, string> = {
  mon: "Seg",
  tue: "Ter",
  wed: "Qua",
  thu: "Qui",
  fri: "Sex",
  sat: "Sab",
  sun: "Dom"
};

const DEFAULT_BUSINESS_WEEKDAYS: ApiRoutineWeekday[] = ["mon", "tue", "wed", "thu", "fri"];

function routineFrequencyLabel(frequency: ApiRoutineFrequency | undefined) {
  if (frequency === "weekly") return "Semanal";
  if (frequency === "monthly") return "Mensal";
  if (frequency === "on_demand") return "Sob demanda";
  return "Diária";
}

function routineScheduleLabel(routine: ApiRoutine) {
  const frequency = routineFrequencyLabel(routine.frequency);
  const weekdays = routine.weekdays?.length ? routine.weekdays.map((day) => WEEKDAY_LABELS[day]).join(", ") : "";
  return weekdays ? `${frequency} · ${weekdays}` : frequency;
}

function RoutinesPage({
  canManage,
  canManageWorkspace,
  go,
  showNotice,
  routines,
  isLiveWorkspace,
  createRoutine,
  editRoutine,
  archiveRoutine,
  deleteRoutine,
  actionBusy,
  checkRows,
  checks,
  checkDone,
  checkPct,
  setChecks,
  areas,
  people
}: {
  canManage: boolean;
  canManageWorkspace: boolean;
  go: (screen: Screen) => void;
  showNotice: (message: string) => void;
  routines: ApiRoutine[];
  isLiveWorkspace: boolean;
  createRoutine: () => void;
  editRoutine: (routine: ApiRoutine) => void;
  archiveRoutine: (routine: ApiRoutine) => void;
  deleteRoutine: (routine: ApiRoutine) => void;
  actionBusy: boolean;
  checkRows: Array<{ id: string; label: string; done: boolean }>;
  checks: Record<string, boolean>;
  checkDone: number;
  checkPct: string;
  setChecks: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  areas: ApiArea[];
  people: ApiPerson[];
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const fallbackRoutines: ApiRoutine[] = [
    { id: "fallback_social", title: "Abertura do dia — Social", status: "active", areaId: "Criação" },
    { id: "fallback_midia", title: "Relatório semanal de mídia", status: "active", areaId: "Mídia" },
    { id: "fallback_financeiro", title: "Conciliação financeira", status: "active", areaId: "Financeiro" }
  ];
  const records = routines.length ? routines : isLiveWorkspace ? [] : fallbackRoutines;
  const safeIndex = Math.min(selectedIndex, Math.max(records.length - 1, 0));
  const selectedRoutine = records[safeIndex] ?? null;
  const selectedApiRoutine = selectedRoutine && routines.some((routine) => routine.id === selectedRoutine.id) ? selectedRoutine : null;
  const selectedTaskTemplates = selectedRoutine?.taskTemplates ?? [];
  const routineCheckRows: Array<{
    id: string;
    label: string;
    done: boolean;
    dueHint?: string | null;
    evidencePolicy?: ApiRoutineTaskTemplate["evidencePolicy"];
    approvalMode?: ApiRoutineTaskTemplate["approvalMode"];
  }> = selectedTaskTemplates.length
    ? selectedTaskTemplates.map((task, index) => {
      const id = task.id ?? `${selectedRoutine?.id ?? "routine"}_${index}_${task.title}`;
      return {
        id,
        label: task.title,
        done: Boolean(checks[id]),
        dueHint: task.dueHint ?? selectedRoutine?.dueHint,
        evidencePolicy: task.evidencePolicy ?? selectedRoutine?.evidencePolicy,
        approvalMode: task.approvalMode ?? selectedRoutine?.approvalMode
      };
    })
    : isLiveWorkspace ? [] : checkRows;
  const routineDone = selectedTaskTemplates.length || isLiveWorkspace ? routineCheckRows.filter((check) => check.done).length : checkDone;
  const routinePct = routineCheckRows.length ? `${Math.round((routineDone / routineCheckRows.length) * 100)}%` : isLiveWorkspace ? "0%" : checkPct;
  const routineAreaNames = areaNameMap(areas);
  const selectedAreaName = selectedRoutine?.areaId ? areaLabel(selectedRoutine.areaId, routineAreaNames) : "Empresa inteira";
  const canManageSelectedRoutine = canManage && Boolean(selectedRoutine && (selectedRoutine.areaId || canManageWorkspace));
  const routineAssigneeIds = selectedRoutine?.assigneeProfileIds?.length
    ? selectedRoutine.assigneeProfileIds
    : [...new Set(selectedTaskTemplates.map((task) => task.assigneeProfileId).filter((id): id is string => Boolean(id)))];
  const responsibleText = routineAssigneeIds.length
    ? routineAssigneeIds.map((id) => people.find((person) => person.id === id)?.name ?? "Responsável definido").join(", ")
    : "Sem responsável fixo";
  const approvalText = (selectedRoutine?.approvalMode ?? selectedTaskTemplates.find((task) => task.approvalMode)?.approvalMode) === "approval_required" ? "gestor aprova" : "conclui direto";
  const dueText = selectedRoutine?.dueHint ?? selectedTaskTemplates.find((task) => task.dueHint)?.dueHint ?? null;
  const scheduleText = selectedRoutine ? routineScheduleLabel(selectedRoutine) : "Diária";
  const items = records.map((routine, index) => [
    routine.title,
    routine.areaId ? `Área: ${areaLabel(routine.areaId, routineAreaNames)}` : "Empresa inteira",
    statusLabel(routine.status),
    index === safeIndex
  ] satisfies [string, string, string, boolean]);

  return (
    <div className="screen split-page">
      <SideList title="Rotinas" icon={canManage ? "ph-plus" : undefined} items={items} onCreate={canManage ? createRoutine : undefined} onSelect={setSelectedIndex} />
      <section className="panel detail-panel routine-detail">
        {selectedRoutine ? (
          <>
            <header>
              <div>
                <span className="mono faint">Rotina operacional · {selectedAreaName} · {scheduleText}</span>
                <h1 className="serif">{selectedRoutine.title}</h1>
                <p className="detail-meta">Responsáveis: {responsibleText}{dueText ? ` · Limite: ${dueText}` : ""}</p>
                <div className="routine-progress"><PercentBar value={routinePct} /><strong>{routineDone}/{routineCheckRows.length}</strong></div>
              </div>
              {selectedApiRoutine && canManageSelectedRoutine ? (
                <div className="button-row">
                  <button className="secondary-btn" type="button" onClick={() => editRoutine(selectedApiRoutine)}><Icon name="ph-pencil-simple" />Editar</button>
                  {selectedApiRoutine.status !== "archived" ? (
                    <button className="secondary-btn" type="button" disabled={actionBusy} onClick={() => archiveRoutine(selectedApiRoutine)}><Icon name="ph-archive" />Arquivar</button>
                  ) : null}
                  <button className="secondary-btn danger-btn" type="button" disabled={actionBusy} onClick={() => deleteRoutine(selectedApiRoutine)}><Icon name="ph-trash" />Excluir</button>
                </div>
              ) : null}
            </header>
            <div className="check-list">
              {routineCheckRows.length ? routineCheckRows.map((check) => (
                <div key={check.id} className="check-row rowh">
                  <span className="check" aria-hidden="true" />
                  <span>{check.label}</span>
                  {check.dueHint ? <small>Limite: {check.dueHint}</small> : null}
                  {check.evidencePolicy && check.evidencePolicy !== "optional" ? <small>{evidencePolicyLabel(check.evidencePolicy)}</small> : null}
                </div>
              )) : <EmptyState icon="ph-list-checks" title="Checklist ainda vazio" text="Edite a rotina para adicionar tarefas, evidência, responsável e aprovação." />}
            </div>
            <footer className="detail-footer">
              <button className="secondary-btn" type="button" onClick={() => { showNotice("Evidências são anexadas nas tarefas do Hoje."); go("hoje"); }}><Icon name="ph-camera" />Anexar evidência</button>
              <span>Aprovação: <b>{approvalText}</b></span>
            </footer>
          </>
        ) : <EmptyState icon="ph-arrows-clockwise" title="Nenhuma rotina criada" text="Crie uma rotina com checklist para gerar tarefas diárias para a equipe." />}
      </section>
    </div>
  );
}

function TrainingPage({
  canManage,
  canManageWorkspace,
  trainings,
  isLiveWorkspace,
  createTraining,
  editTraining,
  unpublishTraining,
  deleteTraining,
  actionBusy,
  submitQuiz,
  processes,
  areas,
  roleTemplates,
  people
}: {
  canManage: boolean;
  canManageWorkspace: boolean;
  trainings: ApiTraining[];
  isLiveWorkspace: boolean;
  createTraining: () => void;
  editTraining: (training: ApiTraining) => void;
  unpublishTraining: (training: ApiTraining) => void;
  deleteTraining: (training: ApiTraining) => void;
  actionBusy: boolean;
  submitQuiz: (training: ApiTraining, answers: Array<{ questionId: string; optionId: string }>) => void;
  processes: ApiProcess[];
  areas: ApiArea[];
  roleTemplates: ApiRoleTemplate[];
  people: ApiPerson[];
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const fallbackTrainings: ApiTraining[] = [
    { id: "fallback_aprovacao", title: "Padrão de aprovação de peças", status: "published", source: { type: "process", processId: null, title: "Aprovação de peças" }, audience: { type: "all" }, dueDate: null, materials: [{ kind: "lesson", title: "Aula curta", body: "Abra a peça no Baase, revise o checklist de qualidade e envie para aprovação antes do cliente.", url: null }], quizQuestions: [], description: "Como submeter uma peça, marcar o responsável e passar pela aprovação antes de enviar ao cliente." },
    { id: "fallback_tom", title: "Tom de voz da marca", status: "published", source: { type: "material", processId: null, title: "Guia de marca" }, audience: { type: "all" }, dueDate: null, materials: [{ kind: "lesson", title: "Resumo do padrão", body: "Use linguagem direta, evite prometer prazos sem confirmação e registre qualquer exceção operacional.", url: null }], quizQuestions: [], description: "Padrão curto para comunicação da marca." },
    { id: "fallback_board", title: "Uso do board de clientes", status: "draft", source: { type: "manual", processId: null, title: null }, audience: null, dueDate: null, materials: [], quizQuestions: [], description: "Como organizar status, comentários e evidências no board." }
  ];
  const records = trainings.length ? trainings : isLiveWorkspace ? [] : fallbackTrainings;
  const safeIndex = Math.min(selectedIndex, Math.max(records.length - 1, 0));
  const selectedTraining = records[safeIndex] ?? null;
  const selectedApiTraining = selectedTraining && trainings.some((training) => training.id === selectedTraining.id) ? selectedTraining : null;
  const canManageSelectedTraining = canManage && Boolean(selectedTraining && (selectedTraining.audience?.type !== "all" || canManageWorkspace));
  const sourceProcess = selectedTraining?.source?.type === "process" && selectedTraining.source.processId
    ? processes.find((process) => process.id === selectedTraining.source?.processId) ?? null
    : null;
  const items = records.map((training, index) => [
    training.title,
    trainingAudienceLabel(training.audience, areas, roleTemplates, people),
    statusLabel(training.status),
    index === safeIndex
  ] satisfies [string, string, string, boolean]);
  const questions = selectedTraining?.quizQuestions ?? [];
  const answeredCount = questions.filter((question, index) => quizAnswers[question.id ?? `question_${index}`]).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  useEffect(() => {
    setQuizAnswers({});
    setQuizSubmitted(false);
  }, [selectedTraining?.id]);

  function handleQuizSubmit() {
    if (!selectedTraining || !allAnswered) return;
    const answers = questions.map((question, index) => ({
      questionId: question.id ?? `question_${index}`,
      optionId: quizAnswers[question.id ?? `question_${index}`] ?? ""
    }));
    setQuizSubmitted(true);
    if (selectedApiTraining) submitQuiz(selectedApiTraining, answers);
  }

  return (
    <div className="screen split-page">
      <SideList title="Treinamentos" icon={canManage ? "ph-plus" : undefined} items={items} onCreate={canManage ? createTraining : undefined} onSelect={setSelectedIndex} />
      <section className="panel detail-panel training-detail">
        {selectedTraining ? (
          <>
            <header className="training-detail-head">
              <div className="training-title-block">
                <div className="meta-line">
                  <span className="pill">{statusLabel(selectedTraining.status)}</span>
                  <span className="mono">{trainingSourceLabel(selectedTraining)}</span>
                </div>
                <h1 className="serif">{selectedTraining.title}</h1>
                <p>{selectedTraining.description ?? "Treinamento criado para revisão. Adicione aula, material e quiz antes de publicar."}</p>
              </div>
              {selectedApiTraining && canManageSelectedTraining ? (
                <div className="button-row training-actions">
                  <button className="secondary-btn" type="button" onClick={() => editTraining(selectedApiTraining)}><Icon name="ph-pencil-simple" />Editar</button>
                  {selectedApiTraining.status === "published" ? (
                    <button className="secondary-btn" type="button" disabled={actionBusy} onClick={() => unpublishTraining(selectedApiTraining)}><Icon name="ph-eye-slash" />Despublicar</button>
                  ) : null}
                  <button
                    className="secondary-btn danger-btn"
                    type="button"
                    disabled={actionBusy}
                    onClick={() => {
                      if (window.confirm(`Excluir "${selectedApiTraining.title}"?`)) deleteTraining(selectedApiTraining);
                    }}
                  >
                    <Icon name="ph-trash" />Excluir
                  </button>
                </div>
              ) : null}
            </header>
            <div className="training-overview">
              <div>
                <span>Origem</span>
                <strong>{trainingSourceLabel(selectedTraining)}</strong>
                {sourceProcess ? <small>SOP publicado usado como base do treinamento.</small> : <small>{selectedTraining.source?.type === "manual" ? "Criado diretamente no Baase." : "Material de apoio anexado ao treinamento."}</small>}
              </div>
              <div>
                <span>Público</span>
                <strong>{trainingAudienceLabel(selectedTraining.audience, areas, roleTemplates, people)}</strong>
                <small>{selectedTraining.dueDate ? `Prazo: ${selectedTraining.dueDate}` : "Sem prazo definido"}</small>
              </div>
              <div>
                <span>Validação</span>
                <strong>{questions.length ? `${questions.length} pergunta(s)` : "Sem quiz"}</strong>
                <small>{questions.length ? "A equipe precisa acertar para concluir." : "Adicione quiz antes de publicar."}</small>
              </div>
            </div>
            <section className="training-section training-materials">
              <div className="training-section-head">
                <h2>Conteúdo</h2>
                <span>{selectedTraining.materials?.length ?? 0} material(is)</span>
              </div>
              {selectedTraining.materials?.length ? (
                <div className="training-material-grid">
                  {selectedTraining.materials.map((material, index) => (
                    <article className={`training-material-card ${material.kind}`} key={`${material.kind}-${material.title}-${index}`}>
                      <div className="training-material-kind">
                        <Icon name={material.kind === "pdf" ? "ph-file-pdf" : material.kind === "link" ? "ph-link-simple" : "ph-play-circle"} />
                        <span>{material.kind === "lesson" ? "Aula" : material.kind === "pdf" ? "PDF" : "Link"}</span>
                      </div>
                      <h3>{material.title}</h3>
                      {material.body ? <TrainingLessonBody body={material.body} /> : null}
                      {material.url ? <a href={material.url} target="_blank" rel="noreferrer">Abrir material <Icon name="ph-arrow-up-right" /></a> : null}
                    </article>
                  ))}
                </div>
              ) : <EmptyState icon="ph-book-open" title="Nenhum material" text="Adicione uma aula curta, PDF ou link para publicar este treinamento." />}
            </section>
            <section className="quiz training-quiz">
              <h2><span>?</span>Quiz — {questions.length ? `${questions.length} pergunta(s)` : "sem quiz"}</h2>
              {questions.length ? (
                <>
                  {questions.map((question, questionIndex) => {
                    const questionKey = question.id ?? `question_${questionIndex}`;
                    const pickedOptionId = quizAnswers[questionKey];
                    return (
                      <div className="training-question" key={questionKey}>
                        <p>{question.prompt}</p>
                        {question.options.map((option) => {
                          const picked = pickedOptionId === option.id;
                          const correct = option.id === question.correctOptionId;
                          const state = quizSubmitted && correct ? "correct" : quizSubmitted && picked && !correct ? "wrong" : picked ? "picked" : "";
                          return (
                            <button
                              className={`quiz-option ${state}`}
                              type="button"
                              key={option.id}
                              disabled={quizSubmitted}
                              onClick={() => setQuizAnswers((current) => ({ ...current, [questionKey]: option.id }))}
                            >
                              <Icon name={state === "correct" ? "ph-check-circle" : state === "wrong" ? "ph-x-circle" : picked ? "ph-check-circle" : "ph-circle"} />
                              {option.label}
                            </button>
                          );
                        })}
                        {quizSubmitted && question.explanation ? <small>{question.explanation}</small> : null}
                      </div>
                    );
                  })}
                  {quizSubmitted ? (
                    <div className="success-box">
                      <Icon name="ph-check-circle" fill />
                      <div><strong>Respostas enviadas</strong><span>O Baase registrou sua tentativa neste treinamento.</span></div>
                      <button type="button" onClick={() => { setQuizSubmitted(false); setQuizAnswers({}); }}>Refazer</button>
                    </div>
                  ) : null}
                  <div className="quiz-actions">
                    <button className="accent-solid" type="button" disabled={!allAnswered || actionBusy || quizSubmitted} onClick={handleQuizSubmit}>
                      Enviar respostas
                    </button>
                    <span>{answeredCount}/{questions.length} respondida(s)</span>
                  </div>
                </>
              ) : canManage
                ? <EmptyState icon="ph-question" title="Quiz ainda não criado" text="Sem quiz, a pessoa pode concluir o treinamento depois de ler o conteúdo." />
                : <div className="training-complete-without-quiz">
                    <p>Depois de revisar todo o conteúdo, confirme a conclusão deste treinamento.</p>
                    <button className="accent-solid" disabled={actionBusy || quizSubmitted} type="button" onClick={() => {
                      if (!selectedApiTraining) return;
                      setQuizSubmitted(true);
                      submitQuiz(selectedApiTraining, []);
                    }}>Concluir treinamento</button>
                  </div>}
            </section>
          </>
        ) : <EmptyState icon="ph-graduation-cap" title="Nenhum treinamento criado" text="Crie aulas curtas, PDFs e quizzes para alinhar a equipe." />}
      </section>
    </div>
  );
}

function AnnouncementsPage({
  canManage,
  canManageWorkspace,
  announcements,
  isLiveWorkspace,
  areas,
  roleTemplates,
  people,
  currentProfile,
  createAnnouncement,
  confirmAnnouncement,
  deleteAnnouncement,
  actionBusy,
  comRead,
  setComRead,
  selectedAnnouncementId,
  onSelectAnnouncement
}: {
  canManage: boolean;
  canManageWorkspace: boolean;
  announcements: ApiAnnouncement[];
  isLiveWorkspace: boolean;
  areas: ApiArea[];
  roleTemplates: ApiRoleTemplate[];
  people: ApiPerson[];
  currentProfile: { id: string | null; name: string };
  createAnnouncement: () => void;
  confirmAnnouncement: (announcement: ApiAnnouncement, answers?: Array<{ questionId: string; optionId: string }>) => void;
  deleteAnnouncement: (announcement: ApiAnnouncement) => void;
  actionBusy: boolean;
  comRead: boolean;
  setComRead: (read: boolean) => void;
  selectedAnnouncementId: string | null;
  onSelectAnnouncement: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const fallbackAnnouncements = [
    {
      id: "demo_announcement",
      title: "Novo fluxo de aprovação de peças",
      body: "Time, a partir de hoje toda peça passa por aprovação dupla antes de ir ao cliente: primeiro o responsável, depois o gestor da área. Suba a peça no Baase, marque o responsável e aguarde o “ok”. Isso reduz retrabalho e mantém o histórico organizado.",
      type: "process_change",
      status: "published",
      requirement: "quiz_confirmation",
      receipt: { status: comRead ? "confirmed" : "pending" }
    },
    { id: "demo_general", title: "Reunião geral — sexta 16h", body: "Alinhamento geral da equipe.", type: "simple", status: "published", requirement: "none", receipt: { status: "confirmed" } },
    { id: "demo_training", title: "Nova identidade visual v2", body: "Treinamento obrigatório publicado.", type: "mandatory_training", status: "published", requirement: "read_confirmation", receipt: { status: "confirmed" } }
  ] as ApiAnnouncement[];
  const rows = announcements.length ? announcements : isLiveWorkspace ? [] : fallbackAnnouncements;
  const selectedAnnouncementIndex = selectedAnnouncementId ? rows.findIndex((announcement) => announcement.id === selectedAnnouncementId) : -1;
  const safeIndex = selectedAnnouncementIndex >= 0 ? selectedAnnouncementIndex : Math.min(selectedIndex, Math.max(rows.length - 1, 0));
  const selectedAnnouncement = rows[safeIndex] ?? null;
  const selectedApiAnnouncement = selectedAnnouncement && announcements.some((announcement) => announcement.id === selectedAnnouncement.id) ? selectedAnnouncement : null;
  const canManageSelectedAnnouncement = canManage && Boolean(selectedAnnouncement && (selectedAnnouncement.audience?.type !== "all" || canManageWorkspace));
  const isConfirmed = selectedAnnouncement?.receipt?.status === "confirmed" || selectedAnnouncement?.receipt?.status === "quiz_completed";
  const selectedAuthor = selectedAnnouncement ? announcementAuthor(selectedAnnouncement, people, currentProfile) : null;
  const announcementQuestions = selectedAnnouncement?.quizQuestions ?? [];
  const allAnnouncementQuestionsAnswered = announcementQuestions.every((question, index) => Boolean(quizAnswers[question.id ?? `question_${index}`]));

  useEffect(() => {
    setQuizAnswers({});
  }, [selectedAnnouncement?.id]);

  return (
    <div className="screen split-page">
      <SideList title="Comunicados" icon={canManage ? "ph-plus" : undefined} onCreate={canManage ? createAnnouncement : undefined} items={rows.map((announcement, index) => [
        announcement.title,
        announcementTypeLabel(announcement.type),
        announcement.receipt?.status === "pending" ? "Pendente" : announcement.status === "published" ? "Lido" : statusLabel(announcement.status),
        index === safeIndex
      ])} onSelect={(index) => {
        setSelectedIndex(index);
        onSelectAnnouncement();
      }} />
      <section className="panel detail-panel announcement-detail">
        {selectedAnnouncement ? (
          <>
            <header>
              <div>
                <div className="meta-line"><Pill tone="info">{announcementTypeLabel(selectedAnnouncement.type)}</Pill><Pill tone="warn">{announcementRequirementLabel(selectedAnnouncement.requirement)}</Pill></div>
                <h1 className="serif">{selectedAnnouncement.title}</h1>
                <div className="author-line"><span className="avatar">{selectedAuthor?.initials}</span><span>{selectedAuthor?.name} · para <b>{audienceLabel(selectedAnnouncement, areas, roleTemplates, people)}</b></span></div>
              </div>
              {selectedApiAnnouncement && canManageSelectedAnnouncement ? (
                <div className="button-row">
                  <button className="secondary-btn danger-btn" type="button" disabled={actionBusy} onClick={() => deleteAnnouncement(selectedApiAnnouncement)}><Icon name="ph-trash" />Excluir</button>
                </div>
              ) : null}
            </header>
            <article className="message">
              <p>{selectedAnnouncement.body ?? "Comunicado publicado para a equipe."}</p>
              {selectedAnnouncement.relatedProcessId ? <div><Icon name="ph-link-simple" />Relacionado ao processo <b>{selectedAnnouncement.relatedProcessId}</b></div> : null}
            </article>
            <footer className="confirm-box">
              {isConfirmed ? (
                <div className="success-box"><Icon name="ph-check-circle" fill /><div><strong>Leitura confirmada</strong><span>Confirmação registrada para o dono e gestores.</span></div></div>
              ) : (
                <>
                  <div><strong>Confirme que leu e entendeu</strong><span>Uma pergunta rápida garante que a mudança ficou clara.</span></div>
                  {selectedAnnouncement.requirement === "quiz_confirmation" ? (
                    <div className="announcement-quiz">
                      {announcementQuestions.map((question, questionIndex) => {
                        const questionKey = question.id ?? `question_${questionIndex}`;
                        return <fieldset key={questionKey}>
                          <legend>{question.prompt}</legend>
                          {question.options.map((option) => <label key={option.id}>
                            <input
                              checked={quizAnswers[questionKey] === option.id}
                              name={questionKey}
                              onChange={() => setQuizAnswers((current) => ({ ...current, [questionKey]: option.id }))}
                              type="radio"
                              value={option.id}
                            />
                            <span>{option.label}</span>
                          </label>)}
                        </fieldset>;
                      })}
                    </div>
                  ) : null}
                  <button
                    className="accent-solid"
                    disabled={actionBusy || (selectedAnnouncement.requirement === "quiz_confirmation" && (!announcementQuestions.length || !allAnnouncementQuestionsAnswered))}
                    type="button"
                    onClick={() => selectedAnnouncement.id.startsWith("demo_")
                      ? setComRead(true)
                      : confirmAnnouncement(selectedAnnouncement, announcementQuestions.map((question, index) => ({
                        questionId: question.id ?? `question_${index}`,
                        optionId: quizAnswers[question.id ?? `question_${index}`] ?? ""
                      })))}
                  ><Icon name="ph-check" />{selectedAnnouncement.requirement === "quiz_confirmation" ? "Enviar respostas" : "Li e confirmo"}</button>
                </>
              )}
            </footer>
          </>
        ) : <EmptyState icon="ph-megaphone" title="Nenhum comunicado criado" text="Use comunicados para avisos, mudanças de processo e treinamentos obrigatórios." />}
      </section>
    </div>
  );
}

function announcementAuthor(announcement: ApiAnnouncement, people: ApiPerson[], currentProfile: { id: string | null; name: string }) {
  const person = people.find((candidate) => candidate.id === announcement.createdByProfileId);
  const name = person?.name ?? (announcement.createdByProfileId && announcement.createdByProfileId === currentProfile.id ? currentProfile.name : "Autor removido");
  return { name, initials: initialsFromName(name) };
}

function audienceLabel(announcement: ApiAnnouncement, areas: ApiArea[], roleTemplates: ApiRoleTemplate[], people: ApiPerson[]) {
  if (!announcement.audience || announcement.audience.type === "all") return "Empresa inteira";
  if (announcement.audience.type === "area") return `Área: ${areaLabel(announcement.audience.areaId, areaNameMap(areas))}`;
  if (announcement.audience.type === "role") return `Cargo: ${roleLabel(announcement.audience.roleTemplateId, roleTemplates)}`;
  return `Pessoa: ${personLabel(announcement.audience.profileId, people)}`;
}

function announcementTypeLabel(type: ApiAnnouncement["type"]) {
  if (type === "process_change") return "Mudança de processo";
  if (type === "mandatory_training") return "Treinamento obrigatório";
  return "Aviso";
}

function announcementRequirementLabel(requirement: ApiAnnouncement["requirement"]) {
  if (requirement === "quiz_confirmation") return "Confirmação + quiz";
  if (requirement === "read_confirmation") return "Confirmação de leitura";
  return "Informativo";
}

function TemplatesPage({
  templates,
  segmentFilter,
  setSegmentFilter,
  areaFilter,
  setAreaFilter,
  kindFilter,
  setKindFilter,
  useTemplate,
  adaptTemplate
}: {
  templates: BaaseTemplate[];
  segmentFilter: string | TemplateFilterValue;
  setSegmentFilter: (filter: string | TemplateFilterValue) => void;
  areaFilter: string | TemplateFilterValue;
  setAreaFilter: (filter: string | TemplateFilterValue) => void;
  kindFilter: ApiTemplateKind | TemplateFilterValue;
  setKindFilter: (filter: ApiTemplateKind | TemplateFilterValue) => void;
  useTemplate: (template: BaaseTemplate) => void;
  adaptTemplate: (template: BaaseTemplate) => void;
}) {
  const segmentOptions = ["Todos", ...new Set(templates.map((template) => template.segment))];
  const areaOptions = ["Todos", ...new Set(templates.map((template) => template.area))];
  const kindOptions: Array<ApiTemplateKind | TemplateFilterValue> = ["Todos", "process", "routine", "training"];
  const filteredTemplates = templates
    .filter((template) => segmentFilter === "Todos" || template.segment === segmentFilter)
    .filter((template) => areaFilter === "Todos" || template.area === areaFilter)
    .filter((template) => kindFilter === "Todos" || template.kind === kindFilter);

  return (
    <div className="screen">
      <div className="page-head compact"><div><h1 className="serif">Biblioteca de Modelos</h1><p>Comece por um modelo pronto e adapte com a IA para o seu jeito de trabalhar.</p></div></div>
      <div className="filter-stack">
        <div className="filter-row" role="group" aria-label="Filtrar por segmento">
          {segmentOptions.map((filter) => (
            <button className={filter === segmentFilter ? "active" : ""} type="button" key={filter} onClick={() => setSegmentFilter(filter)}>
              {filter === "Todos" ? "Todos segmentos" : segmentLabel(filter)}
            </button>
          ))}
        </div>
        <div className="filter-row" role="group" aria-label="Filtrar por área">
          {areaOptions.map((filter) => (
            <button className={filter === areaFilter ? "active" : ""} type="button" key={filter} onClick={() => setAreaFilter(filter)}>
              {filter === "Todos" ? "Todas áreas" : filter}
            </button>
          ))}
        </div>
        <div className="filter-row" role="group" aria-label="Filtrar por tipo">
          {kindOptions.map((filter) => (
            <button className={filter === kindFilter ? "active" : ""} type="button" key={filter} onClick={() => setKindFilter(filter)}>
              {filter === "Todos" ? "Todos tipos" : templateKindPluralLabel(filter)}
            </button>
          ))}
        </div>
      </div>
      <div className="template-grid">
        {filteredTemplates.map((template) => (
          <article className="template-card lift" key={template.id}>
            <header className="template-card-head"><span><Icon name={template.icon} /></span><Pill tone={templateTone(template.kind)}>{templateKindLabel(template.kind)}</Pill></header>
            <h3>{template.title}</h3>
            <p>{template.description}</p>
            <footer className="template-card-footer">
              <span className="mono">{template.tag} · {template.area}</span>
              <div className="template-actions" role="group" aria-label={`Ações do modelo ${template.title}`}>
                <button type="button" onClick={() => adaptTemplate(template)}>Adaptar com IA</button>
                <button type="button" onClick={() => useTemplate(template)}>Usar modelo</button>
              </div>
            </footer>
          </article>
        ))}
      </div>
      {!filteredTemplates.length ? (
        <div className="template-empty">
          <Icon name="ph-books" />
          <strong>Nenhum modelo encontrado</strong>
          <span>Ajuste os filtros para ver outros modelos da biblioteca.</span>
        </div>
      ) : null}
    </div>
  );
}

function CreateWithAiPage({
  prompt,
  setPrompt,
  promptPlaceholder,
  setPromptPlaceholder,
  mode,
  setMode,
  preset,
  setPreset,
  inputMode,
  attachments,
  audioState,
  toggleRecording,
  attachMaterial,
  removeAttachment,
  generateContent,
  showNotice,
  actionBusy,
  generationState
}: {
  prompt: string;
  setPrompt: (prompt: string) => void;
  promptPlaceholder: string;
  setPromptPlaceholder: (prompt: string) => void;
  mode: CreateAiMode;
  setMode: (mode: CreateAiMode) => void;
  preset: CreateAiPreset;
  setPreset: (preset: CreateAiPreset) => void;
  inputMode: CreateAiInputMode;
  attachments: CreateAiAttachment[];
  audioState: OnboardingAudioState;
  toggleRecording: () => void;
  attachMaterial: (file: File) => void;
  removeAttachment: (name: string) => void;
  generateContent: (prompt: string, mode: CreateAiMode, inputMode: CreateAiInputMode, attachments: CreateAiAttachment[]) => void;
  showNotice: (message: string) => void;
  actionBusy: boolean;
  generationState: AiGenerationState | null;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modes: Array<{ preset: CreateAiPreset; mode: CreateAiMode; icon: string; title: string; desc: string; prompt?: string }> = [
    { preset: "process", mode: "process", icon: "ph-file-text", title: "Criar processo", desc: "Descreva um fluxo e a IA monta as etapas." },
    { preset: "routine", mode: "routine", icon: "ph-arrows-clockwise", title: "Criar rotina", desc: "Rotina recorrente com checklist e prazo.", prompt: "Criar uma rotina diária com checklist, responsável, prazo e evidência" },
    { preset: "training", mode: "training", icon: "ph-graduation-cap", title: "Gerar treinamento", desc: "A partir de um processo ou material.", prompt: "Gerar um treinamento curto com aula, PDF de apoio e quiz" },
    { preset: "announcement", mode: "announcement", icon: "ph-megaphone", title: "Escrever comunicado", desc: "Aviso, mudança ou treinamento obrigatório.", prompt: "Escrever um comunicado claro para a equipe confirmar leitura" },
    { preset: "audio_sop", mode: "process", icon: "ph-microphone", title: "Áudio → SOP", desc: "Transcreve e estrutura um processo.", prompt: "Transformar um áudio do dono em SOP com etapas, responsáveis e evidências" },
    { preset: "pdf_training", mode: "training", icon: "ph-file-pdf", title: "PDF → treinamento", desc: "Transforma um material em aula + quiz.", prompt: "Transformar um PDF em treinamento curto com quiz" }
  ];

  function chooseMode(nextPreset: CreateAiPreset, nextMode: CreateAiMode, nextPrompt?: string) {
    setPreset(nextPreset);
    setMode(nextMode);
    setPromptPlaceholder(nextPrompt ?? aiPlaceholderForMode(nextMode));
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) attachMaterial(file);
    event.currentTarget.value = "";
  }

  const recording = audioState.status === "recording";
  const transcribing = audioState.status === "transcribing";
  const generating = generationState !== null;
  const generationTitle = generationState?.phase === "content" ? "Montando o rascunho" : "Criando com IA";
  const generationIcon = generationState?.phase === "content" ? "ph-stack" : "ph-sparkle";

  return (
    <div className="screen narrow-screen">
      <div className="center-head"><span><Icon name="ph-sparkle" /></span><h1 className="serif">O que você quer criar?</h1><p>Descreva em uma frase. A IA monta o rascunho, nada é publicado sem a sua revisão.</p></div>
      <div className="ai-input">
        <textarea aria-label="Pedido para a IA" value={prompt} placeholder={promptPlaceholder} onChange={(event) => setPrompt(event.target.value)} />
        {recording || transcribing ? (
          <div className={`ai-recorder ${recording ? "recording" : "transcribing"}`} role="status" aria-live="polite" aria-label={recording ? "Gravação em andamento" : "Transcrição em andamento"}>
            <span className="ai-recorder-orb"><Icon name={recording ? "ph-microphone" : "ph-waveform"} fill={recording} /></span>
            <div>
              <strong>{recording ? "Ouvindo sua explicação" : "Organizando o áudio"}</strong>
              <small>{recording ? "Pode falar como se estivesse explicando para um funcionário." : "Estamos transformando sua fala em texto limpo."}</small>
            </div>
            <div className="ai-recorder-bars" aria-hidden="true">
              {["44%", "78%", "36%", "92%", "58%", "84%", "42%", "70%", "50%", "96%", "62%", "74%"].map((height, index) => (
                <span style={{ height }} key={`${height}-${index}`} />
              ))}
            </div>
          </div>
        ) : null}
        {(attachments.length || audioState.status !== "idle") ? (
          <div className="ai-context">
            {audioState.status !== "idle" ? (
              <span className={`ai-chip ai-chip-${audioState.status}`}>
                <Icon name={recording ? "ph-record" : audioState.status === "ready" ? "ph-check-circle" : "ph-waveform"} />
                {audioState.message ?? audioState.status}
              </span>
            ) : null}
            {attachments.map((attachment) => (
              <span className="ai-chip" key={attachment.name}>
                <Icon name={attachment.mimeType.includes("pdf") ? "ph-file-pdf" : "ph-file-text"} />
                {attachment.name}
                <small>{formatFileSize(attachment.size)}</small>
                <button type="button" aria-label={`Remover ${attachment.name}`} onClick={() => removeAttachment(attachment.name)}><Icon name="ph-x" /></button>
              </span>
            ))}
          </div>
        ) : null}
        <footer>
          <div>
            <button
              type="button"
              aria-label={recording ? "Parar gravação no Criar com IA" : "Usar áudio no Criar com IA"}
              disabled={actionBusy && !recording}
              onClick={() => {
                toggleRecording();
              }}
            >
              <Icon name={recording ? "ph-stop-circle" : "ph-microphone"} />
            </button>
            <button
              type="button"
              aria-label="Anexar material ao Criar com IA"
              disabled={actionBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="ph-paperclip" />
            </button>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              aria-label="Arquivo para Criar com IA"
              accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
              onChange={onFileChange}
            />
          </div>
          <button className="accent-solid" type="button" disabled={actionBusy || generating} onClick={() => generateContent(prompt, mode, inputMode, attachments)}>
            {generating ? "Gerando..." : "Gerar rascunho"} <Icon name={generating ? "ph-spinner-gap" : "ph-arrow-right"} />
          </button>
        </footer>
      </div>
      {generationState ? (
        <div className="ai-generation-layer">
          <section className="ai-generation-panel" role="status" aria-live="polite" aria-label="Criação com IA em andamento">
            <div className="ai-generation-visual" aria-hidden="true">
              <span><Icon name={generationIcon} /></span>
              <i />
              <i />
              <i />
            </div>
            <div>
              <small className="mono">{generationState.mode === "process" ? "processo" : generationState.mode === "routine" ? "rotina" : generationState.mode === "training" ? "treinamento" : "comunicado"}</small>
              <h2>{generationTitle}</h2>
              <p>{generationState.message}</p>
            </div>
            <div className="ai-generation-steps" aria-hidden="true">
              <span className="active" />
              <span className={generationState.phase === "content" ? "active" : ""} />
              <span />
            </div>
          </section>
        </div>
      ) : null}
      <div className="mode-grid">
        {modes.map((item) => (
          <button className={`mode-card lift ${preset === item.preset ? "active" : ""}`} type="button" key={item.preset} onClick={() => chooseMode(item.preset, item.mode, item.prompt)}>
            <Icon name={item.icon} />
            <strong>{item.title}</strong>
            <small>{item.desc}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function OnboardingPage({
  obSegment,
  setObSegment,
  obMode,
  setObMode,
  answers,
  setAnswer,
  audioStates,
  toggleRecording,
  generateSuggestion,
  actionBusy,
  go
}: {
  obSegment: string;
  setObSegment: (segment: string) => void;
  obMode: "audio" | "texto";
  setObMode: (mode: "audio" | "texto") => void;
  answers: Record<string, string>;
  setAnswer: (question: string, answer: string) => void;
  audioStates: Record<string, OnboardingAudioState>;
  toggleRecording: (question: string) => void;
  generateSuggestion: () => void;
  actionBusy: boolean;
  go: (screen: Screen) => void;
}) {
  return (
    <div className="screen narrow-screen">
      <div className="stepper"><span>1</span><i /><span>2</span><i /><span>3</span></div>
      <div className="center-head"><small className="mono">Passo 2 de 3</small><h1 className="serif">Conte sobre a sua empresa</h1><p>Responda com naturalidade. A IA transforma isso em áreas, cargos, rotinas e processos, você revisa tudo depois.</p></div>
      <section className="panel padded"><h2>Segmento</h2><div className="chip-grid">{["Agência de marketing", "Restaurante", "Clínica", "Salão de beleza", "Loja / varejo", "E-commerce"].map((segment) => <button className={segment === obSegment ? "active" : ""} type="button" key={segment} onClick={() => setObSegment(segment)}>{segment}</button>)}</div></section>
      <section className="panel padded questions">
        <header><h2>Perguntas</h2><div className="mini-switch"><button type="button" className={obMode === "audio" ? "active" : ""} onClick={() => setObMode("audio")}><Icon name="ph-microphone" />Responder por áudio</button><button type="button" className={obMode === "texto" ? "active" : ""} onClick={() => setObMode("texto")}><Icon name="ph-textbox" />Escrever</button></div></header>
        {onboardingQuestions.map((question) => (
          <QuestionField
            question={question}
            mode={obMode}
            value={answers[question] ?? ""}
            onChange={(answer) => setAnswer(question, answer)}
            audioState={audioStates[question] ?? { status: "idle" }}
            onToggleRecording={() => toggleRecording(question)}
            key={question}
          />
        ))}
        <footer><button className="secondary-btn" type="button" onClick={() => go("painel-dono")}>Voltar</button><button className="accent-solid" type="button" disabled={actionBusy} onClick={generateSuggestion}><Icon name="ph-sparkle" />Gerar estrutura da empresa</button></footer>
      </section>
    </div>
  );
}

function QuestionField({
  question,
  mode,
  value,
  onChange,
  audioState,
  onToggleRecording
}: {
  question: string;
  mode: "audio" | "texto";
  value: string;
  onChange: (value: string) => void;
  audioState: OnboardingAudioState;
  onToggleRecording: () => void;
}) {
  const isRecording = audioState.status === "recording";
  const isTranscribing = audioState.status === "transcribing";
  const buttonLabel = `${isRecording ? "Parar gravação" : "Gravar resposta"}: ${question}`;

  return (
    <div className="question-field">
      <strong>{question}</strong>
      {mode === "audio" ? (
        <>
          <div className={`audio-field ${isRecording ? "recording" : ""}`}>
            <button type="button" aria-label={buttonLabel} disabled={isTranscribing} onClick={onToggleRecording}><Icon name={isRecording ? "ph-stop" : "ph-microphone"} fill /></button>
            <div>{["40%", "70%", "30%", "90%", "55%", "100%", "45%", "75%", "35%", "60%", "85%", "50%", "70%", "30%", "95%", "40%"].map((h, i) => <span style={{ height: h }} key={`${h}-${i}`} />)}</div>
            <small className="mono">{audioState.message ?? (value ? "resposta capturada" : "toque para gravar")}</small>
          </div>
          {value ? <p className="audio-transcript">{value}</p> : null}
          {audioState.status === "error" && audioState.message ? <p className="audio-error">{audioState.message}</p> : null}
        </>
      ) : (
        <textarea aria-label={question} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Escreva sua resposta..." />
      )}
    </div>
  );
}

function ReviewPage({
  go,
  suggestion,
  aiRunId,
  createReviewedCompany,
  actionBusy
}: {
  go: (screen: Screen) => void;
  suggestion: OnboardingSuggestion | null;
  aiRunId: string | null;
  createReviewedCompany: () => void;
  actionBusy: boolean;
}) {
  const reviewAreas = suggestion
    ? suggestion.areas.map((area, index) => {
        const roleNames = suggestion.roles.filter((role) => role.areaName === area.name).map((role) => role.name);
        const peopleNames = suggestion.people.filter((person) => person.areaName === area.name).map((person) => person.name);
        return {
          name: area.name,
          color: ["var(--accent)", "var(--info-ink)", "var(--warn-ink)", "var(--danger-ink)"][index % 4] ?? "var(--accent)",
          description: [...roleNames, ...peopleNames].join(" · ") || area.description || "Área sugerida pela IA."
        };
      })
    : areas.slice(0, 4).map((area) => ({
        name: area.name,
        color: area.color,
        description: area.cargos.join(" · ")
      }));
  const contentItems = suggestion
    ? [
        ...suggestion.processes.map((process) => ({ title: process.title, kind: "Processo", tone: "info" as const })),
        ...suggestion.routines.map((routine) => ({ title: routine.title, kind: "Rotina", tone: "accent" as const })),
        ...suggestion.trainings.map((training) => ({ title: training.title, kind: "Treino", tone: "warn" as const }))
      ]
    : ["Onboarding de cliente novo", "Entrega com revisão interna", "Abertura do dia", "Fechamento de entregas", "Padrão de execução da área", "Como registrar evidências"].map((item, index) => ({
        title: item,
        kind: index > 3 ? "Treino" : index < 2 ? "Processo" : "Rotina",
        tone: index > 3 ? "warn" as const : index < 2 ? "info" as const : "accent" as const
      }));
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, "accepted" | "ignored" | "later">>({});
  const areaAside = `${reviewAreas.length} áreas · ${suggestion?.people.length ?? 4} pessoas`;
  const contentAside = `${contentItems.length} itens`;

  return (
    <div className="screen">
      <div className="center-head"><Pill tone="accent"><Icon name="ph-sparkle" />Sugerido pela IA</Pill><h1 className="serif">Esta é a sua empresa, Marina.</h1><p>Montamos uma estrutura inicial a partir das suas respostas. <b>Nada é publicado sem você aprovar</b>, aceite, edite ou ignore cada item.</p>{aiRunId ? <small className="mono">run {aiRunId}</small> : null}</div>
      <div className="two-col">
        <section className="panel flush"><PanelHeader title="Áreas, cargos e pessoas" aside={areaAside} />{reviewAreas.map((area) => <div className="review-row" key={area.name}><span style={{ background: area.color }} /><div><strong>{area.name}</strong><small>{area.description}</small></div><Icon name="ph-check-circle" fill /></div>)}</section>
        <section className="panel flush">
          <PanelHeader title="Conteúdos sugeridos" aside={contentAside} />
          {contentItems.map((item) => {
            const key = `${item.kind}-${item.title}`;
            const decision = reviewDecisions[key];
            return (
              <div className="review-item" key={key}>
                <Pill tone={decision === "ignored" ? "neutral" : item.tone}>{decision === "accepted" ? "Aceito" : decision === "ignored" ? "Ignorado" : item.kind}</Pill>
                <span className={decision === "ignored" ? "done-text" : ""}>{item.title}</span>
                <button type="button" onClick={() => setReviewDecisions((current) => ({ ...current, [key]: "accepted" }))}>Aceitar</button>
                <button type="button" onClick={() => setReviewDecisions((current) => ({ ...current, [key]: "ignored" }))}>Ignorar</button>
              </div>
            );
          })}
          {suggestion?.gaps.map((gap) => {
            const key = `gap-${gap.title}`;
            const decision = reviewDecisions[key];
            return (
              <div className="review-item" key={gap.title}>
                <Pill tone={decision === "later" ? "neutral" : "warn"}>{decision === "later" ? "Depois" : "Pergunta"}</Pill>
                <span>{gap.suggestedQuestion}</span>
                <button type="button" onClick={() => go("onboarding")}>Responder</button>
                <button type="button" onClick={() => setReviewDecisions((current) => ({ ...current, [key]: "later" }))}>Depois</button>
              </div>
            );
          })}
        </section>
      </div>
      <div className="final-bar"><div><strong>Tudo pronto para começar</strong><span>Você poderá ajustar qualquer coisa depois no Mapa da Empresa.</span></div><button className="secondary-btn" type="button" onClick={() => go("onboarding")}>Editar antes</button><button className="accent-solid" type="button" disabled={actionBusy} onClick={createReviewedCompany}><Icon name="ph-check" />Criar minha empresa</button></div>
    </div>
  );
}

function TaskDetailModal({ task, onClose }: { task: ApiTask; onClose: () => void }) {
  const due = task.dueDate ? formatOperationalDate(task.dueDate) : "Sem prazo";
  const submitted = task.submittedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(task.submittedAt)) : null;
  const reviewed = task.reviewedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(task.reviewedAt)) : null;

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Detalhes da tarefa">
        <div className="modal-form execution-form">
          <ModalHeader title="Detalhes da tarefa" icon="ph-list-checks" onClose={onClose} />
          <div className="execution-summary">
            <Pill tone={task.status === "awaiting_approval" ? "warn" : task.status === "completed" ? "accent" : "neutral"}>{statusLabel(task.status)}</Pill>
            <h2>{task.title}</h2>
            <p>Vencimento: {due}{task.dueHint ? ` · ${task.dueHint}` : ""}</p>
          </div>
          {task.checklistItems?.length ? <section className="execution-checklist"><strong>Checklist</strong><div className="execution-checks">{task.checklistItems.map((item, index) => <span className={item.done ? "done" : ""} key={`${item.title}-${index}`}><Icon name={item.done ? "ph-check" : "ph-circle"} />{item.title}</span>)}</div></section> : null}
          {task.evidence?.comment ? <section className="execution-checklist"><strong>Comentário da execução</strong><p>{task.evidence.comment}</p></section> : null}
          {task.reviewComment ? <div className="return-note"><Icon name="ph-arrow-u-down-left" />{task.reviewComment}</div> : null}
          <div className="detail-meta"><span>Enviada: {submitted ?? "Ainda não enviada"}</span>{reviewed ? <span>Revisada: {reviewed}</span> : null}</div>
          <footer><button className="secondary-btn" type="button" onClick={onClose}>Fechar</button></footer>
        </div>
      </div>
    </div>
  );
}

function ExecutionModal({
  task,
  actionBusy,
  onClose,
  onSubmit,
  canEdit,
  onEdit,
  canDelete,
  onDelete,
  onChecklistChange
}: {
  task: TodayTaskRow;
  actionBusy: boolean;
  onClose: () => void;
  onSubmit: (task: TodayTaskRow, evidence: { comment?: string | null; file?: File | null }) => Promise<void>;
  canEdit?: boolean;
  onEdit?: (task: TodayTaskRow) => void;
  canDelete?: boolean;
  onDelete?: (task: TodayTaskRow) => void;
  onChecklistChange?: (task: TodayTaskRow, checklistItems: NonNullable<ApiTask["checklistItems"]>) => void;
}) {
  const [comment, setComment] = useState(task.reviewComment ? `Ajuste solicitado: ${task.reviewComment}\n` : "");
  const [file, setFile] = useState<File | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [checklistExpanded, setChecklistExpanded] = useState(true);
  const [checklistItems, setChecklistItems] = useState(task.checklistItems ?? []);
  const requiresApproval = task.approvalMode === "approval_required";
  const needsComment = task.evidencePolicy === "comment_required" || task.evidencePolicy === "photo_or_comment_required";
  const checklistDone = checklistItems.filter((item) => item.done).length;
  const checklistTotal = checklistItems.length;

  useEffect(() => {
    setChecklistItems(task.checklistItems ?? []);
  }, [task.checklistItems]);

  function toggleChecklistItem(index: number) {
    const nextItems = checklistItems.map((item, itemIndex) => itemIndex === index ? { ...item, done: !item.done } : item);
    setChecklistItems(nextItems);
    onChecklistChange?.(task, nextItems);
  }

  async function submit() {
    setSubmissionError(null);
    try {
      await onSubmit(task, { comment, file });
    } catch {
      setSubmissionError("Não foi possível enviar a evidência. Confira o arquivo e tente novamente.");
    }
  }

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true">
        <form className="modal-form execution-form" onSubmit={(event) => event.preventDefault()}>
          <ModalHeader title="Executar tarefa" icon="ph-list-checks" onClose={onClose} />
          <div className="execution-summary">
            <Pill tone={requiresApproval ? "warn" : "accent"}>{requiresApproval ? "Pede aprovação" : "Conclui direto"}</Pill>
            <h2>{task.label}</h2>
            <p>{task.meta}</p>
            {task.reviewComment ? <div className="return-note"><Icon name="ph-arrow-u-down-left" />{task.reviewComment}</div> : null}
          </div>
          {checklistTotal ? (
            <section className="execution-checklist">
              <button className="checklist-toggle" type="button" aria-expanded={checklistExpanded} onClick={() => setChecklistExpanded((current) => !current)}>
                <span><Icon name={checklistExpanded ? "ph-caret-down" : "ph-caret-right"} />Checklist</span>
                <strong>{checklistDone}/{checklistTotal} concluído</strong>
              </button>
              {checklistExpanded ? (
                <div className="execution-checks">
                  {checklistItems.map((item, index) => (
                    <label className={item.done ? "done" : ""} key={`${item.title}-${index}`}>
                      <input type="checkbox" checked={item.done} onChange={() => toggleChecklistItem(index)} />
                      <span>{item.title}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
          <label>Comentário<textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={needsComment ? "Descreva o que foi feito..." : "Opcional"} /></label>
          <label>Anexo<input aria-label="Anexar evidência" type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          <label>Usar câmera<input aria-label="Usar câmera" type="file" accept="image/*" capture="environment" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          {file ? <small className="attachment-name">Arquivo selecionado: {file.name}</small> : null}
          {submissionError ? <p role="alert" className="form-error">{submissionError}</p> : null}
          <footer>
            {canEdit ? <button className="secondary-btn" type="button" disabled={actionBusy} onClick={() => onEdit?.(task)}><Icon name="ph-pencil-simple" />Editar tarefa</button> : null}
            {canDelete ? <button className="secondary-btn danger-btn" type="button" disabled={actionBusy} onClick={() => onDelete?.(task)}><Icon name="ph-trash" />Excluir tarefa</button> : null}
            <button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button>
            <button className="accent-solid" type="button" disabled={actionBusy} onClick={() => void submit()}>
              {actionBusy ? "Enviando..." : requiresApproval ? "Enviar para aprovação" : "Concluir tarefa"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function ReturnTaskModal({
  task,
  actionBusy,
  onClose,
  onSubmit
}: {
  task: ApiTask;
  actionBusy: boolean;
  onClose: () => void;
  onSubmit: (task: ApiTask, comment: string) => void;
}) {
  const [comment, setComment] = useState("Ajuste a evidência e envie novamente.");

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true">
        <form className="modal-form" onSubmit={(event) => event.preventDefault()}>
          <ModalHeader title="Devolver tarefa" icon="ph-arrow-u-down-left" onClose={onClose} />
          <div className="execution-summary">
            <Pill tone="warn">Ajuste necessário</Pill>
            <h2>{task.title}</h2>
            <p>{task.evidence?.comment ?? "Sem comentário enviado."}</p>
          </div>
          <label>Comentário da devolução<textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label>
          <footer><button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button><button className="accent-solid" type="button" disabled={actionBusy} onClick={() => onSubmit(task, comment)}>Confirmar devolução</button></footer>
        </form>
      </div>
    </div>
  );
}

function CrudModalView({
  modal,
  canAssignManagementRoles,
  canManageWorkspace,
  actionBusy,
  onClose,
  onSaveTask,
  onSaveArea,
  onSaveRoleTemplate,
  onSavePerson,
  onDeletePerson,
  onSaveProcess,
  onSaveRoutine,
  onSaveTraining,
  onSaveAnnouncement,
  onCreateInvite,
  areas,
  roleTemplates,
  people,
  processes,
  currentProfileId,
  currentProfileName
}: {
  modal: CrudModal;
  canAssignManagementRoles: boolean;
  canManageWorkspace: boolean;
  actionBusy: boolean;
  onClose: () => void;
  onSaveTask: (input: TaskFormInput) => void;
  onSaveArea: (input: { id?: string; name: string; description: string }) => void;
  onSaveRoleTemplate: (input: { areaId: string; name: string; description: string }) => void;
  onSavePerson: (input: { id?: string; name: string; email: string; role: ApiPerson["role"]; areaId?: string | null; areaAccessIds?: string[]; roleTemplateId?: string | null; accessScope?: "workspace" | "area" | "assigned_only"; status?: string }) => void;
  onDeletePerson: (person: ApiPerson) => void;
  onSaveProcess: (input: {
    id?: string; title: string; summary: string; body: string; publish: boolean; areaId?: string | null;
    owner?: ApiProcess["owner"] | null; changeNote: string; links: Array<{ title: string; url: string }>; files: File[];
  }) => void;
  onSaveRoutine: (input: RoutineFormInput) => void;
  onSaveTraining: (input: TrainingFormInput) => void;
  onSaveAnnouncement: (input: AnnouncementFormInput) => void;
  onCreateInvite: (input: { name: string; email: string; role: "owner" | "manager" | "employee"; areaId: string; areaAccessIds: string[]; roleTemplateId: string; accessScope: "workspace" | "area" | "assigned_only" }) => void;
  areas: ApiArea[];
  roleTemplates: ApiRoleTemplate[];
  people: ApiPerson[];
  processes: ApiProcess[];
  currentProfileId: string | null;
  currentProfileName: string;
}) {
  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true">
        {modal.kind === "task" ? (
          <TaskForm modal={modal} canTargetWorkspace={canManageWorkspace} areas={areas} people={people} currentProfileId={currentProfileId} currentProfileName={currentProfileName} actionBusy={actionBusy} onClose={onClose} onSubmit={onSaveTask} />
        ) : null}
        {modal.kind === "area" ? (
          <AreaForm modal={modal} actionBusy={actionBusy} onClose={onClose} onSubmit={onSaveArea} />
        ) : null}
        {modal.kind === "role" ? (
          <RoleTemplateForm areas={areas} actionBusy={actionBusy} onClose={onClose} onSubmit={onSaveRoleTemplate} />
        ) : null}
        {modal.kind === "person" ? (
          <PersonForm modal={modal} canAssignManagementRoles={canAssignManagementRoles} areas={areas} roleTemplates={roleTemplates} actionBusy={actionBusy} onClose={onClose} onSubmit={onSavePerson} onDelete={onDeletePerson} />
        ) : null}
        {modal.kind === "process" ? (
          <ProcessForm modal={modal} canTargetWorkspace={canManageWorkspace} areas={areas} roleTemplates={roleTemplates} people={people} actionBusy={actionBusy} onClose={onClose} onSubmit={onSaveProcess} />
        ) : null}
        {modal.kind === "routine" ? (
          <RoutineForm modal={modal} canTargetWorkspace={canManageWorkspace} areas={areas} people={people} actionBusy={actionBusy} onClose={onClose} onSubmit={onSaveRoutine} />
        ) : null}
        {modal.kind === "training" ? (
          <TrainingForm modal={modal} canTargetWorkspace={canManageWorkspace} actionBusy={actionBusy} onClose={onClose} onSubmit={onSaveTraining} areas={areas} roleTemplates={roleTemplates} people={people} processes={processes} />
        ) : null}
        {modal.kind === "announcement" ? (
          <AnnouncementForm canTargetWorkspace={canManageWorkspace} actionBusy={actionBusy} onClose={onClose} onSubmit={onSaveAnnouncement} areas={areas} roleTemplates={roleTemplates} people={people} />
        ) : null}
        {modal.kind === "invite" ? (
          <InviteForm canAssignManagementRoles={canAssignManagementRoles} canTargetWorkspace={canManageWorkspace} areas={areas} roleTemplates={roleTemplates} actionBusy={actionBusy} onClose={onClose} onSubmit={onCreateInvite} />
        ) : null}
      </div>
    </div>
  );
}

function TaskForm({
  modal,
  canTargetWorkspace,
  areas,
  people,
  currentProfileId,
  currentProfileName,
  actionBusy,
  onClose,
  onSubmit
}: {
  modal: Extract<CrudModal, { kind: "task" }>;
  canTargetWorkspace: boolean;
  areas: ApiArea[];
  people: ApiPerson[];
  currentProfileId: string | null;
  currentProfileName: string;
  actionBusy: boolean;
  onClose: () => void;
  onSubmit: (input: TaskFormInput) => void;
}) {
  const task = modal.mode === "edit" ? modal.task : null;
  const currentProfileOption = currentProfileId && !people.some((person) => person.id === currentProfileId)
    ? [{ id: currentProfileId, name: currentProfileName, role: "manager" as const, areaId: null, status: "active" }]
    : [];
  const selectablePeople = [...currentProfileOption, ...people];
  const [title, setTitle] = useState(task?.title ?? "");
  const [areaId, setAreaId] = useState(task?.areaId ?? areas[0]?.id ?? "");
  const [assigneeProfileId, setAssigneeProfileId] = useState(task?.assigneeProfileId ?? selectablePeople[0]?.id ?? currentProfileId ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? currentOperationalDate());
  const [dueHint, setDueHint] = useState(task?.dueHint ?? "Até 17:00");
  const [evidencePolicy, setEvidencePolicy] = useState<ApiRoutineTaskTemplate["evidencePolicy"]>(evidencePolicyFrom(task?.evidencePolicy));
  const [approvalMode, setApprovalMode] = useState<ApiRoutineTaskTemplate["approvalMode"]>(approvalModeFrom(task?.approvalMode));
  const [checklistItems, setChecklistItems] = useState(task?.checklistItems?.length ? task.checklistItems.map((item) => item.title) : [""]);
  const peopleForArea = selectablePeople.filter((person) => !areaId || person.areaId === areaId || person.id === currentProfileId);
  const responsibleOptions = peopleForArea.length ? peopleForArea : selectablePeople;
  const validChecklistItems = checklistItems.map((item) => item.trim()).filter(Boolean);

  function updateArea(nextAreaId: string) {
    setAreaId(nextAreaId);
    const nextAreaPeople = selectablePeople.filter((person) => !nextAreaId || person.areaId === nextAreaId || person.id === currentProfileId);
    if (nextAreaPeople.length && !nextAreaPeople.some((person) => person.id === assigneeProfileId)) {
      setAssigneeProfileId(nextAreaPeople[0]?.id ?? "");
    }
  }

  function updateChecklistItem(index: number, value: string) {
    setChecklistItems((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  function addChecklistItem() {
    setChecklistItems((current) => [...current, ""]);
  }

  function removeChecklistItem(index: number) {
    setChecklistItems((current) => current.length > 1 ? current.filter((_, itemIndex) => itemIndex !== index) : [""]);
  }

  function save() {
    onSubmit({
      id: task?.id,
      title,
      areaId: areaId || null,
      assigneeProfileId: assigneeProfileId || null,
      dueDate,
      dueHint: dueHint.trim() || null,
      evidencePolicy,
      approvalMode,
      checklistItems: validChecklistItems
    });
  }

  return (
    <form className="modal-form routine-form task-form" onSubmit={(event) => event.preventDefault()}>
      <ModalHeader title={task ? "Editar tarefa" : "Nova tarefa"} icon="ph-list-checks" onClose={onClose} />
      <div className="routine-core">
        <label>Título da tarefa<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Confirmar agenda do cliente" /></label>
        <label>Área<select value={areaId} onChange={(event) => updateArea(event.target.value)}>{canTargetWorkspace ? <option value="">Empresa inteira</option> : null}{areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label>
      </div>
      <div className="routine-schedule">
        <label>Responsável<select value={assigneeProfileId} onChange={(event) => setAssigneeProfileId(event.target.value)}><option value="">Sem responsável fixo</option>{responsibleOptions.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
        <label>Data<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
        <label>Prazo<input value={dueHint} onChange={(event) => setDueHint(event.target.value)} placeholder="Até 17:00" /></label>
      </div>
      <div className="form-grid">
        <label>Evidência<select value={evidencePolicy} onChange={(event) => setEvidencePolicy(event.target.value as ApiRoutineTaskTemplate["evidencePolicy"])}><option value="optional">Opcional</option><option value="photo_required">Foto obrigatória</option><option value="comment_required">Comentário obrigatório</option><option value="photo_or_comment_required">Foto ou comentário</option></select></label>
        <label>Aprovação<select value={approvalMode} onChange={(event) => setApprovalMode(event.target.value as ApiRoutineTaskTemplate["approvalMode"])}><option value="direct">Conclui direto</option><option value="approval_required">Gestor aprova</option></select></label>
      </div>
      <fieldset className="checklist-builder">
        <legend>Checklist</legend>
        {checklistItems.map((item, index) => (
          <div className="checklist-edit-row" key={index}>
            <span>{index + 1}</span>
            <input aria-label={`Checklist item ${index + 1}`} value={item} onChange={(event) => updateChecklistItem(index, event.target.value)} placeholder="Descreva um passo opcional" />
            <button className="icon-btn" type="button" aria-label={`Remover item ${index + 1}`} onClick={() => removeChecklistItem(index)}><Icon name="ph-trash" /></button>
          </div>
        ))}
        <button className="secondary-btn compact-btn" type="button" onClick={addChecklistItem}><Icon name="ph-plus" />Adicionar item</button>
      </fieldset>
      <footer><button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button><button className="accent-solid" type="button" disabled={actionBusy || !title.trim() || !dueDate} onClick={save}>Salvar tarefa</button></footer>
    </form>
  );
}

function AreaForm({
  modal,
  actionBusy,
  onClose,
  onSubmit
}: {
  modal: Extract<CrudModal, { kind: "area" }>;
  actionBusy: boolean;
  onClose: () => void;
  onSubmit: (input: { id?: string; name: string; description: string }) => void;
}) {
  const isEditing = modal.mode === "edit";
  const [name, setName] = useState(isEditing ? modal.area.name : "Nova área");
  const [description, setDescription] = useState(isEditing ? modal.area.description ?? "" : "Responsabilidades, cargos e rotinas da área.");
  const submitLabel = isEditing ? "Salvar área" : "Criar área";

  return (
    <form className="modal-form" onSubmit={(event) => event.preventDefault()}>
      <ModalHeader title={isEditing ? "Renomear área" : "Nova área"} icon="ph-tree-structure" onClose={onClose} />
      <label>Nome da área<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <footer>
        <button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button>
        <button
          className="accent-solid"
          type="button"
          disabled={actionBusy}
          onClick={() => onSubmit({ id: isEditing ? modal.area.id : undefined, name, description })}
        >
          {submitLabel}
        </button>
      </footer>
    </form>
  );
}

function RoleTemplateForm({
  areas,
  actionBusy,
  onClose,
  onSubmit
}: {
  areas: ApiArea[];
  actionBusy: boolean;
  onClose: () => void;
  onSubmit: (input: { areaId: string; name: string; description: string }) => void;
}) {
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [name, setName] = useState("Novo cargo");
  const [description, setDescription] = useState("Responsabilidades principais do cargo.");

  return (
    <form className="modal-form" onSubmit={(event) => event.preventDefault()}>
      <ModalHeader title="Novo cargo" icon="ph-identification-card" onClose={onClose} />
      <label>Área<select value={areaId} onChange={(event) => setAreaId(event.target.value)}>{areas.length ? areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>) : <option value="">Crie uma área primeiro</option>}</select></label>
      <label>Nome do cargo<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Descrição do cargo<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <footer>
        <button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button>
        <button className="accent-solid" type="button" disabled={actionBusy || !areaId} onClick={() => onSubmit({ areaId, name, description })}>Criar cargo</button>
      </footer>
    </form>
  );
}

function AccessReachFields({
  reach,
  onReachChange,
  primaryAreaId,
  areas,
  areaAccessIds,
  onToggleArea,
  owner,
  allowWorkspace = true
}: {
  reach: AccessReach;
  onReachChange: (reach: AccessReach) => void;
  primaryAreaId: string;
  areas: ApiArea[];
  areaAccessIds: string[];
  onToggleArea: (areaId: string) => void;
  owner?: boolean;
  allowWorkspace?: boolean;
}) {
  const selectedAreaIds = [...new Set([primaryAreaId, ...areaAccessIds].filter(Boolean))];
  const effectiveReach = owner ? "workspace" : reach;

  return (
    <section className="access-reach-section" aria-label="Configuração de acesso">
      <label>Alcance de acesso
        <select aria-label="Alcance de acesso" value={effectiveReach} disabled={owner} onChange={(event) => onReachChange(event.target.value as AccessReach)}>
          <option value="assigned_only">Somente tarefas atribuídas</option>
          <option value="primary_area">Área principal</option>
          <option value="specific_areas">Áreas específicas</option>
          {allowWorkspace ? <option value="workspace">Empresa inteira</option> : null}
        </select>
      </label>
      <p className="form-summary">{owner ? "Donos têm acesso à empresa inteira." : accessReachSummary(effectiveReach, primaryAreaId, areas)}</p>
      {effectiveReach === "specific_areas" ? (
        <fieldset className="access-area-fieldset">
          <legend>Áreas específicas</legend>
          <p>A área principal permanece incluída e não pode ser removida.</p>
          <div className="access-area-list">
            {areas.map((area) => {
              const isPrimary = area.id === primaryAreaId;
              return (
                <label className={`access-area-option${selectedAreaIds.includes(area.id) ? " selected" : ""}`} key={area.id}>
                  <input aria-label={area.name} type="checkbox" checked={selectedAreaIds.includes(area.id)} disabled={isPrimary} onChange={() => onToggleArea(area.id)} />
                  <span>{area.name}</span>
                  {isPrimary ? <small>Principal</small> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}

function PersonForm({
  modal,
  canAssignManagementRoles,
  areas,
  roleTemplates,
  actionBusy,
  onClose,
  onSubmit,
  onDelete
}: {
  modal: Extract<CrudModal, { kind: "person" }>;
  canAssignManagementRoles: boolean;
  areas: ApiArea[];
  roleTemplates: ApiRoleTemplate[];
  actionBusy: boolean;
  onClose: () => void;
  onSubmit: (input: { id?: string; name: string; email: string; role: ApiPerson["role"]; areaId?: string | null; areaAccessIds?: string[]; roleTemplateId?: string | null; accessScope?: "workspace" | "area" | "assigned_only"; status?: string }) => void;
  onDelete: (person: ApiPerson) => void;
}) {
  const person = modal.mode === "edit" ? modal.person : null;
  const [name, setName] = useState(person?.name ?? "Nova pessoa");
  const [email, setEmail] = useState(person?.email ?? "nova@empresa.com");
  const [role, setRole] = useState<ApiPerson["role"]>(person?.role ?? "employee");
  const [areaId, setAreaId] = useState(person?.areaId ?? areas[0]?.id ?? "");
  const [areaAccessIds, setAreaAccessIds] = useState<string[]>(person?.areaAccessIds ?? (areaId ? [areaId] : []));
  const [accessReach, setAccessReach] = useState<AccessReach>(() => accessReachFromStored(person?.accessScope, person?.areaId, person?.areaAccessIds));
  const [roleTemplateId, setRoleTemplateId] = useState(person?.roleTemplateId ?? roleTemplates[0]?.id ?? "");
  const availableRoles = roleTemplates.filter((roleTemplate) => !areaId || roleTemplate.areaId === areaId);
  const selectedRoleTemplateId = availableRoles.some((roleTemplate) => roleTemplate.id === roleTemplateId)
    ? roleTemplateId
    : availableRoles[0]?.id ?? "";

  function save() {
    const access = accessPayloadForReach(role === "owner" ? "workspace" : accessReach, areaId, areaAccessIds);
    onSubmit({
      id: person?.id,
      name,
      email,
      role,
      areaId: areaId || null,
      areaAccessIds: access.areaAccessIds,
      roleTemplateId: selectedRoleTemplateId || null,
      accessScope: access.accessScope,
      status: person?.status === "inactive" ? "inactive" : "active"
    });
  }

  return (
    <form className="modal-form" onSubmit={(event) => event.preventDefault()}>
      <ModalHeader title={person ? "Editar pessoa" : "Nova pessoa"} icon="ph-user-plus" onClose={onClose} />
      <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <div className="form-grid">
        <label>Papel<select value={role} onChange={(event) => { const nextRole = event.target.value as ApiPerson["role"]; setRole(nextRole); if (nextRole === "owner") setAccessReach("workspace"); }}><option value="employee">Funcionário</option>{canAssignManagementRoles ? <><option value="manager">Gestor</option><option value="owner">Dono</option></> : null}</select></label>
        <label>Área principal<select value={areaId} onChange={(event) => { const nextAreaId = event.target.value; setAreaId(nextAreaId); setAreaAccessIds((current) => nextAreaId && !current.includes(nextAreaId) ? [...current, nextAreaId] : current); setRoleTemplateId(""); }}>{canAssignManagementRoles ? <option value="">Empresa inteira</option> : null}{areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label>
      </div>
      <label>Cargo<select value={selectedRoleTemplateId} onChange={(event) => setRoleTemplateId(event.target.value)}><option value="">Sem cargo definido</option>{availableRoles.map((roleTemplate) => <option value={roleTemplate.id} key={roleTemplate.id}>{roleTemplate.name}</option>)}</select></label>
      <AccessReachFields
        reach={accessReach}
        onReachChange={setAccessReach}
        primaryAreaId={areaId}
        areas={areas}
        areaAccessIds={areaAccessIds}
        onToggleArea={(selectedAreaId) => setAreaAccessIds((current) => current.includes(selectedAreaId) ? current.filter((id) => id !== selectedAreaId) : [...current, selectedAreaId])}
        owner={role === "owner"}
        allowWorkspace={canAssignManagementRoles}
      />
      <footer>
        {person ? <button className="secondary-btn danger-btn" type="button" disabled={actionBusy} onClick={() => onDelete(person)}><Icon name="ph-trash" />Excluir pessoa</button> : null}
        <button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button>
        <button className="accent-solid" type="button" disabled={actionBusy} onClick={save}>{person ? "Salvar pessoa" : "Criar pessoa"}</button>
      </footer>
    </form>
  );
}

function AnnouncementForm({
  canTargetWorkspace,
  actionBusy,
  onClose,
  onSubmit,
  areas,
  roleTemplates,
  people
}: {
  canTargetWorkspace: boolean;
  actionBusy: boolean;
  onClose: () => void;
  onSubmit: (input: AnnouncementFormInput) => void;
  areas: ApiArea[];
  roleTemplates: ApiRoleTemplate[];
  people: ApiPerson[];
}) {
  const [title, setTitle] = useState("Novo comunicado");
  const [body, setBody] = useState("Descreva a mudança operacional para a equipe.");
  const [type, setType] = useState<ApiAnnouncement["type"]>("simple");
  const [requirement, setRequirement] = useState<ApiAnnouncement["requirement"]>("read_confirmation");
  const [audienceType, setAudienceType] = useState<NonNullable<ApiAnnouncement["audience"]>["type"]>(canTargetWorkspace ? "all" : "area");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [roleTemplateId, setRoleTemplateId] = useState(roleTemplates[0]?.id ?? "");
  const [profileId, setProfileId] = useState(people[0]?.id ?? "");
  const [quizQuestion, setQuizQuestion] = useState<ApiQuizQuestionInput>({
    prompt: "Qual é o comportamento esperado a partir deste comunicado?",
    options: [
      { id: "a", label: "Seguir a orientação comunicada no Baase" },
      { id: "b", label: "Continuar como antes" }
    ],
    correctOptionId: "a",
    explanation: "A orientação publicada no Baase passa a ser a referência operacional."
  });
  const audience = audienceType === "area" && areaId
    ? { type: "area" as const, areaId }
    : audienceType === "role" && roleTemplateId
      ? { type: "role" as const, roleTemplateId }
      : audienceType === "person" && profileId
        ? { type: "person" as const, profileId }
        : audienceType === "all" ? { type: "all" as const } : null;

  return (
    <form className="modal-form" onSubmit={(event) => event.preventDefault()}>
      <ModalHeader title="Novo comunicado" icon="ph-megaphone" onClose={onClose} />
      <label>Título<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Mensagem<textarea value={body} onChange={(event) => setBody(event.target.value)} /></label>
      <div className="form-grid">
        <label>Tipo<select value={type} onChange={(event) => setType(event.target.value as ApiAnnouncement["type"])}><option value="simple">Aviso</option><option value="process_change">Mudança de processo</option><option value="mandatory_training">Treinamento obrigatório</option></select></label>
        <label>Confirmação<select value={requirement} onChange={(event) => setRequirement(event.target.value as ApiAnnouncement["requirement"])}><option value="none">Informativo</option><option value="read_confirmation">Confirmar leitura</option><option value="quiz_confirmation">Confirmação + quiz</option></select></label>
      </div>
      <section className="responsible-picker training-audience-picker" aria-label="Público do comunicado">
        <div className="field-row"><strong>Público</strong><span className="muted-inline">Escolha quem deve receber este comunicado</span></div>
        <div className="training-audience-grid">
          <label>Público<select value={audienceType} onChange={(event) => setAudienceType(event.target.value as NonNullable<ApiAnnouncement["audience"]>["type"])}>{canTargetWorkspace ? <option value="all">Empresa inteira</option> : null}<option value="area">Área</option><option value="role">Cargo</option><option value="person">Pessoa</option></select></label>
          {audienceType === "area" ? <label>Área<select value={areaId} onChange={(event) => setAreaId(event.target.value)}><option value="">Selecionar área</option>{areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label> : null}
          {audienceType === "role" ? <label>Cargo<select value={roleTemplateId} onChange={(event) => setRoleTemplateId(event.target.value)}><option value="">Selecionar cargo</option>{roleTemplates.map((roleTemplate) => <option value={roleTemplate.id} key={roleTemplate.id}>{roleTemplate.name}</option>)}</select></label> : null}
          {audienceType === "person" ? <label>Pessoa<select value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">Selecionar pessoa</option>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : null}
        </div>
      </section>
      {requirement === "quiz_confirmation" ? <fieldset className="training-builder-block">
        <legend>Pergunta de confirmação</legend>
        <input aria-label="Pergunta do comunicado" value={quizQuestion.prompt} onChange={(event) => setQuizQuestion((current) => ({ ...current, prompt: event.target.value }))} />
        {quizQuestion.options.map((option) => <label className="quiz-option-edit" key={option.id}>
          <input type="radio" checked={quizQuestion.correctOptionId === option.id} onChange={() => setQuizQuestion((current) => ({ ...current, correctOptionId: option.id }))} />
          <span>{option.id.toUpperCase()}</span>
          <input aria-label={`Alternativa ${option.id.toUpperCase()} do comunicado`} value={option.label} onChange={(event) => setQuizQuestion((current) => ({ ...current, options: current.options.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item) }))} />
        </label>)}
        <input aria-label="Explicação da resposta" value={quizQuestion.explanation ?? ""} onChange={(event) => setQuizQuestion((current) => ({ ...current, explanation: event.target.value }))} placeholder="Explique por que esta é a resposta correta" />
      </fieldset> : null}
      <footer>
        <button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button>
        <button className="secondary-btn" type="button" disabled={actionBusy || !audience || (requirement === "quiz_confirmation" && (!quizQuestion.prompt.trim() || quizQuestion.options.some((option) => !option.label.trim())))} onClick={() => audience && onSubmit({ title, body, type, requirement, audience, quizQuestions: requirement === "quiz_confirmation" ? [quizQuestion] : [], publish: false })}>Salvar rascunho</button>
        <button className="accent-solid" type="button" disabled={actionBusy || !audience || (requirement === "quiz_confirmation" && (!quizQuestion.prompt.trim() || quizQuestion.options.some((option) => !option.label.trim())))} onClick={() => audience && onSubmit({ title, body, type, requirement, audience, quizQuestions: requirement === "quiz_confirmation" ? [quizQuestion] : [], publish: true })}>Salvar e publicar</button>
      </footer>
    </form>
  );
}

function ProcessForm({
  modal,
  canTargetWorkspace,
  areas,
  roleTemplates,
  people,
  actionBusy,
  onClose,
  onSubmit
}: {
  modal: Extract<CrudModal, { kind: "process" }>;
  canTargetWorkspace: boolean;
  areas: ApiArea[];
  roleTemplates: ApiRoleTemplate[];
  people: ApiPerson[];
  actionBusy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    id?: string; title: string; summary: string; body: string; publish: boolean; areaId?: string | null;
    owner?: ApiProcess["owner"] | null; changeNote: string; links: Array<{ title: string; url: string }>; files: File[];
  }) => void;
}) {
  const process = modal.mode === "edit" ? modal.process : null;
  const [title, setTitle] = useState(process?.title ?? "");
  const [summary, setSummary] = useState(process?.summary ?? "");
  const [body, setBody] = useState(process?.currentVersion?.body ?? defaultProcessSopBody("Novo processo"));
  const [areaId, setAreaId] = useState(process?.areaId ?? areas[0]?.id ?? "");
  const [ownerMode, setOwnerMode] = useState<"none" | "person" | "role">(process?.owner?.type ?? "none");
  const [ownerId, setOwnerId] = useState(process?.owner?.type === "person" ? process.owner.personId : process?.owner?.type === "role" ? process.owner.roleTemplateId : "");
  const [changeNote, setChangeNote] = useState("");
  const [links, setLinks] = useState(() => (process?.materials ?? []).filter((material) => material.kind === "link" && material.url).map((material) => ({ title: material.title, url: material.url! })));
  const [files, setFiles] = useState<File[]>([]);
  const ownerOptions = ownerMode === "role"
    ? roleTemplates.filter((roleTemplate) => !areaId || roleTemplate.areaId === areaId).map((roleTemplate) => ({ id: roleTemplate.id, name: roleTemplate.name }))
    : people.filter((person) => person.status !== "inactive" && (!areaId || person.areaId === areaId)).map((person) => ({ id: person.id, name: person.name }));
  const owner = ownerMode === "person" && ownerId ? { type: "person" as const, personId: ownerId }
    : ownerMode === "role" && ownerId ? { type: "role" as const, roleTemplateId: ownerId }
    : null;
  const validLinks = links.map((link) => ({ title: link.title.trim(), url: link.url.trim() })).filter((link) => link.title && link.url);
  const save = (publish: boolean) => onSubmit({ id: process?.id, title, summary, body, publish, areaId: areaId || null, owner, changeNote, links: validLinks, files });

  return (
    <form className="modal-form" onSubmit={(event) => event.preventDefault()}>
      <ModalHeader title={modal.mode === "edit" ? "Editar processo" : "Novo processo"} icon="ph-file-text" onClose={onClose} />
      <label>Nome do processo<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Resumo<input value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
      <div className="form-row two-cols">
        <label>Área<select value={areaId} onChange={(event) => { setAreaId(event.target.value); setOwnerId(""); }}>{canTargetWorkspace ? <option value="">Sem área</option> : null}{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
        <label>Responsável<select value={ownerMode} onChange={(event) => { setOwnerMode(event.target.value as "none" | "person" | "role"); setOwnerId(""); }}><option value="none">Sem responsável</option><option value="person">Pessoa</option><option value="role">Cargo</option></select></label>
      </div>
      {ownerMode !== "none" ? <label>{ownerMode === "person" ? "Pessoa responsável" : "Cargo responsável"}<select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">Selecionar</option>{ownerOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label> : null}
      <label>Manual do processo<textarea value={body} onChange={(event) => setBody(event.target.value)} /></label>
      {modal.mode === "edit" ? <label>O que mudou?<input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="Descreva a alteração desta versão" /></label> : null}
      <fieldset className="material-editor"><legend>Links de apoio</legend>{links.map((link, index) => <div className="inline-input-row" key={`${index}-${link.title}`}><input value={link.title} placeholder="Título" onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /><input value={link.url} placeholder="https://" onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} /><button className="tiny-icon" type="button" aria-label="Remover link" onClick={() => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Icon name="ph-x" /></button></div>)}<button className="text-action" type="button" onClick={() => setLinks((current) => [...current, { title: "", url: "" }])}><Icon name="ph-plus" />Adicionar link</button></fieldset>
      <label className="file-picker">Anexar arquivos<input type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /><small>{files.length ? `${files.length} arquivo(s) pronto(s) para enviar` : "PDFs, planilhas e outros materiais de apoio"}</small></label>
      <footer>
        <button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button>
        {modal.mode === "create" ? (
          <>
            <button className="secondary-btn" type="button" disabled={actionBusy} onClick={() => save(false)}>Salvar rascunho</button>
            <button className="accent-solid" type="button" disabled={actionBusy} onClick={() => save(true)}>Salvar e publicar</button>
          </>
        ) : (
          <button className="accent-solid" type="button" disabled={actionBusy || !changeNote.trim()} onClick={() => save(false)}>Salvar alterações</button>
        )}
      </footer>
    </form>
  );
}

function splitLegacyRoutineDue(title: string) {
  const parts = title.split(" · ");
  const dueHint = parts.length > 1 ? parts.at(-1)?.trim() : "";
  return {
    title: parts.length > 1 ? parts.slice(0, -1).join(" · ").trim() : title,
    dueHint: dueHint || null
  };
}

function RoutineForm({
  modal,
  canTargetWorkspace,
  areas,
  people,
  actionBusy,
  onClose,
  onSubmit
}: {
  modal: Extract<CrudModal, { kind: "routine" }>;
  canTargetWorkspace: boolean;
  areas: ApiArea[];
  people: ApiPerson[];
  actionBusy: boolean;
  onClose: () => void;
  onSubmit: (input: RoutineFormInput) => void;
}) {
  const routine = modal.mode === "edit" ? modal.routine : null;
  const firstTask = routine?.taskTemplates?.[0];
  const existingTasks = routine?.taskTemplates ?? [];
  const normalizedTasks = existingTasks.map((task) => {
    const legacy = splitLegacyRoutineDue(task.title);
    return {
      ...task,
      title: task.dueHint ? task.title : legacy.title,
      dueHint: task.dueHint ?? legacy.dueHint
    };
  });
  const [title, setTitle] = useState(routine?.title ?? "");
  const [areaId, setAreaId] = useState(routine?.areaId ?? areas[0]?.id ?? "");
  const [frequency, setFrequency] = useState<ApiRoutineFrequency>(routine?.frequency ?? "daily");
  const [weekdays, setWeekdays] = useState<ApiRoutineWeekday[]>(routine?.weekdays?.length ? routine.weekdays : DEFAULT_BUSINESS_WEEKDAYS);
  const [checklistItems, setChecklistItems] = useState<string[]>(normalizedTasks.map((task) => task.title).length ? normalizedTasks.map((task) => task.title) : ["Conferir agenda", "Registrar evidência"]);
  const [assigneeProfileIds, setAssigneeProfileIds] = useState<string[]>(routine?.assigneeProfileIds?.length
    ? routine.assigneeProfileIds
    : firstTask?.assigneeProfileId ? [firstTask.assigneeProfileId] : people[0]?.id ? [people[0].id] : []);
  const [due, setDue] = useState(routine?.dueHint ?? normalizedTasks.find((task) => task.dueHint)?.dueHint ?? "Até 09:00");
  const [evidencePolicy, setEvidencePolicy] = useState<ApiRoutineTaskTemplate["evidencePolicy"]>(routine?.evidencePolicy ?? firstTask?.evidencePolicy ?? "optional");
  const [approvalMode, setApprovalMode] = useState<ApiRoutineTaskTemplate["approvalMode"]>(routine?.approvalMode ?? firstTask?.approvalMode ?? "direct");
  const areaPeople = people.filter((person) => !areaId || person.areaId === areaId);
  const selectablePeople = areaPeople.length ? areaPeople : people;
  const validChecklistItems = checklistItems.map((item) => item.trim()).filter(Boolean);
  const frequencyOptions: Array<{ value: ApiRoutineFrequency; label: string }> = [
    { value: "daily", label: "Diária" },
    { value: "weekly", label: "Semanal" },
    { value: "monthly", label: "Mensal" },
    { value: "on_demand", label: "Sob demanda" }
  ];

  function toggleWeekday(day: ApiRoutineWeekday) {
    setWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day]);
  }

  function toggleAssignee(personId: string) {
    setAssigneeProfileIds((current) => current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId]);
  }

  function updateChecklistItem(index: number, value: string) {
    setChecklistItems((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  function addChecklistItem() {
    setChecklistItems((current) => [...current, ""]);
  }

  function removeChecklistItem(index: number) {
    setChecklistItems((current) => current.length > 1 ? current.filter((_, itemIndex) => itemIndex !== index) : [""]);
  }

  function save() {
    const dueHint = due.trim() || null;
    const taskTemplates = validChecklistItems.map((taskTitle) => ({
      title: taskTitle,
      evidencePolicy,
      approvalMode
    }));
    onSubmit({
      id: routine?.id,
      title,
      areaId: areaId || null,
      frequency,
      weekdays: frequency === "daily" || frequency === "weekly" ? weekdays : [],
      dueHint,
      assigneeProfileIds,
      executionMode: "individual",
      evidencePolicy,
      approvalMode,
      taskTemplates
    });
  }

  return (
    <form className="modal-form routine-form" onSubmit={(event) => event.preventDefault()}>
      <ModalHeader title={modal.mode === "edit" ? "Editar rotina" : "Nova rotina"} icon="ph-arrows-clockwise" onClose={onClose} />
      <div className="routine-core">
        <label>Nome da rotina<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Área<select value={areaId} onChange={(event) => setAreaId(event.target.value)}>{canTargetWorkspace ? <option value="">Empresa inteira</option> : null}{areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label>
      </div>
      <div className="routine-schedule">
        <section className="routine-segment" aria-label="Recorrência">
          <span>Recorrência</span>
          <div>
            {frequencyOptions.map((option) => (
              <button key={option.value} className={frequency === option.value ? "active" : ""} type="button" aria-pressed={frequency === option.value} onClick={() => setFrequency(option.value)}>{option.label}</button>
            ))}
          </div>
        </section>
        <label>Horário limite<input value={due} onChange={(event) => setDue(event.target.value)} /></label>
      </div>
      {frequency === "daily" || frequency === "weekly" ? (
        <div className="weekday-picker" aria-label="Dias da rotina">
          {(Object.keys(WEEKDAY_LABELS) as ApiRoutineWeekday[]).map((day) => (
            <button key={day} className={weekdays.includes(day) ? "active" : ""} type="button" aria-pressed={weekdays.includes(day)} onClick={() => toggleWeekday(day)}>{WEEKDAY_LABELS[day]}</button>
          ))}
        </div>
      ) : null}
      <section className="responsible-picker" aria-labelledby="routine-responsibles-title">
        <div className="field-row">
          <strong id="routine-responsibles-title">Responsáveis</strong>
          <button className="secondary-btn compact-btn" type="button" onClick={() => setAssigneeProfileIds(areaPeople.map((person) => person.id))} disabled={!areaPeople.length}>Área inteira</button>
        </div>
        <div className="person-checks">
          {selectablePeople.length ? selectablePeople.map((person) => (
            <label key={person.id} className={`person-check ${assigneeProfileIds.includes(person.id) ? "selected" : ""}`}>
              <input aria-label={person.name} type="checkbox" checked={assigneeProfileIds.includes(person.id)} onChange={() => toggleAssignee(person.id)} />
              <span>{initialsFromName(person.name)}</span>
              <strong>{person.name}</strong>
            </label>
          )) : <span className="muted-inline">Nenhuma pessoa cadastrada</span>}
        </div>
      </section>
      <div className="form-grid">
        <label>Evidência<select value={evidencePolicy} onChange={(event) => setEvidencePolicy(event.target.value as ApiRoutineTaskTemplate["evidencePolicy"])}><option value="optional">Opcional</option><option value="photo_required">Foto obrigatória</option><option value="comment_required">Comentário obrigatório</option><option value="photo_or_comment_required">Foto ou comentário</option></select></label>
        <label>Aprovação<select value={approvalMode} onChange={(event) => setApprovalMode(event.target.value as ApiRoutineTaskTemplate["approvalMode"])}><option value="direct">Conclui direto</option><option value="approval_required">Gestor aprova</option></select></label>
      </div>
      <fieldset className="checklist-builder">
        <legend>Checklist</legend>
        {checklistItems.map((item, index) => (
          <div className="checklist-edit-row" key={index}>
            <span>{index + 1}</span>
            <input aria-label={`Checklist item ${index + 1}`} value={item} onChange={(event) => updateChecklistItem(index, event.target.value)} />
            <button className="icon-btn" type="button" aria-label={`Remover item ${index + 1}`} onClick={() => removeChecklistItem(index)}><Icon name="ph-trash" /></button>
          </div>
        ))}
        <button className="secondary-btn compact-btn" type="button" onClick={addChecklistItem}><Icon name="ph-plus" />Adicionar item</button>
      </fieldset>
      <footer><button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button><button className="accent-solid" type="button" disabled={actionBusy || !title.trim() || !validChecklistItems.length} onClick={save}>Salvar rotina</button></footer>
    </form>
  );
}

function TrainingForm({
  modal,
  canTargetWorkspace,
  actionBusy,
  onClose,
  onSubmit,
  areas,
  roleTemplates,
  people,
  processes
}: {
  modal: Extract<CrudModal, { kind: "training" }>;
  canTargetWorkspace: boolean;
  actionBusy: boolean;
  onClose: () => void;
  onSubmit: (input: TrainingFormInput) => void;
  areas: ApiArea[];
  roleTemplates: ApiRoleTemplate[];
  people: ApiPerson[];
  processes: ApiProcess[];
}) {
  const training = modal.mode === "edit" ? modal.training : null;
  const initialSourceType = training?.source?.type ?? "manual";
  const initialAudience = training?.audience ?? (canTargetWorkspace ? { type: "all" as const } : { type: "area" as const, areaId: areas[0]?.id ?? "" });
  const [title, setTitle] = useState(training?.title ?? "");
  const [description, setDescription] = useState(training?.description ?? "");
  const [sourceType, setSourceType] = useState<ApiTrainingSource["type"]>(initialSourceType);
  const [processId, setProcessId] = useState(training?.source?.processId ?? processes[0]?.id ?? "");
  const [audienceType, setAudienceType] = useState<ApiTrainingAudience["type"]>(initialAudience.type);
  const [areaId, setAreaId] = useState(initialAudience.type === "area" ? initialAudience.areaId : areas[0]?.id ?? "");
  const [roleTemplateId, setRoleTemplateId] = useState(initialAudience.type === "role" ? initialAudience.roleTemplateId : roleTemplates[0]?.id ?? "");
  const [profileId, setProfileId] = useState(initialAudience.type === "person" ? initialAudience.profileId : people[0]?.id ?? "");
  const [dueDate, setDueDate] = useState(training?.dueDate ?? "");
  const [materials, setMaterials] = useState<ApiTrainingMaterial[]>(training?.materials?.length ? training.materials : [
    { kind: "lesson", title: "Aula curta", body: "", url: null }
  ]);
  const [quizQuestions, setQuizQuestions] = useState<ApiQuizQuestionInput[]>(training?.quizQuestions?.length ? training.quizQuestions : [
    {
      id: "q1",
      prompt: "Qual é o comportamento esperado depois deste treinamento?",
      options: [
        { id: "a", label: "Executar o padrão e registrar no Baase" },
        { id: "b", label: "Improvisar sem registro" }
      ],
      correctOptionId: "a",
      explanation: "O treinamento existe para transformar padrão em execução."
    }
  ]);
  const selectedProcess = processes.find((process) => process.id === processId) ?? null;
  const validMaterials = materials.filter((material) => {
    if (!material.title.trim()) return false;
    if (material.kind === "lesson") return Boolean(material.body?.trim());
    return Boolean(material.url?.trim());
  });
  const validQuestions = quizQuestions.filter((question) => {
    return question.prompt.trim() && question.options.length >= 2 && question.options.every((option) => option.label.trim());
  });
  const canSave = Boolean(title.trim() && validMaterials.length && (!quizQuestions.length || validQuestions.length === quizQuestions.length));

  function save(publish: boolean) {
    const audience: ApiTrainingAudience | null = audienceType === "area" && areaId
      ? { type: "area", areaId }
      : audienceType === "role" && roleTemplateId
        ? { type: "role", roleTemplateId }
        : audienceType === "person" && profileId
          ? { type: "person", profileId }
          : { type: "all" };
    const source: ApiTrainingSource = sourceType === "process"
      ? { type: "process", processId: selectedProcess?.id ?? processId, title: selectedProcess?.title ?? "Processo vinculado" }
      : sourceType === "material"
        ? { type: "material", processId: null, title: validMaterials.find((material) => material.kind !== "lesson")?.title ?? "Material externo" }
        : { type: "manual", processId: null, title: null };

    onSubmit({
      id: training?.id,
      title,
      description,
      source,
      audience,
      dueDate: dueDate || null,
      materials: validMaterials,
      quizQuestions: validQuestions,
      publish
    });
  }

  function applyProcessBase() {
    if (!selectedProcess) return;
    const body = selectedProcess.currentVersion?.body ?? selectedProcess.summary ?? "Leia o processo publicado e responda o quiz para confirmar entendimento.";
    setSourceType("process");
    setTitle(`Treinamento: ${selectedProcess.title}`);
    setDescription(selectedProcess.summary ?? "Treinamento criado a partir de um SOP publicado.");
    setMaterials([
      { kind: "lesson", title: `Aula: ${selectedProcess.title}`, body, url: null },
      { kind: "link", title: "Processo vinculado no Baase", body: null, url: null }
    ]);
    setQuizQuestions([
      {
        id: "q1",
        prompt: "O que a pessoa deve fazer ao executar este processo?",
        options: [
          { id: "a", label: "Seguir o SOP publicado e registrar a execução" },
          { id: "b", label: "Executar de memória sem atualizar o Baase" }
        ],
        correctOptionId: "a",
        explanation: "O SOP publicado é a referência oficial do padrão operacional."
      },
      {
        id: "q2",
        prompt: "Quando houver dúvida ou bloqueio, qual é o comportamento esperado?",
        options: [
          { id: "a", label: "Registrar o bloqueio e chamar o responsável" },
          { id: "b", label: "Deixar para resolver no WhatsApp sem registro" }
        ],
        correctOptionId: "a",
        explanation: "Bloqueio sem registro volta para a memória e enfraquece o padrão."
      }
    ]);
  }

  function updateMaterial(index: number, patch: Partial<ApiTrainingMaterial>) {
    setMaterials((current) => current.map((material, materialIndex) => materialIndex === index ? { ...material, ...patch } : material));
  }

  function addMaterial(kind: ApiTrainingMaterial["kind"]) {
    setMaterials((current) => [...current, { kind, title: kind === "lesson" ? "Nova aula" : kind === "pdf" ? "Material de apoio.pdf" : "Link de apoio", body: "", url: null }]);
  }

  function removeMaterial(index: number) {
    setMaterials((current) => current.filter((_, materialIndex) => materialIndex !== index));
  }

  function updateQuestion(index: number, patch: Partial<ApiQuizQuestionInput>) {
    setQuizQuestions((current) => current.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question));
  }

  function updateQuestionOption(questionIndex: number, optionId: string, label: string) {
    setQuizQuestions((current) => current.map((question, index) => {
      if (index !== questionIndex) return question;
      return {
        ...question,
        options: question.options.map((option) => option.id === optionId ? { ...option, label } : option)
      };
    }));
  }

  function addQuestion() {
    const nextIndex = quizQuestions.length + 1;
    setQuizQuestions((current) => [...current, {
      id: `q${nextIndex}`,
      prompt: "",
      options: [
        { id: "a", label: "" },
        { id: "b", label: "" }
      ],
      correctOptionId: "a",
      explanation: ""
    }]);
  }

  function removeQuestion(index: number) {
    setQuizQuestions((current) => current.filter((_, questionIndex) => questionIndex !== index));
  }

  return (
    <form className="modal-form training-form" onSubmit={(event) => event.preventDefault()}>
      <ModalHeader title={modal.mode === "edit" ? "Editar treinamento" : "Novo treinamento"} icon="ph-graduation-cap" onClose={onClose} />
      <section className="training-source-picker" aria-label="Origem do treinamento">
        {(["process", "material", "manual"] as ApiTrainingSource["type"][]).map((option) => (
          <button key={option} className={sourceType === option ? "active" : ""} type="button" onClick={() => setSourceType(option)}>
            <Icon name={option === "process" ? "ph-file-text" : option === "material" ? "ph-paperclip" : "ph-pencil-simple"} />
            <span>{option === "process" ? "A partir de processo" : option === "material" ? "Material/PDF/link" : "Manual"}</span>
          </button>
        ))}
      </section>
      {sourceType === "process" ? (
        <div className="training-process-source">
          <label>Processo base<select value={processId} onChange={(event) => setProcessId(event.target.value)}>{processes.length ? processes.map((process) => <option value={process.id} key={process.id}>{process.title}</option>) : <option value="">Nenhum processo criado</option>}</select></label>
          <button className="secondary-btn" type="button" disabled={!selectedProcess} onClick={applyProcessBase}><Icon name="ph-sparkle" />Usar SOP como base</button>
        </div>
      ) : null}
      <div className="routine-core">
        <label>Título do treinamento<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Como executar o SOP de entregáveis" /></label>
        <label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="O que a pessoa deve aprender e aplicar depois do treinamento." /></label>
      </div>
      <section className="responsible-picker training-audience-picker">
        <div className="field-row">
          <strong>Público e prazo</strong>
          <span className="muted-inline">Define quem recebe pendência ao publicar</span>
        </div>
        <div className="training-audience-grid">
          <label>Público<select value={audienceType} onChange={(event) => setAudienceType(event.target.value as ApiTrainingAudience["type"])}>{canTargetWorkspace ? <option value="all">Empresa inteira</option> : null}<option value="area">Área</option><option value="role">Cargo</option><option value="person">Pessoa</option></select></label>
          {audienceType === "area" ? <label>Área<select value={areaId} onChange={(event) => setAreaId(event.target.value)}>{areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label> : null}
          {audienceType === "role" ? <label>Cargo<select value={roleTemplateId} onChange={(event) => setRoleTemplateId(event.target.value)}>{roleTemplates.map((roleTemplate) => <option value={roleTemplate.id} key={roleTemplate.id}>{roleTemplate.name}</option>)}</select></label> : null}
          {audienceType === "person" ? <label>Pessoa<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : null}
          <label>Prazo<input type="date" value={dueDate} min={todayIsoDate()} onChange={(event) => setDueDate(event.target.value)} /></label>
        </div>
      </section>
      <fieldset className="training-builder-block">
        <legend>Conteúdo</legend>
        {materials.map((item, index) => (
          <div className="training-material-edit" key={index}>
            <select aria-label={`Tipo do material ${index + 1}`} value={item.kind} onChange={(event) => updateMaterial(index, { kind: event.target.value as ApiTrainingMaterial["kind"] })}>
              <option value="lesson">Aula curta</option>
              <option value="pdf">PDF</option>
              <option value="link">Link</option>
            </select>
            <input aria-label={`Título do material ${index + 1}`} value={item.title} onChange={(event) => updateMaterial(index, { title: event.target.value })} placeholder="Título do material" />
            {item.kind === "lesson" ? (
              <textarea aria-label={index === 0 ? "Material" : `Texto do material ${index + 1}`} value={item.body ?? ""} onChange={(event) => updateMaterial(index, { body: event.target.value })} placeholder="Escreva a aula curta, roteiro ou resumo operacional." />
            ) : (
              <input aria-label={`URL do material ${index + 1}`} value={item.url ?? ""} onChange={(event) => updateMaterial(index, { url: event.target.value })} placeholder="https://..." />
            )}
            <button className="icon-btn" type="button" aria-label={`Remover material ${index + 1}`} onClick={() => removeMaterial(index)}><Icon name="ph-trash" /></button>
          </div>
        ))}
        <div className="button-row">
          <button className="secondary-btn compact-btn" type="button" onClick={() => addMaterial("lesson")}><Icon name="ph-plus" />Aula</button>
          <button className="secondary-btn compact-btn" type="button" onClick={() => addMaterial("pdf")}><Icon name="ph-plus" />PDF</button>
          <button className="secondary-btn compact-btn" type="button" onClick={() => addMaterial("link")}><Icon name="ph-plus" />Link</button>
        </div>
      </fieldset>
      <fieldset className="training-builder-block">
        <legend>Quiz</legend>
        {quizQuestions.map((question, questionIndex) => (
          <div className="training-question-edit" key={question.id ?? questionIndex}>
            <div className="field-row">
              <strong>Pergunta {questionIndex + 1}</strong>
              <button className="icon-btn" type="button" aria-label={`Remover pergunta ${questionIndex + 1}`} onClick={() => removeQuestion(questionIndex)}><Icon name="ph-trash" /></button>
            </div>
            <input aria-label={questionIndex === 0 ? "Pergunta do quiz" : `Pergunta do quiz ${questionIndex + 1}`} value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} placeholder="Pergunta de validação" />
            {question.options.map((option) => (
              <label key={option.id} className="quiz-option-edit">
                <input type="radio" checked={question.correctOptionId === option.id} onChange={() => updateQuestion(questionIndex, { correctOptionId: option.id })} />
                <span>{option.id.toUpperCase()}</span>
                <input value={option.label} onChange={(event) => updateQuestionOption(questionIndex, option.id, event.target.value)} placeholder={`Alternativa ${option.id.toUpperCase()}`} />
              </label>
            ))}
            <input value={question.explanation ?? ""} onChange={(event) => updateQuestion(questionIndex, { explanation: event.target.value })} placeholder="Explicação da resposta correta" />
          </div>
        ))}
        <button className="secondary-btn compact-btn" type="button" onClick={addQuestion}><Icon name="ph-plus" />Adicionar pergunta</button>
      </fieldset>
      <footer>
        <button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button>
        <button className="secondary-btn" type="button" disabled={actionBusy || !canSave} onClick={() => save(false)}>{modal.mode === "create" ? "Salvar rascunho" : "Salvar alterações"}</button>
        <button className="accent-solid" type="button" disabled={actionBusy || !canSave || !validQuestions.length} onClick={() => save(true)}>{training?.status === "published" ? "Atualizar publicado" : "Salvar e publicar"}</button>
      </footer>
    </form>
  );
}

function InviteForm({
  canAssignManagementRoles,
  canTargetWorkspace,
  areas,
  roleTemplates,
  actionBusy,
  onClose,
  onSubmit
}: {
  canAssignManagementRoles: boolean;
  canTargetWorkspace: boolean;
  areas: ApiArea[];
  roleTemplates: ApiRoleTemplate[];
  actionBusy: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; email: string; role: "owner" | "manager" | "employee"; areaId: string; areaAccessIds: string[]; roleTemplateId: string; accessScope: "workspace" | "area" | "assigned_only" }) => void;
}) {
  const [name, setName] = useState("Novo funcionário");
  const [email, setEmail] = useState("novo@estudionorte.com");
  const [role, setRole] = useState<"owner" | "manager" | "employee">("employee");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [areaAccessIds, setAreaAccessIds] = useState<string[]>(areaId ? [areaId] : []);
  const [roleTemplateId, setRoleTemplateId] = useState(roleTemplates[0]?.id ?? "");
  const [accessReach, setAccessReach] = useState<AccessReach>("primary_area");
  const availableRoles = roleTemplates.filter((roleTemplate) => !areaId || roleTemplate.areaId === areaId);
  const selectedRoleTemplateId = availableRoles.length
    ? availableRoles.some((roleTemplate) => roleTemplate.id === roleTemplateId) ? roleTemplateId : availableRoles[0]!.id
    : "";
  const access = accessPayloadForReach(role === "owner" ? "workspace" : accessReach, areaId, areaAccessIds);

  return (
    <form className="modal-form" onSubmit={(event) => event.preventDefault()}>
      <ModalHeader title="Convidar funcionário" icon="ph-user-plus" onClose={onClose} />
      <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <div className="form-grid">
        <label>Papel<select value={role} onChange={(event) => { const nextRole = event.target.value as "owner" | "manager" | "employee"; setRole(nextRole); if (nextRole === "owner") setAccessReach("workspace"); }}><option value="employee">Funcionário</option>{canAssignManagementRoles ? <><option value="manager">Gestor</option><option value="owner">Dono</option></> : null}</select></label>
        <label>Área principal<select value={areaId} onChange={(event) => { const nextAreaId = event.target.value; setAreaId(nextAreaId); setAreaAccessIds((current) => nextAreaId && !current.includes(nextAreaId) ? [...current, nextAreaId] : current); setRoleTemplateId(""); }}>{areas.length ? areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>) : <option value="">Crie uma área primeiro</option>}</select></label>
      </div>
      <label>Cargo<select value={selectedRoleTemplateId} onChange={(event) => setRoleTemplateId(event.target.value)}><option value="">Sem cargo definido</option>{availableRoles.map((roleTemplate) => <option value={roleTemplate.id} key={roleTemplate.id}>{roleTemplate.name}</option>)}</select></label>
      <AccessReachFields
        reach={accessReach}
        onReachChange={setAccessReach}
        primaryAreaId={areaId}
        areas={areas}
        areaAccessIds={areaAccessIds}
        onToggleArea={(selectedAreaId) => setAreaAccessIds((current) => current.includes(selectedAreaId) ? current.filter((id) => id !== selectedAreaId) : [...current, selectedAreaId])}
        owner={role === "owner"}
        allowWorkspace={canTargetWorkspace}
      />
      <footer><button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button><button className="accent-solid" type="button" disabled={actionBusy || !name.trim() || !email.trim() || (!areaId && accessReach !== "workspace" && accessReach !== "assigned_only") || (accessReach === "specific_areas" && !access.areaAccessIds.length)} onClick={() => onSubmit({ name, email, role, areaId, areaAccessIds: access.areaAccessIds, roleTemplateId: selectedRoleTemplateId, accessScope: access.accessScope })}>Enviar convite</button></footer>
    </form>
  );
}

function ModalHeader({ title, icon, onClose }: { title: string; icon: string; onClose: () => void }) {
  return (
    <header className="modal-head">
      <span><Icon name={icon} /></span>
      <h2>{title}</h2>
      <button className="icon-btn" type="button" aria-label="Fechar modal" onClick={onClose}><Icon name="ph-x" /></button>
    </header>
  );
}

function splitLines(value: string) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function SideList({
  title,
  icon,
  items,
  onCreate,
  onSelect
}: {
  title: string;
  icon?: string;
  items: Array<[string, string, string, boolean]>;
  onCreate?: () => void;
  onSelect?: (index: number) => void;
}) {
  return (
    <aside className="side-list">
      <header><h2>{title}</h2>{icon ? <button type="button" aria-label={`Criar ${title.toLowerCase()}`} onClick={onCreate}><Icon name={icon} /></button> : null}</header>
      <div className="panel flush">
        {items.length ? items.map(([titleText, meta, status, active], index) => (
          <button className={`side-list-item ${active ? "active" : ""}`} type="button" key={titleText} onClick={() => onSelect?.(index)}>
            <strong>{titleText}</strong>
            <span><Pill tone={status === "Publicado" || status === "Concluído" ? "accent" : status === "Pendente" ? "warn" : "neutral"}>{status}</Pill><small>{meta}</small></span>
          </button>
        )) : <EmptyState title={`Nenhum item em ${title.toLowerCase()}`} text="Crie o primeiro registro para começar a operar com dados reais." />}
      </div>
    </aside>
  );
}

function PanelHeader({ title, aside, link, onLinkClick }: { title: string; aside?: string; link?: string; onLinkClick?: () => void }) {
  return (
    <header className="panel-header">
      <h2>{title}</h2>
      {aside ? <span className="mono">{aside}</span> : null}
      {link ? <button className="panel-link" type="button" onClick={onLinkClick}>{link}</button> : null}
    </header>
  );
}
