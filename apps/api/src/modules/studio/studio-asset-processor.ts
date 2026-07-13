import type { AiHarness } from "../ai/ai.types";
import type { ObjectStorage } from "../../storage/object-storage";
import type { StudioAsset, StudioRepository } from "./studio.types";

const MAX_PRIVATE_OBJECT_BYTES = 25 * 1024 * 1024;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1_000;

type StudioAssetProcessorOptions = {
  repository: StudioRepository;
  objectStorage: ObjectStorage;
  transcriptionHarness: Pick<AiHarness, "transcribeAudio">;
  extractPdfText?: (buffer: Buffer) => Promise<string>;
  now?: () => string;
};

export type StudioAssetProcessor = {
  processNext(): Promise<StudioAsset | null>;
};

export function createStudioAssetProcessor(options: StudioAssetProcessorOptions): StudioAssetProcessor {
  const now = options.now ?? (() => new Date().toISOString());
  const pdfExtractor = options.extractPdfText ?? extractPdfText;

  return {
    async processNext() {
      const claimed = await options.repository.claimNextAsset(now());
      if (!claimed) return null;

      try {
        const result = await extractAsset(claimed, options, pdfExtractor);
        return await options.repository.updateAssetExtraction({
          ...claimed,
          extractionStatus: "ready",
          extractedText: result.text,
          extractionMetadata: result.metadata,
          lastErrorCode: null,
          nextAttemptAt: null
        });
      } catch (error) {
        const retryAt = new Date(
          new Date(now()).getTime() + Math.min(
            MAX_RETRY_DELAY_MS,
            60_000 * 2 ** Math.max(0, claimed.attemptCount - 1)
          )
        ).toISOString();
        await options.repository.updateAssetExtraction({
          ...claimed,
          extractionStatus: "failed",
          extractedText: null,
          extractionMetadata: {},
          lastErrorCode: "STUDIO_ASSET_PROCESSING_FAILED",
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
  pdfExtractor: (buffer: Buffer) => Promise<string>
) {
  if (!asset.objectKey) throw new Error("STUDIO_ASSET_OBJECT_MISSING");
  const object = await options.objectStorage.get(asset.objectKey);
  if (object.sizeBytes !== null && object.sizeBytes > MAX_PRIVATE_OBJECT_BYTES) {
    object.body.destroy();
    throw new Error("STUDIO_ASSET_OBJECT_TOO_LARGE");
  }
  const buffer = await readBoundedObject(object.body, MAX_PRIVATE_OBJECT_BYTES);
  const mimeType = (asset.mimeType ?? object.contentType ?? "").toLowerCase();

  if (mimeType.startsWith("text/")) {
    return {
      text: buffer.toString("utf8").trim(),
      metadata: { extractor: "utf8" }
    };
  }
  if (mimeType === "application/pdf") {
    return {
      text: (await pdfExtractor(buffer)).trim(),
      metadata: { extractor: "pdf-parse" }
    };
  }
  if (mimeType.startsWith("audio/")) {
    const transcript = await options.transcriptionHarness.transcribeAudio({
      workspaceId: asset.workspaceId,
      actorProfileId: asset.ownerProfileId,
      source: "proactive",
      audioBuffer: buffer,
      mimeType
    });
    return {
      text: transcript.text.trim(),
      metadata: {
        extractor: "ai_transcription",
        confidence: transcript.confidence,
        durationSeconds: transcript.durationSeconds,
        wordCount: transcript.words?.length ?? null
      }
    };
  }
  if (mimeType.startsWith("image/")) {
    return {
      text: null,
      metadata: { extractor: "none", reason: "image_preserved_without_ocr" }
    };
  }
  throw new Error("STUDIO_ASSET_MIME_UNSUPPORTED");
}

async function readBoundedObject(body: NodeJS.ReadableStream & { destroy(error?: Error): unknown }, limit: number) {
  const chunks: Buffer[] = [];
  let total = 0;
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
}

async function extractPdfText(buffer: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}
