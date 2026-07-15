import type { StudioStructureKind as SharedStudioStructureKind } from "@prymeira/baase-shared";

export type StudioCaptureMode = "text" | "audio" | "file" | "image" | "link" | "mixed";
export type StudioDocumentStatus = "active" | "archived" | "trashed";
export type StudioAssetKind = "audio" | "image" | "file" | "link_snapshot";
export type StudioAssetExtractionStatus = "pending" | "processing" | "ready" | "failed";
export type StudioStructureKind = SharedStudioStructureKind;
export type StudioStructureLifecycleStatus = "active" | "archived";

export type StudioGoalMetric = {
  label: string;
  target: number;
  unit?: string;
  baseline?: number;
  current?: number;
  direction?: "increase" | "decrease";
};

export type StudioRitualCadence = {
  frequency: "daily" | "weekly" | "monthly";
  local_time: string;
  timezone: string;
  weekdays?: number[];
  month_day?: number;
};

export type StudioDocument = {
  id: string;
  workspaceId: string;
  ownerProfileId: string;
  captureKey: string | null;
  title: string | null;
  bodyJson: Record<string, unknown>;
  bodyText: string;
  revision: number;
  captureMode: StudioCaptureMode;
  inboxState: "pending_review" | "reviewed";
  isFocused: boolean;
  status: StudioDocumentStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  trashedAt?: string | null;
  preTrashStatus?: Exclude<StudioDocumentStatus, "trashed"> | null;
};

export type StudioDocumentVersion = {
  id: string;
  workspaceId: string;
  ownerProfileId: string;
  documentId: string;
  versionNumber: number;
  bodyJson: Record<string, unknown>;
  bodyText: string;
  origin: "user" | "import" | "accepted_ai_suggestion";
  actorProfileId: string;
  aiRunId: string | null;
  createdAt: string;
  title?: string | null;
  checkpointReason?: string;
  sourceRevision?: number | null;
  isLegacy?: boolean;
};

export type StudioStructure = {
  id: string;
  workspaceId: string;
  ownerProfileId: string;
  documentId: string;
  documentTitle?: string | null;
  kind: StudioStructureKind;
  lifecycleStatus: StudioStructureLifecycleStatus;
  revision: number;
  horizonAt: string | null;
  metricJson: StudioGoalMetric | null;
  cadenceJson: StudioRitualCadence | null;
  nextRunAt: string | null;
  propertiesJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type StudioRitualSessionStatus = "preparing" | "ready" | "in_progress" | "completed" | "failed";

export type StudioRitualSession = {
  id: string;
  workspaceId: string;
  ownerProfileId: string;
  ritualId: string;
  status: StudioRitualSessionStatus;
  revision: number;
  contextJson: Record<string, unknown> | null;
  preparationJson: Record<string, unknown> | null;
  answersJson: Record<string, string>;
  synthesisJson: Record<string, unknown> | null;
  prepareAiRunId: string | null;
  synthesisAiRunId: string | null;
  synthesisToken: string | null;
  synthesisLeaseExpiresAt: string | null;
  synthesisFailureCode: string | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type StudioCollection = {
  id: string;
  workspaceId: string;
  ownerProfileId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type StudioSearchCollection = Pick<StudioCollection, "id" | "name">;

export type StudioSearchResult = {
  documentId: string;
  title: string | null;
  excerpt: string;
  updatedAt: string;
  collections: StudioSearchCollection[];
  structures?: Array<"goal" | "decision" | "plan" | "ritual">;
};

export type StudioNextRitual = {
  id: string;
  title: string;
  scheduledFor: string;
  timezone: string;
};

export type StudioHome = {
  recentDocuments: StudioDocument[];
  focusedDocuments: StudioDocument[];
  pendingReviewCount: number;
  nextRituals: StudioNextRitual[];
};

export type StudioProactivitySettings = {
  ritualReminder: boolean;
  staleGoal: boolean;
  recurringTheme: boolean;
  decisionReview: boolean;
  operationalChange: boolean;
  focusedContent: boolean;
  staleGoalAfterDays: number;
  updatedAt: string;
};

export type StudioProactiveSignal = {
  id: string;
  type: "ritual_reminder" | "stale_goal" | "recurring_theme" | "decision_review" | "operational_change" | "focused_content";
  sourceId: string;
  sourceScheduledFor: string;
  title: string;
  reason: string;
  status: "active" | "dismissed";
  nextReminderAt: string;
  createdAt: string;
  updatedAt: string;
  dismissedAt: string | null;
};

export type StudioDocumentPage = {
  items: StudioDocument[];
  nextCursor: string | null;
  collectionsByDocumentId: Record<string, StudioCollection[]>;
};

export type StudioAsset = {
  id: string;
  workspaceId: string;
  ownerProfileId: string;
  documentId: string;
  idempotencyKey: string | null;
  kind: StudioAssetKind;
  displayName: string;
  sourceUrl: string | null;
  finalUrl: string | null;
  mimeType: string | null;
  sizeBytes: number;
  extractionStatus: StudioAssetExtractionStatus;
  extractedText: string | null;
  lastErrorCode: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StudioCitation = {
  sourceType: "studio_document" | "studio_asset" | "operational_resource" | "operational_metric" | "external_url";
  sourceId: string | null;
  url: string | null;
  label: string;
  excerpt: string;
  observedAt: string;
  periodFrom: string | null;
  periodTo: string | null;
  metadata: Record<string, unknown>;
};

export type StudioInternalCitationTarget = {
  kind: "dashboard" | "task" | "routine" | "process" | "training" | "announcement" | "person" | "studio_document";
  resourceId: string | null;
};

export type StudioSuggestionProposal = {
  documentId: string;
  expectedRevision: number;
  title: string | null;
  bodyJson: Record<string, unknown>;
  bodyText: string;
};

export type StudioSuggestion = {
  id: string;
  documentId: string | null;
  conversationId: string | null;
  aiRunId: string;
  kind: "text";
  payload: {
    facts: Array<{ statement: string; citationIndexes: number[] }>;
    inferences: Array<{ statement: string; basis: string; confidence: "low" | "medium" | "high" }>;
    gaps: Array<{ question: string; reason: string }>;
    citations: StudioCitation[];
    proposal: StudioSuggestionProposal;
  };
  status: "pending" | "accepted" | "dismissed" | "expired";
  acceptedVersionId: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type StudioRelatedThought = {
  document: StudioDocument;
  excerpt: string;
  explanation: string;
  score: number;
};

export type StudioApprovalMode = "direct" | "approval_required";
export type StudioEvidencePolicy = "optional" | "photo_required" | "comment_required" | "photo_or_comment_required";
export type StudioOperationDraft =
  | { resource_type: "task"; payload: {
    title: string; area_id: string | null; assignee_profile_id: string | null; due_date: string;
    due_hint: string | null; approval_mode: StudioApprovalMode; evidence_policy: StudioEvidencePolicy;
    checklist_items: string[];
  } }
  | { resource_type: "routine"; payload: {
    title: string; area_id: string | null; frequency: "daily" | "weekly" | "monthly" | "on_demand";
    weekdays: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">; due_hint: string | null;
    assignee_profile_ids: string[]; execution_mode: "shared" | "individual"; approval_mode: StudioApprovalMode;
    evidence_policy: StudioEvidencePolicy; task_templates: Array<{
      title: string; process_id: string | null; assignee_profile_id: string | null; due_hint: string | null;
      approval_mode: StudioApprovalMode; evidence_policy: StudioEvidencePolicy;
    }>;
  } }
  | { resource_type: "process"; payload: {
    title: string; body: string; area_id: string | null; summary: string | null;
    owner: { type: "person"; person_id: string } | { type: "role"; role_template_id: string } | null;
  } }
  | { resource_type: "announcement"; payload: {
    title: string; body: string; type: "simple" | "process_change" | "mandatory_training";
    requirement: "none" | "read_confirmation" | "quiz_confirmation";
    audience: { type: "all" } | { type: "area"; area_id: string } | { type: "role"; role_template_id: string }
      | { type: "person"; profile_id: string };
    related_process_id: string | null; related_training_id: string | null; quiz_questions: Array<{
      prompt: string; options: Array<{ id: string; label: string }>; correct_option_id: string;
      explanation: string | null;
    }>;
  } };

export type StudioOperationPreview = {
  id: string;
  sourceSuggestionId: string;
  sourceDocumentId: string;
  resourceType: StudioOperationDraft["resource_type"];
  payload: StudioOperationDraft;
  confirmedPayload: StudioOperationDraft | null;
  status: "preview" | "confirming" | "confirmed" | "expired";
  expiresAt: string;
  idempotencyKey: string | null;
  resultResourceId: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
};

export type StudioOperationalLink = {
  id: string;
  previewId: string;
  sourceSuggestionId: string;
  sourceDocumentId: string;
  sourceStructureId: string | null;
  resourceType: StudioOperationDraft["resource_type"];
  resourceId: string;
  relationType: "created";
  createdByProfileId: string;
  createdAt: string;
};

/** Wire contracts stay separate so API casing never leaks into the view model. */
export type RawStudioDocument = {
  id: string;
  workspace_id?: string;
  workspaceId?: string;
  owner_profile_id?: string;
  ownerProfileId?: string;
  capture_key?: string | null;
  captureKey?: string | null;
  title: string | null;
  body_json?: Record<string, unknown>;
  bodyJson?: Record<string, unknown>;
  body_text?: string;
  bodyText?: string;
  revision: number;
  capture_mode?: StudioCaptureMode;
  captureMode?: StudioCaptureMode;
  inbox_state?: "pending_review" | "reviewed";
  inboxState?: "pending_review" | "reviewed";
  is_focused?: boolean;
  isFocused?: boolean;
  status: StudioDocumentStatus;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  archived_at?: string | null;
  archivedAt?: string | null;
  trashed_at?: string | null;
  trashedAt?: string | null;
  pre_trash_status?: Exclude<StudioDocumentStatus, "trashed"> | null;
  preTrashStatus?: Exclude<StudioDocumentStatus, "trashed"> | null;
};

export type RawStudioDocumentVersion = {
  id: string;
  workspace_id?: string;
  workspaceId?: string;
  owner_profile_id?: string;
  ownerProfileId?: string;
  document_id?: string;
  documentId?: string;
  version_number?: number;
  versionNumber?: number;
  body_json?: Record<string, unknown>;
  bodyJson?: Record<string, unknown>;
  body_text?: string;
  bodyText?: string;
  origin: StudioDocumentVersion["origin"];
  actor_profile_id?: string;
  actorProfileId?: string;
  ai_run_id?: string | null;
  aiRunId?: string | null;
  created_at?: string;
  createdAt?: string;
  title?: string | null;
  checkpoint_reason?: string;
  checkpointReason?: string;
  source_revision?: number | null;
  sourceRevision?: number | null;
  is_legacy?: boolean;
  isLegacy?: boolean;
};

export type RawStudioStructure = {
  id: string;
  workspace_id?: string;
  workspaceId?: string;
  owner_profile_id?: string;
  ownerProfileId?: string;
  document_id?: string;
  documentId?: string;
  document_title?: string | null;
  documentTitle?: string | null;
  kind: StudioStructureKind;
  lifecycle_status?: StudioStructureLifecycleStatus;
  lifecycleStatus?: StudioStructureLifecycleStatus;
  revision: number;
  horizon_at?: string | null;
  horizonAt?: string | null;
  metric_json?: StudioGoalMetric | null;
  metricJson?: StudioGoalMetric | null;
  cadence_json?: StudioRitualCadence | null;
  cadenceJson?: StudioRitualCadence | null;
  next_run_at?: string | null;
  nextRunAt?: string | null;
  properties_json?: Record<string, unknown>;
  propertiesJson?: Record<string, unknown>;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  archived_at?: string | null;
  archivedAt?: string | null;
};

export type RawStudioRitualSession = {
  id: string;
  workspace_id?: string;
  workspaceId?: string;
  owner_profile_id?: string;
  ownerProfileId?: string;
  ritual_id?: string;
  ritualId?: string;
  status: StudioRitualSessionStatus;
  revision: number;
  context_json?: Record<string, unknown> | null;
  contextJson?: Record<string, unknown> | null;
  preparation_json?: Record<string, unknown> | null;
  preparationJson?: Record<string, unknown> | null;
  answers_json?: Record<string, string>;
  answersJson?: Record<string, string>;
  synthesis_json?: Record<string, unknown> | null;
  synthesisJson?: Record<string, unknown> | null;
  prepare_ai_run_id?: string | null;
  prepareAiRunId?: string | null;
  synthesis_ai_run_id?: string | null;
  synthesisAiRunId?: string | null;
  synthesis_token?: string | null;
  synthesisToken?: string | null;
  synthesis_lease_expires_at?: string | null;
  synthesisLeaseExpiresAt?: string | null;
  synthesis_failure_code?: string | null;
  synthesisFailureCode?: string | null;
  failure_code?: string | null;
  failureCode?: string | null;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  completed_at?: string | null;
  completedAt?: string | null;
};

export type RawStudioCollection = {
  id: string;
  workspace_id?: string;
  workspaceId?: string;
  owner_profile_id?: string;
  ownerProfileId?: string;
  name: string;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
};

export type RawStudioSearchResult = {
  document_id?: string;
  documentId?: string;
  title: string | null;
  excerpt: string;
  updated_at?: string;
  updatedAt?: string;
  collections: StudioSearchCollection[];
  structures?: Array<"goal" | "decision" | "plan" | "ritual">;
};

export type RawStudioNextRitual = {
  id: string;
  title: string;
  timezone: string;
  scheduled_for?: string;
  scheduledFor?: string;
};

export type RawStudioHome = {
  recent_documents?: RawStudioDocument[];
  recentDocuments?: RawStudioDocument[];
  focused_documents?: RawStudioDocument[];
  focusedDocuments?: RawStudioDocument[];
  pending_review_count?: number;
  pendingReviewCount?: number;
  next_rituals?: RawStudioNextRitual[];
  nextRituals?: RawStudioNextRitual[];
};

export type RawStudioHomeResponse = { home: RawStudioHome };
export type RawStudioDocumentResponse = { document: RawStudioDocument };
export type RawStudioDocumentPageResponse = {
  documents: RawStudioDocument[];
  next_cursor?: string | null;
  nextCursor?: string | null;
  collections_by_document_id?: Record<string, RawStudioCollection[]>;
  collectionsByDocumentId?: Record<string, RawStudioCollection[]>;
};
export type RawStudioCollectionsResponse = { collections: RawStudioCollection[] };
export type RawStudioSearchResponse = { results: RawStudioSearchResult[] };
export type RawStudioVersionsResponse = { versions: RawStudioDocumentVersion[] };
export type RawStudioStructureResponse = { structure: RawStudioStructure };
export type RawStudioStructuresResponse = {
  structures: RawStudioStructure[];
  next_cursor?: string | null;
  nextCursor?: string | null;
};
export type RawStudioRitualSessionResponse = { session: RawStudioRitualSession };
export type RawStudioRitualSessionsResponse = {
  sessions: RawStudioRitualSession[];
  next_cursor?: string | null;
  nextCursor?: string | null;
};

export type RawStudioAsset = {
  id: string;
  workspace_id?: string;
  workspaceId?: string;
  owner_profile_id?: string;
  ownerProfileId?: string;
  document_id?: string;
  documentId?: string;
  idempotency_key?: string | null;
  idempotencyKey?: string | null;
  kind: StudioAssetKind;
  display_name?: string;
  displayName?: string;
  source_url?: string | null;
  sourceUrl?: string | null;
  final_url?: string | null;
  finalUrl?: string | null;
  mime_type?: string | null;
  mimeType?: string | null;
  size_bytes?: number;
  sizeBytes?: number;
  extraction_status?: StudioAssetExtractionStatus;
  extractionStatus?: StudioAssetExtractionStatus;
  extracted_text?: string | null;
  extractedText?: string | null;
  last_error_code?: string | null;
  lastErrorCode?: string | null;
  attempt_count?: number;
  attemptCount?: number;
  next_attempt_at?: string | null;
  nextAttemptAt?: string | null;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
};

export type RawStudioAssetResponse = { asset: RawStudioAsset };
