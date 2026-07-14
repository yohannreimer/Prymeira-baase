import { randomUUID } from "node:crypto";
import type {
  StudioCollection,
  StudioCollectionMembership,
  StudioAsset,
  StudioAssetCleanupJob,
  StudioAssetUploadIntent,
  StudioDocument,
  StudioDocumentVersion,
  StudioRepository
} from "./studio.types";
import { STUDIO_ASSET_MAX_ATTEMPTS } from "./studio.types";
import { studioSearchScore } from "./studio-search";

type InMemoryStudioRepositoryOptions = {
  now?: () => string;
};

type DocumentCursor = {
  updatedAt: string;
  id: string;
};

function cloneDocument(document: StudioDocument): StudioDocument {
  return structuredClone(document);
}

function cloneVersion(version: StudioDocumentVersion): StudioDocumentVersion {
  return structuredClone(version);
}

function cloneCollection(collection: StudioCollection): StudioCollection {
  return structuredClone(collection);
}

function cloneMembership(membership: StudioCollectionMembership): StudioCollectionMembership {
  return structuredClone(membership);
}

function cloneAsset(asset: StudioAsset): StudioAsset {
  return structuredClone(asset);
}

function cloneCleanupJob(job: StudioAssetCleanupJob): StudioAssetCleanupJob {
  return structuredClone(job);
}

function cloneUploadIntent(intent: StudioAssetUploadIntent): StudioAssetUploadIntent {
  return structuredClone(intent);
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "string") throw new Error("STUDIO_CLOCK_INVALID");
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("STUDIO_CLOCK_INVALID");
  return timestamp.toISOString();
}

function nextTimestamp(now: () => string, previousTimestamp: string) {
  const timestamp = now();
  if (new Date(timestamp).getTime() > new Date(previousTimestamp).getTime()) return timestamp;
  return new Date(new Date(previousTimestamp).getTime() + 1).toISOString();
}

function compareDocuments(left: StudioDocument, right: StudioDocument) {
  const timestampOrder = right.updatedAt.localeCompare(left.updatedAt);
  return timestampOrder || right.id.localeCompare(left.id);
}

function compareCollections(left: StudioCollection, right: StudioCollection) {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function isAfterCursor(document: StudioDocument, cursor: DocumentCursor) {
  return document.updatedAt < cursor.updatedAt
    || (document.updatedAt === cursor.updatedAt && document.id < cursor.id);
}

function encodeCursor(document: StudioDocument) {
  return Buffer.from(JSON.stringify({ updatedAt: document.updatedAt, id: document.id })).toString("base64url");
}

function decodeCursor(cursor: string): DocumentCursor {
  try {
    if (!cursor || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) throw new Error();
    const value = JSON.parse(decoded.toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    if (Object.keys(value).length !== 2) throw new Error();
    const candidate = value as Partial<DocumentCursor>;
    if (typeof candidate.updatedAt !== "string" || typeof candidate.id !== "string" || !candidate.id) {
      throw new Error();
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(candidate.updatedAt)) throw new Error();
    const timestamp = new Date(candidate.updatedAt);
    if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== candidate.updatedAt) throw new Error();
    return { updatedAt: candidate.updatedAt, id: candidate.id };
  } catch {
    throw new Error("STUDIO_DOCUMENT_CURSOR_INVALID");
  }
}

export function createInMemoryStudioRepository(
  options: InMemoryStudioRepositoryOptions = {}
): StudioRepository {
  const documents: StudioDocument[] = [];
  const versions: StudioDocumentVersion[] = [];
  const collections: StudioCollection[] = [];
  const memberships: StudioCollectionMembership[] = [];
  const assets: StudioAsset[] = [];
  const assetCleanupJobs: StudioAssetCleanupJob[] = [];
  const assetUploadIntents: StudioAssetUploadIntent[] = [];
  const clock = options.now ?? (() => new Date().toISOString());
  const now = () => normalizeTimestamp(clock());

  function appendStoredVersion(
    input: Omit<StudioDocumentVersion, "id" | "versionNumber" | "createdAt">,
    minimumCreatedAt?: string
  ) {
    const versionNumber = versions.reduce((maximum, version) => {
      if (
        version.workspaceId !== input.workspaceId
        || version.ownerProfileId !== input.ownerProfileId
        || version.documentId !== input.documentId
      ) return maximum;
      return Math.max(maximum, version.versionNumber);
    }, 0) + 1;
    let previousVersion: StudioDocumentVersion | undefined;
    for (let index = versions.length - 1; index >= 0; index -= 1) {
      const candidate = versions[index]!;
      if (
        candidate.workspaceId === input.workspaceId
        && candidate.ownerProfileId === input.ownerProfileId
        && candidate.documentId === input.documentId
      ) {
        previousVersion = candidate;
        break;
      }
    }
    const timestamp = new Date(Math.max(
      new Date(minimumCreatedAt ?? now()).getTime(),
      minimumCreatedAt ? new Date(minimumCreatedAt).getTime() : Number.NEGATIVE_INFINITY,
      previousVersion ? new Date(previousVersion.createdAt).getTime() + 1 : Number.NEGATIVE_INFINITY
    )).toISOString();
    const version: StudioDocumentVersion = {
      ...structuredClone(input),
      id: `studio_version_${randomUUID()}`,
      versionNumber,
      createdAt: timestamp
    };
    versions.push(version);
    return cloneVersion(version);
  }

  return {
    async listDocuments(scope, input) {
      const cursor = input.cursor ? decodeCursor(input.cursor) : null;
      const matches = documents
        .filter((document) => document.workspaceId === scope.workspaceId)
        .filter((document) => document.ownerProfileId === scope.ownerProfileId)
        .filter((document) => !input.status || document.status === input.status)
        .filter((document) => !cursor || isAfterCursor(document, cursor))
        .sort(compareDocuments);
      const page = matches.slice(0, input.limit);
      return {
        items: page.map(cloneDocument),
        nextCursor: matches.length > page.length && page.length > 0
          ? encodeCursor(page[page.length - 1]!)
          : null
      };
    },

    async findDocument(scope, documentId) {
      const document = documents.find((item) =>
        item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId
        && item.id === documentId
      );
      return document ? cloneDocument(document) : null;
    },

    async createDocument(input) {
      const timestamp = now();
      const document: StudioDocument = {
        ...structuredClone(input),
        id: `studio_document_${randomUUID()}`,
        revision: 1,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      documents.push(document);
      appendStoredVersion({
        workspaceId: document.workspaceId,
        ownerProfileId: document.ownerProfileId,
        documentId: document.id,
        bodyJson: document.bodyJson,
        bodyText: document.bodyText,
        origin: "user",
        actorProfileId: document.ownerProfileId,
        aiRunId: null
      }, document.createdAt);
      return cloneDocument(document);
    },

    async updateDocument(input, expectedRevision) {
      const index = documents.findIndex((document) =>
        document.workspaceId === input.workspaceId
        && document.ownerProfileId === input.ownerProfileId
        && document.id === input.id
      );
      if (index === -1) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
      const persisted = documents[index]!;
      if (persisted.revision !== expectedRevision) throw new Error("STUDIO_DOCUMENT_STALE");

      const updated: StudioDocument = {
        ...persisted,
        title: input.title,
        bodyJson: structuredClone(input.bodyJson),
        bodyText: input.bodyText,
        captureMode: input.captureMode,
        inboxState: input.inboxState,
        isFocused: input.isFocused,
        status: input.status,
        archivedAt: input.archivedAt,
        revision: persisted.revision + 1,
        updatedAt: nextTimestamp(now, persisted.updatedAt)
      };
      documents[index] = updated;
      appendStoredVersion({
        workspaceId: updated.workspaceId,
        ownerProfileId: updated.ownerProfileId,
        documentId: updated.id,
        bodyJson: updated.bodyJson,
        bodyText: updated.bodyText,
        origin: "user",
        actorProfileId: updated.ownerProfileId,
        aiRunId: null
      }, updated.updatedAt);
      return cloneDocument(updated);
    },

    async listVersions(scope, documentId) {
      return versions
        .filter((version) => version.workspaceId === scope.workspaceId)
        .filter((version) => version.ownerProfileId === scope.ownerProfileId)
        .filter((version) => version.documentId === documentId)
        .sort((left, right) => left.versionNumber - right.versionNumber || left.id.localeCompare(right.id))
        .map(cloneVersion);
    },

    async appendVersion(input) {
      const documentExists = documents.some((document) =>
        document.workspaceId === input.workspaceId
        && document.ownerProfileId === input.ownerProfileId
        && document.id === input.documentId
      );
      if (!documentExists) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
      return appendStoredVersion(input);
    },

    async searchDocuments(scope, input) {
      return documents
        .filter((document) => document.workspaceId === scope.workspaceId)
        .filter((document) => document.ownerProfileId === scope.ownerProfileId)
        .filter((document) => document.status === "active")
        .map((document) => ({ document, score: studioSearchScore(document, input.query) }))
        .filter((item): item is { document: StudioDocument; score: number } => item.score !== null)
        .sort((left, right) =>
          right.score - left.score
          || right.document.updatedAt.localeCompare(left.document.updatedAt)
          || left.document.id.localeCompare(right.document.id)
        )
        .slice(0, input.limit)
        .map(({ document }) => ({
          id: document.id,
          title: document.title,
          bodyText: document.bodyText,
          updatedAt: document.updatedAt
        }));
    },

    async listRecentDocuments(scope, limit) {
      return documents
        .filter((document) => document.workspaceId === scope.workspaceId)
        .filter((document) => document.ownerProfileId === scope.ownerProfileId)
        .filter((document) => document.status === "active")
        .sort(compareDocuments)
        .slice(0, limit)
        .map(cloneDocument);
    },

    async listFocusedDocuments(scope, limit) {
      return documents
        .filter((document) => document.workspaceId === scope.workspaceId)
        .filter((document) => document.ownerProfileId === scope.ownerProfileId)
        .filter((document) => document.status === "active" && document.isFocused)
        .sort(compareDocuments)
        .slice(0, limit)
        .map(cloneDocument);
    },

    async countPendingReviewDocuments(scope) {
      return documents.filter((document) =>
        document.workspaceId === scope.workspaceId
        && document.ownerProfileId === scope.ownerProfileId
        && document.status === "active"
        && document.inboxState === "pending_review"
      ).length;
    },

    async listCollections(scope) {
      return collections
        .filter((collection) => collection.workspaceId === scope.workspaceId)
        .filter((collection) => collection.ownerProfileId === scope.ownerProfileId)
        .sort(compareCollections)
        .map(cloneCollection);
    },

    async findCollection(scope, collectionId) {
      const collection = collections.find((item) =>
        item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId
        && item.id === collectionId
      );
      return collection ? cloneCollection(collection) : null;
    },

    async createCollection(input) {
      const timestamp = now();
      const collection: StudioCollection = {
        ...structuredClone(input),
        id: `studio_collection_${randomUUID()}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      collections.push(collection);
      return cloneCollection(collection);
    },

    async updateCollection(input) {
      const index = collections.findIndex((collection) =>
        collection.workspaceId === input.workspaceId
        && collection.ownerProfileId === input.ownerProfileId
        && collection.id === input.id
      );
      if (index === -1) throw new Error("STUDIO_COLLECTION_NOT_FOUND");
      const persisted = collections[index]!;
      const updated: StudioCollection = {
        ...persisted,
        name: input.name,
        updatedAt: nextTimestamp(now, persisted.updatedAt)
      };
      collections[index] = updated;
      return cloneCollection(updated);
    },

    async deleteCollection(scope, collectionId) {
      const collectionIndex = collections.findIndex((collection) =>
        collection.workspaceId === scope.workspaceId
        && collection.ownerProfileId === scope.ownerProfileId
        && collection.id === collectionId
      );
      if (collectionIndex === -1) return false;
      collections.splice(collectionIndex, 1);
      for (let index = memberships.length - 1; index >= 0; index -= 1) {
        const membership = memberships[index]!;
        if (
          membership.workspaceId === scope.workspaceId
          && membership.ownerProfileId === scope.ownerProfileId
          && membership.collectionId === collectionId
        ) memberships.splice(index, 1);
      }
      return true;
    },

    async addCollectionMembership(input) {
      const collectionExists = collections.some((collection) =>
        collection.workspaceId === input.workspaceId
        && collection.ownerProfileId === input.ownerProfileId
        && collection.id === input.collectionId
      );
      if (!collectionExists) throw new Error("STUDIO_COLLECTION_NOT_FOUND");
      const documentExists = documents.some((document) =>
        document.workspaceId === input.workspaceId
        && document.ownerProfileId === input.ownerProfileId
        && document.id === input.documentId
      );
      if (!documentExists) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
      const existing = memberships.find((membership) =>
        membership.workspaceId === input.workspaceId
        && membership.ownerProfileId === input.ownerProfileId
        && membership.collectionId === input.collectionId
        && membership.documentId === input.documentId
      );
      if (existing) return cloneMembership(existing);

      const membership: StudioCollectionMembership = {
        ...structuredClone(input),
        id: `studio_collection_item_${randomUUID()}`,
        createdAt: now()
      };
      memberships.push(membership);
      return cloneMembership(membership);
    },

    async removeCollectionMembership(scope, collectionId, documentId) {
      const index = memberships.findIndex((membership) =>
        membership.workspaceId === scope.workspaceId
        && membership.ownerProfileId === scope.ownerProfileId
        && membership.collectionId === collectionId
        && membership.documentId === documentId
      );
      if (index === -1) return false;
      memberships.splice(index, 1);
      return true;
    },

    async listDocumentCollections(scope, documentId) {
      const collectionIds = new Set(memberships
        .filter((membership) => membership.workspaceId === scope.workspaceId)
        .filter((membership) => membership.ownerProfileId === scope.ownerProfileId)
        .filter((membership) => membership.documentId === documentId)
        .map((membership) => membership.collectionId));
      return collections
        .filter((collection) => collection.workspaceId === scope.workspaceId)
        .filter((collection) => collection.ownerProfileId === scope.ownerProfileId)
        .filter((collection) => collectionIds.has(collection.id))
        .sort(compareCollections)
        .map(cloneCollection);
    },

    async findAsset(scope, assetId) {
      const asset = assets.find((item) =>
        item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId
        && item.id === assetId
        && item.lifecycleStatus === "active"
      );
      return asset ? cloneAsset(asset) : null;
    },

    async findAssetIncludingDeleting(scope, assetId) {
      const asset = assets.find((item) =>
        item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId
        && item.id === assetId
      );
      return asset ? cloneAsset(asset) : null;
    },

    async createAsset(input) {
      const documentExists = documents.some((document) =>
        document.workspaceId === input.workspaceId
        && document.ownerProfileId === input.ownerProfileId
        && document.id === input.documentId
      );
      if (!documentExists) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
      const timestamp = now();
      const asset: StudioAsset = {
        ...structuredClone(input),
        claimToken: input.claimToken ?? null,
        leaseExpiresAt: input.leaseExpiresAt ?? null,
        lifecycleStatus: input.lifecycleStatus ?? "active",
        id: `studio_asset_${randomUUID()}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      assets.push(asset);
      return cloneAsset(asset);
    },

    async findAssetByObjectKey(scope, objectKey) {
      const asset = assets.find((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId
        && item.objectKey === objectKey
        && item.lifecycleStatus === "active");
      return asset ? cloneAsset(asset) : null;
    },

    async createAssetUploadIntent(input) {
      const documentExists = documents.some((document) => document.workspaceId === input.workspaceId
        && document.ownerProfileId === input.ownerProfileId && document.id === input.documentId);
      if (!documentExists) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
      const existing = assetUploadIntents.find((intent) => intent.workspaceId === input.workspaceId
        && intent.ownerProfileId === input.ownerProfileId && intent.objectKey === input.objectKey);
      if (existing) return cloneUploadIntent(existing);
      const timestamp = now();
      const intent: StudioAssetUploadIntent = {
        ...structuredClone(input),
        id: `studio_asset_upload_${randomUUID()}`,
        status: "uploading",
        assetId: null,
        attemptCount: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        uploadToken: randomUUID(),
        uploadLeaseExpiresAt: normalizeTimestamp(input.uploadLeaseExpiresAt),
        storageUploadId: null,
        storageSessionState: "creating",
        claimToken: null,
        leaseExpiresAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      assetUploadIntents.push(intent);
      return cloneUploadIntent(intent);
    },

    async attachAssetUploadSession(input) {
      const intent = assetUploadIntents.find((item) => item.workspaceId === input.scope.workspaceId
        && item.ownerProfileId === input.scope.ownerProfileId && item.id === input.intentId
        && item.status === "uploading" && item.uploadToken === input.uploadToken
        && item.storageSessionState === "creating" && item.storageUploadId === null);
      if (!intent) return false;
      intent.storageUploadId = input.storageUploadId;
      intent.storageSessionState = "active";
      intent.updatedAt = nextTimestamp(now, intent.updatedAt);
      return true;
    },

    async finalizeAssetUpload(input) {
      const intentIndex = assetUploadIntents.findIndex((item) => item.workspaceId === input.scope.workspaceId
        && item.ownerProfileId === input.scope.ownerProfileId && item.id === input.intentId);
      const intent = assetUploadIntents[intentIndex];
      if (!intent) {
        const existing = assets.find((asset) => asset.workspaceId === input.scope.workspaceId
          && asset.ownerProfileId === input.scope.ownerProfileId && asset.objectKey === input.asset.objectKey
          && asset.lifecycleStatus === "active");
        if (existing) return cloneAsset(existing);
        throw new Error("STUDIO_ASSET_UPLOAD_INTENT_NOT_FOUND");
      }
      if (intent.status !== "uploading" || intent.uploadToken !== input.uploadToken
        || intent.storageSessionState !== "active" || intent.storageUploadId === null) {
        throw new Error("STUDIO_ASSET_UPLOAD_INTENT_STALE");
      }
      const existing = assets.find((asset) => asset.workspaceId === intent.workspaceId
        && asset.ownerProfileId === intent.ownerProfileId && asset.objectKey === intent.objectKey
        && asset.lifecycleStatus === "active");
      if (existing) {
        assetUploadIntents.splice(intentIndex, 1);
        return cloneAsset(existing);
      }
      const timestamp = now();
      const asset: StudioAsset = {
        ...structuredClone(input.asset),
        claimToken: input.asset.claimToken ?? null,
        leaseExpiresAt: input.asset.leaseExpiresAt ?? null,
        lifecycleStatus: input.asset.lifecycleStatus ?? "active",
        id: `studio_asset_${randomUUID()}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      assets.push(asset);
      assetUploadIntents.splice(intentIndex, 1);
      return cloneAsset(asset);
    },

    async renewAssetUploadIntentLease(input) {
      const intent = assetUploadIntents.find((item) => item.workspaceId === input.scope.workspaceId
        && item.ownerProfileId === input.scope.ownerProfileId && item.id === input.intentId
        && item.status === "uploading" && item.uploadToken === input.uploadToken);
      if (!intent) return false;
      intent.uploadLeaseExpiresAt = normalizeTimestamp(input.uploadLeaseExpiresAt);
      intent.updatedAt = nextTimestamp(now, intent.updatedAt);
      return true;
    },

    async reconcileAssetUploadFailure(input) {
      const intentIndex = assetUploadIntents.findIndex((item) => item.workspaceId === input.scope.workspaceId
        && item.ownerProfileId === input.scope.ownerProfileId && item.id === input.intentId);
      const intent = assetUploadIntents[intentIndex];
      if (!intent) {
        const existing = assets.find((asset) => asset.workspaceId === input.scope.workspaceId
          && asset.ownerProfileId === input.scope.ownerProfileId && asset.objectKey === input.objectKey
          && asset.lifecycleStatus === "active");
        if (existing) return cloneAsset(existing);
        throw new Error("STUDIO_ASSET_UPLOAD_INTENT_NOT_FOUND");
      }
      if (intent.objectKey !== input.objectKey) throw new Error("STUDIO_ASSET_UPLOAD_INTENT_MISMATCH");
      if (input.storageUploadId && intent.storageUploadId && intent.storageUploadId !== input.storageUploadId) {
        throw new Error("STUDIO_ASSET_UPLOAD_SESSION_MISMATCH");
      }
      const existing = assets.find((asset) => asset.workspaceId === input.scope.workspaceId
        && asset.ownerProfileId === input.scope.ownerProfileId && asset.objectKey === intent.objectKey
        && asset.lifecycleStatus === "active");
      if (existing) {
        assetUploadIntents.splice(intentIndex, 1);
        return cloneAsset(existing);
      }
      if (intent.status === "uploading" && intent.uploadToken === input.uploadToken) {
        intent.storageUploadId ??= input.storageUploadId ?? null;
        intent.storageSessionState = "abort_pending";
        intent.status = "cleanup_pending";
        intent.nextAttemptAt = normalizeTimestamp(input.now);
        intent.lastErrorCode = "STUDIO_ASSET_UPLOAD_INCOMPLETE";
        intent.uploadToken = null;
        intent.uploadLeaseExpiresAt = null;
        intent.claimToken = null;
        intent.leaseExpiresAt = null;
        intent.updatedAt = nextTimestamp(now, intent.updatedAt);
      }
      return null;
    },

    async listAssetUploadIntents(scope) {
      return assetUploadIntents.filter((intent) => intent.workspaceId === scope.workspaceId
        && intent.ownerProfileId === scope.ownerProfileId).map(cloneUploadIntent);
    },

    async claimNextAssetUploadCleanup(at, leaseMs = 120_000) {
      const timestamp = normalizeTimestamp(at);
      const intent = assetUploadIntents.filter((item) =>
        ((item.status === "cleanup_pending" || item.status === "failed")
          && item.nextAttemptAt !== null && item.nextAttemptAt <= timestamp)
        || (item.status === "uploading" && item.uploadLeaseExpiresAt !== null
          && item.uploadLeaseExpiresAt <= timestamp)
        || (item.status === "processing" && item.leaseExpiresAt !== null && item.leaseExpiresAt <= timestamp))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
      if (!intent) return null;
      const existing = assets.find((asset) => asset.workspaceId === intent.workspaceId
        && asset.ownerProfileId === intent.ownerProfileId && asset.objectKey === intent.objectKey
        && asset.lifecycleStatus === "active");
      if (existing) {
        assetUploadIntents.splice(assetUploadIntents.indexOf(intent), 1);
        return null;
      }
      intent.status = "processing";
      intent.storageSessionState = "abort_pending";
      intent.attemptCount += 1;
      intent.nextAttemptAt = null;
      intent.uploadToken = null;
      intent.uploadLeaseExpiresAt = null;
      intent.claimToken = randomUUID();
      intent.leaseExpiresAt = new Date(new Date(timestamp).getTime() + leaseMs).toISOString();
      intent.updatedAt = nextTimestamp(now, intent.updatedAt);
      return cloneUploadIntent(intent);
    },

    async resolveClaimedAssetUploadIntent(input) {
      const intent = assetUploadIntents.find((item) => item.workspaceId === input.scope.workspaceId
        && item.ownerProfileId === input.scope.ownerProfileId && item.id === input.intentId
        && item.status === "processing" && item.claimToken === input.claimToken);
      if (!intent) return null;
      const existing = assets.find((asset) => asset.workspaceId === intent.workspaceId
        && asset.ownerProfileId === intent.ownerProfileId && asset.objectKey === intent.objectKey
        && asset.lifecycleStatus === "active");
      if (!existing) return null;
      assetUploadIntents.splice(assetUploadIntents.indexOf(intent), 1);
      return cloneAsset(existing);
    },

    async failAssetUploadCleanup(input) {
      const intent = assetUploadIntents.find((item) => item.workspaceId === input.scope.workspaceId
        && item.ownerProfileId === input.scope.ownerProfileId && item.id === input.intentId
        && item.status === "processing" && item.claimToken === input.claimToken);
      if (!intent) return null;
      intent.status = "failed";
      intent.lastErrorCode = input.lastErrorCode;
      intent.nextAttemptAt = input.nextAttemptAt;
      intent.claimToken = null;
      intent.leaseExpiresAt = null;
      intent.updatedAt = nextTimestamp(now, intent.updatedAt);
      return cloneUploadIntent(intent);
    },

    async completeAssetUploadCleanup(input) {
      const intentIndex = assetUploadIntents.findIndex((item) => item.workspaceId === input.scope.workspaceId
        && item.ownerProfileId === input.scope.ownerProfileId && item.id === input.intentId
        && item.status === "processing" && item.claimToken === input.claimToken);
      if (intentIndex === -1) return false;
      assetUploadIntents.splice(intentIndex, 1);
      return true;
    },

    async claimNextAsset(at, leaseMs = 120_000) {
      const timestamp = normalizeTimestamp(at);
      for (const item of assets) {
        if (item.lifecycleStatus === "active" && item.extractionStatus === "processing"
          && item.attemptCount >= STUDIO_ASSET_MAX_ATTEMPTS
          && item.leaseExpiresAt !== null && item.leaseExpiresAt <= timestamp) {
          item.extractionStatus = "failed";
          item.lastErrorCode = "STUDIO_ASSET_LEASE_EXPIRED";
          item.nextAttemptAt = null;
          item.claimToken = null;
          item.leaseExpiresAt = null;
          item.updatedAt = nextTimestamp(now, item.updatedAt);
        }
      }
      const asset = assets
        .filter((item) => item.lifecycleStatus === "active")
        .filter((item) => item.attemptCount < STUDIO_ASSET_MAX_ATTEMPTS)
        .filter((item) => item.extractionStatus === "pending"
          || (item.extractionStatus === "failed"
            && item.nextAttemptAt !== null
            && item.nextAttemptAt <= timestamp)
          || (item.extractionStatus === "processing"
            && item.leaseExpiresAt !== null
            && item.leaseExpiresAt <= timestamp))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
      if (!asset) return null;
      asset.extractionStatus = "processing";
      asset.attemptCount += 1;
      asset.nextAttemptAt = null;
      asset.claimToken = randomUUID();
      asset.leaseExpiresAt = new Date(new Date(timestamp).getTime() + leaseMs).toISOString();
      asset.updatedAt = nextTimestamp(now, asset.updatedAt);
      return cloneAsset(asset);
    },

    async finishAssetProcessing(input) {
      const index = assets.findIndex((asset) =>
        asset.workspaceId === input.scope.workspaceId
        && asset.ownerProfileId === input.scope.ownerProfileId
        && asset.id === input.assetId
        && asset.lifecycleStatus === "active"
        && asset.extractionStatus === "processing"
        && asset.claimToken === input.claimToken
      );
      if (index === -1) return null;
      const persisted = assets[index]!;
      const updated: StudioAsset = {
        ...persisted,
        extractionStatus: input.extractionStatus,
        extractedText: input.extractedText,
        extractionMetadata: structuredClone(input.extractionMetadata),
        lastErrorCode: input.lastErrorCode,
        nextAttemptAt: input.nextAttemptAt,
        claimToken: null,
        leaseExpiresAt: null,
        updatedAt: nextTimestamp(now, persisted.updatedAt)
      };
      assets[index] = updated;
      return cloneAsset(updated);
    },

    async retryAssetProcessing(scope, assetId) {
      const asset = assets.find((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId
        && item.id === assetId
        && item.lifecycleStatus === "active");
      if (!asset) return null;
      if (asset.extractionStatus === "failed") {
        asset.extractionStatus = "pending";
        asset.extractedText = null;
        asset.extractionMetadata = {};
        asset.lastErrorCode = null;
        asset.attemptCount = 0;
        asset.nextAttemptAt = null;
        asset.claimToken = null;
        asset.leaseExpiresAt = null;
        asset.updatedAt = nextTimestamp(now, asset.updatedAt);
      }
      return cloneAsset(asset);
    },

    async tombstoneAssetForCleanup(scope, assetId) {
      const asset = assets.find((item) =>
        item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId
        && item.id === assetId
      );
      if (!asset) return null;
      for (let index = assetUploadIntents.length - 1; index >= 0; index -= 1) {
        const intent = assetUploadIntents[index]!;
        if (intent.workspaceId === scope.workspaceId && intent.ownerProfileId === scope.ownerProfileId
          && intent.objectKey === asset.objectKey) assetUploadIntents.splice(index, 1);
      }
      const existing = assetCleanupJobs.find((job) =>
        job.workspaceId === scope.workspaceId
        && job.ownerProfileId === scope.ownerProfileId
        && job.assetId === assetId
      );
      if (existing) return cloneCleanupJob(existing);
      asset.lifecycleStatus = "deleting";
      asset.claimToken = null;
      asset.leaseExpiresAt = null;
      if (asset.extractionStatus === "processing") asset.extractionStatus = "failed";
      asset.updatedAt = nextTimestamp(now, asset.updatedAt);
      const timestamp = now();
      const job: StudioAssetCleanupJob = {
        ...scope,
        id: `studio_asset_cleanup_${randomUUID()}`,
        assetId,
        objectKey: asset.objectKey,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        claimToken: null,
        leaseExpiresAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      assetCleanupJobs.push(job);
      return cloneCleanupJob(job);
    },

    async enqueueOrphanAssetCleanup(input) {
      const existing = assetCleanupJobs.find((job) =>
        job.workspaceId === input.workspaceId
        && job.ownerProfileId === input.ownerProfileId
        && job.objectKey === input.objectKey
      );
      if (existing) return cloneCleanupJob(existing);
      const timestamp = now();
      const job: StudioAssetCleanupJob = {
        workspaceId: input.workspaceId,
        ownerProfileId: input.ownerProfileId,
        id: `studio_asset_cleanup_${randomUUID()}`,
        assetId: null,
        objectKey: input.objectKey,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        claimToken: null,
        leaseExpiresAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      assetCleanupJobs.push(job);
      return cloneCleanupJob(job);
    },

    async listAssetCleanupJobs(scope) {
      return assetCleanupJobs
        .filter((job) => job.workspaceId === scope.workspaceId && job.ownerProfileId === scope.ownerProfileId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
        .map(cloneCleanupJob);
    },

    async claimNextAssetCleanup(at, leaseMs = 120_000) {
      const timestamp = normalizeTimestamp(at);
      const job = assetCleanupJobs
        .filter((item) => item.status === "pending"
          || (item.status === "failed" && item.nextAttemptAt !== null && item.nextAttemptAt <= timestamp)
          || (item.status === "processing" && item.leaseExpiresAt !== null && item.leaseExpiresAt <= timestamp))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
      if (!job) return null;
      job.status = "processing";
      job.attemptCount += 1;
      job.nextAttemptAt = null;
      job.claimToken = randomUUID();
      job.leaseExpiresAt = new Date(new Date(timestamp).getTime() + leaseMs).toISOString();
      job.updatedAt = nextTimestamp(now, job.updatedAt);
      return cloneCleanupJob(job);
    },

    async claimAssetCleanup(scope, jobId, at, leaseMs = 120_000) {
      const timestamp = normalizeTimestamp(at);
      const job = assetCleanupJobs.find((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId && item.id === jobId
        && (item.status === "pending"
          || (item.status === "failed" && item.nextAttemptAt !== null && item.nextAttemptAt <= timestamp)
          || (item.status === "processing" && item.leaseExpiresAt !== null && item.leaseExpiresAt <= timestamp)));
      if (!job) return null;
      job.status = "processing";
      job.attemptCount += 1;
      job.nextAttemptAt = null;
      job.claimToken = randomUUID();
      job.leaseExpiresAt = new Date(new Date(timestamp).getTime() + leaseMs).toISOString();
      job.updatedAt = nextTimestamp(now, job.updatedAt);
      return cloneCleanupJob(job);
    },

    async failAssetCleanup(input) {
      const job = assetCleanupJobs.find((item) =>
        item.workspaceId === input.scope.workspaceId
        && item.ownerProfileId === input.scope.ownerProfileId
        && item.id === input.jobId
        && item.status === "processing"
        && item.claimToken === input.claimToken
      );
      if (!job) return null;
      job.status = "failed";
      job.lastErrorCode = input.lastErrorCode;
      job.nextAttemptAt = input.nextAttemptAt;
      job.claimToken = null;
      job.leaseExpiresAt = null;
      job.updatedAt = nextTimestamp(now, job.updatedAt);
      return cloneCleanupJob(job);
    },

    async completeAssetCleanup(input) {
      const jobIndex = assetCleanupJobs.findIndex((item) =>
        item.workspaceId === input.scope.workspaceId
        && item.ownerProfileId === input.scope.ownerProfileId
        && item.id === input.jobId
        && item.status === "processing"
        && item.claimToken === input.claimToken
      );
      if (jobIndex === -1) return false;
      const job = assetCleanupJobs[jobIndex]!;
      for (let index = assetUploadIntents.length - 1; index >= 0; index -= 1) {
        const intent = assetUploadIntents[index]!;
        if (intent.workspaceId === job.workspaceId && intent.ownerProfileId === job.ownerProfileId
          && intent.objectKey === job.objectKey) assetUploadIntents.splice(index, 1);
      }
      if (job.assetId) {
        const assetIndex = assets.findIndex((asset) =>
          asset.workspaceId === job.workspaceId
          && asset.ownerProfileId === job.ownerProfileId
          && asset.id === job.assetId
          && asset.lifecycleStatus === "deleting"
        );
        if (assetIndex !== -1) assets.splice(assetIndex, 1);
      }
      assetCleanupJobs.splice(jobIndex, 1);
      return true;
    }
  };
}
