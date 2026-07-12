import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canManageKnowledge } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext, requireOperationalMembership } from "../../http/auth-context";
import { canManageAreaResource, canReadAreaResource } from "../company/access-policy";
import { createAnnouncementService } from "./announcement.service";
import type { AnnouncementRepository } from "./announcement.types";

const quizQuestionSchema = z.object({
  prompt: z.string().min(1).max(240),
  options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1).max(160) })).min(2),
  correct_option_id: z.string().min(1),
  explanation: z.string().optional().nullable()
});

const announcementSchema = z.object({
  title: z.string().min(1).max(160),
  body: z.string().min(1),
  type: z.enum(["simple", "process_change", "mandatory_training"]),
  requirement: z.enum(["none", "read_confirmation", "quiz_confirmation"]),
  audience_type: z.enum(["all", "area", "role", "person"]),
  area_id: z.string().optional().nullable(),
  role_template_id: z.string().optional().nullable(),
  profile_id: z.string().optional().nullable(),
  related_process_id: z.string().optional().nullable(),
  related_training_id: z.string().optional().nullable(),
  quiz_questions: z.array(quizQuestionSchema).optional()
});

const confirmSchema = z.object({
  answers: z.array(z.object({
    question_id: z.string().min(1),
    option_id: z.string().min(1)
  })).optional()
});

const receiptsQuerySchema = z.object({
  announcement_id: z.string().optional(),
  profile_id: z.string().optional()
});

function announcementMutationError(error: unknown) {
  if (error instanceof Error && error.message === "ANNOUNCEMENT_NOT_FOUND") {
    return new ApiError(404, "ANNOUNCEMENT_NOT_FOUND", "Comunicado não encontrado.");
  }
  return error;
}

export async function registerAnnouncementRoutes(app: FastifyInstance, repository: AnnouncementRepository) {
  const service = createAnnouncementService(repository);

  app.get("/announcements", async (request) => {
    const context = readRequestContext(request);
    const membership = requireOperationalMembership(request);
    if (canManageKnowledge(context.role)) {
      const announcements = await service.listAnnouncements(context.workspaceId);
      return { announcements: announcements.filter((announcement) => canReadAudience(membership, announcement.audience)) };
    }

    const announcements = await service.listAnnouncementsForProfile(context.workspaceId, {
      profileId: context.profileId,
      role: context.role
    });
    return { announcements: announcements.filter((announcement) => canReadAudience(membership, announcement.audience)) };
  });

  app.post("/announcements", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const body = announcementSchema.parse(request.body);
    if (!canManageAudience(requireOperationalMembership(request), body)) throw scopeForbidden();
    const announcement = await service.createAnnouncement(context.workspaceId, context.profileId, {
      title: body.title,
      body: body.body,
      type: body.type,
      requirement: body.requirement,
      audience: readAnnouncementAudience(body),
      relatedProcessId: body.related_process_id,
      relatedTrainingId: body.related_training_id,
      quizQuestions: (body.quiz_questions ?? []).map((question) => ({
        prompt: question.prompt,
        options: question.options,
        correctOptionId: question.correct_option_id,
        explanation: question.explanation
      }))
    });

    return reply.status(201).send({ announcement });
  });

  app.post("/announcements/:id/publish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const announcement = await service.publishAnnouncement(context.workspaceId, params.id);
    return { announcement };
  });

  app.post("/announcements/:id/unpublish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const announcement = await service.unpublishAnnouncement(context.workspaceId, params.id);
    return { announcement };
  });

  app.delete("/announcements/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    try {
      await service.deleteAnnouncement(context.workspaceId, params.id);
      return { ok: true };
    } catch (error) {
      throw announcementMutationError(error);
    }
  });

  app.post("/announcements/:id/confirm", async (request) => {
    const context = readRequestContext(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = confirmSchema.parse(request.body ?? {});
    const receipt = await service.confirmAnnouncement(context.workspaceId, params.id, context.profileId, {
      answers: body.answers?.map((answer) => ({
        questionId: answer.question_id,
        optionId: answer.option_id
      }))
    });
    return { receipt };
  });

  app.get("/announcement-receipts", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const query = receiptsQuerySchema.parse(request.query);
    const receipts = await service.listReceipts(context.workspaceId, {
      announcementId: query.announcement_id,
      profileId: query.profile_id
    });
    return { receipts };
  });
}

function canReadAudience(member: ReturnType<typeof requireOperationalMembership>, audience: { type: string; areaId?: string }) {
  return audience.type !== "area" || canReadAreaResource(member, audience.areaId ?? null);
}

function canManageAudience(member: ReturnType<typeof requireOperationalMembership>, audience: { audience_type: string; area_id?: string | null }) {
  return audience.audience_type !== "area" || canManageAreaResource(member, audience.area_id ?? null);
}

function scopeForbidden() {
  return new ApiError(403, "BAASE_SCOPE_FORBIDDEN", "Você não tem acesso a esta área.");
}

function readAnnouncementAudience(body: z.infer<typeof announcementSchema>) {
  if (body.audience_type === "all") return { type: "all" as const };
  if (body.audience_type === "area") return { type: "area" as const, areaId: body.area_id ?? "" };
  if (body.audience_type === "role") return { type: "role" as const, roleTemplateId: body.role_template_id ?? "" };
  return { type: "person" as const, profileId: body.profile_id ?? "" };
}
