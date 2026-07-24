import "dotenv/config";
import { buildApp } from "./app";
import { readRuntimeConfig } from "./config/runtime";
import { createPostgresPool } from "./db/postgres";
import {
  assertStudioVectorProductionPrerequisite,
  initializePostgresRuntime,
  initializeRuntimeObjectStorage
} from "./server-initialization";
import { startStudioAssetMaintenance } from "./modules/studio/studio-asset-maintenance-runner";
import {
  captureUnexpectedError,
  flushMonitoring
} from "./observability/reporter";

const port = Number(process.env.PORT ?? 3090);
const host = process.env.HOST ?? "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL;
const runtimeConfig = readRuntimeConfig(process.env);
assertStudioVectorProductionPrerequisite(runtimeConfig, databaseUrl);
const objectStorage = await initializeRuntimeObjectStorage(runtimeConfig);

const pool = databaseUrl ? createPostgresPool(databaseUrl) : null;
const repositoryBundle = pool
  ? await initializePostgresRuntime(pool, runtimeConfig.operationalStore, undefined, runtimeConfig.studio)
  : null;

const app = repositoryBundle
  ? buildApp({
      ...repositoryBundle,
      runtimeConfig,
      objectStorage
    })
  : buildApp({
      seedDemoData: runtimeConfig.demoSeedEnabled,
      runtimeConfig,
      objectStorage
    });
let maintenanceRunner: ReturnType<typeof startStudioAssetMaintenance> | null = null;
let shutdownStarted = false;

async function shutdown(): Promise<number> {
  let shutdownError: unknown = null;
  for (const close of [
    () => maintenanceRunner?.stop(),
    () => app.close(),
    () => pool?.end()
  ]) {
    try {
      await close();
    } catch (error) {
      shutdownError ??= error;
    }
  }
  if (shutdownError) {
    captureUnexpectedError(shutdownError, { component: "shutdown" });
    app.log.error(shutdownError);
  }
  await flushMonitoring(2000);
  return shutdownError ? 1 : 0;
}

function handleShutdownSignal() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  void shutdown().then((exitCode) => process.exit(exitCode));
}

process.once("SIGINT", handleShutdownSignal);
process.once("SIGTERM", handleShutdownSignal);

try {
  await app.listen({ port, host });
  maintenanceRunner = startStudioAssetMaintenance(app, {
    reportUnexpectedError(error, operation) {
      captureUnexpectedError(error, { component: "maintenance", operation });
    }
  });
  app.log.info(`Baase API listening on ${host}:${port}`);
} catch (error) {
  captureUnexpectedError(error, { component: "startup" });
  app.log.error(error);
  await flushMonitoring(2000);
  process.exit(1);
}
