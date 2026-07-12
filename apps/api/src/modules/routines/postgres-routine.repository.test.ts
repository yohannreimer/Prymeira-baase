import { DataType, newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
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
      due_hint TEXT, approval_mode TEXT NOT NULL, evidence_policy TEXT NOT NULL, status TEXT NOT NULL,
      due_date DATE NOT NULL, submitted_by_profile_id TEXT, submitted_at TIMESTAMPTZ,
      reviewed_by_profile_id TEXT, reviewed_at TIMESTAMPTZ, review_comment TEXT, archived_at TIMESTAMPTZ,
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
    const pending = await repository.listTaskOccurrences("workspace_a", { dueDate: "2026-07-08" });
    for (const task of pending) {
      await repository.reconcileRoutineOccurrence({
        ...task,
        title: "Abertura revisada",
        checklistItems: [{ title: "Confirmação", done: false }]
      }, revised.updatedAt);
    }

    const reconciled = await repository.listTaskOccurrences("workspace_a", { dueDate: "2026-07-08" });
    expect(reconciled).toHaveLength(2);
    expect(reconciled.map((task) => task.checklistItems?.map((item) => item.done))).toEqual([[false], [false]]);
  });
});
