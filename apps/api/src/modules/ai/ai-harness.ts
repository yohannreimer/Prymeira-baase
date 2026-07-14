import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";
import { validateAiCitation } from "./ai-citation";
import type { StudioLinkResolver } from "../studio/studio-link-fetcher";
import type {
  AiEmbeddingRequest,
  AiHarness,
  AiProvider,
  AiRepository,
  AiStructuredRunRequest,
  AiStructuredRunResult,
  AiTextStreamEvent,
  AiTextStreamRunRequest,
  AiTextStreamRunResult,
  AiTranscriptionRunRequest,
  AudioTranscriptionResult
} from "./ai.types";

type CreateAiHarnessOptions = {
  repository: AiRepository;
  provider: AiProvider;
  now?: () => number;
  streamStartTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  citationResolver?: StudioLinkResolver;
  citationResolverTimeoutMs?: number;
};

export function createAiHarness(options: CreateAiHarnessOptions): AiHarness {
  const now = options.now ?? (() => Date.now());

  return {
    async runStructured<TInput, TOutput>(
      request: AiStructuredRunRequest<TInput, TOutput>
    ): Promise<AiStructuredRunResult<TOutput>> {
      const startedAt = now();
      const run = await options.repository.createRun({
        workspaceId: request.workspaceId,
        actorProfileId: request.actorProfileId,
        source: request.source,
        inputMode: request.inputMode,
        taskKind: request.taskKind,
        agentKey: request.agentKey,
        promptVersion: `${request.promptKey}@${request.promptVersion}`,
        model: request.model,
        reasoningEffort: request.reasoningEffort,
        status: "running",
        traceId: null,
        inputSummary: summarizeInput(request.input, request.source),
        outputSummary: null,
        validationErrors: [],
        costEstimateCents: null,
        latencyMs: null
      });

      try {
        throwIfStructuredAborted(request.signal);
        const rawOutput = await options.provider.generateStructured({
          taskKind: request.taskKind,
          agentKey: request.agentKey,
          promptKey: request.promptKey,
          promptVersion: request.promptVersion,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          input: request.input,
          schemaName: request.schemaName,
          jsonSchema: request.jsonSchema ?? buildStrictJsonSchema(request.outputSchema, request.schemaName ?? request.taskKind),
          signal: request.signal
        });
        throwIfStructuredAborted(request.signal);
        const parsedOutput = request.outputSchema.parse(rawOutput);
        throwIfStructuredAborted(request.signal);
        const completedRun = await options.repository.updateRun({
          ...run,
          status: "completed",
          outputSummary: summarizeOutput(parsedOutput, request.source),
          validationErrors: [],
          latencyMs: now() - startedAt
        });

        return {
          run: completedRun,
          output: parsedOutput
        };
      } catch (error) {
        const aborted = request.signal?.aborted === true;
        const validationErrors = aborted ? [] : readValidationErrors(error);
        await options.repository.updateRun({
          ...run,
          status: "failed",
          validationErrors,
          latencyMs: now() - startedAt
        });

        if (aborted) throw createStructuredAbortError(request.signal);
        if (validationErrors.length > 0) throw new Error("AI_OUTPUT_VALIDATION_FAILED");
        throw error;
      }
    },

    async runTextStream(request: AiTextStreamRunRequest): Promise<AiTextStreamRunResult> {
      const startedAt = now();
      const run = await options.repository.createRun({
        workspaceId: request.workspaceId,
        actorProfileId: request.actorProfileId,
        source: request.source,
        inputMode: request.inputMode,
        taskKind: request.taskKind,
        agentKey: request.agentKey,
        promptVersion: `${request.promptKey}@${request.promptVersion}`,
        model: request.model,
        reasoningEffort: request.reasoningEffort,
        status: "running",
        traceId: null,
        inputSummary: summarizeInput(request.input, request.source),
        outputSummary: null,
        validationErrors: [],
        costEstimateCents: null,
        latencyMs: null
      });
      const providerAbort = createComposedAbortController(request.signal);
      let providerEvents: AsyncIterable<AiTextStreamEvent>;
      try {
        providerEvents = options.provider.streamText({
          taskKind: request.taskKind,
          agentKey: request.agentKey,
          promptKey: request.promptKey,
          promptVersion: request.promptVersion,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          input: request.input,
          allowExternalResearch: request.allowExternalResearch,
          signal: providerAbort.signal
        });
      } catch (error) {
        providerAbort.abort(error);
        providerAbort.cleanup();
        await options.repository.updateRun({
          ...run,
          status: "failed",
          validationErrors: [sanitizeStoredError(
            readErrorMessage(error, "AI_STREAM_FAILED"),
            request.source,
            "AI_STREAM_FAILED"
          )],
          latencyMs: now() - startedAt
        });
        throw error;
      }

      return {
        run,
        events: createAuditedTextStream({
          events: providerEvents,
          signal: request.signal,
          allowExternalResearch: request.allowExternalResearch,
          privateOutput: request.source === "owner_studio",
          startTimeoutMs: options.streamStartTimeoutMs ?? 30_000,
          idleTimeoutMs: options.streamIdleTimeoutMs ?? 120_000,
          citationResolver: options.citationResolver,
          citationResolverTimeoutMs: options.citationResolverTimeoutMs,
          operationSignal: providerAbort.signal,
          abortProvider: providerAbort.abort,
          cleanupProviderSignal: providerAbort.cleanup,
          complete: (outputSummary) => options.repository.updateRun({
            ...run,
            status: "completed",
            outputSummary,
            validationErrors: [],
            latencyMs: now() - startedAt
          }),
          fail: (message) => options.repository.updateRun({
            ...run,
            status: "failed",
            validationErrors: [sanitizeStoredError(message, request.source, "AI_STREAM_FAILED")],
            latencyMs: now() - startedAt
          })
        })
      };
    },

    async createEmbeddings(request: AiEmbeddingRequest): Promise<number[][]> {
      if (request.signal?.aborted) throw request.signal.reason;
      validateEmbeddingRequest(request);
      const embeddings = await options.provider.createEmbeddings(request);
      if (request.signal?.aborted) throw request.signal.reason;
      validateEmbeddings(request, embeddings);
      return embeddings;
    },

    async transcribeAudio(request: AiTranscriptionRunRequest): Promise<AudioTranscriptionResult> {
      const startedAt = now();
      const run = await options.repository.createRun({
        workspaceId: request.workspaceId,
        actorProfileId: request.actorProfileId,
        source: request.source,
        inputMode: "audio",
        taskKind: "transcript_cleanup",
        agentKey: "transcript_normalizer",
        promptVersion: "agent/transcript-normalizer@1",
        model: "nova-3",
        reasoningEffort: "none",
        status: "running",
        traceId: null,
        inputSummary: request.source === "owner_studio"
          ? PRIVATE_INPUT_SUMMARY
          : request.audioUrl ?? "audio_buffer",
        outputSummary: null,
        validationErrors: [],
        costEstimateCents: null,
        latencyMs: null
      });

      try {
        const transcript = await options.provider.transcribeAudio({
          audioUrl: request.audioUrl,
          audioBuffer: request.audioBuffer,
          mimeType: request.mimeType,
          language: request.language,
          keyterms: request.keyterms,
          signal: request.signal
        });

        await options.repository.updateRun({
          ...run,
          status: "completed",
          outputSummary: request.source === "owner_studio" ? PRIVATE_OUTPUT_SUMMARY : summarizeText(transcript.text),
          latencyMs: now() - startedAt
        });

        return transcript;
      } catch (error) {
        await options.repository.updateRun({
          ...run,
          status: "failed",
          validationErrors: [sanitizeStoredError(
            error instanceof Error ? error.message : "AI_TRANSCRIPTION_FAILED",
            request.source,
            "AI_TRANSCRIPTION_FAILED"
          )],
          latencyMs: now() - startedAt
        });
        throw error;
      }
    }
  };
}

function throwIfStructuredAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createStructuredAbortError(signal);
}

function createStructuredAbortError(signal?: AbortSignal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("AI_STRUCTURED_CANCELLED");
  error.name = "AbortError";
  return error;
}

type AuditedTextStreamOptions = {
  events: AsyncIterable<AiTextStreamEvent>;
  signal?: AbortSignal;
  allowExternalResearch: boolean;
  privateOutput: boolean;
  startTimeoutMs: number;
  idleTimeoutMs: number;
  citationResolver?: StudioLinkResolver;
  citationResolverTimeoutMs?: number;
  operationSignal: AbortSignal;
  abortProvider(reason: unknown): void;
  cleanupProviderSignal(): void;
  complete(outputSummary: string): Promise<unknown>;
  fail(message: string): Promise<unknown>;
};

function createAuditedTextStream(options: AuditedTextStreamOptions): AsyncIterable<AiTextStreamEvent> {
  const summary = createBoundedSummary();
  let providerIterator: AsyncIterator<AiTextStreamEvent> | null = null;
  let claimed = false;
  let nextInFlight = false;
  let finalized = false;
  let closed = false;
  let closing: Promise<void> | null = null;
  let finalization: Promise<void> | null = null;
  let terminalError: Error | null = null;
  let resolveTermination!: () => void;
  const termination = new Promise<void>((resolve) => { resolveTermination = resolve; });

  const clearStartTimer = () => clearTimeout(startTimer);
  const cleanup = () => {
    clearStartTimer();
    options.signal?.removeEventListener("abort", onAbort);
    options.cleanupProviderSignal();
  };

  function getProviderIterator() {
    if (providerIterator) return providerIterator;
    const iteratorFactory = options.events?.[Symbol.asyncIterator];
    if (typeof iteratorFactory !== "function") throw new Error("AI_STREAM_ITERATOR_INVALID");
    providerIterator = iteratorFactory.call(options.events);
    if (!providerIterator || typeof providerIterator.next !== "function") {
      throw new Error("AI_STREAM_ITERATOR_INVALID");
    }
    return providerIterator;
  }

  async function closeProvider() {
    if (closed) return;
    if (closing) return closing;
    closing = (async () => {
      const iterator = getProviderIterator();
      if (iterator.return) await iterator.return();
      closed = true;
    })();
    try {
      await closing;
    } finally {
      closing = null;
    }
  }

  async function closeProviderBounded() {
    await withUnrefTimeout(
      closeProvider(),
      Math.min(1_000, Math.max(1, options.idleTimeoutMs)),
      "AI_STREAM_CLOSE_TIMEOUT"
    );
  }

  async function complete() {
    if (!finalization) {
      finalized = true;
      cleanup();
      finalization = persistTerminal(() => options.complete(
        options.privateOutput ? PRIVATE_OUTPUT_SUMMARY : summary.read()
      ));
    }
    await finalization;
    if (terminalError) throw terminalError;
  }

  async function fail(message: string) {
    if (!finalization) {
      finalized = true;
      cleanup();
      finalization = persistTerminal(() => options.fail(message));
    }
    await finalization;
    if (terminalError) throw terminalError;
  }

  async function persistTerminal(persist: () => Promise<unknown>) {
    try {
      await persist();
    } catch (error) {
      terminalError = createAuditPersistenceError(error);
    } finally {
      resolveTermination();
    }
  }

  async function cancel(message: string) {
    options.abortProvider(new Error(message));
    let auditError: unknown;
    try {
      await fail(message);
    } catch (error) {
      auditError = error;
    }
    await closeProviderBounded().catch(() => undefined);
    if (auditError) throw auditError;
  }

  function onAbort() {
    void cancel("AI_STREAM_CANCELLED").catch(() => undefined);
  }

  const iterator: AsyncIterableIterator<AiTextStreamEvent> = {
    [Symbol.asyncIterator]() {
      return iterator;
    },

    async next() {
      if (nextInFlight) throw new Error("AI_STREAM_CONCURRENT_NEXT");
      if (finalized) {
        await waitForTerminalAudit();
        return { done: true, value: undefined };
      }
      nextInFlight = true;
      clearStartTimer();
      if (options.signal?.aborted) {
        await cancel("AI_STREAM_CANCELLED");
        nextInFlight = false;
        throw createAbortError();
      }

      try {
        const providerNext = getProviderIterator().next();
        void providerNext.finally(() => {
          if (finalized) return closeProviderBounded().catch(() => undefined);
          return undefined;
        }).catch(() => undefined);
        const nextEvent = await Promise.race([
          withUnrefTimeout(providerNext, options.idleTimeoutMs, "AI_STREAM_IDLE_TIMEOUT"),
          termination.then(() => terminatedResult)
        ]);
        if ("terminated" in nextEvent) {
          await waitForTerminalAudit();
          return { done: true, value: undefined };
        }
        if (finalized) {
          await closeProviderBounded().catch(() => undefined);
          return { done: true, value: undefined };
        }
        if (nextEvent.done) {
          closed = true;
          await complete();
          return { done: true, value: undefined };
        }

        const eventOrTermination = nextEvent.value.type === "citation"
          ? await Promise.race([
              validateAiCitation(
                nextEvent.value,
                options.allowExternalResearch,
                options.citationResolver,
                options.operationSignal,
                options.citationResolverTimeoutMs
              ),
              termination.then(() => terminatedResult)
            ])
          : nextEvent.value;
        if ("terminated" in eventOrTermination) {
          await waitForTerminalAudit();
          return { done: true, value: undefined };
        }
        const event = eventOrTermination;
        if (event.type === "delta") summary.append(event.text);
        if (event.type === "done") {
          summary.replace(event.text);
          await closeProviderBounded();
          await complete();
        }
        return { done: false, value: event };
      } catch (error) {
        if (options.operationSignal.aborted && finalized) {
          await waitForTerminalAudit();
          await closeProviderBounded().catch(() => undefined);
          return { done: true, value: undefined };
        }
        options.abortProvider(error);
        let auditError: unknown;
        try {
          await fail(readErrorMessage(error, "AI_STREAM_FAILED"));
        } catch (persistenceError) {
          auditError = persistenceError;
        }
        await closeProviderBounded().catch(() => undefined);
        throw auditError ?? error;
      } finally {
        nextInFlight = false;
      }
    },

    async return() {
      await cancel("AI_STREAM_CANCELLED");
      return { done: true, value: undefined };
    },

    async throw(error?: unknown) {
      options.abortProvider(error ?? new Error("AI_STREAM_CANCELLED"));
      let auditError: unknown;
      try {
        await fail(readErrorMessage(error, "AI_STREAM_CANCELLED"));
      } catch (persistenceError) {
        auditError = persistenceError;
      }
      await closeProviderBounded().catch(() => undefined);
      throw auditError ?? error;
    }
  };

  const startTimer = setTimeout(() => {
    void cancel("AI_STREAM_NOT_CONSUMED").catch(() => undefined);
  }, Math.max(1, options.startTimeoutMs));
  startTimer.unref?.();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  return {
    [Symbol.asyncIterator]() {
      if (claimed) throw new Error("AI_STREAM_ALREADY_CONSUMED");
      claimed = true;
      return iterator;
    }
  };

  async function waitForTerminalAudit() {
    await finalization;
    if (terminalError) throw terminalError;
  }
}

const terminatedResult = { terminated: true } as const;

function withUnrefTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), Math.max(1, timeoutMs));
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function createComposedAbortController(externalSignal?: AbortSignal) {
  const controller = new AbortController();
  const mirrorExternalAbort = () => controller.abort(
    externalSignal?.reason ?? new Error("AI_STREAM_CANCELLED")
  );
  externalSignal?.addEventListener("abort", mirrorExternalAbort, { once: true });
  if (externalSignal?.aborted) mirrorExternalAbort();
  return {
    signal: controller.signal,
    abort(reason: unknown) {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    cleanup() {
      externalSignal?.removeEventListener("abort", mirrorExternalAbort);
    }
  };
}

function createAuditPersistenceError(cause: unknown) {
  const error = new Error("AI_STREAM_AUDIT_PERSIST_FAILED", { cause });
  error.name = "AiStreamAuditPersistenceError";
  return error;
}

// AiRun summaries are diagnostic metadata: bound readability and absolute persisted storage.
const AI_RUN_SUMMARY_MAX_GRAPHEMES = 160;
const AI_RUN_SUMMARY_MAX_CODE_POINTS = 640;
const AI_RUN_SUMMARY_MAX_UTF8_BYTES = 1_024;

function createBoundedSummary() {
  let value = "";
  let truncated = false;

  return {
    append(text: string) {
      if (truncated || !text) return;
      ({ value, truncated } = boundSummarySource(value + text));
    },
    replace(text: string) {
      ({ value, truncated } = boundSummarySource(text));
    },
    read() {
      return truncated ? appendSafeEllipsis(value) : value;
    }
  };
}

function validateEmbeddingRequest(request: AiEmbeddingRequest) {
  if (!request.model.trim()) throw new Error("AI_EMBEDDING_MODEL_REQUIRED");
  if (request.inputs.length === 0) throw new Error("AI_EMBEDDING_INPUTS_REQUIRED");
  if (request.inputs.some((input) => !input.trim())) throw new Error("AI_EMBEDDING_INPUT_INVALID");
}

function validateEmbeddings(request: AiEmbeddingRequest, embeddings: number[][]) {
  if (embeddings.length !== request.inputs.length) throw new Error("AI_EMBEDDING_LENGTH_MISMATCH");
  if (embeddings.length === 0) return;

  const dimensions = embeddings[0]?.length ?? 0;
  if (dimensions === 0) throw new Error("AI_EMBEDDING_EMPTY_VECTOR");
  for (const embedding of embeddings) {
    if (embedding.length !== dimensions) throw new Error("AI_EMBEDDING_DIMENSION_MISMATCH");
    if (embedding.some((value) => !Number.isFinite(value))) throw new Error("AI_EMBEDDING_NON_FINITE_VALUE");
  }
}

function createAbortError() {
  const error = new Error("AI_STREAM_CANCELLED");
  error.name = "AbortError";
  return error;
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function buildStrictJsonSchema(outputSchema: AiStructuredRunRequest<unknown, unknown>["outputSchema"], schemaName: string) {
  return zodTextFormat(outputSchema, schemaName).schema as Record<string, unknown>;
}

const PRIVATE_INPUT_SUMMARY = "[private owner studio input]";
const PRIVATE_OUTPUT_SUMMARY = "[private owner studio output]";

function summarizeInput(input: unknown, source: AiTextStreamRunRequest["source"]) {
  if (source === "owner_studio") return PRIVATE_INPUT_SUMMARY;
  if (typeof input === "string") return summarizeText(input);
  if (typeof input === "object" && input && "text" in input && typeof input.text === "string") {
    return summarizeText(input.text);
  }
  return summarizeText(safeSerialize(input));
}

function summarizeOutput(output: unknown, source: AiTextStreamRunRequest["source"]) {
  if (source === "owner_studio") return PRIVATE_OUTPUT_SUMMARY;
  if (typeof output === "object" && output && "title" in output && typeof output.title === "string") {
    return summarizeText(output.title);
  }
  if (typeof output === "string") return summarizeText(output);
  return summarizeText(safeSerialize(output));
}

function summarizeText(text: string) {
  const bounded = boundSummarySource(text);
  return bounded.truncated ? appendSafeEllipsis(bounded.value) : bounded.value;
}

function boundSummarySource(text: string) {
  const accepted: string[] = [];
  let codePoints = 0;
  let utf8Bytes = 0;
  for (const grapheme of splitGraphemes(text)) {
    const nextCodePoints = Array.from(grapheme).length;
    const nextBytes = Buffer.byteLength(grapheme, "utf8");
    if (accepted.length >= AI_RUN_SUMMARY_MAX_GRAPHEMES
      || codePoints + nextCodePoints > AI_RUN_SUMMARY_MAX_CODE_POINTS
      || utf8Bytes + nextBytes > AI_RUN_SUMMARY_MAX_UTF8_BYTES) {
      return { value: accepted.join(""), truncated: true };
    }
    accepted.push(grapheme);
    codePoints += nextCodePoints;
    utf8Bytes += nextBytes;
  }
  return { value: accepted.join(""), truncated: false };
}

function appendSafeEllipsis(value: string) {
  const suffix = "...";
  const graphemes = splitGraphemes(value);
  while (!summaryWithinLimits(graphemes.join("") + suffix, graphemes.length + suffix.length)) {
    graphemes.pop();
  }
  return graphemes.join("") + suffix;
}

function summaryWithinLimits(value: string, graphemeCount = splitGraphemes(value).length) {
  return graphemeCount <= AI_RUN_SUMMARY_MAX_GRAPHEMES
    && Array.from(value).length <= AI_RUN_SUMMARY_MAX_CODE_POINTS
    && Buffer.byteLength(value, "utf8") <= AI_RUN_SUMMARY_MAX_UTF8_BYTES;
}

const graphemeSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

function splitGraphemes(value: string) {
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(value), (part) => part.segment);
  return splitGraphemesFallback(value);
}

function splitGraphemesFallback(value: string) {
  const result: string[] = [];
  let regionalIndicatorCount = 0;
  for (const character of Array.from(value)) {
    const previous = result.at(-1);
    const isRegionalIndicator = /^\p{Regional_Indicator}$/u.test(character);
    const joinsPrevious = Boolean(previous) && (
      /^\p{Mark}$/u.test(character)
      || /^[\uFE0E\uFE0F]$/u.test(character)
      || /^\p{Emoji_Modifier}$/u.test(character)
      || character === "\u200D"
      || previous!.endsWith("\u200D")
      || (isRegionalIndicator && regionalIndicatorCount % 2 === 1)
    );
    if (joinsPrevious) result[result.length - 1] = previous + character;
    else result.push(character);
    regionalIndicatorCount = isRegionalIndicator ? regionalIndicatorCount + 1 : 0;
  }
  return result;
}

function safeSerialize(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : String(value);
  } catch {
    return "[unserializable input]";
  }
}

function sanitizeStoredError(message: string, source: AiTextStreamRunRequest["source"], fallback: string) {
  return source === "owner_studio" ? fallback : message;
}

function readValidationErrors(error: unknown) {
  if (!(error instanceof ZodError)) return [];
  return error.issues.map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`);
}
