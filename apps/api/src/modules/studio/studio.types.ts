export type StudioOwnerScope = { workspaceId: string; ownerProfileId: string };
export type StudioCaptureMode = "text" | "audio" | "file" | "image" | "link" | "mixed";
export type StudioDocumentStatus = "active" | "archived";
export type StudioStructureKind = "goal" | "decision" | "plan" | "ritual";
export type StudioSuggestionStatus = "pending" | "accepted" | "dismissed" | "expired";

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

export type StudioSearchCollection = Pick<StudioCollection, "id" | "name">;

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
  listCollections(scope: StudioOwnerScope): Promise<StudioCollection[]>;
  findCollection(scope: StudioOwnerScope, collectionId: string): Promise<StudioCollection | null>;
  createCollection(input: StudioOwnerScope & CreateStudioCollection): Promise<StudioCollection>;
  updateCollection(input: StudioCollection): Promise<StudioCollection>;
  deleteCollection(scope: StudioOwnerScope, collectionId: string): Promise<boolean>;
  addCollectionMembership(input: StudioOwnerScope & { collectionId: string; documentId: string }): Promise<StudioCollectionMembership>;
  removeCollectionMembership(scope: StudioOwnerScope, collectionId: string, documentId: string): Promise<boolean>;
  listDocumentCollections(scope: StudioOwnerScope, documentId: string): Promise<StudioCollection[]>;
};
