import type { StudioDocument, StudioOwnerScope } from "./studio.types";

export type StudioShareAudience =
  | { type: "owner"; profileId: string }
  | { type: "all_owners" };

export type StudioShare = StudioOwnerScope & {
  id: string;
  documentId: string;
  audience: StudioShareAudience;
  createdAt: string;
};

export type StudioComment = StudioOwnerScope & {
  id: string;
  documentId: string;
  authorProfileId: string;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type StudioImportRecord = StudioOwnerScope & {
  id: string;
  importedDocumentId: string;
  sourceWorkspaceId: string;
  sourceOwnerProfileId: string;
  sourceDocumentId: string;
  sourceOwnerName: string;
  sourceTitle: string | null;
  sourceRevision: number;
  dismissedRevision: number | null;
  sourceUnavailableAt: string | null;
  idempotencyKey: string;
  createdAt: string;
};

export type StudioSharedDocument = {
  document: StudioDocument;
  author: { profileId: string; name: string };
  access: "shared_read_comment";
};

export type StudioImportUpdate = {
  importedDocumentId: string;
  source: {
    documentId: string;
    ownerProfileId: string;
    ownerName: string;
    title: string | null;
    importedRevision: number;
    currentRevision: number | null;
  };
  status: "current" | "updated" | "dismissed" | "unavailable";
  sourceDocument: StudioDocument | null;
};

