export type StudioCaptureMode = "text" | "audio" | "file" | "image" | "link" | "mixed";
export type StudioDocumentStatus = "active" | "archived";
export type StudioAssetKind = "audio" | "image" | "file" | "link_snapshot";
export type StudioAssetExtractionStatus = "pending" | "processing" | "ready" | "failed";

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
};

export type StudioHome = {
  recentDocuments: StudioDocument[];
  focusedDocuments: StudioDocument[];
  pendingReviewCount: number;
  nextRituals: StudioNextRitual[];
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
