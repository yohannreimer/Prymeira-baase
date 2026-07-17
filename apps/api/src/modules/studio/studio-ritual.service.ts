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
  StudioRitualSupportMode,
  StudioRitualSession,
  StudioRitualSessionPage,
  StudioRitualSessionQuery,
  StudioStructure
} from "./studio.types";
import type { StudioMaintenanceClaimBudget } from "./studio-maintenance-budget";
import { tagStudioMaintenanceFailure } from "./studio-maintenance-budget";
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
const CADENCE_OCCURRENCE_CONTEXT_KEY = "cadenceOccurrenceAt";

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
  processNextPreparation(
    signal?: AbortSignal,
    budget?: StudioMaintenanceClaimBudget
  ): Promise<StudioRitualSession | null>;
};

type StudioRitualServiceOptions = {
  repository: StudioRepository;
  harness: Pick<AiHarness, "runStructured">;
  model: string;
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
  const synthesisInFlight = new Map<string, Promise<StudioRitualSession>>();

  return {
    async listSessions(scope, ritualId, query) {
      await requireRitual(options.repository, scope, ritualId, false);
      const page = await options.repository.listRitualSessions(scope, ritualId, query);
      return { ...page, items: page.items.map(assertSession) };
    },

    async startSession(scope, ritualId, input = {}) {
      throwIfAborted(input.signal);
      const ritual = await requireRitual(options.repository, scope, ritualId, true);
      const contextJson = await baseRitualContext(options.repository, scope, ritual);
      const supportMode = resolveRitualSupportMode(ritual);
      throwIfAborted(input.signal);
      let session = assertSession(await options.repository.createRitualSession({
        ...scope,
        ritualId,
        supportMode,
        occurrenceAt: ritual.nextRunAt ?? timestamp(now),
        contextJson,
        preparationToken: null,
        preparationLeaseExpiresAt: null
      }));
      if (session.status !== "failed") return session;
      try {
        session = assertSession(await options.repository.updateRitualSession({
          ...session,
          status: "preparing",
          failureCode: null,
          preparationToken: null,
          preparationLeaseExpiresAt: null
        }, session.revision));
      } catch (error) {
        if (!isStale(error)) throw error;
        session = await requireSession(options.repository, scope, session.id);
      }
      return session;
    },

    async updateSession(scope, sessionId, input) {
      const current = await requireSession(options.repository, scope, sessionId);
      if (current.status === "completed") throw new Error("STUDIO_RITUAL_SESSION_COMPLETED");
      if (current.answerRevision !== input.expectedRevision) throw new Error("STUDIO_RITUAL_SESSION_STALE");
      return assertSession(await options.repository.updateRitualSessionAnswers(
        scope,
        sessionId,
        mergeAnswers(current.answersJson, input.answers),
        input.expectedRevision
      ));
    },

    async finishSession(scope, sessionId, input) {
      throwIfAborted(input.signal);
      let completed = await requireSession(options.repository, scope, sessionId);
      if (completed.status !== "completed") {
        if (completed.answerRevision !== input.expectedRevision) throw new Error("STUDIO_RITUAL_SESSION_STALE");
        const ritual = await requireRitual(options.repository, scope, completed.ritualId, false);
        completed = assertSession(await options.repository.updateRitualSessionAnswers(
          scope,
          sessionId,
          mergeAnswers(completed.answersJson, input.answers),
          input.expectedRevision
        ));
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            completed = assertSession(await options.repository.updateRitualSession({
              ...completed,
              status: "completed",
              contextJson: withCadenceOccurrence(completed.contextJson, ritual.nextRunAt),
              preparationToken: null,
              preparationLeaseExpiresAt: null,
              failureCode: null,
              completedAt: timestamp(now)
            }, completed.revision));
            break;
          } catch (error) {
            if (!isStale(error)) throw error;
            completed = await requireSession(options.repository, scope, sessionId);
          }
        }
        if (completed.status !== "completed") throw new Error("STUDIO_RITUAL_SESSION_STALE");
      }
      await reconcileRitualCadence(options.repository, scope, completed);
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
    },

    async processNextPreparation(signal, budget) {
      throwIfAborted(signal);
      const startedAt = validDate(now());
      const claimed = await options.repository.claimNextRitualPreparation(
        startedAt.toISOString(),
        PREPARATION_LEASE_MS,
        budget?.excludeOwnerKeys
      );
      if (!claimed) return null;
      const scope = { workspaceId: claimed.workspaceId, ownerProfileId: claimed.ownerProfileId };
      const operation = createDeadlineSignal(
        signal,
        preparationTimeoutMs,
        "STUDIO_RITUAL_PREPARATION_TIMEOUT"
      );
      try {
        const ritual = await requireRitual(options.repository, scope, claimed.ritualId, false);
        return await prepareClaimedSession(options, scope, ritual, assertSession(claimed), operation, startedAt);
      } catch (error) {
        if (signal?.aborted) throw error;
        throw tagStudioMaintenanceFailure(error, scope);
      } finally {
        operation.cleanup();
      }
    }
  };
}

async function reconcileRitualCadence(
  repository: StudioRepository,
  scope: StudioOwnerScope,
  session: StudioRitualSession
) {
  const occurrenceAt = cadenceOccurrence(session.contextJson);
  if (!occurrenceAt || !session.completedAt) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ritual = await requireRitual(repository, scope, session.ritualId, false);
    if (!ritual.cadenceJson || ritual.nextRunAt !== occurrenceAt) return;
    const after = new Date(occurrenceAt).getTime() > new Date(session.completedAt).getTime()
      ? occurrenceAt
      : session.completedAt;
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

function withCadenceOccurrence(context: Record<string, unknown> | null, occurrenceAt: string | null) {
  return assertJsonBounds({ ...(context ?? {}), [CADENCE_OCCURRENCE_CONTEXT_KEY]: occurrenceAt });
}

function cadenceOccurrence(context: Record<string, unknown> | null) {
  const value = context?.[CADENCE_OCCURRENCE_CONTEXT_KEY];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw new Error("STUDIO_RITUAL_SESSION_DATA_INVALID");
  }
  return new Date(value).toISOString();
}

export function resolveRitualSupportMode(ritual: StudioStructure): StudioRitualSupportMode {
  const explicit = ritual.propertiesJson.support_mode;
  if (explicit === "record_only" || explicit === "light_summary" || explicit === "guided_reflection") {
    return explicit;
  }
  if (ritual.cadenceJson?.frequency === "daily") return "record_only";
  if (ritual.cadenceJson?.frequency === "weekly") return "light_summary";
  return "guided_reflection";
}

type DeadlineOperation = {
  signal: AbortSignal;
  timedOut(): boolean;
  cleanup(): void;
};

async function prepareClaimedSession(
  options: StudioRitualServiceOptions,
  scope: StudioOwnerScope,
  ritual: StudioStructure,
  session: StudioRitualSession,
  operation: DeadlineOperation,
  startedAt: Date
) {
  const signal = operation.signal;
  const preparationToken = session.preparationToken;
  if (!preparationToken) throw new Error("STUDIO_RITUAL_PREPARATION_CLAIM_INVALID");
  try {
    return await prepareSession(options, scope, ritual, session, signal, startedAt);
  } catch (error) {
    const latest = await requireSession(options.repository, scope, session.id);
    if (latest.status !== "completed" && latest.preparationToken === preparationToken) {
      const failureCode = operation.timedOut()
        ? "STUDIO_RITUAL_PREPARATION_TIMEOUT"
        : operation.signal.aborted
          ? "STUDIO_RITUAL_PREPARATION_CANCELLED"
          : "STUDIO_RITUAL_PREPARATION_FAILED";
      try {
        return assertSession(await options.repository.updateRitualSession({
          ...latest,
          status: "failed",
          preparationToken: null,
          preparationLeaseExpiresAt: null,
          failureCode
        }, latest.revision));
      } catch (updateError) {
        if (!isStale(updateError)) throw updateError;
        return requireSession(options.repository, scope, session.id);
      }
    }
    return latest;
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
  const base = await raceAbort(baseRitualContext(options.repository, scope, ritual), signal);
  const ritualContext = base.ritual as {
    id: string;
    documentId: string;
    intention: string;
    guideQuestions: string[];
    cadence: StudioStructure["cadenceJson"];
    nextRunAt: string | null;
  };
  const intent = ritualContext.intention;
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
      ...ritualContext
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
  const result = await raceAbort(options.harness.runStructured({
    workspaceId: scope.workspaceId,
    actorProfileId: scope.ownerProfileId,
    source: "owner_studio",
    inputMode: "text",
    taskKind: "studio_ritual_prepare",
    agentKey: "studio_ritual_facilitator",
    promptKey: "agent/studio-ritual-facilitator",
    promptVersion: "1",
    model: options.model,
    reasoningEffort: "medium",
    input: { ritual: contextJson.ritual, context: contextJson.operational, related: contextJson.related },
    outputSchema: studioRitualPrepareSchema,
    schemaName: "studio_ritual_prepare",
    signal
  }), signal);
  if (result.output.proposal.ritual_id !== ritual.id) throw new Error("AI_OUTPUT_VALIDATION_FAILED");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const latest = await raceAbort(requireSession(options.repository, scope, session.id), signal);
    if (latest.status === "completed" || latest.preparationToken !== session.preparationToken) return latest;
    try {
      return assertSession(await raceAbort(options.repository.updateRitualSession({
        ...latest,
        status: Object.keys(latest.answersJson).length ? "in_progress" : "ready",
        contextJson,
        preparationJson: assertJsonBounds(result.output),
        prepareAiRunId: result.run.id,
        preparationToken: null,
        preparationLeaseExpiresAt: null,
        failureCode: null
      }, latest.revision), signal));
    } catch (error) {
      if (!isStale(error)) throw error;
    }
  }
  return requireSession(options.repository, scope, session.id);
}

async function baseRitualContext(
  repository: StudioRepository,
  scope: StudioOwnerScope,
  ritual: StudioStructure
) {
  const properties = studioStructurePropertiesSchema("ritual").parse(ritual.propertiesJson);
  const document = await repository.findDocument(scope, ritual.documentId);
  if (!document) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
  const intention = boundedStudioText(
    properties.intention?.trim() || document.title?.trim() || document.bodyText.trim() || "Revisar este ritual",
    MAX_INTENTION_CODE_POINTS,
    MAX_INTENTION_BYTES
  ) || "Revisar este ritual";
  const guideQuestions = (properties.guide_questions ?? [])
    .slice(0, MAX_GUIDE_QUESTIONS)
    .map((question) => boundedStudioText(question, MAX_GUIDE_QUESTION_CODE_POINTS, MAX_INTENTION_BYTES))
    .filter(Boolean);
  return assertJsonBounds({
    ritual: {
      id: ritual.id,
      documentId: ritual.documentId,
      intention,
      guideQuestions,
      cadence: ritual.cadenceJson,
      nextRunAt: ritual.nextRunAt
    }
  });
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
      model: options.model,
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
      || !Number.isSafeInteger(session.answerRevision) || session.answerRevision < 1
      || !(session.supportMode === "record_only" || session.supportMode === "light_summary" || session.supportMode === "guided_reflection")
      || Number.isNaN(new Date(session.occurrenceAt).getTime())
      || (session.status === "completed") !== (session.completedAt !== null)
      || (session.status === "failed") !== (session.failureCode !== null)
      || !preparationClaimPaired || !synthesisClaimPaired
      || (session.preparationToken !== null && session.status !== "preparing" && session.status !== "in_progress")
      || (session.status === "preparing" && session.preparationJson !== null)
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
    } else if (session.prepareAiRunId !== null || (session.status === "ready" && session.supportMode !== "record_only")) {
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
