import type {
  Announcement,
  AnnouncementAudience,
  AnnouncementListContext,
  AnnouncementQuizAnswerInput,
  AnnouncementQuizQuestion,
  AnnouncementReceipt,
  AnnouncementRepository,
  AnnouncementWithReceipt,
  CreateAnnouncementInput
} from "./announcement.types";

type CreateAnnouncementQuizInput = NonNullable<CreateAnnouncementInput["quizQuestions"]>[number];

function requiredText(value: string, errorCode: string) {
  const text = value.trim();
  if (!text) throw new Error(errorCode);
  return text;
}

function optionalText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function buildQuizQuestion(workspaceId: string, index: number, input: CreateAnnouncementQuizInput): AnnouncementQuizQuestion {
  const sortOrder = index + 1;
  if (input.options.length < 2) throw new Error("ANNOUNCEMENT_QUIZ_OPTIONS_REQUIRED");
  if (!input.options.some((option) => option.id === input.correctOptionId)) throw new Error("ANNOUNCEMENT_QUIZ_CORRECT_OPTION_INVALID");

  return {
    id: `announcement_question___announcement___${sortOrder}`,
    announcementId: "__announcement__",
    workspaceId,
    prompt: requiredText(input.prompt, "ANNOUNCEMENT_QUIZ_PROMPT_REQUIRED"),
    options: input.options.map((option) => ({
      id: requiredText(option.id, "ANNOUNCEMENT_QUIZ_OPTION_ID_REQUIRED"),
      label: requiredText(option.label, "ANNOUNCEMENT_QUIZ_OPTION_LABEL_REQUIRED")
    })),
    correctOptionId: input.correctOptionId,
    explanation: optionalText(input.explanation),
    sortOrder
  };
}

export function createAnnouncementService(repository: AnnouncementRepository) {
  return {
    async createAnnouncement(
      workspaceId: string,
      actorProfileId: string,
      input: CreateAnnouncementInput,
      identity: { resourceId?: string } = {}
    ) {
      if (input.requirement === "quiz_confirmation" && (input.quizQuestions ?? []).length === 0) {
        throw new Error("ANNOUNCEMENT_QUIZ_REQUIRED");
      }

      if (identity.resourceId) {
        const existing = await repository.findAnnouncement(workspaceId, identity.resourceId);
        if (existing) return existing;
      }
      const createInput: Parameters<AnnouncementRepository["createAnnouncement"]>[0] = {
        ...(identity.resourceId ? { id: identity.resourceId } : {}),
        workspaceId,
        title: requiredText(input.title, "ANNOUNCEMENT_TITLE_REQUIRED"),
        body: requiredText(input.body, "ANNOUNCEMENT_BODY_REQUIRED"),
        type: input.type,
        status: "draft",
        requirement: input.requirement,
        audience: normalizeAudience(input.audience),
        relatedProcessId: optionalText(input.relatedProcessId),
        relatedTrainingId: optionalText(input.relatedTrainingId),
        quizQuestions: (input.quizQuestions ?? []).map((question, index) => buildQuizQuestion(workspaceId, index, question)),
        createdByProfileId: actorProfileId,
        publishedAt: null,
        archivedAt: null
      };
      try {
        return await repository.createAnnouncement(createInput);
      } catch (error) {
        if (identity.resourceId) {
          const existing = await repository.findAnnouncement(workspaceId, identity.resourceId);
          if (existing) return existing;
        }
        throw error;
      }
    },

    listAnnouncements(workspaceId: string) {
      return repository.listAnnouncements(workspaceId);
    },

    async listAnnouncementsForProfile(workspaceId: string, context: AnnouncementListContext): Promise<AnnouncementWithReceipt[]> {
      const announcements = await repository.listAnnouncements(workspaceId);
      const published = announcements.filter((announcement) => {
        return announcement.status === "published" && audienceMatchesProfile(announcement.audience, context);
      });

      return Promise.all(published.map(async (announcement) => ({
        ...announcement,
        receipt: await readReceiptForProfile(repository, announcement, context.profileId)
      })));
    },

    async publishAnnouncement(workspaceId: string, announcementId: string) {
      const announcement = await readAnnouncementOrThrow(repository, workspaceId, announcementId);
      return repository.updateAnnouncement({
        ...announcement,
        status: "published",
        publishedAt: new Date().toISOString()
      });
    },

    async unpublishAnnouncement(workspaceId: string, announcementId: string) {
      const announcement = await readAnnouncementOrThrow(repository, workspaceId, announcementId);
      return repository.updateAnnouncement({
        ...announcement,
        status: "draft",
        publishedAt: null
      });
    },

    async deleteAnnouncement(workspaceId: string, announcementId: string) {
      const announcement = await readAnnouncementOrThrow(repository, workspaceId, announcementId);
      await repository.deleteAnnouncement(workspaceId, announcementId);
      return announcement;
    },

    async confirmAnnouncement(
      workspaceId: string,
      announcementId: string,
      profileId: string,
      input: { answers?: AnnouncementQuizAnswerInput[] }
    ) {
      const announcement = await readAnnouncementOrThrow(repository, workspaceId, announcementId);
      if (announcement.status !== "published") throw new Error("ANNOUNCEMENT_NOT_PUBLISHED");

      const existingReceipt = await readReceiptForProfile(repository, announcement, profileId);
      const timestamp = new Date().toISOString();

      if (announcement.requirement === "quiz_confirmation") {
        const answers = input.answers ?? [];
        const score = scoreAnnouncementQuiz(announcement.quizQuestions, answers);
        const passed = score === 100;
        return repository.upsertAnnouncementReceipt({
          ...existingReceipt,
          status: passed ? "quiz_completed" : "pending",
          quizScore: score,
          passed,
          answers,
          readAt: existingReceipt.readAt ?? timestamp,
          confirmedAt: passed ? timestamp : existingReceipt.confirmedAt,
          quizCompletedAt: passed ? timestamp : existingReceipt.quizCompletedAt
        });
      }

      return repository.upsertAnnouncementReceipt({
        ...existingReceipt,
        status: "confirmed",
        quizScore: null,
        passed: null,
        answers: [],
        readAt: existingReceipt.readAt ?? timestamp,
        confirmedAt: timestamp,
        quizCompletedAt: null
      });
    },

    listReceipts(workspaceId: string, filters: { announcementId?: string; profileId?: string } = {}) {
      return repository.listAnnouncementReceipts(workspaceId, filters);
    }
  };
}

async function readAnnouncementOrThrow(repository: AnnouncementRepository, workspaceId: string, announcementId: string) {
  const announcement = await repository.findAnnouncement(workspaceId, announcementId);
  if (!announcement) throw new Error("ANNOUNCEMENT_NOT_FOUND");
  return announcement;
}

async function readReceiptForProfile(repository: AnnouncementRepository, announcement: Announcement, profileId: string): Promise<AnnouncementReceipt> {
  const existing = (await repository.listAnnouncementReceipts(announcement.workspaceId, {
    announcementId: announcement.id,
    profileId
  }))[0];
  if (existing) return existing;

  const timestamp = new Date().toISOString();
  return {
    id: "",
    workspaceId: announcement.workspaceId,
    announcementId: announcement.id,
    profileId,
    status: "pending",
    quizScore: null,
    passed: null,
    answers: [],
    readAt: null,
    confirmedAt: null,
    quizCompletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function scoreAnnouncementQuiz(questions: AnnouncementQuizQuestion[], answers: AnnouncementQuizAnswerInput[]) {
  if (questions.length === 0) throw new Error("ANNOUNCEMENT_QUIZ_REQUIRED");
  const answerByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer.optionId]));
  const correct = questions.filter((question) => answerByQuestionId.get(question.id) === question.correctOptionId).length;
  return Math.round((correct / questions.length) * 100);
}

function normalizeAudience(audience: AnnouncementAudience): AnnouncementAudience {
  if (audience.type === "all") return audience;
  if (audience.type === "area") return { type: "area", areaId: requiredText(audience.areaId, "ANNOUNCEMENT_AUDIENCE_AREA_REQUIRED") };
  if (audience.type === "role") return { type: "role", roleTemplateId: requiredText(audience.roleTemplateId, "ANNOUNCEMENT_AUDIENCE_ROLE_REQUIRED") };
  return { type: "person", profileId: requiredText(audience.profileId, "ANNOUNCEMENT_AUDIENCE_PERSON_REQUIRED") };
}

function audienceMatchesProfile(
  audience: AnnouncementAudience,
  profile: { profileId: string; areaId?: string | null; roleTemplateId?: string | null }
) {
  if (audience.type === "all") return true;
  if (audience.type === "person") return audience.profileId === profile.profileId;
  if (audience.type === "area") return Boolean(profile.areaId && audience.areaId === profile.areaId);
  return Boolean(profile.roleTemplateId && audience.roleTemplateId === profile.roleTemplateId);
}
