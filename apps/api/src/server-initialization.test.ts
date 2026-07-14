import { describe, expect, it } from "vitest";
import type { OperationalPool } from "./db/operational-repository-support";
import { createInMemoryObjectStorage } from "./storage/in-memory-object-storage";
import { ensureObjectStorageReady, initializePostgresRuntime } from "./server-initialization";

const pool = {} as OperationalPool;

describe("PostgreSQL server initialization", () => {
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
