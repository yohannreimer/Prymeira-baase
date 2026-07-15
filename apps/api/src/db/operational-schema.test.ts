import { DataType, newDb } from "pg-mem";
import type { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureOperationalSchema,
  ensureOperationalSchemaThrough,
  STUDIO_MIGRATION_LEDGER_RESERVATIONS,
  type OperationalSchemaClient,
  type OperationalSchemaPool
} from "./operational-schema";
import type { ErrorWithCleanup } from "./migration-cleanup-errors";
import type { OperationalPool } from "./operational-repository-support";
import { createPostgresStudioRepository } from "../modules/studio/postgres-studio.repository";

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

    expect(result.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
  });

  it("creates owner-scoped Studio tables", async () => {
    await ensureOperationalSchema(db);
    const tables = await db.query<{ table_name: string }>(
      `select distinct table_name from information_schema.tables
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
    const searchColumns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_documents'
         and column_name in (
           'search_tokens','search_prefix_tokens','search_title_folded','search_body_folded'
         )`
    );
    expect(searchColumns.rows.map((row) => row.column_name).sort()).toEqual([
      "search_body_folded",
      "search_prefix_tokens",
      "search_title_folded",
      "search_tokens"
    ]);
  });

  it("adds checkpoint metadata and trash lifecycle columns in migration 27", async () => {
    await ensureOperationalSchema(db);

    const [versionColumns, documentColumns] = await Promise.all([
      db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_name='studio_document_versions'
           and column_name in ('title','checkpoint_reason','source_revision','is_legacy')`
      ),
      db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_name='studio_documents'
           and column_name in ('trashed_at','pre_trash_status')`
      )
    ]);

    expect(versionColumns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      "title", "checkpoint_reason", "source_revision", "is_legacy"
    ]));
    expect(documentColumns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      "trashed_at", "pre_trash_status"
    ]));

    await db.query(`insert into studio_documents
      (id,workspace_id,owner_profile_id,body_json,body_text,capture_mode)
      values ('checkpoint_document','workspace','owner','{}','', 'text')`);
    await db.query(`insert into studio_document_versions
      (id,workspace_id,owner_profile_id,document_id,version_number,body_json,body_text,origin,actor_profile_id)
      values ('legacy_checkpoint','workspace','owner','checkpoint_document',1,'{}','', 'user','owner')`);
    const defaults = await db.query<{ checkpoint_reason: string; is_legacy: boolean }>(
      "select checkpoint_reason,is_legacy from studio_document_versions where id='legacy_checkpoint'"
    );
    expect(defaults.rows).toEqual([{ checkpoint_reason: "legacy_autosave", is_legacy: true }]);

    const source = readFileSync(resolve(__dirname, "operational-schema.ts"), "utf8");
    const migration27 = source.slice(source.indexOf("  version: 27,"));
    expect(migration27).toContain("DROP CONSTRAINT IF EXISTS studio_documents_status_check");
    expect(migration27).toContain("CHECK (status IN ('active','archived','trashed'))");
  });

  it("keeps the owner Studio lexical GIN index in migration 9", async () => {
    const statements: string[] = [];
    const observedPool: OperationalSchemaPool = {
      async connect() {
        const client = await db.connect();
        return {
          query<T = unknown>(text: string, params?: unknown[]) {
            statements.push(text);
            return client.query(text, params) as unknown as Promise<{ rows: T[] }>;
          },
          release() {
            client.release();
          }
        };
      }
    };

    await ensureOperationalSchema(observedPool);

    const migrationSql = statements.join("\n").toLowerCase();
    expect(migrationSql).toContain("create index studio_documents_owner_search_idx");
    expect(migrationSql).toContain("create index studio_documents_owner_search_prefix_idx");
    expect(migrationSql).toContain("using gin");
    expect(migrationSql).toContain("search_tokens");
  });

  it("keeps owner-filtered Studio structure lifecycle, cursor, and next-run indexes in migration 16", async () => {
    const statements: string[] = [];
    const observedPool: OperationalSchemaPool = {
      async connect() {
        const client = await db.connect();
        return {
          query<T = unknown>(text: string, params?: unknown[]) {
            statements.push(text);
            return client.query(text, params) as unknown as Promise<{ rows: T[] }>;
          },
          release() { client.release(); }
        };
      }
    };
    await ensureOperationalSchemaThrough(observedPool, 16);
    const sql = statements.join("\n").toLowerCase();
    expect(sql).toContain("create unique index studio_structures_active_kind_uidx");
    expect(sql).toContain("create index studio_structures_owner_cursor_idx");
    expect(sql).toContain("create index studio_structures_owner_kind_cursor_idx");
    expect(sql).toContain("on studio_structures (workspace_id,owner_profile_id,kind,created_at desc,id desc)");
    expect(sql).toContain("create index studio_structures_owner_kind_lifecycle_cursor_idx");
    expect(sql).toContain("create index studio_structures_owner_lifecycle_cursor_idx");
    expect(sql).toContain("create index studio_structures_next_run_idx");
  });

  it("adds owner-scoped ritual sessions and fences one open session in migration 17", async () => {
    const statements: string[] = [];
    const observedPool: OperationalSchemaPool = {
      async connect() {
        const client = await db.connect();
        return {
          query<T = unknown>(text: string, params?: unknown[]) {
            statements.push(text);
            return client.query(text, params) as unknown as Promise<{ rows: T[] }>;
          },
          release() { client.release(); }
        };
      }
    };
    await ensureOperationalSchemaThrough(observedPool, 17);
    const sql = statements.join("\n").toLowerCase();
    expect(sql).toContain("create table studio_ritual_sessions");
    expect(sql).toContain("foreign key (workspace_id,owner_profile_id,ritual_id)");
    expect(sql).toContain("create unique index studio_ritual_sessions_open_uidx");
    expect(sql).toContain("where status in ('preparing','ready','in_progress','failed')");
    expect(sql).toContain("create index studio_ritual_sessions_ritual_cursor_idx");
    expect(sql).not.toContain("synthesis_token");
    expect(sql).not.toContain("synthesis_lease_expires_at");
    expect(sql).not.toContain("synthesis_failure_code");
  });

  it("upgrades the exact migration 17 ritual shape through additive migration 22", async () => {
    await ensureOperationalSchemaThrough(db, 17);
    const before = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_ritual_sessions'
         and column_name in ('synthesis_token','synthesis_lease_expires_at','synthesis_failure_code')`
    );
    expect(before.rows).toEqual([]);

    await ensureOperationalSchema(db);
    await ensureOperationalSchema(db);
    const after = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_ritual_sessions'
         and column_name in ('synthesis_token','synthesis_lease_expires_at','synthesis_failure_code')
       order by column_name`
    );
    expect(after.rows.map((row) => row.column_name)).toEqual([
      "synthesis_failure_code", "synthesis_lease_expires_at", "synthesis_token"
    ]);
    const version = await db.query<{ name: string }>(
      "select name from baase_schema_migrations where version=22"
    );
    expect(version.rows).toEqual([{ name: "studio_ritual_session_synthesis_retry" }]);
  });

  it("defines migration 22 as an idempotent additive ritual-session upgrade", async () => {
    const statements: string[] = [];
    const observedPool: OperationalSchemaPool = {
      async connect() {
        const client = await db.connect();
        return {
          query<T = unknown>(text: string, params?: unknown[]) {
            statements.push(text);
            return client.query(text, params) as unknown as Promise<{ rows: T[] }>;
          },
          release() { client.release(); }
        };
      }
    };
    await ensureOperationalSchema(observedPool);
    const sql = statements.join("\n").toLowerCase();
    expect(sql).toContain("add column if not exists synthesis_token text");
    expect(sql).toContain("add column if not exists synthesis_lease_expires_at timestamptz");
    expect(sql).toContain("add column if not exists synthesis_failure_code text");
    expect(sql).toContain("drop constraint if exists studio_ritual_sessions_synthesis_claim_pair_ck");
    expect(sql).toContain("add constraint studio_ritual_sessions_ready_preparation_ck");
    expect(sql).toContain("add constraint studio_ritual_sessions_synthesis_output_state_ck");
  });

  it("adds owner-scoped idempotent operation previews and durable origin links in migration 18", async () => {
    const statements: string[] = [];
    const observedPool: OperationalSchemaPool = {
      async connect() {
        const client = await db.connect();
        return {
          query<T = unknown>(text: string, params?: unknown[]) {
            statements.push(text);
            return client.query(text, params) as unknown as Promise<{ rows: T[] }>;
          },
          release() { client.release(); }
        };
      }
    };
    await ensureOperationalSchema(observedPool);
    const sql = statements.join("\n").toLowerCase();
    expect(sql).toContain("create table studio_operation_previews");
    expect(sql).toContain("create table studio_operational_links");
    expect(sql).toContain("source_suggestion_id text not null");
    expect(sql).toContain("confirmed_payload_json jsonb");
    expect(sql).toContain("idempotency_key text");
    expect(sql).toContain("intended_resource_id text");
    expect(sql).toContain("result_resource_id text");
    expect(sql).toContain("intended_resource_id=result_resource_id");
    expect(sql).toContain("intended_resource_id is not null");
    expect(sql).toContain("claim_token text");
    expect(sql).toContain("create unique index studio_operation_previews_idempotency_uidx");
    expect(sql).toContain("unique (workspace_id,owner_profile_id,preview_id)");
    expect(sql).toContain("create index studio_operational_links_resource_idx");
  });

  it("keeps Studio asset extraction and link snapshot state in migration 9", async () => {
    await ensureOperationalSchema(db);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_assets' and column_name in (
         'extraction_status','extracted_text','extraction_metadata','last_error_code',
         'attempt_count','next_attempt_at','final_url','fetched_at'
       ) order by column_name`
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "attempt_count",
      "extracted_text",
      "extraction_metadata",
      "extraction_status",
      "fetched_at",
      "final_url",
      "last_error_code",
      "next_attempt_at"
    ]);
  });

  it("adds lease, lifecycle, and durable cleanup state in migration 10", async () => {
    await ensureOperationalSchema(db);
    const assetColumns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_assets'
         and column_name in ('claim_token','lease_expires_at','lifecycle_status')
       order by column_name`
    );
    expect(assetColumns.rows.map((row) => row.column_name)).toEqual([
      "claim_token", "lease_expires_at", "lifecycle_status"
    ]);
    const cleanupTable = await db.query<{ table_name: string }>(
      `select distinct table_name from information_schema.tables
       where table_name='studio_asset_cleanup_jobs'`
    );
    expect(cleanupTable.rows).toEqual([{ table_name: "studio_asset_cleanup_jobs" }]);
  });

  it("adds durable Studio upload intents in migration 11", async () => {
    await ensureOperationalSchema(db);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_asset_upload_intents'
         and column_name in ('object_key','status','asset_id','claim_token','lease_expires_at')`
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
      "asset_id", "claim_token", "lease_expires_at", "object_key", "status"
    ]);
  });

  it("adds active upload lease fields in additive migration 12", async () => {
    await ensureOperationalSchema(db);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_asset_upload_intents'
         and column_name in ('upload_token','upload_lease_expires_at')
       order by column_name`
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "upload_lease_expires_at", "upload_token"
    ]);
  });

  it("adds atomic storage session fields in additive migration 13", async () => {
    await ensureOperationalSchema(db);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_asset_upload_intents'
         and column_name in ('storage_upload_id','storage_session_state')
       order by column_name`
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "storage_session_state", "storage_upload_id"
    ]);
  });

  it("applies reserved Studio migrations 14 through 19 and keeps additive migrations 20 through 27", async () => {
    expect(STUDIO_MIGRATION_LEDGER_RESERVATIONS).toEqual({
      14: "studio_relations_and_index_jobs",
      15: "studio_conversations_messages_suggestions_citations",
      16: "studio_structures",
      17: "studio_ritual_sessions",
      18: "studio_operation_previews_and_links",
      19: "studio_proactivity_settings_and_signals",
      23: "studio_owner_portability_and_erasure",
      25: "studio_operation_preview_strict_durable_identity",
      26: "studio_portability_async_exports"
    });
    await ensureOperationalSchema(db);
    const assetColumns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_assets' and column_name='idempotency_key'`
    );
    expect(assetColumns.rows).toEqual([{ column_name: "idempotency_key" }]);
    const documentColumns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_documents' and column_name='capture_key'`
    );
    expect(documentColumns.rows).toEqual([{ column_name: "capture_key" }]);
    const versions = await db.query<{ version: number }>(
      "select version from baase_schema_migrations where version between 14 and 22 order by version"
    );
    expect(versions.rows).toEqual([
      { version: 14 }, { version: 15 }, { version: 16 }, { version: 17 }, { version: 18 },
      { version: 19 }, { version: 20 }, { version: 21 }, { version: 22 }
    ]);
    const structureColumns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name='studio_structures'
       and column_name in ('revision','horizon_at','metric_json','cadence_json','next_run_at','properties_json')`
    );
    expect(structureColumns.rows.map((row) => row.column_name).sort()).toEqual([
      "cadence_json", "horizon_at", "metric_json", "next_run_at", "properties_json", "revision"
    ]);
    const studioTables = await db.query<{ table_name: string }>(
      `select distinct table_name from information_schema.tables
       where table_name in ('studio_relations','studio_index_jobs') order by table_name`
    );
    expect(studioTables.rows.map((row) => row.table_name)).toEqual([
      "studio_index_jobs", "studio_relations"
    ]);
  });

  it("creates private proactivity settings, retry-safe signals, and due ritual indexes in migration 19", async () => {
    await ensureOperationalSchema(db);
    const tables = await db.query<{ table_name: string }>(
      `select distinct table_name from information_schema.tables
       where table_name in ('studio_proactivity_settings','studio_proactive_signals') order by table_name`
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "studio_proactive_signals", "studio_proactivity_settings"
    ]);
    const signalColumns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_proactive_signals'
         and column_name in ('claim_token','claim_lease_expires_at','attempt_count','next_attempt_at','next_reminder_at')`
    );
    expect(signalColumns.rows.map((row) => row.column_name).sort()).toEqual([
      "attempt_count", "claim_lease_expires_at", "claim_token", "next_attempt_at", "next_reminder_at"
    ]);
  });

  it("adds owner-scoped portability markers and a retained-link tombstone in migration 23", async () => {
    await ensureOperationalSchema(db);
    const tables = await db.query<{ table_name: string }>(
      `select distinct table_name from information_schema.tables
       where table_name in (
         'studio_portability_exports','studio_portability_delete_requests','studio_portability_object_deletions'
       ) order by table_name`
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "studio_portability_delete_requests", "studio_portability_exports", "studio_portability_object_deletions"
    ]);
    const tombstone = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_operational_links' and column_name='source_deleted_at'`
    );
    expect(tombstone.rows).toEqual([{ column_name: "source_deleted_at" }]);
  });

  it("upgrades portability exports to an asynchronous leased queue in migration 26", async () => {
    await ensureOperationalSchemaThrough(db, 26);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_portability_exports'
         and column_name in ('claim_token','claim_lease_expires_at','failure_code','ready_at','expired_at')`
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
      "claim_lease_expires_at", "claim_token", "expired_at", "failure_code", "ready_at"
    ]);
    const source = readFileSync(resolve(process.cwd(), "src/db/operational-schema.ts"), "utf8");
    const migration26 = source.slice(source.indexOf("  version: 26,"));
    expect(migration26).toContain("UPDATE studio_portability_exports SET status='pending' WHERE status='preparing'");
    expect(migration26).toContain("status IN ('pending','processing','ready','failed','expired')");
  });

  it("creates relational owner-scoped assistant state with citation identity constraints", async () => {
    await ensureOperationalSchema(db);
    const tables = await db.query<{ table_name: string }>(
      `select distinct table_name from information_schema.tables
       where table_name in ('studio_conversations','studio_messages','studio_suggestions','studio_citations')
       order by table_name`
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "studio_citations", "studio_conversations", "studio_messages", "studio_suggestions"
    ]);
    await db.query(
      `insert into studio_documents
        (id,workspace_id,owner_profile_id,body_json,body_text,capture_mode)
       values ('document_a','workspace_a','owner_a','{}','private','text')`
    );
    await db.query(
      `insert into studio_conversations (id,workspace_id,owner_profile_id,document_id)
       values ('conversation_a','workspace_a','owner_a','document_a')`
    );
    await db.query(
      `insert into studio_document_versions
        (id,workspace_id,owner_profile_id,document_id,version_number,body_json,body_text,origin,actor_profile_id)
       values ('version_a','workspace_a','owner_a','document_a',1,'{}','private','user','owner_a')`
    );
    await db.query(
      `insert into studio_messages
        (id,workspace_id,owner_profile_id,conversation_id,role,content,ai_run_id)
       values ('message_a','workspace_a','owner_a','conversation_a','assistant','resposta','opaque-run')`
    );
    await expect(db.query(
      `insert into studio_citations
        (id,workspace_id,owner_profile_id,message_id,source_type,source_id,url,label,excerpt,observed_at)
       values ('citation_invalid','workspace_a','owner_a','message_a','external_url','internal','https://example.com','Fonte','',now())`
    )).rejects.toThrow();
    await expect(db.query(
      `insert into studio_suggestions
        (id,workspace_id,owner_profile_id,document_id,conversation_id,ai_run_id,kind,payload_json,status)
       values ('suggestion_without_document','workspace_a','owner_a',null,'conversation_a','opaque','text','{}','pending')`
    )).rejects.toThrow();
    await expect(db.query(
      `insert into studio_suggestions
        (id,workspace_id,owner_profile_id,document_id,conversation_id,ai_run_id,kind,payload_json,
         status,accepted_version_id,decided_at)
       values ('suggestion_dismissed_with_version','workspace_a','owner_a','document_a','conversation_a',
         'opaque','text','{}','dismissed','version_a',now())`
    )).rejects.toThrow();
    await expect(db.query(
      `insert into studio_suggestions
        (id,workspace_id,owner_profile_id,document_id,conversation_id,ai_run_id,kind,payload_json,
         status,accepted_version_id,decided_at)
       values ('suggestion_accepted','workspace_a','owner_a','document_a','conversation_a',
         'opaque','text','{}','accepted','version_a',now())`
    )).resolves.toBeDefined();
    await expect(db.query(
      `insert into studio_conversations (id,workspace_id,owner_profile_id,document_id)
       values ('conversation_cross','workspace_a','owner_b','document_a')`
    )).rejects.toThrow();
  });

  it("keeps Postgres assistant persistence and suggestion decisions atomic and idempotent", async () => {
    await ensureOperationalSchema(db);
    const repository = createPostgresStudioRepository(db);
    const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
    await db.query(
      `insert into studio_documents
        (id,workspace_id,owner_profile_id,title,body_json,body_text,capture_mode)
       values ('document_atomic','workspace_a','owner_a','Original','{}','Original','text');
       insert into studio_document_versions
        (id,workspace_id,owner_profile_id,document_id,version_number,body_json,body_text,origin,actor_profile_id)
       values ('version_initial','workspace_a','owner_a','document_atomic',1,'{}','Original','user','owner_a');
       insert into studio_index_jobs
        (id,workspace_id,owner_profile_id,document_id,version_id,status,next_attempt_at)
       values ('index_initial','workspace_a','owner_a','document_atomic','version_initial','pending',now())`
    );
    const document = await repository.findDocument(scope, "document_atomic");
    if (!document) throw new Error("expected document fixture");
    const turn = await repository.startAssistantTurn({ ...scope, conversationId: null,
      documentId: document.id, content: "Mensagem privada" });
    const final = await repository.finishAssistantTurn({ ...scope, conversationId: turn.conversation.id,
      aiRunId: "opaque-narrative-run", content: "Resposta final", citations: [{ ...scope,
        sourceType: "operational_metric", sourceId: "dashboard:period", url: null,
        label: "Painel", excerpt: "Execução", observedAt: "2026-07-14T12:00:00.000Z",
        periodFrom: "2026-07-01", periodTo: "2026-07-14", metadata: {} }] });
    expect(final.citations).toHaveLength(1);
    expect((await repository.listConversationMessages(scope, turn.conversation.id, 10)).map((item) => item.role))
      .toEqual(["user", "assistant"]);
    const pending = await repository.createAssistantSuggestion({ ...scope, documentId: document.id,
      conversationId: turn.conversation.id, aiRunId: "opaque-structured-run", kind: "text",
      payloadJson: { facts: [{ statement: "Execução consultada", citation_indexes: [0] }], inferences: [], gaps: [],
        citations: [{ source_type: "operational_metric", source_id: "dashboard:period", url: null,
          label: "Painel", excerpt: "Execução", observed_at: "2026-07-14T12:00:00.000Z",
          period_from: "2026-07-01", period_to: "2026-07-14" }], proposal: {
        document_id: document.id, expected_revision: document.revision,
        title: "Aceito", body_json: { type: "doc" }, body_text: "Conteúdo aceito"
      } }, citations: [{ ...scope, sourceType: "operational_metric", sourceId: "dashboard:period", url: null,
        label: "Painel", excerpt: "Execução", observedAt: "2026-07-14T12:00:00.000Z",
        periodFrom: "2026-07-01", periodTo: "2026-07-14", metadata: { structuredReview: true } }] });
    const citationTargets = await db.query<{ message_id: string | null; suggestion_id: string | null }>(
      `select message_id,suggestion_id from studio_citations
       where workspace_id='workspace_a' and owner_profile_id='owner_a' order by created_at,id`
    );
    expect(citationTargets.rows).toEqual(expect.arrayContaining([
      { message_id: final.message.id, suggestion_id: null },
      { message_id: null, suggestion_id: pending.suggestion.id }
    ]));
    const accepted = await repository.acceptSuggestion(scope, pending.suggestion.id, scope.ownerProfileId);
    const repeated = await repository.acceptSuggestion(scope, pending.suggestion.id, scope.ownerProfileId);
    expect(repeated.version?.id).toBe(accepted.version?.id);
    expect(accepted.version).toMatchObject({ origin: "accepted_ai_suggestion", aiRunId: "opaque-structured-run" });
    expect(await repository.listIndexJobs(scope)).toHaveLength(2);
    await expect(repository.findSuggestion(
      { workspaceId: scope.workspaceId, ownerProfileId: "owner_b" }, pending.suggestion.id
    )).resolves.toBeNull();
  });

  it("backfills one memory job for the latest active version in every owner scope", async () => {
    await ensureOperationalSchemaThrough(db, 13);
    await db.query(
      `INSERT INTO studio_documents
         (id,workspace_id,owner_profile_id,body_json,body_text,capture_mode,status)
       VALUES
         ('document_a','workspace_a','owner_a','{}','latest active A','text','active'),
         ('document_b','workspace_a','owner_b','{}','latest active B','text','active'),
         ('document_archived','workspace_a','owner_a','{}','archived','text','archived')`
    );
    await db.query(
      `INSERT INTO studio_document_versions
         (id,workspace_id,owner_profile_id,document_id,version_number,body_json,body_text,origin,actor_profile_id)
       VALUES
         ('version_a_1','workspace_a','owner_a','document_a',1,'{}','old A','user','owner_a'),
         ('version_a_2','workspace_a','owner_a','document_a',2,'{}','latest A','user','owner_a'),
         ('version_b_1','workspace_a','owner_b','document_b',1,'{}','latest B','user','owner_b'),
         ('version_archived_1','workspace_a','owner_a','document_archived',1,'{}','archived','user','owner_a')`
    );

    await ensureOperationalSchema(db);
    await ensureOperationalSchema(db);

    const jobs = await db.query<{
      workspace_id: string;
      owner_profile_id: string;
      document_id: string;
      version_id: string;
    }>(
      `SELECT workspace_id,owner_profile_id,document_id,version_id
       FROM studio_index_jobs ORDER BY owner_profile_id,document_id,version_id`
    );
    expect(jobs.rows).toEqual([
      {
        workspace_id: "workspace_a",
        owner_profile_id: "owner_a",
        document_id: "document_a",
        version_id: "version_a_2"
      },
      {
        workspace_id: "workspace_a",
        owner_profile_id: "owner_b",
        document_id: "document_b",
        version_id: "version_b_1"
      }
    ]);
  });

  it("rolls back a saved Studio version when its unique memory job cannot be enqueued", async () => {
    const statements: string[] = [];
    const failingPool: OperationalPool = {
      async query<T>() { return { rows: [] as T[] }; },
      async connect() {
        return {
          query<T>(text: string, params?: unknown[]) {
            statements.push(text.trim());
            if (text.includes("SELECT id FROM studio_documents")) {
              return Promise.resolve({ rows: [{ id: "document_atomic" }] as T[] });
            }
            if (text.includes("INSERT INTO studio_document_versions")) {
              return Promise.resolve({ rows: [{
                id: "version_atomic",
                workspace_id: "workspace_a",
                owner_profile_id: "owner_a",
                document_id: "document_atomic",
                version_number: 1,
                body_json: {},
                body_text: "não pode ficar sem job",
                origin: "user",
                actor_profile_id: "owner_a",
                ai_run_id: null,
                created_at: "2026-07-14T12:00:00.000Z"
              }] as T[] });
            }
            if (text.includes("INSERT INTO studio_index_jobs")) {
              throw new Error("INJECTED_STUDIO_INDEX_JOB_FAILURE");
            }
            void params;
            return Promise.resolve({ rows: [] as T[] });
          },
          release() {}
        };
      }
    };
    const repository = createPostgresStudioRepository(failingPool);
    await expect(repository.appendVersion({
      workspaceId: "workspace_a",
      ownerProfileId: "owner_a",
      documentId: "document_atomic",
      bodyJson: {},
      bodyText: "não pode ficar sem job",
      origin: "user",
      actorProfileId: "owner_a",
      aiRunId: null
    })).rejects.toThrow("INJECTED_STUDIO_INDEX_JOB_FAILURE");
    expect(statements[0]).toBe("BEGIN");
    expect(statements.some((statement) => statement.includes("INSERT INTO studio_document_versions"))).toBe(true);
    expect(statements.some((statement) => statement.includes("INSERT INTO studio_index_jobs"))).toBe(true);
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });

  it("matches Studio library cursor queries to immutable owner-scoped indexes", () => {
    const schema = readFileSync(resolve(process.cwd(), "src/db/operational-schema.ts"), "utf8");
    const repository = readFileSync(resolve(process.cwd(), "src/modules/studio/postgres-studio.repository.ts"), "utf8");
    const cursorExpression = "date_bin('1 millisecond'::interval,updated_at,'2000-01-01 00:00:00+00'::timestamptz)";

    expect(schema).toContain('version: 21');
    expect(schema).toContain('name: "studio_library_cursor_indexes"');
    expect(schema).toContain(`CREATE INDEX studio_documents_owner_library_cursor_idx
      ON studio_documents
        (workspace_id,owner_profile_id,${cursorExpression} DESC,id DESC);`);
    expect(schema).toContain(`studio_documents_active_library_cursor_idx`);
    expect(schema).toContain(`studio_documents_active_inbox_cursor_idx`);
    expect(schema).toContain(`studio_documents_archived_library_cursor_idx`);
    expect(schema).toContain(cursorExpression);
    expect(repository).toContain(`ORDER BY ${cursorExpression} DESC,id DESC`);
    expect(repository).toContain(`(${cursorExpression},id) <`);
    expect(schema).toContain("UNIQUE (workspace_id, owner_profile_id, collection_id, document_id)");
  });

  it("enforces capture idempotency only among active assets", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      `insert into studio_documents
        (id,workspace_id,owner_profile_id,body_json,body_text,capture_mode)
       values ('document_reuse','workspace_a','owner_a','{}'::jsonb,'private','file')`
    );
    const insert = (id: string, objectKey: string) => db.query(
      `insert into studio_assets
        (id,workspace_id,owner_profile_id,document_id,idempotency_key,kind,display_name,
         object_key,mime_type,size_bytes)
       values ($1,'workspace_a','owner_a','document_reuse',
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','file','private.txt',$2,'text/plain',7)`,
      [id, objectKey]
    );
    await insert("asset_before_tombstone", "private/before.txt");
    await db.query(
      `update studio_assets set lifecycle_status='deleting'
       where workspace_id='workspace_a' and owner_profile_id='owner_a' and id='asset_before_tombstone'`
    );

    await expect(insert("asset_after_tombstone", "private/after.txt")).resolves.toBeDefined();
    const lifecycle = await db.query<{ lifecycle_status: string; total: number }>(
      `select lifecycle_status,count(*)::int total from studio_assets
       where workspace_id='workspace_a' and owner_profile_id='owner_a' and document_id='document_reuse'
       group by lifecycle_status order by lifecycle_status`
    );
    expect(lifecycle.rows).toEqual([
      { lifecycle_status: "active", total: 1 },
      { lifecycle_status: "deleting", total: 1 }
    ]);
  });

  it("rejects Studio assets that reference a document in another owner scope", async () => {
    await ensureOperationalSchema(db);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name='studio_assets' and column_name='document_id'`
    );
    expect(columns.rows).toEqual([{ column_name: "document_id" }]);

    await db.query(
      `insert into studio_documents
        (id, workspace_id, owner_profile_id, body_json, body_text, capture_mode)
       values ('document_b', 'workspace_a', 'owner_b', '{}', 'Privado', 'text')`
    );
    await expect(db.query(
      `insert into studio_assets
        (id, workspace_id, owner_profile_id, document_id, kind, display_name,
         object_key, mime_type, size_bytes)
       values ('asset_a', 'workspace_a', 'owner_a', 'document_b', 'file', 'Plano.pdf',
         'studio/asset-a', 'application/pdf', 42)`
    )).rejects.toThrow();
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
