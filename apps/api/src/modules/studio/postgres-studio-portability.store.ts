import type { OperationalClient, OperationalPool } from "../../db/operational-repository-support";
import type {
  StudioOwnerPortabilityScope,
  StudioPortabilityExport,
  StudioPortabilityObjectTarget,
  StudioPortabilitySnapshot,
  StudioPortabilityStore
} from "./studio-portability.service";

type Row = Record<string, unknown>;

type ExportRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  object_key: string;
  status: StudioPortabilityExport["status"];
  created_at: string | Date;
  expires_at: string | Date;
  claim_token: string | null;
  claim_lease_expires_at: string | Date | null;
};

export function createPostgresStudioPortabilityStore(pool: OperationalPool): StudioPortabilityStore {
  return {
    async readSnapshot(scope) {
      const values = [scope.workspaceId, scope.ownerProfileId];
      const [
        documents, versions, assets, structures, collections, collectionItems, ritualSessions,
        conversations, messages, suggestions, citations, relations, memoryRows, proactivitySettings, proactiveSignals
      ] = await Promise.all([
        rows(pool, "studio_documents", values),
        rows(pool, "studio_document_versions", values),
        rows(pool, "studio_assets", values),
        rows(pool, "studio_structures", values),
        rows(pool, "studio_collections", values),
        rows(pool, "studio_collection_items", values),
        rows(pool, "studio_ritual_sessions", values),
        rows(pool, "studio_conversations", values),
        rows(pool, "studio_messages", values),
        rows(pool, "studio_suggestions", values),
        rows(pool, "studio_citations", values),
        rows(pool, "studio_relations", values),
        optionalMemoryRows(pool, values),
        rows(pool, "studio_proactivity_settings", values),
        rows(pool, "studio_proactive_signals", values)
      ]);
      return {
        ...scope, documents, versions, assets, structures, collections, collectionItems,
        ritualSessions, conversations, messages, suggestions, citations, relations, memoryRows,
        proactivitySettings, proactiveSignals
      } satisfies StudioPortabilitySnapshot;
    },

    async createExport({ id, scope, objectKey, createdAt, expiresAt }, authorize) {
      await withOwnerTransaction(pool, scope, authorize, async (client) => {
        await ensureNoActiveDeletion(client, scope);
        await client.query(
          `INSERT INTO studio_portability_exports
            (id,workspace_id,owner_profile_id,object_key,status,created_at,expires_at,updated_at)
           VALUES ($1,$2,$3,$4,'pending',$5,$6,$5)`,
          [id, scope.workspaceId, scope.ownerProfileId, objectKey, createdAt, expiresAt]
        );
      });
    },

    async findExport(scope, id) {
      const result = await pool.query<ExportRow>(
        `SELECT * FROM studio_portability_exports
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
        [scope.workspaceId, scope.ownerProfileId, id]
      );
      return result.rows[0] ? exportFromRow(result.rows[0]) : null;
    },

    async claimNextExport({ claimToken, claimLeaseExpiresAt, now, excludeOwnerKeys = [] }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query<ExportRow>(
          `SELECT exports.* FROM studio_portability_exports exports
           JOIN people owner
             ON owner.workspace_id=exports.workspace_id AND owner.id=exports.owner_profile_id
           WHERE (exports.status='pending'
                  OR (exports.status='processing' AND exports.claim_lease_expires_at<=$1))
             AND owner.role='owner' AND owner.status='active'
             AND NOT ((exports.workspace_id || '/' || exports.owner_profile_id)=ANY($2::text[]))
             AND NOT EXISTS (
               SELECT 1 FROM studio_portability_delete_requests deletion
               WHERE deletion.workspace_id=exports.workspace_id
                 AND deletion.owner_profile_id=exports.owner_profile_id
                 AND deletion.status IN ('processing','reconciliation_pending')
             )
           ORDER BY exports.created_at,exports.id
           FOR UPDATE OF exports SKIP LOCKED
           LIMIT 1`,
          [now, [...excludeOwnerKeys]]
        );
        const row = selected.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const updated = await client.query<ExportRow>(
          `UPDATE studio_portability_exports
           SET status='processing',claim_token=$2,claim_lease_expires_at=$3,failure_code=NULL,updated_at=$4
           WHERE id=$1 RETURNING *`,
          [row.id, claimToken, claimLeaseExpiresAt, now]
        );
        await client.query("COMMIT");
        return exportFromRow(updated.rows[0]!);
      } catch (error) {
        await rollback(client, error);
        throw error;
      } finally {
        client.release();
      }
    },

    async publishExport({ scope, id, claimToken, readyAt, expiresAt }, authorize, publish) {
      return withOwnerTransaction(pool, scope, authorize, async (client) => {
        await ensureNoActiveDeletion(client, scope);
        const claimed = await client.query<ExportRow>(
          `SELECT * FROM studio_portability_exports
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
           FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, id]
        );
        const record = claimed.rows[0];
        if (!record) throw portabilityError("STUDIO_EXPORT_NOT_FOUND");
        if (record.status !== "processing" || record.claim_token !== claimToken) {
          throw portabilityError("STUDIO_EXPORT_CLAIM_LOST");
        }
        const result = await publish();
        await client.query(
          `UPDATE studio_portability_exports
           SET status='ready',claim_token=NULL,claim_lease_expires_at=NULL,ready_at=$2,expires_at=$3,updated_at=$2
           WHERE id=$1`,
          [id, readyAt, expiresAt]
        );
        return result;
      });
    },

    async signExport({ scope, id, now }, authorize, sign) {
      return withOwnerTransaction(pool, scope, authorize, async (client) => {
        await ensureNoActiveDeletion(client, scope);
        const selected = await client.query<ExportRow>(
          `SELECT * FROM studio_portability_exports
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
           FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, id]
        );
        const record = selected.rows[0];
        if (!record) throw portabilityError("STUDIO_EXPORT_NOT_FOUND");
        if (record.status !== "ready") throw portabilityError("STUDIO_EXPORT_NOT_READY");
        if (iso(record.expires_at) <= now) throw portabilityError("STUDIO_EXPORT_EXPIRED");
        return sign(exportFromRow(record));
      });
    },

    async markExportFailed({ id, claimToken, errorCode }) {
      await pool.query(
        `UPDATE studio_portability_exports
         SET status='failed',claim_token=NULL,claim_lease_expires_at=NULL,failure_code=$3,updated_at=NOW()
         WHERE id=$1 AND status='processing' AND claim_token=$2`,
        [id, claimToken, errorCode]
      );
    },

    async expireNextExport({ now, excludeOwnerKeys = [] }, remove) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query<ExportRow>(
          `SELECT * FROM studio_portability_exports
           WHERE ((status='ready' AND expires_at<=$1) OR (status='failed' AND expired_at IS NULL))
             AND NOT ((workspace_id || '/' || owner_profile_id)=ANY($2::text[]))
           ORDER BY expires_at,id
           LIMIT 1`,
          [now, [...excludeOwnerKeys]]
        );
        const candidate = selected.rows[0];
        if (!candidate) {
          await client.query("COMMIT");
          return null;
        }
        await lockOwnerRow(client, { workspaceId: candidate.workspace_id, ownerProfileId: candidate.owner_profile_id });
        const locked = await client.query<ExportRow>(
          `SELECT * FROM studio_portability_exports
           WHERE id=$1
             AND ((status='ready' AND expires_at<=$2) OR (status='failed' AND expired_at IS NULL))
           FOR UPDATE`,
          [candidate.id, now]
        );
        const row = locked.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const record = exportFromRow(row);
        await remove(record);
        await client.query(
          `UPDATE studio_portability_exports
           SET status=CASE WHEN status='ready' THEN 'expired' ELSE status END,
               expired_at=$2,updated_at=$2 WHERE id=$1`,
          [row.id, now]
        );
        await client.query("COMMIT");
        return { ...record, status: record.status === "ready" ? "expired" as const : "failed" as const };
      } catch (error) {
        await rollback(client, error);
        throw error;
      } finally {
        client.release();
      }
    },

    async beginDeletion({ requestId, scope, requestedAt }, authorize) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const owner = await lockOwnerRow(client, scope);
        if (!owner || owner.role !== "owner" || owner.status !== "active" || !(await authorize())) {
          throw portabilityError("STUDIO_PORTABILITY_FORBIDDEN");
        }
        await ensureNoActiveDeletion(client, scope);
        await client.query(
          `INSERT INTO studio_portability_delete_requests
            (id,workspace_id,owner_profile_id,status,requested_at,updated_at)
           VALUES ($1,$2,$3,'processing',$4,$4)`,
          [requestId, scope.workspaceId, scope.ownerProfileId, requestedAt]
        );
        const objectKeys = await collectObjectKeys(client, scope);
        for (const target of objectKeys) {
          await client.query(
            `INSERT INTO studio_portability_object_deletions
              (request_id,workspace_id,owner_profile_id,object_key,storage_upload_id,status,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,'pending',$6,$6)
             ON CONFLICT (request_id,object_key) DO NOTHING`,
            [requestId, scope.workspaceId, scope.ownerProfileId, target.objectKey, target.storageUploadId, requestedAt]
          );
        }
        await client.query(
          `UPDATE studio_operational_links
           SET source_deleted_at=$3
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND source_deleted_at IS NULL`,
          [scope.workspaceId, scope.ownerProfileId, requestedAt]
        );
        if (await relationExists(client, "studio_memory_chunks")) {
          await client.query(
            `DELETE FROM studio_memory_chunks WHERE workspace_id=$1 AND owner_profile_id=$2`,
            [scope.workspaceId, scope.ownerProfileId]
          );
        }
        await deleteOwnerRows(client, scope);
        await client.query("COMMIT");
        return objectKeys;
      } catch (error) {
        await rollback(client, error);
        throw error;
      } finally {
        client.release();
      }
    },

    async settleObjectDeletion({ requestId, objectKey, deleted }) {
      if (!deleted) {
        await pool.query(
          `UPDATE studio_portability_object_deletions
           SET attempt_count=attempt_count+1,last_error_code='OBJECT_DELETE_FAILED',updated_at=NOW()
           WHERE request_id=$1 AND object_key=$2 AND status='pending'`,
          [requestId, objectKey]
        );
        return;
      }
      await pool.query(
        `DELETE FROM studio_portability_object_deletions WHERE request_id=$1 AND object_key=$2`,
        [requestId, objectKey]
      );
    },

    async pendingObjectDeletions(limit, excludeOwnerKeys = []) {
      const result = await pool.query<{
        request_id: string;
        workspace_id: string;
        owner_profile_id: string;
        object_key: string;
        storage_upload_id: string | null;
      }>(
        `SELECT request_id,workspace_id,owner_profile_id,object_key,storage_upload_id
         FROM studio_portability_object_deletions
         WHERE status='pending'
           AND NOT ((workspace_id || '/' || owner_profile_id)=ANY($2::text[]))
         ORDER BY updated_at,request_id,object_key
         LIMIT $1`,
        [limit, [...excludeOwnerKeys]]
      );
      return result.rows.map((row) => ({
        requestId: row.request_id,
        workspaceId: row.workspace_id,
        ownerProfileId: row.owner_profile_id,
        objectKey: row.object_key,
        storageUploadId: row.storage_upload_id,
        status: "pending" as const
      }));
    },

    async pendingDeletionRequests(limit, excludeOwnerKeys = []) {
      const result = await pool.query<{
        id: string;
        workspace_id: string;
        owner_profile_id: string;
      }>(
        `SELECT id,workspace_id,owner_profile_id
         FROM studio_portability_delete_requests
         WHERE status IN ('processing','reconciliation_pending')
           AND NOT ((workspace_id || '/' || owner_profile_id)=ANY($2::text[]))
         ORDER BY updated_at,id LIMIT $1`,
        [limit, [...excludeOwnerKeys]]
      );
      return result.rows.map((row) => ({
        requestId: row.id,
        workspaceId: row.workspace_id,
        ownerProfileId: row.owner_profile_id
      }));
    },

    async finalizeDeletion(requestId) {
      const result = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM studio_portability_object_deletions WHERE request_id=$1`,
        [requestId]
      );
      const pendingObjectCount = Number(result.rows[0]?.count ?? 0);
      await pool.query(
        `UPDATE studio_portability_delete_requests
         SET status=$2,completed_at=CASE WHEN $2='completed' THEN NOW() ELSE NULL END,updated_at=NOW()
         WHERE id=$1`,
        [requestId, pendingObjectCount === 0 ? "completed" : "reconciliation_pending"]
      );
      return { pendingObjectCount };
    }
  };
}

async function withOwnerTransaction<T>(
  pool: OperationalPool,
  scope: StudioOwnerPortabilityScope,
  authorize: () => Promise<boolean>,
  action: (client: OperationalClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await lockOwnerRow(client, scope);
    if (!owner || owner.role !== "owner" || owner.status !== "active" || !(await authorize())) {
      throw portabilityError("STUDIO_PORTABILITY_FORBIDDEN");
    }
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await rollback(client, error);
    throw error;
  } finally {
    client.release();
  }
}

async function lockOwnerRow(client: OperationalClient, scope: StudioOwnerPortabilityScope) {
  const result = await client.query<{ id: string; role: string; status: string }>(
    `SELECT id,role,status FROM people
     WHERE workspace_id=$1 AND id=$2
     FOR UPDATE`,
    [scope.workspaceId, scope.ownerProfileId]
  );
  return result.rows[0] ?? null;
}

async function ensureNoActiveDeletion(client: OperationalClient, scope: StudioOwnerPortabilityScope) {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM studio_portability_delete_requests
     WHERE workspace_id=$1 AND owner_profile_id=$2
       AND status IN ('processing','reconciliation_pending')
     LIMIT 1`,
    [scope.workspaceId, scope.ownerProfileId]
  );
  if (result.rows[0]) throw portabilityError("STUDIO_PORTABILITY_DELETION_ACTIVE");
}

function exportFromRow(row: ExportRow): StudioPortabilityExport {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    objectKey: row.object_key,
    status: row.status,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    claimToken: row.claim_token,
    claimLeaseExpiresAt: row.claim_lease_expires_at ? iso(row.claim_lease_expires_at) : null
  };
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function portabilityError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

async function rows(pool: OperationalPool, table: string, values: string[]): Promise<Row[]> {
  const result = await pool.query<Row>(
    `SELECT * FROM ${table} WHERE workspace_id=$1 AND owner_profile_id=$2 ORDER BY id`,
    values
  );
  return result.rows;
}

async function optionalMemoryRows(pool: OperationalPool, values: string[]): Promise<Row[]> {
  if (!(await relationExists(pool, "studio_memory_chunks"))) return [];
  return rows(pool, "studio_memory_chunks", values);
}

async function collectObjectKeys(client: OperationalClient, scope: StudioOwnerPortabilityScope): Promise<StudioPortabilityObjectTarget[]> {
  const result = await client.query<{ object_key: string; storage_upload_id: string | null }>(
    `SELECT object_key,MAX(storage_upload_id) AS storage_upload_id FROM (
       SELECT object_key,NULL::TEXT AS storage_upload_id FROM studio_assets WHERE workspace_id=$1 AND owner_profile_id=$2
       UNION ALL
       SELECT object_key,storage_upload_id FROM studio_asset_upload_intents WHERE workspace_id=$1 AND owner_profile_id=$2
       UNION ALL
       SELECT object_key,NULL::TEXT AS storage_upload_id FROM studio_asset_cleanup_jobs WHERE workspace_id=$1 AND owner_profile_id=$2
       UNION ALL
       SELECT object_key,NULL::TEXT AS storage_upload_id FROM studio_portability_exports WHERE workspace_id=$1 AND owner_profile_id=$2
     ) owner_objects WHERE object_key IS NOT NULL AND object_key<>'' GROUP BY object_key`,
    [scope.workspaceId, scope.ownerProfileId]
  );
  return result.rows.map((row) => ({ objectKey: row.object_key, storageUploadId: row.storage_upload_id }));
}

async function deleteOwnerRows(client: OperationalClient, scope: StudioOwnerPortabilityScope): Promise<void> {
  const values = [scope.workspaceId, scope.ownerProfileId];
  // These are Studio-private roots. Operational resources and their retained links are intentionally absent.
  for (const table of [
    "studio_proactive_signals", "studio_proactivity_settings",
    "studio_citations", "studio_messages", "studio_suggestions", "studio_conversations",
    "studio_operation_previews", "studio_ritual_sessions", "studio_structures", "studio_relations",
    "studio_index_jobs", "studio_collection_items", "studio_collections", "studio_asset_cleanup_jobs",
    "studio_asset_upload_intents", "studio_assets", "studio_document_versions", "studio_documents",
    "studio_portability_exports"
  ]) {
    await client.query(`DELETE FROM ${table} WHERE workspace_id=$1 AND owner_profile_id=$2`, values);
  }
}

async function relationExists(queryable: Pick<OperationalPool, "query">, relation: string): Promise<boolean> {
  const result = await queryable.query<{ relation: string | null }>("SELECT to_regclass($1) AS relation", [relation]);
  return Boolean(result.rows[0]?.relation);
}

async function rollback(client: OperationalClient, primaryError: unknown): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (cleanupError) {
    if (primaryError && typeof primaryError === "object") {
      Object.defineProperty(primaryError, "rollbackError", { value: cleanupError, enumerable: false });
    }
  }
}
