import type { StudioStructureKind as SharedStudioStructureKind } from "@prymeira/baase-shared";

export type StudioOwnerScope = { workspaceId: string; ownerProfileId: string };
export type StudioCaptureMode = "text" | "audio" | "file" | "image" | "link" | "mixed";
export type StudioDocumentStatus = "active" | "archived" | "trashed";
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
export type StudioSuggestionStatus = "pending" | "accepted" | "dismissed" | "expired";
export type StudioMessageRole = "user" | "assistant";
export type StudioMessageStatus = "complete";
export type StudioCitationSourceType =
  | "studio_document"
  | "studio_asset"
  | "operational_resource"
  | "operational_metric"
  | "external_url";
export type StudioOperationalResourceType =
  | "dashboard"
  | "task"
  | "routine"
  | "process"
  | "training"
  | "announcement"
  | "people";
export type StudioContextFactKind = "direct" | "inferred";
export type StudioRelationType = "related_to" | "supports" | "contradicts" | "originated" | "informs" | "supersedes";
export type StudioIndexJobStatus = "pending" | "processing" | "failed" | "completed";
export type StudioDocumentIndexState = {
  status: "pending" | "processing" | "ready" | "failed" | "stale" | "unavailable";
  code: string | null;
  indexedVersionId: string | null;
};
export type StudioAssetKind = "audio" | "image" | "file" | "link_snapshot";
export type StudioAssetExtractionStatus = "pending" | "processing" | "ready" | "failed";
export type StudioAssetLifecycleStatus = "active" | "deleting";
export type StudioAssetCleanupStatus = "pending" | "processing" | "failed";
export type StudioAssetUploadIntentStatus = "uploading" | "cleanup_pending" | "processing" | "failed";
export type StudioAssetStorageSessionState = "creating" | "active" | "abort_pending";
export const STUDIO_ASSET_MAX_ATTEMPTS = 5;

export type StudioContextRequest = {
  from: string | null;
  to: string | null;
  resourceTypes: StudioOperationalResourceType[];
  personIds: string[];
};

export type StudioContextFact = {
  key: string;
  value: unknown;
  citationIndex: number;
  kind: StudioContextFactKind;
  resourceType: StudioOperationalResourceType;
};

/**
 * Owner-scoped citation draft. Task 16 persists these in the same transaction
 * as the assistant message or suggestion that references them.
 */
export type StudioCitationInput = StudioOwnerScope & {
  sourceType: "operational_resource" | "operational_metric";
  sourceId: string;
  url: null;
  label: string;
  excerpt: string;
  observedAt: string;
  periodFrom: string;
  periodTo: string;
  metadata: {
    resourceType: StudioOperationalResourceType;
    personIds: string[];
    contentTrust: "untrusted_data";
  };
};

export type StudioContextSnapshot = {
  period: { from: string; to: string };
  facts: StudioContextFact[];
  citations: StudioCitationInput[];
  serializedBytes: number;
  truncated: boolean;
};

export type StudioConversation = StudioOwnerScope & {
  id: string;
  documentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StudioMessage = StudioOwnerScope & {
  id: string;
  conversationId: string;
  role: StudioMessageRole;
  content: string;
  aiRunId: string | null;
  status: StudioMessageStatus;
  createdAt: string;
};

export type StudioSuggestion = StudioOwnerScope & {
  id: string;
  documentId: string | null;
  conversationId: string | null;
  aiRunId: string;
  kind: "text";
  payloadJson: StudioTextSuggestionPayload;
  status: StudioSuggestionStatus;
  acceptedVersionId: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type StudioStructuredCitation = {
  source_type: StudioCitationSourceType;
  source_id: string | null;
  url: string | null;
  label: string;
  excerpt: string;
  observed_at: string;
  period_from: string | null;
  period_to: string | null;
};

export type StudioTextSuggestionProposal = {
  document_id: string;
  expected_revision: number;
  title: string | null;
  body_json: Record<string, unknown>;
  body_text: string;
};

export type StudioTextSuggestionPayload = {
  facts: Array<{ statement: string; citation_indexes: number[] }>;
  inferences: Array<{ statement: string; basis: string; confidence: "low" | "medium" | "high" }>;
  gaps: Array<{ question: string; reason: string }>;
  citations: StudioStructuredCitation[];
  proposal: StudioTextSuggestionProposal;
};

export type StudioCitation = StudioOwnerScope & {
  id: string;
  messageId: string | null;
  suggestionId: string | null;
  sourceType: StudioCitationSourceType;
  sourceId: string | null;
  url: string | null;
  label: string;
  excerpt: string;
  observedAt: string;
  periodFrom: string | null;
  periodTo: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreateStudioCitation = Omit<StudioCitation, "id" | "createdAt" | "messageId" | "suggestionId">;

export type StudioSuggestionDecision = {
  suggestion: StudioSuggestion;
  version: StudioDocumentVersion | null;
};

export type CreateStudioDocument = {
  title: string | null;
  body_json: Record<string, unknown>;
  body_text: string;
  capture_mode: StudioCaptureMode;
};

export type UpdateStudioDocument = {
  revision: number;
  title?: string | null;
  body_json?: Record<string, unknown>;
  body_text?: string;
  capture_mode?: StudioCaptureMode;
  inbox_state?: "pending_review" | "reviewed";
  is_focused?: boolean;
};

export type StudioDocumentQuery = {
  cursor?: string;
  limit: number;
  status?: StudioDocumentStatus;
  inboxState?: "pending_review" | "reviewed";
  collectionId?: string;
};

export type StudioDocument = StudioOwnerScope & {
  id: string;
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

export type StudioTrashCleanupClaim = StudioDocument & {
  claimToken: string;
  leaseExpiresAt: string;
};

export type StudioDocumentVersion = StudioOwnerScope & {
  id: string;
  documentId: string;
  versionNumber: number;
  bodyJson: Record<string, unknown>;
  bodyText: string;
  origin: "user" | "import" | "accepted_ai_suggestion";
  actorProfileId: string;
  aiRunId: string | null;
  createdAt: string;
  title?: string | null;
  checkpointReason?: StudioCheckpointReason | "legacy_autosave";
  checkpointKey?: string | null;
  sourceRevision?: number | null;
  isLegacy?: boolean;
};

export type StudioCheckpointReason =
  | "significant_pause" | "document_exit" | "structure_changed"
  | "accepted_ai_suggestion" | "transcript_inserted" | "restored" | "manual";

export type StudioVersionQuery = { cursor?: string; limit: number };
export type StudioVersionPage = { items: StudioDocumentVersion[]; nextCursor: string | null };
export type CreateStudioCheckpoint = { expected_revision: number; reason: StudioCheckpointReason; checkpoint_key?: string };
export type StudioCheckpointResult = { version: StudioDocumentVersion; inserted: boolean };
export type CreateStudioExitCheckpoint = { known_revision: number };
export type StudioExitCheckpointResult = { document: StudioDocument; version: StudioDocumentVersion };

export type StudioStructure = StudioOwnerScope & {
  id: string;
  documentId: string;
  /** Present on list projections; null means the source document is intentionally untitled. */
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

export type CreateStudioStructure = {
  kind: StudioStructureKind;
  horizon_at?: string | null;
  metric_json?: StudioGoalMetric | null;
  cadence_json?: StudioRitualCadence | null;
  properties_json: Record<string, unknown>;
};

export type UpdateStudioStructure = {
  expected_revision: number;
  horizon_at?: string | null;
  metric_json?: StudioGoalMetric | null;
  cadence_json?: StudioRitualCadence | null;
  properties_json?: Record<string, unknown>;
};

export type StudioStructureQuery = {
  kind?: StudioStructureKind;
  lifecycleStatus?: StudioStructureLifecycleStatus;
  documentId?: string;
  cursor?: string;
  limit: number;
};

export type StudioStructurePage = { items: StudioStructure[]; nextCursor: string | null };

export type StudioRitualSessionStatus = "preparing" | "ready" | "in_progress" | "completed" | "failed";

export type StudioRitualSession = StudioOwnerScope & {
  id: string;
  ritualId: string;
  status: StudioRitualSessionStatus;
  revision: number;
  contextJson: Record<string, unknown> | null;
  preparationJson: Record<string, unknown> | null;
  answersJson: Record<string, string>;
  synthesisJson: Record<string, unknown> | null;
  prepareAiRunId: string | null;
  synthesisAiRunId: string | null;
  preparationToken: string | null;
  preparationLeaseExpiresAt: string | null;
  synthesisToken: string | null;
  synthesisLeaseExpiresAt: string | null;
  synthesisFailureCode: string | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type StudioRitualSessionQuery = { cursor?: string; limit: number };
export type StudioRitualSessionPage = { items: StudioRitualSession[]; nextCursor: string | null };

export type StudioRelation = StudioOwnerScope & {
  id: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  relationType: StudioRelationType;
  createdByProfileId: string;
  createdAt: string;
};

export type StudioIndexJob = StudioOwnerScope & {
  id: string;
  documentId: string;
  snapshotId: string;
  documentRevision: number;
  status: StudioIndexJobStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  claimToken: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StudioDocumentPage = {
  items: StudioDocument[];
  nextCursor: string | null;
  collectionsByDocumentId: Record<string, StudioCollection[]>;
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

export type StudioCollection = StudioOwnerScope & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateStudioCollection = {
  name: string;
};

export type UpdateStudioCollection = {
  name: string;
};

export type StudioCollectionMembership = StudioOwnerScope & {
  id: string;
  collectionId: string;
  documentId: string;
  createdAt: string;
};

export type StudioAsset = StudioOwnerScope & {
  id: string;
  documentId: string;
  idempotencyKey: string | null;
  kind: StudioAssetKind;
  displayName: string;
  objectKey: string | null;
  sourceUrl: string | null;
  finalUrl: string | null;
  fetchedAt: string | null;
  mimeType: string | null;
  sizeBytes: number;
  extractionStatus: StudioAssetExtractionStatus;
  extractedText: string | null;
  extractionMetadata: Record<string, unknown>;
  lastErrorCode: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  claimToken: string | null;
  leaseExpiresAt: string | null;
  lifecycleStatus: StudioAssetLifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export type StudioAssetCleanupJob = StudioOwnerScope & {
  id: string;
  assetId: string | null;
  objectKey: string | null;
  status: StudioAssetCleanupStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  claimToken: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StudioAssetUploadIntent = StudioOwnerScope & {
  id: string;
  documentId: string;
  objectKey: string;
  displayName: string;
  kind: Exclude<StudioAssetKind, "link_snapshot">;
  mimeType: string;
  sizeBytes: number;
  status: StudioAssetUploadIntentStatus;
  assetId: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  uploadToken: string | null;
  uploadLeaseExpiresAt: string | null;
  storageUploadId: string | null;
  storageSessionState: StudioAssetStorageSessionState;
  claimToken: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateStudioAsset = Omit<
  StudioAsset,
  "id" | "createdAt" | "updatedAt" | "idempotencyKey" | "claimToken" | "leaseExpiresAt" | "lifecycleStatus"
> & Partial<Pick<StudioAsset, "idempotencyKey" | "claimToken" | "leaseExpiresAt" | "lifecycleStatus">>;

export type FinishStudioAssetProcessing = {
  scope: StudioOwnerScope;
  assetId: string;
  claimToken: string;
  extractionStatus: "ready" | "failed";
  extractedText: string | null;
  extractionMetadata: Record<string, unknown>;
  lastErrorCode: string | null;
  nextAttemptAt: string | null;
};

export type StudioSearchCollection = Pick<StudioCollection, "id" | "name">;

export type StudioSearchDocument = Pick<
  StudioDocument,
  "id" | "title" | "bodyText" | "updatedAt"
>;

export type StudioLexicalSearchQuery = {
  query: string;
  limit: number;
};

export type StudioSearchResult = {
  documentId: string;
  title: string | null;
  excerpt: string;
  updatedAt: string;
  collections: StudioSearchCollection[];
  structures?: StudioStructureKind[];
};

export type StudioService = {
  readHome(scope: StudioOwnerScope): Promise<StudioHome>;
  listDocuments(scope: StudioOwnerScope, query: StudioDocumentQuery): Promise<StudioDocumentPage>;
  getDocument(scope: StudioOwnerScope, id: string): Promise<StudioDocument>;
  createDocument(
    scope: StudioOwnerScope,
    actorProfileId: string,
    input: CreateStudioDocument,
    captureKey?: string | null
  ): Promise<StudioDocument>;
  updateDocument(scope: StudioOwnerScope, actorProfileId: string, id: string, input: UpdateStudioDocument): Promise<StudioDocument>;
  archiveDocument(scope: StudioOwnerScope, actorProfileId: string, id: string): Promise<StudioDocument>;
  restoreDocument(scope: StudioOwnerScope, actorProfileId: string, id: string): Promise<StudioDocument>;
  trashDocument(scope: StudioOwnerScope, actorProfileId: string, id: string): Promise<StudioDocument>;
  restoreDocumentFromTrash(scope: StudioOwnerScope, actorProfileId: string, id: string): Promise<StudioDocument>;
  permanentlyDeleteDocument(scope: StudioOwnerScope, actorProfileId: string, id: string): Promise<boolean>;
  permanentlyDeleteClaimedDocument(
    scope: StudioOwnerScope,
    actorProfileId: string,
    id: string,
    claimToken: string
  ): Promise<boolean>;
  setFocused(scope: StudioOwnerScope, actorProfileId: string, id: string, focused: boolean): Promise<StudioDocument>;
  listVersions(scope: StudioOwnerScope, id: string): Promise<StudioDocumentVersion[]>;
  listVersionPage(scope: StudioOwnerScope, id: string, query: StudioVersionQuery): Promise<StudioVersionPage>;
  createCheckpoint(scope: StudioOwnerScope, actorProfileId: string, id: string, input: CreateStudioCheckpoint): Promise<StudioDocumentVersion>;
  createExitCheckpoint(scope: StudioOwnerScope, actorProfileId: string, id: string, input: CreateStudioExitCheckpoint): Promise<StudioExitCheckpointResult>;
  restoreVersion(scope: StudioOwnerScope, actorProfileId: string, id: string, versionId: string, input: { expected_revision: number }): Promise<{ document: StudioDocument; version: StudioDocumentVersion }>;
  search(scope: StudioOwnerScope, query: string, limit: number): Promise<StudioSearchResult[]>;
  listCollections(scope: StudioOwnerScope): Promise<StudioCollection[]>;
  createCollection(scope: StudioOwnerScope, actorProfileId: string, input: CreateStudioCollection): Promise<StudioCollection>;
  renameCollection(scope: StudioOwnerScope, actorProfileId: string, id: string, input: UpdateStudioCollection): Promise<StudioCollection>;
  deleteCollection(scope: StudioOwnerScope, actorProfileId: string, id: string): Promise<StudioCollection>;
  listDocumentCollections(scope: StudioOwnerScope, documentId: string): Promise<StudioCollection[]>;
  addDocumentToCollection(scope: StudioOwnerScope, actorProfileId: string, collectionId: string, documentId: string): Promise<StudioCollectionMembership>;
  removeDocumentFromCollection(scope: StudioOwnerScope, actorProfileId: string, collectionId: string, documentId: string): Promise<boolean>;
  relateDocuments(
    scope: StudioOwnerScope,
    actorProfileId: string,
    sourceDocumentId: string,
    targetDocumentId: string,
    relationType: StudioRelationType
  ): Promise<StudioRelation>;
  createStructure(scope: StudioOwnerScope, actorProfileId: string, documentId: string, input: CreateStudioStructure): Promise<StudioStructure>;
  updateStructure(scope: StudioOwnerScope, actorProfileId: string, structureId: string, input: UpdateStudioStructure): Promise<StudioStructure>;
  archiveStructure(scope: StudioOwnerScope, actorProfileId: string, structureId: string): Promise<StudioStructure>;
  listStructures(scope: StudioOwnerScope, query: StudioStructureQuery): Promise<StudioStructurePage>;
};

export type StudioRepository = {
  handlesPermanentDeletionCleanup?: boolean;
  listDocuments(scope: StudioOwnerScope, input: StudioDocumentQuery): Promise<StudioDocumentPage>;
  findDocument(scope: StudioOwnerScope, documentId: string): Promise<StudioDocument | null>;
  createDocument(input: Omit<
    StudioDocument,
    "id" | "revision" | "createdAt" | "updatedAt" | "archivedAt" | "captureKey"
  > & { captureKey?: string | null }): Promise<StudioDocument>;
  updateDocument(input: StudioDocument, expectedRevision: number): Promise<StudioDocument>;
  trashDocument(scope: StudioOwnerScope, documentId: string, trashedAt: string): Promise<StudioDocument>;
  restoreDocumentFromTrash(scope: StudioOwnerScope, documentId: string): Promise<StudioDocument>;
  claimNextExpiredTrash(
    cutoff: string,
    now: string,
    leaseMs?: number,
    excludeOwnerKeys?: readonly string[]
  ): Promise<StudioTrashCleanupClaim | null>;
  permanentlyDeleteDocument(scope: StudioOwnerScope, documentId: string, claimToken?: string): Promise<boolean>;
  permanentlyDeleteDocumentWithCleanup?(
    scope: StudioOwnerScope,
    documentId: string,
    cleanup: (sourceIds: readonly string[]) => Promise<void>,
    claimToken?: string
  ): Promise<boolean>;
  listDocumentStructureIdsIncludingInactive(scope: StudioOwnerScope, documentId: string): Promise<string[]>;
  listVersions(scope: StudioOwnerScope, documentId: string): Promise<StudioDocumentVersion[]>;
  listVersionPage(scope: StudioOwnerScope, documentId: string, query: StudioVersionQuery): Promise<StudioVersionPage>;
  findVersion(scope: StudioOwnerScope, documentId: string, versionId: string): Promise<StudioDocumentVersion | null>;
  createCheckpoint(scope: StudioOwnerScope, documentId: string, actorProfileId: string, input: CreateStudioCheckpoint): Promise<StudioCheckpointResult>;
  createExitCheckpoint(scope: StudioOwnerScope, documentId: string, actorProfileId: string, input: CreateStudioExitCheckpoint): Promise<StudioExitCheckpointResult>;
  restoreDocumentVersion(scope: StudioOwnerScope, documentId: string, versionId: string, actorProfileId: string, expectedRevision: number): Promise<{ document: StudioDocument; version: StudioDocumentVersion }>;
  findStructure(scope: StudioOwnerScope, structureId: string): Promise<StudioStructure | null>;
  createStructure(input: Omit<StudioStructure, "id" | "revision" | "createdAt" | "updatedAt" | "archivedAt">): Promise<StudioStructure>;
  updateStructure(input: StudioStructure, expectedRevision: number): Promise<StudioStructure>;
  listStructures(scope: StudioOwnerScope, query: StudioStructureQuery): Promise<StudioStructurePage>;
  findRitualSession(scope: StudioOwnerScope, sessionId: string): Promise<StudioRitualSession | null>;
  createRitualSession(input: StudioOwnerScope & {
    ritualId: string;
    preparationToken: string | null;
    preparationLeaseExpiresAt: string | null;
    contextJson?: Record<string, unknown>;
  }): Promise<StudioRitualSession>;
  claimNextRitualPreparation(
    now: string,
    leaseMs?: number,
    excludeOwnerKeys?: readonly string[]
  ): Promise<StudioRitualSession | null>;
  updateRitualSession(input: StudioRitualSession, expectedRevision: number): Promise<StudioRitualSession>;
  listRitualSessions(scope: StudioOwnerScope, ritualId: string, query: StudioRitualSessionQuery): Promise<StudioRitualSessionPage>;
  appendVersion(input: Omit<StudioDocumentVersion, "id" | "versionNumber" | "createdAt">): Promise<StudioDocumentVersion>;
  searchDocuments(scope: StudioOwnerScope, input: StudioLexicalSearchQuery): Promise<StudioSearchDocument[]>;
  listRecentDocuments(scope: StudioOwnerScope, limit: number): Promise<StudioDocument[]>;
  listFocusedDocuments(scope: StudioOwnerScope, limit: number): Promise<StudioDocument[]>;
  listNextRituals(scope: StudioOwnerScope, limit: number, scheduledAfter: string): Promise<StudioNextRitual[]>;
  countPendingReviewDocuments(scope: StudioOwnerScope): Promise<number>;
  listCollections(scope: StudioOwnerScope): Promise<StudioCollection[]>;
  findCollection(scope: StudioOwnerScope, collectionId: string): Promise<StudioCollection | null>;
  createCollection(input: StudioOwnerScope & CreateStudioCollection): Promise<StudioCollection>;
  updateCollection(input: StudioCollection): Promise<StudioCollection>;
  deleteCollection(scope: StudioOwnerScope, collectionId: string): Promise<boolean>;
  addCollectionMembership(input: StudioOwnerScope & { collectionId: string; documentId: string }): Promise<StudioCollectionMembership>;
  removeCollectionMembership(scope: StudioOwnerScope, collectionId: string, documentId: string): Promise<boolean>;
  listDocumentCollections(scope: StudioOwnerScope, documentId: string): Promise<StudioCollection[]>;
  listDocumentCollectionsBatch(scope: StudioOwnerScope, documentIds: string[]): Promise<Record<string, StudioCollection[]>>;
  listDocumentAssets(scope: StudioOwnerScope, documentId: string): Promise<StudioAsset[]>;
  findAsset(scope: StudioOwnerScope, assetId: string): Promise<StudioAsset | null>;
  findAssetIncludingDeleting(scope: StudioOwnerScope, assetId: string): Promise<StudioAsset | null>;
  createAsset(input: CreateStudioAsset): Promise<StudioAsset>;
  findAssetByObjectKey(scope: StudioOwnerScope, objectKey: string): Promise<StudioAsset | null>;
  findAssetByIdempotencyKey(
    scope: StudioOwnerScope,
    documentId: string,
    idempotencyKey: string
  ): Promise<StudioAsset | null>;
  createAssetUploadIntent(input: Omit<StudioAssetUploadIntent,
    "id" | "status" | "assetId" | "attemptCount" | "nextAttemptAt" | "lastErrorCode"
    | "uploadToken" | "uploadLeaseExpiresAt" | "storageUploadId" | "storageSessionState"
    | "claimToken" | "leaseExpiresAt" | "createdAt" | "updatedAt"
  > & { uploadLeaseExpiresAt: string }): Promise<StudioAssetUploadIntent>;
  attachAssetUploadSession(input: {
    scope: StudioOwnerScope;
    intentId: string;
    uploadToken: string;
    storageUploadId: string;
  }): Promise<boolean>;
  finalizeAssetUpload(input: {
    scope: StudioOwnerScope;
    intentId: string;
    uploadToken: string;
    asset: CreateStudioAsset;
  }): Promise<StudioAsset>;
  renewAssetUploadIntentLease(input: {
    scope: StudioOwnerScope;
    intentId: string;
    uploadToken: string;
    uploadLeaseExpiresAt: string;
  }): Promise<boolean>;
  reconcileAssetUploadFailure(input: {
    scope: StudioOwnerScope;
    intentId: string;
    uploadToken: string;
    objectKey: string;
    storageUploadId?: string;
    now: string;
  }): Promise<StudioAsset | null>;
  listAssetUploadIntents(scope: StudioOwnerScope): Promise<StudioAssetUploadIntent[]>;
  claimNextAssetUploadCleanup(now: string, leaseMs?: number, excludeOwnerKeys?: readonly string[]): Promise<StudioAssetUploadIntent | null>;
  resolveClaimedAssetUploadIntent(input: {
    scope: StudioOwnerScope;
    intentId: string;
    claimToken: string;
  }): Promise<StudioAsset | null>;
  failAssetUploadCleanup(input: {
    scope: StudioOwnerScope;
    intentId: string;
    claimToken: string;
    lastErrorCode: string;
    nextAttemptAt: string;
  }): Promise<StudioAssetUploadIntent | null>;
  completeAssetUploadCleanup(input: {
    scope: StudioOwnerScope;
    intentId: string;
    claimToken: string;
  }): Promise<boolean>;
  claimNextAsset(now: string, leaseMs?: number, excludeOwnerKeys?: readonly string[]): Promise<StudioAsset | null>;
  finishAssetProcessing(input: FinishStudioAssetProcessing): Promise<StudioAsset | null>;
  retryAssetProcessing(scope: StudioOwnerScope, assetId: string): Promise<StudioAsset | null>;
  tombstoneAssetForCleanup(scope: StudioOwnerScope, assetId: string): Promise<StudioAssetCleanupJob | null>;
  enqueueOrphanAssetCleanup(input: StudioOwnerScope & { objectKey: string }): Promise<StudioAssetCleanupJob>;
  listAssetCleanupJobs(scope: StudioOwnerScope): Promise<StudioAssetCleanupJob[]>;
  claimNextAssetCleanup(now: string, leaseMs?: number, excludeOwnerKeys?: readonly string[]): Promise<StudioAssetCleanupJob | null>;
  claimAssetCleanup(scope: StudioOwnerScope, jobId: string, now: string, leaseMs?: number): Promise<StudioAssetCleanupJob | null>;
  failAssetCleanup(input: {
    scope: StudioOwnerScope;
    jobId: string;
    claimToken: string;
    lastErrorCode: string;
    nextAttemptAt: string;
  }): Promise<StudioAssetCleanupJob | null>;
  completeAssetCleanup(input: {
    scope: StudioOwnerScope;
    jobId: string;
    claimToken: string;
  }): Promise<boolean>;
  createRelation(input: StudioOwnerScope & {
    sourceDocumentId: string;
    targetDocumentId: string;
    relationType: StudioRelationType;
    createdByProfileId: string;
  }): Promise<StudioRelation>;
  listRelations(scope: StudioOwnerScope, documentId?: string): Promise<StudioRelation[]>;
  listIndexJobs(scope: StudioOwnerScope): Promise<StudioIndexJob[]>;
  claimNextIndexJob(now: string, leaseMs?: number, maxAttempts?: number, excludeOwnerKeys?: readonly string[]): Promise<StudioIndexJob | null>;
  renewIndexJobLease(input: StudioOwnerScope & {
    jobId: string;
    claimToken: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<boolean>;
  completeIndexJob(input: StudioOwnerScope & { jobId: string; claimToken: string }): Promise<boolean>;
  failIndexJob(input: StudioOwnerScope & {
    jobId: string;
    claimToken: string;
    lastErrorCode: string;
    nextAttemptAt: string | null;
  }): Promise<StudioIndexJob | null>;
  startAssistantTurn(input: StudioOwnerScope & {
    conversationId: string | null;
    documentId: string | null;
    content: string;
  }): Promise<{ conversation: StudioConversation; message: StudioMessage }>;
  listConversationMessages(scope: StudioOwnerScope, conversationId: string, limit: number): Promise<StudioMessage[]>;
  finishAssistantTurn(input: StudioOwnerScope & {
    conversationId: string;
    aiRunId: string;
    content: string;
    citations: CreateStudioCitation[];
  }): Promise<{ message: StudioMessage; citations: StudioCitation[] }>;
  createAssistantSuggestion(input: StudioOwnerScope & {
    documentId: string | null;
    conversationId: string | null;
    aiRunId: string;
    kind: "text";
    payloadJson: StudioTextSuggestionPayload;
    citations: CreateStudioCitation[];
  }): Promise<{ suggestion: StudioSuggestion; citations: StudioCitation[] }>;
  findSuggestion(scope: StudioOwnerScope, suggestionId: string): Promise<StudioSuggestion | null>;
  acceptSuggestion(
    scope: StudioOwnerScope,
    suggestionId: string,
    actorProfileId: string,
    proposalOverride?: StudioTextSuggestionProposal
  ): Promise<StudioSuggestionDecision>;
  dismissSuggestion(scope: StudioOwnerScope, suggestionId: string): Promise<StudioSuggestionDecision>;
};
