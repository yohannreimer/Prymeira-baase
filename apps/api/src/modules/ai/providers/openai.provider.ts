import OpenAI from "openai";
import type { AiProvider, AiStructuredProviderRequest, AudioTranscriptionResult } from "../ai.types";
import { getPromptDefinition } from "../prompt-registry";

type OpenAiResponsesClient = {
  responses: {
    create(payload: unknown): Promise<{
      id?: string;
      output_text?: string;
      output_parsed?: unknown;
      output?: unknown;
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
      return readStructuredOutput(response);
    },

    async transcribeAudio(): Promise<AudioTranscriptionResult> {
      throw new Error("OPENAI_PROVIDER_TRANSCRIPTION_NOT_CONFIGURED");
    }
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
