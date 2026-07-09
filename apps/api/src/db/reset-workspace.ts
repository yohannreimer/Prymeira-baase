import "dotenv/config";
import { createPostgresPool, deleteWorkspaceRecords, ensurePostgresSchema } from "./postgres";

const databaseUrl = process.env.DATABASE_URL;
const workspaceId = process.env.BAASE_RESET_WORKSPACE_ID ?? process.argv[2] ?? "workspace_a";

if (!databaseUrl) {
  throw new Error("DATABASE_URL precisa estar definida para resetar um workspace Postgres.");
}

const pool = createPostgresPool(databaseUrl);

try {
  await ensurePostgresSchema(pool);
  await deleteWorkspaceRecords(pool, workspaceId);
  console.log(`Workspace ${workspaceId} limpo em baase_records.`);
} finally {
  await pool.end();
}
