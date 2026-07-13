import type { AiHarness } from "../ai/ai.types";
import type { ObjectStorage } from "../../storage/object-storage";
import { STUDIO_EXTRACTED_TEXT_MAX_CHARACTERS } from "./studio-link-fetcher";
import { createIsolatedPdfExtractor, type StudioPdfExtraction } from "./studio-pdf-worker";
import { STUDIO_ASSET_MAX_ATTEMPTS, type StudioAsset, type StudioRepository } from "./studio.types";

const MAX_PRIVATE_OBJECT_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1_000;
export { STUDIO_ASSET_MAX_ATTEMPTS } from "./studio.types";

type StudioAssetProcessorOptions = {
  repository: StudioRepository;
  objectStorage: ObjectStorage;
  transcriptionHarness: Pick<AiHarness, "transcribeAudio">;
  extractPdfText?: (buffer: Buffer) => Promise<string | StudioPdfExtraction>;
  now?: () => string;
  leaseMs?: number;
  processingTimeoutMs?: number;
};

export type StudioAssetProcessor = {
  processNext(): Promise<StudioAsset | null>;
};

export function createStudioAssetProcessor(options: StudioAssetProcessorOptions): StudioAssetProcessor {
  const now = options.now ?? (() => new Date().toISOString());
  const pdfExtractor = options.extractPdfText ?? createIsolatedPdfExtractor();
  const leaseMs = options.leaseMs ?? 120_000;
  const processingTimeoutMs = options.processingTimeoutMs ?? 30_000;

  return {
    async processNext() {
      const claimed = await options.repository.claimNextAsset(now(), leaseMs);
      if (!claimed) return null;
      const scope = { workspaceId: claimed.workspaceId, ownerProfileId: claimed.ownerProfileId };
      try {
        const result = await withWallTimeout(
          (signal) => extractAsset(claimed, options, pdfExtractor, signal),
          processingTimeoutMs
        );
        return await options.repository.finishAssetProcessing({
          scope,
          assetId: claimed.id,
          claimToken: claimed.claimToken!,
          extractionStatus: "ready",
          extractedText: result.text,
          extractionMetadata: result.metadata,
          lastErrorCode: null,
          nextAttemptAt: null
        });
      } catch (error) {
        const errorCode = processingErrorCode(error);
        const terminal = isPermanentProcessingError(errorCode)
          || claimed.attemptCount >= STUDIO_ASSET_MAX_ATTEMPTS;
        const retryAt = terminal ? null : new Date(
          new Date(now()).getTime() + Math.min(
            MAX_RETRY_DELAY_MS,
            60_000 * 2 ** Math.max(0, claimed.attemptCount - 1)
          )
        ).toISOString();
        await options.repository.finishAssetProcessing({
          scope,
          assetId: claimed.id,
          claimToken: claimed.claimToken!,
          extractionStatus: "failed",
          extractedText: null,
          extractionMetadata: {},
          lastErrorCode: errorCode,
          nextAttemptAt: retryAt
        });
        throw error;
      }
    }
  };
}

async function extractAsset(
  asset: StudioAsset,
  options: StudioAssetProcessorOptions,
  pdfExtractor: (buffer: Buffer) => Promise<string | StudioPdfExtraction>,
  signal: AbortSignal
) {
  if (!asset.objectKey) throw new Error("STUDIO_ASSET_OBJECT_MISSING");
  const pendingObject = options.objectStorage.get(asset.objectKey, { signal });
  void pendingObject.then((object) => {
    if (signal.aborted) object.body.destroy();
  }, () => undefined);
  const object = await abortable(pendingObject, signal);
  if (object.sizeBytes !== null && object.sizeBytes > MAX_PRIVATE_OBJECT_BYTES) {
    object.body.destroy();
    throw new Error("STUDIO_ASSET_OBJECT_TOO_LARGE");
  }
  const buffer = await readBoundedObject(object.body, MAX_PRIVATE_OBJECT_BYTES, signal);
  const mimeType = (asset.mimeType ?? object.contentType ?? "").toLowerCase();

  if (mimeType.startsWith("text/")) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).trim();
    } catch {
      throw new Error("STUDIO_ASSET_TEXT_INVALID");
    }
    if (text.includes("\0")) throw new Error("STUDIO_ASSET_TEXT_INVALID");
    return cappedExtraction(text, { extractor: "utf8" });
  }
  if (mimeType === "application/pdf") {
    const extracted = await abortable(pdfExtractor(buffer), signal);
    const normalized = typeof extracted === "string"
      ? { text: extracted.trim(), truncated: false, originalCharacterCount: extracted.trim().length }
      : extracted;
    return cappedExtraction(normalized.text, {
      extractor: "pdf-parse",
      truncated: normalized.truncated,
      originalCharacterCount: normalized.originalCharacterCount
    });
  }
  if (mimeType.startsWith("audio/")) {
    if (buffer.length > MAX_AUDIO_BYTES) throw new Error("STUDIO_ASSET_OBJECT_TOO_LARGE");
    if (!new Set(["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm"]).has(mimeType)) {
      throw new Error("STUDIO_ASSET_MIME_UNSUPPORTED");
    }
    const transcript = await abortable(options.transcriptionHarness.transcribeAudio({
      workspaceId: asset.workspaceId,
      actorProfileId: asset.ownerProfileId,
      source: "proactive",
      audioBuffer: buffer,
      mimeType,
      signal
    }), signal);
    return cappedExtraction(transcript.text.trim(), {
      extractor: "ai_transcription",
      confidence: transcript.confidence,
      durationSeconds: transcript.durationSeconds,
      wordCount: transcript.words?.length ?? null
    });
  }
  if (mimeType.startsWith("image/")) {
    return { text: null, metadata: { extractor: "none", reason: "image_preserved_without_ocr" } };
  }
  throw new Error("STUDIO_ASSET_MIME_UNSUPPORTED");
}

function cappedExtraction(text: string, metadata: Record<string, unknown>) {
  const originalCharacterCount = typeof metadata.originalCharacterCount === "number"
    ? metadata.originalCharacterCount
    : text.length;
  const truncated = metadata.truncated === true || text.length > STUDIO_EXTRACTED_TEXT_MAX_CHARACTERS;
  return {
    text: text.slice(0, STUDIO_EXTRACTED_TEXT_MAX_CHARACTERS),
    metadata: {
      ...metadata,
      ...(truncated ? { truncated: true, originalCharacterCount } : {})
    }
  };
}

async function readBoundedObject(body: import("node:stream").Readable, limit: number, signal: AbortSignal) {
  const chunks: Buffer[] = [];
  let total = 0;
  const abort = () => body.destroy(signal.reason instanceof Error ? signal.reason : new Error("STUDIO_ASSET_PROCESSING_TIMEOUT"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > limit) {
        body.destroy();
        throw new Error("STUDIO_ASSET_OBJECT_TOO_LARGE");
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function withWallTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("STUDIO_ASSET_PROCESSING_TIMEOUT")), timeoutMs);
  try {
    return await abortable(operation(controller.signal), controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function processingErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "STUDIO_ASSET_PROCESSING_FAILED";
  const known = new Set([
    "STUDIO_ASSET_OBJECT_MISSING",
    "STUDIO_ASSET_OBJECT_TOO_LARGE",
    "STUDIO_ASSET_TEXT_INVALID",
    "STUDIO_ASSET_MIME_UNSUPPORTED",
    "STUDIO_PDF_INPUT_TOO_LARGE",
    "STUDIO_PDF_INVALID",
    "STUDIO_PDF_TIMEOUT",
    "STUDIO_ASSET_PROCESSING_TIMEOUT",
    "OBJECT_NOT_FOUND"
  ]);
  return known.has(error.message) ? error.message : "STUDIO_ASSET_PROCESSING_FAILED";
}

function isPermanentProcessingError(code: string) {
  return new Set([
    "STUDIO_ASSET_OBJECT_MISSING",
    "STUDIO_ASSET_OBJECT_TOO_LARGE",
    "STUDIO_ASSET_TEXT_INVALID",
    "STUDIO_ASSET_MIME_UNSUPPORTED",
    "STUDIO_PDF_INPUT_TOO_LARGE",
    "STUDIO_PDF_INVALID",
    "OBJECT_NOT_FOUND"
  ]).has(code);
}
