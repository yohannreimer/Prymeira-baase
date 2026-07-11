import { describe, expect, it } from "vitest";
import type { TaskStatus } from "@prymeira/baase-shared";
import { parseLegacyWorkspace } from "./legacy-parse";
import type { LegacyRow } from "./types";
import { buildWorkspacePlan } from "./workspace-plan";
import { plannerIndexOperationCount } from "./planner-indexes";

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

  it("expands a partial individual execution into deterministic per-step tasks", () => {
    const rows = individualExecutionRows({
      status: "in_progress",
      checklistItems: [
        { title: "Primeira", sortOrder: 1, done: true, completedAt: timestamp },
        { title: "Segunda", sortOrder: 2, done: false },
        { title: "Terceira", sortOrder: 3, done: false }
      ],
      evidence: { comment: "Execucao registrada", profileId: "profile_1", createdAt: timestamp },
      submittedByProfileId: "profile_1",
      submittedAt: timestamp,
      reviewedByProfileId: "profile_2",
      reviewedAt: timestamp,
      reviewComment: "Revisao legada"
    });

    const first = buildWorkspacePlan("workspace_a", parseLegacyWorkspace("workspace_a", rows));
    const second = buildWorkspacePlan("workspace_a", parseLegacyWorkspace("workspace_a", rows));

    expect(first.sourceCounts.task_occurrences).toBe(1);
    expect(first.sourceCounts.task_checklist_items).toBe(3);
    expect(first.expansionCounts).toEqual({
      individualRoutineAggregates: 1,
      generatedTaskOccurrences: 3,
      checklistProgressDispositions: 3
    });
    expect(first.rows.task_occurrences).toHaveLength(3);
    expect(first.rows.task_checklist_items).toHaveLength(0);
    expect(first.rows.task_occurrences.map((item) => item.values.status)).toEqual([
      "completed", "in_progress", "in_progress"
    ]);
    expect(first.rows.task_occurrences.map((item) => item.entityId))
      .toEqual(second.rows.task_occurrences.map((item) => item.entityId));
    expect(first.rows.task_occurrences[0]?.values).toMatchObject({
      assignee_profile_id: "profile_1",
      approval_mode: "approval_required",
      evidence_policy: "comment_required",
      submitted_by_profile_id: "profile_1",
      reviewed_by_profile_id: "profile_2",
      review_comment: "Revisao legada"
    });
    expect(first.rows.task_occurrences.slice(1).every((item) =>
      item.values.submitted_at === null && item.values.reviewed_at === null)).toBe(true);
    expect(first.rows.task_evidence).toHaveLength(1);
    expect(first.rows.task_evidence[0]?.values.task_occurrence_id)
      .toBe(first.rows.task_occurrences[0]?.entityId);
    expect(first.rows.routine_occurrences).toHaveLength(1);
    expect(first.rows.routine_occurrences[0]?.values.status).toBe("in_progress");
  });

  it("marks every expanded step complete for a completed aggregate without a checklist", () => {
    const plan = buildWorkspacePlan("workspace_a", parseLegacyWorkspace("workspace_a",
      individualExecutionRows({ status: "completed", checklistItems: [] })));

    expect(plan.rows.task_occurrences).toHaveLength(3);
    expect(plan.rows.task_occurrences.every((item) => item.values.status === "completed")).toBe(true);
    expect(plan.rows.routine_occurrences[0]?.values.status).toBe("completed");
  });

  const statusMatrix: Array<{
    status: TaskStatus;
    partial: TaskStatus[];
    full: TaskStatus[];
    missing: TaskStatus[];
  }> = [
    { status: "pending", partial: ["completed", "pending", "pending"], full: ["completed", "completed", "completed"], missing: ["pending", "pending", "pending"] },
    { status: "in_progress", partial: ["completed", "in_progress", "in_progress"], full: ["completed", "completed", "completed"], missing: ["in_progress", "in_progress", "in_progress"] },
    { status: "late", partial: ["completed", "late", "late"], full: ["completed", "completed", "completed"], missing: ["late", "late", "late"] },
    { status: "completed", partial: ["completed", "completed", "completed"], full: ["completed", "completed", "completed"], missing: ["completed", "completed", "completed"] },
    { status: "awaiting_approval", partial: ["awaiting_approval", "awaiting_approval", "awaiting_approval"], full: ["awaiting_approval", "awaiting_approval", "awaiting_approval"], missing: ["awaiting_approval", "awaiting_approval", "awaiting_approval"] },
    { status: "needs_adjustment", partial: ["needs_adjustment", "needs_adjustment", "needs_adjustment"], full: ["needs_adjustment", "needs_adjustment", "needs_adjustment"], missing: ["needs_adjustment", "needs_adjustment", "needs_adjustment"] },
    { status: "dismissed", partial: ["dismissed", "dismissed", "dismissed"], full: ["dismissed", "dismissed", "dismissed"], missing: ["dismissed", "dismissed", "dismissed"] }
  ];
  const checklistCases = [
    {
      name: "partial",
      checklistItems: [
        { title: "Primeira", sortOrder: 1, done: true, completedAt: timestamp },
        { title: "Segunda", sortOrder: 2, done: false },
        { title: "Terceira", sortOrder: 3, done: false }
      ]
    },
    {
      name: "full",
      checklistItems: [
        { title: "Primeira", sortOrder: 1, done: true, completedAt: timestamp },
        { title: "Segunda", sortOrder: 2, done: true, completedAt: timestamp },
        { title: "Terceira", sortOrder: 3, done: true, completedAt: timestamp }
      ]
    },
    { name: "missing", checklistItems: [] }
  ] as const;

  it.each(statusMatrix.flatMap((entry) => checklistCases.map((checklist) => ({
    status: entry.status,
    checklist: checklist.name,
    checklistItems: checklist.checklistItems,
    expected: entry[checklist.name]
  }))))("maps $status with $checklist checklist exactly", ({ status, checklistItems, expected }) => {
    const plan = buildWorkspacePlan("workspace_a", parseLegacyWorkspace("workspace_a",
      individualExecutionRows({ status, checklistItems })));

    expect(plan.rows.task_occurrences.map((item) => item.values.status)).toEqual(expected);
  });

  it.each(["awaiting_approval", "needs_adjustment"] as const)(
    "preserves submission and review provenance on every %s step",
    (status) => {
      const plan = buildWorkspacePlan("workspace_a", parseLegacyWorkspace("workspace_a",
        individualExecutionRows({
          status,
          submittedByProfileId: "profile_1",
          submittedAt: timestamp,
          reviewedByProfileId: "profile_2",
          reviewedAt: timestamp,
          reviewComment: "Corrigir comprovante",
          checklistItems: []
        })));

      expect(plan.rows.task_occurrences.every((item) =>
        item.values.approval_mode === "approval_required"
        && item.values.submitted_by_profile_id === "profile_1"
        && item.values.submitted_at === timestamp
        && item.values.reviewed_by_profile_id === "profile_2"
        && item.values.reviewed_at === timestamp
        && item.values.review_comment === "Corrigir comprovante")).toBe(true);
    }
  );

  it("rejects duplicate aggregate checklist sort orders without positional progress", () => {
    const plan = buildWorkspacePlan("workspace_a", parseLegacyWorkspace("workspace_a",
      individualExecutionRows({
        status: "in_progress",
        checklistItems: [
          { title: "Primeira", sortOrder: 1, done: true },
          { title: "Segunda", sortOrder: 1, done: false }
        ]
      })));

    expect(plan.conflictingRecords).toContainEqual(expect.objectContaining({
      entityId: "aggregate_1",
      reason: "duplicate individual routine checklist sort order"
    }));
    expect(plan.rows.task_occurrences.map((item) => item.values.status))
      .toEqual(["in_progress", "in_progress", "in_progress"]);
  });

  it.each([0, -1])("marks aggregate checklist sort order %s malformed", (sortOrder) => {
    const parsed = parseLegacyWorkspace("workspace_a", individualExecutionRows({
      checklistItems: [{ title: "Primeira", sortOrder, done: true }]
    }));

    expect(parsed.malformedRecords).toContainEqual(expect.objectContaining({
      entityId: "aggregate_1",
      path: "data.checklistItems.0.sortOrder"
    }));
  });

  it("rejects ambiguous duplicate aggregate checklist titles", () => {
    const plan = buildWorkspacePlan("workspace_a", parseLegacyWorkspace("workspace_a",
      individualExecutionRows({
        status: "in_progress",
        checklistItems: [
          { title: "Primeira", done: true },
          { title: "Primeira", done: false },
          { title: "Terceira", done: false }
        ]
      })));

    expect(plan.conflictingRecords).toContainEqual(expect.objectContaining({
      entityId: "aggregate_1",
      reason: "ambiguous individual routine checklist title"
    }));
    expect(plan.rows.task_occurrences.map((item) => item.values.status))
      .toEqual(["in_progress", "in_progress", "in_progress"]);
  });

  it("uses valid explicit aggregate checklist ordering instead of array position", () => {
    const plan = buildWorkspacePlan("workspace_a", parseLegacyWorkspace("workspace_a",
      individualExecutionRows({
        status: "in_progress",
        checklistItems: [
          { title: "Terceira", sortOrder: 3, done: false },
          { title: "Primeira", sortOrder: 1, done: true },
          { title: "Segunda", sortOrder: 2, done: false }
        ]
      })));

    expect(plan.conflictingRecords).toEqual([]);
    expect(plan.rows.task_occurrences.map((item) => item.values.status))
      .toEqual(["completed", "in_progress", "in_progress"]);
  });

  it("does not expand a malformed individual execution suffix", () => {
    const rows = individualExecutionRows({
      taskTemplateId: "routine_1__execution__profile_other"
    });
    const plan = buildWorkspacePlan("workspace_a", parseLegacyWorkspace("workspace_a", rows));

    expect(plan.expansionCounts.individualRoutineAggregates).toBe(0);
    expect(plan.rows.task_occurrences).toHaveLength(1);
    expect(plan.rows.task_occurrences[0]?.values.origin).toBe("manual");
    expect(plan.orphanReferences).toContainEqual(expect.objectContaining({
      entityType: "task_occurrence",
      field: "routine_step_id",
      legacyValue: "routine_1__execution__profile_other"
    }));
  });

  it("keeps normal shared per-step routine tasks unchanged", () => {
    const plan = buildPlanWithRoutineTasks([routineTask("task_shared", "step_1")]);

    expect(plan.expansionCounts.individualRoutineAggregates).toBe(0);
    expect(plan.rows.task_occurrences).toHaveLength(1);
    expect(plan.rows.task_occurrences[0]?.entityId).toBe("task_shared");
    expect(plan.rows.task_occurrences[0]?.values.origin).toBe("routine");
  });

  it("indexes duplicate target ids with linear lookup operations", () => {
    const count = 5_000;
    const rows = Array.from({ length: count }, (_, index) => row("area", `area_${index}`, {
      name: `Area ${index}`,
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    const plan = buildWorkspacePlan("workspace_a", parseLegacyWorkspace("workspace_a", rows));

    expect(plan.rows.areas).toHaveLength(count);
    expect(plannerIndexOperationCount(plan)).toBe(count * 2);
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

function individualExecutionRows(taskOverrides: Record<string, unknown> = {}): LegacyRow[] {
  return [
    row("team_member", "profile_1", {
      name: "Executora",
      role: "employee",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    }),
    row("team_member", "profile_2", {
      name: "Revisora",
      role: "manager",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    }),
    row("routine", "routine_1", {
      title: "Rotina individual",
      status: "active",
      frequency: "on_demand",
      executionMode: "individual",
      assigneeProfileIds: ["profile_1"],
      taskTemplates: [
        step("step_1", 1, "Primeira"),
        step("step_2", 2, "Segunda"),
        step("step_3", 3, "Terceira")
      ],
      createdAt: timestamp,
      updatedAt: timestamp
    }),
    row("task_occurrence", "aggregate_1", {
      origin: "routine",
      routineId: "routine_1",
      taskTemplateId: "routine_1__execution__profile_1",
      assigneeProfileId: "profile_1",
      audienceKey: "profile:profile_1",
      title: "Rotina individual",
      routineTitleSnapshot: "Rotina individual",
      status: "pending",
      dueDate: "2026-07-10",
      dueTime: "09:30",
      approvalMode: "approval_required",
      evidencePolicy: "comment_required",
      evidenceReason: "Registrar execucao",
      evidence: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...taskOverrides
    })
  ];
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
