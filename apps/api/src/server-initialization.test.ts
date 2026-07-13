import { describe, expect, it } from "vitest";
import type { OperationalPool } from "./db/operational-repository-support";
import { initializePostgresRuntime } from "./server-initialization";

const pool = {} as OperationalPool;

describe("PostgreSQL server initialization", () => {
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
