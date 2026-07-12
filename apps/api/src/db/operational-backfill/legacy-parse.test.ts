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
  it("preserves valid strings and exact references while rejecting whitespace-only text", () => {
    const valid = row("task_occurrence", "task_spaced", task({
      title: "  Conferir caixa  ",
      areaId: " area exact ",
      areaNameSnapshot: "  Financeiro antigo  ",
      stepTitleSnapshot: "  Conferir comprovante  ",
      reviewComment: "  manter espacos  ",
      evidence: { comment: "  comentario exato  " }
    }));
    const parsed = parseLegacyWorkspace("workspace_a", [
      row("area", "area_spaced", { name: "  Financeiro  " }),
      valid,
      row("area", "area_blank", { name: "   " }),
      row("task_occurrence", "task_blank_ref", task({ areaId: "   " })),
      row("task_occurrence", "task_blank_comment", task({ evidence: { comment: "   " } }))
    ]);

    expect(parsed.validRows[0]?.data.name).toBe("  Financeiro  ");
    expect(parsed.validRows[1]?.data).toMatchObject({
      title: "  Conferir caixa  ",
      areaId: " area exact ",
      areaNameSnapshot: "  Financeiro antigo  ",
      stepTitleSnapshot: "  Conferir comprovante  ",
      reviewComment: "  manter espacos  ",
      evidence: { comment: "  comentario exato  " }
    });
    expect([...new Set(parsed.malformedRecords.map((item) => item.entityId))]).toEqual([
      "area_blank", "task_blank_ref", "task_blank_comment"
    ]);
  });
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

  it.each([
    ["area description", "area", { name: "Operacoes", description: 42 }, "data.description"],
    ["role description", "role_template", { areaId: "area_1", name: "Lider", description: {} }, "data.description"],
    ["person area reference", "team_member", person({ areaId: {} }), "data.areaId"],
    ["person role reference", "team_member", person({ roleTemplateId: {} }), "data.roleTemplateId"],
    ["person owner reference", "team_member", person({ createdByProfileId: {} }), "data.createdByProfileId"],
    ["person email", "team_member", person({ email: [] }), "data.email"],
    ["process owner reference", "process", process({ ownerProfileId: {} }), "data.ownerProfileId"],
    ["process role owner reference", "process", process({ ownerRoleTemplateId: {} }), "data.ownerRoleTemplateId"],
    ["process summary", "process", process({ summary: 42 }), "data.summary"],
    ["process timestamp", "process", process({ publishedAt: "2026-02-30T12:00:00Z" }), "data.publishedAt"],
    ["version editor", "process", process({ versions: [{ ...version(), editorProfileId: {} }] }), "data.versions.0.editorProfileId"],
    ["version body", "process", process({ versions: [{ ...version(), body: 42 }] }), "data.versions.0.body"],
    ["routine area reference", "routine", routine({ areaId: {} }), "data.areaId"],
    ["routine status", "routine", routine({ status: "unknown" }), "data.status"],
    ["routine frequency", "routine", routine({ frequency: "sometimes" }), "data.frequency"],
    ["routine execution mode", "routine", routine({ executionMode: "parallel" }), "data.executionMode"],
    ["routine approval mode", "routine", routine({ approvalMode: "maybe" }), "data.approvalMode"],
    ["routine evidence mode", "routine", routine({ evidencePolicy: "always" }), "data.evidencePolicy"],
    ["routine profile assignments", "routine", routine({ assigneeProfileIds: [{}] }), "data.assigneeProfileIds.0"],
    ["routine role assignments", "routine", routine({ assigneeRoleTemplateIds: [42] }), "data.assigneeRoleTemplateIds.0"],
    ["routine instruction", "routine", routine({ dueHint: {} }), "data.dueHint"],
    ["routine evidence reason", "routine", routine({ evidenceReason: [] }), "data.evidenceReason"],
    ["step id", "routine", routine({ taskTemplates: [{ ...routineStep(), id: 42 }] }), "data.taskTemplates.0.id"],
    ["step sort", "routine", routine({ taskTemplates: [{ ...routineStep(), sortOrder: 1.5 }] }), "data.taskTemplates.0.sortOrder"],
    ["step assignee", "routine", routine({ taskTemplates: [{ ...routineStep(), assigneeProfileId: {} }] }), "data.taskTemplates.0.assigneeProfileId"],
    ["step approval", "routine", routine({ taskTemplates: [{ ...routineStep(), approvalMode: "maybe" }] }), "data.taskTemplates.0.approvalMode"],
    ["step evidence mode", "routine", routine({ taskTemplates: [{ ...routineStep(), evidencePolicy: "always" }] }), "data.taskTemplates.0.evidencePolicy"],
    ["task routine reference", "task_occurrence", task({ routineId: {} }), "data.routineId"],
    ["task process reference", "task_occurrence", task({ processId: {} }), "data.processId"],
    ["task snapshot", "task_occurrence", task({ areaNameSnapshot: 42 }), "data.areaNameSnapshot"],
    ["task routine snapshot", "task_occurrence", task({ routineTitleSnapshot: [] }), "data.routineTitleSnapshot"],
    ["task step snapshot", "task_occurrence", task({ stepTitleSnapshot: {} }), "data.stepTitleSnapshot"],
    ["task assignee", "task_occurrence", task({ assigneeProfileId: {} }), "data.assigneeProfileId"],
    ["task due time", "task_occurrence", task({ dueTime: "25:99" }), "data.dueTime"],
    ["task approval mode", "task_occurrence", task({ approvalMode: "maybe" }), "data.approvalMode"],
    ["task evidence mode", "task_occurrence", task({ evidencePolicy: "always" }), "data.evidencePolicy"],
    ["task submission timestamp", "task_occurrence", task({ submittedAt: "yesterday" }), "data.submittedAt"],
    ["task review timestamp", "task_occurrence", task({ reviewedAt: "2026-02-30T12:00:00Z" }), "data.reviewedAt"],
    ["task completion timestamp", "task_occurrence", task({ completedAt: "tomorrow" }), "data.completedAt"],
    ["checklist done", "task_occurrence", task({ checklistItems: [{ title: "Item", done: "yes" }] }), "data.checklistItems.0.done"],
    ["checklist completion profile", "task_occurrence", task({ checklistItems: [{ title: "Item", completedByProfileId: {} }] }), "data.checklistItems.0.completedByProfileId"],
    ["evidence photo", "task_occurrence", task({ evidence: { comment: "Ok", photoUrl: 42 } }), "data.evidence.photoUrl"],
    ["evidence timestamp", "task_occurrence", task({ evidence: { comment: "Ok", createdAt: "yesterday" } }), "data.evidence.createdAt"]
  ])("rejects a wrong type for consumed optional field: %s", (_label, kind, data, path) => {
    const result = parseLegacyWorkspace("workspace_a", [
      row(kind as LegacyRow["kind"], "entity_1", data)
    ]);

    expect(result.validRows).toEqual([]);
    expect(result.malformedRecords).toContainEqual(expect.objectContaining({
      workspaceId: "workspace_a",
      kind,
      entityId: "entity_1",
      path
    }));
  });

  it("preserves validated optional task and child fields for planning", () => {
    const validTask = task({
      origin: "routine",
      routineId: "routine_1",
      taskTemplateId: "step_1",
      routineStepId: "step_1",
      areaId: "area_1",
      processId: "process_1",
      assigneeProfileId: "profile_1",
      audienceKey: "profile:profile_1",
      areaNameSnapshot: "Operacoes antigas",
      routineTitleSnapshot: "Rotina antiga",
      stepTitleSnapshot: "Etapa antiga",
      dueTime: "09:30:15",
      dueHint: "Antes da abertura",
      evidenceReason: "Foto do caixa",
      submittedByProfileId: "profile_1",
      submittedAt: timestamp,
      reviewedByProfileId: "profile_2",
      reviewedAt: timestamp,
      reviewComment: "Aprovado",
      completedAt: timestamp,
      checklistItems: [{
        id: "check_1",
        title: "Conferir",
        sortOrder: 1,
        done: true,
        completedByProfileId: "profile_1",
        completedAt: timestamp
      }],
      evidence: {
        id: "evidence_1",
        profileId: "profile_1",
        comment: "Conferido",
        photoUrl: "https://files.example/photo.jpg",
        objectKey: "tasks/photo.jpg",
        createdAt: timestamp
      }
    });

    const result = parseLegacyWorkspace("workspace_a", [row("task_occurrence", "task_1", validTask)]);

    expect(result.malformedRecords).toEqual([]);
    expect(result.validRows[0]?.data).toMatchObject(validTask);
  });

  it.each([
    ["absent without references", undefined, undefined, undefined, true, undefined],
    ["absent with both references", undefined, "routine_1", "step_1", true, undefined],
    ["absent with only routine", undefined, "routine_1", undefined, false, "data.taskTemplateId"],
    ["absent with only step", undefined, undefined, "step_1", false, "data.routineId"],
    ["manual without references", "manual", undefined, undefined, true, undefined],
    ["manual with routine", "manual", "routine_1", undefined, false, "data.origin"],
    ["manual with step", "manual", undefined, "step_1", false, "data.origin"],
    ["manual with both references", "manual", "routine_1", "step_1", false, "data.origin"],
    ["routine with both references", "routine", "routine_1", "step_1", true, undefined],
    ["routine without references", "routine", undefined, undefined, false, "data.routineId"],
    ["routine with only routine", "routine", "routine_1", undefined, false, "data.taskTemplateId"],
    ["routine with only step", "routine", undefined, "step_1", false, "data.routineId"]
  ])("validates origin/reference consistency: %s", (
    _label,
    origin,
    routineId,
    taskTemplateId,
    valid,
    malformedPath
  ) => {
    const result = parseLegacyWorkspace("workspace_a", [row("task_occurrence", "task_1", task({
      origin,
      routineId,
      taskTemplateId
    }))]);

    expect(result.validRows).toHaveLength(valid ? 1 : 0);
    if (malformedPath) {
      expect(result.malformedRecords).toContainEqual(expect.objectContaining({
        workspaceId: "workspace_a",
        kind: "task_occurrence",
        entityId: "task_1",
        path: malformedPath
      }));
    } else {
      expect(result.malformedRecords).toEqual([]);
    }
  });
});

function person(overrides: Record<string, unknown> = {}) {
  return {
    name: "Pessoa",
    role: "employee",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function version() {
  return {
    id: "version_1",
    version: 1,
    title: "Processo",
    body: "Corpo",
    changeNote: "Inicial",
    editorProfileId: "profile_1",
    createdAt: timestamp
  };
}

function process(overrides: Record<string, unknown> = {}) {
  return {
    title: "Processo",
    status: "draft",
    versions: [version()],
    currentVersion: version(),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function routineStep() {
  return {
    id: "step_1",
    title: "Etapa",
    sortOrder: 1,
    approvalMode: "direct",
    evidencePolicy: "optional"
  };
}

function routine(overrides: Record<string, unknown> = {}) {
  return {
    title: "Rotina",
    status: "active",
    frequency: "on_demand",
    taskTemplates: [routineStep()],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    origin: "manual",
    title: "Tarefa",
    status: "pending",
    dueDate: "2026-07-10",
    approvalMode: "direct",
    evidencePolicy: "optional",
    evidence: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}
