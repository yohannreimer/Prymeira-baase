import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createInMemoryObjectStorage } from "../../storage/in-memory-object-storage";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioAssetUploadCleanupProcessor } from "./studio-asset-upload-cleanup";

const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };

describe("Studio durable upload intent cleanup", () => {
  it("deletes an orphan object and completes its durable intent", async () => {
    const fixture = await createFixture();
    await fixture.storage.put({
      key: fixture.intent.objectKey,
      body: Readable.from("orphan"),
      contentType: "text/plain",
      sizeBytes: 6
    });
    await fixture.repository.reconcileAssetUploadFailure(scope, fixture.intent.id, fixture.now);
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
    await fixture.repository.reconcileAssetUploadFailure(scope, fixture.intent.id, clock);
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

  it("resolves a pending intent without deletion when its active asset already exists", async () => {
    const fixture = await createFixture();
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
    expect(await fixture.processor.processNext()).toBeNull();
    expect(fixture.storage.keys()).toEqual([fixture.intent.objectKey]);
    expect(await fixture.repository.listAssetUploadIntents(scope)).toMatchObject([{
      status: "resolved",
      assetId: asset.id
    }]);
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
    nextAttemptAt: clock()
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
