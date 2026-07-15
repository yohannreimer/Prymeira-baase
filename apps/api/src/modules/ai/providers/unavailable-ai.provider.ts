import type {
  AiProvider,
  AiTextStreamRequest,
  AudioTranscriptionProviderRequest,
  AudioTranscriptionResult
} from "../ai.types";

export function createUnavailableAiProvider(transcriptionProvider: Pick<AiProvider, "transcribeAudio">): AiProvider {
  return {
    async generateStructured() {
      throw new Error("AI_PROVIDER_UNAVAILABLE");
    },

    async *streamText(_request: AiTextStreamRequest) {
      throw new Error("AI_PROVIDER_UNAVAILABLE");
    },

    async createEmbeddings() {
      throw new Error("AI_PROVIDER_UNAVAILABLE");
    },

    transcribeAudio(request: AudioTranscriptionProviderRequest): Promise<AudioTranscriptionResult> {
      return transcriptionProvider.transcribeAudio(request);
    }
  };
}
