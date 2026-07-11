import { describe, expect, it } from "vitest";
import type { ErrorWithCleanup } from "./migration-cleanup-errors";
import { withOperationalTransaction, type OperationalPool } from "./operational-repository-support";

describe("operational repository transactions", () => {
  it("preserves the mutation error when rollback and release also fail", async () => {
    const primary = new Error("mutation failed") as ErrorWithCleanup;
    const rollback = new Error("rollback failed");
    const release = new Error("release failed");
    const pool: OperationalPool = {
      async query<T>() { return { rows: [] as T[] }; },
      async connect() {
        return {
          async query<T>(text: string) {
            if (text === "ROLLBACK") throw rollback;
            return { rows: [] as T[] };
          },
          release() { throw release; }
        };
      }
    };

    await expect(withOperationalTransaction(pool, async () => { throw primary; })).rejects.toBe(primary);
    expect(primary.cleanupErrors).toEqual([rollback, release]);
  });
});
