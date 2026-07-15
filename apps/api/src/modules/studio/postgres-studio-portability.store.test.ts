import { describe, expect, it } from "vitest";
import type { OperationalClient, OperationalPool } from "../../db/operational-repository-support";
import { createPostgresStudioPortabilityStore } from "./postgres-studio-portability.store";

describe("Postgres Studio portability store", () => {
  it("creates the deletion marker first, tombstones retained links, and never deletes operational resources", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const client: OperationalClient = {
      async query<T>(sql: string, params?: unknown[]) {
        calls.push({ sql: normalized(sql), params });
        if (sql.includes("FROM people")) return { rows: [{ id: "owner", role: "owner", status: "active" }] as T[] };
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
    }, async () => true);

    expect(objectKeys).toEqual([{
      objectKey: "workspaces/ws/studio/owner/assets/a.pdf", storageUploadId: null
    }]);
    const markerIndex = calls.findIndex((call) => call.sql.includes("INSERT INTO studio_portability_delete_requests"));
    const firstPrivateDelete = calls.findIndex((call) => call.sql.startsWith("DELETE FROM studio_"));
    expect(markerIndex).toBeGreaterThan(-1);
    expect(markerIndex).toBeLessThan(firstPrivateDelete);
    expect(calls.some((call) => call.sql.includes("FROM people") && call.sql.includes("FOR UPDATE"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("FOR KEY SHARE"))).toBe(false);
    expect(calls.some((call) => call.sql.includes("UPDATE studio_operational_links") && call.sql.includes("source_deleted_at"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("DELETE FROM studio_operational_links"))).toBe(false);
    expect(calls.some((call) => /DELETE FROM (tasks|routines|processes|announcements)/u.test(call.sql))).toBe(false);
    expect(calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("holds the owner row and deletion fence through export publication before marking ready", async () => {
    const calls: string[] = [];
    let publishObserved = false;
    const client: OperationalClient = {
      async query<T>(sql: string) {
        calls.push(normalized(sql));
        if (sql.includes("FROM people")) {
          return { rows: [{ id: "owner", role: "owner", status: "active" }] as T[] };
        }
        if (sql.includes("studio_portability_delete_requests") && sql.includes("SELECT id")) {
          return { rows: [] as T[] };
        }
        if (sql.includes("SELECT * FROM studio_portability_exports")) {
          return { rows: [{
            id: "export_1", workspace_id: "ws", owner_profile_id: "owner", object_key: "private.zip",
            status: "processing", created_at: "2026-07-14T12:00:00.000Z",
            expires_at: "2026-07-14T12:15:00.000Z", claim_token: "claim_1",
            claim_lease_expires_at: "2026-07-14T12:02:00.000Z"
          }] as T[] };
        }
        return { rows: [] as T[] };
      },
      release() {}
    };
    const pool: OperationalPool = {
      async connect() { return client; },
      async query<T>() { return { rows: [] as T[] }; }
    };
    const store = createPostgresStudioPortabilityStore(pool);
    await store.publishExport({
      scope: { workspaceId: "ws", ownerProfileId: "owner" }, id: "export_1", claimToken: "claim_1",
      readyAt: "2026-07-14T12:00:00.000Z", expiresAt: "2026-07-14T12:15:00.000Z"
    }, async () => true, async () => {
      publishObserved = true;
      expect(calls.at(-1)).toContain("FOR UPDATE");
    });

    expect(publishObserved).toBe(true);
    const ownerLock = calls.findIndex((sql) => sql.includes("FROM people") && sql.includes("FOR UPDATE"));
    const deletionFence = calls.findIndex((sql) => sql.includes("studio_portability_delete_requests"));
    const markReady = calls.findIndex((sql) => sql.includes("status='ready'"));
    expect(ownerLock).toBeGreaterThan(-1);
    expect(deletionFence).toBeGreaterThan(ownerLock);
    expect(markReady).toBeGreaterThan(deletionFence);
    expect(calls.at(-1)).toBe("COMMIT");
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
