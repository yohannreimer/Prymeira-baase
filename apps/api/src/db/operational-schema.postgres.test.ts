import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  ensureOperationalSchema,
  ensureOperationalSchemaThrough,
  type OperationalSchemaClient,
  type OperationalSchemaPool
} from "./operational-schema";

// Use an expendable PostgreSQL 16 database; each test creates and drops an isolated schema.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let schemaSequence = 0;

async function withPostgresSchema<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

  const adminPool = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 5_000 });
  const schemaName = `baase_operational_${process.pid}_${Date.now()}_${schemaSequence++}`;
  let pool: Pool | undefined;
  let schemaCreated = false;

  try {
    await adminPool.query(`CREATE SCHEMA ${schemaName}`);
    schemaCreated = true;
    pool = new Pool({
      connectionString: testDatabaseUrl,
      connectionTimeoutMillis: 5_000,
      options: `-c search_path=${schemaName}`
    });
    return await run(pool);
  } finally {
    try {
      if (pool) await pool.end();
      if (schemaCreated) await adminPool.query(`DROP SCHEMA ${schemaName} CASCADE`);
    } finally {
      await adminPool.end();
    }
  }
}

async function createMigrationLedger(pool: Pool) {
  await pool.query(`
    create table baase_schema_migrations (
      version integer primary key,
      name text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

describe.skipIf(!testDatabaseUrl)("operational schema on PostgreSQL 16", () => {
  it("runs against PostgreSQL major version 16", async () => {
    await withPostgresSchema(async (pool) => {
      const result = await pool.query<{ server_version_num: string }>("show server_version_num");
      const serverVersion = Number(result.rows[0]?.server_version_num);
      expect(serverVersion).toBeGreaterThanOrEqual(160_000);
      expect(serverVersion).toBeLessThan(170_000);
    });
  });

  it("serializes concurrent startup and remains repeatable", async () => {
    await withPostgresSchema(async (pool) => {
      await Promise.all([ensureOperationalSchema(pool), ensureOperationalSchema(pool)]);
      await ensureOperationalSchema(pool);

      const result = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(result.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  it("checks out and releases one real PoolClient", async () => {
    await withPostgresSchema(async (pool) => {
      let checkouts = 0;
      let releases = 0;
      const trackedPool: OperationalSchemaPool = {
        async connect() {
          checkouts += 1;
          const client = await pool.connect();
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
  });

  it("creates representative child foreign-key and audit indexes", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);

      const result = await pool.query<{ indexname: string }>(
        "select indexname from pg_indexes where schemaname = current_schema()"
      );
      const indexNames = result.rows.map((row) => row.indexname);
      expect(indexNames).toEqual(expect.arrayContaining([
        "people_area_idx",
        "process_materials_process_idx",
        "routine_assignments_step_idx",
        "task_occurrences_assignee_due_idx",
        "task_evidence_task_idx",
        "operational_audit_entity_idx",
        "studio_documents_owner_updated_idx",
        "studio_documents_owner_inbox_state_idx",
        "studio_documents_owner_focused_idx",
        "studio_documents_owner_status_idx",
        "studio_documents_owner_search_idx",
        "studio_assets_document_idx",
        "studio_collection_items_collection_idx"
      ]));
    });
  });

  it("creates and plans against the Studio lexical GIN index", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      const index = await pool.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
         where schemaname=current_schema() and indexname='studio_documents_owner_search_idx'`
      );
      expect(index.rows[0]?.indexdef.toLowerCase()).toContain("using gin");
      expect(index.rows[0]?.indexdef.toLowerCase()).toContain("search_tokens");

      await pool.query(
        `insert into studio_documents
          (id,workspace_id,owner_profile_id,body_json,body_text,search_tokens,capture_mode)
         select
           'search_document_' || sequence,
           'workspace_a',
           'owner_a',
           '{}'::jsonb,
           case when sequence=2000 then 'expansao sustentavel' else 'conteudo comum ' || sequence end,
           case when sequence=2000
             then array['expansao','sustentavel']::text[]
             else array['conteudo','comum',sequence::text]::text[]
           end,
           'text'
         from generate_series(1,2000) as sequence`
      );
      await pool.query("analyze studio_documents");
      await pool.query("set enable_seqscan=off");
      const explained = await pool.query<{ "QUERY PLAN": string }>(
        `explain (format text)
         select id from studio_documents
         where workspace_id='workspace_a' and owner_profile_id='owner_a' and status='active'
           and search_tokens @> array['expansao']::text[]`
      );
      expect(explained.rows.map((row) => row["QUERY PLAN"]).join("\n"))
        .toContain("studio_documents_owner_search_idx");
    });
  });

  it("rejects collection membership across owner scopes", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      await pool.query(
        `insert into studio_documents
          (id, workspace_id, owner_profile_id, body_json, body_text, capture_mode)
         values ('document_b', 'workspace_a', 'owner_b', '{}'::jsonb, 'Privado', 'text')`
      );
      await pool.query(
        `insert into studio_collections (id, workspace_id, owner_profile_id, name)
         values ('collection_a', 'workspace_a', 'owner_a', 'Privada A')`
      );

      await expect(pool.query(
        `insert into studio_collection_items
          (id, workspace_id, owner_profile_id, collection_id, document_id)
         values ('item_cross_owner', 'workspace_a', 'owner_a', 'collection_a', 'document_b')`
      )).rejects.toMatchObject({ code: "23503" });
    });
  });

  it("rejects assets that reference documents across owner scopes", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      await pool.query(
        `insert into studio_documents
          (id, workspace_id, owner_profile_id, body_json, body_text, capture_mode)
         values ('document_b', 'workspace_a', 'owner_b', '{}'::jsonb, 'Privado', 'text')`
      );

      await expect(pool.query(
        `insert into studio_assets
          (id, workspace_id, owner_profile_id, document_id, kind, display_name,
           object_key, mime_type, size_bytes)
         values ('asset_a', 'workspace_a', 'owner_a', 'document_b', 'file', 'Plano.pdf',
           'studio/asset-a', 'application/pdf', 42)`
      )).rejects.toMatchObject({ code: "23503" });
    });
  });

  it("allows manual task provenance snapshots but never manual routine references", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      await pool.query(
        `insert into task_occurrences
          (id, workspace_id, origin, title, routine_title_snapshot, step_title_snapshot,
           approval_mode, evidence_policy, status, due_date)
         values
          ('task_manual', 'workspace_a', 'manual', 'Tarefa pontual', null,
           'Tarefa pontual', 'direct', 'optional', 'pending', '2026-07-10'),
          ('task_historical', 'workspace_a', 'manual', 'Etapa preservada',
           'Rotina removida', 'Etapa preservada', 'direct', 'optional', 'pending',
           '2026-07-10')`
      );
      const snapshots = await pool.query<{ id: string; routine_title_snapshot: string | null }>(
        "select id, routine_title_snapshot from task_occurrences order by id"
      );
      expect(snapshots.rows).toEqual([
        { id: "task_historical", routine_title_snapshot: "Rotina removida" },
        { id: "task_manual", routine_title_snapshot: null }
      ]);
      await pool.query(
        `insert into routines
          (id, workspace_id, title, status, frequency, created_by_profile_id)
         values (
           'routine_valid', 'workspace_a', 'Rotina valida', 'active', 'on_demand',
           'profile_owner'
         )`
      );
      await pool.query(
        `insert into routine_steps
          (id, workspace_id, routine_id, title, sort_order)
         values ('step_valid', 'workspace_a', 'routine_valid', 'Etapa valida', 1)`
      );

      await expect(pool.query(
        `insert into task_occurrences
          (id, workspace_id, origin, routine_id, routine_step_id, title,
           routine_title_snapshot, step_title_snapshot, approval_mode, evidence_policy,
           status, due_date)
         values (
           'task_invalid_manual', 'workspace_a', 'manual', 'routine_valid', 'step_valid',
           'Etapa preservada', 'Rotina removida', 'Etapa preservada', 'direct',
           'optional', 'pending', '2026-07-10'
         )`
      )).rejects.toThrow();
    });
  });

  it("upgrades an existing version 1 database through version 2", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      await pool.query(
        "alter table task_occurrences drop constraint task_occurrences_origin_references_check"
      );
      await pool.query(`
        alter table task_occurrences add check (
          (origin = 'manual' and routine_id is null and routine_step_id is null
            and routine_title_snapshot is null)
          or
          (origin = 'routine' and routine_id is not null and routine_step_id is not null
            and audience_key is not null and routine_title_snapshot is not null)
        )
      `);
      await pool.query("delete from baase_schema_migrations where version = 2");

      const before = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(before.rows.map((row) => row.version)).toEqual([1, 3, 4, 5, 6, 7, 8, 9]);
      const oldConstraint = await pool.query<{ conname: string }>(
        `select conname
         from pg_constraint
         where conrelid = 'task_occurrences'::regclass
           and conname = 'task_occurrences_check'`
      );
      expect(oldConstraint.rows).toEqual([{ conname: "task_occurrences_check" }]);

      await ensureOperationalSchema(pool);

      const after = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(after.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const upgradedConstraint = await pool.query<{ conname: string }>(
        `select conname
         from pg_constraint
         where conrelid = 'task_occurrences'::regclass
           and conname = 'task_occurrences_origin_references_check'`
      );
      expect(upgradedConstraint.rows).toEqual([{
        conname: "task_occurrences_origin_references_check"
      }]);
      await pool.query(
        `insert into task_occurrences
          (id, workspace_id, origin, title, routine_title_snapshot, step_title_snapshot,
           approval_mode, evidence_policy, status, due_date)
         values (
           'task_historical_upgrade', 'workspace_a', 'manual', 'Etapa preservada',
           'Rotina removida', 'Etapa preservada', 'direct', 'optional', 'pending',
           '2026-07-10'
         )`
      );
    });
  });

  it("upgrades versions 1 and 2 through runtime compatibility version 3", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 2);
      const before = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(before.rows.map((row) => row.version)).toEqual([1, 2]);
      const v2Catalog = await pool.query<{ archived_steps: boolean; archived_evidence: boolean; people_fks: number }>(
        `select
          exists (select 1 from information_schema.columns where table_schema=current_schema() and table_name='routine_steps' and column_name='archived_at') archived_steps,
          exists (select 1 from information_schema.columns where table_schema=current_schema() and table_name='task_evidence' and column_name='archived_at') archived_evidence,
          (select count(*)::int from pg_constraint where contype='f'
            and conrelid in ('task_occurrences'::regclass, 'task_evidence'::regclass)
            and confrelid='people'::regclass) people_fks`
      );
      expect(v2Catalog.rows[0]).toEqual({ archived_steps: false, archived_evidence: false, people_fks: 2 });

      await ensureOperationalSchema(pool);

      const versions = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(versions.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const v3Catalog = await pool.query<{ archived_steps: boolean; archived_evidence: boolean; source_key: boolean; revision_snapshot: boolean; people_fks: number; active_order_index: boolean }>(
        `select
          exists (select 1 from information_schema.columns where table_schema=current_schema() and table_name='routine_steps' and column_name='archived_at') archived_steps,
          exists (select 1 from information_schema.columns where table_schema=current_schema() and table_name='task_evidence' and column_name='archived_at') archived_evidence,
          exists (select 1 from information_schema.columns where table_schema=current_schema() and table_name='task_occurrences' and column_name='source_template_key') source_key,
          exists (select 1 from information_schema.columns where table_schema=current_schema() and table_name='routine_occurrences' and column_name='routine_updated_at_snapshot') revision_snapshot,
          (select count(*)::int from pg_constraint where contype='f'
            and conrelid in ('task_occurrences'::regclass, 'task_evidence'::regclass)
            and confrelid='people'::regclass) people_fks,
          to_regclass('routine_steps_active_order_uidx') is not null active_order_index`
      );
      expect(v3Catalog.rows[0]).toEqual({
        archived_steps: true,
        archived_evidence: true,
        source_key: true,
        revision_snapshot: true,
        people_fks: 0,
        active_order_index: true
      });
    });
  });

  it("upgrades a genuine version 3 schema to active-only company uniqueness", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 3);
      const before = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(before.rows.map((row) => row.version)).toEqual([1, 2, 3]);

      await ensureOperationalSchema(pool);

      const after = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(after.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const catalog = await pool.query<{ full_constraints: number; partial_indexes: number }>(
        `select
          (select count(*)::int from pg_constraint c join pg_namespace n on n.oid=c.connamespace
            where n.nspname=current_schema() and c.conname in (
              'areas_workspace_id_name_key',
              'role_templates_workspace_id_area_id_name_key',
              'people_workspace_id_email_key'
            )) full_constraints,
          (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname=current_schema() and c.relkind='i' and c.relname in (
              'areas_active_name_uidx',
              'role_templates_active_name_uidx',
              'people_active_email_uidx'
            )) partial_indexes`
      );
      expect(catalog.rows[0]).toEqual({ full_constraints: 0, partial_indexes: 3 });
    });
  });

  it("backfills the parent revision only for unsubmitted pending routine tasks", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 5);
      await pool.query(
        `insert into routines
          (id, workspace_id, title, status, frequency, created_by_profile_id)
         values ('routine_legacy', 'workspace_a', 'Rotina', 'active', 'on_demand', 'profile_owner')`
      );
      await pool.query(
        `insert into routine_steps (id, workspace_id, routine_id, title, sort_order)
         values ('step_legacy', 'workspace_a', 'routine_legacy', 'Etapa', 1)`
      );
      await pool.query(
        `insert into routine_occurrences
          (id, workspace_id, routine_id, due_date, audience_key, routine_title_snapshot,
           routine_updated_at_snapshot)
         values ('occurrence_legacy', 'workspace_a', 'routine_legacy', '2026-07-10',
           'shared', 'Rotina', '2026-07-11T09:00:00.000Z')`
      );
      await pool.query(
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

      await ensureOperationalSchema(pool);

      const snapshots = await pool.query<{ id: string; has_snapshot: boolean }>(
        `select id, routine_revision_snapshot is not null as has_snapshot
         from task_occurrences where workspace_id='workspace_a' order by id`
      );
      expect(snapshots.rows).toEqual([
        { id: "task_adjustment", has_snapshot: false },
        { id: "task_awaiting", has_snapshot: false },
        { id: "task_completed", has_snapshot: false },
        { id: "task_pending", has_snapshot: true },
        { id: "task_submitted", has_snapshot: false }
      ]);
    });
  });

  it("allows account actors without shadow people rows", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      await pool.query(
        `insert into task_occurrences
          (id, workspace_id, origin, title, step_title_snapshot, approval_mode,
           evidence_policy, status, due_date, assignee_profile_id, submitted_by_profile_id)
         values ('task_account', 'workspace_a', 'manual', 'Tarefa', 'Tarefa', 'direct',
           'optional', 'pending', '2026-07-10', 'account_owner', 'account_owner')`
      );
      await pool.query(
        `insert into task_evidence
          (id, workspace_id, task_occurrence_id, profile_id, kind, comment)
         values ('evidence_account', 'workspace_a', 'task_account', 'account_owner',
           'comment', 'feito')`
      );
    });
  });

  it("does not mark version 2 when its alter fails", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      await pool.query("delete from baase_schema_migrations where version = 2");

      await expect(ensureOperationalSchema(pool)).rejects.toThrow();

      const migrations = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(migrations.rows.map((row) => row.version)).toEqual([1, 3, 4, 5, 6, 7, 8, 9]);
      const stableConstraint = await pool.query<{ count: number }>(
        `select count(*)::int as count
         from pg_constraint
         where conrelid = 'task_occurrences'::regclass
           and conname = 'task_occurrences_origin_references_check'`
      );
      expect(stableConstraint.rows[0]?.count).toBe(1);
    });
  });

  it("rolls back partial DDL and does not record a failed migration", async () => {
    await withPostgresSchema(async (pool) => {
      await createMigrationLedger(pool);
      await pool.query("create table processes (id text primary key)");

      await expect(ensureOperationalSchema(pool)).rejects.toThrow();

      const result = await pool.query<{ count: number; areas: string | null }>(
        `select
          (select count(*)::int from baase_schema_migrations) as count,
          to_regclass('areas')::text as areas`
      );
      expect(result.rows[0]).toEqual({ count: 0, areas: null });
    });
  });

  it("rejects a drifted areas table without recording version 1", async () => {
    await withPostgresSchema(async (pool) => {
      await createMigrationLedger(pool);
      await pool.query("create table areas (id text primary key)");

      await expect(ensureOperationalSchema(pool)).rejects.toThrow();

      const result = await pool.query("select version from baase_schema_migrations");
      expect(result.rows).toEqual([]);
    });
  });

  it("rejects malformed weekday arrays", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      const malformed = [
        ["daily", []],
        ["daily", ["mon", null, "wed"]],
        ["daily", ["mon", "mon"]],
        ["weekly", ["mon", "wed"]],
        ["weekly", ["unknown"]]
      ];

      for (const [index, [frequency, weekdays]] of malformed.entries()) {
        await expect(pool.query(
          `insert into routines
            (id, workspace_id, title, status, frequency, weekdays, created_by_profile_id)
           values ($1, $2, $3, $4, $5, $6::text[], $7)`,
          [`routine_${index}`, "workspace_a", "Invalida", "active", frequency, weekdays, "profile_a"]
        )).rejects.toThrow();
      }
    });
  });

  it("rejects empty and whitespace-only photo evidence", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      await pool.query(
        `insert into people
          (id, workspace_id, name, role, status, created_by_profile_id)
         values ('profile_a', 'workspace_a', 'Ana', 'employee', 'active', 'profile_owner')`
      );
      await pool.query(
        `insert into task_occurrences
          (id, workspace_id, origin, title, step_title_snapshot, approval_mode,
           evidence_policy, status, due_date)
         values (
           'task_close', 'workspace_a', 'manual', 'Fechar caixa', 'Fechar caixa',
           'direct', 'photo_required', 'pending', '2026-07-10'
         )`
      );
      const blankEvidence = [
        ["", null],
        ["   ", null],
        ["\t\n", null],
        [null, ""],
        [null, "   "],
        [null, "\n\t"]
      ];

      for (const [index, [photoUrl, objectKey]] of blankEvidence.entries()) {
        await expect(pool.query(
          `insert into task_evidence
            (id, workspace_id, task_occurrence_id, profile_id, kind, photo_url, object_key)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [`evidence_${index}`, "workspace_a", "task_close", "profile_a", "photo", photoUrl, objectKey]
        )).rejects.toThrow();
      }
    });
  });

  it("rejects whitespace-only material and comment fields", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      await pool.query(
        `insert into processes
          (id, workspace_id, title, status, created_by_profile_id)
         values ('process_close', 'workspace_a', 'Fechamento', 'draft', 'profile_a')`
      );
      const invalidMaterials = [
        ["link", "\t\n", null, null, null],
        ["file", null, "\n\t", "application/pdf", 10],
        ["file", null, "object-key", "\t\n", 10]
      ];

      for (const [index, [kind, url, objectKey, contentType, sizeBytes]] of invalidMaterials.entries()) {
        await expect(pool.query(
          `insert into process_materials
            (id, workspace_id, process_id, kind, title, url, object_key, content_type, size_bytes)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            `material_${index}`,
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

      await pool.query(
        `insert into people
          (id, workspace_id, name, role, status, created_by_profile_id)
         values ('profile_a', 'workspace_a', 'Ana', 'employee', 'active', 'profile_owner')`
      );
      await pool.query(
        `insert into task_occurrences
          (id, workspace_id, origin, title, step_title_snapshot, approval_mode,
           evidence_policy, status, due_date)
         values (
           'task_close', 'workspace_a', 'manual', 'Fechar caixa', 'Fechar caixa',
           'direct', 'comment_required', 'pending', '2026-07-10'
         )`
      );
      await expect(pool.query(
        `insert into task_evidence
          (id, workspace_id, task_occurrence_id, profile_id, kind, comment)
         values ('evidence_comment', 'workspace_a', 'task_close', 'profile_a', 'comment', $1)`,
        ["\t\n"]
      )).rejects.toThrow();
    });
  });
});
