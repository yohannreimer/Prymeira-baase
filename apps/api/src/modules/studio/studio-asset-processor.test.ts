import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { AiHarness } from "../ai/ai.types";
import { createInMemoryObjectStorage } from "../../storage/in-memory-object-storage";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioAssetProcessor } from "./studio-asset-processor";
import { STUDIO_ASSET_MAX_ATTEMPTS } from "./studio-asset-processor";
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

  it("reclaims an expired lease and rejects stale worker completion", async () => {
    const fixture = await createFixture();
    const asset = await fixture.addAsset("notes.txt", "text/plain", Buffer.from("once"));
    const first = await fixture.repository.claimNextAsset(now, 1_000);
    expect(first?.claimToken).toBeTruthy();
    expect(await fixture.repository.claimNextAsset("2026-07-13T12:00:00.999Z", 1_000)).toBeNull();
    const reclaimed = await fixture.repository.claimNextAsset("2026-07-13T12:00:01.000Z", 1_000);
    expect(reclaimed).toMatchObject({ id: asset.id, attemptCount: 2 });
    expect(reclaimed?.claimToken).not.toBe(first?.claimToken);

    expect(await fixture.repository.finishAssetProcessing({
      scope: fixture.scope,
      assetId: asset.id,
      claimToken: first!.claimToken!,
      extractionStatus: "ready",
      extractedText: "stale",
      extractionMetadata: {},
      lastErrorCode: null,
      nextAttemptAt: null
    })).toBeNull();
    expect(await fixture.repository.finishAssetProcessing({
      scope: fixture.scope,
      assetId: asset.id,
      claimToken: reclaimed!.claimToken!,
      extractionStatus: "ready",
      extractedText: "fresh",
      extractionMetadata: {},
      lastErrorCode: null,
      nextAttemptAt: null
    })).toMatchObject({ extractedText: "fresh", claimToken: null, leaseExpiresAt: null });
  });

  it("stops retrying after five attempts and leaves permanent failures terminal", async () => {
    let clock = new Date(now);
    const fixture = await createFixture();
    const asset = await fixture.addAsset("bad.bin", "application/octet-stream", Buffer.from([0, 1, 2]));
    for (let attempt = 1; attempt <= STUDIO_ASSET_MAX_ATTEMPTS; attempt += 1) {
      const claimed = await fixture.repository.claimNextAsset(clock.toISOString(), 1_000);
      expect(claimed?.attemptCount).toBe(attempt);
      await fixture.repository.finishAssetProcessing({
        scope: fixture.scope,
        assetId: asset.id,
        claimToken: claimed!.claimToken!,
        extractionStatus: "failed",
        extractedText: null,
        extractionMetadata: {},
        lastErrorCode: "TRANSIENT",
        nextAttemptAt: new Date(clock.getTime() + 1_000).toISOString()
      });
      clock = new Date(clock.getTime() + 1_000);
    }
    expect(await fixture.repository.claimNextAsset(clock.toISOString(), 1_000)).toBeNull();

    const terminalFixture = await createFixture();
    const terminal = await terminalFixture.addAsset("bad.bin", "application/octet-stream", Buffer.from([0, 1]));
    const processor = createStudioAssetProcessor({
      repository: terminalFixture.repository,
      objectStorage: terminalFixture.objectStorage,
      transcriptionHarness: terminalFixture.transcriptionHarness,
      now: () => now
    });
    await expect(processor.processNext()).rejects.toThrow("STUDIO_ASSET_MIME_UNSUPPORTED");
    expect(await terminalFixture.repository.findAsset(terminalFixture.scope, terminal.id)).toMatchObject({
      extractionStatus: "failed",
      nextAttemptAt: null,
      attemptCount: 1
    });
  });

  it("caps extracted text with truncation metadata", async () => {
    const fixture = await createFixture();
    const asset = await fixture.addAsset("large.txt", "text/plain", Buffer.from("x".repeat(500_100)));
    const processor = createStudioAssetProcessor({
      repository: fixture.repository,
      objectStorage: fixture.objectStorage,
      transcriptionHarness: fixture.transcriptionHarness,
      now: () => now
    });
    await processor.processNext();
    expect(await fixture.repository.findAsset(fixture.scope, asset.id)).toMatchObject({
      extractedText: "x".repeat(500_000),
      extractionMetadata: {
        extractor: "utf8",
        truncated: true,
        originalCharacterCount: 500_100
      }
    });
  });

  it("enforces a processing wall timeout and destroys a stalled private stream", async () => {
    vi.useFakeTimers();
    try {
      const fixture = await createFixture();
      const asset = await fixture.addAsset("stalled.txt", "text/plain", Buffer.from("stored"));
      const stalled = new Readable({ read() {} });
      const processor = createStudioAssetProcessor({
        repository: fixture.repository,
        objectStorage: {
          ...fixture.objectStorage,
          async get() {
            return { body: stalled, contentType: "text/plain", sizeBytes: null };
          }
        },
        transcriptionHarness: fixture.transcriptionHarness,
        now: () => now,
        processingTimeoutMs: 100
      });
      const pending = processor.processNext();
      const assertion = expect(pending).rejects.toThrow("STUDIO_ASSET_PROCESSING_TIMEOUT");
      await vi.advanceTimersByTimeAsync(101);
      await assertion;
      expect(stalled.destroyed).toBe(true);
      expect(await fixture.repository.findAsset(fixture.scope, asset.id)).toMatchObject({
        extractionStatus: "failed",
        lastErrorCode: "STUDIO_ASSET_PROCESSING_TIMEOUT"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds audio transcription wall time without persisting a late result", async () => {
    vi.useFakeTimers();
    try {
      const fixture = await createFixture();
      const asset = await fixture.addAsset("audio.webm", "audio/webm", Buffer.from("bounded audio"));
      let observedSignal: AbortSignal | undefined;
      let resolveLate!: (value: Awaited<ReturnType<AiHarness["transcribeAudio"]>>) => void;
      vi.mocked(fixture.transcriptionHarness.transcribeAudio).mockImplementationOnce((request) => {
        observedSignal = request.signal;
        return new Promise((resolve) => { resolveLate = resolve; });
      });
      const processor = createStudioAssetProcessor({
        repository: fixture.repository,
        objectStorage: fixture.objectStorage,
        transcriptionHarness: fixture.transcriptionHarness,
        now: () => now,
        processingTimeoutMs: 100
      });
      const pending = processor.processNext();
      const assertion = expect(pending).rejects.toThrow("STUDIO_ASSET_PROCESSING_TIMEOUT");
      await vi.advanceTimersByTimeAsync(101);
      await assertion;
      expect(observedSignal?.aborted).toBe(true);
      resolveLate({ text: "late", confidence: 1, durationSeconds: 1 });
      await Promise.resolve();
      expect(await fixture.repository.findAsset(fixture.scope, asset.id)).toMatchObject({
        extractionStatus: "failed",
        extractedText: null,
        nextAttemptAt: "2026-07-13T12:01:00.000Z"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroys a private object stream that resolves after the processing timeout", async () => {
    vi.useFakeTimers();
    try {
      const fixture = await createFixture();
      const asset = await fixture.addAsset("late.txt", "text/plain", Buffer.from("stored"));
      const lateBody = Readable.from("late private body");
      let resolveGet!: (value: Awaited<ReturnType<typeof fixture.objectStorage.get>>) => void;
      const processor = createStudioAssetProcessor({
        repository: fixture.repository,
        objectStorage: {
          ...fixture.objectStorage,
          get: vi.fn((_key, options) => new Promise<Awaited<ReturnType<typeof fixture.objectStorage.get>>>((resolve) => {
            expect(options?.signal).toBeInstanceOf(AbortSignal);
            resolveGet = resolve;
          }))
        },
        transcriptionHarness: fixture.transcriptionHarness,
        now: () => now,
        processingTimeoutMs: 100
      });
      const pending = processor.processNext();
      const assertion = expect(pending).rejects.toThrow("STUDIO_ASSET_PROCESSING_TIMEOUT");
      await vi.advanceTimersByTimeAsync(101);
      await assertion;
      resolveGet({ body: lateBody, contentType: "text/plain", sizeBytes: null });
      await Promise.resolve();
      expect(lateBody.destroyed).toBe(true);
      expect(await fixture.repository.findAsset(fixture.scope, asset.id)).toMatchObject({
        extractionStatus: "failed",
        extractedText: null
      });
    } finally {
      vi.useRealTimers();
    }
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
        nextAttemptAt: null,
        claimToken: null,
        leaseExpiresAt: null,
        lifecycleStatus: "active"
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
