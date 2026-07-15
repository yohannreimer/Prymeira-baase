import type { AiProvider } from "../ai.types";
import { createDeepgramProvider } from "./deepgram.provider";
import { createMockAiProvider } from "./mock-ai.provider";
import { createOpenAiProvider } from "./openai.provider";
import { createUnavailableAiProvider } from "./unavailable-ai.provider";

export type CreateDefaultAiProviderOptions = {
  mode?: "demo" | "pilot" | "production";
  studioEnabled?: boolean;
  openAiApiKey?: string | null;
  deepgramApiKey?: string | null;
};

export function createDefaultAiProvider(options: CreateDefaultAiProviderOptions = {}): AiProvider {
  const openAiApiKey = "openAiApiKey" in options ? options.openAiApiKey : process.env.OPENAI_API_KEY;
  const deepgramApiKey = "deepgramApiKey" in options ? options.deepgramApiKey : process.env.DEEPGRAM_API_KEY;
  const structuredProvider = openAiApiKey
    ? createOpenAiProvider({ apiKey: openAiApiKey })
    : createMockAiProvider();
  const transcriptionProvider = deepgramApiKey
    ? createDeepgramProvider({ apiKey: deepgramApiKey })
    : createMockAiProvider();

  if (options.mode === "production" && options.studioEnabled && !openAiApiKey) {
    return createUnavailableAiProvider();
  }

  return {
    generateStructured(request) {
      return structuredProvider.generateStructured(request);
    },

    streamText(request) {
      return structuredProvider.streamText(request);
    },

    createEmbeddings(request) {
      return structuredProvider.createEmbeddings(request);
    },

    transcribeAudio(request) {
      return transcriptionProvider.transcribeAudio(request);
    }
  };
}
