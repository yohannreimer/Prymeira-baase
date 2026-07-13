import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canManageKnowledge } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext, requireOperationalMembership } from "../../http/auth-context";
import type { CompanyRepository } from "../company/company.types";
import { canManageAnnouncementAudience, canReadAnnouncementAudience } from "./announcement.access-policy";
import { createAnnouncementService } from "./announcement.service";
import type { Announcement, AnnouncementAudience, AnnouncementRepository } from "./announcement.types";

const quizQuestionSchema = z.object({
  prompt: z.string().min(1).max(240),
  options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1).max(160) })).min(2),
  correct_option_id: z.string().min(1),
  explanation: z.string().optional().nullable()
});

const announcementBaseSchema = z.object({
  title: z.string().min(1).max(160),
  body: z.string().min(1),
  type: z.enum(["simple", "process_change", "mandatory_training"]),
  requirement: z.enum(["none", "read_confirmation", "quiz_confirmation"]),
  related_process_id: z.string().optional().nullable(),
  related_training_id: z.string().optional().nullable(),
  quiz_questions: z.array(quizQuestionSchema).optional()
});

const announcementSchema = z.discriminatedUnion("audience_type", [
  announcementBaseSchema.extend({ audience_type: z.literal("all") }),
  announcementBaseSchema.extend({ audience_type: z.literal("area"), area_id: z.string().trim().min(1) }),
  announcementBaseSchema.extend({ audience_type: z.literal("role"), role_template_id: z.string().trim().min(1) }),
  announcementBaseSchema.extend({ audience_type: z.literal("person"), profile_id: z.string().trim().min(1) })
]);

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
  if (error instanceof Error && [
    "ANNOUNCEMENT_AUDIENCE_AREA_NOT_FOUND",
    "ANNOUNCEMENT_AUDIENCE_ROLE_NOT_FOUND",
    "ANNOUNCEMENT_AUDIENCE_PERSON_NOT_FOUND"
  ].includes(error.message)) {
    return new ApiError(422, error.message, "O público do comunicado não existe nesta empresa.");
  }
  return error;
}

export async function registerAnnouncementRoutes(
  app: FastifyInstance,
  repository: AnnouncementRepository,
  companyRepository: CompanyRepository
) {
  const service = createAnnouncementService(repository);

  app.get("/announcements", async (request) => {
    const context = readRequestContext(request);
    const membership = requireOperationalMembership(request);
    const delivered = await service.listAnnouncementsForProfile(context.workspaceId, {
      profileId: context.profileId,
      role: context.role,
      areaId: membership.person.areaId,
      roleTemplateId: membership.person.roleTemplateId
    });
    const visible = await filterAsync(delivered, (announcement) => canReadAnnouncementAudience(
      companyRepository, context.workspaceId, membership, announcement.audience
    ));
    if (!canManageKnowledge(context.role)) return { announcements: visible };

    const manageable = await filterAsync(await service.listAnnouncements(context.workspaceId), (announcement) => {
      return canManageAnnouncementAudience(companyRepository, context.workspaceId, membership, announcement.audience);
    });
    return { announcements: mergeAnnouncements(visible, manageable) };
  });

  app.post("/announcements", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const body = announcementSchema.parse(request.body);
    const audience = readAnnouncementAudience(body);
    try {
      if (!await canManageAnnouncementAudience(companyRepository, context.workspaceId, requireOperationalMembership(request), audience)) throw scopeForbidden();
      const announcement = await service.createAnnouncement(context.workspaceId, context.profileId, {
        title: body.title,
        body: body.body,
        type: body.type,
        requirement: body.requirement,
        audience,
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
    } catch (error) {
      throw announcementMutationError(error);
    }
  });

  app.post("/announcements/:id/publish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      await requireManagedAnnouncement(repository, companyRepository, context.workspaceId, requireOperationalMembership(request), params.id);
      return { announcement: await service.publishAnnouncement(context.workspaceId, params.id) };
    } catch (error) {
      throw announcementMutationError(error);
    }
  });

  app.post("/announcements/:id/unpublish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      await requireManagedAnnouncement(repository, companyRepository, context.workspaceId, requireOperationalMembership(request), params.id);
      return { announcement: await service.unpublishAnnouncement(context.workspaceId, params.id) };
    } catch (error) {
      throw announcementMutationError(error);
    }
  });

  app.delete("/announcements/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    try {
      await requireManagedAnnouncement(repository, companyRepository, context.workspaceId, requireOperationalMembership(request), params.id);
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
    try {
      const announcement = await requireAnnouncement(repository, context.workspaceId, params.id);
      if (!await canReadAnnouncementAudience(companyRepository, context.workspaceId, requireOperationalMembership(request), announcement.audience)) {
        throw scopeForbidden();
      }
      const receipt = await service.confirmAnnouncement(context.workspaceId, params.id, context.profileId, {
        answers: body.answers?.map((answer) => ({
          questionId: answer.question_id,
          optionId: answer.option_id
        }))
      });
      return { receipt };
    } catch (error) {
      throw announcementMutationError(error);
    }
  });

  app.get("/announcement-receipts", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const query = receiptsQuerySchema.parse(request.query);
    const receipts = await service.listReceipts(context.workspaceId, {
      announcementId: query.announcement_id,
      profileId: query.profile_id
    });
    const membership = requireOperationalMembership(request);
    const announcementsById = new Map((await service.listAnnouncements(context.workspaceId)).map((announcement) => [announcement.id, announcement]));
    return {
      receipts: await filterAsync(receipts, async (receipt) => {
        const announcement = announcementsById.get(receipt.announcementId);
        return Boolean(announcement && await canManageAnnouncementAudience(
          companyRepository,
          context.workspaceId,
          membership,
          announcement.audience
        ));
      })
    };
  });
}

function scopeForbidden() {
  return new ApiError(403, "BAASE_SCOPE_FORBIDDEN", "Você não tem acesso a esta área.");
}

function readAnnouncementAudience(body: z.infer<typeof announcementSchema>): AnnouncementAudience {
  if (body.audience_type === "all") return { type: "all" as const };
  if (body.audience_type === "area") return { type: "area" as const, areaId: body.area_id };
  if (body.audience_type === "role") return { type: "role" as const, roleTemplateId: body.role_template_id };
  return { type: "person" as const, profileId: body.profile_id };
}

async function requireAnnouncement(repository: AnnouncementRepository, workspaceId: string, announcementId: string) {
  const announcement = await repository.findAnnouncement(workspaceId, announcementId);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");
  return announcement;
}

async function requireManagedAnnouncement(
  repository: AnnouncementRepository,
  companyRepository: CompanyRepository,
  workspaceId: string,
  membership: ReturnType<typeof requireOperationalMembership>,
  announcementId: string
) {
  const announcement = await requireAnnouncement(repository, workspaceId, announcementId);
  if (!await canManageAnnouncementAudience(companyRepository, workspaceId, membership, announcement.audience)) throw scopeForbidden();
  return announcement;
}

async function filterAsync<T>(items: T[], predicate: (item: T) => Promise<boolean>) {
  const matches = await Promise.all(items.map(predicate));
  return items.filter((_item, index) => matches[index]);
}

function mergeAnnouncements(delivered: Announcement[], manageable: Announcement[]) {
  const byId = new Map(delivered.map((announcement) => [announcement.id, announcement]));
  for (const announcement of manageable) {
    if (!byId.has(announcement.id)) byId.set(announcement.id, announcement);
  }
  return [...byId.values()];
}
