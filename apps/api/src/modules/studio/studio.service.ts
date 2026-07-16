import { searchStudioDocuments } from "./studio-search";
import type {
  CreateStudioCollection,
  CreateStudioDocument,
  CreateStudioStructure,
  StudioCollection,
  StudioDocument,
  StudioDocumentQuery,
  StudioVersionQuery,
  StudioHome,
  StudioOwnerScope,
  StudioRepository,
  StudioService,
  StudioStructure,
  StudioRitualCadence,
  UpdateStudioCollection,
  UpdateStudioDocument
} from "./studio.types";
import {
  studioGoalMetricSchema,
  studioRitualCadenceSchema,
  studioStructurePropertiesSchema
} from "./studio.schemas";
import { assertStudioEditorJson } from "./studio-security";
import { safeStudioTelemetrySink, type StudioTelemetrySink } from "./studio-telemetry";

type StudioServiceOptions = {
  now?: () => string;
  telemetry?: StudioTelemetrySink;
  removeMemory?: (scope: StudioOwnerScope, documentId: string) => Promise<void>;
  removeProactiveSignals?: (scope: StudioOwnerScope, sourceIds: readonly string[]) => Promise<void>;
};

const HOME_DOCUMENT_LIMIT = 10;
const DESIRED_STATE_UPDATE_ATTEMPTS = 3;
const STRUCTURE_UPDATE_ATTEMPTS = 3;

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

function assertStructure(structure: StudioStructure): StudioStructure {
  try {
    studioStructurePropertiesSchema(structure.kind).parse(structure.propertiesJson);
    if (structure.kind === "goal") {
      if (structure.metricJson !== null) studioGoalMetricSchema.parse(structure.metricJson);
      if (structure.cadenceJson !== null || structure.nextRunAt !== null) throw new Error();
    } else if (structure.kind === "ritual") {
      if (structure.metricJson !== null) throw new Error();
      if (structure.cadenceJson === null) {
        if (structure.nextRunAt !== null) throw new Error();
      } else {
        studioRitualCadenceSchema.parse(structure.cadenceJson);
        if (structure.nextRunAt === null) throw new Error();
      }
    } else if (structure.metricJson !== null || structure.cadenceJson !== null || structure.nextRunAt !== null) {
      throw new Error();
    }
    return structure;
  } catch {
    throw new Error("STUDIO_STRUCTURE_DATA_INVALID");
  }
}

function zonedParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") };
}

function localToUtc(parts: { year: number; month: number; day: number; hour: number; minute: number }, timezone: string) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(candidate), timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    candidate += desired - represented;
  }
  const exact = zonedParts(new Date(candidate), timezone);
  return Object.entries(parts).every(([key, value]) => exact[key as keyof typeof exact] === value)
    ? new Date(candidate)
    : null;
}

export function nextRitualRun(cadence: StudioRitualCadence, afterIso: string) {
  const after = new Date(afterIso);
  const local = zonedParts(after, cadence.timezone);
  const [hour, minute] = cadence.local_time.split(":").map(Number) as [number, number];
  const base = new Date(Date.UTC(local.year, local.month - 1, local.day));
  for (let offset = 0; offset <= 370; offset += 1) {
    const calendar = new Date(base.getTime() + offset * 86_400_000);
    const year = calendar.getUTCFullYear();
    const month = calendar.getUTCMonth() + 1;
    const day = calendar.getUTCDate();
    const weekday = calendar.getUTCDay();
    const scheduled = cadence.frequency === "daily"
      || (cadence.frequency === "weekly" && cadence.weekdays!.includes(weekday))
      || (cadence.frequency === "monthly" && cadence.month_day === day);
    if (!scheduled) continue;
    const candidate = localToUtc({ year, month, day, hour, minute }, cadence.timezone);
    if (candidate && candidate.getTime() > after.getTime()) return candidate.toISOString();
  }
  throw new Error("STUDIO_RITUAL_NEXT_RUN_UNAVAILABLE");
}

function normalizeStructureInput(kind: StudioStructure["kind"], input: CreateStudioStructure) {
  if (kind !== "goal" && input.metric_json != null) throw new Error("STUDIO_STRUCTURE_DATA_INVALID");
  if (kind !== "ritual" && input.cadence_json != null) throw new Error("STUDIO_STRUCTURE_DATA_INVALID");
  const propertiesJson = studioStructurePropertiesSchema(kind).parse(input.properties_json) as Record<string, unknown>;
  const metricJson = kind === "goal" && input.metric_json != null
    ? studioGoalMetricSchema.parse(input.metric_json)
    : null;
  const cadenceJson = kind === "ritual"
    ? (input.cadence_json == null ? null : studioRitualCadenceSchema.parse(input.cadence_json))
    : null;
  if (kind === "decision" && input.horizon_at && typeof propertiesJson.review_date === "string"
    && input.horizon_at.slice(0, 10) !== propertiesJson.review_date) {
    throw new Error("STUDIO_STRUCTURE_DATA_INVALID");
  }
  return { propertiesJson, metricJson, cadenceJson };
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
  const telemetry = safeStudioTelemetrySink(options.telemetry);

  async function permanentlyDelete(
    scope: StudioOwnerScope,
    id: string,
    claimToken?: string
  ): Promise<boolean> {
    const current = await repository.findDocument(scope, id);
    if (!current) return false;
    if (claimToken !== undefined && current.status !== "trashed") throw new Error("STUDIO_TRASH_CLAIM_STALE");
    if (current.status !== "trashed") throw new Error("STUDIO_DOCUMENT_NOT_TRASHED");
    const cleanup = async (sourceIds: readonly string[]) => {
      const callbacks = [
        options.removeProactiveSignals
          ? () => options.removeProactiveSignals!(scope, sourceIds)
          : null,
        options.removeMemory
          ? () => options.removeMemory!(scope, id)
          : null
      ].filter((callback): callback is () => Promise<void> => callback !== null);
      const results = await Promise.allSettled(callbacks.map((callback) => Promise.resolve().then(callback)));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length === 1) throw failures[0]!.reason;
      if (failures.length > 1) {
        throw new AggregateError(
          failures.map((failure) => failure.reason),
          "STUDIO_DOCUMENT_DELETE_CLEANUP_FAILED",
          { cause: failures[0]!.reason }
        );
      }
    };
    if (repository.permanentlyDeleteDocumentWithCleanup) {
      return repository.permanentlyDeleteDocumentWithCleanup(scope, id, cleanup, claimToken);
    }
    if (!repository.handlesPermanentDeletionCleanup
      && (options.removeProactiveSignals || options.removeMemory)) {
      throw new Error("STUDIO_DOCUMENT_DELETE_CLEANUP_COORDINATION_REQUIRED");
    }
    return repository.permanentlyDeleteDocument(scope, id, claimToken);
  }

  return {
    async readHome(scope): Promise<StudioHome> {
      const now = currentTimestamp(clock);
      const [recentDocuments, focusedDocuments, pendingReviewCount, nextRituals] = await Promise.all([
        repository.listRecentDocuments(scope, HOME_DOCUMENT_LIMIT),
        repository.listFocusedDocuments(scope, HOME_DOCUMENT_LIMIT),
        repository.countPendingReviewDocuments(scope),
        repository.listNextRituals(scope, 1, now)
      ]);

      return {
        recentDocuments,
        focusedDocuments,
        pendingReviewCount,
        nextRituals
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
      assertStudioEditorJson(input.body_json);
      const document = await repository.createDocument({
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
      telemetry({
        name: "studio_capture_created",
        ...scope,
        documentId: document.id,
        mode: document.captureMode,
        assetCount: 0
      });
      return document;
    },

    async updateDocument(scope, actorProfileId, id, input: UpdateStudioDocument) {
      assertActor(scope, actorProfileId);
      const current = await requireDocument(repository, scope, id);
      if (input.revision !== current.revision) throw new Error("STUDIO_DOCUMENT_STALE");
      if (input.body_json !== undefined) assertStudioEditorJson(input.body_json);
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

    async trashDocument(scope, actorProfileId, id) {
      assertActor(scope, actorProfileId);
      return repository.trashDocument(scope, id, currentTimestamp(clock));
    },

    async restoreDocumentFromTrash(scope, actorProfileId, id) {
      assertActor(scope, actorProfileId);
      return repository.restoreDocumentFromTrash(scope, id);
    },

    async permanentlyDeleteDocument(scope, actorProfileId, id) {
      assertActor(scope, actorProfileId);
      return permanentlyDelete(scope, id);
    },

    async permanentlyDeleteClaimedDocument(scope, actorProfileId, id, claimToken) {
      assertActor(scope, actorProfileId);
      if (!claimToken) throw new Error("STUDIO_TRASH_CLAIM_STALE");
      return permanentlyDelete(scope, id, claimToken);
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

    async listVersionPage(scope, id, query: StudioVersionQuery) {
      await requireDocument(repository, scope, id);
      return repository.listVersionPage(scope, id, query);
    },

    async createCheckpoint(scope, actorProfileId, id, input) {
      assertActor(scope, actorProfileId);
      return (await repository.createCheckpoint(scope, id, actorProfileId, input)).version;
    },

    async createExitCheckpoint(scope, actorProfileId, id, input) {
      assertActor(scope, actorProfileId);
      return repository.createExitCheckpoint(scope, id, actorProfileId, input);
    },

    async restoreVersion(scope, actorProfileId, id, versionId, input) {
      assertActor(scope, actorProfileId);
      return repository.restoreDocumentVersion(scope, id, versionId, actorProfileId, input.expected_revision);
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

    async listDocumentCollections(scope, documentId) {
      await requireDocument(repository, scope, documentId);
      return repository.listDocumentCollections(scope, documentId);
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
    },

    async createStructure(scope, actorProfileId, documentId, input) {
      assertActor(scope, actorProfileId);
      await requireDocument(repository, scope, documentId);
      const normalized = normalizeStructureInput(input.kind, input);
      const timestamp = currentTimestamp(clock);
      return assertStructure(await repository.createStructure({
        ...scope,
        documentId,
        kind: input.kind,
        lifecycleStatus: "active",
        horizonAt: input.horizon_at ?? null,
        metricJson: normalized.metricJson,
        cadenceJson: normalized.cadenceJson,
        nextRunAt: normalized.cadenceJson ? nextRitualRun(normalized.cadenceJson, timestamp) : null,
        propertiesJson: normalized.propertiesJson
      }));
    },

    async updateStructure(scope, actorProfileId, structureId, input) {
      assertActor(scope, actorProfileId);
      for (let attempt = 0; attempt < STRUCTURE_UPDATE_ATTEMPTS; attempt += 1) {
        const current = await repository.findStructure(scope, structureId);
        if (!current) throw new Error("STUDIO_STRUCTURE_NOT_FOUND");
        assertStructure(current);
        if (input.expected_revision !== current.revision) throw new Error("STUDIO_STRUCTURE_STALE");
        if (current.kind !== "goal" && input.metric_json != null) throw new Error("STUDIO_STRUCTURE_DATA_INVALID");
        if (current.kind !== "ritual" && input.cadence_json != null) throw new Error("STUDIO_STRUCTURE_DATA_INVALID");
        const propertiesJson = input.properties_json === undefined
          ? current.propertiesJson
          : studioStructurePropertiesSchema(current.kind).parse(input.properties_json) as Record<string, unknown>;
        const metricJson = current.kind === "goal"
          ? (input.metric_json === undefined ? current.metricJson : input.metric_json === null ? null : studioGoalMetricSchema.parse(input.metric_json))
          : null;
        const cadenceJson = current.kind === "ritual"
          ? (input.cadence_json === undefined
            ? current.cadenceJson
            : input.cadence_json === null ? null : studioRitualCadenceSchema.parse(input.cadence_json))
          : null;
        const horizonAt = input.horizon_at === undefined ? current.horizonAt : input.horizon_at;
        const nextRunAt = input.cadence_json === undefined
          ? current.nextRunAt
          : cadenceJson ? nextRitualRun(cadenceJson, currentTimestamp(clock)) : null;
        if (current.kind === "decision" && horizonAt && typeof propertiesJson.review_date === "string"
          && horizonAt.slice(0, 10) !== propertiesJson.review_date) {
          throw new Error("STUDIO_STRUCTURE_DATA_INVALID");
        }
        try {
          return assertStructure(await repository.updateStructure({
            ...current,
            horizonAt,
            metricJson,
            cadenceJson,
            nextRunAt,
            propertiesJson
          }, current.revision));
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "STUDIO_STRUCTURE_STALE") throw error;
        }
      }
      throw new Error("STUDIO_STRUCTURE_STALE");
    },

    async archiveStructure(scope, actorProfileId, structureId) {
      assertActor(scope, actorProfileId);
      for (let attempt = 0; attempt < STRUCTURE_UPDATE_ATTEMPTS; attempt += 1) {
        const current = await repository.findStructure(scope, structureId);
        if (!current) throw new Error("STUDIO_STRUCTURE_NOT_FOUND");
        assertStructure(current);
        if (current.lifecycleStatus === "archived") return current;
        try {
          return assertStructure(await repository.updateStructure({
            ...current, lifecycleStatus: "archived", archivedAt: currentTimestamp(clock)
          }, current.revision));
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "STUDIO_STRUCTURE_STALE") throw error;
        }
      }
      throw new Error("STUDIO_STRUCTURE_STALE");
    },

    async listStructures(scope, query) {
      const page = await repository.listStructures(scope, query);
      return { ...page, items: page.items.map(assertStructure) };
    }
  };
}
