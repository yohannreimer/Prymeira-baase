import { DataType, newDb } from "pg-mem";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backfillOperationalData, type OperationalBackfillPool } from "./operational-backfill";
import { ensureOperationalSchema } from "./operational-schema";
import { ensurePostgresSchema } from "./postgres";

const timestamp = "2026-07-10T12:00:00.000Z";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

let db: Pool;

beforeEach(async () => {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: () => 1
  });
  memoryDb.public.registerFunction({
    name: "cardinality",
    args: [memoryDb.public.getType(DataType.text).asArray()],
    returns: DataType.integer,
    implementation: (value: unknown[]) => value.length
  });
  memoryDb.public.registerFunction({
    name: "array_positions",
    args: [memoryDb.public.getType(DataType.text).asArray(), DataType.text],
    returns: memoryDb.public.getType(DataType.integer).asArray(),
    implementation: (values: string[], target: string) => values.flatMap((value, index) => (
      value === target ? [index + 1] : []
    ))
  });
  memoryDb.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value: string, pattern: string) => new RegExp(pattern).test(value)
  });
  const adapter = memoryDb.adapters.createPg();
  db = new adapter.Pool();
  await ensurePostgresSchema(db);
  await ensureOperationalSchema(db);
});

afterEach(async () => {
  await db.end();
});

async function seedLegacyRecord(
  kind: string,
  workspaceId: string,
  id: string,
  data: Record<string, unknown>
) {
  await db.query(
    `insert into baase_records
      (kind, workspace_id, id, data, created_at, updated_at)
     values ($1, $2, $3, $4::jsonb, $5, $6)`,
    [kind, workspaceId, id, JSON.stringify(data), timestamp, timestamp]
  );
}

function area(workspaceId = "workspace_a", id = "area_ops") {
  return {
    id,
    workspaceId,
    name: "Operacoes",
    description: "Entrega diaria",
    sortOrder: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function person(workspaceId = "workspace_a", overrides: Record<string, unknown> = {}) {
  return {
    id: "profile_owner",
    workspaceId,
    name: "Ana Lima",
    email: "ana@example.com",
    role: "owner",
    areaId: "area_ops",
    roleTemplateId: "role_lead",
    status: "active",
    createdByProfileId: "profile_owner",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function processRecord(workspaceId = "workspace_a", overrides: Record<string, unknown> = {}) {
  const processId = String(overrides.id ?? "process_close");
  const versionOne = {
    id: `${processId}_version_1`,
    processId,
    workspaceId,
    version: 1,
    title: "Fechamento",
    body: "Conferir os valores.",
    changeNote: "Versao inicial",
    editorProfileId: "profile_owner",
    createdAt: timestamp
  };
  const versionTwo = {
    ...versionOne,
    id: `${processId}_version_2`,
    version: 2,
    title: "Fechamento revisado",
    body: "Conferir e publicar os valores.",
    changeNote: "Inclui publicacao"
  };

  return {
    id: processId,
    workspaceId,
    areaId: "area_ops",
    title: "Fechamento revisado",
    summary: "Fechamento diario",
    status: "published",
    ownerProfileId: "profile_owner",
    currentVersion: versionTwo,
    versions: [versionOne, versionTwo],
    createdByProfileId: "profile_owner",
    publishedAt: timestamp,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function routineRecord(workspaceId = "workspace_a", overrides: Record<string, unknown> = {}) {
  const routineId = String(overrides.id ?? "routine_open");
  return {
    id: routineId,
    workspaceId,
    areaId: "area_ops",
    title: "Abertura",
    status: "active",
    frequency: "on_demand",
    weekdays: [],
    assigneeProfileIds: ["profile_owner"],
    executionMode: "shared",
    approvalMode: "direct",
    evidencePolicy: "optional",
    createdByProfileId: "profile_owner",
    taskTemplates: [
      {
        id: `${routineId}_step_1`,
        routineId,
        workspaceId,
        title: "Abrir caixa",
        processId: "process_close",
        assigneeProfileId: "profile_worker",
        dueHint: "08:30",
        approvalMode: "direct",
        evidencePolicy: "optional",
        sortOrder: 1
      },
      {
        id: `${routineId}_step_2`,
        routineId,
        workspaceId,
        title: "Publicar saldo",
        processId: null,
        assigneeProfileId: null,
        dueHint: null,
        approvalMode: "approval_required",
        evidencePolicy: "photo_or_comment_required",
        sortOrder: 2
      }
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function taskRecord(workspaceId = "workspace_a", overrides: Record<string, unknown> = {}) {
  return {
    id: "task_open",
    workspaceId,
    origin: "routine",
    routineId: "routine_open",
    taskTemplateId: "routine_open_step_1",
    title: "Abrir caixa",
    areaId: "area_ops",
    processId: "process_close",
    assigneeProfileId: "profile_worker",
    dueHint: "08:30",
    approvalMode: "direct",
    evidencePolicy: "photo_or_comment_required",
    checklistItems: [
      { title: "Contar cedulas", done: true },
      { title: "Registrar saldo", done: false }
    ],
    status: "completed",
    dueDate: "2026-07-10",
    evidence: { comment: "Saldo conferido", photoUrl: "https://files.example/caixa.jpg" },
    submittedByProfileId: "profile_worker",
    submittedAt: timestamp,
    reviewedByProfileId: "profile_owner",
    reviewedAt: timestamp,
    reviewComment: "Aprovado",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

async function seedHappyWorkspace(workspaceId = "workspace_a") {
  await seedLegacyRecord("area", workspaceId, "area_ops", area(workspaceId));
  await seedLegacyRecord("role_template", workspaceId, "role_lead", {
    id: "role_lead",
    workspaceId,
    areaId: "area_ops",
    name: "Lider de operacoes",
    description: null,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  await seedLegacyRecord("team_member", workspaceId, "profile_owner", person(workspaceId));
  await seedLegacyRecord("team_member", workspaceId, "profile_worker", person(workspaceId, {
    id: "profile_worker",
    name: "Bruno Reis",
    email: "bruno@example.com",
    role: "employee",
    roleTemplateId: null
  }));
  await seedLegacyRecord("process", workspaceId, "process_close", processRecord(workspaceId));
  await seedLegacyRecord("routine", workspaceId, "routine_open", routineRecord(workspaceId));
  await seedLegacyRecord("task_occurrence", workspaceId, "task_open", taskRecord(workspaceId));
}

describe("operational backfill", () => {
  it("backfills a complete workspace including embedded history and snapshots", async () => {
    await seedHappyWorkspace();

    const report = await backfillOperationalData(db);

    expect(report.reconciled).toBe(true);
    expect(report.orphanReferences).toEqual([]);
    expect(report.skippedRecords).toEqual([]);
    expect(report.sourceCounts).toMatchObject({
      areas: 1,
      role_templates: 1,
      people: 2,
      processes: 1,
      process_versions: 2,
      routines: 1,
      routine_steps: 2,
      routine_assignments: 2,
      routine_occurrences: 1,
      task_occurrences: 1,
      task_checklist_items: 2,
      task_evidence: 2
    });
    expect(report.targetCounts).toMatchObject(report.sourceCounts);

    const versions = await db.query<{ version_number: number; body: string }>(
      "select version_number, body from process_versions order by version_number"
    );
    expect(versions.rows).toEqual([
      { version_number: 1, body: "Conferir os valores." },
      { version_number: 2, body: "Conferir e publicar os valores." }
    ]);

    const task = await db.query<{
      area_name_snapshot: string;
      routine_title_snapshot: string;
      step_title_snapshot: string;
      due_time: string;
    }>("select area_name_snapshot, routine_title_snapshot, step_title_snapshot, due_time from task_occurrences");
    expect(task.rows[0]).toMatchObject({
      area_name_snapshot: "Operacoes",
      routine_title_snapshot: "Abertura",
      step_title_snapshot: "Abrir caixa"
    });

    const evidence = await db.query<{ kind: string }>("select kind from task_evidence order by kind");
    expect(evidence.rows.map((row) => row.kind)).toEqual(["comment", "photo"]);
  });

  it("nulls an orphan process area, audits its internal id, and never uses it as a name", async () => {
    await seedLegacyRecord("process", "workspace_a", "process_close", processRecord("workspace_a", {
      areaId: "area_5",
      ownerProfileId: null
    }));

    const first = await backfillOperationalData(db);
    const second = await backfillOperationalData(db);

    const process = await db.query<{ area_id: string | null }>(
      "select area_id from processes where workspace_id = $1 and id = $2",
      ["workspace_a", "process_close"]
    );
    expect(process.rows[0]?.area_id).toBeNull();
    expect(first.orphanReferences).toEqual([{
      entityType: "process",
      entityId: "process_close",
      field: "area_id",
      legacyValue: "area_5"
    }]);
    expect(JSON.stringify(first)).not.toContain("area_name_snapshot\":\"area_5");
    expect(second.insertedTotal).toBe(0);
    expect(second.orphanReferences).toEqual(first.orphanReferences);

    const audits = await db.query<{ details: { legacyValue: string } }>(
      "select details from operational_audit_log"
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]?.details.legacyValue).toBe("area_5");
  });

  it("nulls orphan people and routine areas independently", async () => {
    await seedLegacyRecord("team_member", "workspace_a", "profile_owner", person("workspace_a", {
      areaId: "area_people_missing",
      roleTemplateId: null
    }));
    await seedLegacyRecord("routine", "workspace_a", "routine_open", routineRecord("workspace_a", {
      areaId: "area_routine_missing",
      assigneeProfileIds: [],
      taskTemplates: []
    }));

    const report = await backfillOperationalData(db);

    expect(report.reconciled).toBe(true);
    expect(report.orphanReferences).toEqual(expect.arrayContaining([
      {
        entityType: "person",
        entityId: "profile_owner",
        field: "area_id",
        legacyValue: "area_people_missing"
      },
      {
        entityType: "routine",
        entityId: "routine_open",
        field: "area_id",
        legacyValue: "area_routine_missing"
      }
    ]));
    const people = await db.query<{ area_id: string | null }>("select area_id from people");
    const routines = await db.query<{ area_id: string | null }>("select area_id from routines");
    expect(people.rows[0]?.area_id).toBeNull();
    expect(routines.rows[0]?.area_id).toBeNull();
  });

  it("skips an orphan role template and clears dependent role references", async () => {
    await seedLegacyRecord("role_template", "workspace_a", "role_missing_area", {
      id: "role_missing_area",
      workspaceId: "workspace_a",
      areaId: "area_missing",
      name: "Cargo legado",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await seedLegacyRecord("team_member", "workspace_a", "profile_owner", person("workspace_a", {
      areaId: null,
      roleTemplateId: "role_missing_area"
    }));
    await seedLegacyRecord("process", "workspace_a", "process_close", processRecord("workspace_a", {
      areaId: null,
      ownerProfileId: null,
      ownerRoleTemplateId: "role_missing_area"
    }));
    await seedLegacyRecord("routine", "workspace_a", "routine_open", routineRecord("workspace_a", {
      areaId: null,
      assigneeProfileIds: [],
      assigneeRoleTemplateIds: ["role_missing_area"],
      taskTemplates: [{
        id: "routine_open_step_1",
        routineId: "routine_open",
        workspaceId: "workspace_a",
        title: "Abrir caixa",
        processId: null,
        assigneeProfileId: null,
        assigneeRoleTemplateId: "role_missing_area",
        approvalMode: "direct",
        evidencePolicy: "optional",
        sortOrder: 1
      }]
    }));

    const report = await backfillOperationalData(db);

    expect(report.reconciled).toBe(true);
    expect(report.targetCounts.role_templates).toBe(0);
    expect(report.targetCounts.routine_assignments).toBe(0);
    expect(report.skippedRecords).toEqual(expect.arrayContaining([
      { entityType: "role_template", entityId: "role_missing_area", reason: "missing required area area_missing" }
    ]));
    expect(report.skippedRecords?.filter((record) => record.entityType === "routine_assignment")).toHaveLength(2);

    const people = await db.query<{ role_template_id: string | null }>("select role_template_id from people");
    const processes = await db.query<{ owner_role_template_id: string | null }>(
      "select owner_role_template_id from processes"
    );
    expect(people.rows[0]?.role_template_id).toBeNull();
    expect(processes.rows[0]?.owner_role_template_id).toBeNull();
  });

  it("preserves tasks with missing routines or steps as manual history", async () => {
    await seedLegacyRecord("area", "workspace_a", "area_ops", area());
    await seedLegacyRecord("routine", "workspace_a", "routine_open", routineRecord("workspace_a", {
      assigneeProfileIds: [],
      taskTemplates: []
    }));
    await seedLegacyRecord("task_occurrence", "workspace_a", "task_missing_routine", taskRecord("workspace_a", {
      id: "task_missing_routine",
      routineId: "routine_removed",
      taskTemplateId: "step_removed",
      processId: null,
      assigneeProfileId: null,
      evidence: null,
      checklistItems: [],
      areaNameSnapshot: "Operacoes antigas",
      routineTitleSnapshot: "Rotina removida",
      stepTitleSnapshot: "Passo preservado"
    }));
    await seedLegacyRecord("task_occurrence", "workspace_a", "task_missing_step", taskRecord("workspace_a", {
      id: "task_missing_step",
      taskTemplateId: "step_removed",
      processId: null,
      assigneeProfileId: null,
      evidence: null,
      checklistItems: []
    }));

    const report = await backfillOperationalData(db);

    expect(report.reconciled).toBe(true);
    const tasks = await db.query<{
      id: string;
      origin: string;
      routine_id: string | null;
      routine_step_id: string | null;
      area_name_snapshot: string | null;
      routine_title_snapshot: string | null;
      step_title_snapshot: string;
    }>(
      `select id, origin, routine_id, routine_step_id, area_name_snapshot,
        routine_title_snapshot, step_title_snapshot
       from task_occurrences order by id`
    );
    expect(tasks.rows).toEqual([
      {
        id: "task_missing_routine",
        origin: "manual",
        routine_id: null,
        routine_step_id: null,
        area_name_snapshot: "Operacoes antigas",
        routine_title_snapshot: null,
        step_title_snapshot: "Passo preservado"
      },
      {
        id: "task_missing_step",
        origin: "manual",
        routine_id: null,
        routine_step_id: null,
        area_name_snapshot: "Operacoes",
        routine_title_snapshot: null,
        step_title_snapshot: "Abrir caixa"
      }
    ]);
    expect(report.orphanReferences).toEqual(expect.arrayContaining([
      {
        entityType: "task_occurrence",
        entityId: "task_missing_routine",
        field: "routine_id",
        legacyValue: "routine_removed"
      },
      {
        entityType: "task_occurrence",
        entityId: "task_missing_step",
        field: "routine_step_id",
        legacyValue: "step_removed"
      }
    ]));
  });

  it("is idempotent without duplicating rows or unresolved-reference audits", async () => {
    await seedLegacyRecord("process", "workspace_a", "process_close", processRecord("workspace_a", {
      areaId: "area_removed",
      ownerProfileId: null
    }));

    const first = await backfillOperationalData(db);
    const firstCounts = await db.query<{ processes: number; audits: number }>(
      `select
        (select count(*)::int from processes) as processes,
        (select count(*)::int from operational_audit_log) as audits`
    );
    const second = await backfillOperationalData(db);
    const secondCounts = await db.query<{ processes: number; audits: number }>(
      `select
        (select count(*)::int from processes) as processes,
        (select count(*)::int from operational_audit_log) as audits`
    );

    expect(first.insertedTotal).toBeGreaterThan(0);
    expect(second.insertedTotal).toBe(0);
    expect(second.orphanReferences).toEqual(first.orphanReferences);
    expect(second.skippedRecords).toEqual(first.skippedRecords);
    expect(secondCounts.rows[0]).toEqual(firstCounts.rows[0]);
  });

  it("explains and skips evidence whose explicit owner no longer exists", async () => {
    await seedLegacyRecord("task_occurrence", "workspace_a", "task_manual", taskRecord("workspace_a", {
      id: "task_manual",
      origin: "manual",
      routineId: null,
      taskTemplateId: null,
      areaId: null,
      processId: null,
      assigneeProfileId: null,
      submittedByProfileId: null,
      reviewedByProfileId: null,
      checklistItems: [],
      evidence: { profileId: "profile_removed", comment: "Registro historico", photoUrl: null }
    }));

    const report = await backfillOperationalData(db);

    expect(report.reconciled).toBe(true);
    expect(report.sourceCounts.task_evidence).toBe(1);
    expect(report.targetCounts.task_evidence).toBe(0);
    expect(report.orphanReferences).toContainEqual({
      entityType: "task_evidence",
      entityId: expect.stringMatching(/^legacy_evidence_/),
      field: "profile_id",
      legacyValue: "profile_removed"
    });
    expect(report.skippedRecords).toContainEqual({
      entityType: "task_evidence",
      entityId: expect.stringMatching(/^legacy_evidence_/),
      reason: "missing evidence profile"
    });
  });

  it("rolls back every target row in a workspace when one insert fails", async () => {
    await seedHappyWorkspace();
    const transactionCommands: string[] = [];
    const failingPool: OperationalBackfillPool = {
      query<T = unknown>(text: string, params?: unknown[]) {
        return db.query(text, params) as unknown as Promise<{ rows: T[] }>;
      },
      async connect() {
        const client = await db.connect();
        return {
          query<T = unknown>(text: string, params?: unknown[]) {
            if (/^(begin|commit|rollback)$/i.test(text)) transactionCommands.push(text.toUpperCase());
            if (/insert\s+into\s+processes/i.test(text)) throw new Error("forced process failure");
            return client.query(text, params) as unknown as Promise<{ rows: T[] }>;
          },
          release() {
            client.release();
          }
        };
      }
    };

    await expect(backfillOperationalData(failingPool)).rejects.toThrow("forced process failure");
    expect(transactionCommands).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("keeps identical legacy ids isolated between workspaces", async () => {
    await seedLegacyRecord("area", "workspace_a", "area_ops", area("workspace_a"));
    await seedLegacyRecord("area", "workspace_b", "area_ops", {
      ...area("workspace_b"),
      name: "Financeiro"
    });
    await seedLegacyRecord("team_member", "workspace_a", "profile_owner", person("workspace_a", {
      roleTemplateId: null
    }));
    await seedLegacyRecord("team_member", "workspace_b", "profile_owner", person("workspace_b", {
      roleTemplateId: null,
      email: "owner-b@example.com"
    }));

    const report = await backfillOperationalData(db);

    expect(report.reconciled).toBe(true);
    const areas = await db.query<{ workspace_id: string; id: string; name: string }>(
      "select workspace_id, id, name from areas order by workspace_id"
    );
    expect(areas.rows).toEqual([
      { workspace_id: "workspace_a", id: "area_ops", name: "Operacoes" },
      { workspace_id: "workspace_b", id: "area_ops", name: "Financeiro" }
    ]);
  });

  it("marks an unexplained source and target count mismatch unreconciled", async () => {
    await seedLegacyRecord("area", "workspace_a", "area_ops", area());
    await db.query(
      "insert into areas (id, workspace_id, name) values ($1, $2, $3)",
      ["area_unexplained", "workspace_a", "Extra"]
    );

    const report = await backfillOperationalData(db);

    expect(report.sourceCounts.areas).toBe(1);
    expect(report.targetCounts.areas).toBe(2);
    expect(report.skippedRecords).toEqual([]);
    expect(report.reconciled).toBe(false);
  });
});

let postgresSchemaSequence = 0;

async function withPostgresSchema<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

  const adminPool = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 5_000 });
  const schemaName = `baase_backfill_${process.pid}_${Date.now()}_${postgresSchemaSequence++}`;
  let pool: Pool | undefined;
  let schemaCreated = false;

  try {
    await adminPool.query(`create schema ${schemaName}`);
    schemaCreated = true;
    pool = new Pool({
      connectionString: testDatabaseUrl,
      connectionTimeoutMillis: 5_000,
      options: `-c search_path=${schemaName}`
    });
    return await run(pool);
  } finally {
    try {
      if (pool) await pool.end();
      if (schemaCreated) await adminPool.query(`drop schema ${schemaName} cascade`);
    } finally {
      await adminPool.end();
    }
  }
}

describe.skipIf(!testDatabaseUrl)("operational backfill on PostgreSQL 16", () => {
  it("persists a non-empty legacy weekday array", async () => {
    await withPostgresSchema(async (postgres) => {
      await ensurePostgresSchema(postgres);
      await ensureOperationalSchema(postgres);
      await postgres.query(
        `insert into baase_records
          (kind, workspace_id, id, data, created_at, updated_at)
         values ($1, $2, $3, $4::jsonb, $5, $5)`,
        [
          "routine",
          "workspace_a",
          "routine_daily",
          JSON.stringify(routineRecord("workspace_a", {
            id: "routine_daily",
            areaId: null,
            frequency: "daily",
            weekdays: ["mon", "wed", "fri"],
            assigneeProfileIds: [],
            taskTemplates: []
          })),
          timestamp
        ]
      );

      const report = await backfillOperationalData(postgres);

      expect(report.reconciled).toBe(true);
      const routine = await postgres.query<{ weekdays: string[] }>(
        "select weekdays from routines where workspace_id = $1 and id = $2",
        ["workspace_a", "routine_daily"]
      );
      expect(routine.rows[0]?.weekdays).toEqual(["mon", "wed", "fri"]);
    });
  });

  it("actually rolls back a failed workspace without changing legacy rows", async () => {
    await withPostgresSchema(async (postgres) => {
      await ensurePostgresSchema(postgres);
      await ensureOperationalSchema(postgres);
      await postgres.query(
        `insert into baase_records
          (kind, workspace_id, id, data, created_at, updated_at)
         values
          ($1, $2, $3, $4::jsonb, $5, $5),
          ($6, $2, $7, $8::jsonb, $5, $5)`,
        [
          "area",
          "workspace_a",
          "area_ops",
          JSON.stringify(area()),
          timestamp,
          "process",
          "process_close",
          JSON.stringify(processRecord("workspace_a", { ownerProfileId: null }))
        ]
      );
      const failingPool: OperationalBackfillPool = {
        query<T = unknown>(text: string, params?: unknown[]) {
          return postgres.query(text, params) as unknown as Promise<{ rows: T[] }>;
        },
        async connect() {
          const client = await postgres.connect();
          return {
            query<T = unknown>(text: string, params?: unknown[]) {
              if (/insert\s+into\s+processes/i.test(text)) throw new Error("forced process failure");
              return client.query(text, params) as unknown as Promise<{ rows: T[] }>;
            },
            release() {
              client.release();
            }
          };
        }
      };

      await expect(backfillOperationalData(failingPool)).rejects.toThrow("forced process failure");

      const counts = await postgres.query<{
        legacy_count: number;
        area_count: number;
        process_count: number;
      }>(
        `select
          (select count(*)::int from baase_records) as legacy_count,
          (select count(*)::int from areas) as area_count,
          (select count(*)::int from processes) as process_count`
      );
      expect(counts.rows[0]).toEqual({ legacy_count: 2, area_count: 0, process_count: 0 });
    });
  });
});
