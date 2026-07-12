import type { TaskApprovalMode, TaskStatus } from "@prymeira/baase-shared";

export type EvidencePolicy = "optional" | "photo_required" | "comment_required" | "photo_or_comment_required";
export type RoutineFrequency = "daily" | "weekly" | "monthly" | "on_demand";
export type RoutineWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type RoutineExecutionMode = "shared" | "individual";

export type TaskEvidence = {
  comment: string | null;
  photoUrl: string | null;
  attachment?: TaskEvidenceAttachment | null;
};

export type TaskEvidenceAttachment = {
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** Generated only while presenting an attachment to an authorized caller. */
  url?: string;
};

export type RoutineTaskTemplate = {
  id: string;
  routineId: string;
  workspaceId: string;
  title: string;
  processId: string | null;
  assigneeProfileId: string | null;
  dueHint?: string | null;
  approvalMode: TaskApprovalMode;
  evidencePolicy: EvidencePolicy;
  sortOrder: number;
};

export type CompanyRoutine = {
  id: string;
  workspaceId: string;
  areaId: string | null;
  title: string;
  status: "active" | "archived";
  frequency?: RoutineFrequency;
  weekdays?: RoutineWeekday[];
  dueHint?: string | null;
  assigneeProfileIds?: string[];
  executionMode?: RoutineExecutionMode;
  approvalMode?: TaskApprovalMode;
  evidencePolicy?: EvidencePolicy;
  createdByProfileId: string;
  taskTemplates: RoutineTaskTemplate[];
  createdAt: string;
  updatedAt: string;
};

export type TaskChecklistItem = {
  title: string;
  done: boolean;
};

export type TaskOrigin = "routine" | "manual";

export type TaskOccurrence = {
  id: string;
  workspaceId: string;
  origin?: TaskOrigin;
  routineId: string | null;
  taskTemplateId: string | null;
  title: string;
  areaNameSnapshot?: string | null;
  routineTitleSnapshot?: string | null;
  stepTitleSnapshot?: string | null;
  /** Revision of the routine used to materialize this individual occurrence. */
  routineRevisionSnapshot?: string | null;
  areaId?: string | null;
  processId: string | null;
  assigneeProfileId: string | null;
  dueHint?: string | null;
  approvalMode: TaskApprovalMode;
  evidencePolicy: EvidencePolicy;
  checklistItems?: TaskChecklistItem[];
  status: TaskStatus;
  dueDate: string;
  evidence: TaskEvidence | null;
  submittedByProfileId: string | null;
  submittedAt: string | null;
  reviewedByProfileId: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateRoutineTaskTemplateInput = {
  id?: string;
  title: string;
  processId?: string | null;
  assigneeProfileId?: string | null;
  dueHint?: string | null;
  approvalMode?: TaskApprovalMode;
  evidencePolicy?: EvidencePolicy;
};

export type CreateRoutineInput = {
  title: string;
  areaId?: string | null;
  frequency?: RoutineFrequency;
  weekdays?: RoutineWeekday[];
  dueHint?: string | null;
  assigneeProfileIds?: string[];
  executionMode?: RoutineExecutionMode;
  approvalMode?: TaskApprovalMode;
  evidencePolicy?: EvidencePolicy;
  taskTemplates: CreateRoutineTaskTemplateInput[];
};

export type UpdateRoutineInput = CreateRoutineInput;

export type CreateManualTaskInput = {
  title: string;
  areaId?: string | null;
  assigneeProfileId?: string | null;
  dueDate: string;
  dueHint?: string | null;
  approvalMode?: TaskApprovalMode;
  evidencePolicy?: EvidencePolicy;
  checklistItems?: string[];
};

export type UpdateManualTaskInput = CreateManualTaskInput;

export type UpdateTaskChecklistInput = {
  checklistItems: TaskChecklistItem[];
};

export type SubmitTaskInput = {
  comment?: string | null;
  photoUrl?: string | null;
};

export type AttachTaskEvidenceInput = {
  attachment: TaskEvidenceAttachment;
};

export type RoutineRepository = {
  listRoutines(workspaceId: string): Promise<CompanyRoutine[]>;
  findRoutine(workspaceId: string, routineId: string): Promise<CompanyRoutine | null>;
  createRoutine(input: Omit<CompanyRoutine, "id" | "createdAt" | "updatedAt">): Promise<CompanyRoutine>;
  updateRoutine(routine: CompanyRoutine): Promise<CompanyRoutine>;
  deleteRoutine(workspaceId: string, routineId: string): Promise<void>;
  listTaskOccurrences(workspaceId: string, filters?: { dueDate?: string }): Promise<TaskOccurrence[]>;
  findTaskOccurrence(workspaceId: string, taskId: string): Promise<TaskOccurrence | null>;
  findTaskOccurrenceForTemplate(
    workspaceId: string,
    routineId: string,
    taskTemplateId: string,
    dueDate: string
  ): Promise<TaskOccurrence | null>;
  createTaskOccurrence(input: Omit<TaskOccurrence, "id" | "createdAt" | "updatedAt">): Promise<TaskOccurrence>;
  reconcileRoutineOccurrences(
    routine: CompanyRoutine,
    dueDate: string,
    desired: Array<Omit<TaskOccurrence, "id" | "createdAt" | "updatedAt">>
  ): Promise<TaskOccurrence[]>;
  updateTaskOccurrence(task: TaskOccurrence): Promise<TaskOccurrence>;
  deleteTaskOccurrence(workspaceId: string, taskId: string): Promise<boolean>;
  getLifecycleState?(): { routines: CompanyRoutine[]; tasks: TaskOccurrence[] };
  commitLifecycleState?(state: { routines: CompanyRoutine[]; tasks: TaskOccurrence[] }): void;
};
