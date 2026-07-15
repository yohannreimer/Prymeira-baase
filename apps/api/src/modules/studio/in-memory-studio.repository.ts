import { randomUUID } from "node:crypto";
import type {
  StudioCollection,
  StudioCollectionMembership,
  StudioAsset,
  StudioAssetCleanupJob,
  StudioAssetUploadIntent,
  StudioDocument,
  StudioDocumentVersion,
  StudioIndexJob,
  StudioRelation,
  StudioConversation,
  StudioMessage,
  StudioSuggestion,
  StudioCitation,
  StudioStructure,
  StudioRitualSession,
  StudioNextRitual,
  CreateStudioCitation,
  StudioRepository
} from "./studio.types";
import { STUDIO_ASSET_MAX_ATTEMPTS } from "./studio.types";
import { studioSearchScore } from "./studio-search";
import type { StudioPortabilityRepositoryHooks, StudioPortabilitySnapshot } from "./studio-portability.service";

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

function cloneRelation(relation: StudioRelation): StudioRelation {
  return structuredClone(relation);
}

function cloneIndexJob(job: StudioIndexJob): StudioIndexJob {
  return structuredClone(job);
}

function cloneConversation(value: StudioConversation) { return structuredClone(value); }
function cloneMessage(value: StudioMessage) { return structuredClone(value); }
function cloneSuggestion(value: StudioSuggestion) { return structuredClone(value); }
function cloneCitation(value: StudioCitation) { return structuredClone(value); }
function cloneStructure(value: StudioStructure) { return structuredClone(value); }
function cloneRitualSession(value: StudioRitualSession) { return structuredClone(value); }

function nextRitualTitle(document: StudioDocument, structure: StudioStructure) {
  const intention = structure.propertiesJson.intention;
  return document.title?.trim()
    || (typeof intention === "string" ? intention.trim() : "")
    || "Ritual privado";
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
): StudioRepository & StudioPortabilityRepositoryHooks {
  const documents: StudioDocument[] = [];
  const versions: StudioDocumentVersion[] = [];
  const collections: StudioCollection[] = [];
  const memberships: StudioCollectionMembership[] = [];
  const assets: StudioAsset[] = [];
  const assetCleanupJobs: StudioAssetCleanupJob[] = [];
  const assetUploadIntents: StudioAssetUploadIntent[] = [];
  const relations: StudioRelation[] = [];
  const indexJobs: StudioIndexJob[] = [];
  const conversations: StudioConversation[] = [];
  const messages: StudioMessage[] = [];
  const suggestions: StudioSuggestion[] = [];
  const citations: StudioCitation[] = [];
  const structures: StudioStructure[] = [];
  const ritualSessions: StudioRitualSession[] = [];
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
    indexJobs.push({
      workspaceId: version.workspaceId,
      ownerProfileId: version.ownerProfileId,
      id: `studio_index_job_${randomUUID()}`,
      documentId: version.documentId,
      versionId: version.id,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: timestamp,
      lastErrorCode: null,
      claimToken: null,
      leaseExpiresAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return cloneVersion(version);
  }

  function requireConversation(workspaceId: string, ownerProfileId: string, conversationId: string) {
    const conversation = conversations.find((item) => item.workspaceId === workspaceId
      && item.ownerProfileId === ownerProfileId && item.id === conversationId);
    if (!conversation) throw new Error("STUDIO_CONVERSATION_NOT_FOUND");
    return conversation;
  }

  function validateCitationScope(input: CreateStudioCitation, workspaceId: string, ownerProfileId: string) {
    if (input.workspaceId !== workspaceId || input.ownerProfileId !== ownerProfileId) {
      throw new Error("STUDIO_ACTOR_SCOPE_MISMATCH");
    }
  }

  function storeCitations(
    inputs: CreateStudioCitation[],
    target: { messageId: string | null; suggestionId: string | null },
    createdAt: string
  ) {
    return inputs.map((input) => {
      const citation: StudioCitation = {
        ...structuredClone(input),
        id: `studio_citation_${randomUUID()}`,
        ...target,
        createdAt
      };
      citations.push(citation);
      return cloneCitation(citation);
    });
  }

  return {
    async readPortabilitySnapshot(scope) {
      const scoped = <T extends { workspaceId: string; ownerProfileId: string }>(values: T[]) => values
        .filter((value) => value.workspaceId === scope.workspaceId && value.ownerProfileId === scope.ownerProfileId)
        .map((value) => structuredClone(value));
      return {
        ...scope,
        documents: scoped(documents),
        versions: scoped(versions),
        assets: scoped(assets),
        structures: scoped(structures),
        collections: scoped(collections),
        collectionItems: scoped(memberships),
        ritualSessions: scoped(ritualSessions),
        conversations: scoped(conversations),
        messages: scoped(messages),
        suggestions: scoped(suggestions),
        citations: scoped(citations),
        relations: scoped(relations),
        memoryRows: [],
        privateObjectKeys: [
          ...scoped(assets).flatMap((asset) => asset.objectKey ? [asset.objectKey] : []),
          ...scoped(assetUploadIntents).map((intent) => intent.objectKey),
          ...scoped(assetCleanupJobs).flatMap((job) => job.objectKey ? [job.objectKey] : [])
        ],
        activeUploads: scoped(assetUploadIntents).flatMap((intent) => intent.storageUploadId
          ? [{ objectKey: intent.objectKey, storageUploadId: intent.storageUploadId }]
          : [])
      } satisfies StudioPortabilitySnapshot;
    },

    async deletePortabilityData(scope) {
      for (const values of [
        citations, messages, suggestions, conversations, ritualSessions, structures, relations, indexJobs,
        memberships, collections, assetCleanupJobs, assetUploadIntents, assets, versions, documents
      ]) {
        for (let index = values.length - 1; index >= 0; index -= 1) {
          const value = values[index] as { workspaceId: string; ownerProfileId: string };
          if (value.workspaceId === scope.workspaceId && value.ownerProfileId === scope.ownerProfileId) values.splice(index, 1);
        }
      }
    },

    async listDocuments(scope, input) {
      const cursor = input.cursor ? decodeCursor(input.cursor) : null;
      const matches = documents
        .filter((document) => document.workspaceId === scope.workspaceId)
        .filter((document) => document.ownerProfileId === scope.ownerProfileId)
        .filter((document) => !input.status || document.status === input.status)
        .filter((document) => !input.inboxState || document.inboxState === input.inboxState)
        .filter((document) => !input.collectionId || memberships.some((membership) =>
          membership.workspaceId === scope.workspaceId
          && membership.ownerProfileId === scope.ownerProfileId
          && membership.collectionId === input.collectionId
          && membership.documentId === document.id
        ))
        .filter((document) => !cursor || isAfterCursor(document, cursor))
        .sort(compareDocuments);
      const page = matches.slice(0, input.limit);
      const items = page.map(cloneDocument);
      const collectionsByDocumentId = Object.fromEntries(items.map((document) => [document.id, collections
        .filter((collection) => collection.workspaceId === scope.workspaceId && collection.ownerProfileId === scope.ownerProfileId)
        .filter((collection) => memberships.some((membership) => membership.workspaceId === scope.workspaceId
          && membership.ownerProfileId === scope.ownerProfileId && membership.documentId === document.id
          && membership.collectionId === collection.id))
        .sort(compareCollections).map(cloneCollection)]));
      return {
        items,
        nextCursor: matches.length > page.length && page.length > 0
          ? encodeCursor(page[page.length - 1]!)
          : null,
        collectionsByDocumentId
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
      if (input.captureKey) {
        const existing = documents.find((document) =>
          document.workspaceId === input.workspaceId
          && document.ownerProfileId === input.ownerProfileId
          && document.captureKey === input.captureKey
          && document.status === "active"
        );
        if (existing) return cloneDocument(existing);
      }
      const timestamp = now();
      const document: StudioDocument = {
        ...structuredClone(input),
        id: `studio_document_${randomUUID()}`,
        captureKey: input.captureKey ?? null,
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
      if (input.status === "active" && input.captureKey && documents.some((document) =>
        document.workspaceId === input.workspaceId
        && document.ownerProfileId === input.ownerProfileId
        && document.id !== input.id
        && document.captureKey === input.captureKey
        && document.status === "active"
      )) throw new Error("STUDIO_DOCUMENT_CAPTURE_KEY_ACTIVE");

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

    async findStructure(scope, structureId) {
      const structure = structures.find((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId && item.id === structureId);
      return structure ? cloneStructure(structure) : null;
    },

    async createStructure(input) {
      const documentExists = documents.some((document) => document.workspaceId === input.workspaceId
        && document.ownerProfileId === input.ownerProfileId && document.id === input.documentId);
      if (!documentExists) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
      if (structures.some((structure) => structure.workspaceId === input.workspaceId
        && structure.ownerProfileId === input.ownerProfileId && structure.documentId === input.documentId
        && structure.kind === input.kind && structure.lifecycleStatus === "active")) {
        throw new Error("STUDIO_STRUCTURE_ACTIVE_DUPLICATE");
      }
      const timestamp = now();
      const structure: StudioStructure = {
        ...structuredClone(input), id: `studio_structure_${randomUUID()}`, revision: 1,
        createdAt: timestamp, updatedAt: timestamp, archivedAt: null
      };
      structures.push(structure);
      return cloneStructure(structure);
    },

    async updateStructure(input, expectedRevision) {
      const index = structures.findIndex((structure) => structure.workspaceId === input.workspaceId
        && structure.ownerProfileId === input.ownerProfileId && structure.id === input.id);
      if (index < 0) throw new Error("STUDIO_STRUCTURE_NOT_FOUND");
      const persisted = structures[index]!;
      if (persisted.revision !== expectedRevision) throw new Error("STUDIO_STRUCTURE_STALE");
      if (input.lifecycleStatus === "active" && structures.some((structure) => structure.workspaceId === input.workspaceId
        && structure.ownerProfileId === input.ownerProfileId && structure.id !== input.id
        && structure.documentId === input.documentId && structure.kind === input.kind
        && structure.lifecycleStatus === "active")) throw new Error("STUDIO_STRUCTURE_ACTIVE_DUPLICATE");
      const updated: StudioStructure = {
        ...persisted,
        lifecycleStatus: input.lifecycleStatus,
        horizonAt: input.horizonAt,
        metricJson: structuredClone(input.metricJson),
        cadenceJson: structuredClone(input.cadenceJson),
        nextRunAt: input.nextRunAt,
        propertiesJson: structuredClone(input.propertiesJson),
        archivedAt: input.archivedAt,
        revision: persisted.revision + 1,
        createdAt: persisted.createdAt, updatedAt: nextTimestamp(now, persisted.updatedAt)
      };
      structures[index] = updated;
      return cloneStructure(updated);
    },

    async listStructures(scope, input) {
      let cursor: { createdAt: string; id: string } | null = null;
      if (input.cursor) {
        try {
          const parsed = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== 2
            || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" || !parsed.id
            || new Date(parsed.createdAt).toISOString() !== parsed.createdAt
            || Buffer.from(JSON.stringify(parsed)).toString("base64url") !== input.cursor) throw new Error();
          cursor = { createdAt: parsed.createdAt, id: parsed.id };
        } catch { throw new Error("STUDIO_STRUCTURE_CURSOR_INVALID"); }
      }
      const appliedCursor: { createdAt: string; id: string } | null = cursor;
      const matches = structures.filter((structure) => structure.workspaceId === scope.workspaceId
        && structure.ownerProfileId === scope.ownerProfileId)
        .filter((structure) => !input.documentId || structure.documentId === input.documentId)
        .filter((structure) => !input.kind || structure.kind === input.kind)
        .filter((structure) => !input.lifecycleStatus || structure.lifecycleStatus === input.lifecycleStatus)
        .filter((structure) => !appliedCursor || structure.createdAt < appliedCursor.createdAt
          || (structure.createdAt === appliedCursor.createdAt && structure.id < appliedCursor.id))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
      const page = matches.slice(0, input.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((structure) => {
          const document = documents.find((candidate) => candidate.workspaceId === scope.workspaceId
            && candidate.ownerProfileId === scope.ownerProfileId
            && candidate.id === structure.documentId);
          if (!document) throw new Error("STUDIO_STRUCTURE_DOCUMENT_NOT_FOUND");
          return { ...cloneStructure(structure), documentTitle: document.title };
        }),
        nextCursor: matches.length > page.length && last
          ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString("base64url")
          : null
      };
    },

    async findRitualSession(scope, sessionId) {
      const session = ritualSessions.find((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId && item.id === sessionId);
      return session ? cloneRitualSession(session) : null;
    },

    async createRitualSession(input) {
      const ritualExists = structures.some((structure) => structure.workspaceId === input.workspaceId
        && structure.ownerProfileId === input.ownerProfileId && structure.id === input.ritualId
        && structure.kind === "ritual" && structure.lifecycleStatus === "active");
      if (!ritualExists) throw new Error("STUDIO_RITUAL_NOT_FOUND");
      const open = ritualSessions.find((session) => session.workspaceId === input.workspaceId
        && session.ownerProfileId === input.ownerProfileId && session.ritualId === input.ritualId
        && session.status !== "completed");
      if (open) return cloneRitualSession(open);
      const timestamp = now();
      const session: StudioRitualSession = {
        ...input,
        id: `studio_ritual_session_${randomUUID()}`,
        status: "preparing",
        revision: 1,
        contextJson: null,
        preparationJson: null,
        answersJson: {},
        synthesisJson: null,
        prepareAiRunId: null,
        synthesisAiRunId: null,
        preparationToken: input.preparationToken,
        preparationLeaseExpiresAt: input.preparationLeaseExpiresAt,
        synthesisToken: null,
        synthesisLeaseExpiresAt: null,
        synthesisFailureCode: null,
        failureCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null
      };
      ritualSessions.push(session);
      return cloneRitualSession(session);
    },

    async updateRitualSession(input, expectedRevision) {
      const index = ritualSessions.findIndex((session) => session.workspaceId === input.workspaceId
        && session.ownerProfileId === input.ownerProfileId && session.id === input.id);
      if (index < 0) throw new Error("STUDIO_RITUAL_SESSION_NOT_FOUND");
      const persisted = ritualSessions[index]!;
      if (persisted.revision !== expectedRevision) throw new Error("STUDIO_RITUAL_SESSION_STALE");
      if (persisted.status === "completed" && input.status !== "completed") {
        throw new Error("STUDIO_RITUAL_SESSION_COMPLETED");
      }
      const updated: StudioRitualSession = {
        ...structuredClone(input),
        revision: persisted.revision + 1,
        createdAt: persisted.createdAt,
        updatedAt: nextTimestamp(now, persisted.updatedAt)
      };
      ritualSessions[index] = updated;
      return cloneRitualSession(updated);
    },

    async listRitualSessions(scope, ritualId, input) {
      let cursor: { createdAt: string; id: string } | null = null;
      if (input.cursor) {
        try {
          const parsed = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== 2
            || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" || !parsed.id
            || new Date(parsed.createdAt).toISOString() !== parsed.createdAt
            || Buffer.from(JSON.stringify(parsed)).toString("base64url") !== input.cursor) throw new Error();
          cursor = { createdAt: parsed.createdAt, id: parsed.id };
        } catch { throw new Error("STUDIO_RITUAL_SESSION_CURSOR_INVALID"); }
      }
      const appliedCursor = cursor;
      const matches = ritualSessions.filter((session) => session.workspaceId === scope.workspaceId
        && session.ownerProfileId === scope.ownerProfileId && session.ritualId === ritualId)
        .filter((session) => !appliedCursor || session.createdAt < appliedCursor.createdAt
          || (session.createdAt === appliedCursor.createdAt && session.id < appliedCursor.id))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
      const page = matches.slice(0, input.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(cloneRitualSession),
        nextCursor: matches.length > page.length && last
          ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString("base64url")
          : null
      };
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

    async listNextRituals(scope, limit, scheduledAfter): Promise<StudioNextRitual[]> {
      return structures
        .filter((structure) => structure.workspaceId === scope.workspaceId)
        .filter((structure) => structure.ownerProfileId === scope.ownerProfileId)
        .filter((structure) => structure.kind === "ritual"
          && structure.lifecycleStatus === "active"
          && structure.nextRunAt !== null
          && structure.nextRunAt > scheduledAfter)
        .flatMap((structure) => {
          const document = documents.find((candidate) => candidate.workspaceId === scope.workspaceId
            && candidate.ownerProfileId === scope.ownerProfileId
            && candidate.id === structure.documentId
            && candidate.status === "active");
          return document && structure.nextRunAt && structure.cadenceJson
            ? [{
              id: structure.id,
              title: nextRitualTitle(document, structure),
              scheduledFor: structure.nextRunAt,
              timezone: structure.cadenceJson.timezone
            }]
            : [];
        })
        .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor) || left.id.localeCompare(right.id))
        .slice(0, limit);
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

    async listDocumentCollectionsBatch(scope, documentIds) {
      const allowed = new Set(documentIds);
      const result: Record<string, StudioCollection[]> = Object.fromEntries(documentIds.map((id) => [id, []]));
      for (const documentId of allowed) result[documentId] = collections
        .filter((collection) => collection.workspaceId === scope.workspaceId && collection.ownerProfileId === scope.ownerProfileId)
        .filter((collection) => memberships.some((membership) => membership.workspaceId === scope.workspaceId
          && membership.ownerProfileId === scope.ownerProfileId && membership.documentId === documentId
          && membership.collectionId === collection.id))
        .sort(compareCollections).map(cloneCollection);
      return result;
    },

    async listDocumentAssets(scope, documentId) {
      return assets
        .filter((asset) => asset.workspaceId === scope.workspaceId)
        .filter((asset) => asset.ownerProfileId === scope.ownerProfileId)
        .filter((asset) => asset.documentId === documentId)
        .filter((asset) => asset.lifecycleStatus === "active")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
        .map(cloneAsset);
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
      if (input.idempotencyKey) {
        const existing = assets.find((asset) => asset.workspaceId === input.workspaceId
          && asset.ownerProfileId === input.ownerProfileId
          && asset.documentId === input.documentId
          && asset.idempotencyKey === input.idempotencyKey
          && asset.lifecycleStatus === "active");
        if (existing) return cloneAsset(existing);
      }
      const timestamp = now();
      const asset: StudioAsset = {
        ...structuredClone(input),
        idempotencyKey: input.idempotencyKey ?? null,
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

    async findAssetByIdempotencyKey(scope, documentId, idempotencyKey) {
      const asset = assets.find((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId
        && item.documentId === documentId
        && item.idempotencyKey === idempotencyKey
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
      const idempotent = input.asset.idempotencyKey
        ? assets.find((asset) => asset.workspaceId === intent.workspaceId
          && asset.ownerProfileId === intent.ownerProfileId
          && asset.documentId === intent.documentId
          && asset.idempotencyKey === input.asset.idempotencyKey
          && asset.lifecycleStatus === "active")
        : undefined;
      if (idempotent) {
        if (idempotent.objectKey !== intent.objectKey) {
          const existingCleanup = assetCleanupJobs.some((job) => job.workspaceId === intent.workspaceId
            && job.ownerProfileId === intent.ownerProfileId && job.objectKey === intent.objectKey);
          if (!existingCleanup) {
            const timestamp = now();
            assetCleanupJobs.push({
              workspaceId: intent.workspaceId, ownerProfileId: intent.ownerProfileId,
              id: `studio_asset_cleanup_${randomUUID()}`, assetId: null, objectKey: intent.objectKey,
              status: "pending", attemptCount: 0, nextAttemptAt: null, lastErrorCode: null,
              claimToken: null, leaseExpiresAt: null, createdAt: timestamp, updatedAt: timestamp
            });
          }
        }
        assetUploadIntents.splice(intentIndex, 1);
        return cloneAsset(idempotent);
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
        idempotencyKey: input.asset.idempotencyKey ?? null,
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

    async claimNextAssetUploadCleanup(at, leaseMs = 120_000, excludeOwnerKeys = []) {
      const timestamp = normalizeTimestamp(at);
      const dueSnapshot = assetUploadIntents
        .filter((item) => !isExcludedOwner(item, excludeOwnerKeys))
        .filter((item) => ((item.status === "cleanup_pending" || item.status === "failed")
          && item.nextAttemptAt !== null && item.nextAttemptAt <= timestamp)
        || (item.status === "uploading" && item.uploadLeaseExpiresAt !== null
          && item.uploadLeaseExpiresAt <= timestamp)
        || (item.status === "processing" && item.leaseExpiresAt !== null && item.leaseExpiresAt <= timestamp))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      // Scan only the snapshot captured at entry. Resolved rows are compacted,
      // while a concurrently growing backlog cannot turn this into an infinite loop.
      for (const intent of dueSnapshot) {
        const existing = assets.find((asset) => asset.workspaceId === intent.workspaceId
          && asset.ownerProfileId === intent.ownerProfileId && asset.objectKey === intent.objectKey
          && asset.lifecycleStatus === "active");
        if (existing) {
          const index = assetUploadIntents.indexOf(intent);
          if (index >= 0) assetUploadIntents.splice(index, 1);
          continue;
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
      }
      return null;
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

    async claimNextAsset(at, leaseMs = 120_000, excludeOwnerKeys = []) {
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
        .filter((item) => !isExcludedOwner(item, excludeOwnerKeys))
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

    async claimNextAssetCleanup(at, leaseMs = 120_000, excludeOwnerKeys = []) {
      const timestamp = normalizeTimestamp(at);
      const job = assetCleanupJobs
        .filter((item) => !isExcludedOwner(item, excludeOwnerKeys))
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
    },

    async createRelation(input) {
      if (input.createdByProfileId !== input.ownerProfileId) throw new Error("STUDIO_ACTOR_SCOPE_MISMATCH");
      if (input.sourceDocumentId === input.targetDocumentId) throw new Error("STUDIO_RELATION_SELF_INVALID");
      const owns = (id: string) => documents.some((document) =>
        document.workspaceId === input.workspaceId
        && document.ownerProfileId === input.ownerProfileId
        && document.id === id
      );
      if (!owns(input.sourceDocumentId) || !owns(input.targetDocumentId)) {
        throw new Error("STUDIO_RELATION_DOCUMENT_NOT_FOUND");
      }
      const existing = relations.find((relation) =>
        relation.workspaceId === input.workspaceId
        && relation.ownerProfileId === input.ownerProfileId
        && relation.sourceDocumentId === input.sourceDocumentId
        && relation.targetDocumentId === input.targetDocumentId
        && relation.relationType === input.relationType
      );
      if (existing) return cloneRelation(existing);
      const relation: StudioRelation = {
        ...structuredClone(input),
        id: `studio_relation_${randomUUID()}`,
        createdAt: now()
      };
      relations.push(relation);
      return cloneRelation(relation);
    },

    async listRelations(scope, documentId) {
      return relations
        .filter((relation) => relation.workspaceId === scope.workspaceId)
        .filter((relation) => relation.ownerProfileId === scope.ownerProfileId)
        .filter((relation) => !documentId
          || relation.sourceDocumentId === documentId
          || relation.targetDocumentId === documentId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
        .map(cloneRelation);
    },

    async listIndexJobs(scope) {
      return indexJobs
        .filter((job) => job.workspaceId === scope.workspaceId && job.ownerProfileId === scope.ownerProfileId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
        .map(cloneIndexJob);
    },

    async claimNextIndexJob(at, leaseMs = 60_000, maxAttempts = 5, excludeOwnerKeys = []) {
      const timestamp = normalizeTimestamp(at);
      const timestampMs = new Date(timestamp).getTime();
      for (const job of indexJobs) {
        const due = (job.status === "pending" || job.status === "failed")
          ? job.nextAttemptAt !== null && new Date(job.nextAttemptAt).getTime() <= timestampMs
          : job.status === "processing" && job.leaseExpiresAt !== null
            && new Date(job.leaseExpiresAt).getTime() <= timestampMs;
        if (due && job.attemptCount >= maxAttempts) {
          job.status = "failed";
          job.nextAttemptAt = null;
          job.claimToken = null;
          job.leaseExpiresAt = null;
          job.lastErrorCode = "STUDIO_MEMORY_INDEX_MAX_ATTEMPTS";
          job.updatedAt = timestamp;
        }
      }
      const eligible = indexJobs
        .filter((job) => !isExcludedOwner(job, excludeOwnerKeys))
        .filter((job) => job.attemptCount < maxAttempts)
        .filter((job) => (job.status === "pending" || job.status === "failed")
          ? job.nextAttemptAt !== null && new Date(job.nextAttemptAt).getTime() <= timestampMs
          : job.status === "processing" && job.leaseExpiresAt !== null
            && new Date(job.leaseExpiresAt).getTime() <= timestampMs)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
      if (!eligible) return null;
      eligible.status = "processing";
      eligible.attemptCount += 1;
      eligible.nextAttemptAt = null;
      eligible.lastErrorCode = null;
      eligible.claimToken = `studio_index_claim_${randomUUID()}`;
      eligible.leaseExpiresAt = new Date(timestampMs + leaseMs).toISOString();
      eligible.updatedAt = timestamp;
      return cloneIndexJob(eligible);
    },

    async renewIndexJobLease(input) {
      const inputNow = normalizeTimestamp(input.now);
      const leaseExpiresAt = normalizeTimestamp(input.leaseExpiresAt);
      const job = indexJobs.find((candidate) =>
        candidate.workspaceId === input.workspaceId
        && candidate.ownerProfileId === input.ownerProfileId
        && candidate.id === input.jobId
        && candidate.status === "processing"
        && candidate.claimToken === input.claimToken
        && candidate.leaseExpiresAt !== null
        && candidate.leaseExpiresAt > inputNow
      );
      if (!job) return false;
      job.leaseExpiresAt = leaseExpiresAt;
      job.updatedAt = inputNow;
      return true;
    },

    async completeIndexJob(input) {
      const job = indexJobs.find((candidate) =>
        candidate.workspaceId === input.workspaceId
        && candidate.ownerProfileId === input.ownerProfileId
        && candidate.id === input.jobId
        && candidate.status === "processing"
        && candidate.claimToken === input.claimToken
        && candidate.leaseExpiresAt !== null
        && candidate.leaseExpiresAt > now()
      );
      if (!job) return false;
      job.status = "completed";
      job.claimToken = null;
      job.leaseExpiresAt = null;
      job.nextAttemptAt = null;
      job.updatedAt = now();
      return true;
    },

    async failIndexJob(input) {
      const job = indexJobs.find((candidate) =>
        candidate.workspaceId === input.workspaceId
        && candidate.ownerProfileId === input.ownerProfileId
        && candidate.id === input.jobId
        && candidate.status === "processing"
        && candidate.claimToken === input.claimToken
        && candidate.leaseExpiresAt !== null
        && candidate.leaseExpiresAt > now()
      );
      if (!job) return null;
      job.status = "failed";
      job.claimToken = null;
      job.leaseExpiresAt = null;
      job.lastErrorCode = input.lastErrorCode;
      job.nextAttemptAt = input.nextAttemptAt;
      job.updatedAt = now();
      return cloneIndexJob(job);
    },

    async startAssistantTurn(input) {
      let conversation: StudioConversation;
      if (input.conversationId) {
        conversation = requireConversation(input.workspaceId, input.ownerProfileId, input.conversationId);
        if (input.documentId !== null && input.documentId !== conversation.documentId) {
          throw new Error("STUDIO_CONVERSATION_DOCUMENT_MISMATCH");
        }
      } else {
        if (input.documentId && !documents.some((item) => item.workspaceId === input.workspaceId
          && item.ownerProfileId === input.ownerProfileId && item.id === input.documentId)) {
          throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        }
        const timestamp = now();
        conversation = {
          workspaceId: input.workspaceId,
          ownerProfileId: input.ownerProfileId,
          id: `studio_conversation_${randomUUID()}`,
          documentId: input.documentId,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        conversations.push(conversation);
      }
      const timestamp = nextTimestamp(now, conversation.updatedAt);
      const message: StudioMessage = {
        workspaceId: input.workspaceId,
        ownerProfileId: input.ownerProfileId,
        id: `studio_message_${randomUUID()}`,
        conversationId: conversation.id,
        role: "user",
        content: input.content,
        aiRunId: null,
        status: "complete",
        createdAt: timestamp
      };
      messages.push(message);
      conversation.updatedAt = timestamp;
      return { conversation: cloneConversation(conversation), message: cloneMessage(message) };
    },

    async listConversationMessages(scope, conversationId, limit) {
      requireConversation(scope.workspaceId, scope.ownerProfileId, conversationId);
      return messages.filter((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId && item.conversationId === conversationId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
        .slice(0, limit)
        .reverse()
        .map(cloneMessage);
    },

    async finishAssistantTurn(input) {
      const conversation = requireConversation(input.workspaceId, input.ownerProfileId, input.conversationId);
      input.citations.forEach((citation) => validateCitationScope(citation, input.workspaceId, input.ownerProfileId));
      const timestamp = nextTimestamp(now, conversation.updatedAt);
      const message: StudioMessage = {
        workspaceId: input.workspaceId,
        ownerProfileId: input.ownerProfileId,
        id: `studio_message_${randomUUID()}`,
        conversationId: input.conversationId,
        role: "assistant",
        content: input.content,
        aiRunId: input.aiRunId,
        status: "complete",
        createdAt: timestamp
      };
      messages.push(message);
      const storedCitations = storeCitations(input.citations, { messageId: message.id, suggestionId: null }, timestamp);
      conversation.updatedAt = timestamp;
      return { message: cloneMessage(message), citations: storedCitations };
    },

    async createAssistantSuggestion(input) {
      if (input.conversationId) requireConversation(input.workspaceId, input.ownerProfileId, input.conversationId);
      if (input.documentId && !documents.some((item) => item.workspaceId === input.workspaceId
        && item.ownerProfileId === input.ownerProfileId && item.id === input.documentId)) {
        throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
      }
      if (input.payloadJson.proposal.document_id !== input.documentId) throw new Error("STUDIO_SUGGESTION_DOCUMENT_MISMATCH");
      input.citations.forEach((citation) => validateCitationScope(citation, input.workspaceId, input.ownerProfileId));
      const timestamp = now();
      const suggestion: StudioSuggestion = {
        workspaceId: input.workspaceId,
        ownerProfileId: input.ownerProfileId,
        id: `studio_suggestion_${randomUUID()}`,
        documentId: input.documentId,
        conversationId: input.conversationId,
        aiRunId: input.aiRunId,
        kind: input.kind,
        payloadJson: structuredClone(input.payloadJson),
        status: "pending",
        acceptedVersionId: null,
        createdAt: timestamp,
        decidedAt: null
      };
      suggestions.push(suggestion);
      const storedCitations = storeCitations(input.citations, { messageId: null, suggestionId: suggestion.id }, timestamp);
      return { suggestion: cloneSuggestion(suggestion), citations: storedCitations };
    },

    async findSuggestion(scope, suggestionId) {
      const suggestion = suggestions.find((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId && item.id === suggestionId);
      return suggestion ? cloneSuggestion(suggestion) : null;
    },

    async acceptSuggestion(scope, suggestionId, actorProfileId, proposalOverride) {
      if (actorProfileId !== scope.ownerProfileId) throw new Error("STUDIO_ACTOR_SCOPE_MISMATCH");
      const suggestion = suggestions.find((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId && item.id === suggestionId);
      if (!suggestion) throw new Error("STUDIO_SUGGESTION_NOT_FOUND");
      if (suggestion.status === "accepted") {
        const version = versions.find((item) => item.workspaceId === scope.workspaceId
          && item.ownerProfileId === scope.ownerProfileId && item.id === suggestion.acceptedVersionId);
        if (!version) throw new Error("STUDIO_SUGGESTION_VERSION_NOT_FOUND");
        return { suggestion: cloneSuggestion(suggestion), version: cloneVersion(version) };
      }
      if (suggestion.status !== "pending") throw new Error("STUDIO_SUGGESTION_ALREADY_DECIDED");
      const payload = proposalOverride ?? suggestion.payloadJson.proposal;
      if (payload.document_id !== suggestion.documentId
        || payload.expected_revision !== suggestion.payloadJson.proposal.expected_revision) {
        throw new Error("STUDIO_SUGGESTION_DOCUMENT_MISMATCH");
      }
      const documentIndex = documents.findIndex((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId && item.id === payload.document_id);
      if (documentIndex < 0) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
      const document = documents[documentIndex]!;
      if (document.revision !== payload.expected_revision) throw new Error("STUDIO_DOCUMENT_STALE");
      const timestamp = nextTimestamp(now, document.updatedAt);
      const updated: StudioDocument = {
        ...document,
        title: payload.title,
        bodyJson: structuredClone(payload.body_json),
        bodyText: payload.body_text,
        revision: document.revision + 1,
        updatedAt: timestamp
      };
      documents[documentIndex] = updated;
      const version = appendStoredVersion({
        ...scope,
        documentId: document.id,
        bodyJson: payload.body_json,
        bodyText: payload.body_text,
        origin: "accepted_ai_suggestion",
        actorProfileId,
        aiRunId: suggestion.aiRunId
      }, timestamp);
      suggestion.status = "accepted";
      suggestion.acceptedVersionId = version.id;
      suggestion.decidedAt = timestamp;
      return { suggestion: cloneSuggestion(suggestion), version };
    },

    async dismissSuggestion(scope, suggestionId) {
      const suggestion = suggestions.find((item) => item.workspaceId === scope.workspaceId
        && item.ownerProfileId === scope.ownerProfileId && item.id === suggestionId);
      if (!suggestion) throw new Error("STUDIO_SUGGESTION_NOT_FOUND");
      if (suggestion.status === "dismissed") return { suggestion: cloneSuggestion(suggestion), version: null };
      if (suggestion.status !== "pending") throw new Error("STUDIO_SUGGESTION_ALREADY_DECIDED");
      suggestion.status = "dismissed";
      suggestion.decidedAt = now();
      return { suggestion: cloneSuggestion(suggestion), version: null };
    }
  };
}

function isExcludedOwner(
  value: { workspaceId: string; ownerProfileId: string },
  excludeOwnerKeys: readonly string[]
) {
  return excludeOwnerKeys.includes(`${value.workspaceId}/${value.ownerProfileId}`);
}
