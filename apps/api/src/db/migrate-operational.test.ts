import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { OperationalBackfillReport } from "./operational-backfill";
import {
  runOperationalMigration,
  type OperationalMigrationPool
} from "./migrate-operational";
import { ensurePostgresSchema } from "./postgres";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let schemaSequence = 0;

function captureWriter() {
  let output = "";
  return {
    writer: {
      write(chunk: string) {
        output += chunk;
        return true;
      }
    },
    read: () => output
  };
}

function emptyReport(reconciled: boolean): OperationalBackfillReport {
  return {
    sourceCounts: {},
    targetCounts: {},
    insertedTotal: 0,
    orphanReferences: [],
    skippedRecords: [],
    reconciled
  };
}

function unusedPool(onEnd: () => void): OperationalMigrationPool {
  return {
    async query<T = unknown>() {
      return { rows: [] as T[] };
    },
    async connect() {
      throw new Error("connect should not be called");
    },
    async end() {
      onEnd();
    }
  };
}

async function withPostgresSchema<T>(run: (schemaName: string) => Promise<T>): Promise<T> {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const admin = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 5_000 });
  const schemaName = `baase_cli_${process.pid}_${Date.now()}_${schemaSequence++}`;
  let schemaCreated = false;
  try {
    await admin.query(`create schema ${schemaName}`);
    schemaCreated = true;
    return await run(schemaName);
  } finally {
    try {
      if (schemaCreated) await admin.query(`drop schema ${schemaName} cascade`);
    } finally {
      await admin.end();
    }
  }
}

function createTrackedPool(connectionString: string, schemaName: string, onEnd: () => void) {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
    options: `-c search_path=${schemaName}`
  });
  const tracked: OperationalMigrationPool = {
    query<T = unknown>(text: string, params?: unknown[]) {
      return pool.query(text, params) as unknown as Promise<{ rows: T[] }>;
    },
    async connect() {
      const client = await pool.connect();
      return {
        query<T = unknown>(text: string, params?: unknown[]) {
          return client.query(text, params) as unknown as Promise<{ rows: T[] }>;
        },
        release() {
          client.release();
        }
      };
    },
    async end() {
      onEnd();
      await pool.end();
    }
  };
  return tracked;
}

describe("operational migration CLI", () => {
  it("returns nonzero and writes stderr when DATABASE_URL is missing", async () => {
    const stdout = captureWriter();
    const stderr = captureWriter();
    let poolCreated = false;

    const exitCode = await runOperationalMigration({
      env: {},
      stdout: stdout.writer,
      stderr: stderr.writer,
      poolFactory() {
        poolCreated = true;
        return unusedPool(() => undefined);
      }
    });

    expect(exitCode).toBe(1);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toContain("DATABASE_URL is required");
    expect(poolCreated).toBe(false);
  });

  it("returns nonzero after printing one unreconciled JSON report and closes the pool", async () => {
    const stdout = captureWriter();
    const stderr = captureWriter();
    let closed = false;

    const exitCode = await runOperationalMigration({
      env: { DATABASE_URL: "postgresql://example.invalid/baase" },
      stdout: stdout.writer,
      stderr: stderr.writer,
      poolFactory: () => unusedPool(() => {
        closed = true;
      }),
      ensureSchema: async () => undefined,
      backfill: async () => emptyReport(false)
    });

    expect(exitCode).toBe(1);
    expect(stdout.read().trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(stdout.read())).toMatchObject({ reconciled: false });
    expect(stderr.read()).toBe("");
    expect(closed).toBe(true);
  });

  it("returns nonzero when pool close fails instead of escaping", async () => {
    const stdout = captureWriter();
    const stderr = captureWriter();
    const pool = unusedPool(() => undefined);
    pool.end = async () => {
      throw new Error("pool close failure");
    };

    const exitCode = await runOperationalMigration({
      env: { DATABASE_URL: "postgresql://example.invalid/baase" },
      stdout: stdout.writer,
      stderr: stderr.writer,
      poolFactory: () => pool,
      ensureSchema: async () => undefined,
      backfill: async () => emptyReport(true)
    });

    expect(exitCode).toBe(1);
    expect(stdout.read().trim().split("\n")).toHaveLength(1);
    expect(stderr.read()).toContain("pool close failure");
  });

  it("reports both the primary operation error and a pool close error", async () => {
    const stdout = captureWriter();
    const stderr = captureWriter();
    const primary = new Error("primary operation failure");
    const pool = unusedPool(() => undefined);
    pool.end = async () => {
      throw new Error("pool close failure");
    };

    const exitCode = await runOperationalMigration({
      env: { DATABASE_URL: "postgresql://example.invalid/baase" },
      stdout: stdout.writer,
      stderr: stderr.writer,
      poolFactory: () => pool,
      ensureSchema: async () => {
        throw primary;
      }
    });

    expect(exitCode).toBe(1);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toContain("primary operation failure");
    expect(stderr.read()).toContain("pool close failure");
  });
});

describe.skipIf(!testDatabaseUrl)("operational migration CLI on PostgreSQL 16", () => {
  it("prints exactly one reconciled JSON report and closes its pool", async () => {
    await withPostgresSchema(async (schemaName) => {
      const setup = new Pool({
        connectionString: testDatabaseUrl,
        connectionTimeoutMillis: 5_000,
        options: `-c search_path=${schemaName}`
      });
      await ensurePostgresSchema(setup);
      await setup.end();

      const stdout = captureWriter();
      const stderr = captureWriter();
      let closed = false;
      const exitCode = await runOperationalMigration({
        env: { DATABASE_URL: testDatabaseUrl ?? "" },
        stdout: stdout.writer,
        stderr: stderr.writer,
        poolFactory: (connectionString) => createTrackedPool(connectionString, schemaName, () => {
          closed = true;
        })
      });

      const lines = stdout.read().trim().split("\n");
      expect(exitCode).toBe(0);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ reconciled: true });
      expect(stderr.read()).toBe("");
      expect(closed).toBe(true);
    });
  });
});
