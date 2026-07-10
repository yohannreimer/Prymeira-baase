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
});

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
