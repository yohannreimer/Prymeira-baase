import type { BaaseOperationalStore, BaaseRuntimeConfig, BaaseS3Config } from "./config/runtime";
import { createConfiguredPostgresRepositoryBundle, ensurePostgresSchema } from "./db/postgres";
import { ensureOperationalSchema } from "./db/operational-schema";
import type { OperationalPool } from "./db/operational-repository-support";
import type { ObjectStorage } from "./storage/object-storage";
import { createInMemoryObjectStorage } from "./storage/in-memory-object-storage";
import { createS3ObjectStorage } from "./storage/s3-object-storage";

type PostgresRuntimeDependencies<Repositories> = {
  ensurePostgresSchema(pool: OperationalPool): Promise<void>;
  ensureOperationalSchema(pool: OperationalPool): Promise<void>;
  createRepositoryBundle(pool: OperationalPool, operationalStore: BaaseOperationalStore): Repositories;
};

type DefaultRepositoryBundle = ReturnType<typeof createConfiguredPostgresRepositoryBundle>;

const defaultDependencies: PostgresRuntimeDependencies<DefaultRepositoryBundle> = {
  ensurePostgresSchema,
  ensureOperationalSchema,
  createRepositoryBundle: createConfiguredPostgresRepositoryBundle
};

type RuntimeObjectStorageDependencies = {
  createMemoryObjectStorage(): ObjectStorage;
  createS3ObjectStorage(config: BaaseS3Config): ObjectStorage;
};

const defaultObjectStorageDependencies: RuntimeObjectStorageDependencies = {
  createMemoryObjectStorage: createInMemoryObjectStorage,
  createS3ObjectStorage
};

export function assertRuntimeStoragePolicy(runtimeConfig: BaaseRuntimeConfig): void {
  if (runtimeConfig.mode === "production"
    && (runtimeConfig.objectStorage.provider !== "s3" || !runtimeConfig.objectStorage.s3)) {
    throw new Error("PRODUCTION_OBJECT_STORAGE_REQUIRED");
  }
}

export async function initializeRuntimeObjectStorage(
  runtimeConfig: BaaseRuntimeConfig,
  dependencies: RuntimeObjectStorageDependencies = defaultObjectStorageDependencies
): Promise<ObjectStorage> {
  assertRuntimeStoragePolicy(runtimeConfig);
  const s3 = runtimeConfig.objectStorage.s3;
  const objectStorage = runtimeConfig.objectStorage.provider === "s3" && s3
    ? dependencies.createS3ObjectStorage(s3)
    : dependencies.createMemoryObjectStorage();
  await ensureObjectStorageReady(objectStorage);
  return objectStorage;
}

export async function ensureObjectStorageReady(objectStorage: ObjectStorage): Promise<void> {
  await objectStorage.ensureReady();
}

export function initializePostgresRuntime(
  pool: OperationalPool,
  operationalStore: BaaseOperationalStore
): Promise<DefaultRepositoryBundle>;
export function initializePostgresRuntime<Repositories>(
  pool: OperationalPool,
  operationalStore: BaaseOperationalStore,
  dependencies: PostgresRuntimeDependencies<Repositories>
): Promise<Repositories>;
export async function initializePostgresRuntime(
  pool: OperationalPool,
  operationalStore: BaaseOperationalStore,
  dependencies: PostgresRuntimeDependencies<unknown> = defaultDependencies
): Promise<unknown> {
  await dependencies.ensurePostgresSchema(pool);
  await dependencies.ensureOperationalSchema(pool);
  return dependencies.createRepositoryBundle(pool, operationalStore);
}
