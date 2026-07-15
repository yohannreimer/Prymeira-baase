import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  audit,
  generatedId,
  iso,
  withOperationalTransaction,
  type OperationalClient,
  type OperationalPool
} from "../../db/operational-repository-support";
import { createAnnouncementService } from "../announcements/announcement.service";
import type { AnnouncementRepository } from "../announcements/announcement.types";
import type { CompanyRepository } from "../company/company.types";
import { createProcessService } from "../processes/process.service";
import type { ProcessRepository } from "../processes/process.types";
import { createRoutineService } from "../routines/routine.service";
import type { RoutineRepository } from "../routines/routine.types";
import type { TrainingRepository } from "../trainings/training.types";
import type { StudioOwnerScope, StudioRepository } from "./studio.types";

const requiredId = z.string().trim().min(1).max(200);
const optionalId = requiredId.nullable().optional().default(null);
const title = z.string().trim().min(1).max(160);
const longText = z.string().trim().min(1).max(200_000);
const optionalShortText = z.string().trim().max(500).nullable().optional().default(null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "invalid date");
const approvalMode = z.enum(["direct", "approval_required"]);
const evidencePolicy = z.enum(["optional", "photo_required", "comment_required", "photo_or_comment_required"]);
const weekdays = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

const taskPayloadSchema = z.object({
  title,
  area_id: optionalId,
  assignee_profile_id: optionalId,
  due_date: date,
  due_hint: z.string().trim().max(80).nullable().optional().default(null),
  approval_mode: approvalMode.optional().default("direct"),
  evidence_policy: evidencePolicy.optional().default("optional"),
  checklist_items: z.array(z.string().trim().min(1).max(180)).max(100).optional().default([])
}).strict();

const routineTaskSchema = z.object({
  title: z.string().trim().min(1).max(140),
  process_id: optionalId,
  assignee_profile_id: optionalId,
  due_hint: z.string().trim().max(80).nullable().optional().default(null),
  approval_mode: approvalMode.optional().default("direct"),
  evidence_policy: evidencePolicy.optional().default("optional")
}).strict();
const routinePayloadSchema = z.object({
  title: z.string().trim().min(1).max(140),
  area_id: optionalId,
  frequency: z.enum(["daily", "weekly", "monthly", "on_demand"]).optional().default("on_demand"),
  weekdays: z.array(weekdays).max(7).optional().default([]),
  due_hint: z.string().trim().max(80).nullable().optional().default(null),
  assignee_profile_ids: z.array(requiredId).max(100).optional().default([]),
  execution_mode: z.enum(["shared", "individual"]).optional().default("shared"),
  approval_mode: approvalMode.optional().default("direct"),
  evidence_policy: evidencePolicy.optional().default("optional"),
  task_templates: z.array(routineTaskSchema).min(1).max(100)
}).strict().superRefine((payload, context) => {
  if (payload.frequency === "weekly" && payload.weekdays.length !== 1) {
    context.addIssue({ code: "custom", path: ["weekdays"], message: "weekly routines require one weekday" });
  }
  if ((payload.frequency === "monthly" || payload.frequency === "on_demand") && payload.weekdays.length > 0) {
    context.addIssue({ code: "custom", path: ["weekdays"], message: "weekdays do not apply to this frequency" });
  }
  if (new Set(payload.weekdays).size !== payload.weekdays.length) {
    context.addIssue({ code: "custom", path: ["weekdays"], message: "weekdays must be unique" });
  }
  if (new Set(payload.assignee_profile_ids).size !== payload.assignee_profile_ids.length) {
    context.addIssue({ code: "custom", path: ["assignee_profile_ids"], message: "assignees must be unique" });
  }
});

const processOwnerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("person"), person_id: requiredId }).strict(),
  z.object({ type: z.literal("role"), role_template_id: requiredId }).strict()
]);
const processPayloadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: longText,
  area_id: optionalId,
  summary: optionalShortText,
  owner: processOwnerSchema.nullable().optional().default(null)
}).strict();

const announcementAudienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }).strict(),
  z.object({ type: z.literal("area"), area_id: requiredId }).strict(),
  z.object({ type: z.literal("role"), role_template_id: requiredId }).strict(),
  z.object({ type: z.literal("person"), profile_id: requiredId }).strict()
]);
const announcementQuizSchema = z.object({
  prompt: z.string().trim().min(1).max(240),
  options: z.array(z.object({
    id: requiredId,
    label: z.string().trim().min(1).max(160)
  }).strict()).min(2).max(20),
  correct_option_id: requiredId,
  explanation: z.string().trim().max(1_000).nullable().optional().default(null)
}).strict();
const announcementPayloadSchema = z.object({
  title,
  body: longText,
  type: z.enum(["simple", "process_change", "mandatory_training"]),
  requirement: z.enum(["none", "read_confirmation", "quiz_confirmation"]),
  audience: announcementAudienceSchema,
  related_process_id: optionalId,
  related_training_id: optionalId,
  quiz_questions: z.array(announcementQuizSchema).max(50).optional().default([])
}).strict().superRefine((payload, context) => {
  if (payload.requirement === "quiz_confirmation" && payload.quiz_questions.length === 0) {
    context.addIssue({ code: "custom", path: ["quiz_questions"], message: "quiz questions are required" });
  }
  payload.quiz_questions.forEach((question, index) => {
    if (!question.options.some((option) => option.id === question.correct_option_id)) {
      context.addIssue({ code: "custom", path: ["quiz_questions", index, "correct_option_id"], message: "correct option is missing" });
    }
    if (new Set(question.options.map((option) => option.id)).size !== question.options.length) {
      context.addIssue({ code: "custom", path: ["quiz_questions", index, "options"], message: "option ids must be unique" });
    }
  });
});

export const studioOperationDraftSchema = z.discriminatedUnion("resource_type", [
  z.object({ resource_type: z.literal("task"), payload: taskPayloadSchema }).strict(),
  z.object({ resource_type: z.literal("routine"), payload: routinePayloadSchema }).strict(),
  z.object({ resource_type: z.literal("process"), payload: processPayloadSchema }).strict(),
  z.object({ resource_type: z.literal("announcement"), payload: announcementPayloadSchema }).strict()
]);

export type StudioOperationDraft = z.infer<typeof studioOperationDraftSchema>;
export type StudioOperationResourceType = StudioOperationDraft["resource_type"];
export type StudioOperationPreviewStatus = "preview" | "confirming" | "confirmed" | "expired";

export type StudioOperationPreview = StudioOwnerScope & {
  id: string;
  sourceSuggestionId: string;
  sourceDocumentId: string;
  resourceType: StudioOperationResourceType;
  payload: StudioOperationDraft;
  confirmedPayload: StudioOperationDraft | null;
  status: StudioOperationPreviewStatus;
  expiresAt: string;
  idempotencyKey: string | null;
  intendedResourceId: string | null;
  resultResourceId: string | null;
  claimToken: string | null;
  claimLeaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
};

export type StudioOperationalLink = StudioOwnerScope & {
  id: string;
  previewId: string;
  sourceSuggestionId: string;
  sourceDocumentId: string;
  sourceStructureId: string | null;
  resourceType: StudioOperationResourceType;
  resourceId: string;
  relationType: "created";
  createdByProfileId: string;
  createdAt: string;
  sourceDeletedAt: string | null;
  originLabel: "Estúdio do Dono" | "origem excluída";
};

type ClaimInput = {
  scope: StudioOwnerScope;
  actorProfileId: string;
  previewId: string;
  idempotencyKey: string;
  intendedResourceId: string;
  payload: StudioOperationDraft;
  claimToken: string;
  claimLeaseExpiresAt: string;
  now: string;
};
type ClaimResult =
  | { type: "claimed"; preview: StudioOperationPreview }
  | { type: "confirmed"; link: StudioOperationalLink }
  | { type: "busy" }
  | { type: "indeterminate" }
  | { type: "expired" };

export type StudioOperationsStore = {
  createPreview(input: Omit<StudioOperationPreview,
    "id" | "confirmedPayload" | "status" | "idempotencyKey" | "intendedResourceId" | "resultResourceId" | "claimToken"
    | "claimLeaseExpiresAt" | "createdAt" | "updatedAt" | "confirmedAt"
  > & { actorProfileId: string; now?: string }): Promise<StudioOperationPreview>;
  findPreview(scope: StudioOwnerScope, previewId: string): Promise<StudioOperationPreview | null>;
  claimConfirmation(input: ClaimInput): Promise<ClaimResult>;
  finalizeConfirmation(input: {
    scope: StudioOwnerScope;
    actorProfileId: string;
    previewId: string;
    idempotencyKey: string;
    claimToken: string;
    resourceId: string;
    now: string;
  }): Promise<StudioOperationalLink>;
  releaseConfirmation(input: {
    scope: StudioOwnerScope;
    actorProfileId: string;
    previewId: string;
    idempotencyKey: string;
    claimToken: string;
    now: string;
    errorCode: string;
  }): Promise<void>;
  expirePreview(scope: StudioOwnerScope, previewId: string, now: string): Promise<void>;
  markOwnerOriginsDeleted?(scope: StudioOwnerScope, deletedAt: string): Promise<void>;
};

type InMemoryStoreOptions = { now?: () => string };

export function createInMemoryStudioOperationsStore(options: InMemoryStoreOptions = {}): StudioOperationsStore {
  const previews: StudioOperationPreview[] = [];
  const links: StudioOperationalLink[] = [];
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async createPreview(input) {
      const timestamp = normalizeTimestamp(input.now ?? now());
      const preview: StudioOperationPreview = {
        workspaceId: input.workspaceId,
        ownerProfileId: input.ownerProfileId,
        id: `studio_operation_preview_${randomUUID()}`,
        sourceSuggestionId: input.sourceSuggestionId,
        sourceDocumentId: input.sourceDocumentId,
        resourceType: input.resourceType,
        payload: clone(input.payload),
        confirmedPayload: null,
        status: "preview",
        expiresAt: input.expiresAt,
        idempotencyKey: null,
        intendedResourceId: null,
        resultResourceId: null,
        claimToken: null,
        claimLeaseExpiresAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        confirmedAt: null
      };
      previews.push(preview);
      return clone(preview);
    },

    async findPreview(scope, previewId) {
      const preview = findScoped(previews, scope, previewId);
      return preview ? clone(preview) : null;
    },

    async claimConfirmation(input) {
      const preview = findScoped(previews, input.scope, input.previewId);
      if (!preview) throw new Error("STUDIO_OPERATION_PREVIEW_NOT_FOUND");
      if (preview.status === "preview" && Date.parse(preview.expiresAt) <= Date.parse(input.now)) {
        preview.status = "expired";
        preview.updatedAt = input.now;
        return { type: "expired" };
      }
      if (preview.status === "expired") return { type: "expired" };
      if (preview.status === "confirmed") {
        if (preview.idempotencyKey !== input.idempotencyKey) throw new Error("STUDIO_OPERATION_PREVIEW_ALREADY_CONFIRMED");
        const link = links.find((item) => sameScope(item, input.scope) && item.previewId === preview.id);
        if (!link) throw new Error("STUDIO_OPERATION_LINK_MISSING");
        return { type: "confirmed", link: clone(link) };
      }
      if (preview.status === "confirming") {
        if (preview.idempotencyKey !== input.idempotencyKey) throw new Error("STUDIO_OPERATION_CONFIRMATION_KEY_CONFLICT");
        if (preview.claimLeaseExpiresAt && Date.parse(preview.claimLeaseExpiresAt) > Date.parse(input.now)) return { type: "busy" };
        if (!preview.intendedResourceId) return { type: "indeterminate" };
        preview.claimToken = input.claimToken;
        preview.claimLeaseExpiresAt = input.claimLeaseExpiresAt;
        preview.updatedAt = input.now;
        return { type: "claimed", preview: clone(preview) };
      }
      const reusedKey = previews.find((item) => sameScope(item, input.scope)
        && item.id !== preview.id && item.idempotencyKey === input.idempotencyKey);
      if (reusedKey) throw new Error("STUDIO_OPERATION_CONFIRMATION_KEY_CONFLICT");
      preview.status = "confirming";
      preview.confirmedPayload = clone(input.payload);
      preview.idempotencyKey = input.idempotencyKey;
      preview.intendedResourceId = input.intendedResourceId;
      preview.claimToken = input.claimToken;
      preview.claimLeaseExpiresAt = input.claimLeaseExpiresAt;
      preview.updatedAt = input.now;
      return { type: "claimed", preview: clone(preview) };
    },

    async finalizeConfirmation(input) {
      const preview = findScoped(previews, input.scope, input.previewId);
      if (!preview) throw new Error("STUDIO_OPERATION_PREVIEW_NOT_FOUND");
      if (preview.status === "confirmed") {
        if (preview.idempotencyKey !== input.idempotencyKey || preview.resultResourceId !== input.resourceId) {
          throw new Error("STUDIO_OPERATION_CONFIRMATION_FENCE_LOST");
        }
        const existing = links.find((item) => sameScope(item, input.scope) && item.previewId === preview.id);
        if (!existing) throw new Error("STUDIO_OPERATION_LINK_MISSING");
        return clone(existing);
      }
      assertConfirmationFence(preview, input.idempotencyKey, input.claimToken);
      let link = links.find((item) => sameScope(item, input.scope) && item.previewId === preview.id);
      link ??= {
        ...input.scope,
        id: `studio_operational_link_${randomUUID()}`,
        previewId: preview.id,
        sourceSuggestionId: preview.sourceSuggestionId,
        sourceDocumentId: preview.sourceDocumentId,
        sourceStructureId: null,
        resourceType: preview.resourceType,
        resourceId: input.resourceId,
        relationType: "created",
        createdByProfileId: input.actorProfileId,
        createdAt: input.now,
        sourceDeletedAt: null,
        originLabel: "Estúdio do Dono"
      };
      if (!links.includes(link)) links.push(link);
      preview.status = "confirmed";
      preview.resultResourceId = input.resourceId;
      preview.claimToken = null;
      preview.claimLeaseExpiresAt = null;
      preview.updatedAt = input.now;
      preview.confirmedAt = input.now;
      return clone(link);
    },

    async releaseConfirmation(input) {
      const preview = findScoped(previews, input.scope, input.previewId);
      if (!preview) return;
      if (preview.status !== "confirming") return;
      if (preview.idempotencyKey !== input.idempotencyKey || preview.claimToken !== input.claimToken) return;
      preview.status = "preview";
      preview.confirmedPayload = null;
      preview.idempotencyKey = null;
      preview.intendedResourceId = null;
      preview.claimToken = null;
      preview.claimLeaseExpiresAt = null;
      preview.updatedAt = input.now;
    },

    async expirePreview(scope, previewId, timestamp) {
      const preview = findScoped(previews, scope, previewId);
      if (preview && preview.status === "preview") {
        preview.status = "expired";
        preview.updatedAt = timestamp;
      }
    },

    async markOwnerOriginsDeleted(scope, deletedAt) {
      for (const link of links) {
        if (sameScope(link, scope)) {
          link.sourceDeletedAt = deletedAt;
          link.originLabel = "origem excluída";
        }
      }
    }
  };
}

export function createPostgresStudioOperationsStore(db: OperationalPool): StudioOperationsStore {
  return {
    async createPreview(input) {
      return withOperationalTransaction(db, async (client) => {
        const id = generatedId("studio_operation_preview");
        const timestamp = normalizeTimestamp(input.now ?? new Date().toISOString());
        const result = await client.query<StudioOperationPreviewRow>(
          `INSERT INTO studio_operation_previews
             (id,workspace_id,owner_profile_id,source_suggestion_id,source_document_id,resource_type,
              payload_json,status,expires_at,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'preview',$8,$9,$9)
           RETURNING *`,
          [id, input.workspaceId, input.ownerProfileId, input.sourceSuggestionId, input.sourceDocumentId,
            input.resourceType, JSON.stringify(input.payload), input.expiresAt, timestamp]
        );
        await audit(client, input.workspaceId, "studio_operation_preview", id, "create", input.actorProfileId, {
          ownerProfileId: input.ownerProfileId,
          sourceSuggestionId: input.sourceSuggestionId,
          resourceType: input.resourceType
        });
        return previewFromRow(result.rows[0]!);
      });
    },

    async findPreview(scope, previewId) {
      const result = await db.query<StudioOperationPreviewRow>(
        "SELECT * FROM studio_operation_previews WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3",
        [scope.workspaceId, scope.ownerProfileId, previewId]
      );
      return result.rows[0] ? previewFromRow(result.rows[0]) : null;
    },

    async claimConfirmation(input) {
      return withOperationalTransaction(db, async (client) => {
        const preview = await lockedPreview(client, input.scope, input.previewId);
        if (!preview) throw new Error("STUDIO_OPERATION_PREVIEW_NOT_FOUND");
        if (preview.status === "preview" && Date.parse(preview.expiresAt) <= Date.parse(input.now)) {
          await client.query(
            "UPDATE studio_operation_previews SET status='expired',updated_at=$4 WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3",
            [input.scope.workspaceId, input.scope.ownerProfileId, input.previewId, input.now]
          );
          await audit(client, input.scope.workspaceId, "studio_operation_preview", preview.id, "expire", input.actorProfileId);
          return { type: "expired" } as const;
        }
        if (preview.status === "expired") return { type: "expired" } as const;
        if (preview.status === "confirmed") {
          if (preview.idempotencyKey !== input.idempotencyKey) throw new Error("STUDIO_OPERATION_PREVIEW_ALREADY_CONFIRMED");
          const link = await readLink(client, input.scope, preview.id);
          if (!link) throw new Error("STUDIO_OPERATION_LINK_MISSING");
          return { type: "confirmed", link } as const;
        }
        if (preview.status === "confirming") {
          if (preview.idempotencyKey !== input.idempotencyKey) throw new Error("STUDIO_OPERATION_CONFIRMATION_KEY_CONFLICT");
          if (preview.claimLeaseExpiresAt && Date.parse(preview.claimLeaseExpiresAt) > Date.parse(input.now)) {
            return { type: "busy" } as const;
          }
          if (!preview.intendedResourceId) return { type: "indeterminate" } as const;
          const reclaimed = await client.query<StudioOperationPreviewRow>(
            `UPDATE studio_operation_previews
               SET claim_token=$4,claim_lease_expires_at=$5,updated_at=$6
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
             RETURNING *`,
            [input.scope.workspaceId, input.scope.ownerProfileId, preview.id,
              input.claimToken, input.claimLeaseExpiresAt, input.now]
          );
          await audit(client, input.scope.workspaceId, "studio_operation_preview", preview.id,
            "confirm_recover", input.actorProfileId, { idempotencyKey: input.idempotencyKey });
          return { type: "claimed", preview: previewFromRow(reclaimed.rows[0]!) } as const;
        }
        const reusedKey = await client.query<{ id: string }>(
          `SELECT id FROM studio_operation_previews
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND idempotency_key=$3 AND id<>$4
           FOR UPDATE`,
          [input.scope.workspaceId, input.scope.ownerProfileId, input.idempotencyKey, preview.id]
        );
        if (reusedKey.rows[0]) throw new Error("STUDIO_OPERATION_CONFIRMATION_KEY_CONFLICT");
        const updated = await client.query<StudioOperationPreviewRow>(
          `UPDATE studio_operation_previews
             SET status='confirming',confirmed_payload_json=$4::jsonb,idempotency_key=$5,
                 intended_resource_id=$6,claim_token=$7,claim_lease_expires_at=$8,updated_at=$9
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
           RETURNING *`,
          [input.scope.workspaceId, input.scope.ownerProfileId, preview.id, JSON.stringify(input.payload),
            input.idempotencyKey, input.intendedResourceId, input.claimToken, input.claimLeaseExpiresAt, input.now]
        );
        await audit(client, input.scope.workspaceId, "studio_operation_preview", preview.id, "confirm_claim",
          input.actorProfileId, { idempotencyKey: input.idempotencyKey });
        return { type: "claimed", preview: previewFromRow(updated.rows[0]!) } as const;
      }).catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new Error("STUDIO_OPERATION_CONFIRMATION_KEY_CONFLICT", { cause: error });
        throw error;
      });
    },

    async finalizeConfirmation(input) {
      return withOperationalTransaction(db, async (client) => {
        const preview = await lockedPreview(client, input.scope, input.previewId);
        if (!preview) throw new Error("STUDIO_OPERATION_PREVIEW_NOT_FOUND");
        if (preview.status === "confirmed") {
          if (preview.idempotencyKey !== input.idempotencyKey || preview.resultResourceId !== input.resourceId) {
            throw new Error("STUDIO_OPERATION_CONFIRMATION_FENCE_LOST");
          }
          const existing = await readLink(client, input.scope, preview.id);
          if (!existing) throw new Error("STUDIO_OPERATION_LINK_MISSING");
          return existing;
        }
        assertConfirmationFence(preview, input.idempotencyKey, input.claimToken);
        const linkId = generatedId("studio_operational_link");
        const inserted = await client.query<StudioOperationalLinkRow>(
          `INSERT INTO studio_operational_links
             (id,workspace_id,owner_profile_id,preview_id,source_suggestion_id,source_document_id,
              source_structure_id,resource_type,resource_id,relation_type,created_by_profile_id)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,'created',$9)
           ON CONFLICT (workspace_id,owner_profile_id,preview_id) DO NOTHING
           RETURNING *`,
          [linkId, input.scope.workspaceId, input.scope.ownerProfileId, preview.id, preview.sourceSuggestionId,
            preview.sourceDocumentId, preview.resourceType, input.resourceId, input.actorProfileId]
        );
        const link = inserted.rows[0] ? linkFromRow(inserted.rows[0]) : await readLink(client, input.scope, preview.id);
        if (!link || link.resourceId !== input.resourceId) throw new Error("STUDIO_OPERATION_CONFIRMATION_FENCE_LOST");
        await client.query(
          `UPDATE studio_operation_previews
             SET status='confirmed',result_resource_id=$4,claim_token=NULL,claim_lease_expires_at=NULL,
                 confirmed_at=$5,updated_at=$5
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
          [input.scope.workspaceId, input.scope.ownerProfileId, preview.id, input.resourceId, input.now]
        );
        await audit(client, input.scope.workspaceId, "studio_operation_preview", preview.id, "confirm",
          input.actorProfileId, { resourceType: preview.resourceType, resourceId: input.resourceId });
        await audit(client, input.scope.workspaceId, "studio_operational_link", link.id, "create",
          input.actorProfileId, { previewId: preview.id, sourceSuggestionId: preview.sourceSuggestionId });
        return link;
      });
    },

    async releaseConfirmation(input) {
      await withOperationalTransaction(db, async (client) => {
        const result = await client.query<{ id: string }>(
          `UPDATE studio_operation_previews
             SET status='preview',confirmed_payload_json=NULL,idempotency_key=NULL,claim_token=NULL,
                 intended_resource_id=NULL,claim_lease_expires_at=NULL,updated_at=$6
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND status='confirming'
             AND idempotency_key=$4 AND claim_token=$5
           RETURNING id`,
          [input.scope.workspaceId, input.scope.ownerProfileId, input.previewId, input.idempotencyKey,
            input.claimToken, input.now]
        );
        if (result.rows[0]) await audit(client, input.scope.workspaceId, "studio_operation_preview", input.previewId,
          "confirm_failed", input.actorProfileId, { errorCode: input.errorCode });
      });
    },

    async expirePreview(scope, previewId, timestamp) {
      await withOperationalTransaction(db, async (client) => {
        const result = await client.query<{ id: string }>(
          `UPDATE studio_operation_previews SET status='expired',updated_at=$4
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND status='preview' RETURNING id`,
          [scope.workspaceId, scope.ownerProfileId, previewId, timestamp]
        );
        if (result.rows[0]) await audit(client, scope.workspaceId, "studio_operation_preview", previewId, "expire", scope.ownerProfileId);
      });
    },

    async markOwnerOriginsDeleted(scope, deletedAt) {
      await db.query(
        `UPDATE studio_operational_links SET source_deleted_at=$3
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND source_deleted_at IS NULL`,
        [scope.workspaceId, scope.ownerProfileId, deletedAt]
      );
    }
  };
}

export type StudioOperationsBridge = ReturnType<typeof createStudioOperationsBridge>;

type StudioOperationsBridgeOptions = {
  studioRepository: Pick<StudioRepository, "findSuggestion">;
  operationsStore: StudioOperationsStore;
  companyRepository: CompanyRepository;
  routineRepository: RoutineRepository;
  processRepository: ProcessRepository;
  announcementRepository: AnnouncementRepository;
  trainingRepository?: Pick<TrainingRepository, "findTraining">;
  now?: () => Date;
  previewTtlMs?: number;
  claimLeaseMs?: number;
};

export function createStudioOperationsBridge(options: StudioOperationsBridgeOptions) {
  const now = options.now ?? (() => new Date());
  const previewTtlMs = options.previewTtlMs ?? 24 * 60 * 60 * 1_000;
  const claimLeaseMs = options.claimLeaseMs ?? 5 * 60 * 1_000;
  const routineService = createRoutineService(options.routineRepository);
  const processService = createProcessService(options.processRepository, { companyRepository: options.companyRepository });
  const announcementService = createAnnouncementService(options.announcementRepository);
  const inFlight = new Map<string, Promise<StudioOperationalLink>>();

  return {
    async preview(
      scope: StudioOwnerScope,
      actorProfileId: string,
      suggestionId: string,
      rawDraft: StudioOperationDraft
    ) {
      assertActor(scope, actorProfileId);
      const draft = parseDraft(rawDraft);
      const suggestion = await options.studioRepository.findSuggestion(scope, suggestionId);
      if (!suggestion) throw new Error("STUDIO_SUGGESTION_NOT_FOUND");
      if (suggestion.status !== "pending") throw new Error("STUDIO_OPERATION_SOURCE_SUGGESTION_NOT_PENDING");
      if (!suggestion.documentId) throw new Error("STUDIO_OPERATION_SOURCE_DOCUMENT_REQUIRED");
      const timestamp = validNow(now);
      return options.operationsStore.createPreview({
        ...scope,
        actorProfileId,
        sourceSuggestionId: suggestion.id,
        sourceDocumentId: suggestion.documentId,
        resourceType: draft.resource_type,
        payload: draft,
        expiresAt: new Date(timestamp.getTime() + previewTtlMs).toISOString(),
        now: timestamp.toISOString()
      });
    },

    async getPreview(scope: StudioOwnerScope, previewId: string) {
      const preview = await options.operationsStore.findPreview(scope, previewId);
      if (!preview) throw new Error("STUDIO_OPERATION_PREVIEW_NOT_FOUND");
      const timestamp = validNow(now).toISOString();
      if (preview.status === "preview" && Date.parse(preview.expiresAt) <= Date.parse(timestamp)) {
        await options.operationsStore.expirePreview(scope, preview.id, timestamp);
        const expired = await options.operationsStore.findPreview(scope, previewId);
        if (!expired) throw new Error("STUDIO_OPERATION_PREVIEW_NOT_FOUND");
        return expired;
      }
      return preview;
    },

    confirm(
      scope: StudioOwnerScope,
      actorProfileId: string,
      previewId: string,
      idempotencyKey: string,
      rawDraft: StudioOperationDraft
    ) {
      assertActor(scope, actorProfileId);
      assertIdempotencyKey(idempotencyKey);
      const draft = parseDraft(rawDraft);
      const flightKey = `${scope.workspaceId}\u0000${scope.ownerProfileId}\u0000${previewId}\u0000${idempotencyKey}`;
      const existing = inFlight.get(flightKey);
      if (existing) return existing;
      const confirmation = confirmOnce(scope, actorProfileId, previewId, idempotencyKey, draft);
      inFlight.set(flightKey, confirmation);
      void confirmation.finally(() => {
        if (inFlight.get(flightKey) === confirmation) inFlight.delete(flightKey);
      }).catch(() => undefined);
      return confirmation;
    }
  };

  async function confirmOnce(
    scope: StudioOwnerScope,
    actorProfileId: string,
    previewId: string,
    idempotencyKey: string,
    draft: StudioOperationDraft
  ) {
    const preview = await options.operationsStore.findPreview(scope, previewId);
    if (!preview) throw new Error("STUDIO_OPERATION_PREVIEW_NOT_FOUND");
    if (preview.resourceType !== draft.resource_type) throw new Error("STUDIO_OPERATION_RESOURCE_TYPE_CHANGED");
    const timestamp = validNow(now);
    if (preview.status === "expired") throw new Error("STUDIO_OPERATION_PREVIEW_EXPIRED");
    if (preview.status === "preview" && Date.parse(preview.expiresAt) <= timestamp.getTime()) {
      await options.operationsStore.expirePreview(scope, preview.id, timestamp.toISOString());
      throw new Error("STUDIO_OPERATION_PREVIEW_EXPIRED");
    }
    const claimToken = randomUUID();
    const claim = await options.operationsStore.claimConfirmation({
      scope,
      actorProfileId,
      previewId,
      idempotencyKey,
      intendedResourceId: `${draft.resource_type}_${randomUUID()}`,
      payload: draft,
      claimToken,
      claimLeaseExpiresAt: new Date(timestamp.getTime() + claimLeaseMs).toISOString(),
      now: timestamp.toISOString()
    });
    if (claim.type === "confirmed") return claim.link;
    if (claim.type === "expired") throw new Error("STUDIO_OPERATION_PREVIEW_EXPIRED");
    if (claim.type === "busy") throw new Error("STUDIO_OPERATION_CONFIRMATION_IN_PROGRESS");
    if (claim.type === "indeterminate") throw new Error("STUDIO_OPERATION_CONFIRMATION_RECOVERY_REQUIRED");

    const intendedResourceId = claim.preview.intendedResourceId;
    if (!intendedResourceId) throw new Error("STUDIO_OPERATION_CONFIRMATION_RECOVERY_REQUIRED");
    let domainAttempted = false;
    let finalizeAttempted = false;
    try {
      const recovered = await findOperationalResource(options, scope.workspaceId, draft.resource_type, intendedResourceId);
      if (recovered) {
        return await finalizeWithRetry(intendedResourceId);
      }
      const currentSuggestion = await options.studioRepository.findSuggestion(scope, preview.sourceSuggestionId);
      if (!currentSuggestion || currentSuggestion.status !== "pending") {
        throw new Error("STUDIO_OPERATION_SOURCE_SUGGESTION_NOT_PENDING");
      }
      await validateReferences(options, scope.workspaceId, draft);
      domainAttempted = true;
      const resourceId = await createOperationalResource({
        draft,
        workspaceId: scope.workspaceId,
        actorProfileId,
        resourceId: intendedResourceId,
        routineService,
        processService,
        announcementService
      });
      if (resourceId !== intendedResourceId) throw new Error("STUDIO_OPERATION_DOMAIN_IDENTITY_MISMATCH");
      return await finalizeWithRetry(resourceId);
    } catch (error) {
      if (finalizeAttempted) {
        throw new Error("STUDIO_OPERATION_CONFIRMATION_RECOVERY_REQUIRED", { cause: error });
      }
      if (domainAttempted) {
        const recovered = await findOperationalResource(
          options, scope.workspaceId, draft.resource_type, intendedResourceId
        ).catch(() => null);
        if (recovered) {
          try {
            return await finalizeWithRetry(intendedResourceId);
          } catch (finalizeError) {
            throw new Error("STUDIO_OPERATION_CONFIRMATION_RECOVERY_REQUIRED", { cause: finalizeError });
          }
        }
        throw new Error("STUDIO_OPERATION_CONFIRMATION_RECOVERY_REQUIRED", { cause: error });
      }
      await options.operationsStore.releaseConfirmation({
        scope,
        actorProfileId,
        previewId,
        idempotencyKey,
        claimToken,
        now: validNow(now).toISOString(),
        errorCode: publicErrorCode(error)
      }).catch(() => undefined);
      throw error;
    }

    async function finalizeWithRetry(resourceId: string) {
      finalizeAttempted = true;
      const finalizeInput = {
        scope, actorProfileId, previewId, idempotencyKey, claimToken,
        resourceId, now: validNow(now).toISOString()
      };
      try {
        return await options.operationsStore.finalizeConfirmation(finalizeInput);
      } catch {
        return options.operationsStore.finalizeConfirmation(finalizeInput);
      }
    }
  }
}

async function validateReferences(
  options: Pick<StudioOperationsBridgeOptions,
    "companyRepository" | "processRepository" | "trainingRepository"
  >,
  workspaceId: string,
  draft: StudioOperationDraft
) {
  const areaId = "area_id" in draft.payload ? draft.payload.area_id : null;
  await validateArea(options.companyRepository, workspaceId, areaId);
  if (draft.resource_type === "task") {
    await validatePerson(options.companyRepository, workspaceId, draft.payload.assignee_profile_id, areaId);
    return;
  }
  if (draft.resource_type === "routine") {
    const people = new Set([
      ...draft.payload.assignee_profile_ids,
      ...draft.payload.task_templates.map((item) => item.assignee_profile_id).filter((id): id is string => Boolean(id))
    ]);
    for (const personId of people) await validatePerson(options.companyRepository, workspaceId, personId, areaId);
    for (const processId of new Set(draft.payload.task_templates.map((item) => item.process_id).filter((id): id is string => Boolean(id)))) {
      if (!await options.processRepository.findProcess(workspaceId, processId)) throw new Error("STUDIO_OPERATION_PROCESS_NOT_FOUND");
    }
    return;
  }
  if (draft.resource_type === "process") {
    const owner = draft.payload.owner;
    if (owner?.type === "person") await validatePerson(options.companyRepository, workspaceId, owner.person_id, areaId);
    if (owner?.type === "role") await validateRole(options.companyRepository, workspaceId, owner.role_template_id, areaId);
    return;
  }
  const audience = draft.payload.audience;
  if (audience.type === "area") await validateArea(options.companyRepository, workspaceId, audience.area_id);
  if (audience.type === "person") await validatePerson(options.companyRepository, workspaceId, audience.profile_id, null);
  if (audience.type === "role") await validateRole(options.companyRepository, workspaceId, audience.role_template_id, null);
  if (draft.payload.related_process_id && !await options.processRepository.findProcess(workspaceId, draft.payload.related_process_id)) {
    throw new Error("STUDIO_OPERATION_PROCESS_NOT_FOUND");
  }
  if (draft.payload.related_training_id && options.trainingRepository
    && !await options.trainingRepository.findTraining(workspaceId, draft.payload.related_training_id)) {
    throw new Error("STUDIO_OPERATION_TRAINING_NOT_FOUND");
  }
}

async function validateArea(repository: CompanyRepository, workspaceId: string, areaId: string | null | undefined) {
  if (!areaId) return;
  if (!await repository.findAreaById(workspaceId, areaId)) throw new Error("STUDIO_OPERATION_AREA_NOT_FOUND");
}

async function validatePerson(
  repository: CompanyRepository,
  workspaceId: string,
  personId: string | null | undefined,
  areaId: string | null | undefined
) {
  if (!personId) return;
  const person = await repository.findTeamMember(workspaceId, personId);
  if (!person || person.status !== "active") throw new Error("STUDIO_OPERATION_PERSON_NOT_FOUND");
  if (areaId && person.areaId !== areaId && !person.areaAccessIds.includes(areaId)) {
    throw new Error("STUDIO_OPERATION_PERSON_AREA_MISMATCH");
  }
}

async function validateRole(
  repository: CompanyRepository,
  workspaceId: string,
  roleTemplateId: string,
  areaId: string | null | undefined
) {
  const role = (await repository.listRoleTemplates(workspaceId)).find((item) => item.id === roleTemplateId);
  if (!role) throw new Error("STUDIO_OPERATION_ROLE_NOT_FOUND");
  if (areaId && role.areaId !== areaId) throw new Error("STUDIO_OPERATION_ROLE_AREA_MISMATCH");
}

async function createOperationalResource(input: {
  draft: StudioOperationDraft;
  workspaceId: string;
  actorProfileId: string;
  resourceId: string;
  routineService: ReturnType<typeof createRoutineService>;
  processService: ReturnType<typeof createProcessService>;
  announcementService: ReturnType<typeof createAnnouncementService>;
}) {
  const { draft } = input;
  if (draft.resource_type === "task") {
    return (await input.routineService.createManualTask(input.workspaceId, input.actorProfileId, {
      title: draft.payload.title,
      areaId: draft.payload.area_id,
      assigneeProfileId: draft.payload.assignee_profile_id,
      dueDate: draft.payload.due_date,
      dueHint: draft.payload.due_hint,
      approvalMode: draft.payload.approval_mode,
      evidencePolicy: draft.payload.evidence_policy,
      checklistItems: draft.payload.checklist_items
    }, { resourceId: input.resourceId })).id;
  }
  if (draft.resource_type === "routine") {
    return (await input.routineService.createRoutine(input.workspaceId, input.actorProfileId, {
      title: draft.payload.title,
      areaId: draft.payload.area_id,
      frequency: draft.payload.frequency,
      weekdays: draft.payload.weekdays,
      dueHint: draft.payload.due_hint,
      assigneeProfileIds: draft.payload.assignee_profile_ids,
      executionMode: draft.payload.execution_mode,
      approvalMode: draft.payload.approval_mode,
      evidencePolicy: draft.payload.evidence_policy,
      taskTemplates: draft.payload.task_templates.map((item) => ({
        title: item.title,
        processId: item.process_id,
        assigneeProfileId: item.assignee_profile_id,
        dueHint: item.due_hint,
        approvalMode: item.approval_mode,
        evidencePolicy: item.evidence_policy
      }))
    }, { resourceId: input.resourceId })).id;
  }
  if (draft.resource_type === "process") {
    return (await input.processService.createProcess(input.workspaceId, input.actorProfileId, {
      title: draft.payload.title,
      body: draft.payload.body,
      areaId: draft.payload.area_id,
      summary: draft.payload.summary,
      owner: draft.payload.owner?.type === "person"
        ? { type: "person", personId: draft.payload.owner.person_id }
        : draft.payload.owner?.type === "role"
          ? { type: "role", roleTemplateId: draft.payload.owner.role_template_id }
          : null
    }, { resourceId: input.resourceId })).id;
  }
  const audience = draft.payload.audience;
  return (await input.announcementService.createAnnouncement(input.workspaceId, input.actorProfileId, {
    title: draft.payload.title,
    body: draft.payload.body,
    type: draft.payload.type,
    requirement: draft.payload.requirement,
    audience: audience.type === "area" ? { type: "area", areaId: audience.area_id }
      : audience.type === "person" ? { type: "person", profileId: audience.profile_id }
        : audience.type === "role" ? { type: "role", roleTemplateId: audience.role_template_id }
          : { type: "all" },
    relatedProcessId: draft.payload.related_process_id,
    relatedTrainingId: draft.payload.related_training_id,
    quizQuestions: draft.payload.quiz_questions.map((question) => ({
      prompt: question.prompt,
      options: question.options,
      correctOptionId: question.correct_option_id,
      explanation: question.explanation
    }))
  }, { resourceId: input.resourceId })).id;
}

async function findOperationalResource(
  options: Pick<StudioOperationsBridgeOptions, "routineRepository" | "processRepository" | "announcementRepository">,
  workspaceId: string,
  resourceType: StudioOperationResourceType,
  resourceId: string
) {
  if (resourceType === "task") return options.routineRepository.findTaskOccurrence(workspaceId, resourceId);
  if (resourceType === "routine") return options.routineRepository.findRoutine(workspaceId, resourceId);
  if (resourceType === "process") return options.processRepository.findProcess(workspaceId, resourceId);
  return options.announcementRepository.findAnnouncement(workspaceId, resourceId);
}

type StudioOperationPreviewRow = {
  id: string; workspace_id: string; owner_profile_id: string; source_suggestion_id: string;
  source_document_id: string; resource_type: StudioOperationResourceType; payload_json: unknown;
  confirmed_payload_json: unknown | null; status: StudioOperationPreviewStatus; expires_at: string | Date;
  idempotency_key: string | null; intended_resource_id: string | null; result_resource_id: string | null; claim_token: string | null;
  claim_lease_expires_at: string | Date | null; created_at: string | Date; updated_at: string | Date;
  confirmed_at: string | Date | null;
};
type StudioOperationalLinkRow = {
  id: string; workspace_id: string; owner_profile_id: string; preview_id: string; source_suggestion_id: string;
  source_document_id: string; source_structure_id: string | null; resource_type: StudioOperationResourceType;
  resource_id: string; relation_type: "created"; created_by_profile_id: string; created_at: string | Date;
  source_deleted_at: string | Date | null;
};

function previewFromRow(row: StudioOperationPreviewRow): StudioOperationPreview {
  return {
    id: row.id, workspaceId: row.workspace_id, ownerProfileId: row.owner_profile_id,
    sourceSuggestionId: row.source_suggestion_id, sourceDocumentId: row.source_document_id,
    resourceType: row.resource_type, payload: parseDraft(parseJson(row.payload_json)),
    confirmedPayload: row.confirmed_payload_json ? parseDraft(parseJson(row.confirmed_payload_json)) : null,
    status: row.status, expiresAt: iso(row.expires_at), idempotencyKey: row.idempotency_key,
    intendedResourceId: row.intended_resource_id,
    resultResourceId: row.result_resource_id, claimToken: row.claim_token,
    claimLeaseExpiresAt: row.claim_lease_expires_at ? iso(row.claim_lease_expires_at) : null,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    confirmedAt: row.confirmed_at ? iso(row.confirmed_at) : null
  };
}

function linkFromRow(row: StudioOperationalLinkRow): StudioOperationalLink {
  return {
    id: row.id, workspaceId: row.workspace_id, ownerProfileId: row.owner_profile_id,
    previewId: row.preview_id, sourceSuggestionId: row.source_suggestion_id,
    sourceDocumentId: row.source_document_id, sourceStructureId: row.source_structure_id,
    resourceType: row.resource_type, resourceId: row.resource_id, relationType: row.relation_type,
    createdByProfileId: row.created_by_profile_id, createdAt: iso(row.created_at),
    sourceDeletedAt: row.source_deleted_at ? iso(row.source_deleted_at) : null,
    originLabel: row.source_deleted_at ? "origem excluída" : "Estúdio do Dono"
  };
}

async function lockedPreview(client: OperationalClient, scope: StudioOwnerScope, previewId: string) {
  const result = await client.query<StudioOperationPreviewRow>(
    "SELECT * FROM studio_operation_previews WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE",
    [scope.workspaceId, scope.ownerProfileId, previewId]
  );
  return result.rows[0] ? previewFromRow(result.rows[0]) : null;
}

async function readLink(client: Pick<OperationalClient, "query">, scope: StudioOwnerScope, previewId: string) {
  const result = await client.query<StudioOperationalLinkRow>(
    "SELECT * FROM studio_operational_links WHERE workspace_id=$1 AND owner_profile_id=$2 AND preview_id=$3",
    [scope.workspaceId, scope.ownerProfileId, previewId]
  );
  return result.rows[0] ? linkFromRow(result.rows[0]) : null;
}

function parseDraft(value: unknown): StudioOperationDraft {
  const parsed = studioOperationDraftSchema.safeParse(value);
  if (!parsed.success) throw new Error("STUDIO_OPERATION_PAYLOAD_INVALID", { cause: parsed.error });
  return parsed.data;
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { throw new Error("STUDIO_OPERATION_PAYLOAD_CORRUPT"); }
}

function assertActor(scope: StudioOwnerScope, actorProfileId: string) {
  if (scope.ownerProfileId !== actorProfileId) throw new Error("STUDIO_ACTOR_SCOPE_MISMATCH");
}

function assertIdempotencyKey(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error("STUDIO_OPERATION_IDEMPOTENCY_KEY_INVALID");
  }
}

function assertConfirmationFence(preview: StudioOperationPreview, idempotencyKey: string, claimToken: string) {
  if (preview.status !== "confirming" || preview.idempotencyKey !== idempotencyKey || preview.claimToken !== claimToken) {
    throw new Error("STUDIO_OPERATION_CONFIRMATION_FENCE_LOST");
  }
}

function validNow(now: () => Date) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("STUDIO_CLOCK_INVALID");
  return value;
}

function normalizeTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("STUDIO_CLOCK_INVALID");
  return timestamp.toISOString();
}

function sameScope(value: StudioOwnerScope, scope: StudioOwnerScope) {
  return value.workspaceId === scope.workspaceId && value.ownerProfileId === scope.ownerProfileId;
}

function findScoped<T extends StudioOwnerScope & { id: string }>(values: T[], scope: StudioOwnerScope, id: string) {
  return values.find((value) => sameScope(value, scope) && value.id === id);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function publicErrorCode(error: unknown) {
  return error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "STUDIO_OPERATION_DOMAIN_FAILED";
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505");
}
