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

export type OnboardingSource = "user_provided" | "inferred" | "template" | "placeholder";

export type OnboardingAnswer = {
  questionId: "operations_overview" | "people_responsibilities" | "bottlenecks_standards" | string;
  theme: "business_model" | "team_structure" | "operational_bottlenecks" | "followup" | string;
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

export type OnboardingDiagnosis = {
  companyName: string;
  normalizedSegment: string;
  confidence: "low" | "medium" | "high";
  operationalSummary: string;
  businessModel: string | null;
  customerProfile: string | null;
  deliveryModel: string | null;
  detectedAreas: Array<{
    id: string;
    name: string;
    description: string;
    source: Exclude<OnboardingSource, "placeholder">;
    reason: string;
  }>;
  detectedPeople: Array<{
    id: string;
    name: string;
    roleHint: string | null;
    areaName: string | null;
    source: "user_provided" | "inferred" | "placeholder";
  }>;
  bottlenecks: Array<{
    id: string;
    title: string;
    description: string;
    severity: "low" | "medium" | "high";
    source: "user_provided" | "inferred";
  }>;
  assumptions: string[];
  followupQuestions: OnboardingFollowupQuestion[];
};

export type OnboardingFollowupQuestion = {
  id: string;
  question: string;
  reason: string;
  expectedUse: "areas" | "people" | "processes" | "routines" | "trainings" | "approval_evidence";
  priority: number;
};

export type OnboardingSuggestionMetadata = {
  reason: string;
  basedOn: string[];
  expectedImpact: string;
  source: OnboardingSource;
  reviewDefault: "create" | "draft" | "publish" | "activate";
};

export type OnboardingSetupSuggestion = {
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
    role: "owner" | "manager" | "employee";
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
  activationPlan: OnboardingActivationStep[];
};

export type OnboardingReviewDecision = {
  itemType: "area" | "role" | "person" | "process" | "routine" | "training" | "announcement" | "invite";
  itemId: string;
  action: "create" | "remove" | "draft" | "publish" | "activate";
  editedPayload: Record<string, unknown> | null;
};

export type OnboardingActivationStep = {
  day: number;
  title: string;
  objective: string;
  action:
    | "open_company_map"
    | "review_processes"
    | "activate_routine"
    | "publish_training"
    | "invite_team"
    | "review_today"
    | "review_dashboard";
};

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
  generatedSuggestion: OnboardingSetupSuggestion | null;
  reviewDecisions: OnboardingReviewDecision[];
  activationPlan: OnboardingActivationStep[];
  createdSetupSummary: OnboardingCreatedSetupSummary | null;
  aiRunIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CreateOnboardingSessionInput = Omit<OnboardingSession, "id" | "createdAt" | "updatedAt" | "completedAt">;

export type OnboardingRepository = {
  getCurrentSession(workspaceId: string): Promise<OnboardingSession | null>;
  findSession(workspaceId: string, sessionId: string): Promise<OnboardingSession | null>;
  createSession(input: CreateOnboardingSessionInput): Promise<OnboardingSession>;
  updateSession(session: OnboardingSession): Promise<OnboardingSession>;
  claimCompletion(workspaceId: string, sessionId: string): Promise<OnboardingSession | null>;
};
