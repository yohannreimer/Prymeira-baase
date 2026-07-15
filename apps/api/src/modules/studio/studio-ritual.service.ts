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
import { nextRitualRun } from "./studio.service";

const PREPARATION_LEASE_MS = 120_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const MAX_SESSION_JSON_BYTES = 512_000;
const MAX_INTENTION_CODE_POINTS = 8_000;
const MAX_INTENTION_BYTES = 24_000;
const MAX_GUIDE_QUESTIONS = 20;
const MAX_GUIDE_QUESTION_CODE_POINTS = 2_000;
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
  preparationTimeoutMs?: number;
  synthesisTimeoutMs?: number;
};

export function createStudioRitualService(options: StudioRitualServiceOptions): StudioRitualService {
  const now = options.now ?? (() => new Date());
  const preparationTimeoutMs = operationTimeout(options.preparationTimeoutMs);
  const synthesisTimeoutMs = operationTimeout(options.synthesisTimeoutMs);
  const preparationInFlight = new Map<string, Promise<StudioRitualSession>>();
  const synthesisInFlight = new Map<string, Promise<StudioRitualSession>>();

  return {
    async listSessions(scope, ritualId, query) {
      await requireRitual(options.repository, scope, ritualId, false);
      const page = await options.repository.listRitualSessions(scope, ritualId, query);
      return { ...page, items: page.items.map(assertSession) };
    },

    startSession(scope, ritualId, input = {}) {
      const key = scopeKey(scope, ritualId);
      const current = preparationInFlight.get(key);
      if (current) return current;
      const operation = createDeadlineSignal(
        input.signal,
        preparationTimeoutMs,
        "STUDIO_RITUAL_PREPARATION_TIMEOUT"
      );
      const pending = startSession(options, now, scope, ritualId, operation)
        .finally(() => {
          operation.cleanup();
          if (preparationInFlight.get(key) === pending) preparationInFlight.delete(key);
        });
      preparationInFlight.set(key, pending);
      return pending;
    },

    async updateSession(scope, sessionId, input) {
      const current = await requireSession(options.repository, scope, sessionId);
      if (current.status === "completed") throw new Error("STUDIO_RITUAL_SESSION_COMPLETED");
      if (current.revision !== input.expectedRevision) throw new Error("STUDIO_RITUAL_SESSION_STALE");
      return assertSession(await options.repository.updateRitualSession({
        ...current,
        status: "in_progress",
        answersJson: mergeAnswers(current.answersJson, input.answers),
        preparationToken: null,
        preparationLeaseExpiresAt: null,
        failureCode: null
      }, current.revision));
    },

    async finishSession(scope, sessionId, input) {
      throwIfAborted(input.signal);
      let completed = await requireSession(options.repository, scope, sessionId);
      const completedNow = completed.status !== "completed";
      if (completed.status !== "completed") {
        if (completed.revision !== input.expectedRevision) throw new Error("STUDIO_RITUAL_SESSION_STALE");
        completed = assertSession(await options.repository.updateRitualSession({
          ...completed,
          status: "completed",
          answersJson: mergeAnswers(completed.answersJson, input.answers),
          preparationToken: null,
          preparationLeaseExpiresAt: null,
          failureCode: null,
          completedAt: timestamp(now)
        }, completed.revision));
      }
      if (completedNow) {
        await advanceRitualCadence(options.repository, scope, completed.ritualId, now());
      }
      if (!input.requestSynthesis || completed.synthesisJson !== null) return completed;

      const key = scopeKey(scope, completed.id);
      const current = synthesisInFlight.get(key);
      if (current) return current;
      const operation = createDeadlineSignal(
        input.signal,
        synthesisTimeoutMs,
        "STUDIO_RITUAL_SYNTHESIS_TIMEOUT"
      );
      const pending = synthesizeCompletedSession(options, now, scope, completed, operation)
        .finally(() => {
          operation.cleanup();
          if (synthesisInFlight.get(key) === pending) synthesisInFlight.delete(key);
        });
      synthesisInFlight.set(key, pending);
      return pending;
    }
  };
}

async function advanceRitualCadence(
  repository: StudioRepository,
  scope: StudioOwnerScope,
  ritualId: string,
  completedAt: Date
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ritual = await requireRitual(repository, scope, ritualId, false);
    if (!ritual.cadenceJson || !ritual.nextRunAt) return;
    const after = new Date(ritual.nextRunAt).getTime() > completedAt.getTime()
      ? ritual.nextRunAt
      : completedAt.toISOString();
    try {
      await repository.updateStructure({
        ...ritual,
        nextRunAt: nextRitualRun(ritual.cadenceJson, after)
      }, ritual.revision);
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "STUDIO_STRUCTURE_STALE") throw error;
    }
  }
  throw new Error("STUDIO_STRUCTURE_STALE");
}

type DeadlineOperation = {
  signal: AbortSignal;
  timedOut(): boolean;
  cleanup(): void;
};

async function startSession(
  options: StudioRitualServiceOptions,
  now: () => Date,
  scope: StudioOwnerScope,
  ritualId: string,
  operation: DeadlineOperation
) {
  throwIfAborted(operation.signal);
  const ritual = await raceAbort(requireRitual(options.repository, scope, ritualId, true), operation.signal);
  const preparationToken = randomUUID();
  const startedAt = validDate(now());
  let session = assertSession(await raceAbort(options.repository.createRitualSession({
    ...scope,
    ritualId,
    preparationToken,
    preparationLeaseExpiresAt: new Date(startedAt.getTime() + PREPARATION_LEASE_MS).toISOString()
  }), operation.signal));
  if (session.status === "ready" || session.status === "in_progress") return session;

  const ownsPreparation = session.preparationToken === preparationToken;
  const leaseExpired = session.preparationLeaseExpiresAt !== null
    && new Date(session.preparationLeaseExpiresAt).getTime() <= startedAt.getTime();
  if (!ownsPreparation && (session.status === "failed" || leaseExpired)) {
    try {
      session = assertSession(await raceAbort(options.repository.updateRitualSession({
        ...session,
        status: "preparing",
        preparationToken,
        preparationLeaseExpiresAt: new Date(startedAt.getTime() + PREPARATION_LEASE_MS).toISOString(),
        failureCode: null
      }, session.revision), operation.signal));
    } catch (error) {
      if (!isStale(error)) throw error;
      return requireSession(options.repository, scope, session.id);
    }
  } else if (!ownsPreparation) {
    return session;
  }

  try {
    return await prepareSession(options, scope, ritual, session, operation.signal, startedAt);
  } catch (error) {
    const latest = await requireSession(options.repository, scope, session.id);
    if (latest.status !== "completed" && latest.preparationToken === preparationToken) {
      const failureCode = operation.timedOut()
        ? "STUDIO_RITUAL_PREPARATION_TIMEOUT"
        : operation.signal.aborted
          ? "STUDIO_RITUAL_PREPARATION_CANCELLED"
          : "STUDIO_RITUAL_PREPARATION_FAILED";
      try {
        session = assertSession(await options.repository.updateRitualSession({
          ...latest,
          status: "failed",
          preparationToken: null,
          preparationLeaseExpiresAt: null,
          failureCode
        }, latest.revision));
      } catch (updateError) {
        if (!isStale(updateError)) throw updateError;
        session = await requireSession(options.repository, scope, session.id);
      }
    } else {
      session = latest;
    }
    if (operation.signal.aborted && !operation.timedOut()) {
      throw operation.signal.reason ?? new Error("STUDIO_RITUAL_PREPARATION_CANCELLED");
    }
    return session;
  }
}

async function prepareSession(
  options: StudioRitualServiceOptions,
  scope: StudioOwnerScope,
  ritual: StudioStructure,
  session: StudioRitualSession,
  signal: AbortSignal,
  startedAt: Date
) {
  const properties = studioStructurePropertiesSchema("ritual").parse(ritual.propertiesJson);
  const document = await raceAbort(options.repository.findDocument(scope, ritual.documentId), signal);
  if (!document) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
  const intent = boundedStudioText(
    properties.intention?.trim() || document.title?.trim() || document.bodyText.trim() || "Revisar este ritual",
    MAX_INTENTION_CODE_POINTS,
    MAX_INTENTION_BYTES
  ) || "Revisar este ritual";
  const guideQuestions = (properties.guide_questions ?? [])
    .slice(0, MAX_GUIDE_QUESTIONS)
    .map((question) => boundedStudioText(question, MAX_GUIDE_QUESTION_CODE_POINTS, MAX_INTENTION_BYTES))
    .filter(Boolean);
  const to = startedAt.toISOString().slice(0, 10);
  const from = new Date(startedAt.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const resourceTypes = [...new Set((properties.allowed_internal_sources ?? [])
    .filter((source): source is "dashboard" | "task" | "routine" | "process" | "training" | "announcement" | "people" => (
      OPERATIONAL_RESOURCE_TYPES.has(source)
    )))].sort();
  const [operational, related] = await raceAbort(Promise.all([
    resourceTypes.length
      ? options.contextBuilder.buildStudioContext(
        scope,
        { from, to, resourceTypes, personIds: [] },
        { signal }
      )
      : Promise.resolve({ period: { from, to }, facts: [], citations: [], serializedBytes: 0, truncated: false }),
    options.memoryIndex.findRelated(scope, {
      documentId: ritual.documentId,
      query: intent,
      limit: 12,
      signal
    })
  ]), signal);
  const contextJson = assertJsonBounds({
    preparedAt: startedAt.toISOString(),
    ritual: {
      id: ritual.id,
      documentId: ritual.documentId,
      intention: intent,
      guideQuestions,
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
  const withContext = assertSession(await raceAbort(options.repository.updateRitualSession({
    ...session,
    contextJson
  }, session.revision), signal));
  const result = await raceAbort(options.harness.runStructured({
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
  }), signal);
  if (result.output.proposal.ritual_id !== ritual.id) throw new Error("AI_OUTPUT_VALIDATION_FAILED");
  return assertSession(await raceAbort(options.repository.updateRitualSession({
    ...withContext,
    status: "ready",
    preparationJson: assertJsonBounds(result.output),
    prepareAiRunId: result.run.id,
    preparationToken: null,
    preparationLeaseExpiresAt: null,
    failureCode: null
  }, withContext.revision), signal));
}

async function synthesizeCompletedSession(
  options: StudioRitualServiceOptions,
  now: () => Date,
  scope: StudioOwnerScope,
  initial: StudioRitualSession,
  operation: DeadlineOperation
) {
  let completed = assertSession(initial);
  if (completed.synthesisJson !== null) return completed;
  const timestampNow = validDate(now());
  const liveClaim = completed.synthesisToken !== null
    && completed.synthesisLeaseExpiresAt !== null
    && new Date(completed.synthesisLeaseExpiresAt).getTime() > timestampNow.getTime();
  if (liveClaim) return completed;

  const synthesisToken = randomUUID();
  try {
    completed = assertSession(await raceAbort(options.repository.updateRitualSession({
      ...completed,
      synthesisToken,
      synthesisLeaseExpiresAt: new Date(timestampNow.getTime() + PREPARATION_LEASE_MS).toISOString(),
      synthesisFailureCode: null
    }, completed.revision), operation.signal));
  } catch (error) {
    if (!isStale(error)) throw error;
    return requireSession(options.repository, scope, completed.id);
  }

  try {
    const result = await raceAbort(options.harness.runStructured({
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
      signal: operation.signal
    }), operation.signal);
    return assertSession(await options.repository.updateRitualSession({
      ...completed,
      synthesisJson: assertJsonBounds(result.output),
      synthesisAiRunId: result.run.id,
      synthesisToken: null,
      synthesisLeaseExpiresAt: null,
      synthesisFailureCode: null
    }, completed.revision));
  } catch (error) {
    const latest = await requireSession(options.repository, scope, completed.id);
    if (latest.synthesisJson !== null || latest.synthesisToken !== synthesisToken) return latest;
    const failureCode = operation.timedOut()
      ? "STUDIO_RITUAL_SYNTHESIS_TIMEOUT"
      : operation.signal.aborted
        ? "STUDIO_RITUAL_SYNTHESIS_CANCELLED"
        : "STUDIO_RITUAL_SYNTHESIS_FAILED";
    try {
      return assertSession(await options.repository.updateRitualSession({
        ...latest,
        synthesisToken: null,
        synthesisLeaseExpiresAt: null,
        synthesisFailureCode: failureCode
      }, latest.revision));
    } catch (updateError) {
      if (!isStale(updateError)) throw updateError;
      return requireSession(options.repository, scope, completed.id);
    }
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
  try {
    const preparationClaimPaired = (session.preparationToken === null) === (session.preparationLeaseExpiresAt === null);
    const synthesisClaimPaired = (session.synthesisToken === null) === (session.synthesisLeaseExpiresAt === null);
    if (!(["preparing", "ready", "in_progress", "completed", "failed"] as string[]).includes(session.status)
      || !Number.isSafeInteger(session.revision) || session.revision < 1
      || (session.status === "completed") !== (session.completedAt !== null)
      || (session.status === "failed") !== (session.failureCode !== null)
      || !preparationClaimPaired || !synthesisClaimPaired
      || (session.status === "preparing") !== (session.preparationToken !== null)
      || (session.synthesisToken !== null && (session.status !== "completed" || session.synthesisJson !== null))
      || (session.synthesisFailureCode !== null
        && (session.status !== "completed" || session.synthesisJson !== null || session.synthesisToken !== null))) {
      throw new Error();
    }
    mergeAnswers({}, session.answersJson);
    if (session.contextJson !== null) assertJsonBounds(session.contextJson);
    if (session.preparationJson !== null) {
      const preparation = studioRitualPrepareSchema.parse(assertJsonBounds(session.preparationJson));
      if (preparation.proposal.ritual_id !== session.ritualId || session.prepareAiRunId === null) throw new Error();
    } else if (session.prepareAiRunId !== null || session.status === "ready") {
      throw new Error();
    }
    if (session.synthesisJson !== null) {
      ritualSynthesisSchema.parse(assertJsonBounds(session.synthesisJson));
      if (session.status !== "completed" || session.synthesisAiRunId === null
        || session.synthesisFailureCode !== null || session.synthesisToken !== null) throw new Error();
    } else if (session.synthesisAiRunId !== null) {
      throw new Error();
    }
    return session;
  } catch (error) {
    if (error instanceof Error && error.message === "STUDIO_RITUAL_ANSWERS_INVALID") throw error;
    throw new Error("STUDIO_RITUAL_SESSION_DATA_INVALID");
  }
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

function boundedStudioText(value: string, maxCodePoints: number, maxBytes: number) {
  const normalized = value.replace(/[\u0000-\u001F\u007F]/gu, " ").replace(/\s+/gu, " ").trim();
  let result = "";
  let codePoints = 0;
  let bytes = 0;
  for (const character of normalized) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (codePoints >= maxCodePoints || bytes + characterBytes > maxBytes) break;
    result += character;
    codePoints += 1;
    bytes += characterBytes;
  }
  return result.trim();
}

function createDeadlineSignal(parent: AbortSignal | undefined, timeoutMs: number, timeoutCode: string): DeadlineOperation {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort(parent?.reason ?? new Error("STUDIO_RITUAL_CANCELLED"));
  };
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    if (!controller.signal.aborted) controller.abort(new Error(timeoutCode));
  }, timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    }
  };
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("STUDIO_RITUAL_CANCELLED"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("STUDIO_RITUAL_CANCELLED"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); }
    );
  });
}

function operationTimeout(value: number | undefined) {
  const timeout = value ?? DEFAULT_OPERATION_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout >= PREPARATION_LEASE_MS) {
    throw new Error("STUDIO_RITUAL_TIMEOUT_INVALID");
  }
  return Math.floor(timeout);
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

function scopeKey(scope: StudioOwnerScope, id: string) {
  return `${scope.workspaceId}\u0000${scope.ownerProfileId}\u0000${id}`;
}
