import type { CompanyRepository } from "../company/company.types";
import type { StudioDocument, StudioOwnerScope, StudioRepository, StudioService } from "./studio.types";
import type { StudioSharingStore } from "./studio-sharing.store";
import type {
  StudioComment, StudioImportUpdate, StudioShare, StudioShareAudience, StudioSharedDocument
} from "./studio-sharing.types";

export type StudioSharingService = ReturnType<typeof createStudioSharingService>;

export function createStudioSharingService(input: {
  store: StudioSharingStore;
  repository: StudioRepository;
  studioService: StudioService;
  companyRepository: CompanyRepository;
  now?: () => string;
}) {
  const now = input.now ?? (() => new Date().toISOString());

  async function requireOwned(scope: StudioOwnerScope, documentId: string) {
    const document = await input.repository.findDocument(scope, documentId);
    if (!document || document.status === "trashed") throw sharingError("STUDIO_SHARED_DOCUMENT_NOT_FOUND");
    return document;
  }

  async function ownerName(workspaceId: string, profileId: string) {
    return (await input.companyRepository.findTeamMember(workspaceId, profileId))?.name ?? "Dono";
  }

  async function resolveSource(scope: StudioOwnerScope, documentId: string) {
    const owned = await input.repository.findDocument(scope, documentId);
    if (owned && owned.status !== "trashed") return { source: scope, document: owned, owned: true };
    const shares = await input.store.listSharesForRecipient(scope.workspaceId, scope.ownerProfileId);
    for (const share of shares.filter((item) => item.documentId === documentId)) {
      const document = await input.repository.findDocument(
        { workspaceId: share.workspaceId, ownerProfileId: share.ownerProfileId }, documentId
      );
      if (document && document.status !== "trashed") {
        return { source: { workspaceId: share.workspaceId, ownerProfileId: share.ownerProfileId }, document, owned: false };
      }
    }
    throw sharingError("STUDIO_SHARED_DOCUMENT_NOT_FOUND");
  }

  return {
    async replaceShares(scope: StudioOwnerScope, documentId: string, audiences: StudioShareAudience[]): Promise<StudioShare[]> {
      await requireOwned(scope, documentId);
      const members = await input.companyRepository.listTeamMembers(scope.workspaceId);
      const activeOwners = new Set(members.filter((member) => member.role === "owner" && member.status === "active").map((member) => member.id));
      for (const audience of audiences) {
        if (audience.type === "owner" && (audience.profileId === scope.ownerProfileId || !activeOwners.has(audience.profileId))) {
          throw sharingError("STUDIO_SHARE_RECIPIENT_INVALID");
        }
      }
      return input.store.replaceShares(scope, documentId, audiences, now());
    },
    async listSourceShares(scope: StudioOwnerScope, documentId: string) {
      await requireOwned(scope, documentId);
      return input.store.listSharesForSource(scope, documentId);
    },
    async listSharedWithMe(scope: StudioOwnerScope): Promise<StudioSharedDocument[]> {
      const result: StudioSharedDocument[] = [];
      for (const share of await input.store.listSharesForRecipient(scope.workspaceId, scope.ownerProfileId)) {
        const source = { workspaceId: share.workspaceId, ownerProfileId: share.ownerProfileId };
        const document = await input.repository.findDocument(source, share.documentId);
        if (!document || document.status === "trashed") continue;
        result.push({ document, author: { profileId: source.ownerProfileId, name: await ownerName(source.workspaceId, source.ownerProfileId) }, access: "shared_read_comment" });
      }
      return result.sort((a, b) => b.document.updatedAt.localeCompare(a.document.updatedAt));
    },
    async getSharedDocument(scope: StudioOwnerScope, documentId: string) {
      const resolved = await resolveSource(scope, documentId);
      return { document: resolved.document, access: resolved.owned ? "owned" as const : "shared_read_comment" as const,
        author: { profileId: resolved.source.ownerProfileId, name: await ownerName(scope.workspaceId, resolved.source.ownerProfileId) } };
    },
    async listComments(scope: StudioOwnerScope, documentId: string): Promise<StudioComment[]> {
      const resolved = await resolveSource(scope, documentId);
      return input.store.listComments(resolved.source, documentId);
    },
    async addComment(scope: StudioOwnerScope, documentId: string, body: string): Promise<StudioComment> {
      const resolved = await resolveSource(scope, documentId);
      const timestamp = now();
      return input.store.createComment({ ...resolved.source, documentId, authorProfileId: scope.ownerProfileId,
        authorName: await ownerName(scope.workspaceId, scope.ownerProfileId), body: normalizeComment(body), createdAt: timestamp, updatedAt: timestamp });
    },
    async editOwnComment(scope: StudioOwnerScope, commentId: string, body: string): Promise<StudioComment> {
      const shares = await input.store.listSharesForRecipient(scope.workspaceId, scope.ownerProfileId);
      const possibleSources = [scope, ...shares.map((share) => ({ workspaceId: share.workspaceId, ownerProfileId: share.ownerProfileId }))];
      for (const source of possibleSources) {
        const comment = await input.store.findComment(source, commentId);
        if (!comment) continue;
        if (comment.authorProfileId !== scope.ownerProfileId) throw sharingError("STUDIO_COMMENT_FORBIDDEN");
        await resolveSource(scope, comment.documentId);
        return input.store.updateComment({ ...comment, body: normalizeComment(body), updatedAt: now() });
      }
      throw sharingError("STUDIO_COMMENT_NOT_FOUND");
    },
    async deleteOwnComment(scope: StudioOwnerScope, commentId: string): Promise<void> {
      const shares = await input.store.listSharesForRecipient(scope.workspaceId, scope.ownerProfileId);
      for (const source of [scope, ...shares.map((share) => ({ workspaceId: share.workspaceId, ownerProfileId: share.ownerProfileId }))]) {
        const comment = await input.store.findComment(source, commentId);
        if (!comment) continue;
        if (comment.authorProfileId !== scope.ownerProfileId) throw sharingError("STUDIO_COMMENT_FORBIDDEN");
        await input.store.deleteComment(source, commentId);
        return;
      }
      throw sharingError("STUDIO_COMMENT_NOT_FOUND");
    },
    async moderateComment(scope: StudioOwnerScope, documentId: string, commentId: string): Promise<void> {
      await requireOwned(scope, documentId);
      const comment = await input.store.findComment(scope, commentId);
      if (!comment || comment.documentId !== documentId) throw sharingError("STUDIO_COMMENT_NOT_FOUND");
      await input.store.deleteComment(scope, commentId);
    },
    async importSheet(scope: StudioOwnerScope, documentId: string, idempotencyKey: string): Promise<StudioDocument> {
      const key = idempotencyKey.trim();
      if (!key) throw sharingError("STUDIO_IMPORT_KEY_REQUIRED");
      const existing = await input.store.findImportByKey(scope, key);
      if (existing) return requireOwned(scope, existing.importedDocumentId);
      const resolved = await resolveSource(scope, documentId);
      if (resolved.owned) throw sharingError("STUDIO_IMPORT_OWN_DOCUMENT");
      const copy = await input.studioService.createDocument(scope, scope.ownerProfileId, {
        title: resolved.document.title,
        body_json: structuredClone(resolved.document.bodyJson),
        body_text: resolved.document.bodyText,
        capture_mode: resolved.document.captureMode
      }, `shared-import:${key}`);
      await input.store.createImport({ ...scope, importedDocumentId: copy.id, sourceWorkspaceId: resolved.source.workspaceId,
        sourceOwnerProfileId: resolved.source.ownerProfileId, sourceDocumentId: resolved.document.id,
        sourceOwnerName: await ownerName(scope.workspaceId, resolved.source.ownerProfileId), sourceTitle: resolved.document.title,
        sourceRevision: resolved.document.revision, dismissedRevision: null, sourceUnavailableAt: null,
        idempotencyKey: key, createdAt: now() });
      return copy;
    },
    async readImportUpdate(scope: StudioOwnerScope, importedDocumentId: string): Promise<StudioImportUpdate> {
      const record = await input.store.findImport(scope, importedDocumentId);
      if (!record) throw sharingError("STUDIO_IMPORT_NOT_FOUND");
      const sourceScope = { workspaceId: record.sourceWorkspaceId, ownerProfileId: record.sourceOwnerProfileId };
      const share = await input.store.findSourceShare(sourceScope, record.sourceDocumentId, scope.ownerProfileId);
      const source = share ? await input.repository.findDocument(sourceScope, record.sourceDocumentId) : null;
      const unavailable = !source || source.status === "trashed";
      const status = unavailable ? "unavailable" : source.revision <= record.sourceRevision ? "current"
        : record.dismissedRevision === source.revision ? "dismissed" : "updated";
      return { importedDocumentId, status, sourceDocument: unavailable ? null : source,
        source: { documentId: record.sourceDocumentId, ownerProfileId: record.sourceOwnerProfileId,
          ownerName: record.sourceOwnerName, title: record.sourceTitle, importedRevision: record.sourceRevision,
          currentRevision: unavailable ? null : source.revision } };
    },
    async dismissImportUpdate(scope: StudioOwnerScope, importedDocumentId: string) {
      const update = await this.readImportUpdate(scope, importedDocumentId);
      const record = await input.store.findImport(scope, importedDocumentId);
      if (!record) throw sharingError("STUDIO_IMPORT_NOT_FOUND");
      await input.store.updateImport({ ...record, dismissedRevision: update.source.currentRevision });
      return this.readImportUpdate(scope, importedDocumentId);
    }
  };
}

function normalizeComment(value: string) {
  const body = value.trim();
  if (!body || body.length > 4000) throw sharingError("STUDIO_COMMENT_INVALID");
  return body;
}

function sharingError(code: string) {
  return Object.assign(new Error(code), { code });
}

