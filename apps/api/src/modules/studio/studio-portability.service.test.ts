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
  it("exports only the current owner's complete private archive with originals and an expiring owner-scoped URL", async () => {
    const storage = createInMemoryObjectStorage();
    const assetAKey = "workspaces/workspace_a/studio/owner_a/assets/audio-a.webm";
    const assetBKey = "workspaces/workspace_a/studio/owner_b/assets/audio-b.webm";
    await put(storage, assetAKey, "original-a");
    await put(storage, assetBKey, "original-b");
    const store = createInMemoryStudioPortabilityStore({ snapshots: [
      snapshot("owner_a", assetAKey),
      snapshot("owner_b", assetBKey)
    ] });
    const logs: Array<Record<string, unknown>> = [];
    const service = createStudioPortabilityService({
      store,
      objectStorage: storage,
      verifyOwner: async (actor) => actor.role === "owner",
      now: () => new Date("2026-07-14T15:00:00.000Z"),
      logger: { info: (event) => logs.push(event), error: (event) => logs.push(event) }
    });

    const exported = await service.exportData(ownerA);

    expect(exported.downloadUrl).toContain("expires_in=900");
    expect(exported.expiresAt).toBe("2026-07-14T15:15:00.000Z");
    const exportKey = storage.keys().find((key) => key.includes("/exports/"));
    expect(exportKey).toMatch(/^workspaces\/workspace_a\/studio\/owner_a\/exports\/.+\.zip$/u);
    const archive = await readObject(storage, exportKey!);
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

    await service.reconcileObjectDeletions(10);
    expect(storage.keys()).not.toContain(objectKey);
    expect(store.pendingObjectDeletionRows()).toEqual([]);
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
