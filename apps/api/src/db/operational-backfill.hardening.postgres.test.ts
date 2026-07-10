import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { backfillOperationalData, type OperationalBackfillPool } from "./operational-backfill";
import { normalizeRecordForTable } from "./operational-backfill/reconcile";
import { ensureOperationalSchema } from "./operational-schema";
import { ensurePostgresSchema } from "./postgres";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const timestamp = "2026-07-10T12:00:00.000Z";
let schemaSequence = 0;

describe.skipIf(!testDatabaseUrl)("hardened operational backfill on PostgreSQL 16", () => {
  it("accepts an exact rerun and rejects conflicting area, routine, version, and child payloads", async () => {
    await withSchema(async (pool) => {
      await seedCompleteGraph(pool);

      const first = await backfillOperationalData(pool);
      const exactRerun = await backfillOperationalData(pool);

      expect(first.reconciled).toBe(true);
      expect(exactRerun.reconciled).toBe(true);
      expect(exactRerun.insertedTotal).toBe(0);
      expect(exactRerun.conflictingRecords).toEqual([]);

      await pool.query("update areas set name = $3 where workspace_id = $1 and id = $2", [
        "workspace_a", "area_ops", "Area divergente"
      ]);
      await pool.query("update routines set title = $3 where workspace_id = $1 and id = $2", [
        "workspace_a", "routine_open", "Rotina divergente"
      ]);
      await pool.query("update process_versions set body = $3 where workspace_id = $1 and id = $2", [
        "workspace_a", "process_close_version_1", "Versao divergente"
      ]);
      const checklist = await pool.query<{ id: string }>(
        "select id from task_checklist_items where workspace_id = $1 limit 1",
        ["workspace_a"]
      );
      await pool.query("update task_checklist_items set title = $3 where workspace_id = $1 and id = $2", [
        "workspace_a", checklist.rows[0]?.id, "Checklist divergente"
      ]);

      const conflict = await backfillOperationalData(pool);

      expect(conflict.reconciled).toBe(false);
      expect(conflict.conflictingRecords).toEqual(expect.arrayContaining([
        expect.objectContaining({ entityType: "area", entityId: "area_ops" }),
        expect.objectContaining({ entityType: "routine", entityId: "routine_open" }),
        expect.objectContaining({ entityType: "process_version", entityId: "process_close_version_1" }),
        expect.objectContaining({ entityType: "task_checklist_item" })
      ]));
    });
  });

  it("reports duplicate semantic keys from source instead of collapsing them", async () => {
    await withSchema(async (pool) => {
      await seedLegacy(pool, "process", "process_1", {
        title: "Fechamento",
        status: "draft",
        createdByProfileId: "profile_owner",
        createdAt: timestamp,
        updatedAt: timestamp,
        versions: [version("version_1", 1), version("version_2", 1)],
        currentVersion: version("version_1", 1)
      });
      await seedLegacy(pool, "routine", "routine_1", {
        title: "Abertura",
        status: "active",
        frequency: "on_demand",
        createdByProfileId: "profile_owner",
        createdAt: timestamp,
        updatedAt: timestamp,
        taskTemplates: [step("step_1", 1), step("step_2", 1)]
      });
      await seedLegacy(pool, "task_occurrence", "task_1", {
        origin: "manual",
        title: "Conferir caixa",
        status: "pending",
        dueDate: "2026-07-10",
        approvalMode: "direct",
        evidencePolicy: "optional",
        checklistItems: [
          { title: "Primeiro", sortOrder: 1 },
          { title: "Duplicado", sortOrder: 1 }
        ],
        evidence: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      const report = await backfillOperationalData(pool);

      expect(report.reconciled).toBe(false);
      expect(report.conflictingRecords?.map((item) => item.reason)).toEqual(expect.arrayContaining([
        "duplicate source process version number",
        "duplicate source routine step sort order",
        "duplicate source checklist sort order"
      ]));
    });
  });

  it("blocks a legacy writer until the locked source snapshot commits", async () => {
    await withSchema(async (pool, schemaName) => {
      await seedLegacy(pool, "area", "area_initial", area("area_initial", "Inicial"));
      const lockReached = deferred<void>();
      const allowCommit = deferred<void>();
      const migrationPool = wrappingPool(pool, async (text, run) => {
        if (/^commit$/i.test(text.trim())) await allowCommit.promise;
        const result = await run();
        if (/^lock table baase_records/i.test(text.trim())) lockReached.resolve();
        return result;
      });
      const writer = new Pool({
        connectionString: testDatabaseUrl,
        options: `-c search_path=${schemaName}`
      });

      const migration = backfillOperationalData(migrationPool);
      await lockReached.promise;
      let writerFinished = false;
      const write = seedLegacy(writer, "area", "area_late", area("area_late", "Tardia"))
        .then(() => { writerFinished = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(writerFinished).toBe(false);

      allowCommit.resolve();
      const report = await migration;
      await write;
      await writer.end();

      expect(report.sourceCounts.areas).toBe(1);
      expect(writerFinished).toBe(true);
      const legacy = await pool.query<{ count: number }>("select count(*)::int as count from baase_records");
      expect(legacy.rows[0]?.count).toBe(2);
    });
  });

  it("persists 1,100 rows in three batches and remains idempotent", async () => {
    await withSchema(async (pool) => {
      const records = Array.from({ length: 1_100 }, (_, index) => ({
        id: `area_${index}`,
        name: `Area ${index}`
      }));
      await pool.query(
        `insert into baase_records (kind, workspace_id, id, data, created_at, updated_at)
         select 'area', 'workspace_batch', source.id,
           jsonb_build_object(
             'id', source.id,
             'workspaceId', 'workspace_batch',
             'name', source.name,
             'sortOrder', source.sort_order,
             'createdAt', $2::text,
             'updatedAt', $2::text
           ), $2::timestamptz, $2::timestamptz
         from jsonb_to_recordset($1::jsonb) as source(id text, name text, sort_order integer)`,
        [JSON.stringify(records.map((item, sortOrder) => ({ ...item, sort_order: sortOrder }))), timestamp]
      );
      let areaInsertQueries = 0;
      const countedPool = wrappingPool(pool, async (text, run) => {
        if (/^insert into areas/i.test(text.trim())) areaInsertQueries += 1;
        return run();
      });

      const first = await backfillOperationalData(countedPool);
      const firstQueryCount = areaInsertQueries;
      areaInsertQueries = 0;
      const second = await backfillOperationalData(countedPool);

      expect(first.reconciled).toBe(true);
      expect(first.insertedTotal).toBe(1_100);
      expect(firstQueryCount).toBe(3);
      expect(second.reconciled).toBe(true);
      expect(second.insertedTotal).toBe(0);
      expect(areaInsertQueries).toBe(3);
      expect(second.targetCounts.areas).toBe(1_100);
    });
  });

  it("reconciles equivalent timestamp offsets, dates, and times but rejects a different instant", async () => {
    await withSchema(async (pool) => {
      const offsetTimestamp = "2026-07-10T09:00:00.123400-03:00";
      await seedLegacy(pool, "routine", "routine_time", {
        title: "Rotina temporal",
        status: "active",
        frequency: "on_demand",
        taskTemplates: [{ ...step("step_time", 1), dueHint: "09:00" }],
        createdAt: offsetTimestamp,
        updatedAt: offsetTimestamp
      }, offsetTimestamp);
      await seedLegacy(pool, "task_occurrence", "task_time", {
        origin: "routine",
        routineId: "routine_time",
        taskTemplateId: "step_time",
        audienceKey: "all",
        title: "Etapa temporal",
        routineTitleSnapshot: "Rotina temporal",
        stepTitleSnapshot: "Etapa temporal",
        status: "completed",
        dueDate: "2026-07-10",
        dueTime: "09:00",
        approvalMode: "direct",
        evidencePolicy: "optional",
        evidence: null,
        submittedAt: offsetTimestamp,
        completedAt: offsetTimestamp,
        createdAt: offsetTimestamp,
        updatedAt: offsetTimestamp
      }, offsetTimestamp);

      const first = await backfillOperationalData(pool);
      const exact = await backfillOperationalData(pool);

      expect(first.reconciled).toBe(true);
      expect(exact.reconciled).toBe(true);
      expect(exact.insertedTotal).toBe(0);
      const stored = await pool.query<{ due_date: string | Date; due_time: string; submitted_at: Date }>(
        "select due_date, due_time, submitted_at from task_occurrences where id = 'task_time'"
      );
      expect(normalizeRecordForTable("task_occurrences", {
        due_date: stored.rows[0]?.due_date
      })).toEqual({ due_date: "2026-07-10" });
      expect(stored.rows[0]?.due_time).toBe("09:00:00");
      expect(stored.rows[0]?.submitted_at.toISOString()).toBe("2026-07-10T12:00:00.123Z");

      await pool.query(
        "update task_occurrences set submitted_at = submitted_at + interval '1 second' where id = 'task_time'"
      );
      const conflict = await backfillOperationalData(pool);

      expect(conflict.reconciled).toBe(false);
      expect(conflict.conflictingRecords).toContainEqual(expect.objectContaining({
        entityType: "task_occurrence",
        entityId: "task_time",
        reason: "persisted target payload differs from legacy source"
      }));
    });
  });

  it("marks disagreeing routine occurrence contributors unreconciled", async () => {
    await withSchema(async (pool) => {
      await seedLegacy(pool, "routine", "routine_group", {
        title: "Abertura",
        status: "active",
        frequency: "on_demand",
        taskTemplates: [step("step_1", 1), step("step_2", 2)],
        createdAt: timestamp,
        updatedAt: timestamp
      });
      for (const [id, taskTemplateId, routineTitleSnapshot] of [
        ["task_1", "step_1", "Abertura antiga"],
        ["task_2", "step_2", "Abertura divergente"]
      ] satisfies Array<[string, string, string]>) {
        await seedLegacy(pool, "task_occurrence", id, {
          origin: "routine",
          routineId: "routine_group",
          taskTemplateId,
          audienceKey: "all",
          title: taskTemplateId,
          routineTitleSnapshot,
          status: "pending",
          dueDate: "2026-07-10",
          approvalMode: "direct",
          evidencePolicy: "optional",
          evidence: null,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }

      const report = await backfillOperationalData(pool);

      expect(report.reconciled).toBe(false);
      expect(report.sourceCounts.routine_occurrences).toBe(1);
      expect(report.sourceCounts.task_occurrences).toBe(2);
      expect(report.conflictingRecords).toContainEqual(expect.objectContaining({
        entityType: "routine_occurrence",
        reason: "routine occurrence contributors disagree on parent fields",
        expected: expect.objectContaining({ sourceTaskId: "task_1" }),
        actual: expect.objectContaining({ sourceTaskId: "task_2" })
      }));
      const counts = await pool.query<{ parents: number; tasks: number }>(
        `select
          (select count(*)::int from routine_occurrences) as parents,
          (select count(*)::int from task_occurrences) as tasks`
      );
      expect(counts.rows[0]).toEqual({ parents: 1, tasks: 2 });
    });
  });
});

async function withSchema<T>(run: (pool: Pool, schemaName: string) => Promise<T>) {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const admin = new Pool({ connectionString: testDatabaseUrl });
  const schemaName = `baase_hardening_${process.pid}_${Date.now()}_${schemaSequence++}`;
  let pool: Pool | undefined;
  try {
    await admin.query(`create schema ${schemaName}`);
    pool = new Pool({ connectionString: testDatabaseUrl, options: `-c search_path=${schemaName}` });
    await ensurePostgresSchema(pool);
    await ensureOperationalSchema(pool);
    return await run(pool, schemaName);
  } finally {
    if (pool) await pool.end();
    await admin.query(`drop schema if exists ${schemaName} cascade`);
    await admin.end();
  }
}

async function seedCompleteGraph(pool: Pool) {
  await seedLegacy(pool, "area", "area_ops", area("area_ops", "Operacoes"));
  await seedLegacy(pool, "team_member", "profile_owner", person("profile_owner", "owner"));
  await seedLegacy(pool, "team_member", "profile_worker", person("profile_worker", "employee"));
  const processVersion = version("process_close_version_1", 1);
  await seedLegacy(pool, "process", "process_close", {
    title: "Fechamento",
    status: "published",
    areaId: "area_ops",
    ownerProfileId: "profile_owner",
    createdByProfileId: "profile_owner",
    versions: [processVersion],
    currentVersion: processVersion,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: timestamp
  });
  await seedLegacy(pool, "routine", "routine_open", {
    title: "Abertura",
    status: "active",
    frequency: "on_demand",
    areaId: "area_ops",
    assigneeProfileIds: ["profile_owner"],
    createdByProfileId: "profile_owner",
    taskTemplates: [{
      ...step("step_open", 1),
      title: "Abrir caixa",
      processId: "process_close",
      assigneeProfileId: "profile_worker"
    }],
    createdAt: timestamp,
    updatedAt: timestamp
  });
  await seedLegacy(pool, "task_occurrence", "task_open", {
    origin: "routine",
    routineId: "routine_open",
    taskTemplateId: "step_open",
    title: "Abrir caixa",
    areaId: "area_ops",
    processId: "process_close",
    assigneeProfileId: "profile_worker",
    status: "completed",
    dueDate: "2026-07-10",
    approvalMode: "direct",
    evidencePolicy: "photo_or_comment_required",
    checklistItems: [{ title: "Contar cedulas", done: true, sortOrder: 1 }],
    evidence: { comment: "Conferido", photoUrl: "https://files.example/photo.jpg" },
    submittedByProfileId: "profile_worker",
    submittedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function wrappingPool(
  pool: Pool,
  intercept: (text: string, run: () => Promise<{ rows: unknown[] }>) => Promise<{ rows: unknown[] }>
): OperationalBackfillPool {
  return {
    query<T = unknown>(text: string, params?: unknown[]) {
      return pool.query(text, params) as unknown as Promise<{ rows: T[] }>;
    },
    async connect() {
      const client = await pool.connect();
      return {
        query<T = unknown>(text: string, params?: unknown[]) {
          return intercept(
            text,
            () => client.query(text, params) as unknown as Promise<{ rows: unknown[] }>
          ) as Promise<{ rows: T[] }>;
        },
        release() {
          client.release();
        }
      };
    }
  };
}

async function seedLegacy(pool: Pool, kind: string, id: string, data: unknown, rowTimestamp = timestamp) {
  const workspaceId = isObject(data) && typeof data.workspaceId === "string"
    ? data.workspaceId
    : "workspace_a";
  await pool.query(
    `insert into baase_records (kind, workspace_id, id, data, created_at, updated_at)
     values ($1, $2, $3, $4::jsonb, $5, $5)`,
    [kind, workspaceId, id, JSON.stringify(data), rowTimestamp]
  );
}

function area(id: string, name: string) {
  return { id, workspaceId: "workspace_a", name, sortOrder: 1, createdAt: timestamp, updatedAt: timestamp };
}

function person(id: string, role: string) {
  return {
    id,
    workspaceId: "workspace_a",
    name: id,
    role,
    status: "active",
    areaId: "area_ops",
    roleTemplateId: null,
    createdByProfileId: "profile_owner",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function version(id: string, number: number) {
  return {
    id,
    version: number,
    title: "Fechamento",
    body: "Conferir valores",
    changeNote: "Inicial",
    editorProfileId: "profile_owner",
    createdAt: timestamp
  };
}

function step(id: string, sortOrder: number) {
  return {
    id,
    title: id,
    sortOrder,
    processId: null,
    assigneeProfileId: null,
    approvalMode: "direct",
    evidencePolicy: "optional"
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
