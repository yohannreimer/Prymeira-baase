export type StudioOwnerScope = { workspaceId: string; ownerProfileId: string };
export type StudioCaptureMode = "text" | "audio" | "file" | "image" | "link" | "mixed";
export type StudioDocumentStatus = "active" | "archived";
export type StudioStructureKind = "goal" | "decision" | "plan" | "ritual";
export type StudioSuggestionStatus = "pending" | "accepted" | "dismissed" | "expired";

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

export type StudioRepository = {
  listDocuments(scope: StudioOwnerScope, input: { cursor?: string; limit: number; status?: StudioDocumentStatus }): Promise<{ items: StudioDocument[]; nextCursor: string | null }>;
  findDocument(scope: StudioOwnerScope, documentId: string): Promise<StudioDocument | null>;
  createDocument(input: Omit<StudioDocument, "id" | "revision" | "createdAt" | "updatedAt" | "archivedAt">): Promise<StudioDocument>;
  updateDocument(input: StudioDocument, expectedRevision: number): Promise<StudioDocument>;
  listVersions(scope: StudioOwnerScope, documentId: string): Promise<StudioDocumentVersion[]>;
  appendVersion(input: Omit<StudioDocumentVersion, "id" | "versionNumber" | "createdAt">): Promise<StudioDocumentVersion>;
};
