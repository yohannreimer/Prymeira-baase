import type { AiProvider } from "../ai.types";
import { createDeepgramProvider } from "./deepgram.provider";
import { createMockAiProvider } from "./mock-ai.provider";
import { createOpenAiProvider } from "./openai.provider";

export function createDefaultAiProvider(): AiProvider {
  const structuredProvider = process.env.OPENAI_API_KEY
    ? createOpenAiProvider()
    : createMockAiProvider();
  const transcriptionProvider = process.env.DEEPGRAM_API_KEY
    ? createDeepgramProvider()
    : createMockAiProvider();

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
