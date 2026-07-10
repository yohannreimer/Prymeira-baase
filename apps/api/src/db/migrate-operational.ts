import { pathToFileURL } from "node:url";
import { Pool } from "pg";
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
  try {
    await (options.ensureSchema ?? ensureOperationalSchema)(pool);
    const report = await (options.backfill ?? backfillOperationalData)(pool);
    stdout.write(`${JSON.stringify(report)}\n`);
    return report.reconciled ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exitCode = await runOperationalMigration();
}
