import { describe, expect, it } from "vitest";
import type { BaaseRuntimeConfig } from "./config/runtime";
import type { OperationalPool } from "./db/operational-repository-support";
import { createInMemoryObjectStorage } from "./storage/in-memory-object-storage";
import {
  assertRuntimeStoragePolicy,
  ensureObjectStorageReady,
  initializePostgresRuntime,
  initializeRuntimeObjectStorage
} from "./server-initialization";

const pool = {} as OperationalPool;

function runtimeConfig(overrides: Partial<BaaseRuntimeConfig> = {}): BaaseRuntimeConfig {
  return {
    mode: "demo",
    auth: { mode: "local", accountApiUrl: null },
    persistence: "memory",
    operationalStore: "jsonb",
    demoSeedEnabled: true,
    ai: { structured: "mock", transcription: "mock" },
    objectStorage: { provider: "memory", s3: null },
    ok: true,
    warnings: [],
    ...overrides
  };
}

function productionS3Config(endpoint: string | undefined): BaaseRuntimeConfig {
  return runtimeConfig({
    mode: "production",
    objectStorage: {
      provider: "s3",
      s3: {
        endpoint,
        region: "us-east-1",
        bucket: "baase",
        accessKeyId: "access",
        secretAccessKey: "secret",
        forcePathStyle: true
      }
    }
  });
}

describe("PostgreSQL server initialization", () => {
  it.each([
    { provider: "memory" as const, s3: null },
    { provider: "s3" as const, s3: null }
  ])("rejects production without complete S3 configuration before constructing storage", async (objectStorage) => {
    const events: string[] = [];
    const config = runtimeConfig({
      mode: "production",
      objectStorage: objectStorage as BaaseRuntimeConfig["objectStorage"],
      ok: true
    });

    await expect(initializeRuntimeObjectStorage(config, {
      createMemoryObjectStorage() {
        events.push("memory-factory");
        return createInMemoryObjectStorage();
      },
      createS3ObjectStorage() {
        events.push("s3-factory");
        return createInMemoryObjectStorage();
      }
    })).rejects.toThrow("PRODUCTION_OBJECT_STORAGE_REQUIRED");

    expect(events).toEqual([]);
  });

  it("constructs and verifies production S3 before startup continues", async () => {
    const events: string[] = [];
    const config = runtimeConfig({
      mode: "production",
      objectStorage: {
        provider: "s3",
        s3: {
          endpoint: "https://objects.example.test",
          region: "us-east-1",
          bucket: "baase",
          accessKeyId: "access",
          secretAccessKey: "secret",
          forcePathStyle: false
        }
      },
      ok: false
    });

    const storage = await initializeRuntimeObjectStorage(config, {
      createMemoryObjectStorage() {
        events.push("memory-factory");
        return createInMemoryObjectStorage();
      },
      createS3ObjectStorage(receivedConfig) {
        expect(receivedConfig).toBe(config.objectStorage.s3);
        events.push("s3-factory");
        return {
          ...createInMemoryObjectStorage(),
          async ensureReady() { events.push("storage-ready"); }
        };
      }
    });
    events.push("listen");

    expect(storage).toBeDefined();
    expect(events).toEqual(["s3-factory", "storage-ready", "listen"]);
  });

  it.each([
    undefined,
    "http://localhost:9000",
    "http://127.0.0.1:9000",
    "http://[::1]:9000",
    "http://minio:9000",
    "https://objetos.example.com",
    "https://object-storage.example.com"
  ])("accepts a production S3 endpoint with valid hostname: %s", (endpoint) => {
    expect(() => assertRuntimeStoragePolicy(productionS3Config(endpoint))).not.toThrow();
  });

  it.each([
    "http://prymeira_baase_minio:9000",
    "http://-minio:9000",
    "http://minio-:9000",
    "http://minio..internal:9000",
    `http://${"a".repeat(64)}.example:9000`,
    `http://${Array.from({ length: 13 }, () => "a".repeat(20)).join(".")}:9000`,
    "not a URL"
  ])("rejects a production S3 endpoint with invalid hostname: %s", (endpoint) => {
    expect(() => assertRuntimeStoragePolicy(productionS3Config(endpoint)))
      .toThrow("S3_ENDPOINT_HOSTNAME_INVALID");
  });

  it("rejects an invalid production endpoint before constructing storage", async () => {
    const events: string[] = [];

    await expect(initializeRuntimeObjectStorage(productionS3Config("http://invalid_host:9000"), {
      createMemoryObjectStorage() {
        events.push("memory-factory");
        return createInMemoryObjectStorage();
      },
      createS3ObjectStorage() {
        events.push("s3-factory");
        return createInMemoryObjectStorage();
      }
    })).rejects.toThrow("S3_ENDPOINT_HOSTNAME_INVALID");

    expect(events).toEqual([]);
  });

  it("retries production S3 readiness until the third attempt", async () => {
    const events: string[] = [];
    let attempts = 0;

    await initializeRuntimeObjectStorage(productionS3Config("http://minio:9000"), {
      createMemoryObjectStorage: createInMemoryObjectStorage,
      createS3ObjectStorage() {
        return {
          ...createInMemoryObjectStorage(),
          async ensureReady() {
            attempts += 1;
            events.push(`ready${attempts}`);
            if (attempts < 3) throw new Error("not ready");
          }
        };
      },
      async sleep(ms) { events.push(`sleep${ms}`); }
    });

    expect(events).toEqual(["ready1", "sleep1000", "ready2", "sleep1000", "ready3"]);
  });

  it("propagates the last production readiness error after 30 attempts and 29 sleeps", async () => {
    const errors = Array.from({ length: 30 }, (_, index) => new Error(`not ready ${index + 1}`));
    const sleeps: number[] = [];
    let attempts = 0;

    await expect(initializeRuntimeObjectStorage(productionS3Config("http://minio:9000"), {
      createMemoryObjectStorage: createInMemoryObjectStorage,
      createS3ObjectStorage() {
        return {
          ...createInMemoryObjectStorage(),
          async ensureReady() {
            const error = errors[attempts];
            attempts += 1;
            throw error;
          }
        };
      },
      async sleep(ms) { sleeps.push(ms); }
    })).rejects.toBe(errors[29]);

    expect(attempts).toBe(30);
    expect(sleeps).toEqual(Array.from({ length: 29 }, () => 1000));
  });

  it.each(["demo", "pilot"] as const)("allows verified in-memory storage for %s mode", async (mode) => {
    const events: string[] = [];
    await initializeRuntimeObjectStorage(runtimeConfig({ mode }), {
      createMemoryObjectStorage() {
        events.push("memory-factory");
        return {
          ...createInMemoryObjectStorage(),
          async ensureReady() { events.push("storage-ready"); }
        };
      },
      createS3ObjectStorage() {
        events.push("s3-factory");
        return createInMemoryObjectStorage();
      }
    });
    events.push("listen");

    expect(events).toEqual(["memory-factory", "storage-ready", "listen"]);
  });

  it.each(["demo", "pilot"] as const)("does not retry failed readiness in %s mode", async (mode) => {
    let attempts = 0;
    const sleeps: number[] = [];

    await expect(initializeRuntimeObjectStorage(runtimeConfig({ mode }), {
      createMemoryObjectStorage() {
        return {
          ...createInMemoryObjectStorage(),
          async ensureReady() {
            attempts += 1;
            throw new Error("not ready");
          }
        };
      },
      createS3ObjectStorage: createInMemoryObjectStorage,
      async sleep(ms) { sleeps.push(ms); }
    })).rejects.toThrow("not ready");

    expect(attempts).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("verifies object storage before startup can continue", async () => {
    const events: string[] = [];
    const storage = {
      ...createInMemoryObjectStorage(),
      async ensureReady() { events.push("storage-ready"); }
    };
    await ensureObjectStorageReady(storage);
    events.push("listen");
    expect(events).toEqual(["storage-ready", "listen"]);
  });

  it("stops startup when multipart lifecycle readiness fails", async () => {
    const storage = {
      ...createInMemoryObjectStorage(),
      async ensureReady() { throw new Error("STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED"); }
    };
    await expect(ensureObjectStorageReady(storage))
      .rejects.toThrow("STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED");
  });

  for (const operationalStore of ["jsonb", "relational"] as const) {
    it(`initializes operational tables before creating the ${operationalStore} repository bundle`, async () => {
      const events: string[] = [];
      const repositories = { mode: operationalStore };

      const result = await initializePostgresRuntime(pool, operationalStore, {
        async ensurePostgresSchema(receivedPool) {
          expect(receivedPool).toBe(pool);
          events.push("postgres-schema");
        },
        async ensureOperationalSchema(receivedPool) {
          expect(receivedPool).toBe(pool);
          events.push("operational-schema");
        },
        createRepositoryBundle(receivedPool, receivedMode) {
          expect(receivedPool).toBe(pool);
          expect(receivedMode).toBe(operationalStore);
          events.push("repository-bundle");
          return repositories;
        }
      });

      expect(result).toBe(repositories);
      expect(events).toEqual(["postgres-schema", "operational-schema", "repository-bundle"]);
    });
  }

  it("does not create repositories when schema initialization fails", async () => {
    const events: string[] = [];

    await expect(initializePostgresRuntime(pool, "jsonb", {
      async ensurePostgresSchema() {
        events.push("postgres-schema");
      },
      async ensureOperationalSchema() {
        events.push("operational-schema");
        throw new Error("migration failed");
      },
      createRepositoryBundle() {
        events.push("repository-bundle");
        return {};
      }
    })).rejects.toThrow("migration failed");

    expect(events).toEqual(["postgres-schema", "operational-schema"]);
  });
});
