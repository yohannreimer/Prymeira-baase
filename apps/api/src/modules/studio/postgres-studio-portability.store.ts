import type { OperationalClient, OperationalPool } from "../../db/operational-repository-support";
import type {
  StudioOwnerPortabilityScope,
  StudioPortabilityObjectTarget,
  StudioPortabilitySnapshot,
  StudioPortabilityStore
} from "./studio-portability.service";

type Row = Record<string, unknown>;

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

    async recordExport({ id, scope, objectKey, createdAt, expiresAt }) {
      await pool.query(
        `INSERT INTO studio_portability_exports
          (id,workspace_id,owner_profile_id,object_key,status,created_at,expires_at)
         VALUES ($1,$2,$3,$4,'preparing',$5,$6)`,
        [id, scope.workspaceId, scope.ownerProfileId, objectKey, createdAt, expiresAt]
      );
    },

    async markExportReady(id) {
      await pool.query(`UPDATE studio_portability_exports SET status='ready',updated_at=NOW() WHERE id=$1`, [id]);
    },

    async markExportFailed(id) {
      await pool.query(
        `UPDATE studio_portability_exports SET status='failed',updated_at=NOW() WHERE id=$1`,
        [id]
      );
    },

    async beginDeletion({ requestId, scope, requestedAt }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const activeOwner = await client.query<{ id: string }>(
          `SELECT id FROM people
           WHERE workspace_id=$1 AND id=$2 AND role='owner' AND status='active'
           FOR KEY SHARE`,
          [scope.workspaceId, scope.ownerProfileId]
        );
        if (!activeOwner.rows[0]) throw Object.assign(new Error("STUDIO_PORTABILITY_FORBIDDEN"), {
          code: "STUDIO_PORTABILITY_FORBIDDEN"
        });
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

    async pendingObjectDeletions(limit) {
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
         ORDER BY updated_at,request_id,object_key
         LIMIT $1`,
        [limit]
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
