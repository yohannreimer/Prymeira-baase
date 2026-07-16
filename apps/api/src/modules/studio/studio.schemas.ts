import { z } from "zod";
import { STUDIO_STRUCTURE_CONTRACT, STUDIO_STRUCTURE_KIND_ORDER } from "@prymeira/baase-shared";
import type { StudioStructureKind } from "./studio.types";

const editorJsonSchema = z.record(z.string(), z.unknown());
const titleSchema = z.string().trim().min(1).max(240);
const structureTextSchema = z.string().trim().min(1).max(10_000);
const structureTextListSchema = z.array(structureTextSchema).max(100);

export const studioCaptureModeSchema = z.enum(["text", "audio", "file", "image", "link", "mixed"]);

export const createStudioDocumentSchema = z.object({
  title: titleSchema.nullable(),
  body_json: editorJsonSchema,
  body_text: z.string().max(500_000),
  capture_mode: studioCaptureModeSchema
}).strict();

export const patchStudioDocumentSchema = z.object({
  expected_revision: z.number().int().positive(),
  title: titleSchema.nullable().optional(),
  body_json: editorJsonSchema.optional(),
  body_text: z.string().max(500_000).optional(),
  capture_mode: studioCaptureModeSchema.optional(),
  inbox_state: z.enum(["pending_review", "reviewed"]).optional(),
  is_focused: z.boolean().optional()
}).strict().refine((input) => (
  input.title !== undefined
  || input.body_json !== undefined
  || input.body_text !== undefined
  || input.capture_mode !== undefined
  || input.inbox_state !== undefined
  || input.is_focused !== undefined
), {
  message: "At least one mutable document field is required."
});

export const studioCollectionSchema = z.object({
  name: z.string().trim().min(1).max(120)
}).strict();

export const createStudioCollectionSchema = studioCollectionSchema;

const routeIdSchema = z.string().trim().min(1).max(200);
const routeLimitSchema = z.coerce.number().int().min(1).max(100);

export const studioEmptyRouteSchema = z.object({}).strict();

export const studioDocumentParamsSchema = z.object({
  documentId: routeIdSchema
}).strict();

export const studioDocumentVersionParamsSchema = studioDocumentParamsSchema.extend({ versionId: routeIdSchema }).strict();
export const studioVersionListQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(2_048).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  limit: routeLimitSchema.default(50)
}).strict();
export const createStudioCheckpointSchema = z.object({
  expected_revision: z.number().int().positive(),
  reason: z.enum(["significant_pause", "document_exit", "structure_changed", "accepted_ai_suggestion", "transcript_inserted", "restored", "manual"]),
  checkpoint_key: z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9:_-]+$/u).optional()
}).strict();
export const createStudioExitCheckpointSchema = z.object({
  known_revision: z.number().int().positive()
}).strict();
export const restoreStudioVersionSchema = z.object({ expected_revision: z.number().int().positive() }).strict();

export const studioCollectionParamsSchema = z.object({
  collectionId: routeIdSchema
}).strict();

export const studioCollectionDocumentParamsSchema = z.object({
  collectionId: routeIdSchema,
  documentId: routeIdSchema
}).strict();

export const studioDocumentListQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(2_048).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  limit: routeLimitSchema.default(50),
  status: z.enum(["active", "archived", "trashed"]).optional(),
  inbox_state: z.enum(["pending_review", "reviewed"]).optional(),
  collection_id: routeIdSchema.optional()
}).strict();

export const studioSearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: routeLimitSchema.default(20)
}).strict();

export const studioAssetSchema = z.object({
  kind: z.enum(["audio", "image", "file", "link_snapshot"]),
  display_name: z.string().trim().min(1).max(240),
  object_key: z.string().min(1),
  source_url: z.string().url().max(2_000).nullable().optional(),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative()
}).strict();

export const createStudioAssetSchema = studioAssetSchema;

export const studioAssetParamsSchema = z.object({
  assetId: routeIdSchema
}).strict();

export const studioAssetIdempotencyKeySchema = z.string().trim().uuid();

export const studioLinkCaptureSchema = z.object({
  url: z.url().max(2_000).refine((value) => {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password;
  }, "Only credential-free HTTP and HTTPS links are supported.")
}).strict();

export const studioGoalMetricSchema = z.object({
  label: z.string().trim().min(1).max(120),
  target: z.number().finite(),
  unit: z.string().trim().min(1).max(40).optional(),
  baseline: z.number().finite().optional(),
  current: z.number().finite().optional(),
  direction: z.enum(["increase", "decrease"]).optional()
}).strict();

const isoTimestampSchema = z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const dateOnlySchema = z.string().date();

function isIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const studioRitualCadenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  local_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  timezone: z.string().trim().min(1).max(100).refine(isIanaTimezone, "Invalid IANA timezone."),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  month_day: z.number().int().min(1).max(31).optional()
}).strict().superRefine((cadence, context) => {
  if (cadence.frequency === "weekly" && (!cadence.weekdays?.length || new Set(cadence.weekdays).size !== cadence.weekdays.length)) {
    context.addIssue({ code: "custom", message: "Weekly cadence needs unique weekdays.", path: ["weekdays"] });
  }
  if (cadence.frequency !== "weekly" && cadence.weekdays !== undefined) {
    context.addIssue({ code: "custom", message: "Weekdays only apply to weekly cadence.", path: ["weekdays"] });
  }
  if (cadence.frequency === "monthly" && cadence.month_day === undefined) {
    context.addIssue({ code: "custom", message: "Monthly cadence needs a month day.", path: ["month_day"] });
  }
  if (cadence.frequency !== "monthly" && cadence.month_day !== undefined) {
    context.addIssue({ code: "custom", message: "Month day only applies to monthly cadence.", path: ["month_day"] });
  }
});

const goalFields = STUDIO_STRUCTURE_CONTRACT.goal.properties;
const decisionFields = STUDIO_STRUCTURE_CONTRACT.decision.properties;
const planFields = STUDIO_STRUCTURE_CONTRACT.plan.properties;
const ritualFields = STUDIO_STRUCTURE_CONTRACT.ritual.properties;

const goalPropertiesSchema = z.object({
  [goalFields.desiredOutcome.key]: structureTextSchema.optional(),
  [goalFields.reason.key]: structureTextSchema.optional(),
  [goalFields.state.key]: z.enum(["in_focus", "waiting", "achieved"]).optional(),
  [goalFields.progressEvidence.key]: structureTextListSchema.optional()
}).strict();

const decisionPropertiesSchema = z.object({
  [decisionFields.decision.key]: structureTextSchema.optional(),
  [decisionFields.context.key]: structureTextSchema.optional(),
  [decisionFields.alternatives.key]: structureTextListSchema.optional(),
  [decisionFields.reason.key]: structureTextSchema.optional(),
  [decisionFields.hypothesisOrRisk.key]: structureTextSchema.optional(),
  [decisionFields.learnings.key]: structureTextSchema.optional(),
  [decisionFields.decisionDate.key]: dateOnlySchema.optional(),
  [decisionFields.reviewDate.key]: dateOnlySchema.optional()
}).strict();

const planPropertiesSchema = z.object({
  [planFields.direction.key]: structureTextSchema.optional(),
  [planFields.hypotheses.key]: structureTextListSchema.optional(),
  [planFields.fronts.key]: structureTextListSchema.optional(),
  [planFields.milestones.key]: structureTextListSchema.optional()
}).strict();

const ritualPropertiesSchema = z.object({
  [ritualFields.intention.key]: structureTextSchema.optional(),
  [ritualFields.guideQuestions.key]: structureTextListSchema.optional(),
  [ritualFields.allowedInternalSources.key]: structureTextListSchema.optional(),
  [ritualFields.allowExternalResearch.key]: z.boolean().optional(),
  [ritualFields.summaryFormat.key]: structureTextSchema.optional()
}).strict();

const structurePropertiesSchemas = {
  goal: goalPropertiesSchema,
  decision: decisionPropertiesSchema,
  plan: planPropertiesSchema,
  ritual: ritualPropertiesSchema
} satisfies Record<StudioStructureKind, z.ZodType>;

export function studioStructurePropertiesSchema<Kind extends StudioStructureKind>(
  kind: Kind
): (typeof structurePropertiesSchemas)[Kind] {
  return structurePropertiesSchemas[kind];
}

const structureBase = {
  horizon_at: isoTimestampSchema.nullable().optional(),
  properties_json: z.record(z.string(), z.unknown())
};

export const createStudioStructureSchema = z.discriminatedUnion("kind", [
  z.object({ ...structureBase, kind: z.literal("goal"), metric_json: studioGoalMetricSchema.nullable().optional(), cadence_json: z.null().optional() }).strict(),
  z.object({ ...structureBase, kind: z.literal("decision"), metric_json: z.null().optional(), cadence_json: z.null().optional() }).strict(),
  z.object({ ...structureBase, kind: z.literal("plan"), metric_json: z.null().optional(), cadence_json: z.null().optional() }).strict(),
  z.object({ ...structureBase, kind: z.literal("ritual"), metric_json: z.null().optional(), cadence_json: studioRitualCadenceSchema.nullable().optional() }).strict()
]).superRefine((input, context) => {
  const result = studioStructurePropertiesSchema(input.kind).safeParse(input.properties_json);
  if (!result.success) result.error.issues.forEach((issue) => context.addIssue({ ...issue, path: ["properties_json", ...issue.path] }));
  if (input.kind === "decision") {
    const reviewDate = (input.properties_json as { review_date?: string }).review_date;
    if (input.horizon_at && reviewDate && input.horizon_at.slice(0, 10) !== reviewDate) {
      context.addIssue({ code: "custom", message: "Decision horizon and review date must agree.", path: ["horizon_at"] });
    }
  }
});

export const patchStudioStructureSchema = z.object({
  expected_revision: z.number().int().positive(),
  horizon_at: isoTimestampSchema.nullable().optional(),
  metric_json: studioGoalMetricSchema.nullable().optional(),
  cadence_json: studioRitualCadenceSchema.nullable().optional(),
  properties_json: z.record(z.string(), z.unknown()).optional()
}).strict().refine((input) => Object.keys(input).some((key) => key !== "expected_revision"), {
  message: "At least one mutable structure field is required."
});

export const studioStructureParamsSchema = z.object({ structureId: routeIdSchema }).strict();
export const studioStructureListQuerySchema = z.object({
  kind: z.enum(STUDIO_STRUCTURE_KIND_ORDER).optional(),
  lifecycle_status: z.enum(["active", "archived"]).optional(),
  document_id: routeIdSchema.optional(),
  cursor: z.string().trim().min(1).max(2_048).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  limit: routeLimitSchema.default(50)
}).strict();

const studioRitualAnswersSchema = z.record(
  z.string().trim().min(1).max(240),
  z.string().trim().max(20_000)
).refine((answers) => Object.keys(answers).length <= 100, "Ritual answers are limited to 100 entries.");

export const studioRitualParamsSchema = z.object({ ritualId: routeIdSchema }).strict();
export const studioRitualSessionParamsSchema = z.object({ sessionId: routeIdSchema }).strict();
export const studioRitualSessionListQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(2_048).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  limit: routeLimitSchema.default(50)
}).strict();
export const patchStudioRitualSessionSchema = z.object({
  expected_revision: z.number().int().positive(),
  answers: studioRitualAnswersSchema
}).strict();
export const finishStudioRitualSessionSchema = z.object({
  expected_revision: z.number().int().positive(),
  answers: studioRitualAnswersSchema.default({}),
  request_synthesis: z.boolean().default(false)
}).strict();
