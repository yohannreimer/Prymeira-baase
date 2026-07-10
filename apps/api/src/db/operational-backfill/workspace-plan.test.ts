import { describe, expect, it } from "vitest";
import { parseLegacyWorkspace } from "./legacy-parse";
import type { LegacyRow } from "./types";
import { buildWorkspacePlan } from "./workspace-plan";

const timestamp = "2026-07-10T12:00:00.000Z";

function row(kind: LegacyRow["kind"], id: string, data: Record<string, unknown>): LegacyRow {
  return { kind, workspace_id: "workspace_a", id, data, created_at: timestamp, updated_at: timestamp };
}

describe("operational workspace planning", () => {
  it("records duplicate process versions, routine step orders, and checklist orders", () => {
    const rows = [
      row("process", "process_1", {
        title: "Fechamento",
        status: "draft",
        createdByProfileId: "profile_owner",
        createdAt: timestamp,
        updatedAt: timestamp,
        versions: [
          version("version_1", 1, "Primeira"),
          version("version_duplicate", 1, "Duplicada")
        ],
        currentVersion: version("version_1", 1, "Primeira")
      }),
      row("routine", "routine_1", {
        title: "Abertura",
        status: "active",
        frequency: "on_demand",
        createdByProfileId: "profile_owner",
        createdAt: timestamp,
        updatedAt: timestamp,
        taskTemplates: [
          step("step_1", 1, "Abrir"),
          step("step_2", 1, "Conferir")
        ]
      }),
      row("task_occurrence", "task_1", {
        origin: "manual",
        title: "Conferir caixa",
        status: "pending",
        dueDate: "2026-07-10",
        approvalMode: "direct",
        evidencePolicy: "optional",
        createdAt: timestamp,
        updatedAt: timestamp,
        evidence: null,
        checklistItems: [
          { title: "Primeiro", sortOrder: 1 },
          { title: "Duplicado", sortOrder: 1 }
        ]
      })
    ];

    const parsed = parseLegacyWorkspace("workspace_a", rows);
    const plan = buildWorkspacePlan("workspace_a", parsed);

    expect(plan.sourceCounts.process_versions).toBe(2);
    expect(plan.sourceCounts.routine_steps).toBe(2);
    expect(plan.sourceCounts.task_checklist_items).toBe(2);
    expect(plan.conflictingRecords.map((item) => item.reason)).toEqual(expect.arrayContaining([
      "duplicate source process version number",
      "duplicate source routine step sort order",
      "duplicate source checklist sort order"
    ]));
    expect(plan.rows.process_versions).toHaveLength(1);
    expect(plan.rows.routine_steps).toHaveLength(1);
    expect(plan.rows.task_checklist_items).toHaveLength(1);
  });

  it("groups matching routine steps into one parent occurrence", () => {
    const plan = buildPlanWithRoutineTasks([
      routineTask("task_1", "step_1", {
        routineTitleSnapshot: "Abertura",
        areaNameSnapshot: "Operacoes"
      }),
      routineTask("task_2", "step_2", {
        routineTitleSnapshot: "Abertura",
        areaNameSnapshot: "Operacoes"
      })
    ]);

    expect(plan.sourceCounts.routine_occurrences).toBe(1);
    expect(plan.sourceCounts.task_occurrences).toBe(2);
    expect(plan.rows.routine_occurrences).toHaveLength(1);
    expect(plan.rows.task_occurrences).toHaveLength(2);
    expect(plan.conflictingRecords).toEqual([]);
  });

  it("reports disagreeing routine parent snapshots with paths and source task ids", () => {
    const plan = buildPlanWithRoutineTasks([
      routineTask("task_1", "step_1", {
        routineTitleSnapshot: "Abertura antiga",
        areaNameSnapshot: "Operacoes antigas"
      }),
      routineTask("task_2", "step_2", {
        routineTitleSnapshot: "Abertura divergente",
        areaNameSnapshot: "Financeiro antigo"
      })
    ]);

    expect(plan.sourceCounts.routine_occurrences).toBe(1);
    expect(plan.conflictingRecords).toContainEqual(expect.objectContaining({
      entityType: "routine_occurrence",
      reason: "routine occurrence contributors disagree on parent fields",
      expected: expect.objectContaining({ sourceTaskId: "task_1" }),
      actual: expect.objectContaining({
        sourceTaskId: "task_2",
        paths: ["area_name_snapshot", "routine_title_snapshot"]
      })
    }));
  });

  it("reports two source tasks for the same routine step semantic key", () => {
    const plan = buildPlanWithRoutineTasks([
      routineTask("task_1", "step_1"),
      routineTask("task_2", "step_1")
    ]);

    expect(plan.sourceCounts.routine_occurrences).toBe(1);
    expect(plan.sourceCounts.task_occurrences).toBe(2);
    expect(plan.conflictingRecords).toContainEqual(expect.objectContaining({
      entityType: "task_occurrence",
      entityId: "task_2",
      reason: "duplicate source routine task semantic key",
      expected: { sourceTaskId: "task_1" },
      actual: { sourceTaskId: "task_2" }
    }));
  });

  it("never exposes resolved reference ids as visible snapshots", () => {
    const plan = buildPlanWithRoutineTasks([
      routineTask("task_1", "step_1", {
        areaNameSnapshot: "area_1",
        routineTitleSnapshot: "routine_1",
        stepTitleSnapshot: "step_1"
      })
    ]);

    expect(plan.rows.task_occurrences[0]?.values).toMatchObject({
      area_name_snapshot: "Operacoes",
      routine_title_snapshot: "Abertura",
      step_title_snapshot: "Abrir"
    });
    expect(plan.rows.routine_occurrences[0]?.values).toMatchObject({
      area_name_snapshot: "Operacoes",
      routine_title_snapshot: "Abertura"
    });
  });
});

function buildPlanWithRoutineTasks(tasks: LegacyRow[]) {
  const rows = [
    row("area", "area_1", {
      name: "Operacoes",
      sortOrder: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    }),
    row("routine", "routine_1", {
      title: "Abertura",
      status: "active",
      frequency: "on_demand",
      areaId: "area_1",
      taskTemplates: [
        step("step_1", 1, "Abrir"),
        step("step_2", 2, "Conferir")
      ],
      createdAt: timestamp,
      updatedAt: timestamp
    }),
    ...tasks
  ];
  return buildWorkspacePlan("workspace_a", parseLegacyWorkspace("workspace_a", rows));
}

function routineTask(id: string, taskTemplateId: string, overrides: Record<string, unknown> = {}) {
  return row("task_occurrence", id, {
    origin: "routine",
    routineId: "routine_1",
    taskTemplateId,
    areaId: "area_1",
    audienceKey: "all",
    title: taskTemplateId === "step_1" ? "Abrir" : "Conferir",
    status: "pending",
    dueDate: "2026-07-10",
    approvalMode: "direct",
    evidencePolicy: "optional",
    evidence: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

function version(id: string, versionNumber: number, body: string) {
  return {
    id,
    version: versionNumber,
    title: "Fechamento",
    body,
    changeNote: "Legado",
    editorProfileId: "profile_owner",
    createdAt: timestamp
  };
}

function step(id: string, sortOrder: number, title: string) {
  return {
    id,
    title,
    sortOrder,
    processId: null,
    assigneeProfileId: null,
    approvalMode: "direct",
    evidencePolicy: "optional"
  };
}
