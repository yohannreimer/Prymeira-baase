import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  ensureOperationalSchema,
  ensureOperationalSchemaThrough,
  type OperationalSchemaClient,
  type OperationalSchemaPool
} from "./operational-schema";
import { createPostgresStudioMemoryIndex, StudioVectorPrerequisiteError } from "../modules/studio/postgres-studio-memory";
import { createPostgresStudioRepository } from "../modules/studio/postgres-studio.repository";
import { createPostgresStudioProactivityStore } from "../modules/studio/postgres-studio-proactivity.store";
import { createPostgresStudioPortabilityStore } from "../modules/studio/postgres-studio-portability.store";

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
  it("claims each due private ritual once across concurrent maintenance workers", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 19);
      await pool.query(`INSERT INTO studio_documents
        (id,workspace_id,owner_profile_id,title,body_json,body_text,capture_mode)
        VALUES
          ('document_a','workspace_a','owner_a','Revisão semanal','{}'::jsonb,'','text'),
          ('document_b','workspace_a','owner_b','Revisão privada B','{}'::jsonb,'','text')`);
      await pool.query(`INSERT INTO studio_structures
        (id,workspace_id,owner_profile_id,document_id,kind,cadence_json,next_run_at)
        VALUES
          ('ritual_a','workspace_a','owner_a','document_a','ritual','{}'::jsonb,'2026-07-14T10:00:00Z'),
          ('ritual_b','workspace_a','owner_b','document_b','ritual','{}'::jsonb,'2026-07-14T10:00:00Z')`);
      await pool.query(`INSERT INTO studio_proactivity_settings
        (workspace_id,owner_profile_id,ritual_reminder_enabled)
        VALUES ('workspace_a','owner_a',TRUE),('workspace_a','owner_b',FALSE)`);

      const store = createPostgresStudioProactivityStore(pool);
      const [left, right] = await Promise.all([
        store.claimDueRituals({
          now: "2026-07-14T12:00:00.000Z",
          limit: 10,
          claimToken: "worker_left",
          claimLeaseExpiresAt: "2026-07-14T12:02:00.000Z"
        }),
        store.claimDueRituals({
          now: "2026-07-14T12:00:00.000Z",
          limit: 10,
          claimToken: "worker_right",
          claimLeaseExpiresAt: "2026-07-14T12:02:00.000Z"
        })
      ]);

      expect([...left, ...right]).toHaveLength(1);
      expect([...left, ...right][0]).toMatchObject({
        workspaceId: "workspace_a",
        ownerProfileId: "owner_a",
        ritualId: "ritual_a",
        attemptCount: 1
      });
      const persisted = await pool.query<{ owner_profile_id: string; status: string }>(
        "SELECT owner_profile_id,status FROM studio_proactive_signals"
      );
      expect(persisted.rows).toEqual([{ owner_profile_id: "owner_a", status: "preparing" }]);
    });
  });

  it("upgrades migration 24 through strict durable identity migration 25", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 18);
      const before = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema=current_schema() and table_name='studio_operation_previews'
           and column_name='intended_resource_id'`
      );
      expect(before.rows).toEqual([]);
      await pool.query(`insert into studio_documents
        (id,workspace_id,owner_profile_id,body_json,body_text,capture_mode)
        values ('document_a','workspace_a','owner_a','{}'::jsonb,'','text')`);
      await pool.query(`insert into studio_suggestions
        (id,workspace_id,owner_profile_id,document_id,ai_run_id,kind,payload_json,status)
        values ('suggestion_a','workspace_a','owner_a','document_a','run_a','text','{}'::jsonb,'pending')`);
      await pool.query(`insert into studio_operation_previews
        (id,workspace_id,owner_profile_id,source_suggestion_id,source_document_id,resource_type,payload_json,
         confirmed_payload_json,status,expires_at,idempotency_key,result_resource_id,confirmed_at)
        values ('preview_confirmed','workspace_a','owner_a','suggestion_a','document_a','task','{}'::jsonb,
         '{}'::jsonb,'confirmed','2027-07-15T12:00:00Z','33333333-3333-4333-8333-333333333333',
         'task_existing',now())`);

      await ensureOperationalSchemaThrough(pool, 24);
      await ensureOperationalSchemaThrough(pool, 24);
      await expect(pool.query(
        "update studio_operation_previews set intended_resource_id=NULL where id='preview_confirmed'"
      )).resolves.toBeDefined();

      await ensureOperationalSchemaThrough(pool, 25);
      await ensureOperationalSchemaThrough(pool, 25);
      const after = await pool.query<{ intended_resource_id: string | null }>(
        "select intended_resource_id from studio_operation_previews where id='preview_confirmed'"
      );
      expect(after.rows).toEqual([{ intended_resource_id: "task_existing" }]);
      const constraint = await pool.query<{ conname: string }>(
        `select conname from pg_constraint
         where conrelid='studio_operation_previews'::regclass
           and conname='studio_operation_previews_intended_resource_state_ck'`
      );
      expect(constraint.rows).toEqual([{ conname: "studio_operation_previews_intended_resource_state_ck" }]);
      await expect(pool.query(
        "update studio_operation_previews set intended_resource_id='task_wrong' where id='preview_confirmed'"
      )).rejects.toThrow();
      await expect(pool.query(
        "update studio_operation_previews set intended_resource_id=NULL where id='preview_confirmed'"
      )).rejects.toThrow();
    });
  });

  it("upgrades legacy exports through migration 26 and serializes publication with owner downgrade", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 23);
      await pool.query(`INSERT INTO people
        (id,workspace_id,name,role,status,created_by_profile_id,access_scope)
        VALUES ('owner','workspace','Dona','owner','active','owner','workspace')`);
      await pool.query(`INSERT INTO studio_portability_exports
        (id,workspace_id,owner_profile_id,object_key,status,expires_at)
        VALUES ('legacy','workspace','owner','legacy.zip','preparing','2026-07-15T12:00:00Z')`);

      await ensureOperationalSchemaThrough(pool, 26);
      await expect(pool.query<{ status: string }>(
        "SELECT status FROM studio_portability_exports WHERE id='legacy'"
      )).resolves.toMatchObject({ rows: [{ status: "pending" }] });
      await pool.query(`UPDATE studio_portability_exports
        SET status='processing',claim_token='claim',claim_lease_expires_at='2026-07-14T12:02:00Z'
        WHERE id='legacy'`);

      let entered!: () => void;
      const publicationEntered = new Promise<void>((resolve) => { entered = resolve; });
      let release!: () => void;
      const publicationGate = new Promise<void>((resolve) => { release = resolve; });
      const publishing = createPostgresStudioPortabilityStore(pool).publishExport({
        scope: { workspaceId: "workspace", ownerProfileId: "owner" }, id: "legacy", claimToken: "claim",
        readyAt: "2026-07-14T12:00:00.000Z", expiresAt: "2026-07-14T12:15:00.000Z"
      }, async () => true, async () => {
        entered();
        await publicationGate;
      });
      await publicationEntered;
      let downgraded = false;
      const downgrade = pool.query(
        "UPDATE people SET status='inactive' WHERE workspace_id='workspace' AND id='owner'"
      ).then(() => { downgraded = true; });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(downgraded).toBe(false);
      release();
      await publishing;
      await downgrade;
      expect(downgraded).toBe(true);
    });
  });

  it("upgrades the released migration 17 ritual table through additive migration 22", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 17);
      const before = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema=current_schema() and table_name='studio_ritual_sessions'
           and column_name in ('synthesis_token','synthesis_lease_expires_at','synthesis_failure_code')`
      );
      expect(before.rows).toEqual([]);

      await ensureOperationalSchema(pool);
      await ensureOperationalSchema(pool);
      const after = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema=current_schema() and table_name='studio_ritual_sessions'
           and column_name in ('synthesis_token','synthesis_lease_expires_at','synthesis_failure_code')
         order by column_name`
      );
      expect(after.rows.map((row) => row.column_name)).toEqual([
        "synthesis_failure_code", "synthesis_lease_expires_at", "synthesis_token"
      ]);
      const constraints = await pool.query<{ conname: string }>(
        `select conname from pg_constraint
         where conrelid='studio_ritual_sessions'::regclass
           and conname like 'studio_ritual_sessions_%_ck'
         order by conname`
      );
      expect(constraints.rows.map((row) => row.conname)).toEqual([
        "studio_ritual_sessions_preparation_state_ck",
        "studio_ritual_sessions_ready_preparation_ck",
        "studio_ritual_sessions_synthesis_claim_pair_ck",
        "studio_ritual_sessions_synthesis_claim_state_ck",
        "studio_ritual_sessions_synthesis_failure_state_ck",
        "studio_ritual_sessions_synthesis_output_state_ck"
      ]);
    });
  });

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
      expect(result.rows.map((row) => row.version)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
        13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26
      ]);
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
        "studio_documents_owner_search_prefix_idx",
        "studio_assets_document_idx",
        "studio_assets_processing_idx",
        "studio_asset_cleanup_jobs_claim_idx",
        "studio_asset_cleanup_jobs_object_uidx",
        "studio_asset_upload_intents_claim_idx",
        "studio_assets_object_key_uidx",
        "studio_assets_idempotency_uidx",
        "studio_collection_items_collection_idx"
        ,"studio_relations_source_idx"
        ,"studio_relations_target_idx"
        ,"studio_index_jobs_claim_idx"
        ,"studio_conversations_owner_updated_idx"
        ,"studio_messages_conversation_idx"
        ,"studio_suggestions_owner_status_idx"
        ,"studio_citations_message_idx"
        ,"studio_citations_suggestion_idx"
        ,"studio_ritual_sessions_open_uidx"
        ,"studio_ritual_sessions_ritual_cursor_idx"
        ,"studio_ritual_sessions_owner_status_idx"
      ]));
    });
  });

  it("creates owner-scoped relations and atomically enqueues one index job per committed version", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      const repository = createPostgresStudioRepository(pool);
      const ownerA = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
      const first = await repository.createDocument({
        ...ownerA, title: "A", bodyJson: {}, bodyText: "primeiro", captureMode: "text",
        inboxState: "pending_review", isFocused: false, status: "active"
      });
      const second = await repository.createDocument({
        ...ownerA, title: "B", bodyJson: {}, bodyText: "segundo", captureMode: "text",
        inboxState: "pending_review", isFocused: false, status: "active"
      });
      const foreign = await repository.createDocument({
        workspaceId: "workspace_a", ownerProfileId: "owner_b", title: "segredo", bodyJson: {},
        bodyText: "privado", captureMode: "text", inboxState: "pending_review", isFocused: false, status: "active"
      });
      expect(await repository.listIndexJobs(ownerA)).toHaveLength(2);
      await repository.updateDocument({ ...first, bodyText: "editado" }, first.revision);
      expect(await repository.listIndexJobs(ownerA)).toHaveLength(3);
      await expect(repository.createRelation({
        ...ownerA, sourceDocumentId: first.id, targetDocumentId: second.id,
        relationType: "supports", createdByProfileId: "owner_a"
      })).resolves.toMatchObject({ relationType: "supports" });
      await expect(repository.createRelation({
        ...ownerA, sourceDocumentId: first.id, targetDocumentId: foreign.id,
        relationType: "related_to", createdByProfileId: "owner_a"
      })).rejects.toThrow("STUDIO_RELATION_DOCUMENT_NOT_FOUND");
    });
  });

  it("locks concurrent assistant suggestion decisions and preserves owner scope", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      const repository = createPostgresStudioRepository(pool);
      const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
      await expect(pool.query(
        `insert into studio_suggestions
          (id,workspace_id,owner_profile_id,ai_run_id,kind,payload_json,status)
         values ('text_without_document','workspace_a','owner_a','opaque','text','{}'::jsonb,'pending')`
      )).rejects.toThrow();
      const document = await repository.createDocument({ ...scope, title: "Original", bodyJson: {},
        bodyText: "Original", captureMode: "text", inboxState: "pending_review", isFocused: false, status: "active" });
      const turn = await repository.startAssistantTurn({ ...scope, conversationId: null,
        documentId: document.id, content: "Mensagem" });
      await repository.finishAssistantTurn({ ...scope, conversationId: turn.conversation.id,
        aiRunId: "opaque-narrative", content: "Resposta", citations: [] });
      const pending = await repository.createAssistantSuggestion({ ...scope, documentId: document.id,
        conversationId: turn.conversation.id, aiRunId: "opaque-structured", kind: "text",
        payloadJson: { facts: [], inferences: [], gaps: [], citations: [], proposal: {
          document_id: document.id, expected_revision: document.revision,
          title: "Aceito", body_json: {}, body_text: "Aceito"
        } }, citations: [] });
      const [left, right] = await Promise.all([
        repository.acceptSuggestion(scope, pending.suggestion.id, scope.ownerProfileId),
        repository.acceptSuggestion(scope, pending.suggestion.id, scope.ownerProfileId)
      ]);
      expect(left.version?.id).toBe(right.version?.id);
      expect(await repository.listVersions(scope, document.id)).toHaveLength(2);
      expect(await repository.findSuggestion(
        { workspaceId: scope.workspaceId, ownerProfileId: "owner_b" }, pending.suggestion.id
      )).toBeNull();
    });
  });

  it("uses pgvector only through its guarded adapter and reports an unavailable prerequisite explicitly", async (context) => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      const repository = createPostgresStudioRepository(pool);
      const ownerA = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
      const ownerB = { workspaceId: "workspace_a", ownerProfileId: "owner_b" };
      const create = async (scope: typeof ownerA, title: string, bodyText: string) => {
        const document = await repository.createDocument({
          ...scope, title, bodyJson: {}, bodyText, captureMode: "text",
          inboxState: "reviewed", isFocused: false, status: "active"
        });
        return { document, version: (await repository.listVersions(scope, document.id))[0]! };
      };
      const embedder = {
        async createEmbeddings({ inputs }: { model: string; inputs: string[] }) {
          return inputs.map((input) => input.includes("caixa") ? [1, 0, 0] : [0, 1, 0]);
        }
      };
      const memory = createPostgresStudioMemoryIndex(pool, {
        embedder, dimensions: 3, now: () => "2026-07-14T12:00:00.000Z"
      });
      try {
        await memory.ensureSetup();
      } catch (error) {
        if (error instanceof StudioVectorPrerequisiteError) {
          console.warn("Skipping pgvector assertions: STUDIO_MEMORY_VECTOR_PREREQUISITE_UNAVAILABLE");
          context.skip();
          return;
        }
        throw error;
      }
      const left = await create(ownerA, "Fluxo", "caixa para amanhã");
      const right = await create(ownerA, "Equipe", "contratações futuras");
      const foreign = await create(ownerB, "Privado", "caixa confidencial");
      await memory.indexVersion(ownerA, left.document, left.version);
      await memory.indexVersion(ownerA, right.document, right.version);
      await memory.indexVersion(ownerB, foreign.document, foreign.version);
      const results = await memory.findRelated(ownerA, {
        documentId: left.document.id, query: "caixa", limit: 10
      });
      expect(results.map((item) => item.documentId)).toEqual([right.document.id]);
      expect(results.every((item) => item.documentId !== foreign.document.id)).toBe(true);
      await memory.removeDocument(ownerA, right.document.id);
      await expect(memory.findRelated(ownerA, { query: "equipe", limit: 10 })).resolves.toEqual([]);
    });
  });

  it("upgrades the earlier ledgered migration 9 Studio asset shape through migration 10", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 9);
      await pool.query(`
        ALTER TABLE studio_assets DROP COLUMN final_url CASCADE;
        ALTER TABLE studio_assets DROP COLUMN fetched_at CASCADE;
        ALTER TABLE studio_assets DROP COLUMN extraction_status CASCADE;
        ALTER TABLE studio_assets DROP COLUMN extracted_text CASCADE;
        ALTER TABLE studio_assets DROP COLUMN extraction_metadata CASCADE;
        ALTER TABLE studio_assets DROP COLUMN last_error_code CASCADE;
        ALTER TABLE studio_assets DROP COLUMN attempt_count CASCADE;
        ALTER TABLE studio_assets DROP COLUMN next_attempt_at CASCADE;
        ALTER TABLE studio_assets ALTER COLUMN object_key SET NOT NULL;
        ALTER TABLE studio_assets ALTER COLUMN mime_type SET NOT NULL;
      `);
      const before = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(before.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

      await ensureOperationalSchema(pool);

      const after = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(after.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21]);
      const catalog = await pool.query<{ columns: number; cleanup_table: boolean; object_nullable: string }>(
        `select
          (select count(*)::int from information_schema.columns
           where table_schema=current_schema() and table_name='studio_assets'
             and column_name in (
               'final_url','fetched_at','extraction_status','extracted_text','extraction_metadata',
               'last_error_code','attempt_count','next_attempt_at','claim_token','lease_expires_at','lifecycle_status'
             )) columns,
          to_regclass('studio_asset_cleanup_jobs') is not null cleanup_table,
          (select is_nullable from information_schema.columns
           where table_schema=current_schema() and table_name='studio_assets' and column_name='object_key') object_nullable`
      );
      expect(catalog.rows[0]).toEqual({ columns: 11, cleanup_table: true, object_nullable: "YES" });

      await pool.query(
        `insert into studio_documents
          (id,workspace_id,owner_profile_id,body_json,body_text,capture_mode)
         values ('document_upgrade','workspace_a','owner_a','{}'::jsonb,'private','text')`
      );
      await pool.query(
        `insert into studio_assets
          (id,workspace_id,owner_profile_id,document_id,kind,display_name,object_key,
           source_url,final_url,fetched_at,mime_type,size_bytes,extraction_status,extracted_text)
         values ('asset_upgrade','workspace_a','owner_a','document_upgrade','link_snapshot','Example',NULL,
           'https://example.com','https://example.com',NOW(),'text/html',100,'ready','snapshot')`
      );
    });
  });

  it("upgrades ledgered migration 10 additively through Studio upload intent migration 11", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 10);
      const before = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(before.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      await ensureOperationalSchema(pool);

      const after = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(after.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21]);
      const catalog = await pool.query<{ intent_table: boolean; intent_indexes: number }>(
        `select
          to_regclass('studio_asset_upload_intents') is not null intent_table,
          (select count(*)::int from pg_indexes where schemaname=current_schema()
            and indexname in ('studio_asset_upload_intents_claim_idx','studio_assets_object_key_uidx')) intent_indexes`
      );
      expect(catalog.rows[0]).toEqual({ intent_table: true, intent_indexes: 2 });
    });
  });

  it("upgrades ledgered upload intents from migration 11 through leased migration 12", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 11);
      await pool.query(
        `insert into studio_documents
          (id,workspace_id,owner_profile_id,body_json,body_text,capture_mode)
         values ('document_upload','workspace_a','owner_a','{}'::jsonb,'private','file')`
      );
      await pool.query(
        `insert into studio_asset_upload_intents
          (id,workspace_id,owner_profile_id,document_id,object_key,display_name,kind,mime_type,
           size_bytes,status,asset_id,next_attempt_at)
         values
          ('resolved_upload','workspace_a','owner_a','document_upload','private/resolved','secret.txt',
           'file','text/plain',6,'resolved','asset_resolved',null),
          ('pending_upload','workspace_a','owner_a','document_upload','private/pending','pending.txt',
           'file','text/plain',7,'pending',null,now())`
      );

      await ensureOperationalSchema(pool);

      const versions = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(versions.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21]);
      const columns = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema=current_schema() and table_name='studio_asset_upload_intents'
           and column_name in ('upload_token','upload_lease_expires_at')
         order by column_name`
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        "upload_lease_expires_at", "upload_token"
      ]);
      const retained = await pool.query<{ id: string; status: string }>(
        "select id,status from studio_asset_upload_intents order by id"
      );
      expect(retained.rows).toEqual([{ id: "pending_upload", status: "cleanup_pending" }]);

      await pool.query(
        "delete from studio_documents where workspace_id=$1 and owner_profile_id=$2 and id=$3",
        ["workspace_a", "owner_a", "document_upload"]
      );
      const remaining = await pool.query<{ count: number }>(
        "select count(*)::int count from studio_asset_upload_intents"
      );
      expect(remaining.rows[0]?.count).toBe(0);
    });
  });

  it("upgrades a ledgered migration 12 upload to an abortable migration 13 session", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 12);
      await pool.query(
        `insert into studio_documents
          (id,workspace_id,owner_profile_id,body_json,body_text,capture_mode)
         values ('document_atomic','workspace_a','owner_a','{}'::jsonb,'private','file')`
      );
      await pool.query(
        `insert into studio_asset_upload_intents
          (id,workspace_id,owner_profile_id,document_id,object_key,display_name,kind,mime_type,
           size_bytes,status,upload_token,upload_lease_expires_at)
         values ('legacy_upload','workspace_a','owner_a','document_atomic','private/legacy','legacy.txt',
           'file','text/plain',6,'uploading','legacy-token',now() + interval '1 minute')`
      );

      await ensureOperationalSchema(pool);

      const versions = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations order by version"
      );
      expect(versions.rows.map((row) => row.version)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21
      ]);
      const migrated = await pool.query<{
        status: string;
        storage_upload_id: string | null;
        storage_session_state: string;
        upload_token: string | null;
      }>(
        `select status,storage_upload_id,storage_session_state,upload_token
         from studio_asset_upload_intents where id='legacy_upload'`
      );
      expect(migrated.rows).toEqual([{
        status: "cleanup_pending",
        storage_upload_id: null,
        storage_session_state: "abort_pending",
        upload_token: null
      }]);
    });
  });

  it("applies migrations 14 through 16, reserves 17 through 19, and adds concurrent active asset idempotency in migration 20", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchemaThrough(pool, 13);
      await pool.query(
        `insert into studio_documents
          (id,workspace_id,owner_profile_id,body_json,body_text,capture_mode)
         values ('document_idempotent','workspace_a','owner_a','{}'::jsonb,'private','file')`
      );

      await ensureOperationalSchema(pool);

      const versions = await pool.query<{ version: number }>(
        "select version from baase_schema_migrations where version between 14 and 21 order by version"
      );
      expect(versions.rows).toEqual([{ version: 14 }, { version: 15 }, { version: 16 }, { version: 17 }, { version: 20 }, { version: 21 }]);
      const cursorIndexes = await pool.query<{ indexname: string; indexdef: string }>(
        `select indexname,indexdef from pg_indexes
         where schemaname=current_schema()
           and indexname in (
             'studio_documents_owner_library_cursor_idx',
             'studio_documents_active_library_cursor_idx',
             'studio_documents_active_inbox_cursor_idx',
             'studio_documents_archived_library_cursor_idx'
           ) order by indexname`
      );
      expect(cursorIndexes.rows.map((row) => row.indexname)).toEqual([
        "studio_documents_active_inbox_cursor_idx",
        "studio_documents_active_library_cursor_idx",
        "studio_documents_archived_library_cursor_idx",
        "studio_documents_owner_library_cursor_idx"
      ]);
      expect(cursorIndexes.rows.every((row) => row.indexdef.includes("date_bin(")
        && row.indexdef.includes("updated_at")
        && row.indexdef.includes("2000-01-01"))).toBe(true);
      const volatility = await pool.query<{ provolatile: string }>(
        `select provolatile from pg_proc
         where oid='date_bin(interval,timestamp with time zone,timestamp with time zone)'::regprocedure`
      );
      expect(volatility.rows).toEqual([{ provolatile: "i" }]);

      const cursorExpression = "date_bin('1 millisecond'::interval,updated_at,'2000-01-01 00:00:00+00'::timestamptz)";
      const plans = [
        {
          index: "studio_documents_owner_library_cursor_idx",
          where: "workspace_id='workspace_a' and owner_profile_id='owner_a'"
        },
        {
          index: "studio_documents_active_library_cursor_idx",
          where: "workspace_id='workspace_a' and owner_profile_id='owner_a' and status='active'"
        },
        {
          index: "studio_documents_active_inbox_cursor_idx",
          where: "workspace_id='workspace_a' and owner_profile_id='owner_a' and status='active' and inbox_state='pending_review'"
        },
        {
          index: "studio_documents_archived_library_cursor_idx",
          where: "workspace_id='workspace_a' and owner_profile_id='owner_a' and status='archived'"
        }
      ];
      const planner = await pool.connect();
      try {
        await planner.query("begin");
        await planner.query("set local enable_seqscan=off");
        for (const expected of plans) {
          const explain = await planner.query(
            `explain (format json) select id from studio_documents
             where ${expected.where}
             order by ${cursorExpression} desc,id desc limit 30`
          );
          expect(JSON.stringify(explain.rows)).toContain(expected.index);
        }
      } finally {
        await planner.query("rollback");
        planner.release();
      }
      const insert = (id: string, objectKey: string) => pool.query(
        `insert into studio_assets
          (id,workspace_id,owner_profile_id,document_id,idempotency_key,kind,display_name,
           object_key,mime_type,size_bytes)
         values ($1,'workspace_a','owner_a','document_idempotent',
           '88888888-8888-4888-8888-888888888888','file','private.txt',$2,'text/plain',7)`,
        [id, objectKey]
      );
      const results = await Promise.allSettled([
        insert("asset_idempotent_a", "private/a.txt"),
        insert("asset_idempotent_b", "private/b.txt")
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

      const active = await pool.query<{ id: string }>(
        `select id from studio_assets
         where workspace_id='workspace_a' and owner_profile_id='owner_a'
           and document_id='document_idempotent' and lifecycle_status='active'`
      );
      await pool.query(
        `update studio_assets set lifecycle_status='deleting'
         where workspace_id='workspace_a' and owner_profile_id='owner_a' and id=$1`,
        [active.rows[0]!.id]
      );
      await insert("asset_idempotent_after_delete", "private/after-delete.txt");
      const lifecycle = await pool.query<{ lifecycle_status: string; total: number }>(
        `select lifecycle_status,count(*)::int total from studio_assets
         where workspace_id='workspace_a' and owner_profile_id='owner_a'
           and document_id='document_idempotent'
         group by lifecycle_status order by lifecycle_status`
      );
      expect(lifecycle.rows).toEqual([
        { lifecycle_status: "active", total: 1 },
        { lifecycle_status: "deleting", total: 1 }
      ]);
    });
  });

  it("creates Studio asset extraction and safe link snapshot columns", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      const columns = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema=current_schema() and table_name='studio_assets'
           and column_name in (
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
  });

  it("creates and naturally plans against the Studio lexical GIN indexes", async () => {
    await withPostgresSchema(async (pool) => {
      await ensureOperationalSchema(pool);
      const indexes = await pool.query<{ indexname: string; indexdef: string }>(
        `select indexname,indexdef from pg_indexes
         where schemaname=current_schema()
           and indexname in (
             'studio_documents_owner_search_idx',
             'studio_documents_owner_search_prefix_idx'
           )
         order by indexname`
      );
      expect(indexes.rows).toHaveLength(2);
      expect(indexes.rows.every((index) => index.indexdef.toLowerCase().includes("using gin")))
        .toBe(true);
      expect(indexes.rows.map((index) => index.indexdef.toLowerCase()).join("\n"))
        .toContain("search_tokens");
      expect(indexes.rows.map((index) => index.indexdef.toLowerCase()).join("\n"))
        .toContain("search_prefix_tokens");

      await pool.query(
        `insert into studio_documents
          (id,workspace_id,owner_profile_id,body_json,body_text,
           search_title_folded,search_body_folded,search_tokens,search_prefix_tokens,capture_mode)
         select
           'search_document_' || sequence,
           'workspace_a',
           'owner_a',
           '{}'::jsonb,
           case when sequence=100000 then 'expansao sustentavel' else 'conteudo comum ' || sequence end,
           '',
           case when sequence=100000 then 'expansao sustentavel' else 'conteudo comum ' || sequence end,
           case when sequence=100000
             then array['expansao','sustentavel']::text[]
             else array['conteudo','comum',sequence::text]::text[]
           end,
           case when sequence=100000
             then array['exp','expa','expan','expans','expansa','expansao']::text[]
             else array['con','cont','conte','conteu','conteud','conteudo']::text[]
           end,
           'text'
         from generate_series(1,100000) as sequence`
      );
      await pool.query("analyze studio_documents");
      const explained = await pool.query<{ "QUERY PLAN": string }>(
        `explain (format text)
         select id from studio_documents
         where workspace_id='workspace_a' and owner_profile_id='owner_a' and status='active'
           and search_tokens @> array[]::text[]
           and (
             search_tokens @> array['expan']::text[]
             or search_prefix_tokens @> array['expan']::text[]
           )`
      );
      const plan = explained.rows.map((row) => row["QUERY PLAN"]).join("\n");
      expect(plan).toContain("BitmapOr");
      expect(plan).toContain("studio_documents_owner_search_idx");
      expect(plan).toContain("studio_documents_owner_search_prefix_idx");
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
      expect(before.rows.map((row) => row.version)).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
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
      expect(after.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21]);
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
      expect(versions.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21]);
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
      expect(after.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21]);
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
      expect(migrations.rows.map((row) => row.version)).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
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
