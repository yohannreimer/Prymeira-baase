import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canManageKnowledge } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext, requireOperationalMembership } from "../../http/auth-context";
import { canManageAreaResource, canReadAreaResource } from "../company/access-policy";
import { createTrainingService } from "./training.service";
import type { TrainingRepository } from "./training.types";

const materialSchema = z.object({
  kind: z.enum(["lesson", "pdf", "link"]),
  title: z.string().min(1).max(140),
  body: z.string().optional().nullable(),
  url: z.string().optional().nullable()
});

const trainingSourceSchema = z.object({
  type: z.enum(["manual", "process", "material"]),
  process_id: z.string().optional().nullable(),
  title: z.string().optional().nullable()
});

const quizQuestionSchema = z.object({
  prompt: z.string().min(1).max(240),
  options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1).max(160) })).min(2),
  correct_option_id: z.string().min(1),
  explanation: z.string().optional().nullable()
});

const assignmentSchema = z.object({
  audience_type: z.enum(["all", "area", "role", "person"]),
  area_id: z.string().optional().nullable(),
  role_template_id: z.string().optional().nullable(),
  profile_id: z.string().optional().nullable(),
  due_date: z.string().min(10).max(10).optional().nullable()
});

const trainingAudienceSchema = z.object({
  type: z.enum(["all", "area", "role", "person"]),
  area_id: z.string().optional().nullable(),
  role_template_id: z.string().optional().nullable(),
  profile_id: z.string().optional().nullable()
});

const createTrainingSchema = z.object({
  title: z.string().min(1).max(140),
  description: z.string().optional().nullable(),
  source: trainingSourceSchema.optional().nullable(),
  audience: trainingAudienceSchema.optional().nullable(),
  due_date: z.string().min(10).max(10).optional().nullable(),
  materials: z.array(materialSchema).min(1),
  quiz_questions: z.array(quizQuestionSchema)
});

const quizAttemptSchema = z.object({
  answers: z.array(
    z.object({
      question_id: z.string().min(1),
      option_id: z.string().min(1)
    })
  )
});

const assignmentsQuerySchema = z.object({
  date: z.string().min(10).max(10).optional()
});

export async function registerTrainingRoutes(app: FastifyInstance, repository: TrainingRepository) {
  const service = createTrainingService(repository);

  app.get("/trainings", async (request) => {
    const context = readRequestContext(request);
    const membership = requireOperationalMembership(request);
    const trainings = await service.listTrainings(context.workspaceId);
    return { trainings: trainings.filter((training) => canReadAudience(membership, training.audience)) };
  });

  app.post("/trainings", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const body = createTrainingSchema.parse(request.body);
    if (!canManageAudience(requireOperationalMembership(request), body.audience)) throw scopeForbidden();
    const training = await service.createTraining(context.workspaceId, context.profileId, {
      title: body.title,
      description: body.description,
      source: readTrainingSource(body.source),
      audience: body.audience ? readTrainingAudience(body.audience) : null,
      dueDate: body.due_date,
      materials: body.materials,
      quizQuestions: body.quiz_questions.map((question) => ({
        prompt: question.prompt,
        options: question.options,
        correctOptionId: question.correct_option_id,
        explanation: question.explanation
      }))
    });

    return reply.status(201).send({ training });
  });

  app.patch("/trainings/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = createTrainingSchema.parse(request.body);
    if (!canManageAudience(requireOperationalMembership(request), body.audience)) throw scopeForbidden();
    const training = await service.updateTraining(context.workspaceId, params.id, {
      title: body.title,
      description: body.description,
      source: readTrainingSource(body.source),
      audience: body.audience ? readTrainingAudience(body.audience) : null,
      dueDate: body.due_date,
      materials: body.materials,
      quizQuestions: body.quiz_questions.map((question) => ({
        prompt: question.prompt,
        options: question.options,
        correctOptionId: question.correct_option_id,
        explanation: question.explanation
      }))
    });

    return { training };
  });

  app.delete("/trainings/:id", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await service.deleteTraining(context.workspaceId, params.id);
    return reply.status(204).send();
  });

  app.post("/trainings/:id/publish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const training = await service.publishTraining(context.workspaceId, params.id);
    return { training };
  });

  app.post("/trainings/:id/unpublish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const training = await service.unpublishTraining(context.workspaceId, params.id);
    return { training };
  });

  app.post("/trainings/:id/assignments", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = assignmentSchema.parse(request.body);
    if (!canManageAudience(requireOperationalMembership(request), body)) throw scopeForbidden();
    const assignment = await service.assignTraining(context.workspaceId, context.profileId, params.id, {
      audience: readTrainingAudience(body),
      dueDate: body.due_date
    });

    return reply.status(201).send({ assignment });
  });

  app.get("/training-assignments", async (request) => {
    const context = readRequestContext(request);
    const query = assignmentsQuerySchema.parse(request.query);
    const assignments = await service.listTrainingProgress(context.workspaceId, {
      profileId: context.profileId,
      date: query.date ?? new Date().toISOString().slice(0, 10)
    });

    return { assignments };
  });

  app.post("/trainings/:id/attempts", async (request, reply) => {
    const context = readRequestContext(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = quizAttemptSchema.parse(request.body);
    const attempt = await service.submitQuizAttempt(context.workspaceId, params.id, context.profileId, {
      answers: body.answers.map((answer) => ({
        questionId: answer.question_id,
        optionId: answer.option_id
      }))
    });

    return reply.status(201).send({ attempt });
  });
}

function canReadAudience(member: ReturnType<typeof requireOperationalMembership>, audience: { type: string; areaId?: string } | null) {
  return !audience || audience.type !== "area" || canReadAreaResource(member, audience.areaId ?? null);
}

function canManageAudience(member: ReturnType<typeof requireOperationalMembership>, audience: { type?: string; area_id?: string | null } | null | undefined) {
  return !audience || audience.type !== "area" || canManageAreaResource(member, audience.area_id ?? null);
}

function scopeForbidden() {
  return new ApiError(403, "BAASE_SCOPE_FORBIDDEN", "Você não tem acesso a esta área.");
}

function readTrainingSource(body: z.infer<typeof trainingSourceSchema> | null | undefined) {
  if (!body) return null;
  return {
    type: body.type,
    processId: body.process_id ?? null,
    title: body.title ?? null
  };
}

function readTrainingAudience(body: z.infer<typeof assignmentSchema> | z.infer<typeof trainingAudienceSchema>) {
  const type = "audience_type" in body ? body.audience_type : body.type;
  if (type === "all") return { type: "all" as const };
  if (type === "area") return { type: "area" as const, areaId: body.area_id ?? "" };
  if (type === "role") return { type: "role" as const, roleTemplateId: body.role_template_id ?? "" };
  return { type: "person" as const, profileId: body.profile_id ?? "" };
}
