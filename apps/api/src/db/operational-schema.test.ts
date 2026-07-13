import { DataType, newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureOperationalSchema,
  ensureOperationalSchemaThrough,
  type OperationalSchemaClient,
  type OperationalSchemaPool
} from "./operational-schema";
import type { ErrorWithCleanup } from "./migration-cleanup-errors";

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
    implementation: (values: string[], target: string) => values.flatMap((value, index) => (
      value === target ? [index + 1] : []
    ))
  });
  memoryDb.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value: string, pattern: string) => new RegExp(pattern).test(value)
  });
  const { Pool } = memoryDb.adapters.createPg();
  db = new Pool();
});

afterEach(async () => {
  await db.end();
});

describe("operational schema", () => {
  it("applies operational migrations exactly once", async () => {
    await ensureOperationalSchema(db);
    await ensureOperationalSchema(db);

    const result = await db.query<{ version: number }>(
      "select version from baase_schema_migrations order by version"
    );

    expect(result.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("creates owner-scoped Studio tables", async () => {
    await ensureOperationalSchema(db);
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_name in (
         'studio_documents',
         'studio_document_versions',
         'studio_assets',
         'studio_collections',
         'studio_collection_items'
       ) order by table_name`
    );

    expect(tables.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
      "studio_documents",
      "studio_document_versions",
      "studio_assets",
      "studio_collections",
      "studio_collection_items"
    ]));
  });

  it("migrates legacy people to the safe access scope for their role", async () => {
    await ensureOperationalSchemaThrough(db, 7);
    await db.query("insert into areas (id,workspace_id,name) values ('area_ops','workspace_a','Operações')");
    await db.query(
      `insert into people (id,workspace_id,name,role,status,created_by_profile_id,area_id,access_scope)
       values
        ('owner_legacy','workspace_a','Dono','owner','active','seed',null,'assigned_only'),
        ('manager_legacy','workspace_a','Gestor','manager','active','seed','area_ops','workspace'),
        ('employee_legacy','workspace_a','Funcionário','employee','active','seed','area_ops','workspace')`
    );

    await ensureOperationalSchema(db);

    const scopes = await db.query<{ id: string; access_scope: string }>(
      "select id,access_scope from people where workspace_id='workspace_a' order by id"
    );
    expect(scopes.rows).toEqual([
      { id: "employee_legacy", access_scope: "assigned_only" },
      { id: "manager_legacy", access_scope: "area" },
      { id: "owner_legacy", access_scope: "workspace" }
    ]);
  });

  it("adds metadata columns for uploaded task evidence", async () => {
    await ensureOperationalSchema(db);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='task_evidence' and column_name in ('file_name','content_type','size_bytes')`
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual(["content_type", "file_name", "size_bytes"]);
  });

  it("adds operational identity and multi-area access without changing the person key", async () => {
    await ensureOperationalSchema(db);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='people' and column_name in ('clerk_user_id','customer_id','access_scope')`
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
      "access_scope", "clerk_user_id", "customer_id"
    ]);

    await db.query("insert into areas (id,workspace_id,name) values ('area_finance','workspace_a','Financeiro')");
    await db.query(
      `insert into people (id,workspace_id,name,role,status,created_by_profile_id,area_id,clerk_user_id,customer_id,access_scope)
       values ('person_ana','workspace_a','Ana','manager','active','person_owner','area_finance','user_ana','customer_ana','area')`
    );
    await db.query(
      "insert into person_area_access (workspace_id,person_id,area_id) values ('workspace_a','person_ana','area_finance')"
    );
    await expect(db.query(
      `insert into people (id,workspace_id,name,role,status,created_by_profile_id,clerk_user_id)
       values ('person_duplicate','workspace_a','Outra','employee','active','person_owner','user_ana')`
    )).rejects.toThrow();
  });

  it("backfills the parent revision only for unsubmitted pending routine tasks", async () => {
    await ensureOperationalSchema(db);
    await db.query("delete from baase_schema_migrations where version = 6");
    await db.query(
      `insert into routines
        (id, workspace_id, title, status, frequency, created_by_profile_id)
       values ('routine_legacy', 'workspace_a', 'Rotina', 'active', 'on_demand', 'profile_owner')`
    );
    await db.query(
      `insert into routine_steps (id, workspace_id, routine_id, title, sort_order)
       values ('step_legacy', 'workspace_a', 'routine_legacy', 'Etapa', 1)`
    );
    await db.query(
      `insert into routine_occurrences
        (id, workspace_id, routine_id, due_date, audience_key, routine_title_snapshot,
         routine_updated_at_snapshot)
       values ('occurrence_legacy', 'workspace_a', 'routine_legacy', '2026-07-10',
         'shared', 'Rotina', '2026-07-11T09:00:00.000Z')`
    );
    await db.query(
      `insert into task_occurrences
        (id, workspace_id, origin, routine_id, routine_step_id, audience_key, title,
         routine_title_snapshot, step_title_snapshot, approval_mode, evidence_policy,
         status, due_date, submitted_at)
       values
        ('task_pending', 'workspace_a', 'routine', 'routine_legacy', 'step_legacy', 'shared',
         'Pendente', 'Rotina', 'Etapa', 'direct', 'optional', 'pending', '2026-07-10', null),
        ('task_submitted', 'workspace_a', 'routine', 'routine_legacy', 'step_legacy', 'shared',
         'Enviada', 'Rotina', 'Etapa', 'direct', 'optional', 'pending', '2026-07-10',
         '2026-07-10T09:00:00.000Z'),
        ('task_awaiting', 'workspace_a', 'routine', 'routine_legacy', 'step_legacy', 'shared',
         'Aguardando', 'Rotina', 'Etapa', 'direct', 'optional', 'awaiting_approval', '2026-07-10',
         '2026-07-10T09:00:00.000Z'),
        ('task_adjustment', 'workspace_a', 'routine', 'routine_legacy', 'step_legacy', 'shared',
         'Ajuste', 'Rotina', 'Etapa', 'direct', 'optional', 'needs_adjustment', '2026-07-10',
         '2026-07-10T09:00:00.000Z'),
        ('task_completed', 'workspace_a', 'routine', 'routine_legacy', 'step_legacy', 'shared',
         'Concluída', 'Rotina', 'Etapa', 'direct', 'optional', 'completed', '2026-07-10',
         '2026-07-10T09:00:00.000Z')`
    );

    await ensureOperationalSchema(db);

    const snapshots = await db.query<{ id: string; routine_revision_snapshot: Date | null }>(
      "select id, routine_revision_snapshot from task_occurrences where workspace_id='workspace_a' order by id"
    );
    expect(snapshots.rows.map((task) => ({
      id: task.id,
      hasSnapshot: task.routine_revision_snapshot !== null
    }))).toEqual([
      { id: "task_adjustment", hasSnapshot: false },
      { id: "task_awaiting", hasSnapshot: false },
      { id: "task_completed", hasSnapshot: false },
      { id: "task_pending", hasSnapshot: true },
      { id: "task_submitted", hasSnapshot: false }
    ]);
  });

  it("checks out and releases exactly one migration client", async () => {
    let checkouts = 0;
    let releases = 0;
    const trackedPool: OperationalSchemaPool = {
      async connect() {
        checkouts += 1;
        const client = await db.connect();
        const trackedClient: OperationalSchemaClient = {
          query<T = unknown>(text: string, params?: unknown[]) {
            return client.query(text, params) as unknown as Promise<{ rows: T[] }>;
          },
          release() {
            releases += 1;
            client.release();
          }
        };
        return trackedClient;
      }
    };

    await ensureOperationalSchema(trackedPool);

    expect(checkouts).toBe(1);
    expect(releases).toBe(1);
  });

  it("preserves the primary migration error when rollback also fails", async () => {
    const primary = new Error("primary schema failure") as ErrorWithCleanup;
    const rollback = new Error("schema rollback failure");
    const pool: OperationalSchemaPool = {
      async connect() {
        return {
          async query<T = unknown>(text: string) {
            if (text === "ROLLBACK") throw rollback;
            if (/pg_advisory_xact_lock/.test(text)) throw primary;
            return { rows: [] as T[] };
          },
          release() {}
        };
      }
    };

    await expect(ensureOperationalSchema(pool)).rejects.toBe(primary);
    expect(primary.cleanupErrors).toEqual([rollback]);
  });

  it("allows manual task provenance snapshots but never manual routine references", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      `insert into task_occurrences
        (id, workspace_id, origin, title, routine_title_snapshot, step_title_snapshot,
         approval_mode, evidence_policy, status, due_date)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10),
        ($11, $2, $3, $12, $13, $14, $7, $8, $9, $10)`,
      [
        "task_manual",
        "workspace_a",
        "manual",
        "Tarefa pontual",
        null,
        "Tarefa pontual",
        "direct",
        "optional",
        "pending",
        "2026-07-10",
        "task_historical",
        "Etapa preservada",
        "Rotina removida",
        "Etapa preservada"
      ]
    );
    const snapshots = await db.query<{ id: string; routine_title_snapshot: string | null }>(
      "select id, routine_title_snapshot from task_occurrences order by id"
    );
    expect(snapshots.rows).toEqual([
      { id: "task_historical", routine_title_snapshot: "Rotina removida" },
      { id: "task_manual", routine_title_snapshot: null }
    ]);
    await db.query(
      `insert into routines
        (id, workspace_id, title, status, frequency, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6)`,
      ["routine_valid", "workspace_a", "Rotina valida", "active", "on_demand", "profile_owner"]
    );
    await db.query(
      `insert into routine_steps
        (id, workspace_id, routine_id, title, sort_order)
       values ($1, $2, $3, $4, $5)`,
      ["step_valid", "workspace_a", "routine_valid", "Etapa valida", 1]
    );

    await expect(db.query(
      `insert into task_occurrences
        (id, workspace_id, origin, routine_id, routine_step_id, title,
         routine_title_snapshot, step_title_snapshot, approval_mode, evidence_policy,
         status, due_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        "task_invalid_manual",
        "workspace_a",
        "manual",
        "routine_valid",
        "step_valid",
        "Etapa preservada",
        "Rotina removida",
        "Etapa preservada",
        "direct",
        "optional",
        "pending",
        "2026-07-10"
      ]
    )).rejects.toThrow();
  });

  it("rejects drifted operational objects without recording migration version 1", async () => {
    await db.query(`
      create table baase_schema_migrations (
        version integer primary key,
        name text not null,
        applied_at timestamptz not null default now()
      )
    `);
    await db.query("create table areas (id text primary key)");

    await expect(ensureOperationalSchema(db)).rejects.toThrow();

    const migrations = await db.query<{ version: number }>(
      "select version from baase_schema_migrations order by version"
    );
    expect(migrations.rows).toEqual([]);
  });

  it("rejects a process that references an area in another workspace", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      "insert into areas (id, workspace_id, name) values ($1, $2, $3)",
      ["area_finance", "workspace_b", "Financeiro"]
    );

    await expect(db.query(
      `insert into processes
        (id, workspace_id, area_id, title, status, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6)`,
      ["process_close", "workspace_a", "area_finance", "Fechamento", "draft", "profile_a"]
    )).rejects.toThrow();
  });

  it("rejects duplicate routine occurrences for the same audience and due date", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      `insert into routines
        (id, workspace_id, title, status, frequency, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6)`,
      ["routine_opening", "workspace_a", "Abertura", "active", "on_demand", "profile_a"]
    );
    const occurrence = [
      "occurrence_opening",
      "workspace_a",
      "routine_opening",
      "2026-07-10",
      "all",
      "Abertura"
    ];
    await db.query(
      `insert into routine_occurrences
        (id, workspace_id, routine_id, due_date, audience_key, routine_title_snapshot)
       values ($1, $2, $3, $4, $5, $6)`,
      occurrence
    );

    await expect(db.query(
      `insert into routine_occurrences
        (id, workspace_id, routine_id, due_date, audience_key, routine_title_snapshot)
       values ($1, $2, $3, $4, $5, $6)`,
      ["occurrence_duplicate", ...occurrence.slice(1)]
    )).rejects.toThrow();
  });

  it("rejects a monthly routine without a month day", async () => {
    await ensureOperationalSchema(db);

    await expect(db.query(
      `insert into routines
        (id, workspace_id, title, status, frequency, month_day, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      ["routine_close", "workspace_a", "Fechamento", "active", "monthly", null, "profile_a"]
    )).rejects.toThrow();
  });

  it.each([
    ["daily", []],
    ["daily", ["mon", null, "wed"]],
    ["daily", ["mon", "mon"]],
    ["weekly", ["mon", "wed"]],
    ["weekly", ["funday"]]
  ])("rejects malformed %s weekday arrays: %j", async (frequency, weekdays) => {
    await ensureOperationalSchema(db);

    await expect(db.query(
      `insert into routines
        (id, workspace_id, title, status, frequency, weekdays, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6::text[], $7)`,
      ["routine_invalid", "workspace_a", "Invalida", "active", frequency, weekdays, "profile_a"]
    )).rejects.toThrow();
  });

  it.each([
    ["link", "\t\n", null, null, null],
    ["file", null, "\n\t", "application/pdf", 10],
    ["file", null, "object-key", "\t\n", 10]
  ])(
    "rejects whitespace-only %s process material fields",
    async (kind, url, objectKey, contentType, sizeBytes) => {
      await ensureOperationalSchema(db);
      await db.query(
        `insert into processes
          (id, workspace_id, title, status, created_by_profile_id)
         values ($1, $2, $3, $4, $5)`,
        ["process_close", "workspace_a", "Fechamento", "draft", "profile_a"]
      );

      await expect(db.query(
        `insert into process_materials
          (id, workspace_id, process_id, kind, title, url, object_key, content_type, size_bytes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          "material_close",
          "workspace_a",
          "process_close",
          kind,
          "Material",
          url,
          objectKey,
          contentType,
          sizeBytes
        ]
      )).rejects.toThrow();
    }
  );

  it("prevents hard-deleting a process that has a version", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      `insert into processes
        (id, workspace_id, title, status, created_by_profile_id)
       values ($1, $2, $3, $4, $5)`,
      ["process_close", "workspace_a", "Fechamento", "draft", "profile_a"]
    );
    await db.query(
      `insert into process_versions
        (id, workspace_id, process_id, version_number, title, body, change_note, editor_profile_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        "process_close_v1",
        "workspace_a",
        "process_close",
        1,
        "Fechamento",
        "Conferir e fechar o caixa.",
        "Versao inicial",
        "profile_a"
      ]
    );

    await expect(db.query(
      "delete from processes where workspace_id = $1 and id = $2",
      ["workspace_a", "process_close"]
    )).rejects.toThrow();
    const versions = await db.query<{ count: number }>(
      "select count(*)::int as count from process_versions where workspace_id = $1 and process_id = $2",
      ["workspace_a", "process_close"]
    );
    expect(versions.rows[0]?.count).toBe(1);
  });

  it("prevents hard-deleting a task occurrence with checklist history", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      `insert into task_occurrences
        (id, workspace_id, origin, title, step_title_snapshot, approval_mode,
         evidence_policy, status, due_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        "task_close",
        "workspace_a",
        "manual",
        "Fechar caixa",
        "Fechar caixa",
        "direct",
        "comment_required",
        "completed",
        "2026-07-10"
      ]
    );
    await db.query(
      `insert into task_checklist_items
        (id, workspace_id, task_occurrence_id, title, sort_order, is_completed)
       values ($1, $2, $3, $4, $5, $6)`,
      ["check_close", "workspace_a", "task_close", "Conferir saldo", 1, true]
    );

    await expect(db.query(
      "delete from task_occurrences where workspace_id = $1 and id = $2",
      ["workspace_a", "task_close"]
    )).rejects.toThrow();
    const checklistItems = await db.query<{ count: number }>(
      "select count(*)::int as count from task_checklist_items where workspace_id = $1 and task_occurrence_id = $2",
      ["workspace_a", "task_close"]
    );
    expect(checklistItems.rows[0]?.count).toBe(1);
  });

  it("prevents hard-deleting a task occurrence with evidence history", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      `insert into people
        (id, workspace_id, name, role, status, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6)`,
      ["profile_a", "workspace_a", "Ana", "employee", "active", "profile_owner"]
    );
    await db.query(
      `insert into task_occurrences
        (id, workspace_id, origin, title, step_title_snapshot, approval_mode,
         evidence_policy, status, due_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        "task_close",
        "workspace_a",
        "manual",
        "Fechar caixa",
        "Fechar caixa",
        "direct",
        "comment_required",
        "completed",
        "2026-07-10"
      ]
    );
    await db.query(
      `insert into task_evidence
        (id, workspace_id, task_occurrence_id, profile_id, kind, comment)
       values ($1, $2, $3, $4, $5, $6)`,
      ["evidence_close", "workspace_a", "task_close", "profile_a", "comment", "Conferido"]
    );

    await expect(db.query(
      "delete from task_occurrences where workspace_id = $1 and id = $2",
      ["workspace_a", "task_close"]
    )).rejects.toThrow();
    const evidence = await db.query<{ count: number }>(
      "select count(*)::int as count from task_evidence where workspace_id = $1 and task_occurrence_id = $2",
      ["workspace_a", "task_close"]
    );
    expect(evidence.rows[0]?.count).toBe(1);
  });

  it.each([
    ["", null],
    ["   ", null],
    ["\t\n", null],
    [null, ""],
    [null, "   "],
    [null, "\n\t"]
  ])("rejects blank photo evidence fields: photo_url=%j object_key=%j", async (photoUrl, objectKey) => {
    await ensureOperationalSchema(db);
    await db.query(
      `insert into people
        (id, workspace_id, name, role, status, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6)`,
      ["profile_a", "workspace_a", "Ana", "employee", "active", "profile_owner"]
    );
    await db.query(
      `insert into task_occurrences
        (id, workspace_id, origin, title, step_title_snapshot, approval_mode,
         evidence_policy, status, due_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        "task_close",
        "workspace_a",
        "manual",
        "Fechar caixa",
        "Fechar caixa",
        "direct",
        "photo_required",
        "pending",
        "2026-07-10"
      ]
    );

    await expect(db.query(
      `insert into task_evidence
        (id, workspace_id, task_occurrence_id, profile_id, kind, photo_url, object_key)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      ["evidence_close", "workspace_a", "task_close", "profile_a", "photo", photoUrl, objectKey]
    )).rejects.toThrow();
  });

  it("rejects a whitespace-only evidence comment", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      `insert into people
        (id, workspace_id, name, role, status, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6)`,
      ["profile_a", "workspace_a", "Ana", "employee", "active", "profile_owner"]
    );
    await db.query(
      `insert into task_occurrences
        (id, workspace_id, origin, title, step_title_snapshot, approval_mode,
         evidence_policy, status, due_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        "task_close",
        "workspace_a",
        "manual",
        "Fechar caixa",
        "Fechar caixa",
        "direct",
        "comment_required",
        "pending",
        "2026-07-10"
      ]
    );

    await expect(db.query(
      `insert into task_evidence
        (id, workspace_id, task_occurrence_id, profile_id, kind, comment)
       values ($1, $2, $3, $4, $5, $6)`,
      ["evidence_close", "workspace_a", "task_close", "profile_a", "comment", "\t\n"]
    )).rejects.toThrow();
  });

  it("rejects evidence owned by a task occurrence in another workspace", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      `insert into people
        (id, workspace_id, name, role, status, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6)`,
      ["profile_a", "workspace_a", "Ana", "employee", "active", "profile_owner"]
    );
    await db.query(
      `insert into task_occurrences
        (id, workspace_id, origin, title, step_title_snapshot, approval_mode,
         evidence_policy, status, due_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        "task_close",
        "workspace_b",
        "manual",
        "Fechar caixa",
        "Fechar caixa",
        "direct",
        "comment_required",
        "pending",
        "2026-07-10"
      ]
    );

    await expect(db.query(
      `insert into task_evidence
        (id, workspace_id, task_occurrence_id, profile_id, kind, comment)
       values ($1, $2, $3, $4, $5, $6)`,
      ["evidence_close", "workspace_a", "task_close", "profile_a", "comment", "Conferido"]
    )).rejects.toThrow();
  });
});
