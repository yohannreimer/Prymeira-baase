import type { AiProvider } from "../ai.types";

export function createUnavailableAiProvider(): AiProvider {
  return {
    async generateStructured() {
      throw new Error("AI_PROVIDER_UNAVAILABLE");
    },

    async *streamText() {
      throw new Error("AI_PROVIDER_UNAVAILABLE");
    },

    async createEmbeddings() {
      throw new Error("AI_PROVIDER_UNAVAILABLE");
    },

    async transcribeAudio() {
      throw new Error("AI_PROVIDER_UNAVAILABLE");
    }
  };
}
