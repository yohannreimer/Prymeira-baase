import { describe, expect, it } from "vitest";
import { deterministicBackfillId, type DeterministicIdentityByPrefix } from "./deterministic-ids";

describe("deterministic operational backfill ids", () => {
  it("distinguishes general scope from a real step named general", () => {
    const general = deterministicBackfillId("legacy_assignment", {
      entityKind: "routine_assignment",
      workspaceId: "workspace_a",
      routineId: "routine_1",
      scope: { type: "general" },
      assignee: { type: "profile", id: "profile_1" }
    });
    const step = deterministicBackfillId("legacy_assignment", {
      entityKind: "routine_assignment",
      workspaceId: "workspace_a",
      routineId: "routine_1",
      scope: { type: "step", stepId: "general" },
      assignee: { type: "profile", id: "profile_1" }
    });

    expect(general).not.toBe(step);
  });

  it("is stable across object key order and isolated by workspace and prefix", () => {
    const first = deterministicBackfillId("legacy_checklist", {
      entityKind: "task_checklist_item",
      workspaceId: "workspace_a",
      taskOccurrenceId: "task_1",
      sortOrder: 1
    });
    const reordered = deterministicBackfillId("legacy_checklist", {
      sortOrder: 1,
      taskOccurrenceId: "task_1",
      workspaceId: "workspace_a",
      entityKind: "task_checklist_item"
    });
    const otherWorkspace = deterministicBackfillId("legacy_checklist", {
      entityKind: "task_checklist_item",
      workspaceId: "workspace_b",
      taskOccurrenceId: "task_1",
      sortOrder: 1
    });
    const otherPrefix = deterministicBackfillId("legacy_evidence", {
      entityKind: "task_evidence",
      workspaceId: "workspace_a",
      taskOccurrenceId: "task_1",
      sourceEvidenceId: null,
      sourceIndex: 1,
      evidenceKind: "comment"
    });

    expect(reordered).toBe(first);
    expect(otherWorkspace).not.toBe(first);
    expect(otherPrefix).not.toBe(first);
  });

  it("types every supported prefix and required identity field", () => {
    const identity = {
      entityKind: "routine_step",
      workspaceId: "workspace_a",
      routineId: "routine_1",
      sortOrder: 1
    } satisfies DeterministicIdentityByPrefix["legacy_step"];
    const id: `legacy_step_${string}` = deterministicBackfillId("legacy_step", identity);
    expect(id).toMatch(/^legacy_step_[a-f0-9]{32}$/);

    // @ts-expect-error unsupported prefixes must fail at compile time
    deterministicBackfillId("legacy_stpe", identity);
    // @ts-expect-error sortOrder is required for routine step identity
    deterministicBackfillId("legacy_step", { entityKind: "routine_step", workspaceId: "w", routineId: "r" });
  });
});
