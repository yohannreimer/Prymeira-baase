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
        const rawOutput = await options.provider.generateStructured({
          taskKind: request.taskKind,
          agentKey: request.agentKey,
          promptKey: request.promptKey,
          promptVersion: request.promptVersion,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          input: request.input,
          schemaName: request.schemaName,
          jsonSchema: request.jsonSchema ?? buildStrictJsonSchema(request.outputSchema, request.schemaName ?? request.taskKind)
        });
        const parsedOutput = request.outputSchema.parse(rawOutput);
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
        const validationErrors = readValidationErrors(error);
        await options.repository.updateRun({
          ...run,
          status: "failed",
          validationErrors,
          latencyMs: now() - startedAt
        });

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
          signal: request.signal
        });
      } catch (error) {
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
      validateEmbeddingRequest(request);
      const embeddings = await options.provider.createEmbeddings(request);
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

type AuditedTextStreamOptions = {
  events: AsyncIterable<AiTextStreamEvent>;
  signal?: AbortSignal;
  allowExternalResearch: boolean;
  privateOutput: boolean;
  startTimeoutMs: number;
  idleTimeoutMs: number;
  citationResolver?: StudioLinkResolver;
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
  let resolveTermination!: () => void;
  const termination = new Promise<void>((resolve) => { resolveTermination = resolve; });

  const clearStartTimer = () => clearTimeout(startTimer);
  const cleanup = () => {
    clearStartTimer();
    options.signal?.removeEventListener("abort", onAbort);
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
    if (finalization) return finalization;
    finalized = true;
    resolveTermination();
    cleanup();
    finalization = Promise.resolve(options.complete(
      options.privateOutput ? PRIVATE_OUTPUT_SUMMARY : summary.read()
    )).then(() => undefined);
    return finalization;
  }

  async function fail(message: string) {
    if (finalization) return finalization;
    finalized = true;
    resolveTermination();
    cleanup();
    finalization = Promise.resolve(options.fail(message)).then(() => undefined);
    return finalization;
  }

  async function cancel(message: string) {
    await fail(message);
    await closeProviderBounded().catch(() => undefined);
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
      if (finalized) return { done: true, value: undefined };
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

        const event = nextEvent.value.type === "citation"
          ? await validateAiCitation(
              nextEvent.value,
              options.allowExternalResearch,
              options.citationResolver
            )
          : nextEvent.value;
        if (event.type === "delta") summary.append(event.text);
        if (event.type === "done") {
          summary.replace(event.text);
          await closeProviderBounded();
          await complete();
        }
        return { done: false, value: event };
      } catch (error) {
        await fail(readErrorMessage(error, "AI_STREAM_FAILED"));
        await closeProviderBounded().catch(() => undefined);
        throw error;
      } finally {
        nextInFlight = false;
      }
    },

    async return() {
      await cancel("AI_STREAM_CANCELLED");
      return { done: true, value: undefined };
    },

    async throw(error?: unknown) {
      await fail(readErrorMessage(error, "AI_STREAM_CANCELLED"));
      await closeProviderBounded().catch(() => undefined);
      throw error;
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
}

const terminatedResult = { terminated: true } as const;

function withUnrefTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), Math.max(1, timeoutMs));
    timer.unref?.();
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function createBoundedSummary() {
  const maximumSourceLength = 160;
  let value: string[] = [];
  let truncated = false;

  return {
    append(text: string) {
      for (const character of text) {
        if (value.length < maximumSourceLength) value.push(character);
        else truncated = true;
      }
    },
    replace(text: string) {
      const characters = Array.from(text);
      value = characters.slice(0, maximumSourceLength);
      truncated = characters.length > maximumSourceLength;
    },
    read() {
      return truncated ? `${value.slice(0, 157).join("")}...` : value.join("");
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
  const characters = Array.from(text);
  return characters.length > 160 ? `${characters.slice(0, 157).join("")}...` : text;
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
