import { isIP } from "node:net";
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
  sleep?(ms: number): Promise<void>;
};

const defaultObjectStorageDependencies: RuntimeObjectStorageDependencies = {
  createMemoryObjectStorage: createInMemoryObjectStorage,
  createS3ObjectStorage
};

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function hasValidEndpointHostname(endpoint: string): boolean {
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    return false;
  }

  if (parsedEndpoint.protocol !== "http:" && parsedEndpoint.protocol !== "https:") return false;
  const hostname = parsedEndpoint.hostname;
  if (!hostname) return false;
  const unwrappedHostname = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(unwrappedHostname)) return true;
  if (hostname.length > 253) return false;
  return hostname.split(".").every((label) => DNS_LABEL_PATTERN.test(label));
}

export function assertRuntimeStoragePolicy(runtimeConfig: BaaseRuntimeConfig): void {
  if (runtimeConfig.mode === "production"
    && (runtimeConfig.objectStorage.provider !== "s3" || !runtimeConfig.objectStorage.s3)) {
    throw new Error("PRODUCTION_OBJECT_STORAGE_REQUIRED");
  }
  const endpoint = runtimeConfig.objectStorage.s3?.endpoint;
  if (runtimeConfig.mode === "production"
    && endpoint !== undefined
    && !hasValidEndpointHostname(endpoint)) {
    throw new Error("S3_ENDPOINT_HOSTNAME_INVALID");
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
  const productionS3 = runtimeConfig.mode === "production"
    && runtimeConfig.objectStorage.provider === "s3";
  await ensureObjectStorageReady(objectStorage, productionS3 ? {
    attempts: 30,
    delayMs: 1000,
    sleep: dependencies.sleep
  } : undefined);
  return objectStorage;
}

export async function ensureObjectStorageReady(
  objectStorage: ObjectStorage,
  options: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<void> {
  const attempts = options.attempts ?? 1;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("OBJECT_STORAGE_READINESS_ATTEMPTS_INVALID");
  }
  const delayMs = options.delayMs ?? 0;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await objectStorage.ensureReady();
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      if (delayMs > 0) await sleep(delayMs);
    }
  }
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
