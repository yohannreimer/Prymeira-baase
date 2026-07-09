import { formatProcessSopBody } from "@prymeira/baase-shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canEditCompanyBase } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import { createAiHarness } from "../ai/ai-harness";
import type { AiProvider, AiRepository } from "../ai/ai.types";
import { getPromptDefinition } from "../ai/prompt-registry";
import { onboardingDiagnosisSchema, onboardingSetupSuggestionSchema } from "../ai/schema-registry";
import { createAnnouncementService } from "../announcements/announcement.service";
import type { Announcement, AnnouncementRepository } from "../announcements/announcement.types";
import { createCompanyService } from "../company/company.service";
import type { Area, CompanyRepository, RoleTemplate } from "../company/company.types";
import { createOnboardingService } from "./onboarding.service";
import type { OnboardingRepository, OnboardingReviewDecision, OnboardingSetupSuggestion } from "./onboarding.types";
import { createProcessService } from "../processes/process.service";
import type { ProcessRepository } from "../processes/process.types";
import { createRoutineService } from "../routines/routine.service";
import type { RoutineRepository } from "../routines/routine.types";
import { createTrainingService } from "../trainings/training.service";
import type { TrainingRepository } from "../trainings/training.types";

type OnboardingRouteRepositories = {
  companyRepository: CompanyRepository;
  processRepository: ProcessRepository;
  routineRepository: RoutineRepository;
  trainingRepository: TrainingRepository;
  announcementRepository: AnnouncementRepository;
  onboardingRepository: OnboardingRepository;
  aiRepository: AiRepository;
  aiProvider: AiProvider;
};

const createSessionSchema = z.object({
  current_step: z.string().min(1).default("identity")
});

const answerSchema = z.object({
  question_id: z.string().min(1),
  theme: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  input_mode: z.enum(["text", "audio"]).default("text")
});

const followupAnswerSchema = z.object({
  question_id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  input_mode: z.enum(["text", "audio"]).default("text")
});

const patchSessionSchema = z.object({
  current_step: z.string().min(1).optional(),
  company_name: z.string().min(1).max(140).optional().nullable(),
  segment: z.string().min(1).max(120).optional().nullable(),
  custom_segment: z.string().min(1).max(160).optional().nullable(),
  normalized_segment: z.string().min(1).max(160).optional().nullable(),
  team_size_range: z.string().min(1).max(40).optional().nullable(),
  goals: z.array(z.string().min(1)).max(12).optional(),
  main_answers: z.array(answerSchema).max(12).optional()
});

const reviewDecisionSchema = z.object({
  item_type: z.enum(["area", "role", "person", "process", "routine", "training", "announcement", "invite"]),
  item_id: z.string().min(1),
  action: z.enum(["create", "remove", "draft", "publish", "activate"]),
  edited_payload: z.record(z.string(), z.unknown()).nullable().optional()
});

const nullableDescriptionSchema = z.union([z.string().trim().min(1).max(240), z.null()]);
const areaReviewPayloadSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: nullableDescriptionSchema
}).partial().strict();
const roleReviewPayloadSchema = z.object({
  areaName: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  description: nullableDescriptionSchema
}).partial().strict();
const personReviewPayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.union([z.string().trim().email(), z.null()]),
  role: z.enum(["owner", "manager", "employee"]),
  areaName: z.union([z.string().trim().min(1).max(80), z.null()]),
  roleName: z.union([z.string().trim().min(1).max(80), z.null()]),
  placeholder: z.boolean()
}).partial().strict();
const processReviewPayloadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1),
  areaName: z.union([z.string().trim().min(1).max(80), z.null()])
}).partial().strict();
const routineReviewPayloadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  areaName: z.union([z.string().trim().min(1).max(80), z.null()]),
  taskTitles: z.array(z.string().trim().min(1).max(120)).min(1).max(20)
}).partial().strict();
const trainingReviewPayloadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(240),
  materialBody: z.string().trim().min(1),
  quizPrompt: z.string().trim().min(1).max(240)
}).partial().strict();
const announcementReviewPayloadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1)
}).partial().strict();

const setupSchema = z.object({
  segment: z.string().min(1).max(120),
  areas: z.array(z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(240).optional().nullable()
  })).min(1).max(12),
  roles: z.array(z.object({
    area_name: z.string().min(1).max(80),
    name: z.string().min(1).max(80),
    description: z.string().max(240).optional().nullable()
  })).max(40),
  people: z.array(z.object({
    name: z.string().min(1).max(120),
    email: z.string().email().optional().nullable(),
    role: z.enum(["owner", "manager", "employee"]),
    area_name: z.string().max(80).optional().nullable(),
    role_name: z.string().max(80).optional().nullable()
  })).max(80),
  processes: z.array(z.object({
    title: z.string().min(1).max(120),
    summary: z.string().max(240).optional().nullable(),
    body: z.string().min(1).optional(),
    objective: z.string().min(1).optional(),
    trigger: z.string().min(1).optional(),
    operational_rule: z.string().min(1).optional().nullable(),
    steps: z.array(z.object({
      title: z.string().min(1).max(160),
      instruction: z.string().min(1),
      expected_result: z.string().min(1),
      attention_points: z.array(z.string().min(1).max(180)).max(3).optional().default([])
    })).min(3).max(12).optional(),
    area_name: z.string().max(80).optional().nullable()
  }).refine((process) => Boolean(process.body || (process.objective && process.trigger && process.steps?.length)), {
    message: "Informe body ou objective/trigger/steps para o processo."
  })).max(40),
  routines: z.array(z.object({
    title: z.string().min(1).max(120),
    area_name: z.string().max(80).optional().nullable(),
    task_titles: z.array(z.string().min(1).max(120)).min(1).max(20)
  })).max(40),
  trainings: z.array(z.object({
    title: z.string().min(1).max(120),
    description: z.string().max(240).optional().nullable(),
    material_body: z.string().min(1),
    quiz_prompt: z.string().min(1).max(240)
  })).max(40),
  announcement: z.object({
    title: z.string().min(1).max(120),
    body: z.string().min(1)
  }).optional().nullable()
});

export async function registerOnboardingRoutes(app: FastifyInstance, repositories: OnboardingRouteRepositories) {
  const companyService = createCompanyService(repositories.companyRepository);
  const processService = createProcessService(repositories.processRepository);
  const routineService = createRoutineService(repositories.routineRepository);
  const trainingService = createTrainingService(repositories.trainingRepository);
  const announcementService = createAnnouncementService(repositories.announcementRepository);
  const onboardingService = createOnboardingService(repositories.onboardingRepository);
  const harness = createAiHarness({
    repository: repositories.aiRepository,
    provider: repositories.aiProvider
  });
  const diagnosisLocks = new Set<string>();
  const setupGenerationLocks = new Set<string>();
  const completionLocks = new Set<string>();

  app.get("/onboarding/session", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();
    const session = await repositories.onboardingRepository.getCurrentSession(context.workspaceId);
    return { session: session ? onboardingService.serialize(session) : null };
  });

  app.post("/onboarding/session", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();
    const body = createSessionSchema.parse(request.body);
    const session = await onboardingService.getOrCreateSession(
      context.workspaceId,
      context.profileId,
      body.current_step
    );
    return reply.status(201).send({ session: onboardingService.serialize(session) });
  });

  app.patch("/onboarding/session", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();
    const body = patchSessionSchema.parse(request.body);
    const session = await onboardingService.patchSession(context.workspaceId, context.profileId, {
      currentStep: body.current_step,
      companyName: body.company_name,
      segment: body.segment,
      customSegment: body.custom_segment,
      normalizedSegment: body.normalized_segment,
      teamSizeRange: body.team_size_range,
      goals: body.goals,
      mainAnswers: body.main_answers?.map((answer) => ({
        questionId: answer.question_id,
        theme: answer.theme,
        question: answer.question,
        answer: answer.answer,
        inputMode: answer.input_mode
      }))
    });
    return { session: onboardingService.serialize(session) };
  });

  app.post("/onboarding/session/skip", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();
    const session = await onboardingService.setStatus(context.workspaceId, context.profileId, "skipped", "skipped");
    return { session: onboardingService.serialize(session) };
  });

  app.post("/onboarding/session/diagnosis", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const session = await repositories.onboardingRepository.getCurrentSession(context.workspaceId);
    if (!session) {
      throw new ApiError(404, "ONBOARDING_SESSION_NOT_FOUND", "Onboarding não iniciado.");
    }
    if (!["in_progress", "diagnosis_ready", "followup"].includes(session.status)) {
      throw new ApiError(409, "ONBOARDING_SESSION_CLOSED", "Este onboarding não pode mais gerar diagnóstico.");
    }

    const normalizedSegment = session.normalizedSegment ?? session.customSegment ?? session.segment;
    if (!session.companyName || !normalizedSegment || session.mainAnswers.length === 0) {
      throw new ApiError(
        400,
        "ONBOARDING_DIAGNOSIS_INPUT_INCOMPLETE",
        "Responda as informações principais antes de gerar o diagnóstico."
      );
    }

    const diagnosisLockKey = `${context.workspaceId}:${session.id}`;
    if (diagnosisLocks.has(diagnosisLockKey)) {
      throw new ApiError(409, "ONBOARDING_DIAGNOSIS_IN_PROGRESS", "O diagnóstico deste onboarding já está em geração.");
    }

    diagnosisLocks.add(diagnosisLockKey);
    try {
      const prompt = getPromptDefinition("agent/onboarding-diagnostician", "1");
      const result = await harness.runStructured({
        workspaceId: context.workspaceId,
        actorProfileId: context.profileId,
        source: "onboarding",
        inputMode: session.mainAnswers.some((answer) => answer.inputMode === "audio") ? "mixed" : "text",
        taskKind: "onboarding_diagnosis",
        agentKey: "onboarding_diagnostician",
        promptKey: prompt.key,
        promptVersion: prompt.version,
        model: "gpt-5.5",
        reasoningEffort: "medium",
        input: {
          companyName: session.companyName,
          segment: session.segment,
          customSegment: session.customSegment,
          normalizedSegment,
          teamSizeRange: session.teamSizeRange,
          goals: session.goals,
          answers: session.mainAnswers,
          attachments: session.attachments,
          context: {
            workspaceId: context.workspaceId,
            ownerProfileId: session.ownerProfileId
          }
        },
        outputSchema: onboardingDiagnosisSchema,
        schemaName: "onboarding_diagnosis"
      });

      const latestSession = await repositories.onboardingRepository.findSession(context.workspaceId, session.id) ?? session;
      if (latestSession.updatedAt !== session.updatedAt || !["in_progress", "diagnosis_ready", "followup"].includes(latestSession.status)) {
        throw new ApiError(
          409,
          "ONBOARDING_SESSION_CHANGED",
          "O onboarding mudou durante a geração. Gere o diagnóstico novamente."
        );
      }

      const updated = await repositories.onboardingRepository.updateSession({
        ...latestSession,
        status: "diagnosis_ready",
        currentStep: "diagnosis",
        diagnosis: result.output,
        followupQuestions: result.output.followupQuestions,
        followupAnswers: [],
        generatedSuggestion: null,
        reviewDecisions: [],
        activationPlan: [],
        createdSetupSummary: null,
        aiRunIds: Array.from(new Set([...latestSession.aiRunIds, result.run.id]))
      });

      return reply.status(201).send({ session: onboardingService.serialize(updated) });
    } finally {
      diagnosisLocks.delete(diagnosisLockKey);
    }
  });

  app.post("/onboarding/session/followup-answer", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();
    const body = followupAnswerSchema.parse(request.body);
    const session = await repositories.onboardingRepository.getCurrentSession(context.workspaceId);
    if (!session) {
      throw new ApiError(404, "ONBOARDING_SESSION_NOT_FOUND", "Onboarding não iniciado.");
    }
    if (!["diagnosis_ready", "followup"].includes(session.status) || !session.diagnosis) {
      throw new ApiError(
        409,
        "ONBOARDING_DIAGNOSIS_REQUIRED",
        "Gere o diagnóstico antes de responder perguntas de follow-up."
      );
    }

    const question = session.followupQuestions.find((item) => item.id === body.question_id);
    if (!question) {
      throw new ApiError(
        404,
        "ONBOARDING_FOLLOWUP_QUESTION_NOT_FOUND",
        "Pergunta de follow-up não encontrada."
      );
    }

    const updated = await repositories.onboardingRepository.updateSession({
      ...session,
      status: "followup",
      currentStep: "followup",
      followupAnswers: [
        ...session.followupAnswers.filter((answer) => answer.questionId !== body.question_id),
        {
          questionId: body.question_id,
          theme: "followup",
          question: question.question,
          answer: body.answer,
          inputMode: body.input_mode
        }
      ]
    });
    return { session: onboardingService.serialize(updated) };
  });

  app.post("/onboarding/session/generate-setup", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();
    const session = await repositories.onboardingRepository.getCurrentSession(context.workspaceId);
    if (!session) {
      throw new ApiError(404, "ONBOARDING_SESSION_NOT_FOUND", "Onboarding não iniciado.");
    }
    if (!["diagnosis_ready", "followup"].includes(session.status) || !session.diagnosis) {
      throw new ApiError(
        409,
        "ONBOARDING_DIAGNOSIS_REQUIRED",
        "Gere o diagnóstico antes de gerar a sugestão de setup."
      );
    }

    const setupGenerationLockKey = `${context.workspaceId}:${session.id}`;
    if (setupGenerationLocks.has(setupGenerationLockKey)) {
      throw new ApiError(409, "ONBOARDING_SETUP_IN_PROGRESS", "A sugestão de setup deste onboarding já está em geração.");
    }

    setupGenerationLocks.add(setupGenerationLockKey);
    try {
      const prompt = getPromptDefinition("agent/onboarding-architect", "1");
      const setupInputMode = [...session.mainAnswers, ...session.followupAnswers].some((answer) => answer.inputMode === "audio")
        ? "mixed"
        : "text";
      const result = await harness.runStructured({
        workspaceId: context.workspaceId,
        actorProfileId: context.profileId,
        source: "onboarding",
        inputMode: setupInputMode,
        taskKind: "onboarding_setup",
        agentKey: "onboarding_architect",
        promptKey: prompt.key,
        promptVersion: prompt.version,
        model: "gpt-5.5",
        reasoningEffort: "medium",
        input: {
          companyName: session.companyName,
          segment: session.segment,
          customSegment: session.customSegment,
          normalizedSegment: session.normalizedSegment ?? session.customSegment ?? session.segment,
          teamSizeRange: session.teamSizeRange,
          goals: session.goals,
          answers: session.mainAnswers,
          diagnosis: session.diagnosis,
          followupAnswers: session.followupAnswers,
          attachments: session.attachments
        },
        outputSchema: onboardingSetupSuggestionSchema,
        schemaName: "onboarding_setup_suggestion"
      });

      const latestSession = await repositories.onboardingRepository.findSession(context.workspaceId, session.id);
      if (
        !latestSession ||
        latestSession.updatedAt !== session.updatedAt ||
        !["diagnosis_ready", "followup"].includes(latestSession.status) ||
        !latestSession.diagnosis
      ) {
        throw new ApiError(
          409,
          "ONBOARDING_SESSION_CHANGED",
          "O onboarding mudou durante a geração. Gere a sugestão novamente."
        );
      }

      const updated = await repositories.onboardingRepository.updateSession({
        ...latestSession,
        status: "reviewing",
        currentStep: "review_map",
        generatedSuggestion: result.output,
        activationPlan: result.output.activationPlan,
        aiRunIds: Array.from(new Set([...latestSession.aiRunIds, result.run.id]))
      });
      return reply.status(201).send({ session: onboardingService.serialize(updated) });
    } finally {
      setupGenerationLocks.delete(setupGenerationLockKey);
    }
  });

  app.patch("/onboarding/session/review-decision", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();
    const body = reviewDecisionSchema.parse(request.body);
    const session = await repositories.onboardingRepository.getCurrentSession(context.workspaceId);
    if (!session) throw new ApiError(404, "ONBOARDING_SESSION_NOT_FOUND", "Onboarding não iniciado.");
    if (session.status !== "reviewing" || !session.generatedSuggestion) {
      throw new ApiError(409, "ONBOARDING_REVIEW_REQUIRED", "Gere a sugestão antes de revisar itens.");
    }
    validateReviewItem(session.generatedSuggestion, body.item_type, body.item_id);
    validateReviewAction(body.item_type, body.action);
    validateEditedPayload(body.item_type, body.edited_payload ?? null);

    const decision = {
      itemType: body.item_type,
      itemId: body.item_id,
      action: body.action,
      editedPayload: body.edited_payload ?? null
    };
    const updated = await repositories.onboardingRepository.updateSession({
      ...session,
      reviewDecisions: [
        ...session.reviewDecisions.filter((item) => !(item.itemType === decision.itemType && item.itemId === decision.itemId)),
        decision
      ]
    });
    return { session: onboardingService.serialize(updated) };
  });

  app.post("/onboarding/session/complete", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const session = await repositories.onboardingRepository.getCurrentSession(context.workspaceId);
    if (!session) throw new ApiError(404, "ONBOARDING_SESSION_NOT_FOUND", "Onboarding não iniciado.");

    const completionLockKey = `${context.workspaceId}:${session.id}`;
    if (completionLocks.has(completionLockKey)) {
      throw new ApiError(409, "ONBOARDING_COMPLETION_IN_PROGRESS", "A conclusão deste onboarding já está em andamento.");
    }

    completionLocks.add(completionLockKey);
    try {
      const completed = await onboardingService.completeSession(context.workspaceId, context.profileId, {
        companyRepository: repositories.companyRepository,
        processRepository: repositories.processRepository,
        routineRepository: repositories.routineRepository,
        trainingRepository: repositories.trainingRepository,
        announcementRepository: repositories.announcementRepository
      });
      return reply.status(201).send({ session: onboardingService.serialize(completed) });
    } finally {
      completionLocks.delete(completionLockKey);
    }
  });

  app.post("/onboarding/setup", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const body = setupSchema.parse(request.body);
    const createdAreas: Area[] = [];
    const createdRoles: RoleTemplate[] = [];
    const areaByName = new Map<string, Area>();
    const roleByName = new Map<string, RoleTemplate>();

    for (const areaInput of body.areas) {
      const area = await companyService.createArea(context.workspaceId, areaInput);
      createdAreas.push(area);
      areaByName.set(areaInput.name, area);
    }

    for (const roleInput of body.roles) {
      const area = readArea(areaByName, roleInput.area_name);
      const roleTemplate = await companyService.createRoleTemplate(context.workspaceId, {
        areaId: area.id,
        name: roleInput.name,
        description: roleInput.description
      });
      createdRoles.push(roleTemplate);
      roleByName.set(`${roleInput.area_name}:${roleInput.name}`, roleTemplate);
      roleByName.set(roleInput.name, roleTemplate);
    }

    const people = [];
    for (const personInput of body.people) {
      const area = personInput.area_name ? readArea(areaByName, personInput.area_name) : null;
      const roleTemplate = personInput.role_name
        ? readRole(roleByName, personInput.area_name, personInput.role_name)
        : null;

      people.push(await companyService.createTeamMember(context.workspaceId, {
        name: personInput.name,
        email: personInput.email,
        role: personInput.role,
        areaId: area?.id ?? null,
        roleTemplateId: roleTemplate?.id ?? null,
        createdByProfileId: context.profileId
      }));
    }

    const processes = [];
    for (const processInput of body.processes) {
      const area = processInput.area_name ? readArea(areaByName, processInput.area_name) : null;
      const processBody = processInput.body ?? formatProcessSopBody({
        objective: processInput.objective ?? "",
        trigger: processInput.trigger ?? "",
        operationalRule: processInput.operational_rule ?? null,
        steps: (processInput.steps ?? []).map((step) => ({
          title: step.title,
          instruction: step.instruction,
          expectedResult: step.expected_result,
          attentionPoints: step.attention_points
        }))
      });
      const draft = await processService.createProcess(context.workspaceId, context.profileId, {
        title: processInput.title,
        summary: processInput.summary,
        body: processBody,
        areaId: area?.id ?? null
      });
      processes.push(await processService.publishProcess(context.workspaceId, draft.id));
    }

    const routines = [];
    for (const routineInput of body.routines) {
      const area = routineInput.area_name ? readArea(areaByName, routineInput.area_name) : null;
      routines.push(await routineService.createRoutine(context.workspaceId, context.profileId, {
        title: routineInput.title,
        areaId: area?.id ?? null,
        taskTemplates: routineInput.task_titles.map((title) => ({
          title,
          approvalMode: "direct",
          evidencePolicy: "optional"
        }))
      }));
    }

    const trainings = [];
    for (const trainingInput of body.trainings) {
      const draft = await trainingService.createTraining(context.workspaceId, context.profileId, {
        title: trainingInput.title,
        description: trainingInput.description,
        materials: [{
          kind: "lesson",
          title: `Aula inicial - ${trainingInput.title}`,
          body: trainingInput.material_body
        }],
        quizQuestions: [{
          prompt: trainingInput.quiz_prompt,
          options: [
            { id: "a", label: "Seguir o processo publicado e registrar a execução." },
            { id: "b", label: "Executar de memória e avisar apenas se houver erro." }
          ],
          correctOptionId: "a",
          explanation: "O Baase transforma conhecimento em rotina rastreável."
        }]
      });
      trainings.push(await trainingService.publishTraining(context.workspaceId, draft.id));
    }

    const announcements: Announcement[] = [];
    if (body.announcement) {
      announcements.push(await announcementService.createAnnouncement(context.workspaceId, context.profileId, {
        title: body.announcement.title,
        body: body.announcement.body,
        type: "simple",
        requirement: "none",
        audience: { type: "all" }
      }));
    }

    return reply.status(201).send({
      setup: {
        segment: body.segment,
        areas: createdAreas,
        role_templates: createdRoles,
        people,
        processes,
        routines,
        trainings,
        announcements
      }
    });
  });
}

function validateReviewItem(
  suggestion: OnboardingSetupSuggestion,
  itemType: OnboardingReviewDecision["itemType"],
  itemId: string
) {
  const exists =
    itemType === "area" ? suggestion.areas.some((item) => item.id === itemId)
      : itemType === "role" ? suggestion.roles.some((item) => item.id === itemId)
        : itemType === "person" ? suggestion.people.some((item) => item.id === itemId)
          : itemType === "process" ? suggestion.processes.some((item) => item.id === itemId)
            : itemType === "routine" ? suggestion.routines.some((item) => item.id === itemId)
              : itemType === "training" ? suggestion.trainings.some((item) => item.id === itemId)
                : itemType === "announcement" ? suggestion.announcement?.id === itemId
                  : false;

  if (!exists) {
    throw new ApiError(404, "ONBOARDING_REVIEW_ITEM_NOT_FOUND", "Item de revisão não encontrado.");
  }
}

function validateReviewAction(
  itemType: OnboardingReviewDecision["itemType"],
  action: OnboardingReviewDecision["action"]
) {
  const allowedActions: Record<OnboardingReviewDecision["itemType"], OnboardingReviewDecision["action"][]> = {
    area: ["create", "remove"],
    role: ["create", "remove"],
    person: ["create", "remove"],
    process: ["draft", "publish", "remove"],
    training: ["draft", "publish", "remove"],
    announcement: ["draft", "publish", "remove"],
    routine: ["activate", "draft", "remove"],
    invite: []
  };

  if (!allowedActions[itemType].includes(action)) {
    throw new ApiError(400, "ONBOARDING_REVIEW_ACTION_INVALID", "Ação inválida para este item de revisão.");
  }
}

function validateEditedPayload(
  itemType: OnboardingReviewDecision["itemType"],
  payload: Record<string, unknown> | null
) {
  if (!payload) return;

  const schema =
    itemType === "area" ? areaReviewPayloadSchema
      : itemType === "role" ? roleReviewPayloadSchema
        : itemType === "person" ? personReviewPayloadSchema
          : itemType === "process" ? processReviewPayloadSchema
            : itemType === "routine" ? routineReviewPayloadSchema
              : itemType === "training" ? trainingReviewPayloadSchema
                : itemType === "announcement" ? announcementReviewPayloadSchema
                  : z.object({}).strict();

  if (!schema.safeParse(payload).success) {
    throw new ApiError(400, "ONBOARDING_REVIEW_EDIT_INVALID", "Edição inválida para este item de revisão.");
  }
}

function readArea(areaByName: Map<string, Area>, name: string) {
  const area = areaByName.get(name);
  if (!area) throw new Error("ONBOARDING_AREA_REFERENCE_NOT_FOUND");
  return area;
}

function readRole(roleByName: Map<string, RoleTemplate>, areaName: string | null | undefined, roleName: string) {
  const role = (areaName ? roleByName.get(`${areaName}:${roleName}`) : null) ?? roleByName.get(roleName);
  if (!role) throw new Error("ONBOARDING_ROLE_REFERENCE_NOT_FOUND");
  return role;
}
