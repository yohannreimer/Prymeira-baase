import { describe, expect, it } from "vitest";
import type { OperationalClient, OperationalPool } from "../../db/operational-repository-support";
import { createPostgresStudioPortabilityStore } from "./postgres-studio-portability.store";

describe("Postgres Studio portability store", () => {
  it("creates the deletion marker first, tombstones retained links, and never deletes operational resources", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const client: OperationalClient = {
      async query<T>(sql: string, params?: unknown[]) {
        calls.push({ sql: normalized(sql), params });
        if (sql.includes("SELECT id FROM people")) return { rows: [{ id: "owner" }] as T[] };
        if (sql.includes("MAX(storage_upload_id)")) {
          return { rows: [{ object_key: "workspaces/ws/studio/owner/assets/a.pdf", storage_upload_id: null }] as T[] };
        }
        if (sql.includes("to_regclass")) return { rows: [{ relation: "studio_memory_chunks" }] as T[] };
        return { rows: [] as T[] };
      },
      release() {}
    };
    const pool: OperationalPool = {
      async connect() { return client; },
      async query<T>() { return { rows: [] as T[] }; }
    };
    const store = createPostgresStudioPortabilityStore(pool);

    const objectKeys = await store.beginDeletion({
      requestId: "delete_1",
      scope: { workspaceId: "ws", ownerProfileId: "owner" },
      requestedAt: "2026-07-14T16:00:00.000Z"
    });

    expect(objectKeys).toEqual([{
      objectKey: "workspaces/ws/studio/owner/assets/a.pdf", storageUploadId: null
    }]);
    const markerIndex = calls.findIndex((call) => call.sql.includes("INSERT INTO studio_portability_delete_requests"));
    const firstPrivateDelete = calls.findIndex((call) => call.sql.startsWith("DELETE FROM studio_"));
    expect(markerIndex).toBeGreaterThan(-1);
    expect(markerIndex).toBeLessThan(firstPrivateDelete);
    expect(calls.some((call) => call.sql.includes("UPDATE studio_operational_links") && call.sql.includes("source_deleted_at"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("DELETE FROM studio_operational_links"))).toBe(false);
    expect(calls.some((call) => /DELETE FROM (tasks|routines|processes|announcements)/u.test(call.sql))).toBe(false);
    expect(calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("uses the owner pair on every private snapshot query", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const pool: OperationalPool = {
      async connect() { throw new Error("not used"); },
      async query<T>(sql: string, params?: unknown[]) {
        calls.push({ sql: normalized(sql), params });
        if (sql.includes("to_regclass")) return { rows: [{ relation: null }] as T[] };
        return { rows: [] as T[] };
      }
    };
    const store = createPostgresStudioPortabilityStore(pool);

    await store.readSnapshot({ workspaceId: "ws", ownerProfileId: "owner_a" });

    const selects = calls.filter((call) => call.sql.startsWith("SELECT * FROM studio_"));
    expect(selects.length).toBeGreaterThan(10);
    expect(selects.every((call) => call.params?.[0] === "ws" && call.params?.[1] === "owner_a")).toBe(true);
    expect(selects.every((call) => call.sql.includes("workspace_id=$1 AND owner_profile_id=$2"))).toBe(true);
  });
});

function normalized(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}
