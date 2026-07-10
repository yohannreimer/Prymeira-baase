import { Pool } from "pg";
import { backfillOperationalData } from "./operational-backfill";
import { ensureOperationalSchema } from "./operational-schema";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await ensureOperationalSchema(pool);
    const report = await backfillOperationalData(pool);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!report.reconciled) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
