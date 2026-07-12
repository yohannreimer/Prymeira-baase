export type UiRole = "dono" | "gestor" | "func";
export type BaaseApiRole = "owner" | "manager" | "employee";

export type BaaseSession = {
  workspace: {
    id: string;
    name: string;
  };
  profile: {
    id: string;
    role: BaaseApiRole;
    display_name?: string;
    initials?: string;
    area_name?: string | null;
    area_names?: string[];
    access_scope?: "workspace" | "area" | "assigned_only";
  };
  home_route: string;
};

export type ApiTask = {
  id: string;
  title: string;
  status: string;
  origin?: "routine" | "manual";
  routineId?: string | null;
  taskTemplateId?: string | null;
  areaId?: string | null;
  dueDate?: string;
  dueHint?: string | null;
  checklistItems?: Array<{ title: string; done: boolean }>;
  evidencePolicy?: string;
  approvalMode?: string;
  processId?: string | null;
  assigneeProfileId?: string | null;
  evidence?: {
    comment: string | null;
    photoUrl: string | null;
  } | null;
  reviewComment?: string | null;
  submittedByProfileId?: string | null;
  submittedAt?: string | null;
};

export type ApiTaskInput = {
  title: string;
  areaId?: string | null;
  assigneeProfileId?: string | null;
  dueDate: string;
  dueHint?: string | null;
  evidencePolicy?: ApiRoutineTaskTemplate["evidencePolicy"];
  approvalMode?: ApiRoutineTaskTemplate["approvalMode"];
  checklistItems?: string[];
};

export type ApiProcess = {
  id: string;
  title: string;
  status: string;
  summary?: string | null;
  areaId?: string | null;
  owner?: ApiProcessOwner | null;
  materials?: ApiProcessMaterial[];
  versions?: ApiProcessVersion[];
  currentVersion?: {
    body?: string;
    version?: number;
  };
};

export type ApiProcessOwner =
  | { type: "person"; personId: string }
  | { type: "role"; roleTemplateId: string };

export type ApiProcessMaterial = {
  id: string;
  kind: "link" | "file";
  title: string;
  url: string | null;
  objectKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
};

export type ApiProcessVersion = {
  id?: string;
  version: number;
  title?: string | null;
  body?: string;
  changeNote?: string | null;
  editorProfileId?: string | null;
  createdAt?: string | null;
};

export type ApiRoutineTaskTemplate = {
  id?: string;
  title: string;
  processId?: string | null;
  assigneeProfileId?: string | null;
  dueHint?: string | null;
  approvalMode?: "direct" | "approval_required";
  evidencePolicy?: "optional" | "photo_required" | "comment_required" | "photo_or_comment_required";
};

export type ApiRoutineFrequency = "daily" | "weekly" | "monthly" | "on_demand";
export type ApiRoutineWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type ApiRoutineExecutionMode = "shared" | "individual";

export type ApiRoutineInput = {
  title: string;
  taskTitles?: string[];
  taskTemplates?: ApiRoutineTaskTemplate[];
  areaId?: string | null;
  frequency?: ApiRoutineFrequency;
  weekdays?: ApiRoutineWeekday[];
  dueHint?: string | null;
  assigneeProfileIds?: string[];
  executionMode?: ApiRoutineExecutionMode;
  approvalMode?: ApiRoutineTaskTemplate["approvalMode"];
  evidencePolicy?: ApiRoutineTaskTemplate["evidencePolicy"];
};

export type ApiRoutine = {
  id: string;
  title: string;
  status: string;
  areaId?: string | null;
  frequency?: ApiRoutineFrequency;
  weekdays?: ApiRoutineWeekday[];
  dueHint?: string | null;
  assigneeProfileIds?: string[];
  executionMode?: ApiRoutineExecutionMode;
  approvalMode?: ApiRoutineTaskTemplate["approvalMode"];
  evidencePolicy?: ApiRoutineTaskTemplate["evidencePolicy"];
  taskTemplates?: ApiRoutineTaskTemplate[];
};

export type ApiTrainingMaterial = {
  kind: "lesson" | "pdf" | "link";
  title: string;
  body?: string | null;
  url?: string | null;
};

export type ApiTrainingSource = {
  type: "manual" | "process" | "material";
  processId?: string | null;
  title?: string | null;
};

export type ApiTrainingAudience =
  | { type: "all" }
  | { type: "area"; areaId: string }
  | { type: "role"; roleTemplateId: string }
  | { type: "person"; profileId: string };

export type ApiQuizQuestionInput = {
  id?: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  correctOptionId: string;
  explanation?: string | null;
};

export type ApiTraining = {
  id: string;
  title: string;
  status: string;
  description?: string | null;
  source?: ApiTrainingSource | null;
  audience?: ApiTrainingAudience | null;
  dueDate?: string | null;
  materials?: ApiTrainingMaterial[];
  quizQuestions?: ApiQuizQuestionInput[];
};

export type ApiTrainingAssignment = {
  assignmentId: string;
  trainingId: string;
  profileId: string;
  dueDate: string | null;
  status: "pending" | "completed" | "overdue";
  completedAt: string | null;
  score: number | null;
  passed: boolean | null;
  training: ApiTraining;
};

export type ApiAnnouncement = {
  id: string;
  title: string;
  body?: string;
  type: "simple" | "process_change" | "mandatory_training";
  status: string;
  requirement: "none" | "read_confirmation" | "quiz_confirmation";
  audience?: { type: "all" } | { type: "area"; areaId: string } | { type: "role"; roleTemplateId: string } | { type: "person"; profileId: string };
  relatedProcessId?: string | null;
  relatedTrainingId?: string | null;
  quizQuestions?: ApiQuizQuestionInput[];
  receipt?: {
    id?: string;
    announcementId?: string;
    profileId?: string;
    status: "pending" | "confirmed" | "quiz_completed";
    quizScore?: number | null;
    passed?: boolean | null;
  };
};

export type ApiAnnouncementReceipt = NonNullable<ApiAnnouncement["receipt"]>;

export type ApiInvite = {
  id: string;
  name?: string;
  email?: string | null;
  role: BaaseApiRole;
  areaId?: string | null;
  areaAccessIds?: string[];
  roleTemplateId?: string | null;
  accessScope?: "workspace" | "area" | "assigned_only";
  code: string;
  status: string;
};

export type ApiArea = {
  id: string;
  name: string;
  description?: string | null;
};

export type ApiAreaImpact = {
  area: ApiArea;
  processes: Array<{ id: string; title: string }>;
  routines: Array<{ id: string; title: string }>;
  roleTemplates: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
  pendingInvites: Array<{ id: string; name: string; email: string | null }>;
};

export type ApiRoleTemplate = {
  id: string;
  name: string;
  areaId: string;
  description?: string | null;
};

export type ApiPerson = {
  id: string;
  name: string;
  email?: string | null;
  role: BaaseApiRole;
  areaId?: string | null;
  areaAccessIds?: string[];
  roleTemplateId?: string | null;
  accessScope?: "workspace" | "area" | "assigned_only";
  status?: string;
};

export type OnboardingSetupResult = {
  segment?: string;
  areas: ApiArea[];
  role_templates: ApiRoleTemplate[];
  people: ApiPerson[];
  processes: ApiProcess[];
  routines: ApiRoutine[];
  trainings: ApiTraining[];
  announcements?: ApiAnnouncement[];
};

export type OnboardingAnswerInput = {
  question: string;
  answer: string;
  inputMode: "text" | "audio";
};

export type OnboardingSuggestionSource = "user_provided" | "inferred" | "template" | "placeholder";

export type OnboardingSuggestionMetadata = {
  reason: string;
  basedOn: string[];
  expectedImpact: string;
  source: OnboardingSuggestionSource;
  reviewDefault: "create" | "draft" | "publish" | "activate";
};

export type OnboardingSuggestion = {
  companyName: string;
  segment: string;
  confidence: "low" | "medium" | "high";
  assumptions: string[];
  gaps: Array<{
    title: string;
    reason: string;
    suggestedQuestion: string;
  }>;
  areas: Array<{
    id: string;
    name: string;
    description: string | null;
    metadata: OnboardingSuggestionMetadata;
  }>;
  roles: Array<{
    id: string;
    areaName: string;
    name: string;
    description: string | null;
    metadata: OnboardingSuggestionMetadata;
  }>;
  people: Array<{
    id: string;
    name: string;
    email: string | null;
    role: BaaseApiRole;
    areaName: string | null;
    roleName: string | null;
    placeholder: boolean;
    metadata: OnboardingSuggestionMetadata;
  }>;
  processes: Array<{
    id: string;
    title: string;
    summary: string;
    body?: string;
    objective?: string;
    trigger?: string;
    operationalRule?: string | null;
    steps?: Array<{
      title: string;
      instruction: string;
      expectedResult: string;
      attentionPoints: string[];
    }>;
    areaName: string | null;
    metadata: OnboardingSuggestionMetadata;
  }>;
  routines: Array<{
    id: string;
    title: string;
    areaName: string | null;
    frequency: "daily" | "weekly" | "monthly" | "on_demand";
    taskTitles: string[];
    metadata: OnboardingSuggestionMetadata;
  }>;
  trainings: Array<{
    id: string;
    title: string;
    description: string;
    materialBody: string;
    quizPrompt: string;
    metadata: OnboardingSuggestionMetadata;
  }>;
  announcement?: {
    id: string;
    title: string;
    body: string;
    metadata: OnboardingSuggestionMetadata;
  } | null;
  activationPlan: Array<{
    day: number;
    title: string;
    objective: string;
    action: "open_company_map" | "review_processes" | "activate_routine" | "publish_training" | "invite_team" | "review_today" | "review_dashboard";
  }>;
};

export type OnboardingSuggestionResult = {
  suggestion: OnboardingSuggestion;
  ai_run: {
    id: string;
    status: string;
  };
};

export type OnboardingSessionStatus =
  | "not_started"
  | "in_progress"
  | "diagnosis_ready"
  | "followup"
  | "generating_setup"
  | "reviewing"
  | "completing"
  | "completion_failed"
  | "completed"
  | "skipped";

export type OnboardingAnswer = {
  questionId: string;
  theme: string;
  question: string;
  answer: string;
  inputMode: "text" | "audio";
};

export type OnboardingAttachment = {
  id: string;
  name: string;
  mimeType: string;
  extractedText: string;
  size: number;
};

export type OnboardingFollowupQuestion = {
  id: string;
  question: string;
  reason: string;
  expectedUse: string;
  priority: number;
};

export type OnboardingDiagnosis = {
  companyName: string;
  normalizedSegment: string;
  confidence: "low" | "medium" | "high";
  operationalSummary: string;
  businessModel: string | null;
  customerProfile: string | null;
  deliveryModel: string | null;
  detectedAreas: Array<Record<string, unknown>>;
  detectedPeople: Array<Record<string, unknown>>;
  bottlenecks: Array<Record<string, unknown>>;
  assumptions: string[];
  followupQuestions: OnboardingFollowupQuestion[];
};

export type OnboardingReviewItemType = "area" | "role" | "person" | "process" | "routine" | "training" | "announcement" | "invite";
export type OnboardingReviewAction = "create" | "remove" | "draft" | "publish" | "activate";

export type OnboardingReviewDecision = {
  itemType: OnboardingReviewItemType;
  itemId: string;
  action: OnboardingReviewAction;
  editedPayload: Record<string, unknown> | null;
};

export type OnboardingActivationStep = OnboardingSuggestion["activationPlan"][number];

export type OnboardingCreatedSetupSummary = {
  areas: number;
  roles: number;
  people: number;
  placeholders: number;
  processes: number;
  routines: number;
  trainings: number;
  announcements: number;
  invites: number;
};

export type OnboardingSession = {
  id: string;
  workspaceId: string;
  ownerProfileId: string;
  status: OnboardingSessionStatus;
  currentStep: string;
  companyName: string | null;
  segment: string | null;
  customSegment: string | null;
  normalizedSegment: string | null;
  teamSizeRange: string | null;
  goals: string[];
  mainAnswers: OnboardingAnswer[];
  attachments: OnboardingAttachment[];
  diagnosis: OnboardingDiagnosis | null;
  followupQuestions: OnboardingFollowupQuestion[];
  followupAnswers: OnboardingAnswer[];
  generatedSuggestion: OnboardingSuggestion | null;
  reviewDecisions: OnboardingReviewDecision[];
  activationPlan: OnboardingActivationStep[];
  createdSetupSummary: OnboardingCreatedSetupSummary | null;
  aiRunIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type PatchOnboardingSessionInput = {
  currentStep?: string;
  companyName?: string | null;
  segment?: string | null;
  customSegment?: string | null;
  normalizedSegment?: string | null;
  teamSizeRange?: string | null;
  goals?: string[];
  mainAnswers?: OnboardingAnswer[];
};

export type SaveOnboardingFollowupAnswerInput = {
  questionId: string;
  question: string;
  answer: string;
  inputMode: "text" | "audio";
};

export type SaveOnboardingReviewDecisionInput = OnboardingReviewDecision;

export type AiTranscriptionSource = "onboarding" | "create_with_ai" | "process" | "routine" | "training";

export type AiTranscript = {
  text: string;
  confidence: number | null;
  durationSeconds: number | null;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number | null;
    speaker?: number | null;
  }>;
};

export type ApiProactiveSuggestion = {
  id: string;
  signal: "area_without_routine" | "role_without_training" | "draft_process" | "approval_backlog" | "late_tasks";
  priority: "low" | "medium" | "high";
  title: string;
  reason: string;
  action: {
    type: "create_routine" | "create_training" | "review_process" | "review_approvals" | "review_routines";
    label: string;
    prompt: string;
    targetScreen: "rotinas" | "treinamentos" | "processos" | "painel-gestor";
  };
  target: {
    areaId?: string | null;
    areaAccessIds?: string[];
    roleTemplateId?: string | null;
    accessScope?: "workspace" | "area" | "assigned_only";
    processId?: string | null;
    taskIds?: string[];
  };
};

export type ApiTemplateKind = "process" | "routine" | "training";

export type ApiTemplate = {
  id: string;
  title: string;
  description: string;
  segment: string;
  area: string;
  kind: ApiTemplateKind;
  category: string;
  tag: string;
  icon: string;
  adaptPrompt: string;
};

export type ApiTemplateFilters = {
  segments: string[];
  areas: string[];
  kinds: ApiTemplateKind[];
};

export type ApiTemplateUseResult =
  | { kind: "process"; template: ApiTemplate; process: ApiProcess }
  | { kind: "routine"; template: ApiTemplate; routine: ApiRoutine }
  | { kind: "training"; template: ApiTemplate; training: ApiTraining };

export type ApiDashboardMetricSummary = {
  todayTotal: number;
  todayCompleted: number;
  executionRate: number;
  lateTasks: number;
  awaitingApproval: number;
  pendingTrainingAssignments: number;
  incompleteProcesses: number;
};

export type ApiDashboardAreaMetric = {
  areaId: string | null;
  name: string;
  total: number;
  completed: number;
  awaitingApproval: number;
  late: number;
  completionRate: number;
};

export type ApiDashboardAttentionItem = {
  id: string;
  title: string;
  subtitle: string;
  tag: string;
  tone: "danger" | "warn" | "info" | "accent";
  icon: string;
  targetScreen: "rotinas" | "treinamentos" | "processos" | "painel-gestor" | "hoje";
};

export type ApiDashboard = {
  date: string;
  role: BaaseApiRole;
  metrics: ApiDashboardMetricSummary;
  areaMetrics: ApiDashboardAreaMetric[];
  attentionItems: ApiDashboardAttentionItem[];
  employeeToday?: {
    total: number;
    completed: number;
    pending: number;
    awaitingApproval: number;
    late: number;
    pendingTrainings: number;
  };
};

export type AiDraftType = "process" | "routine" | "training" | "announcement";

export type AiGeneratedDraft = {
  id: string;
  ai_run_id: string;
  type: AiDraftType;
  status: "ready_for_review";
  content: Record<string, unknown>;
};

export type AiDraftAttachmentInput = {
  name: string;
  mimeType: string;
  contentBase64: string;
};

export type BaaseWorkspaceBundle = {
  session: BaaseSession;
  tasks: ApiTask[];
  trainingAssignments: ApiTrainingAssignment[];
  announcements: ApiAnnouncement[];
  approvals: ApiTask[];
  areas: ApiArea[];
  roleTemplates: ApiRoleTemplate[];
  people: ApiPerson[];
  invites: ApiInvite[];
  processes: ApiProcess[];
  routines: ApiRoutine[];
  trainings: ApiTraining[];
  templates: ApiTemplate[];
  templateFilters: ApiTemplateFilters;
  dashboard: ApiDashboard | null;
  proactiveSuggestions: ApiProactiveSuggestion[];
};

export type FirstRunState = {
  bundle: BaaseWorkspaceBundle;
  onboardingSession: OnboardingSession | null;
  onboardingSessionLoadError: boolean;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type TokenProvider = () => Promise<string | null> | string | null;

let baaseTokenProvider: TokenProvider | null = null;
let baaseAccountMode = false;

export function configureBaaseApiAuth(options: { getToken: TokenProvider; accountMode?: boolean } | null) {
  baaseTokenProvider = options?.getToken ?? null;
  baaseAccountMode = options?.accountMode ?? false;
}

const roleByUiRole: Record<UiRole, BaaseApiRole> = {
  dono: "owner",
  gestor: "manager",
  func: "employee"
};

const profileIdByUiRole: Record<UiRole, string> = {
  dono: "profile_owner",
  gestor: "profile_manager",
  func: "profile_employee"
};

export function createBaaseHeaders(role: UiRole): HeadersInit {
  if (baaseAccountMode) return { "content-type": "application/json" };
  return {
    "content-type": "application/json",
    "x-baase-workspace-id": "workspace_a",
    "x-baase-role": roleByUiRole[role],
    "x-baase-profile-id": profileIdByUiRole[role]
  };
}

function createBaaseAuthHeaders(role: UiRole): HeadersInit {
  if (baaseAccountMode) return {};
  return {
    "x-baase-workspace-id": "workspace_a",
    "x-baase-role": roleByUiRole[role],
    "x-baase-profile-id": profileIdByUiRole[role]
  };
}

async function readJson<T>(fetcher: Fetcher, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, await withConfiguredAuth(init));
  if (!response.ok) {
    throw new Error(`Baase API request failed: ${response.status} ${url}`);
  }
  const body = await response.text();
  return (body ? JSON.parse(body) : {}) as T;
}

async function withConfiguredAuth(init: RequestInit = {}): Promise<RequestInit> {
  if (!baaseTokenProvider) return init;

  const token = await baaseTokenProvider();
  if (!token) return init;

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return {
    ...init,
    headers
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function pickValue(record: Record<string, unknown>, camelKey: string, snakeKey: string) {
  if (hasOwn(record, camelKey)) return record[camelKey];
  if (hasOwn(record, snakeKey)) return record[snakeKey];
  return undefined;
}

function pickField<T>(record: Record<string, unknown>, camelKey: string, snakeKey: string, fallback: T): T {
  const value = pickValue(record, camelKey, snakeKey);
  return (value === undefined ? fallback : value) as T;
}

function normalizeOnboardingAnswer(raw: unknown): OnboardingAnswer {
  const record = asRecord(raw);
  return {
    questionId: pickField(record, "questionId", "question_id", ""),
    theme: pickField(record, "theme", "theme", ""),
    question: pickField(record, "question", "question", ""),
    answer: pickField(record, "answer", "answer", ""),
    inputMode: pickField(record, "inputMode", "input_mode", "text")
  };
}

function normalizeOnboardingAttachment(raw: unknown): OnboardingAttachment {
  const record = asRecord(raw);
  return {
    id: pickField(record, "id", "id", ""),
    name: pickField(record, "name", "name", ""),
    mimeType: pickField(record, "mimeType", "mime_type", ""),
    extractedText: pickField(record, "extractedText", "extracted_text", ""),
    size: pickField(record, "size", "size", 0)
  };
}

function normalizeOnboardingReviewDecision(raw: unknown): OnboardingReviewDecision {
  const record = asRecord(raw);
  return {
    itemType: pickField(record, "itemType", "item_type", "area"),
    itemId: pickField(record, "itemId", "item_id", ""),
    action: pickField(record, "action", "action", "create"),
    editedPayload: pickField(record, "editedPayload", "edited_payload", null)
  };
}

export function normalizeOnboardingSession(raw: unknown): OnboardingSession {
  const record = asRecord(raw);
  return {
    id: pickField(record, "id", "id", ""),
    workspaceId: pickField(record, "workspaceId", "workspace_id", ""),
    ownerProfileId: pickField(record, "ownerProfileId", "owner_profile_id", ""),
    status: pickField(record, "status", "status", "not_started"),
    currentStep: pickField(record, "currentStep", "current_step", "identity"),
    companyName: pickField(record, "companyName", "company_name", null),
    segment: pickField(record, "segment", "segment", null),
    customSegment: pickField(record, "customSegment", "custom_segment", null),
    normalizedSegment: pickField(record, "normalizedSegment", "normalized_segment", null),
    teamSizeRange: pickField(record, "teamSizeRange", "team_size_range", null),
    goals: pickField(record, "goals", "goals", []),
    mainAnswers: pickField<unknown[]>(record, "mainAnswers", "main_answers", []).map(normalizeOnboardingAnswer),
    attachments: pickField<unknown[]>(record, "attachments", "attachments", []).map(normalizeOnboardingAttachment),
    diagnosis: pickField(record, "diagnosis", "diagnosis", null),
    followupQuestions: pickField(record, "followupQuestions", "followup_questions", []),
    followupAnswers: pickField<unknown[]>(record, "followupAnswers", "followup_answers", []).map(normalizeOnboardingAnswer),
    generatedSuggestion: pickField(record, "generatedSuggestion", "generated_suggestion", null),
    reviewDecisions: pickField<unknown[]>(record, "reviewDecisions", "review_decisions", []).map(normalizeOnboardingReviewDecision),
    activationPlan: pickField(record, "activationPlan", "activation_plan", []),
    createdSetupSummary: pickField(record, "createdSetupSummary", "created_setup_summary", null),
    aiRunIds: pickField(record, "aiRunIds", "ai_run_ids", []),
    createdAt: pickField(record, "createdAt", "created_at", ""),
    updatedAt: pickField(record, "updatedAt", "updated_at", ""),
    completedAt: pickField(record, "completedAt", "completed_at", null)
  };
}

function isApiDashboard(value: unknown): value is ApiDashboard {
  return value !== null && typeof value === "object" && "metrics" in value && "areaMetrics" in value;
}

type TodayResponse = {
  tasks: ApiTask[];
  training_assignments?: ApiTrainingAssignment[];
  announcements?: ApiAnnouncement[];
};

const OPTIONAL_BOOTSTRAP_TIMEOUT_MS = 1_500;

function optionalBootstrapValue<T>(request: (signal: AbortSignal) => Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => {
      controller.abort();
      finish(fallback);
    }, OPTIONAL_BOOTSTRAP_TIMEOUT_MS);

    void request(controller.signal).then(
      (value) => {
        finish(value);
      },
      () => {
        finish(fallback);
      }
    );
  });
}

export async function loadBaaseWorkspace(
  role: UiRole,
  date: string,
  fetcher: Fetcher = fetch
): Promise<BaaseWorkspaceBundle> {
  const headers = createBaaseHeaders(role);
  const optionalResultsPromise = Promise.all([
    role === "func"
      ? Promise.resolve<{ tasks: ApiTask[] }>({ tasks: [] })
      : optionalBootstrapValue((signal) => readJson<{ tasks: ApiTask[] }>(fetcher, "/api/approvals", { headers, signal }), { tasks: [] }),
    optionalBootstrapValue((signal) => readJson<{ trainings: ApiTraining[] }>(fetcher, "/api/trainings", { headers, signal }), { trainings: [] }),
    optionalBootstrapValue((signal) => readJson<{ invites: ApiInvite[] }>(fetcher, "/api/invites", { headers, signal }), { invites: [] }),
    role === "func"
      ? Promise.resolve<{ templates: ApiTemplate[]; filters: ApiTemplateFilters }>({ templates: [], filters: { segments: [], areas: [], kinds: [] } })
      : optionalBootstrapValue((signal) => readJson<{ templates: ApiTemplate[]; filters: ApiTemplateFilters }>(fetcher, "/api/templates", { headers, signal }), { templates: [], filters: { segments: [], areas: [], kinds: [] } }),
    optionalBootstrapValue((signal) => readJson<ApiDashboard | Record<string, never>>(fetcher, `/api/dashboard?date=${encodeURIComponent(date)}`, { headers, signal }), {} as ApiDashboard | Record<string, never>),
    role === "func"
      ? Promise.resolve<{ suggestions: ApiProactiveSuggestion[] }>({ suggestions: [] })
      : optionalBootstrapValue((signal) => readJson<{ suggestions: ApiProactiveSuggestion[] }>(fetcher, "/api/ai/proactive-suggestions", { headers, signal }), { suggestions: [] })
  ]);
  const [session, today, processes, routines, areas, roleTemplates, people] = await Promise.all([
    readJson<BaaseSession>(fetcher, "/api/me", { headers }),
    readJson<TodayResponse>(fetcher, `/api/today?date=${encodeURIComponent(date)}`, { headers }),
    readJson<{ processes: ApiProcess[] }>(fetcher, "/api/processes", { headers }),
    readJson<{ routines: ApiRoutine[] }>(fetcher, "/api/routines", { headers }),
    readJson<{ areas: ApiArea[] }>(fetcher, "/api/areas", { headers }),
    readJson<{ role_templates: ApiRoleTemplate[] }>(fetcher, "/api/roles", { headers }),
    readJson<{ people: ApiPerson[] }>(fetcher, "/api/people", { headers })
  ]);
  const [approvals, trainings, invites, templates, dashboard, proactive] = await optionalResultsPromise;

  return {
    session,
    tasks: today.tasks,
    trainingAssignments: today.training_assignments ?? [],
    announcements: today.announcements ?? [],
    approvals: approvals.tasks,
    areas: areas.areas ?? [],
    roleTemplates: roleTemplates.role_templates ?? [],
    people: people.people ?? [],
    invites: invites.invites ?? [],
    processes: processes.processes,
    routines: routines.routines,
    trainings: trainings.trainings,
    templates: templates.templates ?? [],
    templateFilters: templates.filters ?? { segments: [], areas: [], kinds: [] },
    dashboard: isApiDashboard(dashboard) ? dashboard : null,
    proactiveSuggestions: proactive.suggestions ?? []
  };
}

export async function loadFirstRunState(
  role: UiRole,
  date: string,
  fetcher: Fetcher = fetch
): Promise<FirstRunState> {
  const onboardingSessionPromise = role === "dono"
    ? optionalBootstrapValue(
      (signal) => getOnboardingSession(role, fetcher, signal)
        .then((onboardingSession) => ({ onboardingSession, onboardingSessionLoadError: false })),
      { onboardingSession: null, onboardingSessionLoadError: true }
    )
    : Promise.resolve({ onboardingSession: null, onboardingSessionLoadError: false });
  const [bundle, onboarding] = await Promise.all([
    loadBaaseWorkspace(role, date, fetcher),
    onboardingSessionPromise
  ]);

  return { bundle, ...onboarding };
}

export async function useTemplate(role: UiRole, templateId: string, fetcher: Fetcher = fetch) {
  return readJson<ApiTemplateUseResult>(fetcher, `/api/templates/${encodeURIComponent(templateId)}/use`, {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });
}

export async function submitTaskExecution(
  role: UiRole,
  taskId: string,
  evidence: { comment?: string | null; photoUrl?: string | null },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ task: ApiTask }>(fetcher, `/api/tasks/${taskId}/submit`, {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      comment: evidence.comment ?? null,
      photo_url: evidence.photoUrl ?? null
    })
  });

  return result.task;
}

export async function createTask(role: UiRole, input: ApiTaskInput, fetcher: Fetcher = fetch) {
  const result = await readJson<{ task: ApiTask }>(fetcher, "/api/tasks", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      title: input.title,
      area_id: input.areaId ?? null,
      assignee_profile_id: input.assigneeProfileId ?? null,
      due_date: input.dueDate,
      due_hint: input.dueHint ?? null,
      evidence_policy: input.evidencePolicy,
      approval_mode: input.approvalMode,
      checklist_items: input.checklistItems ?? []
    })
  });

  return result.task;
}

export async function updateTask(role: UiRole, taskId: string, input: ApiTaskInput, fetcher: Fetcher = fetch) {
  const result = await readJson<{ task: ApiTask }>(fetcher, `/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      title: input.title,
      area_id: input.areaId ?? null,
      assignee_profile_id: input.assigneeProfileId ?? null,
      due_date: input.dueDate,
      due_hint: input.dueHint ?? null,
      evidence_policy: input.evidencePolicy,
      approval_mode: input.approvalMode,
      checklist_items: input.checklistItems ?? []
    })
  });

  return result.task;
}

export async function updateTaskChecklist(
  role: UiRole,
  taskId: string,
  checklistItems: NonNullable<ApiTask["checklistItems"]>,
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ task: ApiTask }>(fetcher, `/api/tasks/${taskId}/checklist`, {
    method: "PATCH",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      checklist_items: checklistItems
    })
  });

  return result.task;
}

export async function deleteTask(role: UiRole, taskId: string, fetcher: Fetcher = fetch) {
  await readJson<unknown>(fetcher, `/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    headers: createBaaseAuthHeaders(role)
  });
}

export async function approveTask(role: UiRole, taskId: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ task: ApiTask }>(fetcher, `/api/tasks/${taskId}/approve`, {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });

  return result.task;
}

export async function returnTask(role: UiRole, taskId: string, comment: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ task: ApiTask }>(fetcher, `/api/tasks/${taskId}/return`, {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({ comment })
  });

  return result.task;
}

export async function createArea(
  role: UiRole,
  input: { name: string; description?: string | null },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ area: ApiArea }>(fetcher, "/api/areas", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      name: input.name,
      description: input.description ?? null
    })
  });

  return result.area;
}

export async function updateArea(
  role: UiRole,
  areaId: string,
  input: { name: string; description?: string | null },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ area: ApiArea }>(fetcher, `/api/areas/${encodeURIComponent(areaId)}`, {
    method: "PATCH",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      name: input.name,
      description: input.description ?? null
    })
  });

  return result.area;
}

export async function deleteArea(role: UiRole, areaId: string, fetcher: Fetcher = fetch) {
  await readJson<{ ok: true }>(fetcher, `/api/areas/${encodeURIComponent(areaId)}`, {
    method: "DELETE",
    headers: createBaaseAuthHeaders(role)
  });
}

export async function getAreaImpact(role: UiRole, areaId: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ impact: ApiAreaImpact | null }>(fetcher, `/api/areas/${encodeURIComponent(areaId)}/impact`, {
    headers: createBaaseAuthHeaders(role)
  });
  return result.impact;
}

export async function archiveArea(
  role: UiRole,
  areaId: string,
  resolution: { strategy: "reassign"; targetAreaId: string } | { strategy: "unassign" },
  fetcher: Fetcher = fetch
) {
  const body = resolution.strategy === "reassign"
    ? { strategy: "reassign", target_area_id: resolution.targetAreaId }
    : { strategy: "unassign" };
  return readJson<{ result: unknown }>(fetcher, `/api/areas/${encodeURIComponent(areaId)}/archive`, {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify(body)
  });
}

export async function createRoleTemplate(
  role: UiRole,
  input: { areaId: string; name: string; description?: string | null },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ role_template: ApiRoleTemplate }>(fetcher, "/api/roles", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      area_id: input.areaId,
      name: input.name,
      description: input.description ?? null
    })
  });

  return result.role_template;
}

export async function deleteRoleTemplate(role: UiRole, roleTemplateId: string, fetcher: Fetcher = fetch) {
  await readJson<{ ok: true }>(fetcher, `/api/roles/${encodeURIComponent(roleTemplateId)}`, {
    method: "DELETE",
    headers: createBaaseAuthHeaders(role)
  });
}

export async function createPerson(
  role: UiRole,
  input: {
    name: string;
    email?: string | null;
    role: BaaseApiRole;
    areaId?: string | null;
    areaAccessIds?: string[];
    roleTemplateId?: string | null;
    accessScope?: "workspace" | "area" | "assigned_only";
  },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ person: ApiPerson }>(fetcher, "/api/people", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      name: input.name,
      email: input.email ?? null,
      role: input.role,
      area_id: input.areaId ?? null,
      ...(input.areaAccessIds ? { area_ids: input.areaAccessIds } : {}),
      role_template_id: input.roleTemplateId ?? null,
      ...(input.accessScope ? { access_scope: input.accessScope } : {})
    })
  });

  return result.person;
}

export async function updatePerson(
  role: UiRole,
  personId: string,
  input: {
    name: string;
    email?: string | null;
    role: BaaseApiRole;
    areaId?: string | null;
    areaAccessIds?: string[];
    roleTemplateId?: string | null;
    accessScope?: "workspace" | "area" | "assigned_only";
    status?: string;
  },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ person: ApiPerson }>(fetcher, `/api/people/${encodeURIComponent(personId)}`, {
    method: "PATCH",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      name: input.name,
      email: input.email ?? null,
      role: input.role,
      area_id: input.areaId ?? null,
      ...(input.areaAccessIds ? { area_ids: input.areaAccessIds } : {}),
      role_template_id: input.roleTemplateId ?? null,
      ...(input.accessScope ? { access_scope: input.accessScope } : {}),
      status: input.status
    })
  });

  return result.person;
}

export async function deletePerson(role: UiRole, personId: string, fetcher: Fetcher = fetch) {
  await readJson<unknown>(fetcher, `/api/people/${encodeURIComponent(personId)}`, {
    method: "DELETE",
    headers: createBaaseAuthHeaders(role)
  });
}

export async function createProcessDraft(
  role: UiRole,
  input: { title: string; body: string; summary?: string | null; areaId?: string | null },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ process: ApiProcess }>(fetcher, "/api/processes", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      summary: input.summary ?? null,
      area_id: input.areaId ?? null
    })
  });

  return result.process;
}

export async function publishProcess(role: UiRole, processId: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ process: ApiProcess }>(fetcher, `/api/processes/${processId}/publish`, {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });

  return result.process;
}

export async function createProcessVersion(
  role: UiRole,
  processId: string,
  input: { title?: string | null; body: string; changeNote: string; summary?: string | null; areaId?: string | null },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ process: ApiProcess }>(fetcher, `/api/processes/${processId}/versions`, {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      title: input.title ?? null,
      body: input.body,
      change_note: input.changeNote,
      summary: input.summary ?? null,
      area_id: input.areaId ?? null
    })
  });

  return result.process;
}

export async function updateProcess(
  role: UiRole,
  processId: string,
  input: {
    title?: string | null;
    body: string;
    changeNote: string;
    summary?: string | null;
    areaId?: string | null;
    owner?: ApiProcessOwner | null;
    links?: Array<{ title: string; url: string }>;
  },
  fetcher: Fetcher = fetch
) {
  const owner = input.owner === undefined ? undefined : input.owner === null ? null : input.owner.type === "person"
    ? { type: "person", person_id: input.owner.personId }
    : { type: "role", role_template_id: input.owner.roleTemplateId };
  const result = await readJson<{ process: ApiProcess }>(fetcher, `/api/processes/${processId}`, {
    method: "PATCH",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      title: input.title ?? null,
      body: input.body,
      change_note: input.changeNote,
      summary: input.summary ?? null,
      area_id: input.areaId ?? null,
      owner,
      materials: input.links?.map((link) => ({ kind: "link", title: link.title, url: link.url }))
    })
  });

  return result.process;
}

export async function uploadProcessMaterial(
  role: UiRole,
  processId: string,
  file: File,
  fetcher: Fetcher = fetch
) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const result = await readJson<{ material: ApiProcessMaterial }>(fetcher, `/api/processes/${processId}/materials/files`, {
    method: "POST",
    headers: createBaaseAuthHeaders(role),
    body: formData
  });
  return result.material;
}

export async function deleteProcessMaterial(role: UiRole, processId: string, materialId: string, fetcher: Fetcher = fetch) {
  await readJson<{ ok: true }>(fetcher, `/api/processes/${processId}/materials/${materialId}`, {
    method: "DELETE",
    headers: createBaaseAuthHeaders(role)
  });
}

export async function getProcessMaterialDownloadUrl(role: UiRole, processId: string, materialId: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ url: string }>(fetcher, `/api/processes/${processId}/materials/${materialId}/download`, {
    headers: createBaaseAuthHeaders(role)
  });
  return result.url;
}

export async function unpublishProcess(role: UiRole, processId: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ process: ApiProcess }>(fetcher, `/api/processes/${processId}/unpublish`, {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });

  return result.process;
}

export async function deleteProcess(role: UiRole, processId: string, fetcher: Fetcher = fetch) {
  await readJson<unknown>(fetcher, `/api/processes/${encodeURIComponent(processId)}`, {
    method: "DELETE",
    headers: createBaaseAuthHeaders(role)
  });
}

export async function createRoutine(
  role: UiRole,
  input: ApiRoutineInput,
  fetcher: Fetcher = fetch
) {
  const taskTemplates = input.taskTemplates ?? (input.taskTitles ?? []).map((title) => ({
    title,
    approvalMode: "direct" as const,
    evidencePolicy: "optional" as const
  }));
  const result = await readJson<{ routine: ApiRoutine }>(fetcher, "/api/routines", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      title: input.title,
      area_id: input.areaId ?? null,
      frequency: input.frequency,
      weekdays: input.weekdays,
      due_hint: input.dueHint ?? null,
      assignee_profile_ids: input.assigneeProfileIds,
      execution_mode: input.executionMode,
      approval_mode: input.approvalMode,
      evidence_policy: input.evidencePolicy,
      task_templates: taskTemplates.map(toRoutineTaskPayload)
    })
  });

  return result.routine;
}

export async function updateRoutine(
  role: UiRole,
  routineId: string,
  input: ApiRoutineInput & { taskTemplates: ApiRoutineTaskTemplate[] },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ routine: ApiRoutine }>(fetcher, `/api/routines/${routineId}`, {
    method: "PATCH",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      title: input.title,
      area_id: input.areaId ?? null,
      frequency: input.frequency,
      weekdays: input.weekdays,
      due_hint: input.dueHint ?? null,
      assignee_profile_ids: input.assigneeProfileIds,
      execution_mode: input.executionMode,
      approval_mode: input.approvalMode,
      evidence_policy: input.evidencePolicy,
      task_templates: input.taskTemplates.map(toRoutineTaskPayload)
    })
  });

  return result.routine;
}

export async function archiveRoutine(role: UiRole, routineId: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ routine: ApiRoutine }>(fetcher, `/api/routines/${routineId}/archive`, {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });

  return result.routine;
}

export async function deleteRoutine(role: UiRole, routineId: string, fetcher: Fetcher = fetch) {
  await readJson<unknown>(fetcher, `/api/routines/${encodeURIComponent(routineId)}`, {
    method: "DELETE",
    headers: createBaaseAuthHeaders(role)
  });
}

function trainingSourcePayload(source?: ApiTrainingSource | null) {
  if (!source) return null;
  return {
    type: source.type,
    process_id: source.processId ?? null,
    title: source.title ?? null
  };
}

function trainingAudiencePayload(audience?: ApiTrainingAudience | null) {
  if (!audience) return null;
  if (audience.type === "area") return { type: "area", area_id: audience.areaId };
  if (audience.type === "role") return { type: "role", role_template_id: audience.roleTemplateId };
  if (audience.type === "person") return { type: "person", profile_id: audience.profileId };
  return { type: "all" };
}

export async function createTrainingDraft(
  role: UiRole,
  input: { title: string; description?: string | null; source?: ApiTrainingSource | null; audience?: ApiTrainingAudience | null; dueDate?: string | null; materials?: ApiTrainingMaterial[]; quizQuestions?: ApiQuizQuestionInput[] },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ training: ApiTraining }>(fetcher, "/api/trainings", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      title: input.title,
      description: input.description ?? null,
      source: trainingSourcePayload(input.source),
      audience: trainingAudiencePayload(input.audience),
      due_date: input.dueDate ?? null,
      materials: input.materials ?? [
        {
          kind: "lesson",
          title: "Aula curta",
          body: input.description ?? "Conteudo inicial gerado pelo Baase.",
          url: null
        }
      ],
      quiz_questions: (input.quizQuestions ?? [
        {
          prompt: "Qual e o comportamento esperado depois deste treinamento?",
          options: [
            { id: "a", label: "Executar o processo no padrao combinado" },
            { id: "b", label: "Improvisar sem registrar evidencia" }
          ],
          correctOptionId: "a",
          explanation: "O treinamento existe para padronizar a execucao."
        }
      ]).map((question) => ({
        prompt: question.prompt,
        options: question.options,
        correct_option_id: question.correctOptionId,
        explanation: question.explanation ?? null
      }))
    })
  });

  return result.training;
}

export async function publishTraining(role: UiRole, trainingId: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ training: ApiTraining }>(fetcher, `/api/trainings/${trainingId}/publish`, {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });

  return result.training;
}

export async function updateTraining(
  role: UiRole,
  trainingId: string,
  input: { title: string; description?: string | null; source?: ApiTrainingSource | null; audience?: ApiTrainingAudience | null; dueDate?: string | null; materials: ApiTrainingMaterial[]; quizQuestions: ApiQuizQuestionInput[] },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ training: ApiTraining }>(fetcher, `/api/trainings/${trainingId}`, {
    method: "PATCH",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      title: input.title,
      description: input.description ?? null,
      source: trainingSourcePayload(input.source),
      audience: trainingAudiencePayload(input.audience),
      due_date: input.dueDate ?? null,
      materials: input.materials,
      quiz_questions: input.quizQuestions.map((question) => ({
        prompt: question.prompt,
        options: question.options,
        correct_option_id: question.correctOptionId,
        explanation: question.explanation ?? null
      }))
    })
  });

  return result.training;
}

export async function deleteTraining(role: UiRole, trainingId: string, fetcher: Fetcher = fetch) {
  await readJson<unknown>(fetcher, `/api/trainings/${trainingId}`, {
    method: "DELETE",
    headers: createBaaseAuthHeaders(role)
  });
}

export async function unpublishTraining(role: UiRole, trainingId: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ training: ApiTraining }>(fetcher, `/api/trainings/${trainingId}/unpublish`, {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });

  return result.training;
}

export async function assignTraining(
  role: UiRole,
  trainingId: string,
  input: {
    audienceType: "all" | "area" | "role" | "person";
    areaId?: string | null;
    roleTemplateId?: string | null;
    profileId?: string | null;
    dueDate?: string | null;
  },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ assignment: unknown }>(fetcher, `/api/trainings/${trainingId}/assignments`, {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      audience_type: input.audienceType,
      area_id: input.areaId ?? null,
      role_template_id: input.roleTemplateId ?? null,
      profile_id: input.profileId ?? null,
      due_date: input.dueDate ?? null
    })
  });

  return result.assignment;
}

export async function submitTrainingQuizAttempt(
  role: UiRole,
  trainingId: string,
  answers: Array<{ questionId: string; optionId: string }>,
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ attempt: { id: string; score: number; passed: boolean } }>(fetcher, `/api/trainings/${trainingId}/attempts`, {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      answers: answers.map((answer) => ({
        question_id: answer.questionId,
        option_id: answer.optionId
      }))
    })
  });

  return result.attempt;
}

export async function createAnnouncementDraft(
  role: UiRole,
  input: {
    title: string;
    body: string;
    type: ApiAnnouncement["type"];
    requirement: ApiAnnouncement["requirement"];
    audienceType: "all" | "area" | "role" | "person";
    areaId?: string | null;
    roleTemplateId?: string | null;
    profileId?: string | null;
    relatedProcessId?: string | null;
    relatedTrainingId?: string | null;
    quizQuestions?: ApiQuizQuestionInput[];
  },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ announcement: ApiAnnouncement }>(fetcher, "/api/announcements", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      type: input.type,
      requirement: input.requirement,
      audience_type: input.audienceType,
      area_id: input.areaId ?? null,
      role_template_id: input.roleTemplateId ?? null,
      profile_id: input.profileId ?? null,
      related_process_id: input.relatedProcessId ?? null,
      related_training_id: input.relatedTrainingId ?? null,
      quiz_questions: (input.quizQuestions ?? []).map((question) => ({
        prompt: question.prompt,
        options: question.options,
        correct_option_id: question.correctOptionId,
        explanation: question.explanation ?? null
      }))
    })
  });

  return result.announcement;
}

export async function publishAnnouncement(role: UiRole, announcementId: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ announcement: ApiAnnouncement }>(fetcher, `/api/announcements/${announcementId}/publish`, {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });

  return result.announcement;
}

export async function deleteAnnouncement(role: UiRole, announcementId: string, fetcher: Fetcher = fetch) {
  await readJson<unknown>(fetcher, `/api/announcements/${encodeURIComponent(announcementId)}`, {
    method: "DELETE",
    headers: createBaaseAuthHeaders(role)
  });
}

export async function confirmAnnouncement(
  role: UiRole,
  announcementId: string,
  answers: Array<{ questionId: string; optionId: string }> = [],
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ receipt: ApiAnnouncementReceipt }>(fetcher, `/api/announcements/${announcementId}/confirm`, {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      answers: answers.map((answer) => ({
        question_id: answer.questionId,
        option_id: answer.optionId
      }))
    })
  });

  return result.receipt;
}

export async function createInvite(
  role: UiRole,
  input: {
    name: string;
    email?: string | null;
    role: BaaseApiRole;
    areaId?: string | null;
    areaAccessIds?: string[];
    roleTemplateId?: string | null;
    accessScope?: "workspace" | "area" | "assigned_only";
  },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ invite: ApiInvite }>(fetcher, "/api/invites", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      name: input.name,
      email: input.email ?? null,
      role: input.role,
      area_id: input.areaId ?? null,
      ...(input.areaAccessIds ? { area_ids: input.areaAccessIds } : {}),
      role_template_id: input.roleTemplateId ?? null,
      ...(input.accessScope ? { access_scope: input.accessScope } : {})
    })
  });

  return result.invite;
}

export async function deleteInvite(role: UiRole, inviteId: string, fetcher: Fetcher = fetch) {
  await readJson<unknown>(fetcher, `/api/invites/${encodeURIComponent(inviteId)}`, {
    method: "DELETE",
    headers: createBaaseAuthHeaders(role)
  });
}

export async function getInviteByCode(code: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ invite: ApiInvite }>(fetcher, `/api/invites/${encodeURIComponent(code.trim().toUpperCase())}`, {
    method: "GET"
  });

  return result.invite;
}

export async function acceptInvite(
  code: string,
  input: { name?: string | null; email?: string | null } = {},
  fetcher: Fetcher = fetch
) {
  return readJson<{ invite: ApiInvite; person: ApiPerson }>(fetcher, `/api/invites/${encodeURIComponent(code.trim().toUpperCase())}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name ?? null,
      email: input.email ?? null
    })
  });
}

function toRoutineTaskPayload(task: ApiRoutineTaskTemplate) {
  return {
    title: task.title,
    process_id: task.processId ?? null,
    assignee_profile_id: task.assigneeProfileId ?? null,
    due_hint: task.dueHint ?? null,
    approval_mode: task.approvalMode ?? "direct",
    evidence_policy: task.evidencePolicy ?? "optional"
  };
}

export async function saveReviewWorkspace(role: UiRole, segment: string, fetcher: Fetcher = fetch) {
  const result = await readJson<{ setup: OnboardingSetupResult }>(fetcher, "/api/onboarding/setup", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify(createStarterSetupPlan(segment))
  });

  return result.setup;
}

function onboardingAnswerToPayload(answer: OnboardingAnswer) {
  return {
    question_id: answer.questionId,
    theme: answer.theme,
    question: answer.question,
    answer: answer.answer,
    input_mode: answer.inputMode
  };
}

function nullableOnboardingText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export async function getOnboardingSession(role: UiRole, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<OnboardingSession | null> {
  const result = await readJson<{ session: unknown | null }>(fetcher, "/api/onboarding/session", {
    method: "GET",
    headers: createBaaseHeaders(role),
    signal
  });

  if (!Object.prototype.hasOwnProperty.call(result, "session")) {
    throw new Error("Baase API invalid onboarding session response");
  }

  return result.session ? normalizeOnboardingSession(result.session) : null;
}

export function createOnboardingSession(role: UiRole, fetcher?: Fetcher): Promise<OnboardingSession>;
export function createOnboardingSession(role: UiRole, currentStep?: string, fetcher?: Fetcher): Promise<OnboardingSession>;
export async function createOnboardingSession(
  role: UiRole,
  currentStepOrFetcher: string | Fetcher = "identity",
  maybeFetcher?: Fetcher
): Promise<OnboardingSession> {
  const currentStep = typeof currentStepOrFetcher === "function" ? "identity" : currentStepOrFetcher;
  const fetcher = typeof currentStepOrFetcher === "function" ? currentStepOrFetcher : maybeFetcher ?? fetch;
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({ current_step: currentStep })
  });

  return normalizeOnboardingSession(result.session);
}

export async function patchOnboardingSession(
  role: UiRole,
  input: PatchOnboardingSessionInput,
  fetcher: Fetcher = fetch
): Promise<OnboardingSession> {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session", {
    method: "PATCH",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      current_step: input.currentStep,
      company_name: nullableOnboardingText(input.companyName),
      segment: nullableOnboardingText(input.segment),
      custom_segment: nullableOnboardingText(input.customSegment),
      normalized_segment: nullableOnboardingText(input.normalizedSegment),
      team_size_range: nullableOnboardingText(input.teamSizeRange),
      goals: input.goals,
      main_answers: input.mainAnswers
        ?.filter((answer) => answer.answer.trim().length > 0)
        .map(onboardingAnswerToPayload)
    })
  });

  return normalizeOnboardingSession(result.session);
}

export async function skipOnboardingSession(role: UiRole, fetcher: Fetcher = fetch): Promise<OnboardingSession> {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/skip", {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });

  return normalizeOnboardingSession(result.session);
}

export async function generateOnboardingDiagnosis(role: UiRole, fetcher: Fetcher = fetch): Promise<OnboardingSession> {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/diagnosis", {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });

  return normalizeOnboardingSession(result.session);
}

export async function saveOnboardingFollowupAnswer(
  role: UiRole,
  input: SaveOnboardingFollowupAnswerInput,
  fetcher: Fetcher = fetch
): Promise<OnboardingSession> {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/followup-answer", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      question_id: input.questionId,
      question: input.question,
      answer: input.answer,
      input_mode: input.inputMode
    })
  });

  return normalizeOnboardingSession(result.session);
}

export async function generateOnboardingSetup(role: UiRole, fetcher: Fetcher = fetch): Promise<OnboardingSession> {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/generate-setup", {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });

  return normalizeOnboardingSession(result.session);
}

export async function saveOnboardingReviewDecision(
  role: UiRole,
  input: SaveOnboardingReviewDecisionInput,
  fetcher: Fetcher = fetch
): Promise<OnboardingSession> {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/review-decision", {
    method: "PATCH",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      item_type: input.itemType,
      item_id: input.itemId,
      action: input.action,
      edited_payload: input.editedPayload ?? null
    })
  });

  return normalizeOnboardingSession(result.session);
}

export async function completeOnboardingSession(role: UiRole, fetcher: Fetcher = fetch): Promise<OnboardingSession> {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/complete", {
    method: "POST",
    headers: createBaaseAuthHeaders(role)
  });

  return normalizeOnboardingSession(result.session);
}

export async function generateOnboardingSuggestion(
  role: UiRole,
  input: { segment: string; answers: OnboardingAnswerInput[]; context?: Record<string, unknown> },
  fetcher: Fetcher = fetch
) {
  return readJson<OnboardingSuggestionResult>(fetcher, "/api/ai/onboarding/suggestions", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      segment: input.segment,
      answers: input.answers.map((answer) => ({
        question: answer.question,
        answer: answer.answer,
        input_mode: answer.inputMode
      })),
      context: input.context ?? {}
    })
  });
}

export async function generateAiDraft(
  role: UiRole,
  input: {
    type: AiDraftType;
    inputMode?: "text" | "audio" | "pdf" | "mixed";
    input: string;
    context?: Record<string, unknown>;
    attachments?: AiDraftAttachmentInput[];
  },
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ draft: AiGeneratedDraft }>(fetcher, "/api/ai/drafts", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      type: input.type,
      input_mode: input.inputMode ?? "text",
      input: input.input,
      context: input.context ?? {},
      attachments: (input.attachments ?? []).map((attachment) => ({
        name: attachment.name,
        mime_type: attachment.mimeType,
        content_base64: attachment.contentBase64
      }))
    })
  });

  return result.draft;
}

export async function transcribeAudioBlob(
  role: UiRole,
  input: {
    source?: AiTranscriptionSource;
    audio: Blob;
    language?: string | null;
    keyterms?: string[];
  },
  fetcher: Fetcher = fetch
): Promise<AiTranscript> {
  const result = await readJson<{
    transcript: {
      text: string;
      confidence: number | null;
      duration_seconds: number | null;
      words?: AiTranscript["words"];
    };
  }>(fetcher, "/api/ai/transcriptions", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      source: input.source ?? "onboarding",
      audio_base64: await blobToBase64(input.audio),
      mime_type: input.audio.type || "audio/webm",
      language: input.language ?? "pt-BR",
      keyterms: input.keyterms ?? []
    })
  });

  return {
    text: result.transcript.text,
    confidence: result.transcript.confidence,
    durationSeconds: result.transcript.duration_seconds,
    words: result.transcript.words
  };
}

export async function blobToBase64(blob: Blob) {
  if (typeof blob.arrayBuffer !== "function") {
    const dataUrl = await readBlobAsDataUrl(blob);
    return dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("BLOB_READ_FAILED"));
    reader.readAsDataURL(blob);
  });
}

export async function saveOnboardingSuggestionWorkspace(
  role: UiRole,
  suggestion: OnboardingSuggestion,
  fetcher: Fetcher = fetch
) {
  const result = await readJson<{ setup: OnboardingSetupResult }>(fetcher, "/api/onboarding/setup", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify(onboardingSuggestionToSetupPlan(suggestion))
  });

  return result.setup;
}

export function onboardingSuggestionToSetupPlan(suggestion: OnboardingSuggestion) {
  return {
    segment: suggestion.segment,
    areas: suggestion.areas.map((area) => ({
      name: area.name,
      description: area.description
    })),
    roles: suggestion.roles.map((role) => ({
      area_name: role.areaName,
      name: role.name,
      description: role.description
    })),
    people: suggestion.people.map((person) => ({
      name: person.name,
      email: person.email,
      role: person.role,
      area_name: person.areaName,
      role_name: person.roleName
    })),
    processes: suggestion.processes.map((process) => ({
      title: process.title,
      summary: process.summary,
      body: process.body,
      objective: process.objective,
      trigger: process.trigger,
      operational_rule: process.operationalRule,
      steps: process.steps?.map((step) => ({
        title: step.title,
        instruction: step.instruction,
        expected_result: step.expectedResult,
        attention_points: step.attentionPoints
      })),
      area_name: process.areaName
    })),
    routines: suggestion.routines.map((routine) => ({
      title: routine.title,
      area_name: routine.areaName,
      task_titles: routine.taskTitles
    })),
    trainings: suggestion.trainings.map((training) => ({
      title: training.title,
      description: training.description,
      material_body: training.materialBody,
      quiz_prompt: training.quizPrompt
    })),
    announcement: suggestion.announcement
      ? {
          title: suggestion.announcement.title,
          body: suggestion.announcement.body
        }
      : null
  };
}

export function createStarterSetupPlan(segment: string) {
  const isMarketing = segment === "Agência de marketing";
  const areas = isMarketing
    ? [
        { name: "Atendimento", description: "Entrada, relacionamento e ritmo dos clientes." },
        { name: "Criação", description: "Produção, revisão e entrega de peças." },
        { name: "Mídia", description: "Gestão de campanhas, métricas e otimizações." },
        { name: "Operações", description: "Organização interna, rotinas e cadência da equipe." }
      ]
    : [
        { name: "Atendimento", description: "Entrada, relacionamento e acompanhamento do cliente." },
        { name: "Operação", description: "Execução principal da entrega da empresa." },
        { name: "Administrativo", description: "Financeiro, contratos e organização interna." },
        { name: "Gestão", description: "Prioridades, indicadores e acompanhamento do time." }
      ];

  const atendimentoArea = areas[0]!;
  const execucaoArea = areas[1]!;
  const gestaoArea = areas[3]!;

  return {
    segment,
    areas,
    roles: [
      { area_name: atendimentoArea.name, name: "Gestor de atendimento", description: "Mantém cadência, comunicação e aprovações em dia." },
      { area_name: execucaoArea.name, name: isMarketing ? "Designer" : "Executor operacional", description: "Executa entregas seguindo processos publicados." },
      { area_name: execucaoArea.name, name: isMarketing ? "Social media" : "Analista operacional", description: "Registra evidências e sinaliza gargalos cedo." },
      { area_name: gestaoArea.name, name: "Gestor operacional", description: "Acompanha rotinas, atrasos e padrões da equipe." }
    ],
    people: [
      { name: "Marina Alves", email: "marina@empresa.com", role: "manager", area_name: gestaoArea.name, role_name: "Gestor operacional" },
      { name: "Bruno Costa", email: "bruno@empresa.com", role: "employee", area_name: execucaoArea.name, role_name: isMarketing ? "Designer" : "Executor operacional" },
      { name: "Carla Dias", email: "carla@empresa.com", role: "employee", area_name: execucaoArea.name, role_name: isMarketing ? "Social media" : "Analista operacional" },
      { name: "Elisa Rocha", email: "elisa@empresa.com", role: "employee", area_name: atendimentoArea.name, role_name: "Gestor de atendimento" }
    ],
    processes: [
      {
        title: "Onboarding de cliente novo",
        summary: "Como iniciar uma entrega sem depender da memória do dono.",
        body: "1. Registrar fechamento.\n2. Coletar acessos e materiais.\n3. Criar pasta e espaço de acompanhamento.\n4. Fazer kickoff interno.\n5. Publicar próximos passos para o cliente.",
        area_name: atendimentoArea.name
      },
      {
        title: "Entrega com revisão interna",
        summary: "Fluxo padrão para executar, revisar e enviar com evidência.",
        body: "1. Ler briefing aprovado.\n2. Executar a entrega.\n3. Anexar evidência.\n4. Pedir revisão do gestor quando necessário.\n5. Registrar ajuste ou conclusão.",
        area_name: execucaoArea.name
      }
    ],
    routines: [
      {
        title: "Abertura do dia",
        area_name: gestaoArea.name,
        task_titles: ["Conferir prioridades", "Registrar pendências", "Atualizar status da equipe"]
      },
      {
        title: "Fechamento de entregas",
        area_name: execucaoArea.name,
        task_titles: ["Anexar evidências", "Marcar tarefas concluídas", "Sinalizar bloqueios"]
      }
    ],
    trainings: [
      {
        title: "Padrão de execução da área",
        description: "Aula curta criada a partir do onboarding inicial.",
        material_body: "Use sempre o processo publicado, conclua a rotina do dia e registre foto ou comentário quando a tarefa pedir evidência.",
        quiz_prompt: "Qual é o comportamento esperado ao finalizar uma entrega?"
      },
      {
        title: "Como registrar evidências",
        description: "Treinamento rápido para deixar a operação auditável.",
        material_body: "Uma boa evidência mostra o que foi feito, quando foi feito e qual foi o próximo passo combinado.",
        quiz_prompt: "O que uma evidência precisa deixar claro?"
      }
    ]
  };
}
