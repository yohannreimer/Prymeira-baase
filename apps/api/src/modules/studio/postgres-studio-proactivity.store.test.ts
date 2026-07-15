import { DataType, newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureOperationalSchemaThrough } from "../../db/operational-schema";
import type { OperationalPool } from "../../db/operational-repository-support";
import { createPostgresStudioProactivityStore } from "./postgres-studio-proactivity.store";
import { createStudioProactivityService } from "./studio-proactivity.service";

let db: Pool;

beforeEach(() => {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "pg_advisory_xact_lock", args: [DataType.integer, DataType.integer], returns: DataType.integer, implementation: () => 1 });
  memoryDb.public.registerFunction({ name: "cardinality", args: [memoryDb.public.getType(DataType.text).asArray()], returns: DataType.integer, implementation: (value: unknown[]) => value.length });
  memoryDb.public.registerFunction({ name: "array_positions", args: [memoryDb.public.getType(DataType.text).asArray(), DataType.text], returns: memoryDb.public.getType(DataType.integer).asArray(), implementation: (values: string[], target: string) => values.flatMap((value, index) => value === target ? [index + 1] : []) });
  memoryDb.public.registerFunction({ name: "date_bin", args: [DataType.interval, DataType.timestamptz, DataType.timestamptz], returns: DataType.timestamptz, implementation: (_interval: unknown, value: Date) => value });
  memoryDb.public.registerFunction({ name: "jsonb_typeof", args: [DataType.jsonb], returns: DataType.text, implementation: (value: unknown) => Array.isArray(value) ? "array" : value === null ? "null" : typeof value });
  memoryDb.public.registerOperator({ operator: "~", left: DataType.text, right: DataType.text, returns: DataType.bool, implementation: (value: string, pattern: string) => new RegExp(pattern).test(value) });
  const adapter = memoryDb.adapters.createPg();
  db = new adapter.Pool();
});

afterEach(async () => db.end());

describe("Postgres Studio proactivity store", () => {
  it("persists and removes owner-private settings and visible signals", async () => {
    await ensureOperationalSchemaThrough(db, 19);
    const store = createPostgresStudioProactivityStore(db);
    const now = new Date("2026-07-14T12:00:00.000Z");
    const service = createStudioProactivityService({ store, ritualService: { startSession: vi.fn() }, now: () => now });
    const ownerA = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
    const ownerB = { workspaceId: "workspace_a", ownerProfileId: "owner_b" };

    await service.updateSettings(ownerA, { ritualReminder: true, focusedContent: true });
    await db.query(`insert into studio_proactive_signals
      (id,workspace_id,owner_profile_id,signal_type,source_id,source_scheduled_for,title,reason,status,next_reminder_at)
      values ('signal_a','workspace_a','owner_a','ritual_reminder','ritual_due','2026-07-14T11:00:00Z',
        'Revisão pronta','Lembrete habilitado','active','2026-07-14T12:00:00Z')`);
    await expect(service.listSignals(ownerA, 10)).resolves.toEqual([
      expect.objectContaining({ sourceId: "ritual_due", status: "active" })
    ]);
    await expect(service.listSignals(ownerB, 10)).resolves.toEqual([]);

    const portable = await store.readPortabilityRows!(ownerA);
    expect(portable.settings).toMatchObject({ ritualReminder: true, focusedContent: true });
    expect(portable.signals).toHaveLength(1);
    await store.deleteOwnerData!(ownerA);
    await expect(store.readPortabilityRows!(ownerA)).resolves.toEqual({ settings: null, signals: [] });
  });

  it("claims new and expired ritual work with PostgreSQL skip-locked leases", async () => {
    const statements: string[] = [];
    const preparingRow = {
      id: "signal_due", workspace_id: "workspace_a", owner_profile_id: "owner_a",
      signal_type: "ritual_reminder", source_id: "ritual_due",
      source_scheduled_for: "2026-07-14T11:00:00.000Z", title: "Revisão semanal", reason: "",
      status: "preparing", next_reminder_at: "2026-07-14T12:00:00.000Z",
      claim_token: "claim_a", attempt_count: 1,
      created_at: "2026-07-14T12:00:00.000Z", updated_at: "2026-07-14T12:00:00.000Z",
      dismissed_at: null
    };
    const client = {
      async query<T>(text: string) {
        statements.push(text);
        if (text.includes("UPDATE studio_proactive_signals signals")) return { rows: [] as T[] };
        if (text.includes("INSERT INTO studio_proactive_signals")) return { rows: [preparingRow] as T[] };
        return { rows: [] as T[] };
      },
      release() { /* tracked by the transaction helper */ }
    };
    const pool: OperationalPool = {
      query: client.query,
      async connect() { return client; }
    };

    await expect(createPostgresStudioProactivityStore(pool).claimDueRituals({
      now: "2026-07-14T12:00:00.000Z", limit: 10, claimToken: "claim_a",
      claimLeaseExpiresAt: "2026-07-14T12:02:00.000Z"
    })).resolves.toEqual([expect.objectContaining({ ritualId: "ritual_due", claimToken: "claim_a" })]);

    expect(statements.join("\n")).toContain("FOR UPDATE SKIP LOCKED");
    expect(statements.join("\n")).toContain("FOR UPDATE OF structures SKIP LOCKED");
    expect(statements.join("\n")).toContain("claim_lease_expires_at");
    expect(statements.join("\n")).toContain("ON CONFLICT (workspace_id,owner_profile_id,signal_type,source_id,source_scheduled_for)");
  });
});
