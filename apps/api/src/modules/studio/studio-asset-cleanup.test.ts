import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createInMemoryObjectStorage } from "../../storage/in-memory-object-storage";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioAssetCleanupProcessor } from "./studio-asset-cleanup";
import type { StudioRepository } from "./studio.types";

const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };

describe("Studio asset cleanup outbox", () => {
  it("tombstones before storage deletion and retries a storage failure durably", async () => {
    let now = "2026-07-13T12:00:00.000Z";
    const fixture = await createFixture(() => now);
    const job = await fixture.repository.tombstoneAssetForCleanup(scope, fixture.assetId);
    expect(job).toMatchObject({ assetId: fixture.assetId, status: "pending" });
    expect(await fixture.repository.findAsset(scope, fixture.assetId)).toBeNull();
    expect(await fixture.repository.findAssetIncludingDeleting(scope, fixture.assetId))
      .toMatchObject({ lifecycleStatus: "deleting" });
    expect(fixture.objectStorage.keys()).toHaveLength(1);

    fixture.objectStorage.failNextDelete(new Error("storage down"));
    const cleanup = createStudioAssetCleanupProcessor({
      repository: fixture.repository,
      objectStorage: fixture.objectStorage,
      now: () => now
    });
    await expect(cleanup.processNext()).rejects.toThrow("storage down");
    const failed = (await fixture.repository.listAssetCleanupJobs(scope))[0]!;
    expect(failed).toMatchObject({ status: "failed", attemptCount: 1 });
    expect(failed.nextAttemptAt).not.toBeNull();
    expect(fixture.objectStorage.keys()).toHaveLength(1);

    now = failed.nextAttemptAt!;
    await cleanup.processNext();
    expect(fixture.objectStorage.keys()).toEqual([]);
    expect(await fixture.repository.findAssetIncludingDeleting(scope, fixture.assetId)).toBeNull();
    expect(await fixture.repository.listAssetCleanupJobs(scope)).toEqual([]);
  });

  it("keeps a tombstone and job when DB finalization fails after object deletion", async () => {
    let now = "2026-07-13T12:00:00.000Z";
    const fixture = await createFixture(() => now);
    await fixture.repository.tombstoneAssetForCleanup(scope, fixture.assetId);
    let failFinalize = true;
    const repository: StudioRepository = {
      ...fixture.repository,
      async completeAssetCleanup(input) {
        if (failFinalize) throw new Error("database unavailable");
        return fixture.repository.completeAssetCleanup(input);
      }
    };
    const cleanup = createStudioAssetCleanupProcessor({
      repository,
      objectStorage: fixture.objectStorage,
      now: () => now,
      leaseMs: 1_000
    });
    await expect(cleanup.processNext()).rejects.toThrow("database unavailable");
    expect(fixture.objectStorage.keys()).toEqual([]);
    expect(await fixture.repository.findAssetIncludingDeleting(scope, fixture.assetId))
      .toMatchObject({ lifecycleStatus: "deleting" });
    expect(await fixture.repository.listAssetCleanupJobs(scope)).toHaveLength(1);

    failFinalize = false;
    now = "2026-07-13T12:00:01.001Z";
    await cleanup.processNext();
    expect(await fixture.repository.findAssetIncludingDeleting(scope, fixture.assetId)).toBeNull();
  });

  it("does not tombstone another owner's asset", async () => {
    const fixture = await createFixture(() => "2026-07-13T12:00:00.000Z");
    expect(await fixture.repository.tombstoneAssetForCleanup(
      { workspaceId: "workspace_a", ownerProfileId: "owner_b" }, fixture.assetId
    )).toBeNull();
    expect(await fixture.repository.findAsset(scope, fixture.assetId)).not.toBeNull();
  });

  it("aborts a stalled delete and keeps the cleanup job durably retryable", async () => {
    const now = "2026-07-13T12:00:00.000Z";
    const fixture = await createFixture(() => now);
    await fixture.repository.tombstoneAssetForCleanup(scope, fixture.assetId);
    let started!: () => void;
    const deleteStarted = new Promise<void>((resolve) => { started = resolve; });
    let observedSignal: AbortSignal | undefined;
    const cleanup = createStudioAssetCleanupProcessor({
      repository: fixture.repository,
      objectStorage: {
        ...fixture.objectStorage,
        delete(_key, options) {
          observedSignal = options?.signal;
          started();
          return new Promise<void>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
          });
        }
      },
      now: () => now
    });
    const controller = new AbortController();
    const pending = cleanup.processNext(controller.signal);
    await deleteStarted;
    controller.abort(new Error("shutdown"));
    await expect(pending).rejects.toThrow("shutdown");
    expect(observedSignal?.aborted).toBe(true);
    expect(await fixture.repository.listAssetCleanupJobs(scope)).toMatchObject([{
      status: "failed",
      lastErrorCode: "STUDIO_ASSET_STORAGE_DELETE_FAILED"
    }]);
    expect(await fixture.repository.findAssetIncludingDeleting(scope, fixture.assetId))
      .toMatchObject({ lifecycleStatus: "deleting" });
  });
});

async function createFixture(now: () => string) {
  const repository = createInMemoryStudioRepository({ now });
  const document = await repository.createDocument(documentInput());
  const objectStorage = createInMemoryObjectStorage();
  const key = `private/${document.id}/asset.txt`;
  await objectStorage.put({ key, body: Readable.from("secret"), contentType: "text/plain", sizeBytes: 6 });
  const asset = await repository.createAsset({
    ...scope,
    documentId: document.id,
    kind: "file",
    displayName: "asset.txt",
    objectKey: key,
    sourceUrl: null,
    finalUrl: null,
    fetchedAt: null,
    mimeType: "text/plain",
    sizeBytes: 6,
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
  return { repository, objectStorage, assetId: asset.id };
}

function documentInput(): Parameters<StudioRepository["createDocument"]>[0] {
  return {
    ...scope,
    title: null,
    bodyJson: {},
    bodyText: "private",
    captureMode: "text",
    inboxState: "pending_review",
    isFocused: false,
    status: "active"
  };
}
