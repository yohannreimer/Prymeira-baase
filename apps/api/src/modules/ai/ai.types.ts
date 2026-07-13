import type { z } from "zod";

export type AiRunSource =
  | "onboarding"
  | "create_with_ai"
  | "process"
  | "routine"
  | "training"
  | "proactive";

export type AiInputMode = "text" | "audio" | "pdf" | "mixed";

export type AiRunStatus = "queued" | "running" | "needs_review" | "failed" | "completed";

export type AiReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export type AiTaskKind =
  | "onboarding_setup"
  | "onboarding_diagnosis"
  | "process_draft"
  | "routine_draft"
  | "training_draft"
  | "announcement_draft"
  | "ops_review"
  | "transcript_cleanup"
  | "classification"
  | "proactive_suggestion";

export type AiRun = {
  id: string;
  workspaceId: string;
  actorProfileId: string;
  source: AiRunSource;
  inputMode: AiInputMode;
  taskKind: AiTaskKind;
  agentKey: string;
  promptVersion: string;
  model: string;
  reasoningEffort: AiReasoningEffort;
  status: AiRunStatus;
  traceId: string | null;
  inputSummary: string;
  outputSummary: string | null;
  validationErrors: string[];
  costEstimateCents: number | null;
  latencyMs: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateAiRunRecordInput = Omit<AiRun, "id" | "createdAt" | "updatedAt">;

export type AiRepository = {
  listRuns(workspaceId: string): Promise<AiRun[]>;
  findRun(workspaceId: string, runId: string): Promise<AiRun | null>;
  createRun(input: CreateAiRunRecordInput): Promise<AiRun>;
  updateRun(run: AiRun): Promise<AiRun>;
};

export type AiStructuredProviderRequest = {
  taskKind: AiTaskKind;
  agentKey: string;
  promptKey: string;
  promptVersion: string;
  model: string;
  reasoningEffort: AiReasoningEffort;
  input: unknown;
  schemaName?: string;
  jsonSchema?: Record<string, unknown>;
};

export type AudioTranscriptionProviderRequest = {
  audioUrl?: string;
  audioBuffer?: Buffer;
  mimeType?: string | null;
  language?: string | null;
  keyterms?: string[];
  signal?: AbortSignal;
};

export type AudioTranscriptionResult = {
  text: string;
  confidence: number | null;
  durationSeconds: number | null;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number | null;
    speaker?: number | null;
  }>;
};

export type AiProvider = {
  generateStructured(request: AiStructuredProviderRequest): Promise<unknown>;
  transcribeAudio(request: AudioTranscriptionProviderRequest): Promise<AudioTranscriptionResult>;
};

export type AiStructuredRunRequest<TInput, TOutput> = {
  workspaceId: string;
  actorProfileId: string;
  source: AiRunSource;
  inputMode: AiInputMode;
  taskKind: AiTaskKind;
  agentKey: string;
  promptKey: string;
  promptVersion: string;
  model: string;
  reasoningEffort: AiReasoningEffort;
  input: TInput;
  outputSchema: z.ZodType<TOutput>;
  schemaName?: string;
  jsonSchema?: Record<string, unknown>;
};

export type AiStructuredRunResult<TOutput> = {
  run: AiRun;
  output: TOutput;
};

export type AiTranscriptionRunRequest = {
  workspaceId: string;
  actorProfileId: string;
  source: AiRunSource;
  audioUrl?: string;
  audioBuffer?: Buffer;
  mimeType?: string | null;
  language?: string | null;
  keyterms?: string[];
  signal?: AbortSignal;
};

export type AiHarness = {
  runStructured<TInput, TOutput>(
    request: AiStructuredRunRequest<TInput, TOutput>
  ): Promise<AiStructuredRunResult<TOutput>>;
  transcribeAudio(request: AiTranscriptionRunRequest): Promise<AudioTranscriptionResult>;
};
