import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryObjectStorage } from "../../storage/in-memory-object-storage";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioService } from "./studio.service";
import {
  STUDIO_DELETE_CONFIRMATION,
  createInMemoryStudioPortabilityStore,
  createStudioPortabilityService,
  type StudioPortabilitySnapshot
} from "./studio-portability.service";

const ownerA = { workspaceId: "workspace_a", profileId: "owner_a", role: "owner" as const };
const ownerB = { workspaceId: "workspace_a", profileId: "owner_b", role: "owner" as const };

describe("Studio portability service", () => {
  it("records an asynchronous export before snapshotting, streams it in maintenance, and signs only when ready", async () => {
    const storage = createInMemoryObjectStorage();
    const assetAKey = "workspaces/workspace_a/studio/owner_a/assets/audio-a.webm";
    const assetBKey = "workspaces/workspace_a/studio/owner_b/assets/audio-b.webm";
    await put(storage, assetAKey, "original-a");
    await put(storage, assetBKey, "original-b");
    const store = createInMemoryStudioPortabilityStore({ snapshots: [
      snapshot("owner_a", assetAKey),
      snapshot("owner_b", assetBKey)
    ] });
    const readSnapshot = vi.spyOn(store, "readSnapshot");
    const logs: Array<Record<string, unknown>> = [];
    const service = createStudioPortabilityService({
      store,
      objectStorage: storage,
      verifyOwner: async (actor) => actor.role === "owner",
      now: () => new Date("2026-07-14T15:00:00.000Z"),
      logger: { info: (event) => logs.push(event), error: (event) => logs.push(event) }
    });

    const exported = await service.exportData(ownerA);
    expect(exported).toMatchObject({ status: "pending", expiresAt: "2026-07-14T15:15:00.000Z" });
    expect(storage.keys().filter((key) => key.includes("/exports/"))).toEqual([]);
    expect(readSnapshot).not.toHaveBeenCalled();

    await expect(service.getExport(ownerA, exported.exportId)).resolves.toMatchObject({
      exportId: exported.exportId, status: "pending"
    });
    await expect(service.processNextExport()).resolves.toMatchObject({
      workspaceId: "workspace_a", ownerProfileId: "owner_a"
    });
    expect(readSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_a", ownerProfileId: "owner_a", status: "processing"
    }));
    const downloadable = await service.getExport(ownerA, exported.exportId);
    expect(downloadable).toMatchObject({
      status: "ready",
      requestedAt: "2026-07-14T15:00:00.000Z",
      filename: "prymeira-baase-estudio-2026-07-14.zip",
      sizeBytes: expect.any(Number),
      expiresAt: "2026-07-14T15:15:00.000Z"
    });
    expect(downloadable.sizeBytes).toBeGreaterThan(0);
    const downloadUrl = downloadable.downloadUrl;
    expect(downloadUrl).toContain("expires_in=900");
    expect(downloadUrl).toContain("response-content-disposition=");
    if (!downloadUrl) throw new Error("expected private download URL");
    expect(new URL(downloadUrl).searchParams.get("response-content-disposition"))
      .toContain("prymeira-baase-estudio-2026-07-14.zip");
    const exportKey = storage.keys().find((key) => key.includes("/exports/"));
    expect(exportKey).toMatch(/^workspaces\/workspace_a\/studio\/owner_a\/exports\/.+\.zip$/u);
    const archive = await readObject(storage, exportKey!);
    expect(downloadable.sizeBytes).toBe(archive.length);
    const entries = readStoredZip(archive);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8"));
    expect(manifest).toMatchObject({
      owner_profile_id: "owner_a",
      documents: [{ id: "document_owner_a", body_text: "segredo owner_a" }],
      versions: [{ id: "version_owner_a" }],
      structures: [{ id: "structure_owner_a" }],
      conversations: [{ id: "conversation_owner_a" }],
      citations: [{ id: "citation_owner_a" }],
      relations: [{ id: "relation_owner_a" }]
    });
    expect(JSON.stringify(manifest)).not.toContain("owner_b");
    expect(entries.get("originais/document_owner_a/asset_owner_a-audio-a.webm")?.toString()).toBe("original-a");
    expect([...logs].some((entry) => JSON.stringify(entry).includes("segredo owner_a"))).toBe(false);
  });

  it("fences deletion against an in-flight export publication and removes the staged object", async () => {
    const storage = createInMemoryObjectStorage();
    const ownerSnapshot = snapshot("owner_a", null);
    const store = createInMemoryStudioPortabilityStore({ snapshots: [ownerSnapshot] });
    let releaseOwnerCheck!: () => void;
    const ownerCheckBlocked = new Promise<void>((resolve) => { releaseOwnerCheck = resolve; });
    let publishCheckStarted!: () => void;
    const publishCheck = new Promise<void>((resolve) => { publishCheckStarted = resolve; });
    let checks = 0;
    const service = createStudioPortabilityService({
      store,
      objectStorage: storage,
      verifyOwner: async () => {
        checks += 1;
        if (checks === 3) {
          publishCheckStarted();
          await ownerCheckBlocked;
        }
        return true;
      }
    });
    const requested = await service.exportData(ownerA);
    const processing = service.processNextExport();
    await publishCheck;
    let deletionSettled = false;
    const deleting = service.deleteData(ownerA, STUDIO_DELETE_CONFIRMATION).then((result) => {
      deletionSettled = true;
      return result;
    });
    await Promise.resolve();
    expect(deletionSettled).toBe(false);
    releaseOwnerCheck();

    await processing;
    await expect(deleting).resolves.toMatchObject({ status: "completed" });
    expect(storage.keys().filter((key) => key.includes(requested.exportId))).toEqual([]);
    await expect(service.getExport(ownerA, requested.exportId)).rejects.toThrow("STUDIO_EXPORT_NOT_FOUND");
  });

  it.each([
    ["truncated", -1],
    ["mismatched", 1]
  ])("rejects %s stored export metadata, cleans the object, and allows a fresh export", async (_label, delta) => {
    const storage = createInMemoryObjectStorage();
    const originalGet = storage.get.bind(storage);
    storage.get = vi.fn(async (key, options) => {
      const object = await originalGet(key, options);
      return { ...object, sizeBytes: Math.max(0, (object.sizeBytes ?? 0) + delta) };
    });
    const store = createInMemoryStudioPortabilityStore({ snapshots: [snapshot("owner_a", null)] });
    const service = createStudioPortabilityService({
      store, objectStorage: storage, verifyOwner: async () => true
    });

    const corrupted = await service.exportData(ownerA);
    await service.processNextExport();
    await expect(service.getExport(ownerA, corrupted.exportId)).resolves.toMatchObject({
      status: "failed", sizeBytes: null, downloadUrl: null
    });
    expect(storage.keys().some((key) => key.includes(corrupted.exportId))).toBe(false);

    storage.get = originalGet;
    const retried = await service.exportData(ownerA);
    await service.processNextExport();
    await expect(service.getExport(ownerA, retried.exportId)).resolves.toMatchObject({
      status: "ready", sizeBytes: expect.any(Number)
    });
  });

  it("revalidates the persisted owner immediately before publication and download signing", async () => {
    const storage = createInMemoryObjectStorage();
    const store = createInMemoryStudioPortabilityStore({ snapshots: [snapshot("owner_a", null)] });
    let activeOwner = true;
    const service = createStudioPortabilityService({
      store,
      objectStorage: storage,
      verifyOwner: async () => activeOwner
    });
    const requested = await service.exportData(ownerA);
    activeOwner = false;
    await service.processNextExport();
    await expect(service.getExport(ownerA, requested.exportId)).rejects.toThrow("STUDIO_PORTABILITY_FORBIDDEN");
    expect(storage.keys().filter((key) => key.includes(requested.exportId))).toEqual([]);

    activeOwner = true;
    const ready = await service.exportData(ownerA);
    await service.processNextExport();
    activeOwner = false;
    await expect(service.getExport(ownerA, ready.exportId)).rejects.toThrow("STUDIO_PORTABILITY_FORBIDDEN");
  });

  it("streams archive chunks with a bounded plan instead of concatenating the full ZIP", async () => {
    const backing = createInMemoryObjectStorage();
    const assetKey = "workspaces/workspace_a/studio/owner_a/assets/chunked.bin";
    await put(backing, assetKey, "abcdefghij");
    const chunkSizes: number[] = [];
    const storage = {
      ...backing,
      async put(input: Parameters<typeof backing.put>[0], options?: Parameters<typeof backing.put>[1]) {
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) {
          const body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          chunkSizes.push(body.length);
          chunks.push(body);
        }
        await backing.put({ ...input, body: Readable.from(chunks) }, options);
      }
    };
    const service = createStudioPortabilityService({
      store: createInMemoryStudioPortabilityStore({ snapshots: [snapshot("owner_a", assetKey)] }),
      objectStorage: storage,
      verifyOwner: async () => true
    });

    await service.exportData(ownerA);
    await service.processNextExport();

    expect(chunkSizes.length).toBeGreaterThan(4);
    expect(Math.max(...chunkSizes)).toBeLessThan(1024 * 1024);
  });

  it("fails an oversized export before writing any staged archive object", async () => {
    const storage = createInMemoryObjectStorage();
    const assetKey = "workspaces/workspace_a/studio/owner_a/assets/oversized.bin";
    await put(storage, assetKey, "x".repeat(5_000));
    const service = createStudioPortabilityService({
      store: createInMemoryStudioPortabilityStore({ snapshots: [snapshot("owner_a", assetKey)] }),
      objectStorage: storage,
      verifyOwner: async () => true,
      maxExportBytes: 4_000
    });
    const requested = await service.exportData(ownerA);

    await service.processNextExport();

    await expect(service.getExport(ownerA, requested.exportId)).resolves.toMatchObject({ status: "failed" });
    expect(storage.keys().filter((key) => key.includes(requested.exportId))).toEqual([]);
  });

  it("rechecks ownership and denies downgraded roles and a different owner", async () => {
    const store = createInMemoryStudioPortabilityStore({ snapshots: [snapshot("owner_a", null)] });
    const service = createStudioPortabilityService({
      store,
      objectStorage: createInMemoryObjectStorage(),
      verifyOwner: async (actor) => actor.role === "owner" && actor.profileId === "owner_a"
    });

    await expect(service.exportData({ ...ownerA, role: "manager" })).rejects.toThrow("STUDIO_PORTABILITY_FORBIDDEN");
    await expect(service.exportData(ownerB)).rejects.toThrow("STUDIO_PORTABILITY_FORBIDDEN");
  });

  it("deletes every private row and memory record, preserves operational links, and reconciles object failures", async () => {
    const storage = createInMemoryObjectStorage();
    const objectKey = "workspaces/workspace_a/studio/owner_a/assets/private.pdf";
    await put(storage, objectKey, "private-original");
    storage.failNextDelete(new Error("storage unavailable"));
    const store = createInMemoryStudioPortabilityStore({
      snapshots: [snapshot("owner_a", objectKey)],
      operationalLinks: [{
        id: "link_1", workspaceId: "workspace_a", ownerProfileId: "owner_a",
        resourceType: "routine", resourceId: "routine_operational", sourceDeletedAt: null
      }]
    });
    const service = createStudioPortabilityService({
      store,
      objectStorage: storage,
      verifyOwner: async () => true,
      now: () => new Date("2026-07-14T16:00:00.000Z")
    });

    await expect(service.deleteData(ownerA, "EXCLUIR")).rejects.toThrow("STUDIO_DELETE_CONFIRMATION_INVALID");
    const deleted = await service.deleteData(ownerA, STUDIO_DELETE_CONFIRMATION);

    expect(deleted).toMatchObject({ status: "reconciliation_pending", pendingObjectCount: 1 });
    expect((await store.readSnapshot({ workspaceId: "workspace_a", ownerProfileId: "owner_a" })).documents).toEqual([]);
    expect(store.memoryRows({ workspaceId: "workspace_a", ownerProfileId: "owner_a" })).toEqual([]);
    expect(store.operationalLinks()).toEqual([expect.objectContaining({
      resourceId: "routine_operational", sourceDeletedAt: "2026-07-14T16:00:00.000Z", originLabel: "origem excluída"
    })]);
    expect(store.pendingObjectDeletionRows()).toEqual([expect.objectContaining({ objectKey, status: "pending" })]);
    expect(storage.keys()).toContain(objectKey);
    await expect(service.exportData(ownerA)).rejects.toThrow("STUDIO_PORTABILITY_DELETION_ACTIVE");

    await service.reconcileObjectDeletions(10);
    expect(storage.keys()).not.toContain(objectKey);
    expect(store.pendingObjectDeletionRows()).toEqual([]);
    await expect(service.exportData(ownerA)).resolves.toMatchObject({ status: "pending" });
  });

  it("returns accepted reconciliation after relational deletion and lets maintenance retry finalization", async () => {
    const actualBase = createInMemoryStudioPortabilityStore({ snapshots: [snapshot("owner_a", null)] });
    let failFinalization = true;
    const failingStore = {
      ...actualBase,
      async finalizeDeletion(requestId: string) {
        if (failFinalization) throw new Error("database unavailable after commit");
        return actualBase.finalizeDeletion(requestId);
      }
    };
    const service = createStudioPortabilityService({
      store: failingStore,
      objectStorage: createInMemoryObjectStorage(),
      verifyOwner: async () => true
    });

    await expect(service.deleteData(ownerA, STUDIO_DELETE_CONFIRMATION)).resolves.toMatchObject({
      status: "reconciliation_pending",
      cleanupContinues: true
    });
    expect((await actualBase.readSnapshot({ workspaceId: "workspace_a", ownerProfileId: "owner_a" })).documents).toEqual([]);
    failFinalization = false;
    await expect(service.reconcileObjectDeletions(1)).resolves.toMatchObject({ attempted: 1 });
    await expect(service.exportData(ownerA)).resolves.toMatchObject({ status: "pending" });
  });

  it("expires ready exports through maintenance and deletes the private object before marking expired", async () => {
    let current = new Date("2026-07-14T15:00:00.000Z");
    const storage = createInMemoryObjectStorage();
    const service = createStudioPortabilityService({
      store: createInMemoryStudioPortabilityStore({ snapshots: [snapshot("owner_a", null)] }),
      objectStorage: storage,
      verifyOwner: async () => true,
      now: () => current
    });
    const requested = await service.exportData(ownerA);
    await service.processNextExport();
    expect(storage.keys().some((key) => key.includes(requested.exportId))).toBe(true);
    current = new Date("2026-07-14T15:16:00.000Z");

    await expect(service.processNextExportExpiration()).resolves.toMatchObject({
      workspaceId: "workspace_a", ownerProfileId: "owner_a"
    });
    expect(storage.keys().some((key) => key.includes(requested.exportId))).toBe(false);
    await expect(service.getExport(ownerA, requested.exportId)).resolves.toMatchObject({ status: "expired" });
  });

  it("ports and erases the live in-memory repository without touching another owner", async () => {
    const repository = createInMemoryStudioRepository({ now: () => "2026-07-14T16:00:00.000Z" });
    const studio = createStudioService(repository);
    await studio.createDocument(
      { workspaceId: "workspace_a", ownerProfileId: "owner_a" }, "owner_a",
      { title: "Privado A", body_json: { type: "doc", content: [] }, body_text: "A", capture_mode: "text" }
    );
    await studio.createDocument(
      { workspaceId: "workspace_a", ownerProfileId: "owner_b" }, "owner_b",
      { title: "Privado B", body_json: { type: "doc", content: [] }, body_text: "B", capture_mode: "text" }
    );
    const store = createInMemoryStudioPortabilityStore({ repository });
    const service = createStudioPortabilityService({
      store,
      objectStorage: createInMemoryObjectStorage(),
      verifyOwner: async () => true
    });

    expect((await store.readSnapshot({ workspaceId: "workspace_a", ownerProfileId: "owner_a" })).documents).toHaveLength(1);
    await service.deleteData(ownerA, STUDIO_DELETE_CONFIRMATION);

    expect((await store.readSnapshot({ workspaceId: "workspace_a", ownerProfileId: "owner_a" })).documents).toEqual([]);
    expect((await store.readSnapshot({ workspaceId: "workspace_a", ownerProfileId: "owner_b" })).documents).toEqual([
      expect.objectContaining({ title: "Privado B", bodyText: "B" })
    ]);
  });

  it("excludes trashed documents and their dependent rows from portability exports", async () => {
    const repository = createInMemoryStudioRepository({ now: () => "2026-07-14T16:00:00.000Z" });
    const studio = createStudioService(repository, { now: () => "2026-07-16T16:00:00.000Z" });
    const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
    const kept = await studio.createDocument(scope, "owner_a",
      { title: "Mantido", body_json: { type: "doc", content: [] }, body_text: "A", capture_mode: "text" });
    const trashed = await studio.createDocument(scope, "owner_a",
      { title: "Na lixeira", body_json: { type: "doc", content: [] }, body_text: "B", capture_mode: "text" });
    const collection = await studio.createCollection(scope, "owner_a", { name: "Planejamento" });
    await studio.addDocumentToCollection(scope, "owner_a", collection.id, trashed.id);
    await studio.trashDocument(scope, "owner_a", trashed.id);

    const snapshot = await createInMemoryStudioPortabilityStore({ repository }).readSnapshot(scope);
    expect(snapshot.documents).toEqual([expect.objectContaining({ id: kept.id })]);
    expect(snapshot.versions.some((version) => version.documentId === trashed.id)).toBe(false);
    expect(snapshot.collectionItems.some((item) => item.documentId === trashed.id)).toBe(false);
  });

  it("aborts an active private multipart upload before deleting its object key", async () => {
    const storage = createInMemoryObjectStorage();
    const objectKey = "workspaces/workspace_a/studio/owner_a/assets/in-flight.pdf";
    const { uploadId } = await storage.beginAtomicUpload({
      key: objectKey, contentType: "application/pdf", sizeBytes: 100
    });
    const ownerSnapshot = snapshot("owner_a", null);
    ownerSnapshot.privateObjectKeys = [objectKey];
    ownerSnapshot.activeUploads = [{ objectKey, storageUploadId: uploadId }];
    const service = createStudioPortabilityService({
      store: createInMemoryStudioPortabilityStore({ snapshots: [ownerSnapshot] }),
      objectStorage: storage,
      verifyOwner: async () => true
    });

    await expect(service.deleteData(ownerA, STUDIO_DELETE_CONFIRMATION)).resolves.toMatchObject({ status: "completed" });
    expect(storage.atomicUploadIds()).toEqual([]);
  });

  it("includes and deletes private proactivity settings and signals through the in-memory hooks", async () => {
    let settings: object | null = { ownerProfileId: "owner_a", ritualReminder: true };
    let signals: object[] = [{ id: "signal_a", reason: "Revisão vencida" }];
    const store = createInMemoryStudioPortabilityStore({
      snapshots: [snapshot("owner_a", null)],
      proactivity: {
        async readPortabilityRows() { return { settings, signals }; },
        async deleteOwnerData() { settings = null; signals = []; }
      }
    });
    const service = createStudioPortabilityService({
      store,
      objectStorage: createInMemoryObjectStorage(),
      verifyOwner: async () => true
    });

    await expect(store.readSnapshot({ workspaceId: "workspace_a", ownerProfileId: "owner_a" })).resolves.toMatchObject({
      proactivitySettings: [{ ritualReminder: true }],
      proactiveSignals: [{ id: "signal_a" }]
    });
    await service.deleteData(ownerA, STUDIO_DELETE_CONFIRMATION);
    await expect(store.readSnapshot({ workspaceId: "workspace_a", ownerProfileId: "owner_a" })).resolves.toMatchObject({
      proactivitySettings: [], proactiveSignals: []
    });
  });

  it("exports structural proactive signals only while their typed structure is retained", async () => {
    const ownerSnapshot = snapshot("owner_a", null);
    ownerSnapshot.structures = [{ id: "ritual_kept", kind: "ritual" }, { id: "goal_kept", kind: "goal" }];
    const signals = [
      { id: "keep_ritual", type: "ritual_reminder", sourceId: "ritual_kept" },
      { id: "drop_wrong_type", type: "ritual_reminder", sourceId: "goal_kept" },
      { id: "drop_deleted", type: "decision_review", sourceId: "decision_deleted" },
      { id: "keep_operational", type: "operational_change", sourceId: "task_a" }
    ];
    const store = createInMemoryStudioPortabilityStore({
      snapshots: [ownerSnapshot],
      proactivity: {
        async readPortabilityRows() { return { settings: null, signals }; },
        async deleteOwnerData() {}
      }
    });

    expect((await store.readSnapshot({ workspaceId: "workspace_a", ownerProfileId: "owner_a" })).proactiveSignals)
      .toEqual([signals[0], signals[3]]);
  });
});

function snapshot(ownerProfileId: string, objectKey: string | null): StudioPortabilitySnapshot {
  const suffix = ownerProfileId;
  return {
    workspaceId: "workspace_a",
    ownerProfileId,
    documents: [{ id: `document_${suffix}`, body_text: `segredo ${suffix}` }],
    versions: [{ id: `version_${suffix}`, document_id: `document_${suffix}`, body_text: `versão ${suffix}` }],
    assets: objectKey ? [{
      id: `asset_${suffix}`, document_id: `document_${suffix}`, display_name: "audio-a.webm",
      object_key: objectKey, mime_type: "audio/webm", size_bytes: 10
    }] : [],
    structures: [{ id: `structure_${suffix}` }],
    collections: [{ id: `collection_${suffix}` }],
    collectionItems: [{ id: `collection_item_${suffix}` }],
    ritualSessions: [{ id: `ritual_session_${suffix}` }],
    conversations: [{ id: `conversation_${suffix}` }],
    messages: [{ id: `message_${suffix}` }],
    suggestions: [{ id: `suggestion_${suffix}` }],
    citations: [{ id: `citation_${suffix}` }],
    relations: [{ id: `relation_${suffix}` }],
    memoryRows: [{ id: `memory_${suffix}` }]
  };
}

async function put(storage: ReturnType<typeof createInMemoryObjectStorage>, key: string, value: string) {
  const body = Buffer.from(value);
  await storage.put({ key, body: Readable.from(body), contentType: "application/octet-stream", sizeBytes: body.length });
}

async function readObject(storage: ReturnType<typeof createInMemoryObjectStorage>, key: string) {
  const object = await storage.get(key);
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function readStoredZip(buffer: Buffer) {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.set(buffer.subarray(nameStart, nameStart + nameLength).toString("utf8"), buffer.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}
