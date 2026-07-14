import { randomUUID } from "node:crypto";
import { z } from "zod";
import { studioRitualPrepareSchema } from "../ai/schema-registry";
import type { AiHarness } from "../ai/ai.types";
import { studioStructurePropertiesSchema } from "./studio.schemas";
import type { StudioContextBuilder } from "./studio-context-builder";
import type { StudioMemoryIndex } from "./studio-memory";
import type {
  StudioOwnerScope,
  StudioRepository,
  StudioRitualSession,
  StudioRitualSessionPage,
  StudioRitualSessionQuery,
  StudioStructure
} from "./studio.types";

const PREPARATION_LEASE_MS = 120_000;
const MAX_SESSION_JSON_BYTES = 512_000;
const MAX_ANSWERS = 100;
const MAX_ANSWER_KEY = 240;
const MAX_ANSWER_VALUE = 20_000;
const OPERATIONAL_RESOURCE_TYPES = new Set([
  "dashboard", "task", "routine", "process", "training", "announcement", "people"
]);

const ritualSynthesisSchema = z.object({
  summary: z.string().trim().min(1).max(20_000),
  decisions: z.array(z.string().trim().min(1).max(2_000)).max(30),
  open_questions: z.array(z.string().trim().min(1).max(2_000)).max(30),
  suggested_next_steps: z.array(z.string().trim().min(1).max(2_000)).max(30)
}).strict();

export type StudioRitualService = {
  listSessions(scope: StudioOwnerScope, ritualId: string, query: StudioRitualSessionQuery): Promise<StudioRitualSessionPage>;
  startSession(scope: StudioOwnerScope, ritualId: string, input?: { signal?: AbortSignal }): Promise<StudioRitualSession>;
  updateSession(scope: StudioOwnerScope, sessionId: string, input: {
    expectedRevision: number;
    answers: Record<string, string>;
  }): Promise<StudioRitualSession>;
  finishSession(scope: StudioOwnerScope, sessionId: string, input: {
    expectedRevision: number;
    answers: Record<string, string>;
    requestSynthesis: boolean;
    signal?: AbortSignal;
  }): Promise<StudioRitualSession>;
};

type StudioRitualServiceOptions = {
  repository: StudioRepository;
  harness: Pick<AiHarness, "runStructured">;
  contextBuilder: StudioContextBuilder;
  memoryIndex: StudioMemoryIndex;
  now?: () => Date;
};

export function createStudioRitualService(options: StudioRitualServiceOptions): StudioRitualService {
  const now = options.now ?? (() => new Date());
  const inFlight = new Map<string, Promise<StudioRitualSession>>();

  return {
    async listSessions(scope, ritualId, query) {
      await requireRitual(options.repository, scope, ritualId, false);
      const page = await options.repository.listRitualSessions(scope, ritualId, query);
      return { ...page, items: page.items.map(assertSession) };
    },

    startSession(scope, ritualId, input = {}) {
      const key = `${scope.workspaceId}\u0000${scope.ownerProfileId}\u0000${ritualId}`;
      const current = inFlight.get(key);
      if (current) return current;
      const pending = startSession(options, now, scope, ritualId, input.signal)
        .finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); });
      inFlight.set(key, pending);
      return pending;
    },

    async updateSession(scope, sessionId, input) {
      const current = await requireSession(options.repository, scope, sessionId);
      if (current.status === "completed") throw new Error("STUDIO_RITUAL_SESSION_COMPLETED");
      if (current.revision !== input.expectedRevision) throw new Error("STUDIO_RITUAL_SESSION_STALE");
      const answers = mergeAnswers(current.answersJson, input.answers);
      return assertSession(await options.repository.updateRitualSession({
        ...current,
        status: "in_progress",
        answersJson: answers,
        preparationToken: null,
        preparationLeaseExpiresAt: null,
        failureCode: null
      }, current.revision));
    },

    async finishSession(scope, sessionId, input) {
      throwIfAborted(input.signal);
      const current = await requireSession(options.repository, scope, sessionId);
      if (current.status === "completed") return current;
      if (current.revision !== input.expectedRevision) throw new Error("STUDIO_RITUAL_SESSION_STALE");
      const completedAt = timestamp(now);
      const completed = assertSession(await options.repository.updateRitualSession({
        ...current,
        status: "completed",
        answersJson: mergeAnswers(current.answersJson, input.answers),
        preparationToken: null,
        preparationLeaseExpiresAt: null,
        failureCode: null,
        completedAt
      }, current.revision));
      if (!input.requestSynthesis) return completed;
      return synthesizeCompletedSession(options, scope, completed, input.signal).catch(() => completed);
    }
  };
}

async function startSession(
  options: StudioRitualServiceOptions,
  now: () => Date,
  scope: StudioOwnerScope,
  ritualId: string,
  signal?: AbortSignal
) {
  throwIfAborted(signal);
  const ritual = await requireRitual(options.repository, scope, ritualId, true);
  const preparationToken = randomUUID();
  const startedAt = validDate(now());
  let session = assertSession(await options.repository.createRitualSession({
    ...scope,
    ritualId,
    preparationToken,
    preparationLeaseExpiresAt: new Date(startedAt.getTime() + PREPARATION_LEASE_MS).toISOString()
  }));
  if (session.status === "ready" || session.status === "in_progress") return session;

  const ownsPreparation = session.preparationToken === preparationToken;
  const leaseExpired = session.preparationLeaseExpiresAt !== null
    && new Date(session.preparationLeaseExpiresAt).getTime() <= startedAt.getTime();
  if (!ownsPreparation && (session.status === "failed" || leaseExpired)) {
    try {
      session = assertSession(await options.repository.updateRitualSession({
        ...session,
        status: "preparing",
        preparationToken,
        preparationLeaseExpiresAt: new Date(startedAt.getTime() + PREPARATION_LEASE_MS).toISOString(),
        failureCode: null
      }, session.revision));
    } catch (error) {
      if (!isStale(error)) throw error;
      return requireSession(options.repository, scope, session.id);
    }
  } else if (!ownsPreparation) {
    return session;
  }

  try {
    return await prepareSession(options, scope, ritual, session, signal, startedAt);
  } catch (error) {
    const latest = await requireSession(options.repository, scope, session.id);
    if (latest.status !== "completed" && latest.preparationToken === preparationToken) {
      try {
        session = assertSession(await options.repository.updateRitualSession({
          ...latest,
          status: "failed",
          preparationToken: null,
          preparationLeaseExpiresAt: null,
          failureCode: signal?.aborted ? "STUDIO_RITUAL_PREPARATION_CANCELLED" : "STUDIO_RITUAL_PREPARATION_FAILED"
        }, latest.revision));
      } catch (updateError) {
        if (!isStale(updateError)) throw updateError;
        session = await requireSession(options.repository, scope, session.id);
      }
    } else {
      session = latest;
    }
    if (signal?.aborted) throw signal.reason ?? new Error("STUDIO_RITUAL_PREPARATION_CANCELLED");
    return session;
  }
}

async function prepareSession(
  options: StudioRitualServiceOptions,
  scope: StudioOwnerScope,
  ritual: StudioStructure,
  session: StudioRitualSession,
  signal: AbortSignal | undefined,
  startedAt: Date
) {
  const properties = studioStructurePropertiesSchema("ritual").parse(ritual.propertiesJson);
  const document = await options.repository.findDocument(scope, ritual.documentId);
  if (!document) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
  const intent = properties.intention?.trim() || document.title?.trim() || document.bodyText.trim() || "Revisar este ritual";
  const to = startedAt.toISOString().slice(0, 10);
  const from = new Date(startedAt.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const resourceTypes = [...new Set((properties.allowed_internal_sources ?? [])
    .filter((source): source is "dashboard" | "task" | "routine" | "process" | "training" | "announcement" | "people" => (
      OPERATIONAL_RESOURCE_TYPES.has(source)
    )))].sort();
  throwIfAborted(signal);
  const [operational, related] = await Promise.all([
    resourceTypes.length
      ? options.contextBuilder.buildStudioContext(scope, { from, to, resourceTypes, personIds: [] })
      : Promise.resolve({ period: { from, to }, facts: [], citations: [], serializedBytes: 0, truncated: false }),
    options.memoryIndex.findRelated(scope, { documentId: ritual.documentId, query: intent.slice(0, 8_000), limit: 12 })
  ]);
  throwIfAborted(signal);
  const contextJson = assertJsonBounds({
    preparedAt: startedAt.toISOString(),
    ritual: {
      id: ritual.id,
      documentId: ritual.documentId,
      intention: intent,
      guideQuestions: properties.guide_questions ?? [],
      cadence: ritual.cadenceJson,
      nextRunAt: ritual.nextRunAt
    },
    operational,
    related: related.map((match) => ({
      documentId: match.documentId,
      versionId: match.versionId,
      excerpt: match.excerpt,
      score: match.score,
      updatedAt: match.updatedAt
    })).sort((left, right) => right.score - left.score || left.documentId.localeCompare(right.documentId))
  });
  const withContext = assertSession(await options.repository.updateRitualSession({
    ...session,
    contextJson
  }, session.revision));
  throwIfAborted(signal);
  const result = await options.harness.runStructured({
    workspaceId: scope.workspaceId,
    actorProfileId: scope.ownerProfileId,
    source: "owner_studio",
    inputMode: "text",
    taskKind: "studio_ritual_prepare",
    agentKey: "studio_ritual_facilitator",
    promptKey: "agent/studio-ritual-facilitator",
    promptVersion: "1",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    input: { ritual: contextJson.ritual, context: contextJson.operational, related: contextJson.related },
    outputSchema: studioRitualPrepareSchema,
    schemaName: "studio_ritual_prepare",
    signal
  });
  throwIfAborted(signal);
  if (result.output.proposal.ritual_id !== ritual.id) throw new Error("AI_OUTPUT_VALIDATION_FAILED");
  return assertSession(await options.repository.updateRitualSession({
    ...withContext,
    status: "ready",
    preparationJson: assertJsonBounds(result.output),
    prepareAiRunId: result.run.id,
    preparationToken: null,
    preparationLeaseExpiresAt: null,
    failureCode: null
  }, withContext.revision));
}

async function synthesizeCompletedSession(
  options: StudioRitualServiceOptions,
  scope: StudioOwnerScope,
  completed: StudioRitualSession,
  signal?: AbortSignal
) {
  throwIfAborted(signal);
  const result = await options.harness.runStructured({
    workspaceId: scope.workspaceId,
    actorProfileId: scope.ownerProfileId,
    source: "owner_studio",
    inputMode: "text",
    taskKind: "studio_synthesize",
    agentKey: "studio_ritual_facilitator",
    promptKey: "agent/studio-ritual-facilitator",
    promptVersion: "1",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    input: { context: completed.contextJson, preparation: completed.preparationJson, answers: completed.answersJson },
    outputSchema: ritualSynthesisSchema,
    schemaName: "studio_ritual_synthesis",
    signal
  });
  throwIfAborted(signal);
  try {
    return assertSession(await options.repository.updateRitualSession({
      ...completed,
      synthesisJson: assertJsonBounds(result.output),
      synthesisAiRunId: result.run.id
    }, completed.revision));
  } catch (error) {
    if (!isStale(error)) throw error;
    return requireSession(options.repository, scope, completed.id);
  }
}

async function requireRitual(
  repository: StudioRepository,
  scope: StudioOwnerScope,
  ritualId: string,
  requireActive: boolean
) {
  const ritual = await repository.findStructure(scope, ritualId);
  if (!ritual || ritual.kind !== "ritual" || (requireActive && ritual.lifecycleStatus !== "active")) {
    throw new Error("STUDIO_RITUAL_NOT_FOUND");
  }
  try {
    studioStructurePropertiesSchema("ritual").parse(ritual.propertiesJson);
  } catch {
    throw new Error("STUDIO_STRUCTURE_DATA_INVALID");
  }
  return ritual;
}

async function requireSession(repository: StudioRepository, scope: StudioOwnerScope, sessionId: string) {
  const session = await repository.findRitualSession(scope, sessionId);
  if (!session) throw new Error("STUDIO_RITUAL_SESSION_NOT_FOUND");
  return assertSession(session);
}

function assertSession(session: StudioRitualSession) {
  if (!["preparing", "ready", "in_progress", "completed", "failed"].includes(session.status)
    || !Number.isSafeInteger(session.revision) || session.revision < 1
    || (session.status === "completed") !== (session.completedAt !== null)
    || (session.status === "failed") !== (session.failureCode !== null)
    || (session.preparationToken === null) !== (session.preparationLeaseExpiresAt === null)) {
    throw new Error("STUDIO_RITUAL_SESSION_DATA_INVALID");
  }
  mergeAnswers({}, session.answersJson);
  if (session.contextJson !== null) assertJsonBounds(session.contextJson);
  if (session.preparationJson !== null) assertJsonBounds(session.preparationJson);
  if (session.synthesisJson !== null) assertJsonBounds(session.synthesisJson);
  return session;
}

function mergeAnswers(current: Record<string, string>, next: Record<string, string>) {
  const merged = { ...current };
  for (const [rawKey, rawValue] of Object.entries(next)) {
    if (typeof rawValue !== "string") throw new Error("STUDIO_RITUAL_ANSWERS_INVALID");
    const key = rawKey.trim();
    const value = rawValue.trim();
    if (!key || key.length > MAX_ANSWER_KEY || value.length > MAX_ANSWER_VALUE) {
      throw new Error("STUDIO_RITUAL_ANSWERS_INVALID");
    }
    merged[key] = value;
  }
  if (Object.keys(merged).length > MAX_ANSWERS) throw new Error("STUDIO_RITUAL_ANSWERS_INVALID");
  assertJsonBounds(merged);
  return merged;
}

function assertJsonBounds<T extends object>(value: T): T & Record<string, unknown> {
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_SESSION_JSON_BYTES) throw new Error();
    return structuredClone(value) as T & Record<string, unknown>;
  } catch {
    throw new Error("STUDIO_RITUAL_SESSION_DATA_INVALID");
  }
}

function validDate(value: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("STUDIO_CLOCK_INVALID");
  return date;
}

function timestamp(now: () => Date) {
  return validDate(now()).toISOString();
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new Error("STUDIO_RITUAL_CANCELLED");
}

function isStale(error: unknown) {
  return error instanceof Error && error.message === "STUDIO_RITUAL_SESSION_STALE";
}
