export type TaskApprovalMode = "direct" | "approval_required";

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "awaiting_approval"
  | "completed"
  | "needs_adjustment"
  | "late"
  | "dismissed";

type NextTaskStatusInput = {
  approvalMode: TaskApprovalMode;
  hasRequiredEvidence: boolean;
};

export function readNextTaskStatus(input: NextTaskStatusInput): TaskStatus {
  if (!input.hasRequiredEvidence) return "in_progress";
  return input.approvalMode === "approval_required" ? "awaiting_approval" : "completed";
}

export function canSubmitTask(status: TaskStatus) {
  return status === "pending" || status === "in_progress" || status === "needs_adjustment";
}
