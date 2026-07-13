import { DeepgramClient } from "@deepgram/sdk";
import type { AiProvider, AudioTranscriptionProviderRequest, AudioTranscriptionResult } from "../ai.types";

type DeepgramPrerecordedClient = {
  listen: {
    v1: {
      media: {
        transcribeUrl?: (request: Record<string, unknown>, options?: DeepgramRequestOptions) => Promise<unknown>;
        transcribeFile?: (
          source: DeepgramUploadable,
          options: Record<string, unknown>,
          requestOptions?: DeepgramRequestOptions
        ) => Promise<unknown>;
      };
    };
  };
};

type DeepgramRequestOptions = { abortSignal?: AbortSignal };

type DeepgramUploadable = Buffer | {
  data: Buffer;
  filename: string;
  contentType: string;
  contentLength: number;
};

type CreateDeepgramProviderOptions = {
  client?: DeepgramPrerecordedClient;
  apiKey?: string;
};

export function createDeepgramProvider(options: CreateDeepgramProviderOptions = {}): AiProvider {
  const apiKey = options.apiKey ?? process.env.DEEPGRAM_API_KEY ?? "";
  const client = options.client ?? (new DeepgramClient({ apiKey }) as unknown as DeepgramPrerecordedClient);

  return {
    async generateStructured() {
      throw new Error("DEEPGRAM_PROVIDER_STRUCTURED_GENERATION_NOT_CONFIGURED");
    },

    async transcribeAudio(request) {
      const deepgramOptions = buildDeepgramOptions(request);
      const mediaClient = client.listen.v1.media;
      const response = request.audioUrl
        ? await mediaClient.transcribeUrl?.(
            { url: request.audioUrl, ...deepgramOptions },
            { abortSignal: request.signal }
          )
        : await mediaClient.transcribeFile?.(
            buildDeepgramAudioUpload(request.audioBuffer ?? Buffer.alloc(0), request.mimeType),
            deepgramOptions,
            { abortSignal: request.signal }
          );

      if (!response) throw new Error("DEEPGRAM_TRANSCRIPTION_FAILED");
      return normalizeDeepgramTranscript(response);
    }
  };
}

function buildDeepgramOptions(request: AudioTranscriptionProviderRequest) {
  return {
    model: "nova-3",
    language: request.language ?? "multi",
    smart_format: true,
    utterances: true,
    diarize_model: "latest",
    keyterm: request.keyterms ?? []
  };
}

function buildDeepgramAudioUpload(audioBuffer: Buffer, mimeType?: string | null): DeepgramUploadable {
  const contentType = normalizeAudioMimeType(mimeType);
  if (!contentType) return audioBuffer;

  return {
    data: audioBuffer,
    filename: `recording.${audioExtensionFromMimeType(contentType)}`,
    contentType,
    contentLength: audioBuffer.byteLength
  };
}

function normalizeAudioMimeType(mimeType?: string | null) {
  const normalized = mimeType?.trim();
  if (!normalized) return null;

  const baseType = normalized.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!baseType.startsWith("audio/") && !baseType.startsWith("video/")) return null;
  return normalized;
}

function audioExtensionFromMimeType(mimeType: string) {
  const baseType = mimeType.split(";")[0]?.trim().toLowerCase();
  if (baseType === "audio/webm" || baseType === "video/webm") return "webm";
  if (baseType === "audio/ogg" || baseType === "video/ogg") return "ogg";
  if (baseType === "audio/mp4" || baseType === "audio/x-m4a") return "m4a";
  if (baseType === "video/mp4") return "mp4";
  if (baseType === "audio/mpeg" || baseType === "audio/mp3") return "mp3";
  if (baseType === "audio/wav" || baseType === "audio/wave" || baseType === "audio/x-wav") return "wav";
  if (baseType === "audio/aac") return "aac";
  return "audio";
}

function normalizeDeepgramTranscript(response: unknown): AudioTranscriptionResult {
  const payload = readDeepgramPayload(response);
  const alternative = payload?.results?.channels?.[0]?.alternatives?.[0];
  if (!alternative) throw new Error("DEEPGRAM_TRANSCRIPT_MISSING");

  return {
    text: alternative.transcript ?? "",
    confidence: typeof alternative.confidence === "number" ? alternative.confidence : null,
    durationSeconds: typeof payload.metadata?.duration === "number" ? payload.metadata.duration : null,
    words: Array.isArray(alternative.words)
      ? alternative.words.map((word) => ({
          word: word.word,
          start: word.start,
          end: word.end,
          confidence: typeof word.confidence === "number" ? word.confidence : null,
          speaker: typeof word.speaker === "number" ? word.speaker : undefined
        }))
      : undefined
  };
}

function readDeepgramPayload(response: unknown): DeepgramResponsePayload | null {
  if (!response || typeof response !== "object") return null;
  if ("result" in response && response.result && typeof response.result === "object") {
    return response.result as DeepgramResponsePayload;
  }
  return response as DeepgramResponsePayload;
}

type DeepgramResponsePayload = {
  metadata?: {
    duration?: number;
  };
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        words?: Array<{
          word: string;
          start: number;
          end: number;
          confidence?: number;
          speaker?: number;
        }>;
      }>;
    }>;
  };
};
