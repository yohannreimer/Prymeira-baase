import { DataType, newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import type { OperationalPool } from "../../db/operational-repository-support";
import { createRoutineService } from "./routine.service";
import { createPostgresRoutineRepository } from "./postgres-routine.repository";

function createMemoryPool() {
  const db = newDb();
  db.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: () => 1
  });
  db.public.registerFunction({
    name: "greatest",
    args: [DataType.timestamptz, DataType.timestamptz],
    returns: DataType.timestamptz,
    implementation: (left: Date, right: Date) => left > right ? left : right
  });
  const { Pool } = db.adapters.createPg();
  return new Pool();
}

async function createRoutineTables(pool: ReturnType<typeof createMemoryPool>) {
  await pool.query(`
    CREATE TABLE routines (
      id TEXT NOT NULL, workspace_id TEXT NOT NULL, area_id TEXT, title TEXT NOT NULL, status TEXT NOT NULL,
      frequency TEXT, weekdays TEXT[], month_day INTEGER, execution_mode TEXT, approval_mode TEXT,
      evidence_policy TEXT, due_hint TEXT, created_by_profile_id TEXT NOT NULL, archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE routine_steps (
      id TEXT NOT NULL, workspace_id TEXT NOT NULL, routine_id TEXT NOT NULL, title TEXT NOT NULL,
      process_id TEXT, due_hint TEXT, approval_mode TEXT NOT NULL, evidence_policy TEXT NOT NULL,
      sort_order INTEGER NOT NULL, archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE routine_assignments (
      id TEXT NOT NULL, workspace_id TEXT NOT NULL, routine_id TEXT NOT NULL, routine_step_id TEXT,
      profile_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE routine_occurrences (
      id TEXT NOT NULL, workspace_id TEXT NOT NULL, routine_id TEXT NOT NULL, due_date DATE NOT NULL,
      audience_key TEXT NOT NULL, area_name_snapshot TEXT, routine_title_snapshot TEXT NOT NULL,
      routine_updated_at_snapshot TIMESTAMPTZ,
      PRIMARY KEY (workspace_id, id), UNIQUE (workspace_id, routine_id, due_date, audience_key)
    );
    CREATE TABLE task_occurrences (
      id TEXT NOT NULL, workspace_id TEXT NOT NULL, origin TEXT NOT NULL, routine_id TEXT, routine_step_id TEXT,
      source_template_key TEXT, area_id TEXT, process_id TEXT, assignee_profile_id TEXT, audience_key TEXT,
      title TEXT NOT NULL, area_name_snapshot TEXT, routine_title_snapshot TEXT, step_title_snapshot TEXT NOT NULL,
      routine_revision_snapshot TIMESTAMPTZ,
      due_hint TEXT, approval_mode TEXT NOT NULL, evidence_policy TEXT NOT NULL, status TEXT NOT NULL,
      due_date DATE NOT NULL, submitted_by_profile_id TEXT, submitted_at TIMESTAMPTZ,
      reviewed_by_profile_id TEXT, reviewed_at TIMESTAMPTZ, review_comment TEXT, completed_at TIMESTAMPTZ, archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE task_checklist_items (
      id TEXT NOT NULL, workspace_id TEXT NOT NULL, task_occurrence_id TEXT NOT NULL, title TEXT NOT NULL,
      sort_order INTEGER NOT NULL, is_completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id), UNIQUE (workspace_id, task_occurrence_id, sort_order)
    );
    CREATE TABLE task_evidence (
      id TEXT NOT NULL, workspace_id TEXT NOT NULL, task_occurrence_id TEXT NOT NULL, profile_id TEXT,
      kind TEXT NOT NULL, comment TEXT, photo_url TEXT, archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE operational_audit_log (
      id TEXT NOT NULL, workspace_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      action TEXT NOT NULL, actor_profile_id TEXT, details JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (workspace_id, id)
    );
  `);
}

describe("Postgres routine repository", () => {
  it("acquires the workspace lock before archiving a routine", async () => {
    const pool = createMemoryPool();
    await createRoutineTables(pool);
    const statements: string[] = [];
    const connect = pool.connect.bind(pool);
    const observedPool = {
      query: pool.query.bind(pool),
      async connect() {
        const client = await connect();
        return {
          async query<T = unknown>(text: string, params?: unknown[]) {
            statements.push(text);
            return client.query(text, params) as Promise<{ rows: T[]; rowCount?: number | null }>;
          },
          release: () => client.release()
        };
      }
    } as unknown as OperationalPool;
    const service = createRoutineService(createPostgresRoutineRepository(observedPool));
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura", frequency: "daily", taskTemplates: [{ title: "Conferir caixa" }]
    });
    statements.length = 0;

    await service.deleteRoutine("workspace_a", routine.id);

    const lock = statements.findIndex((statement) => statement.includes("pg_advisory_xact_lock"));
    const archive = statements.findIndex((statement) => statement.startsWith("UPDATE routines SET status='archived'"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(archive).toBeGreaterThan(lock);
  });

  it("resets every pending checklist when sibling occurrences share an audience", async () => {
    const pool = createMemoryPool();
    await createRoutineTables(pool);
    const repository = createPostgresRoutineRepository(pool);
    const service = createRoutineService(repository);
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura",
      frequency: "daily",
      taskTemplates: [{ title: "Conferir caixa" }, { title: "Abrir sistema" }]
    });
    const originals = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    expect(originals).toHaveLength(2);

    for (const task of originals) {
      await pool.query(
        `INSERT INTO task_checklist_items (id,workspace_id,task_occurrence_id,title,sort_order,is_completed)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [`checklist_${task.id}`, "workspace_a", task.id, "Confirmação", 1, true]
      );
    }

    const revised = await service.updateRoutine("workspace_a", routine.id, {
      title: "Abertura revisada",
      frequency: "daily",
      taskTemplates: routine.taskTemplates.map((template) => ({ id: template.id, title: template.title }))
    });
    expect(revised.updatedAt).not.toBe(routine.updatedAt);
    expect(originals[0]!.routineRevisionSnapshot).not.toBe(revised.updatedAt);
    const storedSnapshot = await pool.query(
      "SELECT routine_updated_at_snapshot FROM routine_occurrences WHERE workspace_id=$1",
      ["workspace_a"]
    ) as { rows: Array<{ routine_updated_at_snapshot: Date }> };
    expect(storedSnapshot.rows[0]!.routine_updated_at_snapshot.toISOString()).toBe(originals[0]!.routineRevisionSnapshot);
    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");

    const reconciled = await repository.listTaskOccurrences("workspace_a", { dueDate: "2026-07-08" });
    expect(reconciled).toHaveLength(2);
    expect(reconciled.map((task) => task.checklistItems)).toEqual([[], []]);
    const snapshots = await pool.query(
      "SELECT routine_updated_at_snapshot FROM routine_occurrences WHERE workspace_id=$1",
      ["workspace_a"]
    ) as { rows: Array<{ routine_updated_at_snapshot: Date }> };
    expect(snapshots.rows.map((row) => row.routine_updated_at_snapshot.toISOString())).toEqual([revised.updatedAt]);
  });

  it("does not rewrite a pending occurrence or parent aggregate on an unchanged generation", async () => {
    const pool = createMemoryPool();
    await createRoutineTables(pool);
    const repository = createPostgresRoutineRepository(pool);
    const service = createRoutineService(repository);
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura", frequency: "daily", taskTemplates: [{ title: "Conferir caixa" }]
    });

    const [first] = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    const parentBefore = await pool.query(
      "SELECT routine_updated_at_snapshot FROM routine_occurrences WHERE workspace_id=$1",
      ["workspace_a"]
    ) as { rows: Array<{ routine_updated_at_snapshot: Date }> };
    const [second] = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    const parentAfter = await pool.query(
      "SELECT routine_updated_at_snapshot FROM routine_occurrences WHERE workspace_id=$1",
      ["workspace_a"]
    ) as { rows: Array<{ routine_updated_at_snapshot: Date }> };

    expect(second?.id).toBe(first?.id);
    expect(second?.updatedAt).toBe(first?.updatedAt);
    expect(parentAfter.rows[0]?.routine_updated_at_snapshot.toISOString())
      .toBe(parentBefore.rows[0]?.routine_updated_at_snapshot.toISOString());
  });

  it("keeps an unknown legacy task revision null instead of falling back to its parent", async () => {
    const pool = createMemoryPool();
    await createRoutineTables(pool);
    const repository = createPostgresRoutineRepository(pool);
    const service = createRoutineService(repository);
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura", frequency: "daily", taskTemplates: [{ title: "Portas" }]
    });
    const [created] = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    if (!created) throw new Error("Expected generated task");
    await pool.query(
      "UPDATE task_occurrences SET routine_revision_snapshot=NULL WHERE workspace_id=$1 AND id=$2",
      ["workspace_a", created.id]
    );
    await pool.query(
      "UPDATE routine_occurrences SET routine_updated_at_snapshot='2026-07-12T09:00:00.000Z' WHERE workspace_id=$1 AND routine_id=$2",
      ["workspace_a", routine.id]
    );

    expect((await repository.findTaskOccurrence("workspace_a", created.id))?.routineRevisionSnapshot).toBeNull();
  });

  it("keeps a submitted shared task on its original revision while refreshing its pending sibling", async () => {
    const pool = createMemoryPool();
    await createRoutineTables(pool);
    const repository = createPostgresRoutineRepository(pool);
    const service = createRoutineService(repository);
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura", frequency: "daily", taskTemplates: [{ title: "Portas" }, { title: "Caixa" }]
    });
    const initial = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    const submitted = initial.find((task) => task.title === "Portas");
    if (!submitted) throw new Error("Expected shared task");
    await service.submitTask("workspace_a", submitted.id, "profile_owner", {});

    const revised = await service.updateRoutine("workspace_a", routine.id, {
      title: "Abertura revisada", frequency: "daily",
      taskTemplates: routine.taskTemplates.map((template) => ({ id: template.id, title: template.title }))
    });
    const reconciled = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    const historical = reconciled.find((task) => task.id === submitted.id);
    const pending = reconciled.find((task) => task.id !== submitted.id);

    expect(historical).toMatchObject({
      title: "Portas", routineTitleSnapshot: "Abertura", routineRevisionSnapshot: initial.find((task) => task.id === submitted.id)?.routineRevisionSnapshot
    });
    expect(pending).toMatchObject({
      title: "Caixa", routineTitleSnapshot: "Abertura revisada", routineRevisionSnapshot: revised.updatedAt, status: "pending"
    });
  });

  it("does not archive an occurrence that is no longer pending", async () => {
    const pool = createMemoryPool();
    await createRoutineTables(pool);
    const repository = createPostgresRoutineRepository(pool);
    const service = createRoutineService(repository);
    const task = await service.createManualTask("workspace_a", "profile_owner", {
      title: "Conferir caixa",
      dueDate: "2026-07-08"
    });

    await pool.query(
      "UPDATE task_occurrences SET status='completed',submitted_at=NOW() WHERE workspace_id=$1 AND id=$2",
      ["workspace_a", task.id]
    );

    await expect(repository.deleteTaskOccurrence("workspace_a", task.id)).resolves.toBe(false);
    const stored = await pool.query(
      "SELECT archived_at FROM task_occurrences WHERE workspace_id=$1 AND id=$2",
      ["workspace_a", task.id]
    ) as { rows: Array<{ archived_at: Date | null }> };
    expect(stored.rows[0]?.archived_at).toBeNull();
  });

  it("rejects a stale routine snapshot without rewriting occurrences", async () => {
    const pool = createMemoryPool();
    await createRoutineTables(pool);
    const repository = createPostgresRoutineRepository(pool);
    const service = createRoutineService(repository);
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura",
      frequency: "daily",
      taskTemplates: [{ title: "Conferir caixa" }]
    });
    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    await service.updateRoutine("workspace_a", routine.id, {
      title: "Abertura revisada",
      frequency: "daily",
      taskTemplates: [{ id: routine.taskTemplates[0]!.id, title: "Conferir caixa" }]
    });

    await expect(repository.reconcileRoutineOccurrences(routine, "2026-07-08", [])).rejects.toThrow("ROUTINE_STALE");
    await expect(repository.listTaskOccurrences("workspace_a", { dueDate: "2026-07-08" })).resolves.toEqual([
      expect.objectContaining({ title: "Conferir caixa" })
    ]);
  });
});
