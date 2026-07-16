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

export type StudioPortabilityExportStatus = "pending" | "processing" | "ready" | "failed" | "expired";

export type StudioPortabilityExport = StudioOwnerPortabilityScope & {
  id: string;
  objectKey: string;
  status: StudioPortabilityExportStatus;
  createdAt: string;
  expiresAt: string;
  claimToken: string | null;
  claimLeaseExpiresAt: string | null;
};

type ExportClaimInput = {
  claimToken: string;
  claimLeaseExpiresAt: string;
  now: string;
  excludeOwnerKeys?: readonly string[];
};

type OwnerFence = () => Promise<boolean>;

type ObjectDeletion = StudioPortabilityObjectTarget & {
  requestId: string;
  workspaceId: string;
  ownerProfileId: string;
  objectKey: string;
  status: "pending";
};

export type StudioPortabilityStore = {
  readSnapshot(scope: StudioOwnerPortabilityScope): Promise<StudioPortabilitySnapshot>;
  createExport(input: {
    id: string;
    scope: StudioOwnerPortabilityScope;
    objectKey: string;
    createdAt: string;
    expiresAt: string;
  }, authorize: OwnerFence): Promise<void>;
  findExport(scope: StudioOwnerPortabilityScope, id: string): Promise<StudioPortabilityExport | null>;
  claimNextExport(input: ExportClaimInput): Promise<StudioPortabilityExport | null>;
  publishExport<T>(input: {
    scope: StudioOwnerPortabilityScope;
    id: string;
    claimToken: string;
    readyAt: string;
    expiresAt: string;
  }, authorize: OwnerFence, publish: () => Promise<T>): Promise<T>;
  signExport<T>(input: {
    scope: StudioOwnerPortabilityScope;
    id: string;
    now: string;
  }, authorize: OwnerFence, sign: (record: StudioPortabilityExport) => Promise<T>): Promise<T>;
  markExportFailed(input: { id: string; claimToken: string; errorCode: string }): Promise<void>;
  expireNextExport(input: {
    now: string;
    excludeOwnerKeys?: readonly string[];
  }, remove: (record: StudioPortabilityExport) => Promise<void>): Promise<StudioPortabilityExport | null>;
  beginDeletion(input: {
    requestId: string;
    scope: StudioOwnerPortabilityScope;
    requestedAt: string;
  }, authorize: OwnerFence): Promise<StudioPortabilityObjectTarget[]>;
  settleObjectDeletion(input: {
    requestId: string;
    objectKey: string;
    deleted: boolean;
  }): Promise<void>;
  pendingObjectDeletions(limit: number, excludeOwnerKeys?: readonly string[]): Promise<ObjectDeletion[]>;
  pendingDeletionRequests(limit: number, excludeOwnerKeys?: readonly string[]): Promise<Array<{
    requestId: string;
    workspaceId: string;
    ownerProfileId: string;
  }>>;
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
  maxExportBytes?: number;
}) {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? { info: () => undefined, error: () => undefined };
  const maxExportBytes = options.maxExportBytes ?? MAX_EXPORT_BYTES;

  async function requireOwner(actor: StudioPortabilityActor): Promise<StudioOwnerPortabilityScope> {
    if (actor.role !== "owner" || !(await options.verifyOwner(actor))) {
      throw portabilityError("STUDIO_PORTABILITY_FORBIDDEN");
    }
    return { workspaceId: actor.workspaceId, ownerProfileId: actor.profileId };
  }

  const workerActor = (scope: StudioOwnerPortabilityScope): StudioPortabilityActor => ({
    workspaceId: scope.workspaceId,
    profileId: scope.ownerProfileId,
    role: "owner"
  });

  const authorizeActor = (actor: StudioPortabilityActor) => async () => (
    actor.role === "owner" && options.verifyOwner(actor)
  );
  let maintenanceLane = 0;

  return {
    async exportData(actor: StudioPortabilityActor) {
      const scope = await requireOwner(actor);
      const exportId = `studio_export_${randomUUID()}`;
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + EXPORT_URL_TTL_SECONDS * 1_000);
      const objectKey = `${ownerPrefix(scope)}/exports/${exportId}.zip`;
      await options.store.createExport({
        id: exportId,
        scope,
        objectKey,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString()
      }, authorizeActor(actor));
      logger.info({ event: "studio_export_requested", exportId, workspaceId: scope.workspaceId, ownerProfileId: scope.ownerProfileId });
      return { exportId, status: "pending" as const, expiresAt: expiresAt.toISOString(), downloadUrl: null };
    },

    async getExport(actor: StudioPortabilityActor, exportId: string) {
      const scope = await requireOwner(actor);
      const record = await options.store.findExport(scope, exportId);
      if (!record) throw portabilityError("STUDIO_EXPORT_NOT_FOUND");
      const signingAt = now();
      if (record.status === "ready" && Date.parse(record.expiresAt) <= signingAt.getTime()) {
        return { exportId: record.id, status: "expired" as const, expiresAt: record.expiresAt, downloadUrl: null };
      }
      if (record.status !== "ready") {
        return { exportId: record.id, status: record.status, expiresAt: record.expiresAt, downloadUrl: null };
      }
      return options.store.signExport({ scope, id: exportId, now: signingAt.toISOString() }, authorizeActor(actor), async (ready) => ({
        exportId: ready.id,
        status: "ready" as const,
        expiresAt: ready.expiresAt,
        downloadUrl: await options.objectStorage.createDownloadUrl(
          ready.objectKey,
          Math.max(1, Math.min(EXPORT_URL_TTL_SECONDS, Math.ceil((Date.parse(ready.expiresAt) - signingAt.getTime()) / 1_000)))
        )
      }));
    },

    async processNextExport(signal?: AbortSignal, budget: StudioMaintenanceBudget = {}) {
      const claimToken = `studio_export_claim_${randomUUID()}`;
      const claimedAt = now();
      const claim = await options.store.claimNextExport({
        claimToken,
        claimLeaseExpiresAt: new Date(claimedAt.getTime() + 2 * 60_000).toISOString(),
        now: claimedAt.toISOString(),
        excludeOwnerKeys: budget.excludeOwnerKeys
      });
      if (!claim) return null;
      let objectWriteStarted = false;
      try {
        const snapshot = await options.store.readSnapshot(claim);
        const archive = await planStudioArchive(snapshot, options.objectStorage, maxExportBytes, signal);
        const readyAt = now();
        await options.store.publishExport({
          scope: claim,
          id: claim.id,
          claimToken,
          readyAt: readyAt.toISOString(),
          expiresAt: new Date(readyAt.getTime() + EXPORT_URL_TTL_SECONDS * 1_000).toISOString()
        }, authorizeActor(workerActor(claim)), async () => {
          objectWriteStarted = true;
          await options.objectStorage.put({
            key: claim.objectKey,
            body: createStoredZipStream(archive, signal),
            contentType: "application/zip",
            sizeBytes: archive.sizeBytes
          }, { signal });
        });
        logger.info({ event: "studio_export_ready", exportId: claim.id, workspaceId: claim.workspaceId, ownerProfileId: claim.ownerProfileId });
      } catch (error) {
        if (objectWriteStarted) {
          try {
            await options.objectStorage.delete(claim.objectKey);
          } catch (cleanupError) {
            logger.error({ event: "studio_export_object_cleanup_failed", exportId: claim.id, errorCode: errorCode(cleanupError) });
          }
        }
        try {
          await options.store.markExportFailed({ id: claim.id, claimToken, errorCode: errorCode(error) });
        } catch (cleanupError) {
          logger.error({ event: "studio_export_record_cleanup_failed", exportId: claim.id, errorCode: errorCode(cleanupError) });
        }
        logger.error({ event: "studio_export_failed", exportId: claim.id, errorCode: errorCode(error) });
      }
      return { workspaceId: claim.workspaceId, ownerProfileId: claim.ownerProfileId, exportId: claim.id };
    },

    async processNextExportExpiration(signal?: AbortSignal, budget: StudioMaintenanceBudget = {}) {
      const expired = await options.store.expireNextExport({
        now: now().toISOString(),
        excludeOwnerKeys: budget.excludeOwnerKeys
      }, async (record) => options.objectStorage.delete(record.objectKey, { signal }));
      return expired ? {
        workspaceId: expired.workspaceId,
        ownerProfileId: expired.ownerProfileId,
        exportId: expired.id
      } : null;
    },

    async processNextMaintenance(signal?: AbortSignal, budget: StudioMaintenanceBudget = {}) {
      const lanes = [
        () => this.processNextExport(signal, budget),
        () => this.processNextExportExpiration(signal, budget),
        async () => (await this.reconcileObjectDeletions(1, budget.excludeOwnerKeys, signal)).item
      ];
      for (let offset = 0; offset < lanes.length; offset += 1) {
        const lane = (maintenanceLane + offset) % lanes.length;
        const result = await lanes[lane]!();
        if (result) {
          maintenanceLane = (lane + 1) % lanes.length;
          return result;
        }
      }
      maintenanceLane = (maintenanceLane + 1) % lanes.length;
      return null;
    },

    async deleteData(actor: StudioPortabilityActor, confirmation: string) {
      if (confirmation !== STUDIO_DELETE_CONFIRMATION) {
        throw portabilityError("STUDIO_DELETE_CONFIRMATION_INVALID");
      }
      const scope = await requireOwner(actor);
      const requestId = `studio_delete_${randomUUID()}`;
      const requestedAt = now().toISOString();
      const targets = await options.store.beginDeletion({ requestId, scope, requestedAt }, authorizeActor(actor));
      let postCommitFailure = false;
      for (const target of targets) {
        try {
          await deleteStoredTarget(options.objectStorage, target);
          await options.store.settleObjectDeletion({ requestId, objectKey: target.objectKey, deleted: true });
        } catch (error) {
          postCommitFailure = true;
          try {
            await options.store.settleObjectDeletion({ requestId, objectKey: target.objectKey, deleted: false });
          } catch (settlementError) {
            logger.error({ event: "studio_object_delete_settlement_deferred", requestId, errorCode: errorCode(settlementError) });
          }
          logger.error({ event: "studio_object_delete_deferred", requestId, errorCode: errorCode(error) });
        }
      }
      try {
        const { pendingObjectCount } = await options.store.finalizeDeletion(requestId);
        const reconciliationPending = postCommitFailure || pendingObjectCount > 0;
        logger.info({ event: "studio_delete_private_data", requestId, pendingObjectCount, reconciliationPending });
        return {
          requestId,
          status: reconciliationPending ? "reconciliation_pending" as const : "completed" as const,
          pendingObjectCount,
          cleanupContinues: reconciliationPending
        };
      } catch (error) {
        logger.error({ event: "studio_delete_finalize_deferred", requestId, errorCode: errorCode(error) });
        return {
          requestId,
          status: "reconciliation_pending" as const,
          pendingObjectCount: targets.length,
          cleanupContinues: true
        };
      }
    },

    async reconcileObjectDeletions(limit = 25, excludeOwnerKeys: readonly string[] = [], signal?: AbortSignal) {
      const pending = await options.store.pendingObjectDeletions(Math.max(1, Math.min(limit, 100)), excludeOwnerKeys);
      const requestIds = new Set<string>();
      let reconciled = 0;
      for (const item of pending) {
        requestIds.add(item.requestId);
        try {
          await deleteStoredTarget(options.objectStorage, item, signal);
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
      for (const requestId of requestIds) {
        try {
          await options.store.finalizeDeletion(requestId);
        } catch (error) {
          logger.error({ event: "studio_delete_finalize_deferred", requestId, errorCode: errorCode(error) });
        }
      }
      const requestBacklog = pending.length === 0
        ? await options.store.pendingDeletionRequests(1, excludeOwnerKeys)
        : [];
      for (const request of requestBacklog) {
        try {
          await options.store.finalizeDeletion(request.requestId);
        } catch (error) {
          logger.error({ event: "studio_delete_finalize_deferred", requestId: request.requestId, errorCode: errorCode(error) });
        }
      }
      const first = pending[0] ?? requestBacklog[0];
      return {
        attempted: pending.length + requestBacklog.length,
        reconciled,
        item: first ? { workspaceId: first.workspaceId, ownerProfileId: first.ownerProfileId, requestId: first.requestId } : null
      };
    }
  };
}

export type StudioMaintenanceBudget = { excludeOwnerKeys?: readonly string[] };

export type InMemoryStudioPortabilityStore = StudioPortabilityStore & {
  memoryRows(scope: StudioOwnerPortabilityScope): PortableRow[];
  operationalLinks(): Array<Record<string, unknown>>;
  pendingObjectDeletionRows(): ObjectDeletion[];
  exportRows(): StudioPortabilityExport[];
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
  const exportRecords = new Map<string, StudioPortabilityExport>();
  const cleanedFailedExports = new Set<string>();
  const deletions = new Map<string, {
    status: "processing" | "completed" | "reconciliation_pending";
    scope: StudioOwnerPortabilityScope;
  }>();
  const pending = new Map<string, ObjectDeletion>();
  const ownerLocks = new Map<string, Promise<void>>();

  async function withOwnerLock<T>(scope: StudioOwnerPortabilityScope, action: () => Promise<T>): Promise<T> {
    const key = scopeKey(scope);
    const previous = ownerLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    ownerLocks.set(key, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (ownerLocks.get(key) === queued) ownerLocks.delete(key);
    }
  }

  const hasActiveDeletion = (scope: StudioOwnerPortabilityScope) => [...deletions.values()].some((item) => (
    scopeKey(item.scope) === scopeKey(scope) && item.status !== "completed"
  ));

  async function requireFence(scope: StudioOwnerPortabilityScope, authorize: OwnerFence) {
    if (!(await authorize())) throw portabilityError("STUDIO_PORTABILITY_FORBIDDEN");
    if (hasActiveDeletion(scope)) throw portabilityError("STUDIO_PORTABILITY_DELETION_ACTIVE");
  }

  return {
    async readSnapshot(scope) {
      const snapshot = input.repository
        ? await input.repository.readPortabilitySnapshot(scope)
        : clone(snapshots.get(scopeKey(scope)) ?? emptySnapshot(scope));
      if (input.proactivity) {
        const rows = await input.proactivity.readPortabilityRows(scope);
        snapshot.proactivitySettings = rows.settings ? [clone(rows.settings)] : [];
        snapshot.proactiveSignals = filterStructureSignals(snapshot.structures, clone(rows.signals));
      }
      return snapshot;
    },
    async createExport(record, authorize) {
      await withOwnerLock(record.scope, async () => {
        await requireFence(record.scope, authorize);
        exportRecords.set(record.id, {
          id: record.id,
          ...clone(record.scope),
          objectKey: record.objectKey,
          status: "pending",
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          claimToken: null,
          claimLeaseExpiresAt: null
        });
      });
    },
    async findExport(scope, id) {
      const record = exportRecords.get(id);
      return record && scopeKey(record) === scopeKey(scope) ? clone(record) : null;
    },
    async claimNextExport({ claimToken, claimLeaseExpiresAt, now, excludeOwnerKeys = [] }) {
      const record = [...exportRecords.values()]
        .filter((item) => !excludeOwnerKeys.includes(ownerKey(item)))
        .filter((item) => item.status === "pending" || (
          item.status === "processing" && Boolean(item.claimLeaseExpiresAt) && item.claimLeaseExpiresAt! <= now
        ))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
      if (!record) return null;
      return withOwnerLock(record, async () => {
        if (!(record.status === "pending" || (
          record.status === "processing" && Boolean(record.claimLeaseExpiresAt) && record.claimLeaseExpiresAt! <= now
        ))) return null;
        record.status = "processing";
        record.claimToken = claimToken;
        record.claimLeaseExpiresAt = claimLeaseExpiresAt;
        return clone(record);
      });
    },
    async publishExport({ scope, id, claimToken, expiresAt }, authorize, publish) {
      return withOwnerLock(scope, async () => {
        await requireFence(scope, authorize);
        const record = exportRecords.get(id);
        if (!record || scopeKey(record) !== scopeKey(scope)) throw portabilityError("STUDIO_EXPORT_NOT_FOUND");
        if (record.status !== "processing" || record.claimToken !== claimToken) {
          throw portabilityError("STUDIO_EXPORT_CLAIM_LOST");
        }
        const result = await publish();
        record.status = "ready";
        record.expiresAt = expiresAt;
        record.claimToken = null;
        record.claimLeaseExpiresAt = null;
        return result;
      });
    },
    async signExport({ scope, id, now }, authorize, sign) {
      return withOwnerLock(scope, async () => {
        await requireFence(scope, authorize);
        const record = exportRecords.get(id);
        if (!record || scopeKey(record) !== scopeKey(scope)) throw portabilityError("STUDIO_EXPORT_NOT_FOUND");
        if (record.status !== "ready") throw portabilityError("STUDIO_EXPORT_NOT_READY");
        if (record.expiresAt <= now) throw portabilityError("STUDIO_EXPORT_EXPIRED");
        return sign(clone(record));
      });
    },
    async markExportFailed({ id, claimToken }) {
      const record = exportRecords.get(id);
      if (record?.status === "processing" && record.claimToken === claimToken) {
        record.status = "failed";
        record.claimToken = null;
        record.claimLeaseExpiresAt = null;
      }
    },
    async expireNextExport({ now, excludeOwnerKeys = [] }, remove) {
      const record = [...exportRecords.values()]
        .filter((item) => (
          (item.status === "ready" && item.expiresAt <= now)
          || (item.status === "failed" && !cleanedFailedExports.has(item.id))
        ) && !excludeOwnerKeys.includes(ownerKey(item)))
        .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt) || left.id.localeCompare(right.id))[0];
      if (!record) return null;
      return withOwnerLock(record, async () => {
        if (!((record.status === "ready" && record.expiresAt <= now)
          || (record.status === "failed" && !cleanedFailedExports.has(record.id)))) return null;
        await remove(clone(record));
        if (record.status === "ready") record.status = "expired";
        else cleanedFailedExports.add(record.id);
        return clone(record);
      });
    },
    async beginDeletion({ requestId, scope, requestedAt }, authorize) {
      return withOwnerLock(scope, async () => {
      if (!(await authorize())) throw portabilityError("STUDIO_PORTABILITY_FORBIDDEN");
      if (hasActiveDeletion(scope)) throw portabilityError("STUDIO_PORTABILITY_DELETION_ACTIVE");
      // The request marker exists before the destructive mutation, mirroring the database transaction.
      deletions.set(requestId, { status: "processing", scope: clone(scope) });
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
        if (scopeKey(record) === key) objectKeys.add(record.objectKey);
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
      for (const [id, record] of exportRecords) if (scopeKey(record) === key) exportRecords.delete(id);
      return [...objectKeys].map((objectKey) => ({ objectKey, storageUploadId: activeUploads.get(objectKey) ?? null }));
      });
    },
    async settleObjectDeletion({ requestId, objectKey, deleted }) {
      if (deleted) pending.delete(`${requestId}:${objectKey}`);
    },
    async pendingObjectDeletions(limit, excludeOwnerKeys = []) {
      return clone([...pending.values()].filter((item) => !excludeOwnerKeys.includes(ownerKey(item))).slice(0, limit));
    },
    async pendingDeletionRequests(limit, excludeOwnerKeys = []) {
      return [...deletions.entries()]
        .filter(([, record]) => record.status !== "completed" && !excludeOwnerKeys.includes(ownerKey(record.scope)))
        .slice(0, limit)
        .map(([requestId, record]) => ({ requestId, ...clone(record.scope) }));
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
    },
    exportRows() {
      return clone([...exportRecords.values()]);
    }
  };
}

function filterStructureSignals(structures: PortableRow[], signals: object[]): object[] {
  const retained = new Map(structures.flatMap((structure) => {
    const id = structure.id;
    const kind = structure.kind;
    return typeof id === "string" && typeof kind === "string" ? [[id, kind] as const] : [];
  }));
  return signals.filter((signal) => {
    const row = signal as Record<string, unknown>;
    const type = row.type ?? row.signal_type;
    const sourceId = row.sourceId ?? row.source_id;
    if (type === "ritual_reminder") return retained.get(String(sourceId)) === "ritual";
    if (type === "stale_goal") return retained.get(String(sourceId)) === "goal";
    if (type === "decision_review") return retained.get(String(sourceId)) === "decision";
    return true;
  });
}

type PlannedZipEntry = {
  name: string;
  nameBytes: Buffer;
  sizeBytes: number;
  crc: number;
  open(signal?: AbortSignal): Promise<Readable>;
};

type StudioArchivePlan = { entries: PlannedZipEntry[]; sizeBytes: number };

async function planStudioArchive(
  snapshot: StudioPortabilitySnapshot,
  storage: ObjectStorage,
  maxExportBytes: number,
  signal?: AbortSignal
): Promise<StudioArchivePlan> {
  const entries: PlannedZipEntry[] = [];
  const manifest = exportManifest(snapshot);
  const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  ensureExportSize(manifestBody.length, maxExportBytes);
  entries.push({
    name: "manifest.json",
    nameBytes: Buffer.from("manifest.json", "utf8"),
    sizeBytes: manifestBody.length,
    crc: crc32(manifestBody),
    async open() { return Readable.from([manifestBody]); }
  });
  let totalBytes = manifestBody.length;
  for (const asset of snapshot.assets) {
    const objectKey = asset.object_key ?? asset.objectKey;
    if (typeof objectKey !== "string" || !objectKey) continue;
    const object = await storage.get(objectKey, { signal });
    const inspected = await inspectBoundedStream(object.body, maxExportBytes - totalBytes, signal);
    totalBytes += inspected.sizeBytes;
    ensureExportSize(totalBytes, maxExportBytes);
    const name = assetArchivePath(asset);
    entries.push({
      name,
      nameBytes: Buffer.from(assertArchivePath(name), "utf8"),
      sizeBytes: inspected.sizeBytes,
      crc: inspected.crc,
      async open(openSignal) { return (await storage.get(objectKey, { signal: openSignal })).body; }
    });
  }
  if (entries.length > 65_535) throw portabilityError("STUDIO_EXPORT_TOO_MANY_FILES");
  const localBytes = entries.reduce((sum, entry) => sum + 30 + entry.nameBytes.length + entry.sizeBytes, 0);
  const centralBytes = entries.reduce((sum, entry) => sum + 46 + entry.nameBytes.length, 0);
  const archiveBytes = localBytes + centralBytes + 22;
  ensureExportSize(archiveBytes, maxExportBytes);
  return { entries, sizeBytes: archiveBytes };
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

async function inspectBoundedStream(stream: Readable, remaining: number, signal?: AbortSignal) {
  let size = 0;
  let crc = 0xffffffff;
  for await (const chunk of stream) {
    if (signal?.aborted) throw signal.reason ?? new Error("ABORTED");
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > remaining) {
      stream.destroy();
      throw portabilityError("STUDIO_EXPORT_TOO_LARGE");
    }
    crc = crc32Update(crc, buffer);
  }
  return { sizeBytes: size, crc: (crc ^ 0xffffffff) >>> 0 };
}

function createStoredZipStream(plan: StudioArchivePlan, signal?: AbortSignal): Readable {
  return Readable.from((async function* () {
    let offset = 0;
    const offsets: number[] = [];
    for (const entry of plan.entries) {
      throwIfAborted(signal);
      offsets.push(offset);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt32LE(entry.crc, 14);
      local.writeUInt32LE(entry.sizeBytes, 18);
      local.writeUInt32LE(entry.sizeBytes, 22);
      local.writeUInt16LE(entry.nameBytes.length, 26);
      yield local;
      yield entry.nameBytes;
      const body = await entry.open(signal);
      let actualSize = 0;
      let actualCrc = 0xffffffff;
      for await (const chunk of body) {
        throwIfAborted(signal);
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        actualSize += buffer.length;
        if (actualSize > entry.sizeBytes) {
          body.destroy();
          throw portabilityError("STUDIO_EXPORT_SOURCE_CHANGED");
        }
        actualCrc = crc32Update(actualCrc, buffer);
        for (let cursor = 0; cursor < buffer.length; cursor += 64 * 1024) {
          yield buffer.subarray(cursor, Math.min(cursor + 64 * 1024, buffer.length));
        }
      }
      if (actualSize !== entry.sizeBytes || ((actualCrc ^ 0xffffffff) >>> 0) !== entry.crc) {
        throw portabilityError("STUDIO_EXPORT_SOURCE_CHANGED");
      }
      offset += local.length + entry.nameBytes.length + entry.sizeBytes;
    }
    const centralStart = offset;
    for (const [index, entry] of plan.entries.entries()) {
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt32LE(entry.crc, 16);
      central.writeUInt32LE(entry.sizeBytes, 20);
      central.writeUInt32LE(entry.sizeBytes, 24);
      central.writeUInt16LE(entry.nameBytes.length, 28);
      central.writeUInt32LE(offsets[index]!, 42);
      yield central;
      yield entry.nameBytes;
      offset += central.length + entry.nameBytes.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(plan.entries.length, 8);
    end.writeUInt16LE(plan.entries.length, 10);
    end.writeUInt32LE(offset - centralStart, 12);
    end.writeUInt32LE(centralStart, 16);
    yield end;
  })());
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  const crc = crc32Update(0xffffffff, buffer);
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32Update(initial: number, buffer: Buffer): number {
  let crc = initial;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return crc;
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

async function deleteStoredTarget(
  storage: ObjectStorage,
  target: StudioPortabilityObjectTarget,
  signal?: AbortSignal
): Promise<void> {
  if (target.storageUploadId) {
    await storage.abortAtomicUpload({ key: target.objectKey, uploadId: target.storageUploadId }, { signal });
  }
  await storage.delete(target.objectKey, { signal });
}

function ensureExportSize(bytes: number, limit = MAX_EXPORT_BYTES): void {
  if (bytes > limit) throw portabilityError("STUDIO_EXPORT_TOO_LARGE");
}

function scopeKey(scope: StudioOwnerPortabilityScope): string {
  return `${scope.workspaceId}\0${scope.ownerProfileId}`;
}

function ownerKey(scope: StudioOwnerPortabilityScope): string {
  return `${scope.workspaceId}/${scope.ownerProfileId}`;
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("ABORTED");
}
