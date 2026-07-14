import type { BaaseOperationalStore } from "./config/runtime";
import { createConfiguredPostgresRepositoryBundle, ensurePostgresSchema } from "./db/postgres";
import { ensureOperationalSchema } from "./db/operational-schema";
import type { OperationalPool } from "./db/operational-repository-support";
import type { ObjectStorage } from "./storage/object-storage";

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
