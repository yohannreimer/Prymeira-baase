import "dotenv/config";
import { pathToFileURL } from "node:url";
import { buildApp } from "../app";
import { readRuntimeConfig } from "../config/runtime";
import { createPostgresPool } from "../db/postgres";
import { initializePostgresRuntime, initializeRuntimeObjectStorage } from "../server-initialization";
import { createStudioAssetMaintenanceRunner } from "../modules/studio/studio-asset-maintenance-runner";

type Processor = { processNext(signal?: AbortSignal): Promise<unknown | null> };
type Logger = { error(error: unknown, message?: string): void };

export type StudioMaintenanceDependencies = {
  studioAssetProcessor: Processor;
  studioAssetCleanupProcessor: Processor;
  studioAssetUploadCleanupProcessor: Processor;
  studioMemoryIndexProcessor?: Processor;
  studioProactivityService: {
    runDuePreparations(now: Date, limit: number): Promise<{
      claimed: number;
      prepared: number;
      failed: number;
    }>;
  };
  log: Logger;
};

export async function runStudioMaintenanceOnce(
  dependencies: StudioMaintenanceDependencies,
  options: {
    maxItemsPerProcessor?: number;
    proactivityLimit?: number;
    now?: () => Date;
    scavenge?: () => Promise<unknown>;
  } = {}
) {
  const runner = createStudioAssetMaintenanceRunner({
    assetProcessor: dependencies.studioAssetProcessor,
    cleanupProcessor: dependencies.studioAssetCleanupProcessor,
    uploadCleanupProcessor: dependencies.studioAssetUploadCleanupProcessor,
    memoryProcessor: dependencies.studioMemoryIndexProcessor,
    logger: dependencies.log,
    maxItemsPerProcessor: options.maxItemsPerProcessor,
    scavenge: options.scavenge
  });

  // Private assets and search indexes are drained before ritual preparation so
  // the prepared session can use the freshest owner-only context available.
  await runner.runOnce();
  return dependencies.studioProactivityService.runDuePreparations(
    (options.now ?? (() => new Date()))(),
    options.proactivityLimit ?? 25
  );
}

export async function runConfiguredStudioMaintenance() {
  const runtimeConfig = readRuntimeConfig(process.env);
  const objectStorage = await initializeRuntimeObjectStorage(runtimeConfig);
  const databaseUrl = process.env.DATABASE_URL;
  const pool = databaseUrl ? createPostgresPool(databaseUrl) : null;

  try {
    const repositoryBundle = pool
      ? await initializePostgresRuntime(pool, runtimeConfig.operationalStore, undefined, runtimeConfig.studio)
      : null;
    const app = repositoryBundle
      ? buildApp({ ...repositoryBundle, runtimeConfig, objectStorage })
      : buildApp({
          seedDemoData: runtimeConfig.demoSeedEnabled,
          runtimeConfig,
          objectStorage
        });
    try {
      return await runStudioMaintenanceOnce(app);
    } finally {
      await app.close();
    }
  } finally {
    await pool?.end();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint === import.meta.url) {
  runConfiguredStudioMaintenance().catch((error) => {
    console.error("Studio maintenance infrastructure failure", error);
    process.exitCode = 1;
  });
}
