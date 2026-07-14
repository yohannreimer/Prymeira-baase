import OpenAI from "openai";
import type {
  AiProvider,
  AiStructuredProviderRequest,
  AiTextStreamRequest,
  AudioTranscriptionResult
} from "../ai.types";
import { getPromptDefinition } from "../prompt-registry";

type OpenAiResponse = {
  id?: string;
  output_text?: string;
  output_parsed?: unknown;
  output?: unknown;
};

type OpenAiResponsesClient = {
  responses: {
    create(payload: unknown, options?: { signal?: AbortSignal }): Promise<OpenAiResponse | AsyncIterable<unknown>>;
  };
  embeddings?: {
    create(payload: unknown): Promise<{
      data: Array<{ index: number; embedding: number[] }>;
    }>;
  };
};

type CreateOpenAiProviderOptions = {
  client?: OpenAiResponsesClient;
  apiKey?: string;
};

export function createOpenAiProvider(options: CreateOpenAiProviderOptions = {}): AiProvider {
  const client: OpenAiResponsesClient = options.client ?? (new OpenAI({
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY
  }) as unknown as OpenAiResponsesClient);

  return {
    async generateStructured(request) {
      const prompt = getPromptDefinition(request.promptKey, request.promptVersion);
      const response = await client.responses.create(buildResponsesPayload(request, prompt.system, prompt.developer));
      if (isAsyncIterable(response)) throw new Error("OPENAI_STRUCTURED_OUTPUT_MISSING");
      return readStructuredOutput(response);
    },

    async *streamText(request) {
      const prompt = getPromptDefinition(request.promptKey, request.promptVersion);
      const response = await client.responses.create(
        buildTextStreamPayload(request, prompt.system, prompt.developer),
        { signal: request.signal }
      );
      if (!isAsyncIterable(response)) throw new Error("OPENAI_TEXT_STREAM_MISSING");

      let doneEmitted = false;
      for await (const rawEvent of response) {
        const event = readStreamEvent(rawEvent);
        if (!event) continue;
        if (event.type === "delta") yield event;
        if (event.type === "citation") yield event;
        if (event.type === "done" && !doneEmitted) {
          doneEmitted = true;
          yield event;
        }
      }
    },

    async createEmbeddings(request) {
      if (!client.embeddings) throw new Error("OPENAI_PROVIDER_EMBEDDINGS_NOT_CONFIGURED");
      const response = await client.embeddings.create({
        model: request.model,
        input: request.inputs
      });
      return [...response.data]
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);
    },

    async transcribeAudio(): Promise<AudioTranscriptionResult> {
      throw new Error("OPENAI_PROVIDER_TRANSCRIPTION_NOT_CONFIGURED");
    }
  };
}

function buildTextStreamPayload(request: AiTextStreamRequest, system: string, developer: string) {
  return {
    model: request.model,
    reasoning: {
      effort: request.reasoningEffort
    },
    input: [
      { role: "system", content: system },
      { role: "developer", content: developer },
      { role: "user", content: JSON.stringify(request.input) }
    ],
    stream: true,
    ...(request.allowExternalResearch ? { tools: [{ type: "web_search" }] } : {})
  };
}

function buildResponsesPayload(request: AiStructuredProviderRequest, system: string, developer: string) {
  return {
    model: request.model,
    reasoning: {
      effort: request.reasoningEffort
    },
    input: [
      {
        role: "system",
        content: system
      },
      {
        role: "developer",
        content: developer
      },
      {
        role: "user",
        content: JSON.stringify(request.input)
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: request.schemaName ?? request.taskKind,
        strict: true,
        schema: request.jsonSchema ?? {
          type: "object",
          additionalProperties: true
        }
      }
    }
  };
}

function readStructuredOutput(response: {
  output_text?: string;
  output_parsed?: unknown;
  output?: unknown;
}) {
  if (response.output_parsed !== undefined) return response.output_parsed;
  if (response.output_text) return JSON.parse(response.output_text);
  const text = findOutputText(response.output);
  if (text) return JSON.parse(text);
  throw new Error("OPENAI_STRUCTURED_OUTPUT_MISSING");
}

function findOutputText(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content && typeof content === "object" && "text" in content && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && typeof value === "object" && Symbol.asyncIterator in value);
}

function readStreamEvent(rawEvent: unknown) {
  if (!rawEvent || typeof rawEvent !== "object" || !("type" in rawEvent) || typeof rawEvent.type !== "string") {
    return null;
  }

  if (rawEvent.type === "response.output_text.delta" && "delta" in rawEvent && typeof rawEvent.delta === "string") {
    return { type: "delta" as const, text: rawEvent.delta };
  }
  if (rawEvent.type === "response.output_text.done" && "text" in rawEvent && typeof rawEvent.text === "string") {
    return { type: "done" as const, text: rawEvent.text };
  }
  if (rawEvent.type === "response.output_text.annotation.added" && "annotation" in rawEvent) {
    return readCitation(rawEvent.annotation);
  }
  if (rawEvent.type === "response.failed") throw new Error(readResponseFailure(rawEvent, "OPENAI_TEXT_STREAM_FAILED"));
  if (rawEvent.type === "response.incomplete") throw new Error(readResponseFailure(rawEvent, "OPENAI_TEXT_STREAM_INCOMPLETE"));
  if (rawEvent.type === "error" || rawEvent.type === "response.error") {
    throw new Error(readResponseFailure(rawEvent, "OPENAI_TEXT_STREAM_FAILED"));
  }
  return null;
}

function readCitation(annotation: unknown) {
  if (!annotation || typeof annotation !== "object") return null;
  if (!("type" in annotation) || annotation.type !== "url_citation") return null;
  if (!("title" in annotation) || typeof annotation.title !== "string") return null;
  if (!("url" in annotation) || typeof annotation.url !== "string") return null;

  const publishedAt = "published_at" in annotation && typeof annotation.published_at === "string"
    ? annotation.published_at
    : "publishedAt" in annotation && typeof annotation.publishedAt === "string"
      ? annotation.publishedAt
      : null;
  return {
    type: "citation" as const,
    title: annotation.title,
    url: annotation.url,
    publishedAt
  };
}

function readResponseFailure(event: object, fallback: string) {
  if ("message" in event && typeof event.message === "string" && event.message) return event.message;
  if ("error" in event && event.error && typeof event.error === "object"
    && "message" in event.error && typeof event.error.message === "string" && event.error.message) {
    return event.error.message;
  }
  if ("response" in event && event.response && typeof event.response === "object"
    && "error" in event.response && event.response.error && typeof event.response.error === "object"
    && "message" in event.response.error && typeof event.response.error.message === "string" && event.response.error.message) {
    return event.response.error.message;
  }
  return fallback;
}
