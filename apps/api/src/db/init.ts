import "dotenv/config";
import { createPostgresPool, ensurePostgresSchema } from "./postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL precisa estar definida para inicializar o schema Postgres.");
}

const pool = createPostgresPool(databaseUrl);

try {
  await ensurePostgresSchema(pool);
  console.log("Baase Postgres schema pronto.");
} finally {
  await pool.end();
}
