import { randomUUID } from "node:crypto";

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

export async function inTransaction<T>(db: OperationalPool, run: (client: OperationalClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
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

export function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
