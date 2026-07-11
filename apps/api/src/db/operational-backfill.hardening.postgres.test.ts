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
      let areaSourcePageQueries = 0;
      const countedPool = wrappingPool(pool, async (text, run, params) => {
        if (/^insert into areas/i.test(text.trim())) areaInsertQueries += 1;
        if (/from baase_records[\s\S]*where workspace_id = \$1[\s\S]*kind = \$2/i.test(text)) {
          if (params?.[1] === "area") areaSourcePageQueries += 1;
        }
        return run();
      });

      const first = await backfillOperationalData(countedPool);
      const firstQueryCount = areaInsertQueries;
      const firstSourcePageCount = areaSourcePageQueries;
      areaInsertQueries = 0;
      areaSourcePageQueries = 0;
      const second = await backfillOperationalData(countedPool);

      expect(first.reconciled).toBe(true);
      expect(first.insertedTotal).toBe(1_100);
      expect(firstQueryCount).toBe(3);
      expect(firstSourcePageCount).toBe(3);
      expect(second.reconciled).toBe(true);
      expect(second.insertedTotal).toBe(0);
      expect(areaInsertQueries).toBe(3);
      expect(areaSourcePageQueries).toBe(3);
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

  it("detects routine parent disagreement across task source pages", async () => {
    await withSchema(async (pool) => {
      await seedLegacy(pool, "routine", "routine_paged", {
        title: "Rotina paginada",
        status: "active",
        frequency: "on_demand",
        taskTemplates: [step("step_1", 1), step("step_2", 2)],
        createdAt: timestamp,
        updatedAt: timestamp
      });
      const tasks = [
        pagedRoutineTask("task_0000_group", "step_1", "Titulo inicial"),
        ...Array.from({ length: 499 }, (_, index) => ({
          id: `task_${String(index + 1).padStart(4, "0")}`,
          data: {
            origin: "manual",
            title: `Tarefa ${index + 1}`,
            status: "pending",
            dueDate: "2026-07-10",
            approvalMode: "direct",
            evidencePolicy: "optional",
            evidence: null,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        })),
        pagedRoutineTask("task_0500_group", "step_2", "Titulo divergente")
      ];
      await seedTaskBatch(pool, tasks);
      let taskSourcePages = 0;
      const countedPool = wrappingPool(pool, async (text, run, params) => {
        if (/from baase_records[\s\S]*where workspace_id = \$1[\s\S]*kind = \$2/i.test(text)
          && params?.[1] === "task_occurrence") taskSourcePages += 1;
        return run();
      });

      const report = await backfillOperationalData(countedPool);

      expect(taskSourcePages).toBeGreaterThanOrEqual(2);
      expect(report.sourceCounts.task_occurrences).toBe(501);
      expect(report.sourceCounts.routine_occurrences).toBe(1);
      expect(report.reconciled).toBe(false);
      expect(report.conflictingRecords).toContainEqual(expect.objectContaining({
        entityType: "routine_occurrence",
        reason: "routine occurrence contributors disagree on parent fields",
        expected: expect.objectContaining({ sourceTaskId: "task_0000_group" }),
        actual: expect.objectContaining({ sourceTaskId: "task_0500_group" })
      }));
    });
  });

  it("expands an individual execution idempotently without duplicating aggregate provenance", async () => {
    await withSchema(async (pool) => {
      await seedLegacy(pool, "area", "area_ops", area("area_ops", "Operacoes"));
      await seedLegacy(pool, "team_member", "profile_worker", {
        name: "Executora",
        role: "employee",
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      const processVersion = version("version_individual", 1);
      await seedLegacy(pool, "process", "process_individual", {
        title: "Processo individual",
        status: "published",
        areaId: "area_ops",
        versions: [processVersion],
        currentVersion: processVersion,
        createdAt: timestamp,
        updatedAt: timestamp,
        publishedAt: timestamp
      });
      await seedLegacy(pool, "routine", "routine_individual", {
        title: "Rotina individual",
        status: "active",
        frequency: "on_demand",
        executionMode: "individual",
        areaId: "area_ops",
        assigneeProfileIds: ["profile_worker"],
        taskTemplates: [
          { ...step("step_1", 1), title: "Primeira", processId: "process_individual" },
          { ...step("step_2", 2), title: "Segunda", processId: "process_individual" },
          { ...step("step_3", 3), title: "Terceira", processId: "process_individual" }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      });
      await seedLegacy(pool, "task_occurrence", "aggregate_1", {
        origin: "routine",
        routineId: "routine_individual",
        taskTemplateId: "routine_individual__execution__profile_worker",
        assigneeProfileId: "profile_worker",
        audienceKey: "profile:profile_worker",
        title: "Rotina individual",
        status: "in_progress",
        dueDate: "2026-07-10",
        dueTime: "09:30",
        approvalMode: "approval_required",
        evidencePolicy: "comment_required",
        checklistItems: [
          { title: "Primeira", done: true, sortOrder: 1, completedAt: timestamp },
          { title: "Segunda", done: false, sortOrder: 2 },
          { title: "Terceira", done: false, sortOrder: 3 }
        ],
        evidence: { comment: "Historico agregado", profileId: "profile_worker" },
        submittedByProfileId: "profile_worker",
        submittedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      const first = await backfillOperationalData(pool);
      const second = await backfillOperationalData(pool);

      expect(first.reconciled).toBe(true);
      expect(first.expansionCounts).toEqual({
        individualRoutineAggregates: 1,
        generatedTaskOccurrences: 3,
        checklistProgressDispositions: 3
      });
      expect(second.reconciled).toBe(true);
      expect(second.insertedTotal).toBe(0);
      expect(second.expansionCounts).toEqual(first.expansionCounts);
      const tasks = await pool.query<{
        status: string;
        approval_mode: string;
        evidence_policy: string;
        area_id: string;
        process_id: string;
        area_name_snapshot: string;
      }>(
        `select status, approval_mode, evidence_policy, area_id, process_id, area_name_snapshot
         from task_occurrences where workspace_id = 'workspace_a' order by title`
      );
      expect(tasks.rows).toHaveLength(3);
      expect(tasks.rows.map((item) => item.status).sort()).toEqual(["completed", "in_progress", "in_progress"]);
      expect(tasks.rows.every((item) => item.approval_mode === "approval_required"
        && item.evidence_policy === "comment_required")).toBe(true);
      expect(tasks.rows.every((item) => item.area_id === "area_ops"
        && item.process_id === "process_individual"
        && item.area_name_snapshot === "Operacoes")).toBe(true);
      const evidence = await pool.query<{ count: number }>(
        "select count(*)::int as count from task_evidence where workspace_id = 'workspace_a'"
      );
      expect(evidence.rows[0]?.count).toBe(1);
    });
  });

  it.each([
    {
      name: "duplicate sort order",
      checklistItems: [
        { title: "Primeira", sortOrder: 1, done: true },
        { title: "Segunda", sortOrder: 1, done: false }
      ],
      reason: "duplicate individual routine checklist sort order"
    },
    {
      name: "zero sort order",
      checklistItems: [{ title: "Primeira", sortOrder: 0, done: true }],
      malformedPath: "data.checklistItems.0.sortOrder"
    },
    {
      name: "negative sort order",
      checklistItems: [{ title: "Primeira", sortOrder: -1, done: true }],
      malformedPath: "data.checklistItems.0.sortOrder"
    },
    {
      name: "ambiguous duplicate titles",
      checklistItems: [
        { title: "Primeira", done: true },
        { title: "Primeira", done: false },
        { title: "Terceira", done: false }
      ],
      reason: "ambiguous individual routine checklist title"
    }
  ])("rejects $name in an aggregate checklist", async ({ checklistItems, reason, malformedPath }) => {
    await withSchema(async (pool) => {
      await seedIndividualAggregate(pool, checklistItems);

      const report = await backfillOperationalData(pool);

      expect(report.reconciled).toBe(false);
      if (reason) {
        expect(report.conflictingRecords).toContainEqual(expect.objectContaining({
          entityId: "aggregate_ordering",
          reason
        }));
      }
      if (malformedPath) {
        expect(report.malformedRecords).toContainEqual(expect.objectContaining({
          entityId: "aggregate_ordering",
          path: malformedPath
        }));
      }
    });
  });

  it("maps a valid explicitly ordered aggregate checklist deterministically", async () => {
    await withSchema(async (pool) => {
      await seedIndividualAggregate(pool, [
        { title: "Terceira", sortOrder: 3, done: false },
        { title: "Primeira", sortOrder: 1, done: true, completedAt: timestamp },
        { title: "Segunda", sortOrder: 2, done: false }
      ]);

      const report = await backfillOperationalData(pool);
      const statuses = await pool.query<{ title: string; status: string }>(
        "select title, status from task_occurrences order by routine_step_id"
      );

      expect(report.reconciled).toBe(true);
      expect(statuses.rows).toEqual([
        { title: "Primeira", status: "completed" },
        { title: "Segunda", status: "in_progress" },
        { title: "Terceira", status: "in_progress" }
      ]);
    });
  });

  it("pages more than 1,100 individual routine steps with bounded reference and insert batches", async () => {
    await withSchema(async (pool) => {
      const stepCount = 1_101;
      const taskTemplates = Array.from({ length: stepCount }, (_, index) => ({
        ...step(`paged_step_${String(index + 1).padStart(4, "0")}`, index + 1),
        title: `Etapa ${index + 1}`
      }));
      await seedLegacy(pool, "team_member", "profile_paged", {
        name: "Executora paginada",
        role: "employee",
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      await seedLegacy(pool, "routine", "routine_individual_paged", {
        title: "Rotina individual paginada",
        status: "active",
        frequency: "on_demand",
        executionMode: "individual",
        assigneeProfileIds: ["profile_paged"],
        taskTemplates,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      await seedLegacy(pool, "task_occurrence", "aggregate_paged", {
        origin: "routine",
        routineId: "routine_individual_paged",
        taskTemplateId: "routine_individual_paged__execution__profile_paged",
        assigneeProfileId: "profile_paged",
        audienceKey: "profile:profile_paged",
        title: "Rotina individual paginada",
        status: "late",
        dueDate: "2026-07-10",
        approvalMode: "approval_required",
        evidencePolicy: "comment_required",
        checklistItems: taskTemplates.map((item, index) => ({
          title: item.title,
          sortOrder: item.sortOrder,
          done: index < 550,
          completedAt: index < 550 ? timestamp : undefined
        })),
        evidence: { comment: "Historico paginado", profileId: "profile_paged" },
        submittedByProfileId: "profile_paged",
        submittedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      let stepReferencePages = 0;
      let taskInsertQueries = 0;
      let largestTaskInsertBatch = 0;
      const countedPool = wrappingPool(pool, async (text, run, params) => {
        if (/from routine_steps[\s\S]*where workspace_id = \$1[\s\S]*routine_id = \$2[\s\S]*order by sort_order, id[\s\S]*limit/i.test(text)) {
          stepReferencePages += 1;
        }
        if (/^insert into task_occurrences/i.test(text.trim())) {
          taskInsertQueries += 1;
          largestTaskInsertBatch = Math.max(largestTaskInsertBatch, Number(params?.length ?? 0) / 27);
        }
        return run();
      });

      const first = await backfillOperationalData(countedPool);
      const firstReferencePages = stepReferencePages;
      const firstInsertQueries = taskInsertQueries;
      const firstLargestInsertBatch = largestTaskInsertBatch;
      stepReferencePages = 0;
      taskInsertQueries = 0;
      largestTaskInsertBatch = 0;
      const second = await backfillOperationalData(countedPool);
      const counts = await pool.query<{ completed: number; late: number; evidence: number }>(
        `select
          count(*) filter (where status = 'completed')::int as completed,
          count(*) filter (where status = 'late')::int as late,
          (select count(*)::int from task_evidence) as evidence
         from task_occurrences`
      );

      expect(first.reconciled).toBe(true);
      expect(first.expansionCounts).toEqual({
        individualRoutineAggregates: 1,
        generatedTaskOccurrences: stepCount,
        checklistProgressDispositions: stepCount
      });
      expect(firstReferencePages).toBe(3);
      expect(firstInsertQueries).toBe(3);
      expect(firstLargestInsertBatch).toBeLessThanOrEqual(500);
      expect(counts.rows[0]).toEqual({ completed: 550, late: 551, evidence: 1 });
      expect(second.reconciled).toBe(true);
      expect(second.insertedTotal).toBe(0);
      expect(stepReferencePages).toBe(3);
      expect(taskInsertQueries).toBe(3);
      expect(largestTaskInsertBatch).toBeLessThanOrEqual(500);
    });
  });

  it("bounds thousands of malformed and staged conflict diagnostics with exact totals", async () => {
    await withSchema(async (pool) => {
      await seedLegacy(pool, "routine", "routine_diagnostics", {
        title: "Diagnosticos",
        status: "active",
        frequency: "on_demand",
        taskTemplates: [step("diagnostic_step", 1)],
        createdAt: timestamp,
        updatedAt: timestamp
      });
      await seedTaskBatch(pool, [
        ...Array.from({ length: 1_100 }, (_, index) => ({
          id: `malformed_${String(index).padStart(4, "0")}`,
          data: {
            origin: "manual",
            title: "   ",
            status: "pending",
            dueDate: "2026-07-10",
            approvalMode: "direct",
            evidencePolicy: "optional",
            evidence: null,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        })),
        ...Array.from({ length: 1_101 }, (_, index) => ({
          id: `valid_${String(index).padStart(4, "0")}`,
          data: {
            origin: "routine",
            routineId: "routine_diagnostics",
            taskTemplateId: "diagnostic_step",
            audienceKey: "all",
            title: "diagnostic_step",
            routineTitleSnapshot: "Diagnosticos",
            status: "pending",
            dueDate: "2026-07-10",
            approvalMode: "direct",
            evidencePolicy: "optional",
            evidence: null,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        }))
      ]);
      let largestStageConflictRead = 0;
      const countedPool = wrappingPool(pool, async (text, run) => {
        const result = await run();
        if (/join duplicates[\s\S]*limit \$2/i.test(text)) {
          largestStageConflictRead = Math.max(largestStageConflictRead, result.rows.length);
        }
        return result;
      });

      const first = await backfillOperationalData(countedPool);
      const second = await backfillOperationalData(countedPool);

      expect(first.reconciled).toBe(false);
      expect(first.malformedRecords).toHaveLength(100);
      expect(first.conflictingRecords).toHaveLength(100);
      expect(first.diagnostics).toMatchObject({
        categories: {
          malformedRecords: { total: 1_100, sampled: 100, truncated: true },
          conflictingRecords: { total: 1_100, sampled: 100, truncated: true }
        },
        global: { total: 2_200, sampled: 200, truncated: true },
        categorySampleCap: 100,
        globalSampleCap: 250
      });
      expect(first.malformedRecords?.[0]?.entityId).toBe("malformed_0000");
      expect(first.conflictingRecords?.[0]?.actual).toEqual({ sourceTaskId: "valid_0001" });
      expect(second.malformedRecords).toEqual(first.malformedRecords);
      expect(second.conflictingRecords).toEqual(first.conflictingRecords);
      expect(second.diagnostics).toEqual(first.diagnostics);
      expect(largestStageConflictRead).toBeLessThanOrEqual(200);
    });
  });

  it("preserves spaced PostgreSQL text and exact reference identities byte-for-byte", async () => {
    await withSchema(async (pool) => {
      await seedLegacy(pool, "area", " area exact ", {
        name: "  Financeiro  ",
        sortOrder: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      await seedLegacy(pool, "team_member", " profile exact ", {
        name: "  Responsavel  ",
        role: "employee",
        status: "active",
        areaId: " area exact ",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      await seedLegacy(pool, "task_occurrence", "task_spaced", {
        origin: "manual",
        title: "  Conferir caixa  ",
        areaId: " area exact ",
        assigneeProfileId: " profile exact ",
        areaNameSnapshot: "  Financeiro antigo  ",
        stepTitleSnapshot: "  Conferir comprovante  ",
        status: "pending",
        dueDate: "2026-07-10",
        approvalMode: "direct",
        evidencePolicy: "optional",
        evidence: { profileId: " profile exact ", comment: "  comentario exato  " },
        createdAt: timestamp,
        updatedAt: timestamp
      });

      const report = await backfillOperationalData(pool);
      const task = await pool.query<{
        title: string; area_id: string; assignee_profile_id: string;
        area_name_snapshot: string; step_title_snapshot: string;
      }>("select title, area_id, assignee_profile_id, area_name_snapshot, step_title_snapshot from task_occurrences");
      const evidence = await pool.query<{ comment: string; profile_id: string }>(
        "select comment, profile_id from task_evidence"
      );

      expect(report.reconciled).toBe(true);
      expect(task.rows[0]).toEqual({
        title: "  Conferir caixa  ",
        area_id: " area exact ",
        assignee_profile_id: " profile exact ",
        area_name_snapshot: "  Financeiro antigo  ",
        step_title_snapshot: "  Conferir comprovante  "
      });
      expect(evidence.rows[0]).toEqual({
        comment: "  comentario exato  ",
        profile_id: " profile exact "
      });
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

async function seedIndividualAggregate(pool: Pool, checklistItems: unknown[]) {
  await seedLegacy(pool, "team_member", "profile_ordering", {
    name: "Executora",
    role: "employee",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  });
  await seedLegacy(pool, "routine", "routine_ordering", {
    title: "Rotina ordenada",
    status: "active",
    frequency: "on_demand",
    executionMode: "individual",
    assigneeProfileIds: ["profile_ordering"],
    taskTemplates: [
      { ...step("ordering_step_1", 1), title: "Primeira" },
      { ...step("ordering_step_2", 2), title: "Segunda" },
      { ...step("ordering_step_3", 3), title: "Terceira" }
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  });
  await seedLegacy(pool, "task_occurrence", "aggregate_ordering", {
    origin: "routine",
    routineId: "routine_ordering",
    taskTemplateId: "routine_ordering__execution__profile_ordering",
    assigneeProfileId: "profile_ordering",
    audienceKey: "profile:profile_ordering",
    title: "Rotina ordenada",
    status: "in_progress",
    dueDate: "2026-07-10",
    approvalMode: "approval_required",
    evidencePolicy: "optional",
    checklistItems,
    evidence: null,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function wrappingPool(
  pool: Pool,
  intercept: (
    text: string,
    run: () => Promise<{ rows: unknown[] }>,
    params?: unknown[]
  ) => Promise<{ rows: unknown[] }>
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
            () => client.query(text, params) as unknown as Promise<{ rows: unknown[] }>,
            params
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

async function seedTaskBatch(pool: Pool, tasks: Array<{ id: string; data: unknown }>) {
  await pool.query(
    `insert into baase_records (kind, workspace_id, id, data, created_at, updated_at)
     select 'task_occurrence', 'workspace_a', source.id, source.data, $2::timestamptz, $2::timestamptz
     from jsonb_to_recordset($1::jsonb) as source(id text, data jsonb)`,
    [JSON.stringify(tasks), timestamp]
  );
}

function pagedRoutineTask(id: string, taskTemplateId: string, routineTitleSnapshot: string) {
  return {
    id,
    data: {
      origin: "routine",
      routineId: "routine_paged",
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
    }
  };
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
