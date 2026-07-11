import { randomUUID } from "node:crypto";
import { attachCleanupError } from "./migration-cleanup-errors";

export type SqlResult<T> = { rows: T[]; rowCount?: number | null };
export type OperationalClient = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<SqlResult<T>>;
  release(): void;
};
export type OperationalPool = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<SqlResult<T>>;
  connect(): Promise<OperationalClient>;
};

export function generatedId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export async function withOperationalTransaction<T>(db: OperationalPool, run: (client: OperationalClient) => Promise<T>) {
  const client = await db.connect();
  let primaryError: unknown;
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    primaryError = error;
    try {
      await client.query("ROLLBACK");
    } catch (cleanupError) {
      attachCleanupError(error, cleanupError);
    }
    throw error;
  } finally {
    try {
      client.release();
    } catch (cleanupError) {
      if (primaryError) attachCleanupError(primaryError, cleanupError);
      else throw cleanupError;
    }
  }
}

export async function audit(
  client: OperationalClient,
  workspaceId: string,
  entityType: string,
  entityId: string,
  action: string,
  actorProfileId: string | null = null,
  details: Record<string, unknown> = {}
) {
  await client.query(
    `INSERT INTO operational_audit_log
      (id, workspace_id, entity_type, entity_id, action, actor_profile_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [generatedId("audit"), workspaceId, entityType, entityId, action, actorProfileId, JSON.stringify(details)]
  );
}

export async function lockActiveAreaReference(
  client: OperationalClient,
  workspaceId: string,
  areaId: string | null | undefined
) {
  if (!areaId) return;
  const area = await client.query<{ id: string }>(
    "SELECT id FROM areas WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR KEY SHARE",
    [workspaceId, areaId]
  );
  if (!area.rows[0]) throw new Error("AREA_NOT_FOUND");
}

export async function lockActiveRoleTemplateReference(
  client: OperationalClient,
  workspaceId: string,
  areaId: string | null | undefined,
  roleTemplateId: string | null | undefined
) {
  if (!roleTemplateId) return;
  const role = await client.query<{ area_id: string }>(
    "SELECT area_id FROM role_templates WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR KEY SHARE",
    [workspaceId, roleTemplateId]
  );
  if (!role.rows[0]) throw new Error("ROLE_TEMPLATE_NOT_FOUND");
  if (areaId && role.rows[0].area_id !== areaId) throw new Error("ROLE_TEMPLATE_AREA_MISMATCH");
}

const workspaceOperationalLockKey = 1095910732;

export async function lockWorkspaceOperationalMutation(client: OperationalClient, workspaceId: string) {
  await client.query("SELECT pg_advisory_xact_lock($1,$2)", [workspaceOperationalLockKey, workspaceLockValue(workspaceId)]);
}

function workspaceLockValue(value: string) {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return hash;
}

export function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
