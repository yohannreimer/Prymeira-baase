import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canManageKnowledge } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext, requireOperationalMembership } from "../../http/auth-context";
import { canManageAreaResource, canReadAreaResource } from "../company/access-policy";
import { createTrainingService } from "./training.service";
import type { TrainingRepository } from "./training.types";
import type { CompanyRepository } from "../company/company.types";

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

export async function registerTrainingRoutes(app: FastifyInstance, repository: TrainingRepository, companyRepository: CompanyRepository) {
  const service = createTrainingService(repository);

  app.get("/trainings", async (request) => {
    const context = readRequestContext(request);
    const membership = requireOperationalMembership(request);
    const trainings = await service.listTrainings(context.workspaceId);
    const visible = await filterAsync(trainings, async (training) => {
      if (membership.role === "employee" && training.status !== "published") return false;
      return canReadAudience(membership, training.audience, companyRepository, context.workspaceId);
    });
    return { trainings: visible };
  });

  app.post("/trainings", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const body = createTrainingSchema.parse(request.body);
    await assertCanManageAudience(requireOperationalMembership(request), body.audience, companyRepository, context.workspaceId);
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
    await requireManagedTraining(repository, companyRepository, context.workspaceId, params.id, requireOperationalMembership(request));
    await assertCanManageAudience(requireOperationalMembership(request), body.audience, companyRepository, context.workspaceId);
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
    await requireManagedTraining(repository, companyRepository, context.workspaceId, params.id, requireOperationalMembership(request));
    await service.deleteTraining(context.workspaceId, params.id);
    return reply.status(204).send();
  });

  app.post("/trainings/:id/publish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await requireManagedTraining(repository, companyRepository, context.workspaceId, params.id, requireOperationalMembership(request));
    const training = await service.publishTraining(context.workspaceId, params.id);
    return { training };
  });

  app.post("/trainings/:id/unpublish", async (request) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await requireManagedTraining(repository, companyRepository, context.workspaceId, params.id, requireOperationalMembership(request));
    const training = await service.unpublishTraining(context.workspaceId, params.id);
    return { training };
  });

  app.post("/trainings/:id/assignments", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await requireManagedTraining(repository, companyRepository, context.workspaceId, params.id, requireOperationalMembership(request));
    const body = assignmentSchema.parse(request.body);
    await assertCanManageAudience(requireOperationalMembership(request), body, companyRepository, context.workspaceId);
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
    const membership = requireOperationalMembership(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = quizAttemptSchema.parse(request.body);
    const training = await repository.findTraining(context.workspaceId, params.id);
    if (!training || training.status !== "published") throw new ApiError(404, "TRAINING_NOT_FOUND", "Treinamento não encontrado.");
    if (!await canReadAudience(membership, training.audience, companyRepository, context.workspaceId)) throw scopeForbidden();
    const attempt = await service.submitQuizAttempt(context.workspaceId, params.id, context.profileId, {
      answers: body.answers.map((answer) => ({
        questionId: answer.question_id,
        optionId: answer.option_id
      }))
    });

    return reply.status(201).send({ attempt });
  });
}

async function canReadAudience(
  member: ReturnType<typeof requireOperationalMembership>,
  audience: { type: string; areaId?: string; roleTemplateId?: string; profileId?: string } | null,
  companyRepository: CompanyRepository,
  workspaceId: string
) {
  if (!audience || audience.type === "all" || member.role === "owner") return true;
  if (audience.type === "area") return canReadAreaResource(member, audience.areaId ?? null);
  if (member.role === "employee") {
    if (audience.type === "role") return audience.roleTemplateId === member.person.roleTemplateId;
    return audience.profileId === member.personId;
  }
  if (audience.type === "role") {
    const role = (await companyRepository.listRoleTemplates(workspaceId)).find((item) => item.id === audience.roleTemplateId);
    return Boolean(role && canReadAreaResource(member, role.areaId));
  }
  const person = await companyRepository.findTeamMember(workspaceId, audience.profileId ?? "");
  return Boolean(person && canReadAreaResource(member, person.areaId));
}

async function assertCanManageAudience(
  member: ReturnType<typeof requireOperationalMembership>,
  audience: { type?: string; audience_type?: string; area_id?: string | null; areaId?: string; profile_id?: string | null; profileId?: string; role_template_id?: string | null; roleTemplateId?: string } | null | undefined,
  companyRepository: CompanyRepository,
  workspaceId: string
) {
  if (member.role === "owner") return;
  const audienceType = audience?.audience_type ?? audience?.type;
  if (!audience || audienceType === "all") {
    if (member.role !== "manager" || member.accessScope !== "workspace") throw scopeForbidden();
    return;
  }
  if (audienceType === "area") {
    if (!canManageAreaResource(member, audience.area_id ?? audience.areaId ?? null)) throw scopeForbidden();
    return;
  }
  if (audienceType === "person") {
    const person = await companyRepository.findTeamMember(workspaceId, audience.profile_id ?? audience.profileId ?? "");
    if (!person || !canManageAreaResource(member, person.areaId)) throw scopeForbidden();
    return;
  }
  const roleId = audience.role_template_id ?? audience.roleTemplateId ?? "";
  const role = (await companyRepository.listRoleTemplates(workspaceId)).find((item) => item.id === roleId);
  if (!role || !canManageAreaResource(member, role.areaId)) throw scopeForbidden();
}

async function requireManagedTraining(
  repository: TrainingRepository,
  companyRepository: CompanyRepository,
  workspaceId: string,
  trainingId: string,
  membership: ReturnType<typeof requireOperationalMembership>
) {
  const training = await repository.findTraining(workspaceId, trainingId);
  if (!training) throw new ApiError(404, "TRAINING_NOT_FOUND", "Treinamento não encontrado.");
  await assertCanManageAudience(membership, training.audience, companyRepository, workspaceId);
  return training;
}

function scopeForbidden() {
  return new ApiError(403, "BAASE_SCOPE_FORBIDDEN", "Você não tem acesso a esta área.");
}

async function filterAsync<T>(items: T[], predicate: (item: T) => Promise<boolean>) {
  const matches = await Promise.all(items.map(predicate));
  return items.filter((_item, index) => matches[index]);
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
