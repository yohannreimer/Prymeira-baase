import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createInMemoryObjectStorage } from "../../storage/in-memory-object-storage";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioAssetUploadCleanupProcessor } from "./studio-asset-upload-cleanup";

const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };

describe("Studio durable upload intent cleanup", () => {
  it("skips a growing resolved backlog and processes the next owner's due intent in one call", async () => {
    let clock = "2026-07-13T10:00:00.000Z";
    const repository = createInMemoryStudioRepository({ now: () => clock });
    const ownerA = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
    const ownerB = { workspaceId: "workspace_a", ownerProfileId: "owner_b" };
    const documentA = await repository.createDocument({
      ...ownerA, title: "A", bodyJson: {}, bodyText: "a", captureMode: "text",
      inboxState: "pending_review", isFocused: false, status: "active"
    });
    const documentB = await repository.createDocument({
      ...ownerB, title: "B", bodyJson: {}, bodyText: "b", captureMode: "text",
      inboxState: "pending_review", isFocused: false, status: "active"
    });
    for (let index = 0; index < 64; index += 1) {
      clock = new Date(Date.parse(clock) + 1_000).toISOString();
      const objectKey = `private/resolved-a-${index}.txt`;
      const intent = await repository.createAssetUploadIntent({
        ...ownerA, documentId: documentA.id, objectKey, displayName: `a-${index}.txt`,
        kind: "file", mimeType: "text/plain", sizeBytes: 1,
        uploadLeaseExpiresAt: "2026-07-13T11:00:00.000Z"
      });
      await reconcile(repository, intent, "2026-07-13T12:00:00.000Z");
      await repository.createAsset({
        ...ownerA, documentId: documentA.id, kind: "file", displayName: `a-${index}.txt`, objectKey,
        sourceUrl: null, finalUrl: null, fetchedAt: null, mimeType: "text/plain", sizeBytes: 1,
        extractionStatus: "pending", extractedText: null, extractionMetadata: {}, lastErrorCode: null,
        attemptCount: 0, nextAttemptAt: null
      });
    }
    clock = "2026-07-13T11:30:00.000Z";
    const dueB = await repository.createAssetUploadIntent({
      ...ownerB, documentId: documentB.id, objectKey: "private/due-b.txt", displayName: "b.txt",
      kind: "file", mimeType: "text/plain", sizeBytes: 1,
      uploadLeaseExpiresAt: "2026-07-13T11:45:00.000Z"
    });
    await repository.reconcileAssetUploadFailure({
      scope: ownerB,
      intentId: dueB.id,
      uploadToken: dueB.uploadToken!,
      objectKey: dueB.objectKey,
      now: "2026-07-13T12:00:00.000Z"
    });
    const storage = createInMemoryObjectStorage();
    await storage.put({
      key: dueB.objectKey, body: Readable.from("b"), contentType: "text/plain", sizeBytes: 1
    });
    clock = "2026-07-13T12:00:00.000Z";
    const processor = createStudioAssetUploadCleanupProcessor({ repository, objectStorage: storage, now: () => clock });

    await expect(processor.processNext()).resolves.toMatchObject({ id: dueB.id, ownerProfileId: "owner_b" });
    await expect(repository.listAssetUploadIntents(ownerA)).resolves.toEqual([]);
    await expect(repository.listAssetUploadIntents(ownerB)).resolves.toEqual([]);
    expect(storage.keys()).toEqual([]);
  });

  it("deletes an orphan object and completes its durable intent", async () => {
    const fixture = await createFixture();
    await fixture.storage.put({
      key: fixture.intent.objectKey,
      body: Readable.from("orphan"),
      contentType: "text/plain",
      sizeBytes: 6
    });
    await reconcile(fixture.repository, fixture.intent, fixture.now);
    expect(await fixture.processor.processNext()).toMatchObject({ id: fixture.intent.id });
    expect(fixture.storage.keys()).toEqual([]);
    expect(await fixture.repository.listAssetUploadIntents(scope)).toEqual([]);
  });

  it("persists a retry after storage failure and succeeds when due", async () => {
    let clock = "2026-07-13T12:00:00.000Z";
    const fixture = await createFixture(() => clock);
    await fixture.storage.put({
      key: fixture.intent.objectKey,
      body: Readable.from("orphan"),
      contentType: "text/plain",
      sizeBytes: 6
    });
    await reconcile(fixture.repository, fixture.intent, clock);
    fixture.storage.failNextDelete(new Error("storage unavailable"));
    await expect(fixture.processor.processNext()).rejects.toThrow("storage unavailable");
    expect(await fixture.repository.listAssetUploadIntents(scope)).toMatchObject([{
      status: "failed",
      lastErrorCode: "STUDIO_ASSET_UPLOAD_CLEANUP_FAILED",
      nextAttemptAt: "2026-07-13T12:01:00.000Z"
    }]);
    clock = "2026-07-13T12:01:00.000Z";
    await fixture.processor.processNext();
    expect(fixture.storage.keys()).toEqual([]);
  });

  it("recovers after restart by aborting the durable multipart id before deleting the final key", async () => {
    let clock = "2026-07-13T12:00:00.000Z";
    const fixture = await createFixture(() => clock);
    const session = await fixture.storage.beginAtomicUpload({
      key: fixture.intent.objectKey,
      contentType: fixture.intent.mimeType,
      sizeBytes: fixture.intent.sizeBytes
    });
    expect(await fixture.repository.attachAssetUploadSession({
      scope,
      intentId: fixture.intent.id,
      uploadToken: fixture.intent.uploadToken!,
      storageUploadId: session.uploadId
    })).toBe(true);
    await reconcile(fixture.repository, fixture.intent, clock, session.uploadId);
    expect(fixture.storage.atomicUploadIds()).toEqual([session.uploadId]);

    const restarted = createStudioAssetUploadCleanupProcessor({
      repository: fixture.repository,
      objectStorage: fixture.storage,
      now: () => clock
    });
    expect(await restarted.processNext()).toMatchObject({ id: fixture.intent.id });
    expect(fixture.storage.atomicUploadIds()).toEqual([]);
    expect(await fixture.repository.listAssetUploadIntents(scope)).toEqual([]);
  });

  it("retains the multipart id when abort temporarily fails and retries it when due", async () => {
    let clock = "2026-07-13T12:00:00.000Z";
    const fixture = await createFixture(() => clock);
    const session = await fixture.storage.beginAtomicUpload({
      key: fixture.intent.objectKey,
      contentType: fixture.intent.mimeType,
      sizeBytes: fixture.intent.sizeBytes
    });
    await fixture.repository.attachAssetUploadSession({
      scope,
      intentId: fixture.intent.id,
      uploadToken: fixture.intent.uploadToken!,
      storageUploadId: session.uploadId
    });
    await reconcile(fixture.repository, fixture.intent, clock, session.uploadId);
    fixture.storage.failNextAtomicAbort(new Error("abort unavailable"));
    await expect(fixture.processor.processNext()).rejects.toThrow("abort unavailable");
    expect(await fixture.repository.listAssetUploadIntents(scope)).toMatchObject([{
      status: "failed",
      storageUploadId: session.uploadId,
      storageSessionState: "abort_pending"
    }]);
    clock = "2026-07-13T12:01:00.000Z";
    await fixture.processor.processNext();
    expect(fixture.storage.atomicUploadIds()).toEqual([]);
  });

  it("retains the multipart id until abort is verified inactive", async () => {
    let clock = "2026-07-13T12:00:00.000Z";
    const fixture = await createFixture(() => clock);
    const session = await fixture.storage.beginAtomicUpload({
      key: fixture.intent.objectKey,
      contentType: fixture.intent.mimeType,
      sizeBytes: fixture.intent.sizeBytes
    });
    await fixture.repository.attachAssetUploadSession({
      scope,
      intentId: fixture.intent.id,
      uploadToken: fixture.intent.uploadToken!,
      storageUploadId: session.uploadId
    });
    await reconcile(fixture.repository, fixture.intent, clock, session.uploadId);
    fixture.storage.keepNextAtomicAbortActive();

    await expect(fixture.processor.processNext())
      .rejects.toThrow("STUDIO_ASSET_UPLOAD_ABORT_UNCONFIRMED");
    expect(fixture.storage.atomicUploadIds()).toEqual([session.uploadId]);
    expect(await fixture.repository.listAssetUploadIntents(scope)).toMatchObject([{
      status: "failed",
      storageUploadId: session.uploadId,
      storageSessionState: "abort_pending"
    }]);

    clock = "2026-07-13T12:01:00.000Z";
    await fixture.processor.processNext();
    expect(fixture.storage.atomicUploadIds()).toEqual([]);
    expect(await fixture.repository.listAssetUploadIntents(scope)).toEqual([]);
  });

  it("resolves a pending intent without deletion when its active asset already exists", async () => {
    let clock = "2026-07-13T12:00:00.000Z";
    const fixture = await createFixture(() => clock);
    await fixture.storage.put({
      key: fixture.intent.objectKey,
      body: Readable.from("valid"),
      contentType: "text/plain",
      sizeBytes: 5
    });
    const asset = await fixture.repository.createAsset({
      ...scope,
      documentId: fixture.documentId,
      kind: "file",
      displayName: "upload.txt",
      objectKey: fixture.intent.objectKey,
      sourceUrl: null,
      finalUrl: null,
      fetchedAt: null,
      mimeType: "text/plain",
      sizeBytes: 5,
      extractionStatus: "pending",
      extractedText: null,
      extractionMetadata: {},
      lastErrorCode: null,
      attemptCount: 0,
      nextAttemptAt: null
    });
    clock = "2026-07-13T12:01:00.000Z";
    expect(await fixture.processor.processNext()).toBeNull();
    expect(fixture.storage.keys()).toEqual([fixture.intent.objectKey]);
    expect(asset.id).toBeTruthy();
    expect(await fixture.repository.listAssetUploadIntents(scope)).toEqual([]);
  });
});

async function createFixture(clock: () => string = () => "2026-07-13T12:00:00.000Z") {
  const repository = createInMemoryStudioRepository({ now: clock });
  const document = await repository.createDocument({
    ...scope,
    title: "Private",
    bodyJson: {},
    bodyText: "private",
    captureMode: "text",
    inboxState: "pending_review",
    isFocused: false,
    status: "active"
  });
  const intent = await repository.createAssetUploadIntent({
    ...scope,
    documentId: document.id,
    objectKey: `private/${document.id}/upload.txt`,
    displayName: "upload.txt",
    kind: "file",
    mimeType: "text/plain",
    sizeBytes: 6,
    uploadLeaseExpiresAt: new Date(new Date(clock()).getTime() + 60_000).toISOString()
  });
  const storage = createInMemoryObjectStorage();
  return {
    repository,
    storage,
    intent,
    documentId: document.id,
    now: clock(),
    processor: createStudioAssetUploadCleanupProcessor({ repository, objectStorage: storage, now: clock })
  };
}

function reconcile(
  repository: ReturnType<typeof createInMemoryStudioRepository>,
  intent: Awaited<ReturnType<typeof repository.createAssetUploadIntent>>,
  now: string,
  storageUploadId?: string
) {
  return repository.reconcileAssetUploadFailure({
    scope,
    intentId: intent.id,
    uploadToken: intent.uploadToken!,
    objectKey: intent.objectKey,
    storageUploadId,
    now
  });
}
