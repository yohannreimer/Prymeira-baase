import { z } from "zod";
import {
  emptyEntityCounts,
  type EntityCounts,
  type JsonRecord,
  type LegacyKind,
  type LegacyRow,
  type MalformedRecord
} from "./types";

const requiredText = z.string().trim().min(1);
const optionalTimestamp = z.string().refine(isValidTimestamp, "Invalid timestamp").optional().nullable();
const timestamps = {
  createdAt: optionalTimestamp,
  updatedAt: optionalTimestamp,
  archivedAt: optionalTimestamp,
  publishedAt: optionalTimestamp
};
const approvalMode = z.enum(["direct", "approval_required"]);
const evidencePolicy = z.enum([
  "optional",
  "comment_required",
  "photo_required",
  "photo_or_comment_required"
]);

const processVersionSchema = z.object({
  id: requiredText.optional(),
  version: z.number().int().positive(),
  title: requiredText,
  body: z.string(),
  changeNote: z.string(),
  editorProfileId: requiredText,
  createdAt: optionalTimestamp
}).passthrough();

const routineStepSchema = z.object({
  id: requiredText.optional(),
  title: requiredText,
  sortOrder: z.number().int().positive().optional(),
  processId: z.string().optional().nullable(),
  assigneeProfileId: z.string().optional().nullable(),
  assigneeRoleTemplateId: z.string().optional().nullable(),
  approvalMode: approvalMode.optional(),
  evidencePolicy: evidencePolicy.optional(),
  createdAt: optionalTimestamp,
  updatedAt: optionalTimestamp
}).passthrough();

const checklistSchema = z.object({
  id: requiredText.optional(),
  title: requiredText,
  sortOrder: z.number().int().positive().optional(),
  done: z.boolean().optional(),
  isCompleted: z.boolean().optional(),
  completedAt: optionalTimestamp,
  createdAt: optionalTimestamp,
  updatedAt: optionalTimestamp
}).passthrough();

const evidenceSchema = z.object({
  id: requiredText.optional(),
  profileId: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  objectKey: z.string().optional().nullable(),
  createdAt: optionalTimestamp
}).passthrough().superRefine((data, context) => {
  const hasComment = Boolean(data.comment?.trim());
  const hasPhoto = Boolean(data.photoUrl?.trim() || data.objectKey?.trim());
  if (!hasComment && !hasPhoto) {
    context.addIssue({ code: "custom", path: [], message: "Evidence has no usable content" });
  }
});

const schemas: Record<LegacyKind, z.ZodType<JsonRecord>> = {
  area: z.object({
    name: requiredText,
    sortOrder: z.number().int().nonnegative().optional(),
    ...timestamps
  }).passthrough(),
  role_template: z.object({
    areaId: requiredText,
    name: requiredText,
    ...timestamps
  }).passthrough(),
  team_member: z.object({
    name: requiredText,
    role: z.enum(["owner", "manager", "employee"]),
    status: z.enum(["active", "inactive", "placeholder", "archived"]).optional(),
    ...timestamps
  }).passthrough(),
  process: z.object({
    title: requiredText,
    status: z.enum(["draft", "published", "archived"]).optional(),
    versions: z.array(processVersionSchema).optional(),
    currentVersion: processVersionSchema.optional(),
    ...timestamps
  }).passthrough(),
  routine: z.object({
    title: requiredText,
    status: z.enum(["active", "paused", "archived"]),
    frequency: z.enum(["daily", "weekly", "monthly", "on_demand"]).optional(),
    weekdays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).optional(),
    executionMode: z.enum(["shared", "individual"]).optional(),
    monthDay: z.number().int().min(1).max(31).optional().nullable(),
    approvalMode: approvalMode.optional(),
    evidencePolicy: evidencePolicy.optional(),
    assigneeProfileIds: z.array(z.string()).optional(),
    assigneeRoleTemplateIds: z.array(z.string()).optional(),
    taskTemplates: z.array(routineStepSchema),
    ...timestamps
  }).passthrough().superRefine((data, context) => {
    const weekdays = data.weekdays ?? [];
    if (new Set(weekdays).size !== weekdays.length) {
      context.addIssue({ code: "custom", path: ["weekdays"], message: "Duplicate weekdays" });
    }
    if (data.frequency === "daily" && data.weekdays && weekdays.length === 0) {
      context.addIssue({ code: "custom", path: ["weekdays"], message: "Daily routine requires weekdays" });
    }
    if (data.frequency === "weekly" && weekdays.length !== 1) {
      context.addIssue({ code: "custom", path: ["weekdays"], message: "Weekly routine requires one weekday" });
    }
    if (data.frequency === "monthly" && data.monthDay == null) {
      context.addIssue({ code: "custom", path: ["monthDay"], message: "Monthly routine requires monthDay" });
    }
    if (data.frequency === "on_demand" && (weekdays.length > 0 || data.monthDay != null)) {
      context.addIssue({ code: "custom", path: ["frequency"], message: "On-demand routine cannot have a schedule" });
    }
  }),
  task_occurrence: z.object({
    title: requiredText,
    origin: z.enum(["routine", "manual"]).optional(),
    status: z.enum([
      "pending",
      "in_progress",
      "awaiting_approval",
      "completed",
      "needs_adjustment",
      "late",
      "dismissed"
    ]),
    dueDate: z.string().refine(isValidCalendarDate, "Invalid calendar date"),
    approvalMode: approvalMode,
    evidencePolicy,
    checklistItems: z.array(checklistSchema).optional(),
    evidence: z.union([evidenceSchema, z.array(evidenceSchema)]).optional().nullable(),
    submittedAt: optionalTimestamp,
    reviewedAt: optionalTimestamp,
    completedAt: optionalTimestamp,
    ...timestamps
  }).passthrough()
};

export type ParsedLegacyWorkspace = {
  validRows: Array<LegacyRow & { data: JsonRecord }>;
  malformedRecords: MalformedRecord[];
  sourceCounts: EntityCounts;
};

export function parseLegacyWorkspace(
  workspaceId: string,
  rows: LegacyRow[]
): ParsedLegacyWorkspace {
  const validRows: ParsedLegacyWorkspace["validRows"] = [];
  const malformedRecords: MalformedRecord[] = [];
  const sourceCounts = emptyEntityCounts();

  for (const row of rows) {
    addRawSourceCounts(sourceCounts, row);
    const result = schemas[row.kind].safeParse(row.data);
    if (result.success) {
      validRows.push({ ...row, data: result.data });
      continue;
    }
    for (const issue of result.error.issues) {
      malformedRecords.push({
        workspaceId,
        kind: row.kind,
        entityId: row.id,
        path: ["data", ...issue.path.map(String)].join("."),
        reason: issue.message
      });
    }
  }

  return { validRows, malformedRecords, sourceCounts };
}

function addRawSourceCounts(counts: EntityCounts, row: LegacyRow) {
  const tableByKind = {
    area: "areas",
    role_template: "role_templates",
    team_member: "people",
    process: "processes",
    routine: "routines",
    task_occurrence: "task_occurrences"
  } as const;
  counts[tableByKind[row.kind]] += 1;
  if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) return;
  const data = row.data as JsonRecord;
  if (row.kind === "process") {
    const versions = Array.isArray(data.versions) ? data.versions : [];
    counts.process_versions += versions.length;
    const current = data.currentVersion;
    const currentVersion = readObjectNumber(current, "version");
    const represented = versions.some((version) => readObjectNumber(version, "version") === currentVersion);
    if (current !== undefined && current !== null && !represented) counts.process_versions += 1;
  }
  if (row.kind === "routine") {
    const steps = Array.isArray(data.taskTemplates) ? data.taskTemplates : [];
    counts.routine_steps += steps.length;
    counts.routine_assignments += Array.isArray(data.assigneeProfileIds) ? data.assigneeProfileIds.length : 0;
    counts.routine_assignments += Array.isArray(data.assigneeRoleTemplateIds)
      ? data.assigneeRoleTemplateIds.length
      : 0;
    for (const step of steps) {
      if (!step || typeof step !== "object" || Array.isArray(step)) continue;
      const item = step as JsonRecord;
      if (typeof item.assigneeProfileId === "string" && item.assigneeProfileId.trim()) {
        counts.routine_assignments += 1;
      }
      if (typeof item.assigneeRoleTemplateId === "string" && item.assigneeRoleTemplateId.trim()) {
        counts.routine_assignments += 1;
      }
    }
  }
  if (row.kind === "task_occurrence") {
    counts.task_checklist_items += Array.isArray(data.checklistItems) ? data.checklistItems.length : 0;
    const evidenceItems = Array.isArray(data.evidence)
      ? data.evidence
      : data.evidence === null || data.evidence === undefined
        ? []
        : [data.evidence];
    for (const evidence of evidenceItems) {
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
        counts.task_evidence += 1;
        continue;
      }
      const item = evidence as JsonRecord;
      if (typeof item.comment === "string" && item.comment.trim()) counts.task_evidence += 1;
      if ((typeof item.photoUrl === "string" && item.photoUrl.trim())
        || (typeof item.objectKey === "string" && item.objectKey.trim())) {
        counts.task_evidence += 1;
      }
    }
  }
}

function readObjectNumber(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = (value as JsonRecord)[field];
  return typeof item === "number" ? item : null;
}

function isValidTimestamp(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !isValidCalendarDate(match[1] ?? "")) return false;
  return Number(match[2]) <= 23
    && Number(match[3]) <= 59
    && Number(match[4]) <= 59
    && !Number.isNaN(Date.parse(value));
}

function isValidCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
