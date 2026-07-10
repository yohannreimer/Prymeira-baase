import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureOperationalSchema, type Queryable } from "./operational-schema";

let db: Queryable;

beforeEach(() => {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: () => 1
  });
  const { Pool } = memoryDb.adapters.createPg();
  db = new Pool();
});

describe("operational schema", () => {
  it("applies migration version 1 exactly once", async () => {
    await ensureOperationalSchema(db);
    await ensureOperationalSchema(db);

    const result = await db.query<{ version: number }>(
      "select version from baase_schema_migrations order by version"
    );

    expect(result.rows.map((row) => row.version)).toEqual([1]);
  });

  it("rejects a process that references an area in another workspace", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      "insert into areas (id, workspace_id, name) values ($1, $2, $3)",
      ["area_finance", "workspace_b", "Financeiro"]
    );

    await expect(db.query(
      `insert into processes
        (id, workspace_id, area_id, title, status, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6)`,
      ["process_close", "workspace_a", "area_finance", "Fechamento", "draft", "profile_a"]
    )).rejects.toThrow();
  });

  it("rejects duplicate routine occurrences for the same audience and due date", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      `insert into routines
        (id, workspace_id, title, status, frequency, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6)`,
      ["routine_opening", "workspace_a", "Abertura", "active", "on_demand", "profile_a"]
    );
    const occurrence = [
      "occurrence_opening",
      "workspace_a",
      "routine_opening",
      "2026-07-10",
      "all",
      "Abertura"
    ];
    await db.query(
      `insert into routine_occurrences
        (id, workspace_id, routine_id, due_date, audience_key, routine_title_snapshot)
       values ($1, $2, $3, $4, $5, $6)`,
      occurrence
    );

    await expect(db.query(
      `insert into routine_occurrences
        (id, workspace_id, routine_id, due_date, audience_key, routine_title_snapshot)
       values ($1, $2, $3, $4, $5, $6)`,
      ["occurrence_duplicate", ...occurrence.slice(1)]
    )).rejects.toThrow();
  });

  it("rejects evidence owned by a task occurrence in another workspace", async () => {
    await ensureOperationalSchema(db);
    await db.query(
      `insert into people
        (id, workspace_id, name, role, status, created_by_profile_id)
       values ($1, $2, $3, $4, $5, $6)`,
      ["profile_a", "workspace_a", "Ana", "employee", "active", "profile_owner"]
    );
    await db.query(
      `insert into task_occurrences
        (id, workspace_id, origin, title, step_title_snapshot, approval_mode,
         evidence_policy, status, due_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        "task_close",
        "workspace_b",
        "manual",
        "Fechar caixa",
        "Fechar caixa",
        "direct",
        "comment_required",
        "pending",
        "2026-07-10"
      ]
    );

    await expect(db.query(
      `insert into task_evidence
        (id, workspace_id, task_occurrence_id, profile_id, kind, comment)
       values ($1, $2, $3, $4, $5, $6)`,
      ["evidence_close", "workspace_a", "task_close", "profile_a", "comment", "Conferido"]
    )).rejects.toThrow();
  });
});
