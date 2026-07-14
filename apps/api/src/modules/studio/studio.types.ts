export type StudioOwnerScope = { workspaceId: string; ownerProfileId: string };
export type StudioCaptureMode = "text" | "audio" | "file" | "image" | "link" | "mixed";
export type StudioDocumentStatus = "active" | "archived";
export type StudioStructureKind = "goal" | "decision" | "plan" | "ritual";
export type StudioSuggestionStatus = "pending" | "accepted" | "dismissed" | "expired";
export type StudioAssetKind = "audio" | "image" | "file" | "link_snapshot";
export type StudioAssetExtractionStatus = "pending" | "processing" | "ready" | "failed";
export type StudioAssetLifecycleStatus = "active" | "deleting";
export type StudioAssetCleanupStatus = "pending" | "processing" | "failed";
export type StudioAssetUploadIntentStatus = "uploading" | "cleanup_pending" | "processing" | "failed";
export type StudioAssetStorageSessionState = "creating" | "active" | "abort_pending";
export const STUDIO_ASSET_MAX_ATTEMPTS = 5;

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
};

export type StudioDocument = StudioOwnerScope & {
  id: string;
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
};

export type StudioDocumentPage = {
  items: StudioDocument[];
  nextCursor: string | null;
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
  "id" | "createdAt" | "updatedAt" | "claimToken" | "leaseExpiresAt" | "lifecycleStatus"
> & Partial<Pick<StudioAsset, "claimToken" | "leaseExpiresAt" | "lifecycleStatus">>;

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
};

export type StudioService = {
  readHome(scope: StudioOwnerScope): Promise<StudioHome>;
  listDocuments(scope: StudioOwnerScope, query: StudioDocumentQuery): Promise<StudioDocumentPage>;
  getDocument(scope: StudioOwnerScope, id: string): Promise<StudioDocument>;
  createDocument(scope: StudioOwnerScope, actorProfileId: string, input: CreateStudioDocument): Promise<StudioDocument>;
  updateDocument(scope: StudioOwnerScope, actorProfileId: string, id: string, input: UpdateStudioDocument): Promise<StudioDocument>;
  archiveDocument(scope: StudioOwnerScope, actorProfileId: string, id: string): Promise<StudioDocument>;
  restoreDocument(scope: StudioOwnerScope, actorProfileId: string, id: string): Promise<StudioDocument>;
  setFocused(scope: StudioOwnerScope, actorProfileId: string, id: string, focused: boolean): Promise<StudioDocument>;
  listVersions(scope: StudioOwnerScope, id: string): Promise<StudioDocumentVersion[]>;
  search(scope: StudioOwnerScope, query: string, limit: number): Promise<StudioSearchResult[]>;
  listCollections(scope: StudioOwnerScope): Promise<StudioCollection[]>;
  createCollection(scope: StudioOwnerScope, actorProfileId: string, input: CreateStudioCollection): Promise<StudioCollection>;
  renameCollection(scope: StudioOwnerScope, actorProfileId: string, id: string, input: UpdateStudioCollection): Promise<StudioCollection>;
  deleteCollection(scope: StudioOwnerScope, actorProfileId: string, id: string): Promise<StudioCollection>;
  addDocumentToCollection(scope: StudioOwnerScope, actorProfileId: string, collectionId: string, documentId: string): Promise<StudioCollectionMembership>;
  removeDocumentFromCollection(scope: StudioOwnerScope, actorProfileId: string, collectionId: string, documentId: string): Promise<boolean>;
};

export type StudioRepository = {
  listDocuments(scope: StudioOwnerScope, input: StudioDocumentQuery): Promise<StudioDocumentPage>;
  findDocument(scope: StudioOwnerScope, documentId: string): Promise<StudioDocument | null>;
  createDocument(input: Omit<StudioDocument, "id" | "revision" | "createdAt" | "updatedAt" | "archivedAt">): Promise<StudioDocument>;
  updateDocument(input: StudioDocument, expectedRevision: number): Promise<StudioDocument>;
  listVersions(scope: StudioOwnerScope, documentId: string): Promise<StudioDocumentVersion[]>;
  appendVersion(input: Omit<StudioDocumentVersion, "id" | "versionNumber" | "createdAt">): Promise<StudioDocumentVersion>;
  searchDocuments(scope: StudioOwnerScope, input: StudioLexicalSearchQuery): Promise<StudioSearchDocument[]>;
  listRecentDocuments(scope: StudioOwnerScope, limit: number): Promise<StudioDocument[]>;
  listFocusedDocuments(scope: StudioOwnerScope, limit: number): Promise<StudioDocument[]>;
  countPendingReviewDocuments(scope: StudioOwnerScope): Promise<number>;
  listCollections(scope: StudioOwnerScope): Promise<StudioCollection[]>;
  findCollection(scope: StudioOwnerScope, collectionId: string): Promise<StudioCollection | null>;
  createCollection(input: StudioOwnerScope & CreateStudioCollection): Promise<StudioCollection>;
  updateCollection(input: StudioCollection): Promise<StudioCollection>;
  deleteCollection(scope: StudioOwnerScope, collectionId: string): Promise<boolean>;
  addCollectionMembership(input: StudioOwnerScope & { collectionId: string; documentId: string }): Promise<StudioCollectionMembership>;
  removeCollectionMembership(scope: StudioOwnerScope, collectionId: string, documentId: string): Promise<boolean>;
  listDocumentCollections(scope: StudioOwnerScope, documentId: string): Promise<StudioCollection[]>;
  findAsset(scope: StudioOwnerScope, assetId: string): Promise<StudioAsset | null>;
  findAssetIncludingDeleting(scope: StudioOwnerScope, assetId: string): Promise<StudioAsset | null>;
  createAsset(input: CreateStudioAsset): Promise<StudioAsset>;
  findAssetByObjectKey(scope: StudioOwnerScope, objectKey: string): Promise<StudioAsset | null>;
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
  claimNextAssetUploadCleanup(now: string, leaseMs?: number): Promise<StudioAssetUploadIntent | null>;
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
  claimNextAsset(now: string, leaseMs?: number): Promise<StudioAsset | null>;
  finishAssetProcessing(input: FinishStudioAssetProcessing): Promise<StudioAsset | null>;
  retryAssetProcessing(scope: StudioOwnerScope, assetId: string): Promise<StudioAsset | null>;
  tombstoneAssetForCleanup(scope: StudioOwnerScope, assetId: string): Promise<StudioAssetCleanupJob | null>;
  enqueueOrphanAssetCleanup(input: StudioOwnerScope & { objectKey: string }): Promise<StudioAssetCleanupJob>;
  listAssetCleanupJobs(scope: StudioOwnerScope): Promise<StudioAssetCleanupJob[]>;
  claimNextAssetCleanup(now: string, leaseMs?: number): Promise<StudioAssetCleanupJob | null>;
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
};
