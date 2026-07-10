import { describe, expect, it } from "vitest";
import { deterministicBackfillId } from "./deterministic-ids";

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

  it("is stable across object key order and isolated by workspace and entity kind", () => {
    const first = deterministicBackfillId("legacy_child", {
      entityKind: "checklist",
      workspaceId: "workspace_a",
      parentId: "task_1",
      sortOrder: 1
    });
    const reordered = deterministicBackfillId("legacy_child", {
      sortOrder: 1,
      parentId: "task_1",
      workspaceId: "workspace_a",
      entityKind: "checklist"
    });
    const otherWorkspace = deterministicBackfillId("legacy_child", {
      entityKind: "checklist",
      workspaceId: "workspace_b",
      parentId: "task_1",
      sortOrder: 1
    });
    const otherKind = deterministicBackfillId("legacy_child", {
      entityKind: "evidence",
      workspaceId: "workspace_a",
      parentId: "task_1",
      sortOrder: 1
    });

    expect(reordered).toBe(first);
    expect(otherWorkspace).not.toBe(first);
    expect(otherKind).not.toBe(first);
  });
});
