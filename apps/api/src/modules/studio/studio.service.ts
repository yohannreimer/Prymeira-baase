import { searchStudioDocuments } from "./studio-search";
import type {
  CreateStudioCollection,
  CreateStudioDocument,
  StudioCollection,
  StudioDocument,
  StudioDocumentQuery,
  StudioHome,
  StudioOwnerScope,
  StudioRepository,
  StudioService,
  UpdateStudioCollection,
  UpdateStudioDocument
} from "./studio.types";

type StudioServiceOptions = {
  now?: () => string;
};

const HOME_DOCUMENT_LIMIT = 10;
const DESIRED_STATE_UPDATE_ATTEMPTS = 3;

function assertActor(scope: StudioOwnerScope, actorProfileId: string) {
  if (actorProfileId !== scope.ownerProfileId) throw new Error("STUDIO_ACTOR_SCOPE_MISMATCH");
}

function normalizeBodyText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizeCollectionName(input: CreateStudioCollection | UpdateStudioCollection) {
  const name = input.name.trim();
  if (!name) throw new Error("STUDIO_COLLECTION_NAME_REQUIRED");
  if (name.length > 120) throw new Error("STUDIO_COLLECTION_NAME_TOO_LONG");
  return name;
}

function currentTimestamp(clock: () => string) {
  const value = clock();
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("STUDIO_CLOCK_INVALID");
  return timestamp.toISOString();
}

async function requireDocument(
  repository: StudioRepository,
  scope: StudioOwnerScope,
  id: string
) {
  const document = await repository.findDocument(scope, id);
  if (!document) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
  return document;
}

async function requireCollection(
  repository: StudioRepository,
  scope: StudioOwnerScope,
  id: string
) {
  const collection = await repository.findCollection(scope, id);
  if (!collection) throw new Error("STUDIO_COLLECTION_NOT_FOUND");
  return collection;
}

async function applyDesiredDocumentState(
  repository: StudioRepository,
  scope: StudioOwnerScope,
  id: string,
  isDesired: (document: StudioDocument) => boolean,
  buildUpdate: (document: StudioDocument) => StudioDocument
) {
  for (let attempt = 0; attempt < DESIRED_STATE_UPDATE_ATTEMPTS; attempt += 1) {
    const current = await requireDocument(repository, scope, id);
    if (isDesired(current)) return current;
    try {
      return await repository.updateDocument(buildUpdate(current), current.revision);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "STUDIO_DOCUMENT_STALE") throw error;
    }
  }

  const current = await requireDocument(repository, scope, id);
  if (isDesired(current)) return current;
  throw new Error("STUDIO_DOCUMENT_STALE");
}

export function createStudioService(
  repository: StudioRepository,
  options: StudioServiceOptions = {}
): StudioService {
  const clock = options.now ?? (() => new Date().toISOString());

  return {
    async readHome(scope): Promise<StudioHome> {
      const [recentDocuments, focusedDocuments, pendingReviewCount] = await Promise.all([
        repository.listRecentDocuments(scope, HOME_DOCUMENT_LIMIT),
        repository.listFocusedDocuments(scope, HOME_DOCUMENT_LIMIT),
        repository.countPendingReviewDocuments(scope)
      ]);

      return {
        recentDocuments,
        focusedDocuments,
        pendingReviewCount,
        nextRituals: []
      };
    },

    listDocuments(scope, query: StudioDocumentQuery) {
      return repository.listDocuments(scope, query);
    },

    getDocument(scope, id) {
      return requireDocument(repository, scope, id);
    },

    async createDocument(scope, actorProfileId, input: CreateStudioDocument, captureKey = null) {
      assertActor(scope, actorProfileId);
      return repository.createDocument({
        ...scope,
        captureKey,
        title: input.title,
        bodyJson: structuredClone(input.body_json),
        bodyText: normalizeBodyText(input.body_text),
        captureMode: input.capture_mode,
        inboxState: "pending_review",
        isFocused: false,
        status: "active"
      });
    },

    async updateDocument(scope, actorProfileId, id, input: UpdateStudioDocument) {
      assertActor(scope, actorProfileId);
      const current = await requireDocument(repository, scope, id);
      if (input.revision !== current.revision) throw new Error("STUDIO_DOCUMENT_STALE");
      return repository.updateDocument({
        ...current,
        title: input.title === undefined ? current.title : input.title,
        bodyJson: input.body_json === undefined
          ? current.bodyJson
          : structuredClone(input.body_json),
        bodyText: input.body_text === undefined
          ? current.bodyText
          : normalizeBodyText(input.body_text),
        captureMode: input.capture_mode ?? current.captureMode,
        inboxState: input.inbox_state ?? current.inboxState,
        isFocused: input.is_focused ?? current.isFocused
      }, current.revision);
    },

    async archiveDocument(scope, actorProfileId, id) {
      assertActor(scope, actorProfileId);
      return applyDesiredDocumentState(
        repository,
        scope,
        id,
        (document) => document.status === "archived",
        (document) => ({
          ...document,
          status: "archived",
          archivedAt: currentTimestamp(clock)
        })
      );
    },

    async restoreDocument(scope, actorProfileId, id) {
      assertActor(scope, actorProfileId);
      return applyDesiredDocumentState(
        repository,
        scope,
        id,
        (document) => document.status === "active" && document.archivedAt === null,
        (document) => ({ ...document, status: "active", archivedAt: null })
      );
    },

    async setFocused(scope, actorProfileId, id, focused) {
      assertActor(scope, actorProfileId);
      return applyDesiredDocumentState(
        repository,
        scope,
        id,
        (document) => document.isFocused === focused,
        (document) => ({ ...document, isFocused: focused })
      );
    },

    async listVersions(scope, id) {
      await requireDocument(repository, scope, id);
      return repository.listVersions(scope, id);
    },

    search(scope, query, limit) {
      return searchStudioDocuments(repository, scope, query, limit);
    },

    listCollections(scope) {
      return repository.listCollections(scope);
    },

    async createCollection(scope, actorProfileId, input) {
      assertActor(scope, actorProfileId);
      return repository.createCollection({ ...scope, name: normalizeCollectionName(input) });
    },

    async renameCollection(scope, actorProfileId, id, input) {
      assertActor(scope, actorProfileId);
      const collection = await requireCollection(repository, scope, id);
      return repository.updateCollection({
        ...collection,
        name: normalizeCollectionName(input)
      });
    },

    async deleteCollection(scope, actorProfileId, id): Promise<StudioCollection> {
      assertActor(scope, actorProfileId);
      const collection = await requireCollection(repository, scope, id);
      if (!await repository.deleteCollection(scope, id)) throw new Error("STUDIO_COLLECTION_NOT_FOUND");
      return collection;
    },

    async addDocumentToCollection(scope, actorProfileId, collectionId, documentId) {
      assertActor(scope, actorProfileId);
      await requireCollection(repository, scope, collectionId);
      await requireDocument(repository, scope, documentId);
      return repository.addCollectionMembership({ ...scope, collectionId, documentId });
    },

    async removeDocumentFromCollection(scope, actorProfileId, collectionId, documentId) {
      assertActor(scope, actorProfileId);
      await requireCollection(repository, scope, collectionId);
      await requireDocument(repository, scope, documentId);
      return repository.removeCollectionMembership(scope, collectionId, documentId);
    },

    async relateDocuments(scope, actorProfileId, sourceDocumentId, targetDocumentId, relationType) {
      assertActor(scope, actorProfileId);
      if (sourceDocumentId === targetDocumentId) throw new Error("STUDIO_RELATION_SELF_INVALID");
      await Promise.all([
        requireDocument(repository, scope, sourceDocumentId),
        requireDocument(repository, scope, targetDocumentId)
      ]);
      return repository.createRelation({
        ...scope,
        sourceDocumentId,
        targetDocumentId,
        relationType,
        createdByProfileId: actorProfileId
      });
    }
  };
}
