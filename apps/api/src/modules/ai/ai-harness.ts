import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";
import type {
  AiHarness,
  AiProvider,
  AiRepository,
  AiStructuredRunRequest,
  AiStructuredRunResult,
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
          keyterms: request.keyterms
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
