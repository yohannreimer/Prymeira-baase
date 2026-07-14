import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";
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
        inputSummary: summarizeInput(request.input),
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
          outputSummary: summarizeOutput(parsedOutput),
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
        inputSummary: summarizeInput(request.input),
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
          validationErrors: [readErrorMessage(error, "AI_STREAM_FAILED")],
          latencyMs: now() - startedAt
        });
        throw error;
      }

      return {
        run,
        events: createAuditedTextStream({
          events: providerEvents,
          signal: request.signal,
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
            validationErrors: [message],
            latencyMs: now() - startedAt
          })
        })
      };
    },

    async createEmbeddings(request: AiEmbeddingRequest): Promise<number[][]> {
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
        inputSummary: request.audioUrl ?? "audio_buffer",
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
          outputSummary: summarizeText(transcript.text),
          latencyMs: now() - startedAt
        });

        return transcript;
      } catch (error) {
        await options.repository.updateRun({
          ...run,
          status: "failed",
          validationErrors: [error instanceof Error ? error.message : "AI_TRANSCRIPTION_FAILED"],
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
  complete(outputSummary: string): Promise<unknown>;
  fail(message: string): Promise<unknown>;
};

function createAuditedTextStream(options: AuditedTextStreamOptions): AsyncIterable<AiTextStreamEvent> {
  const providerIterator = options.events[Symbol.asyncIterator]();
  const summary = createBoundedSummary();
  let finalized = false;
  let closed = false;

  async function closeProvider() {
    if (closed) return;
    closed = true;
    await providerIterator.return?.();
  }

  async function complete() {
    if (finalized) return;
    finalized = true;
    await options.complete(summary.read());
  }

  async function fail(message: string) {
    if (finalized) return;
    finalized = true;
    await options.fail(message);
  }

  const iterator: AsyncIterableIterator<AiTextStreamEvent> = {
    [Symbol.asyncIterator]() {
      return iterator;
    },

    async next() {
      if (finalized) return { done: true, value: undefined };
      if (options.signal?.aborted) {
        await closeProvider().catch(() => undefined);
        await fail("AI_STREAM_CANCELLED");
        throw createAbortError();
      }

      try {
        const nextEvent = await providerIterator.next();
        if (nextEvent.done) {
          closed = true;
          await complete();
          return { done: true, value: undefined };
        }

        const event = nextEvent.value;
        if (event.type === "delta") summary.append(event.text);
        if (event.type === "done") {
          summary.replace(event.text);
          await closeProvider();
          await complete();
        }
        return { done: false, value: event };
      } catch (error) {
        await closeProvider().catch(() => undefined);
        await fail(readErrorMessage(error, "AI_STREAM_FAILED"));
        throw error;
      }
    },

    async return() {
      if (!finalized) {
        await closeProvider().catch(() => undefined);
        await fail("AI_STREAM_CANCELLED");
      }
      return { done: true, value: undefined };
    },

    async throw(error?: unknown) {
      await closeProvider().catch(() => undefined);
      await fail(readErrorMessage(error, "AI_STREAM_CANCELLED"));
      throw error;
    }
  };

  return iterator;
}

function createBoundedSummary() {
  const maximumSourceLength = 160;
  let value = "";
  let truncated = false;

  return {
    append(text: string) {
      if (value.length >= maximumSourceLength) {
        if (text.length > 0) truncated = true;
        return;
      }
      const room = maximumSourceLength - value.length;
      value += text.slice(0, room);
      if (text.length > room) truncated = true;
    },
    replace(text: string) {
      value = text.slice(0, maximumSourceLength);
      truncated = text.length > maximumSourceLength;
    },
    read() {
      return truncated ? `${value.slice(0, 157)}...` : value;
    }
  };
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

function summarizeInput(input: unknown) {
  if (typeof input === "string") return summarizeText(input);
  if (typeof input === "object" && input && "text" in input && typeof input.text === "string") {
    return summarizeText(input.text);
  }
  return summarizeText(JSON.stringify(input));
}

function summarizeOutput(output: unknown) {
  if (typeof output === "object" && output && "title" in output && typeof output.title === "string") {
    return summarizeText(output.title);
  }
  if (typeof output === "string") return summarizeText(output);
  return summarizeText(JSON.stringify(output));
}

function summarizeText(text: string) {
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function readValidationErrors(error: unknown) {
  if (!(error instanceof ZodError)) return [];
  return error.issues.map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`);
}
