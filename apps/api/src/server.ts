import "dotenv/config";
import { buildApp } from "./app";
import { readRuntimeConfig } from "./config/runtime";
import { createPostgresPool, createPostgresRepositoryBundle, ensurePostgresSchema } from "./db/postgres";

const port = Number(process.env.PORT ?? 3090);
const host = process.env.HOST ?? "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL;
const runtimeConfig = readRuntimeConfig(process.env);

const pool = databaseUrl ? createPostgresPool(databaseUrl) : null;
if (pool) {
  await ensurePostgresSchema(pool);
}

const app = pool
  ? buildApp({ ...createPostgresRepositoryBundle(pool), runtimeConfig })
  : buildApp({ seedDemoData: runtimeConfig.demoSeedEnabled, runtimeConfig });

async function shutdown() {
  await app.close();
  await pool?.end();
}

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

try {
  await app.listen({ port, host });
  app.log.info(`Baase API listening on ${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
