import "dotenv/config";
import { buildApp, type BuildAppOptions } from "./app";
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
import { runApiServer } from "./server-lifecycle";

await runApiServer(process.env, {
  readRuntimeConfig,
  assertStudioVectorProductionPrerequisite,
  initializeRuntimeObjectStorage,
  createPostgresPool,
  initializePostgresRuntime(pool, operationalStore, studio) {
    return initializePostgresRuntime(
      pool as ReturnType<typeof createPostgresPool>,
      operationalStore,
      undefined,
      studio
    );
  },
  buildApp({ repositoryBundle, runtimeConfig, objectStorage }) {
    return repositoryBundle
      ? buildApp({
          ...(repositoryBundle as BuildAppOptions),
          runtimeConfig,
          objectStorage: objectStorage as BuildAppOptions["objectStorage"]
        })
      : buildApp({
          seedDemoData: runtimeConfig.demoSeedEnabled,
          runtimeConfig,
          objectStorage: objectStorage as BuildAppOptions["objectStorage"]
        });
  },
  startStudioAssetMaintenance(app, options) {
    return startStudioAssetMaintenance(
      app as unknown as Parameters<typeof startStudioAssetMaintenance>[0],
      options
    );
  },
  async closePool(pool) {
    await (pool as ReturnType<typeof createPostgresPool>).end();
  },
  captureUnexpectedError,
  flushMonitoring,
  registerSignalHandler(signal, handler) {
    process.once(signal, handler);
  },
  exit(code) {
    process.exit(code);
  },
  logStartupError(error) {
    console.error(error);
  }
});
