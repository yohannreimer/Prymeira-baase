import { describe, expect, it } from "vitest";
import {
  canSubmitTask,
  readNextTaskStatus,
  type TaskApprovalMode,
  type TaskStatus
} from "./task-state";

describe("task execution state", () => {
  it.each<[TaskApprovalMode, TaskStatus]>([
    ["direct", "completed"],
    ["approval_required", "awaiting_approval"]
  ])("moves submitted tasks to %s when approval mode is %s", (approvalMode, expectedStatus) => {
    expect(readNextTaskStatus({ approvalMode, hasRequiredEvidence: true })).toBe(expectedStatus);
  });

  it("keeps a task in progress when required evidence is missing", () => {
    expect(readNextTaskStatus({ approvalMode: "direct", hasRequiredEvidence: false })).toBe("in_progress");
  });

  it("allows submission only from actionable task states", () => {
    expect(canSubmitTask("pending")).toBe(true);
    expect(canSubmitTask("in_progress")).toBe(true);
    expect(canSubmitTask("needs_adjustment")).toBe(true);
    expect(canSubmitTask("completed")).toBe(false);
    expect(canSubmitTask("awaiting_approval")).toBe(false);
  });
});
