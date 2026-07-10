import { describe, expect, it } from "vitest";
import { parseLegacyWorkspace } from "./legacy-parse";
import type { LegacyRow } from "./types";

const timestamp = "2026-07-10T12:00:00.000Z";

function row(kind: LegacyRow["kind"], id: string, data: unknown): LegacyRow {
  return {
    kind,
    workspace_id: "workspace_a",
    id,
    data,
    created_at: timestamp,
    updated_at: timestamp
  };
}

describe("legacy operational parsing", () => {
  it("reports primitive top-level data with workspace, kind, id, and path", () => {
    const result = parseLegacyWorkspace("workspace_a", [row("area", "area_1", "not-an-object")]);

    expect(result.validRows).toEqual([]);
    expect(result.malformedRecords).toContainEqual(expect.objectContaining({
      workspaceId: "workspace_a",
      kind: "area",
      entityId: "area_1",
      path: "data"
    }));
  });

  it("rejects missing visible names and invalid enums or timestamps", () => {
    const result = parseLegacyWorkspace("workspace_a", [
      row("area", "area_1", { id: "area_1", workspaceId: "workspace_a", createdAt: timestamp, updatedAt: timestamp }),
      row("process", "process_1", {
        id: "process_1",
        workspaceId: "workspace_a",
        title: "Fechamento",
        status: "unknown",
        createdAt: "2026-02-30T12:00:00.000Z",
        updatedAt: timestamp,
        versions: []
      })
    ]);

    expect(result.malformedRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "area", entityId: "area_1", path: "data.name" }),
      expect.objectContaining({ kind: "process", entityId: "process_1", path: "data.status" }),
      expect.objectContaining({ kind: "process", entityId: "process_1", path: "data.createdAt" })
    ]));
  });

  it("reports primitive embedded children with their exact paths", () => {
    const result = parseLegacyWorkspace("workspace_a", [
      row("routine", "routine_1", {
        id: "routine_1",
        workspaceId: "workspace_a",
        title: "Abertura",
        status: "active",
        frequency: "on_demand",
        taskTemplates: ["bad-step"],
        createdByProfileId: "profile_owner",
        createdAt: timestamp,
        updatedAt: timestamp
      }),
      row("task_occurrence", "task_1", {
        id: "task_1",
        workspaceId: "workspace_a",
        origin: "manual",
        title: "Conferir caixa",
        status: "pending",
        dueDate: "2026-07-10",
        approvalMode: "direct",
        evidencePolicy: "optional",
        checklistItems: [42],
        evidence: null,
        createdAt: timestamp,
        updatedAt: timestamp
      })
    ]);

    expect(result.malformedRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "routine", entityId: "routine_1", path: "data.taskTemplates.0" }),
      expect.objectContaining({ kind: "task_occurrence", entityId: "task_1", path: "data.checklistItems.0" })
    ]));
  });

  it("rejects impossible calendar dates and invalid task timestamps or enums", () => {
    const result = parseLegacyWorkspace("workspace_a", [
      row("task_occurrence", "task_1", {
        id: "task_1",
        workspaceId: "workspace_a",
        origin: "manual",
        title: "Conferir caixa",
        status: "unknown",
        dueDate: "2026-02-30",
        approvalMode: "direct",
        evidencePolicy: "optional",
        evidence: null,
        createdAt: timestamp,
        updatedAt: "yesterday"
      })
    ]);

    expect(result.malformedRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "data.status" }),
      expect.objectContaining({ path: "data.dueDate" }),
      expect.objectContaining({ path: "data.updatedAt" })
    ]));
  });

  it("rejects malformed routine schedule arrays", () => {
    const result = parseLegacyWorkspace("workspace_a", [
      row("routine", "routine_1", {
        title: "Semanal",
        status: "active",
        frequency: "weekly",
        weekdays: ["mon", "wed"],
        taskTemplates: [],
        createdAt: timestamp,
        updatedAt: timestamp
      })
    ]);

    expect(result.malformedRecords).toContainEqual(expect.objectContaining({
      kind: "routine",
      entityId: "routine_1",
      path: "data.weekdays"
    }));
  });
});
