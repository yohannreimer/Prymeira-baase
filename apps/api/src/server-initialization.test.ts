import { describe, expect, it } from "vitest";
import type { BaaseRuntimeConfig } from "./config/runtime";
import type { OperationalPool } from "./db/operational-repository-support";
import { createInMemoryObjectStorage } from "./storage/in-memory-object-storage";
import {
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
