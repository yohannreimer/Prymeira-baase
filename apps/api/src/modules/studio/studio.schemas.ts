import { z } from "zod";
import type { StudioStructureKind } from "./studio.types";

const editorJsonSchema = z.record(z.string(), z.unknown());
const titleSchema = z.string().trim().min(1).max(240);
const structureTextSchema = z.string().min(1);

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
  status: z.enum(["active", "archived"]).optional()
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

export const studioLinkCaptureSchema = z.object({
  url: z.url().max(2_000).refine((value) => {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password;
  }, "Only credential-free HTTP and HTTPS links are supported.")
}).strict();

const metricSchema = z.object({
  label: structureTextSchema,
  current: z.number(),
  target: z.number(),
  unit: structureTextSchema.optional()
}).strict();

const goalPropertiesSchema = z.object({
  desired_outcome: structureTextSchema.optional(),
  reason: structureTextSchema.optional(),
  metric: metricSchema.optional(),
  progress_evidence: z.array(structureTextSchema).optional()
}).strict();

const decisionPropertiesSchema = z.object({
  decision: structureTextSchema.optional(),
  context: structureTextSchema.optional(),
  alternatives: z.array(structureTextSchema).optional(),
  reason: structureTextSchema.optional(),
  hypothesis_or_risk: structureTextSchema.optional(),
  learnings: structureTextSchema.optional()
}).strict();

const planPropertiesSchema = z.object({
  direction: structureTextSchema.optional(),
  hypotheses: z.array(structureTextSchema).optional(),
  fronts: z.array(structureTextSchema).optional(),
  milestones: z.array(structureTextSchema).optional()
}).strict();

const ritualPropertiesSchema = z.object({
  intention: structureTextSchema.optional(),
  guide_questions: z.array(structureTextSchema).optional(),
  allowed_internal_sources: z.array(structureTextSchema).optional(),
  allow_external_research: z.boolean().optional(),
  summary_format: structureTextSchema.optional()
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
