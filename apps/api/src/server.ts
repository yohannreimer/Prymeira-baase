import "dotenv/config";
import { buildApp } from "./app";
import { readRuntimeConfig } from "./config/runtime";
import { createPostgresPool } from "./db/postgres";
import { initializePostgresRuntime } from "./server-initialization";
import { createS3ObjectStorage } from "./storage/s3-object-storage";
import { startStudioAssetMaintenance } from "./modules/studio/studio-asset-maintenance-runner";

const port = Number(process.env.PORT ?? 3090);
const host = process.env.HOST ?? "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL;
const runtimeConfig = readRuntimeConfig(process.env);

const pool = databaseUrl ? createPostgresPool(databaseUrl) : null;
const repositoryBundle = pool
  ? await initializePostgresRuntime(pool, runtimeConfig.operationalStore)
  : null;

const app = repositoryBundle
  ? buildApp({
      ...repositoryBundle,
      runtimeConfig,
      objectStorage: runtimeConfig.objectStorage.s3 ? createS3ObjectStorage(runtimeConfig.objectStorage.s3) : undefined
    })
  : buildApp({
      seedDemoData: runtimeConfig.demoSeedEnabled,
      runtimeConfig,
      objectStorage: runtimeConfig.objectStorage.s3 ? createS3ObjectStorage(runtimeConfig.objectStorage.s3) : undefined
    });
let maintenanceRunner: ReturnType<typeof startStudioAssetMaintenance> | null = null;

async function shutdown() {
  await maintenanceRunner?.stop();
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
  maintenanceRunner = startStudioAssetMaintenance(app);
  app.log.info(`Baase API listening on ${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
