import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { AiHarness } from "../ai/ai.types";
import { createInMemoryObjectStorage } from "../../storage/in-memory-object-storage";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioAssetProcessor } from "./studio-asset-processor";
import type { StudioAsset, StudioRepository } from "./studio.types";

const now = "2026-07-13T12:00:00.000Z";

describe("Studio asset processor", () => {
  it("extracts text and PDF content from private object streams", async () => {
    const fixture = await createFixture();
    const text = await fixture.addAsset("notes.txt", "text/plain", Buffer.from("  pensamento privado  "));
    const pdf = await fixture.addAsset("plano.pdf", "application/pdf", Buffer.from("%PDF fixture"));
    const pdfExtractor = vi.fn(async () => "Plano extraído do PDF");
    const processor = createStudioAssetProcessor({
      repository: fixture.repository,
      objectStorage: fixture.objectStorage,
      transcriptionHarness: fixture.transcriptionHarness,
      extractPdfText: pdfExtractor,
      now: () => now
    });

    await processor.processNext();
    await processor.processNext();

    expect(await fixture.repository.findAsset(fixture.scope, text.id)).toMatchObject({
      extractionStatus: "ready",
      extractedText: "pensamento privado",
      extractionMetadata: { extractor: "utf8" },
      attemptCount: 1,
      lastErrorCode: null,
      nextAttemptAt: null
    });
    expect(await fixture.repository.findAsset(fixture.scope, pdf.id)).toMatchObject({
      extractionStatus: "ready",
      extractedText: "Plano extraído do PDF",
      extractionMetadata: { extractor: "pdf-parse" },
      attemptCount: 1
    });
    expect(pdfExtractor).toHaveBeenCalledWith(expect.any(Buffer));
    expect(fixture.objectStorage.keys()).toHaveLength(2);
  });

  it("persists audio transcription and provider metadata through the AI harness", async () => {
    const fixture = await createFixture({
      transcript: {
        text: "Decidir com calma.",
        confidence: 0.94,
        durationSeconds: 8,
        words: [{ word: "Decidir", start: 0, end: 0.5, confidence: 0.98 }]
      }
    });
    const audio = await fixture.addAsset("reflexao.webm", "audio/webm", Buffer.from("private audio"));
    const processor = createStudioAssetProcessor({
      repository: fixture.repository,
      objectStorage: fixture.objectStorage,
      transcriptionHarness: fixture.transcriptionHarness,
      now: () => now
    });

    await processor.processNext();

    expect(fixture.transcriptionHarness.transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_a",
      actorProfileId: "owner_a",
      source: "proactive",
      audioBuffer: Buffer.from("private audio"),
      mimeType: "audio/webm"
    }));
    expect(await fixture.repository.findAsset(fixture.scope, audio.id)).toMatchObject({
      extractionStatus: "ready",
      extractedText: "Decidir com calma.",
      extractionMetadata: {
        extractor: "ai_transcription",
        confidence: 0.94,
        durationSeconds: 8,
        wordCount: 1
      },
      attemptCount: 1
    });
  });

  it("persists a retry-due failed state and never deletes the original", async () => {
    const fixture = await createFixture();
    const audio = await fixture.addAsset("reflexao.webm", "audio/webm", Buffer.from("private audio"));
    vi.mocked(fixture.transcriptionHarness.transcribeAudio).mockRejectedValueOnce(new Error("provider down"));
    const processor = createStudioAssetProcessor({
      repository: fixture.repository,
      objectStorage: fixture.objectStorage,
      transcriptionHarness: fixture.transcriptionHarness,
      now: () => now
    });

    await expect(processor.processNext()).rejects.toThrow("provider down");
    expect(await fixture.repository.findAsset(fixture.scope, audio.id)).toMatchObject({
      extractionStatus: "failed",
      extractedText: null,
      lastErrorCode: "STUDIO_ASSET_PROCESSING_FAILED",
      attemptCount: 1,
      nextAttemptAt: "2026-07-13T12:01:00.000Z"
    });
    expect(fixture.objectStorage.keys()).toHaveLength(1);
  });

  it("claims an asset once under concurrent processors", async () => {
    const fixture = await createFixture();
    await fixture.addAsset("notes.txt", "text/plain", Buffer.from("once"));
    const first = createStudioAssetProcessor({
      repository: fixture.repository,
      objectStorage: fixture.objectStorage,
      transcriptionHarness: fixture.transcriptionHarness,
      now: () => now
    });
    const second = createStudioAssetProcessor({
      repository: fixture.repository,
      objectStorage: fixture.objectStorage,
      transcriptionHarness: fixture.transcriptionHarness,
      now: () => now
    });
    const results = await Promise.all([first.processNext(), second.processNext()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

async function createFixture(options: { transcript?: Awaited<ReturnType<AiHarness["transcribeAudio"]>> } = {}) {
  const repository = createInMemoryStudioRepository({ now: () => now });
  const document = await repository.createDocument(documentInput());
  const objectStorage = createInMemoryObjectStorage();
  const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
  const transcriptionHarness = {
    runStructured: vi.fn(),
    transcribeAudio: vi.fn(async () => options.transcript ?? {
      text: "transcript",
      confidence: null,
      durationSeconds: null
    })
  } as unknown as AiHarness;

  return {
    repository,
    objectStorage,
    transcriptionHarness,
    scope,
    async addAsset(displayName: string, mimeType: string, body: Buffer): Promise<StudioAsset> {
      const key = `workspaces/workspace_a/studio/owner_a/${document.id}/${displayName}`;
      await objectStorage.put({ key, body: Readable.from(body), contentType: mimeType, sizeBytes: body.length });
      return repository.createAsset({
        ...scope,
        documentId: document.id,
        kind: mimeType.startsWith("audio/") ? "audio" : "file",
        displayName,
        objectKey: key,
        sourceUrl: null,
        finalUrl: null,
        fetchedAt: null,
        mimeType,
        sizeBytes: body.length,
        extractionStatus: "pending",
        extractedText: null,
        extractionMetadata: {},
        lastErrorCode: null,
        attemptCount: 0,
        nextAttemptAt: null
      });
    }
  };
}

function documentInput(): Parameters<StudioRepository["createDocument"]>[0] {
  return {
    workspaceId: "workspace_a",
    ownerProfileId: "owner_a",
    title: "Plano",
    bodyJson: {},
    bodyText: "privado",
    captureMode: "text",
    inboxState: "pending_review",
    isFocused: false,
    status: "active"
  };
}
