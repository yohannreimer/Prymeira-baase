import { randomUUID } from "node:crypto";
import type {
  StudioCollection,
  StudioCollectionMembership,
  StudioAsset,
  StudioDocument,
  StudioDocumentVersion,
  StudioRepository
} from "./studio.types";
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
        id: `studio_asset_${randomUUID()}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      assets.push(asset);
      return cloneAsset(asset);
    },

    async deleteAsset(scope, assetId) {
      const index = assets.findIndex((asset) =>
        asset.workspaceId === scope.workspaceId
        && asset.ownerProfileId === scope.ownerProfileId
        && asset.id === assetId
      );
      if (index === -1) return false;
      assets.splice(index, 1);
      return true;
    },

    async claimNextAsset(at) {
      const timestamp = normalizeTimestamp(at);
      const asset = assets
        .filter((item) => item.extractionStatus === "pending" || (
          item.extractionStatus === "failed"
          && item.nextAttemptAt !== null
          && item.nextAttemptAt <= timestamp
        ))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
      if (!asset) return null;
      asset.extractionStatus = "processing";
      asset.attemptCount += 1;
      asset.nextAttemptAt = null;
      asset.updatedAt = nextTimestamp(now, asset.updatedAt);
      return cloneAsset(asset);
    },

    async updateAssetExtraction(input) {
      const index = assets.findIndex((asset) =>
        asset.workspaceId === input.workspaceId
        && asset.ownerProfileId === input.ownerProfileId
        && asset.id === input.id
      );
      if (index === -1) throw new Error("STUDIO_ASSET_NOT_FOUND");
      const persisted = assets[index]!;
      const updated: StudioAsset = {
        ...persisted,
        extractionStatus: input.extractionStatus,
        extractedText: input.extractedText,
        extractionMetadata: structuredClone(input.extractionMetadata),
        lastErrorCode: input.lastErrorCode,
        attemptCount: input.attemptCount,
        nextAttemptAt: input.nextAttemptAt,
        updatedAt: nextTimestamp(now, persisted.updatedAt)
      };
      assets[index] = updated;
      return cloneAsset(updated);
    }
  };
}
