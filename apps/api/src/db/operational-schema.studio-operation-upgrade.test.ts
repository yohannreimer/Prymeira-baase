import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DataType, newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureOperationalSchemaThrough } from "./operational-schema";
import { createPostgresStudioOperationsStore } from "../modules/studio/studio-operations-bridge";

let db: Pool;

beforeEach(() => {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: () => 1
  });
  memoryDb.public.registerFunction({
    name: "cardinality",
    args: [memoryDb.public.getType(DataType.text).asArray()],
    returns: DataType.integer,
    implementation: (value: unknown[]) => value.length
  });
  memoryDb.public.registerFunction({
    name: "array_positions",
    args: [memoryDb.public.getType(DataType.text).asArray(), DataType.text],
    returns: memoryDb.public.getType(DataType.integer).asArray(),
    implementation: (values: string[], target: string) => values.flatMap((value, index) => value === target ? [index + 1] : [])
  });
  memoryDb.public.registerFunction({
    name: "date_bin",
    args: [DataType.interval, DataType.timestamptz, DataType.timestamptz],
    returns: DataType.timestamptz,
    implementation: (_interval: unknown, value: Date) => value
  });
  memoryDb.public.registerFunction({
    name: "jsonb_typeof",
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: (value: unknown) => Array.isArray(value) ? "array" : value === null ? "null" : typeof value
  });
  memoryDb.public.registerOperator({
    operator: "~", left: DataType.text, right: DataType.text, returns: DataType.bool,
    implementation: (value: string, pattern: string) => new RegExp(pattern).test(value)
  });
  const adapter = memoryDb.adapters.createPg();
  db = new adapter.Pool();
});

afterEach(async () => db.end());

describe("Studio operation durable-identity upgrade", () => {
  it("keeps released migration 18 byte-stable and moves durable identity to migration 24", () => {
    const source = readFileSync(resolve(process.cwd(), "src/db/operational-schema.ts"), "utf8");
    const migration18 = source.slice(source.indexOf("  version: 18,"), source.indexOf("  version: 20,"));
    const migration24 = source.slice(source.indexOf("  version: 24,"));

    expect(createHash("sha256").update(migration18).digest("hex"))
      .toBe("81439de3b0b47b0778054a561016836ccdb2d123250836860bf706daea9378df");
    expect(migration18).not.toContain("intended_resource_id");
    expect(migration24).toContain("ADD COLUMN IF NOT EXISTS intended_resource_id TEXT");
    expect(migration24).toContain("studio_operation_previews_intended_resource_state_ck");
  });

  it("upgrades old migration 18 rows additively, backfills confirmed identity, and fences legacy confirming work", async () => {
    await ensureOperationalSchemaThrough(db, 18);
    await expect(columnNames(db, "studio_operation_previews", "intended_resource_id")).resolves.toEqual([]);
    await seedPreviewReferences(db);
    await seedOldPreviewRows(db);

    await ensureOperationalSchemaThrough(db, 24);
    await ensureOperationalSchemaThrough(db, 24);

    const rows = await db.query<{ id: string; intended_resource_id: string | null; result_resource_id: string | null }>(
      `select id,intended_resource_id,result_resource_id
         from studio_operation_previews order by id`
    );
    expect(rows.rows).toEqual([
      { id: "preview_confirmed", intended_resource_id: "task_existing", result_resource_id: "task_existing" },
      { id: "preview_confirming", intended_resource_id: null, result_resource_id: null },
      { id: "preview_expired", intended_resource_id: null, result_resource_id: null },
      { id: "preview_open", intended_resource_id: null, result_resource_id: null }
    ]);
    await expect(db.query(
      "update studio_operation_previews set intended_resource_id='task_wrong' where id='preview_confirmed'"
    )).rejects.toThrow();
    await expect(db.query(
      "update studio_operation_previews set intended_resource_id='task_wrong' where id='preview_open'"
    )).rejects.toThrow();
    await db.query(
      `update studio_operation_previews
          set payload_json=$1::jsonb,confirmed_payload_json=$1::jsonb
        where id='preview_confirming'`,
      [JSON.stringify(taskDraft())]
    );

    const claim = await createPostgresStudioOperationsStore(db).claimConfirmation({
      scope: { workspaceId: "workspace_a", ownerProfileId: "owner_a" },
      actorProfileId: "owner_a",
      previewId: "preview_confirming",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      intendedResourceId: "task_new_attempt_must_not_replace_legacy",
      payload: taskDraft(),
      claimToken: "claim_after_upgrade",
      claimLeaseExpiresAt: "2026-07-14T12:20:00.000Z",
      now: "2026-07-14T12:10:00.000Z"
    });
    expect(claim).toEqual({ type: "indeterminate" });
  });
});

async function columnNames(pool: Pool, table: string, column: string) {
  const result = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name=$1 and column_name=$2`,
    [table, column]
  );
  return result.rows.map((row) => row.column_name);
}

async function seedPreviewReferences(pool: Pool) {
  await pool.query(`insert into studio_documents
    (id,workspace_id,owner_profile_id,body_json,body_text,capture_mode)
    values ('document_a','workspace_a','owner_a','{}'::jsonb,'','text')`);
  await pool.query(`insert into studio_suggestions
    (id,workspace_id,owner_profile_id,document_id,ai_run_id,kind,payload_json,status)
    values ('suggestion_a','workspace_a','owner_a','document_a','run_a','text','{}'::jsonb,'pending')`);
}

async function seedOldPreviewRows(pool: Pool) {
  const common = `workspace_id,owner_profile_id,source_suggestion_id,source_document_id,resource_type,payload_json,expires_at`;
  await pool.query(`insert into studio_operation_previews (id,${common}) values
    ('preview_open','workspace_a','owner_a','suggestion_a','document_a','task','{}'::jsonb,'2026-07-15T12:00:00Z')`);
  await pool.query(`insert into studio_operation_previews
    (id,${common},confirmed_payload_json,status,idempotency_key,claim_token,claim_lease_expires_at)
    values ('preview_confirming','workspace_a','owner_a','suggestion_a','document_a','task','{}'::jsonb,
      '2026-07-15T12:00:00Z','{}'::jsonb,'confirming','22222222-2222-4222-8222-222222222222',
      'claim_before_upgrade','2026-07-14T12:05:00Z')`);
  await pool.query(`insert into studio_operation_previews
    (id,${common},confirmed_payload_json,status,idempotency_key,result_resource_id,confirmed_at)
    values ('preview_confirmed','workspace_a','owner_a','suggestion_a','document_a','task','{}'::jsonb,
      '2026-07-15T12:00:00Z','{}'::jsonb,'confirmed','33333333-3333-4333-8333-333333333333',
      'task_existing','2026-07-14T12:00:00Z')`);
  await pool.query(`insert into studio_operation_previews (id,${common},status) values
    ('preview_expired','workspace_a','owner_a','suggestion_a','document_a','task','{}'::jsonb,
      '2026-07-15T12:00:00Z','expired')`);
}

function taskDraft() {
  return {
    resource_type: "task" as const,
    payload: {
      title: "Tarefa", area_id: null, assignee_profile_id: null, due_date: "2026-07-15",
      due_hint: null, approval_mode: "direct" as const, evidence_policy: "optional" as const,
      checklist_items: []
    }
  };
}
