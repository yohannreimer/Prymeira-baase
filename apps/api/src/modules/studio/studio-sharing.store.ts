import { randomUUID } from "node:crypto";
import type { StudioOwnerScope } from "./studio.types";
import type { StudioComment, StudioImportRecord, StudioShare, StudioShareAudience } from "./studio-sharing.types";

export type StudioSharingStore = {
  replaceShares(scope: StudioOwnerScope, documentId: string, audiences: StudioShareAudience[], now: string): Promise<StudioShare[]>;
  listSharesForSource(scope: StudioOwnerScope, documentId: string): Promise<StudioShare[]>;
  listSharesForRecipient(workspaceId: string, ownerProfileId: string): Promise<StudioShare[]>;
  findSourceShare(source: StudioOwnerScope, documentId: string, recipientProfileId: string): Promise<StudioShare | null>;
  listComments(source: StudioOwnerScope, documentId: string): Promise<StudioComment[]>;
  createComment(input: Omit<StudioComment, "id">): Promise<StudioComment>;
  updateComment(comment: StudioComment): Promise<StudioComment>;
  deleteComment(source: StudioOwnerScope, commentId: string): Promise<boolean>;
  findComment(source: StudioOwnerScope, commentId: string): Promise<StudioComment | null>;
  findImportByKey(scope: StudioOwnerScope, key: string): Promise<StudioImportRecord | null>;
  findImport(scope: StudioOwnerScope, importedDocumentId: string): Promise<StudioImportRecord | null>;
  createImport(input: Omit<StudioImportRecord, "id">): Promise<StudioImportRecord>;
  updateImport(input: StudioImportRecord): Promise<StudioImportRecord>;
};

export function createInMemoryStudioSharingStore(): StudioSharingStore {
  let shares: StudioShare[] = [];
  const comments: StudioComment[] = [];
  const imports: StudioImportRecord[] = [];
  const clone = <T>(value: T): T => structuredClone(value);

  return {
    async replaceShares(scope, documentId, audiences, now) {
      shares = shares.filter((share) => !(share.workspaceId === scope.workspaceId
        && share.ownerProfileId === scope.ownerProfileId && share.documentId === documentId));
      const unique = new Map(audiences.map((audience) => [audience.type === "all_owners" ? "all" : audience.profileId, audience]));
      const created = [...unique.values()].map((audience) => ({
        ...scope, id: `studio_share_${randomUUID()}`, documentId, audience, createdAt: now
      }));
      shares.push(...created);
      return clone(created);
    },
    async listSharesForSource(scope, documentId) {
      return clone(shares.filter((share) => share.workspaceId === scope.workspaceId
        && share.ownerProfileId === scope.ownerProfileId && share.documentId === documentId));
    },
    async listSharesForRecipient(workspaceId, ownerProfileId) {
      return clone(shares.filter((share) => share.workspaceId === workspaceId
        && share.ownerProfileId !== ownerProfileId
        && (share.audience.type === "all_owners" || share.audience.profileId === ownerProfileId)));
    },
    async findSourceShare(source, documentId, recipientProfileId) {
      return clone(shares.find((share) => share.workspaceId === source.workspaceId
        && share.ownerProfileId === source.ownerProfileId && share.documentId === documentId
        && (share.audience.type === "all_owners" || share.audience.profileId === recipientProfileId)) ?? null);
    },
    async listComments(source, documentId) {
      return clone(comments.filter((comment) => comment.workspaceId === source.workspaceId
        && comment.ownerProfileId === source.ownerProfileId && comment.documentId === documentId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    },
    async createComment(input) {
      const comment = { ...input, id: `studio_comment_${randomUUID()}` };
      comments.push(comment);
      return clone(comment);
    },
    async updateComment(comment) {
      const index = comments.findIndex((item) => item.id === comment.id && item.workspaceId === comment.workspaceId
        && item.ownerProfileId === comment.ownerProfileId);
      if (index < 0) throw new Error("STUDIO_COMMENT_NOT_FOUND");
      comments[index] = clone(comment);
      return clone(comment);
    },
    async deleteComment(source, commentId) {
      const index = comments.findIndex((item) => item.id === commentId && item.workspaceId === source.workspaceId
        && item.ownerProfileId === source.ownerProfileId);
      if (index < 0) return false;
      comments.splice(index, 1);
      return true;
    },
    async findComment(source, commentId) {
      return clone(comments.find((item) => item.id === commentId && item.workspaceId === source.workspaceId
        && item.ownerProfileId === source.ownerProfileId) ?? null);
    },
    async findImportByKey(scope, key) {
      return clone(imports.find((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId && item.idempotencyKey === key) ?? null);
    },
    async findImport(scope, importedDocumentId) {
      return clone(imports.find((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId && item.importedDocumentId === importedDocumentId) ?? null);
    },
    async createImport(input) {
      const record = { ...input, id: `studio_import_${randomUUID()}` };
      imports.push(record);
      return clone(record);
    },
    async updateImport(input) {
      const index = imports.findIndex((item) => item.id === input.id);
      if (index < 0) throw new Error("STUDIO_IMPORT_NOT_FOUND");
      imports[index] = clone(input);
      return clone(input);
    }
  };
}

