import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import type { ErrorWithCleanup } from "./migration-cleanup-errors";
import {
  backfillOperationalData,
  type OperationalBackfillPool,
  type OperationalBackfillReport
} from "./operational-backfill";
import {
  ensureOperationalSchema,
  type OperationalSchemaPool
} from "./operational-schema";

type Writer = {
  write(chunk: string): unknown;
};

export type OperationalMigrationPool = OperationalBackfillPool & OperationalSchemaPool & {
  end(): Promise<void>;
};

type OperationalMigrationOptions = {
  env?: Record<string, string | undefined>;
  stdout?: Writer;
  stderr?: Writer;
  poolFactory?: (connectionString: string) => OperationalMigrationPool;
  ensureSchema?: (pool: OperationalSchemaPool) => Promise<void>;
  backfill?: (pool: OperationalBackfillPool) => Promise<OperationalBackfillReport>;
};

export async function runOperationalMigration(options: OperationalMigrationOptions = {}) {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    stderr.write("DATABASE_URL is required\n");
    return 1;
  }

  const poolFactory = options.poolFactory
    ?? ((connectionString: string) => new Pool({ connectionString }));
  const pool = poolFactory(databaseUrl);
  let exitCode = 1;
  try {
    await (options.ensureSchema ?? ensureOperationalSchema)(pool);
    const report = await (options.backfill ?? backfillOperationalData)(pool);
    stdout.write(`${JSON.stringify(report)}\n`);
    exitCode = report.reconciled ? 0 : 1;
  } catch (error) {
    writeError(stderr, error);
    exitCode = 1;
  }
  try {
    await pool.end();
  } catch (error) {
    writeError(stderr, error);
    exitCode = 1;
  }
  return exitCode;
}

function writeError(stderr: Writer, error: unknown, label = "Migration error") {
  const rendered = error instanceof Error ? error.stack ?? error.message : String(error);
  stderr.write(`${label}: ${rendered}\n`);
  if (!(error instanceof Error)) return;
  for (const cleanup of (error as ErrorWithCleanup).cleanupErrors ?? []) {
    writeError(stderr, cleanup, "Cleanup error");
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exitCode = await runOperationalMigration();
}
