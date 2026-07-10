import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  ensureOperationalSchema,
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
      expect(result.rows.map((row) => row.version)).toEqual([1]);
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
        "operational_audit_entity_idx"
      ]));
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
      const blankEvidence = [["", null], ["   ", null], [null, ""], [null, "   "]];

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
});
