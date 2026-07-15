import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ObjectStorage } from "../../storage/object-storage";

export const STUDIO_DELETE_CONFIRMATION = "EXCLUIR MEU ESTÚDIO";
const EXPORT_URL_TTL_SECONDS = 15 * 60;
const MAX_EXPORT_BYTES = 100 * 1024 * 1024;

export type StudioPortabilityActor = {
  workspaceId: string;
  profileId: string;
  role: "owner" | "manager" | "employee";
};

export type StudioOwnerPortabilityScope = {
  workspaceId: string;
  ownerProfileId: string;
};

type PortableRow = Record<string, unknown> & { id?: string };

export type StudioPortabilitySnapshot = StudioOwnerPortabilityScope & {
  documents: PortableRow[];
  versions: PortableRow[];
  assets: PortableRow[];
  structures: PortableRow[];
  collections: PortableRow[];
  collectionItems: PortableRow[];
  ritualSessions: PortableRow[];
  conversations: PortableRow[];
  messages: PortableRow[];
  suggestions: PortableRow[];
  citations: PortableRow[];
  relations: PortableRow[];
  memoryRows: PortableRow[];
  proactivitySettings?: object[];
  proactiveSignals?: object[];
  privateObjectKeys?: string[];
  activeUploads?: Array<{ objectKey: string; storageUploadId: string }>;
};

export type StudioPortabilityObjectTarget = {
  objectKey: string;
  storageUploadId: string | null;
};

type ObjectDeletion = StudioPortabilityObjectTarget & {
  requestId: string;
  workspaceId: string;
  ownerProfileId: string;
  objectKey: string;
  status: "pending";
};

export type StudioPortabilityStore = {
  readSnapshot(scope: StudioOwnerPortabilityScope): Promise<StudioPortabilitySnapshot>;
  recordExport(input: {
    id: string;
    scope: StudioOwnerPortabilityScope;
    objectKey: string;
    createdAt: string;
    expiresAt: string;
  }): Promise<void>;
  markExportReady(id: string): Promise<void>;
  markExportFailed(id: string): Promise<void>;
  beginDeletion(input: {
    requestId: string;
    scope: StudioOwnerPortabilityScope;
    requestedAt: string;
  }): Promise<StudioPortabilityObjectTarget[]>;
  settleObjectDeletion(input: {
    requestId: string;
    objectKey: string;
    deleted: boolean;
  }): Promise<void>;
  pendingObjectDeletions(limit: number): Promise<ObjectDeletion[]>;
  finalizeDeletion(requestId: string): Promise<{ pendingObjectCount: number }>;
};

type PortabilityLogger = {
  info(event: Record<string, unknown>): void;
  error(event: Record<string, unknown>): void;
};

export type StudioPortabilityService = ReturnType<typeof createStudioPortabilityService>;

export function createStudioPortabilityService(options: {
  store: StudioPortabilityStore;
  objectStorage: ObjectStorage;
  verifyOwner(actor: StudioPortabilityActor): Promise<boolean>;
  now?: () => Date;
  logger?: PortabilityLogger;
}) {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? { info: () => undefined, error: () => undefined };

  async function requireOwner(actor: StudioPortabilityActor): Promise<StudioOwnerPortabilityScope> {
    if (actor.role !== "owner" || !(await options.verifyOwner(actor))) {
      throw portabilityError("STUDIO_PORTABILITY_FORBIDDEN");
    }
    return { workspaceId: actor.workspaceId, ownerProfileId: actor.profileId };
  }

  return {
    async exportData(actor: StudioPortabilityActor) {
      const scope = await requireOwner(actor);
      const snapshot = await options.store.readSnapshot(scope);
      const exportId = `studio_export_${randomUUID()}`;
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + EXPORT_URL_TTL_SECONDS * 1_000);
      const objectKey = `${ownerPrefix(scope)}/exports/${exportId}.zip`;
      const archive = await buildStudioArchive(snapshot, options.objectStorage);
      await options.store.recordExport({
        id: exportId,
        scope,
        objectKey,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString()
      });
      try {
        await options.objectStorage.put({
          key: objectKey,
          body: Readable.from(archive),
          contentType: "application/zip",
          sizeBytes: archive.length
        });
        const downloadUrl = await options.objectStorage.createDownloadUrl(objectKey, EXPORT_URL_TTL_SECONDS);
        await options.store.markExportReady(exportId);
        logger.info({ event: "studio_export_ready", exportId, workspaceId: scope.workspaceId, ownerProfileId: scope.ownerProfileId });
        return { exportId, downloadUrl, expiresAt: expiresAt.toISOString() };
      } catch (error) {
        try {
          await options.store.markExportFailed(exportId);
        } catch (cleanupError) {
          logger.error({ event: "studio_export_record_cleanup_failed", exportId, errorCode: errorCode(cleanupError) });
        }
        try {
          await options.objectStorage.delete(objectKey);
        } catch (cleanupError) {
          logger.error({ event: "studio_export_object_cleanup_failed", exportId, errorCode: errorCode(cleanupError) });
        }
        logger.error({ event: "studio_export_failed", exportId, errorCode: errorCode(error) });
        throw error;
      }
    },

    async deleteData(actor: StudioPortabilityActor, confirmation: string) {
      if (confirmation !== STUDIO_DELETE_CONFIRMATION) {
        throw portabilityError("STUDIO_DELETE_CONFIRMATION_INVALID");
      }
      const scope = await requireOwner(actor);
      const requestId = `studio_delete_${randomUUID()}`;
      const requestedAt = now().toISOString();
      const targets = await options.store.beginDeletion({ requestId, scope, requestedAt });
      for (const target of targets) {
        try {
          await deleteStoredTarget(options.objectStorage, target);
          await options.store.settleObjectDeletion({ requestId, objectKey: target.objectKey, deleted: true });
        } catch (error) {
          await options.store.settleObjectDeletion({ requestId, objectKey: target.objectKey, deleted: false });
          logger.error({ event: "studio_object_delete_deferred", requestId, errorCode: errorCode(error) });
        }
      }
      const { pendingObjectCount } = await options.store.finalizeDeletion(requestId);
      logger.info({ event: "studio_delete_private_data", requestId, pendingObjectCount });
      return {
        requestId,
        status: pendingObjectCount === 0 ? "completed" as const : "reconciliation_pending" as const,
        pendingObjectCount
      };
    },

    async reconcileObjectDeletions(limit = 25) {
      const pending = await options.store.pendingObjectDeletions(Math.max(1, Math.min(limit, 100)));
      const requestIds = new Set<string>();
      let reconciled = 0;
      for (const item of pending) {
        requestIds.add(item.requestId);
        try {
          await deleteStoredTarget(options.objectStorage, item);
          await options.store.settleObjectDeletion({
            requestId: item.requestId,
            objectKey: item.objectKey,
            deleted: true
          });
          reconciled += 1;
        } catch (error) {
          logger.error({ event: "studio_object_reconcile_failed", requestId: item.requestId, errorCode: errorCode(error) });
        }
      }
      for (const requestId of requestIds) await options.store.finalizeDeletion(requestId);
      return { attempted: pending.length, reconciled };
    }
  };
}

export type InMemoryStudioPortabilityStore = StudioPortabilityStore & {
  memoryRows(scope: StudioOwnerPortabilityScope): PortableRow[];
  operationalLinks(): Array<Record<string, unknown>>;
  pendingObjectDeletionRows(): ObjectDeletion[];
};

export type StudioPortabilityRepositoryHooks = {
  readPortabilitySnapshot(scope: StudioOwnerPortabilityScope): Promise<StudioPortabilitySnapshot>;
  deletePortabilityData(scope: StudioOwnerPortabilityScope): Promise<void>;
};

export type StudioPortabilityProactivityHooks = {
  readPortabilityRows(scope: StudioOwnerPortabilityScope): Promise<{
    settings: object | null;
    signals: object[];
  }>;
  deleteOwnerData(scope: StudioOwnerPortabilityScope): Promise<void>;
};

export function createInMemoryStudioPortabilityStore(input: {
  snapshots?: StudioPortabilitySnapshot[];
  operationalLinks?: Array<{
    id: string;
    workspaceId: string;
    ownerProfileId: string;
    resourceType: string;
    resourceId: string;
    sourceDeletedAt: string | null;
  }>;
  repository?: StudioPortabilityRepositoryHooks;
  removeMemory?(scope: StudioOwnerPortabilityScope, documentIds: string[]): Promise<void>;
  markOperationalOriginsDeleted?(scope: StudioOwnerPortabilityScope, deletedAt: string): Promise<void>;
  proactivity?: StudioPortabilityProactivityHooks;
} = {}): InMemoryStudioPortabilityStore {
  const snapshots = new Map((input.snapshots ?? []).map((snapshot) => [scopeKey(snapshot), clone(snapshot)]));
  const memory = new Map((input.snapshots ?? []).map((snapshot) => [scopeKey(snapshot), clone(snapshot.memoryRows)]));
  const links = clone(input.operationalLinks ?? []);
  const exportRecords = new Map<string, { objectKey: string; status: "preparing" | "ready" | "failed"; scope: StudioOwnerPortabilityScope }>();
  const deletions = new Map<string, { status: "processing" | "completed" | "reconciliation_pending" }>();
  const pending = new Map<string, ObjectDeletion>();

  return {
    async readSnapshot(scope) {
      const snapshot = input.repository
        ? await input.repository.readPortabilitySnapshot(scope)
        : clone(snapshots.get(scopeKey(scope)) ?? emptySnapshot(scope));
      if (input.proactivity) {
        const rows = await input.proactivity.readPortabilityRows(scope);
        snapshot.proactivitySettings = rows.settings ? [clone(rows.settings)] : [];
        snapshot.proactiveSignals = clone(rows.signals);
      }
      return snapshot;
    },
    async recordExport(record) {
      exportRecords.set(record.id, { objectKey: record.objectKey, status: "preparing", scope: clone(record.scope) });
    },
    async markExportReady(id) {
      const record = exportRecords.get(id);
      if (record) record.status = "ready";
    },
    async markExportFailed(id) {
      const record = exportRecords.get(id);
      if (record) record.status = "failed";
    },
    async beginDeletion({ requestId, scope, requestedAt }) {
      // The request marker exists before the destructive mutation, mirroring the database transaction.
      deletions.set(requestId, { status: "processing" });
      const key = scopeKey(scope);
      const snapshot = input.repository
        ? await input.repository.readPortabilitySnapshot(scope)
        : snapshots.get(key) ?? emptySnapshot(scope);
      const objectKeys = new Set(
        snapshot.assets.map((asset) => asset.object_key ?? asset.objectKey)
          .filter((value): value is string => typeof value === "string" && Boolean(value))
      );
      for (const objectKey of snapshot.privateObjectKeys ?? []) objectKeys.add(objectKey);
      for (const record of exportRecords.values()) {
        if (scopeKey(record.scope) === key) objectKeys.add(record.objectKey);
      }
      if (input.repository) await input.repository.deletePortabilityData(scope);
      else snapshots.set(key, emptySnapshot(scope));
      await input.proactivity?.deleteOwnerData(scope);
      await input.removeMemory?.(scope, snapshot.documents.flatMap((document) => typeof document.id === "string" ? [document.id] : []));
      memory.set(key, []);
      for (const link of links) {
        if (link.workspaceId === scope.workspaceId && link.ownerProfileId === scope.ownerProfileId) {
          link.sourceDeletedAt = requestedAt;
        }
      }
      await input.markOperationalOriginsDeleted?.(scope, requestedAt);
      const activeUploads = new Map((snapshot.activeUploads ?? []).map((upload) => [upload.objectKey, upload.storageUploadId]));
      for (const objectKey of objectKeys) {
        pending.set(`${requestId}:${objectKey}`, {
          requestId,
          workspaceId: scope.workspaceId,
          ownerProfileId: scope.ownerProfileId,
          objectKey,
          storageUploadId: activeUploads.get(objectKey) ?? null,
          status: "pending"
        });
      }
      return [...objectKeys].map((objectKey) => ({ objectKey, storageUploadId: activeUploads.get(objectKey) ?? null }));
    },
    async settleObjectDeletion({ requestId, objectKey, deleted }) {
      if (deleted) pending.delete(`${requestId}:${objectKey}`);
    },
    async pendingObjectDeletions(limit) {
      return clone([...pending.values()].slice(0, limit));
    },
    async finalizeDeletion(requestId) {
      const pendingObjectCount = [...pending.values()].filter((item) => item.requestId === requestId).length;
      const record = deletions.get(requestId);
      if (record) record.status = pendingObjectCount ? "reconciliation_pending" : "completed";
      return { pendingObjectCount };
    },
    memoryRows(scope) {
      return clone(memory.get(scopeKey(scope)) ?? []);
    },
    operationalLinks() {
      return clone(links.map((link) => ({
        ...link,
        originLabel: link.sourceDeletedAt ? "origem excluída" : "Estúdio do Dono"
      })));
    },
    pendingObjectDeletionRows() {
      return clone([...pending.values()]);
    }
  };
}

async function buildStudioArchive(snapshot: StudioPortabilitySnapshot, storage: ObjectStorage): Promise<Buffer> {
  const entries: Array<{ name: string; body: Buffer }> = [];
  const manifest = exportManifest(snapshot);
  const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  ensureExportSize(manifestBody.length);
  entries.push({ name: "manifest.json", body: manifestBody });
  let totalBytes = manifestBody.length;
  for (const asset of snapshot.assets) {
    const objectKey = asset.object_key ?? asset.objectKey;
    if (typeof objectKey !== "string" || !objectKey) continue;
    const object = await storage.get(objectKey);
    const remaining = MAX_EXPORT_BYTES - totalBytes;
    const body = await readBounded(object.body, remaining);
    totalBytes += body.length;
    ensureExportSize(totalBytes);
    entries.push({ name: assetArchivePath(asset), body });
  }
  const archive = createStoredZip(entries);
  ensureExportSize(archive.length);
  return archive;
}

function exportManifest(snapshot: StudioPortabilitySnapshot) {
  return {
    format: "baase-owner-studio-export",
    version: 1,
    workspace_id: snapshot.workspaceId,
    owner_profile_id: snapshot.ownerProfileId,
    documents: snapshot.documents,
    versions: snapshot.versions,
    assets: snapshot.assets.map(({ object_key: privateObjectKey, objectKey: privateObjectKeyCamel, ...metadata }) => {
      const hasOriginal = Boolean(privateObjectKey ?? privateObjectKeyCamel);
      return {
        ...metadata,
        original_path: hasOriginal ? assetArchivePath(metadata) : null
      };
    }),
    structures: snapshot.structures,
    collections: snapshot.collections,
    collection_items: snapshot.collectionItems,
    ritual_sessions: snapshot.ritualSessions,
    conversations: snapshot.conversations,
    messages: snapshot.messages,
    suggestions: snapshot.suggestions,
    citations: snapshot.citations,
    relations: snapshot.relations,
    memory_rows: snapshot.memoryRows,
    proactivity_settings: snapshot.proactivitySettings ?? [],
    proactive_signals: snapshot.proactiveSignals ?? []
  };
}

function assetArchivePath(asset: PortableRow): string {
  const documentId = safeArchiveName(String(asset.document_id ?? asset.documentId ?? "sem-documento"));
  const assetId = safeArchiveName(String(asset.id ?? "arquivo"));
  const displayName = safeArchiveName(String(asset.display_name ?? asset.displayName ?? "original"));
  return `originais/${documentId}/${assetId}-${displayName}`;
}

async function readBounded(stream: Readable, remaining: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > remaining) {
      stream.destroy();
      throw portabilityError("STUDIO_EXPORT_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

function createStoredZip(entries: Array<{ name: string; body: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(assertArchivePath(entry.name), "utf8");
    const crc = crc32(entry.body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.body.length, 18);
    local.writeUInt32LE(entry.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.body.length, 20);
    central.writeUInt32LE(entry.body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.body.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function assertArchivePath(value: string): string {
  if (!value || value.startsWith("/") || value.includes("\0") || value.split("/").includes("..")) {
    throw portabilityError("STUDIO_EXPORT_PATH_INVALID");
  }
  return value;
}

function safeArchiveName(value: string): string {
  const normalized = value.normalize("NFKC").replace(/[\\/:*?"<>|\0-\x1f]/gu, "-").replace(/\.\.+/gu, ".").trim();
  return normalized.slice(0, 120) || "sem-nome";
}

function ownerPrefix(scope: StudioOwnerPortabilityScope): string {
  return `workspaces/${safeStorageSegment(scope.workspaceId)}/studio/${safeStorageSegment(scope.ownerProfileId)}`;
}

function safeStorageSegment(value: string): string {
  if (value && value !== "." && value !== ".." && /^[A-Za-z0-9._-]+$/u.test(value)) return value;
  return Buffer.from(value, "utf8").toString("base64url") || "_";
}

async function deleteStoredTarget(storage: ObjectStorage, target: StudioPortabilityObjectTarget): Promise<void> {
  if (target.storageUploadId) {
    await storage.abortAtomicUpload({ key: target.objectKey, uploadId: target.storageUploadId });
  }
  await storage.delete(target.objectKey);
}

function ensureExportSize(bytes: number): void {
  if (bytes > MAX_EXPORT_BYTES) throw portabilityError("STUDIO_EXPORT_TOO_LARGE");
}

function scopeKey(scope: StudioOwnerPortabilityScope): string {
  return `${scope.workspaceId}\0${scope.ownerProfileId}`;
}

function emptySnapshot(scope: StudioOwnerPortabilityScope): StudioPortabilitySnapshot {
  return {
    ...scope,
    documents: [], versions: [], assets: [], structures: [], collections: [], collectionItems: [],
    ritualSessions: [], conversations: [], messages: [], suggestions: [], citations: [], relations: [], memoryRows: []
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function portabilityError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "STUDIO_PORTABILITY_FAILED";
}
