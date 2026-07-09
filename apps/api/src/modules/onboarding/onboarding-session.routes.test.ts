import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryAiRepository } from "../ai/in-memory-ai.repository";
import type { AiProvider, AiStructuredProviderRequest } from "../ai/ai.types";
import { createMockAiProvider } from "../ai/providers/mock-ai.provider";
import { createInMemoryAnnouncementRepository } from "../announcements/in-memory-announcement.repository";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";
import type { CompanyRepository } from "../company/company.types";
import { createInMemoryProcessRepository } from "../processes/in-memory-process.repository";
import type { ProcessRepository } from "../processes/process.types";
import { createInMemoryRoutineRepository } from "../routines/in-memory-routine.repository";
import { createInMemoryTrainingRepository } from "../trainings/in-memory-training.repository";
import { createInMemoryOnboardingRepository } from "./in-memory-onboarding.repository";
import type { CreateOnboardingSessionInput } from "./onboarding.types";

const ownerHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-profile-id": "profile_owner",
  "x-baase-role": "owner"
};

const employeeHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-profile-id": "profile_employee",
  "x-baase-role": "employee"
};

function createSessionInput(overrides: Partial<CreateOnboardingSessionInput> = {}): CreateOnboardingSessionInput {
  return {
    workspaceId: "workspace_a",
    ownerProfileId: "profile_owner",
    status: "in_progress",
    currentStep: "identity",
    companyName: null,
    segment: null,
    customSegment: null,
    normalizedSegment: null,
    teamSizeRange: null,
    goals: [],
    mainAnswers: [],
    attachments: [],
    diagnosis: null,
    followupQuestions: [],
    followupAnswers: [],
    generatedSuggestion: null,
    reviewDecisions: [],
    activationPlan: [],
    createdSetupSummary: null,
    aiRunIds: [],
    ...overrides
  };
}

function createGeneratedSuggestion(): NonNullable<CreateOnboardingSessionInput["generatedSuggestion"]> {
  const metadata = {
    reason: "Base sugerida em teste.",
    basedOn: ["diagnostico"],
    expectedImpact: "Organizar a operacao.",
    source: "inferred" as const,
    reviewDefault: "draft" as const
  };

  return {
    companyName: "Estudio Norte",
    segment: "Agencia de marketing",
    confidence: "medium",
    assumptions: [],
    gaps: [],
    areas: [{ id: "area_ops", name: "Operacoes", description: "Entrega diaria.", metadata }],
    roles: [{
      id: "role_coord_ops",
      areaName: "Operacoes",
      name: "Coordenacao de operacoes",
      description: "Organiza a entrega e remove bloqueios.",
      metadata
    }],
    people: [{
      id: "person_resp_ops",
      name: "Responsavel por operacoes",
      email: null,
      role: "manager",
      areaName: "Operacoes",
      roleName: "Coordenacao de operacoes",
      placeholder: true,
      metadata
    }],
    processes: [{
      id: "process_entrega",
      title: "Entrega padrao",
      summary: "Padrao para executar entregas recorrentes.",
      body: "1. Conferir demanda.\n2. Executar checklist.\n3. Registrar evidencia.",
      areaName: "Operacoes",
      metadata
    }],
    routines: [{
      id: "routine_abertura",
      title: "Abertura do dia",
      areaName: "Operacoes",
      frequency: "daily",
      taskTitles: ["Conferir prioridades", "Registrar bloqueios"],
      metadata
    }],
    trainings: [{
      id: "training_evidencias",
      title: "Como registrar evidencias",
      description: "Treinamento inicial para padronizar registros.",
      materialBody: "Registre o que foi feito e sinalize bloqueios cedo.",
      quizPrompt: "O que deve ser registrado ao concluir uma tarefa?",
      metadata
    }],
    announcement: {
      id: "announcement_baase",
      title: "Nova organizacao operacional",
      body: "Vamos centralizar processos, rotinas e evidencias no Baase.",
      metadata
    },
    activationPlan: [
      { day: 1, title: "Revisar mapa", objective: "Confirmar a estrutura.", action: "open_company_map" },
      { day: 2, title: "Revisar processos", objective: "Ajustar processos.", action: "review_processes" },
      { day: 3, title: "Ativar rotina", objective: "Comecar execucao.", action: "activate_routine" },
      { day: 4, title: "Publicar treinamento", objective: "Alinhar equipe.", action: "publish_training" },
      { day: 5, title: "Convidar equipe", objective: "Trazer funcionarios.", action: "invite_team" },
      { day: 6, title: "Revisar hoje", objective: "Ver primeiras execucoes.", action: "review_today" },
      { day: 7, title: "Revisar painel", objective: "Ajustar gargalos.", action: "review_dashboard" }
    ]
  };
}

function releaseProvider(resolveProvider: (() => void) | null) {
  if (!resolveProvider) throw new Error("PROVIDER_NOT_STARTED");
  resolveProvider();
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("onboarding repository", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates and updates the current onboarding session for a workspace", async () => {
    const repository = createInMemoryOnboardingRepository();

    const created = await repository.createSession(createSessionInput());

    expect(created.id).toBe("onboarding_session_1");
    expect(created.status).toBe("in_progress");

    const updated = await repository.updateSession({
      ...created,
      companyName: "Estudio Norte",
      segment: "Outro",
      customSegment: "Agencia de conteudo",
      normalizedSegment: "Agencia de conteudo"
    });

    expect(updated.updatedAt).not.toBe(created.updatedAt);
    await expect(repository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      id: created.id,
      companyName: "Estudio Norte",
      normalizedSegment: "Agencia de conteudo"
    });
  });

  it("throws when updating a missing onboarding session", async () => {
    const repository = createInMemoryOnboardingRepository();
    const session = await repository.createSession(createSessionInput());

    await expect(repository.updateSession({ ...session, id: "onboarding_session_missing" })).rejects.toThrow(
      "ONBOARDING_SESSION_NOT_FOUND"
    );
  });

  it("returns the latest current session for a workspace when timestamps are equal or close", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:00:00.000Z"));
    const repository = createInMemoryOnboardingRepository();

    const first = await repository.createSession(createSessionInput({ companyName: "First" }));
    const second = await repository.createSession(createSessionInput({ companyName: "Second" }));

    await expect(repository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      id: second.id,
      companyName: "Second"
    });

    vi.setSystemTime(new Date("2026-07-08T12:00:00.001Z"));
    const updatedFirst = await repository.updateSession({
      ...first,
      companyName: "First Updated"
    });

    await expect(repository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      id: updatedFirst.id,
      companyName: "First Updated"
    });
  });

  it("does not allow returned sessions to mutate repository state directly", async () => {
    const repository = createInMemoryOnboardingRepository();
    const created = await repository.createSession(createSessionInput({ companyName: "Stored" }));

    created.companyName = "Mutated Outside";
    created.goals.push("mutated_goal");

    await expect(repository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      companyName: "Stored",
      goals: []
    });
  });

  it("advances updatedAt when system time regresses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:00:00.100Z"));
    const repository = createInMemoryOnboardingRepository();
    const created = await repository.createSession(createSessionInput());

    vi.setSystemTime(new Date("2026-07-08T12:00:00.000Z"));
    const updated = await repository.updateSession({
      ...created,
      companyName: "Regressed Clock"
    });

    expect(updated.updatedAt).toBe("2026-07-08T12:00:00.101Z");
  });

  it("atomically claims completion only once", async () => {
    const repository = createInMemoryOnboardingRepository();
    const created = await repository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));

    const firstClaim = await repository.claimCompletion("workspace_a", created.id);
    const secondClaim = await repository.claimCompletion("workspace_a", created.id);

    expect(firstClaim).toMatchObject({
      id: created.id,
      status: "completing",
      currentStep: "completing"
    });
    expect(secondClaim).toBeNull();
    await expect(repository.findSession("workspace_a", created.id)).resolves.toMatchObject({
      status: "completing",
      currentStep: "completing"
    });
  });

  it("rejects stale onboarding session updates after a completion claim", async () => {
    const repository = createInMemoryOnboardingRepository();
    const staleSession = await repository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));

    const claimed = await repository.claimCompletion("workspace_a", staleSession.id);
    await expect(repository.updateSession({
      ...staleSession,
      companyName: "Late patch"
    })).rejects.toThrow("ONBOARDING_SESSION_STALE");

    expect(claimed).toMatchObject({ status: "completing", currentStep: "completing" });
    await expect(repository.findSession("workspace_a", staleSession.id)).resolves.toMatchObject({
      status: "completing",
      currentStep: "completing",
      companyName: staleSession.companyName
    });
  });
});

describe("onboarding session routes", () => {
  it("creates, patches, reads, and skips an owner onboarding session", async () => {
    const app = buildApp();

    const created = await app.inject({
      method: "POST",
      url: "/onboarding/session",
      headers: ownerHeaders,
      payload: { current_step: "identity" }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().session).toMatchObject({
      status: "in_progress",
      currentStep: "identity",
      ownerProfileId: "profile_owner"
    });

    const patched = await app.inject({
      method: "PATCH",
      url: "/onboarding/session",
      headers: ownerHeaders,
      payload: {
        company_name: "Estudio Norte",
        segment: "Outro",
        custom_segment: "Agencia de conteudo",
        normalized_segment: "Agencia de conteudo",
        team_size_range: "6-15",
        goals: ["extract_owner_knowledge", "organize_team"]
      }
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().session).toMatchObject({
      companyName: "Estudio Norte",
      segment: "Outro",
      customSegment: "Agencia de conteudo",
      normalizedSegment: "Agencia de conteudo",
      teamSizeRange: "6-15",
      goals: ["extract_owner_knowledge", "organize_team"]
    });
    expect(patched.json().session).not.toHaveProperty("current_step");
    expect(patched.json().session).not.toHaveProperty("company_name");

    const current = await app.inject({
      method: "GET",
      url: "/onboarding/session",
      headers: ownerHeaders
    });

    expect(current.statusCode).toBe(200);
    expect(current.json().session.companyName).toBe("Estudio Norte");

    const skipped = await app.inject({
      method: "POST",
      url: "/onboarding/session/skip",
      headers: ownerHeaders
    });

    expect(skipped.statusCode).toBe(200);
    expect(skipped.json().session.status).toBe("skipped");
  });

  it("rejects patching a session while completion is in progress", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "completing",
      currentStep: "completing",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ onboardingRepository });

    const response = await app.inject({
      method: "PATCH",
      url: "/onboarding/session",
      headers: ownerHeaders,
      payload: { company_name: "Estudio Bloqueado" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ONBOARDING_COMPLETION_IN_PROGRESS");
  });

  it("rejects skipping a session while completion is in progress", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "completing",
      currentStep: "completing",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/skip",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ONBOARDING_COMPLETION_IN_PROGRESS");
  });

  it("rejects onboarding session creation for employees", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session",
      headers: employeeHeaders,
      payload: { current_step: "identity" }
    });

    expect(response.statusCode).toBe(403);
  });

  it("generates and stores an onboarding diagnosis", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const aiRepository = createInMemoryAiRepository();
    const companyRepository = createInMemoryCompanyRepository();
    const processRepository = createInMemoryProcessRepository();
    const routineRepository = createInMemoryRoutineRepository();
    const trainingRepository = createInMemoryTrainingRepository();
    const app = buildApp({
      aiRepository,
      companyRepository,
      onboardingRepository,
      processRepository,
      routineRepository,
      trainingRepository
    });

    await app.inject({
      method: "PATCH",
      url: "/onboarding/session",
      headers: ownerHeaders,
      payload: {
        company_name: "Estudio Norte",
        segment: "Agencia de marketing",
        normalized_segment: "Agencia de marketing",
        team_size_range: "6-15",
        goals: ["extract_owner_knowledge"],
        main_answers: [{
          question_id: "operations_overview",
          theme: "business_model",
          question: "O que vende?",
          answer: "Vendemos marketing recorrente para pequenos negocios.",
          input_mode: "text"
        }]
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().session.status).toBe("diagnosis_ready");
    expect(response.json().session.currentStep).toBe("diagnosis");
    expect(response.json().session.diagnosis.operationalSummary).toContain("operacao");
    expect(response.json().session.followupQuestions.length).toBeLessThanOrEqual(3);

    const persistedSession = await onboardingRepository.getCurrentSession("workspace_a");
    expect(persistedSession?.status).toBe("diagnosis_ready");
    expect(persistedSession?.currentStep).toBe("diagnosis");
    expect(persistedSession?.aiRunIds).toHaveLength(1);

    const runs = await aiRepository.listRuns("workspace_a");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: persistedSession?.aiRunIds[0],
      status: "completed",
      taskKind: "onboarding_diagnosis",
      inputMode: "text"
    });
    expect(await companyRepository.listAreas("workspace_a")).toEqual([]);
    expect(await companyRepository.listTeamMembers("workspace_a")).toEqual([]);
    expect(await processRepository.listProcesses("workspace_a")).toEqual([]);
    expect(await routineRepository.listRoutines("workspace_a")).toEqual([]);
    expect(await trainingRepository.listTrainings("workspace_a")).toEqual([]);
  });

  it("stores follow-up answers and generates the final onboarding setup suggestion", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const aiRepository = createInMemoryAiRepository();
    const companyRepository = createInMemoryCompanyRepository();
    const processRepository = createInMemoryProcessRepository();
    const routineRepository = createInMemoryRoutineRepository();
    const trainingRepository = createInMemoryTrainingRepository();
    const announcementRepository = createInMemoryAnnouncementRepository();
    const app = buildApp({
      aiProvider: createMockAiProvider(),
      aiRepository,
      announcementRepository,
      companyRepository,
      onboardingRepository,
      processRepository,
      routineRepository,
      trainingRepository
    });

    await app.inject({
      method: "PATCH",
      url: "/onboarding/session",
      headers: ownerHeaders,
      payload: {
        company_name: "Estudio Norte",
        segment: "Agencia de marketing",
        normalized_segment: "Agencia de marketing",
        team_size_range: "6-15",
        goals: ["organize_team"],
        main_answers: [{
          question_id: "operations_overview",
          theme: "business_model",
          question: "O que vende?",
          answer: "Marketing recorrente para pequenos negocios.",
          input_mode: "text"
        }]
      }
    });

    await app.inject({ method: "POST", url: "/onboarding/session/diagnosis", headers: ownerHeaders });

    const answered = await app.inject({
      method: "POST",
      url: "/onboarding/session/followup-answer",
      headers: ownerHeaders,
      payload: {
        question_id: "responsaveis_area",
        question: "Quem responde por cada area no dia a dia?",
        answer: "Marina cuida da operacao e Bruno da criacao.",
        input_mode: "audio"
      }
    });

    expect(answered.statusCode).toBe(200);
    expect(answered.json().session.followupAnswers).toHaveLength(1);

    const generated = await app.inject({
      method: "POST",
      url: "/onboarding/session/generate-setup",
      headers: ownerHeaders
    });

    expect(generated.statusCode).toBe(201);
    expect(generated.json().session.status).toBe("reviewing");
    expect(generated.json().session.currentStep).toBe("review_map");
    expect(generated.json().session.generatedSuggestion.companyName).toBe("Estudio Norte");
    expect(generated.json().session.generatedSuggestion.activationPlan).toHaveLength(7);
    expect(generated.json().session.generatedSuggestion.processes[0].metadata).toMatchObject({
      reviewDefault: "draft"
    });

    const persistedSession = await onboardingRepository.getCurrentSession("workspace_a");
    expect(persistedSession?.activationPlan).toHaveLength(7);
    expect(persistedSession?.aiRunIds).toHaveLength(2);

    await expect(aiRepository.listRuns("workspace_a")).resolves.toMatchObject([
      { taskKind: "onboarding_diagnosis" },
      { id: persistedSession?.aiRunIds[1], taskKind: "onboarding_setup", status: "completed", inputMode: "mixed" }
    ]);
    expect(await companyRepository.listAreas("workspace_a")).toEqual([]);
    expect(await companyRepository.listTeamMembers("workspace_a")).toEqual([]);
    expect(await processRepository.listProcesses("workspace_a")).toEqual([]);
    expect(await routineRepository.listRoutines("workspace_a")).toEqual([]);
    expect(await trainingRepository.listTrainings("workspace_a")).toEqual([]);
    expect(await announcementRepository.listAnnouncements("workspace_a")).toEqual([]);
  });

  it("replaces a follow-up answer by question id", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const app = buildApp({ aiProvider: createMockAiProvider(), onboardingRepository });

    await app.inject({
      method: "PATCH",
      url: "/onboarding/session",
      headers: ownerHeaders,
      payload: {
        company_name: "Estudio Norte",
        segment: "Agencia de marketing",
        normalized_segment: "Agencia de marketing",
        main_answers: [{
          question_id: "operations_overview",
          theme: "business_model",
          question: "O que vende?",
          answer: "Marketing recorrente para pequenos negocios.",
          input_mode: "text"
        }]
      }
    });
    await app.inject({ method: "POST", url: "/onboarding/session/diagnosis", headers: ownerHeaders });

    await app.inject({
      method: "POST",
      url: "/onboarding/session/followup-answer",
      headers: ownerHeaders,
      payload: {
        question_id: "responsaveis_area",
        question: "Quem responde por cada area no dia a dia?",
        answer: "Marina.",
        input_mode: "text"
      }
    });
    const replaced = await app.inject({
      method: "POST",
      url: "/onboarding/session/followup-answer",
      headers: ownerHeaders,
      payload: {
        question_id: "responsaveis_area",
        question: "Quem responde por cada area no dia a dia?",
        answer: "Marina cuida da operacao e Bruno da criacao.",
        input_mode: "text"
      }
    });

    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().session.followupAnswers).toEqual([
      expect.objectContaining({
        questionId: "responsaveis_area",
        answer: "Marina cuida da operacao e Bruno da criacao."
      })
    ]);
  });

  it("rejects unknown follow-up question ids without storing an answer", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "diagnosis_ready",
      currentStep: "diagnosis",
      diagnosis: {
        companyName: "Estudio Norte",
        normalizedSegment: "Agencia de marketing",
        confidence: "medium",
        operationalSummary: "Operacao com entrega recorrente.",
        businessModel: "Servicos recorrentes",
        customerProfile: "Pequenas empresas",
        deliveryModel: "Atendimento e entrega",
        detectedAreas: [],
        detectedPeople: [],
        bottlenecks: [],
        assumptions: [],
        followupQuestions: [
          { id: "responsaveis_area", question: "Quem responde por cada area no dia a dia?", reason: "Define responsaveis.", expectedUse: "people", priority: 1 }
        ]
      },
      followupQuestions: [
        { id: "responsaveis_area", question: "Quem responde por cada area no dia a dia?", reason: "Define responsaveis.", expectedUse: "people", priority: 1 }
      ]
    }));
    const app = buildApp({ onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/followup-answer",
      headers: ownerHeaders,
      payload: {
        question_id: "question_invented_by_client",
        question: "Pergunta inventada pelo cliente",
        answer: "Resposta que nao deve ser salva.",
        input_mode: "text"
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("ONBOARDING_FOLLOWUP_QUESTION_NOT_FOUND");
    await expect(onboardingRepository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      status: "diagnosis_ready",
      followupAnswers: []
    });
  });

  it("rejects setup generation before diagnosis exists", async () => {
    const aiRepository = createInMemoryAiRepository();
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "text"
      }]
    }));
    const app = buildApp({ aiRepository, onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/generate-setup",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ONBOARDING_DIAGNOSIS_REQUIRED");
    await expect(aiRepository.listRuns("workspace_a")).resolves.toEqual([]);
  });

  it("does not overwrite a session skipped while setup generation is running", async () => {
    let resolveProvider: (() => void) | null = null;
    const mockProvider = createMockAiProvider();
    const aiProvider: AiProvider = {
      async generateStructured(request) {
        await new Promise<void>((resolve) => {
          resolveProvider = resolve;
        });
        return mockProvider.generateStructured(request);
      },
      async transcribeAudio(request) {
        return mockProvider.transcribeAudio(request);
      }
    };
    const aiRepository = createInMemoryAiRepository();
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "diagnosis_ready",
      currentStep: "diagnosis",
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "text"
      }],
      diagnosis: {
        companyName: "Estudio Norte",
        normalizedSegment: "Agencia de marketing",
        confidence: "medium",
        operationalSummary: "Operacao com entrega recorrente.",
        businessModel: "Servicos recorrentes",
        customerProfile: "Pequenas empresas",
        deliveryModel: "Atendimento e entrega",
        detectedAreas: [],
        detectedPeople: [],
        bottlenecks: [],
        assumptions: [],
        followupQuestions: []
      }
    }));
    const app = buildApp({ aiProvider, aiRepository, onboardingRepository });

    const setupPromise = app.inject({
      method: "POST",
      url: "/onboarding/session/generate-setup",
      headers: ownerHeaders
    });
    await vi.waitFor(() => {
      expect(resolveProvider).toBeTypeOf("function");
    });

    const skipped = await app.inject({
      method: "POST",
      url: "/onboarding/session/skip",
      headers: ownerHeaders
    });
    releaseProvider(resolveProvider);
    const setup = await setupPromise;

    expect(skipped.statusCode).toBe(200);
    expect(setup.statusCode).toBe(409);
    expect(setup.json().error.code).toBe("ONBOARDING_SESSION_CHANGED");
    await expect(onboardingRepository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      status: "skipped",
      generatedSuggestion: null,
      activationPlan: []
    });
    await expect(aiRepository.listRuns("workspace_a")).resolves.toMatchObject([
      { status: "completed", taskKind: "onboarding_setup" }
    ]);
  });

  it("does not overwrite a follow-up answer saved while setup generation is running", async () => {
    let resolveProvider: (() => void) | null = null;
    const mockProvider = createMockAiProvider();
    const aiProvider: AiProvider = {
      async generateStructured(request) {
        await new Promise<void>((resolve) => {
          resolveProvider = resolve;
        });
        return mockProvider.generateStructured(request);
      },
      async transcribeAudio(request) {
        return mockProvider.transcribeAudio(request);
      }
    };
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "diagnosis_ready",
      currentStep: "diagnosis",
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "text"
      }],
      diagnosis: {
        companyName: "Estudio Norte",
        normalizedSegment: "Agencia de marketing",
        confidence: "medium",
        operationalSummary: "Operacao com entrega recorrente.",
        businessModel: "Servicos recorrentes",
        customerProfile: "Pequenas empresas",
        deliveryModel: "Atendimento e entrega",
        detectedAreas: [],
        detectedPeople: [],
        bottlenecks: [],
        assumptions: [],
        followupQuestions: [
          { id: "responsaveis_area", question: "Quem responde por cada area no dia a dia?", reason: "Define responsaveis.", expectedUse: "people", priority: 1 }
        ]
      },
      followupQuestions: [
        { id: "responsaveis_area", question: "Quem responde por cada area no dia a dia?", reason: "Define responsaveis.", expectedUse: "people", priority: 1 }
      ]
    }));
    const app = buildApp({ aiProvider, onboardingRepository });

    const setupPromise = app.inject({
      method: "POST",
      url: "/onboarding/session/generate-setup",
      headers: ownerHeaders
    });
    await vi.waitFor(() => {
      expect(resolveProvider).toBeTypeOf("function");
    });

    const answered = await app.inject({
      method: "POST",
      url: "/onboarding/session/followup-answer",
      headers: ownerHeaders,
      payload: {
        question_id: "responsaveis_area",
        question: "Texto adulterado pelo cliente.",
        answer: "Marina cuida da operacao.",
        input_mode: "text"
      }
    });
    releaseProvider(resolveProvider);
    const setup = await setupPromise;

    expect(answered.statusCode).toBe(200);
    expect(setup.statusCode).toBe(409);
    expect(setup.json().error.code).toBe("ONBOARDING_SESSION_CHANGED");
    await expect(onboardingRepository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      status: "followup",
      generatedSuggestion: null,
      followupAnswers: [{
        questionId: "responsaveis_area",
        question: "Quem responde por cada area no dia a dia?",
        answer: "Marina cuida da operacao."
      }]
    });
  });

  it("rejects follow-up answers before diagnosis exists", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "text"
      }]
    }));
    const app = buildApp({ onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/followup-answer",
      headers: ownerHeaders,
      payload: {
        question_id: "responsaveis_area",
        question: "Quem responde por cada area no dia a dia?",
        answer: "Marina.",
        input_mode: "text"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ONBOARDING_DIAGNOSIS_REQUIRED");
  });

  it("persists mixed input mode for audio-derived onboarding diagnosis answers", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const aiRepository = createInMemoryAiRepository();
    await onboardingRepository.createSession(createSessionInput({
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "audio"
      }]
    }));
    const app = buildApp({ aiRepository, onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(201);
    await expect(aiRepository.listRuns("workspace_a")).resolves.toMatchObject([
      { inputMode: "mixed" }
    ]);
  });

  it("rejects onboarding diagnosis for employees", async () => {
    const aiRepository = createInMemoryAiRepository();
    const app = buildApp({ aiRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: employeeHeaders
    });

    expect(response.statusCode).toBe(403);
    await expect(aiRepository.listRuns("workspace_a")).resolves.toEqual([]);
  });

  it("rejects onboarding diagnosis when no session exists", async () => {
    const aiRepository = createInMemoryAiRepository();
    const onboardingRepository = createInMemoryOnboardingRepository();
    const app = buildApp({ aiRepository, onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("ONBOARDING_SESSION_NOT_FOUND");
    await expect(onboardingRepository.getCurrentSession("workspace_a")).resolves.toBeNull();
    await expect(aiRepository.listRuns("workspace_a")).resolves.toEqual([]);
  });

  it("rejects onboarding diagnosis for a skipped session", async () => {
    const aiRepository = createInMemoryAiRepository();
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "skipped",
      currentStep: "skipped",
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "text"
      }]
    }));
    const app = buildApp({ aiRepository, onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ONBOARDING_SESSION_CLOSED");
    await expect(aiRepository.listRuns("workspace_a")).resolves.toEqual([]);
  });

  it("rejects onboarding diagnosis for a completed session", async () => {
    const aiRepository = createInMemoryAiRepository();
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "completed",
      currentStep: "completed",
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "text"
      }]
    }));
    const app = buildApp({ aiRepository, onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ONBOARDING_SESSION_CLOSED");
    await expect(aiRepository.listRuns("workspace_a")).resolves.toEqual([]);
  });

  it("rejects onboarding diagnosis after setup generation has started", async () => {
    const aiRepository = createInMemoryAiRepository();
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "text"
      }],
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ aiRepository, onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ONBOARDING_SESSION_CLOSED");
    await expect(aiRepository.listRuns("workspace_a")).resolves.toEqual([]);
    await expect(onboardingRepository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      status: "reviewing",
      generatedSuggestion: expect.any(Object)
    });
  });

  it("rejects onboarding diagnosis when required signal is incomplete", async () => {
    const aiRepository = createInMemoryAiRepository();
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing"
    }));
    const app = buildApp({ aiRepository, onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ONBOARDING_DIAGNOSIS_INPUT_INCOMPLETE");
    await expect(aiRepository.listRuns("workspace_a")).resolves.toEqual([]);
  });

  it("clears downstream review data when regenerating an allowed diagnosis", async () => {
    const aiRepository = createInMemoryAiRepository();
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "followup",
      currentStep: "followup",
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "text"
      }],
      followupAnswers: [{
        questionId: "responsaveis_area",
        theme: "followup",
        question: "Quem responde por cada area?",
        answer: "Marina.",
        inputMode: "text"
      }],
      generatedSuggestion: createGeneratedSuggestion(),
      reviewDecisions: [{
        itemType: "process",
        itemId: "process_1",
        action: "draft",
        editedPayload: null
      }],
      activationPlan: createGeneratedSuggestion().activationPlan,
      createdSetupSummary: {
        areas: 1,
        roles: 0,
        people: 0,
        placeholders: 0,
        processes: 0,
        routines: 0,
        trainings: 0,
        announcements: 0,
        invites: 0
      },
      aiRunIds: ["ai_run_existing"]
    }));
    const app = buildApp({ aiRepository, onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().session).toMatchObject({
      status: "diagnosis_ready",
      currentStep: "diagnosis",
      followupAnswers: [],
      generatedSuggestion: null,
      reviewDecisions: [],
      activationPlan: [],
      createdSetupSummary: null,
      aiRunIds: ["ai_run_existing", "ai_run_1"]
    });
  });

  it("does not overwrite a session skipped while onboarding diagnosis is running", async () => {
    let resolveProvider: (() => void) | null = null;
    const mockProvider = createMockAiProvider();
    const aiProvider: AiProvider = {
      async generateStructured(request) {
        await new Promise<void>((resolve) => {
          resolveProvider = resolve;
        });
        return mockProvider.generateStructured(request);
      },
      async transcribeAudio(request) {
        return mockProvider.transcribeAudio(request);
      }
    };
    const aiRepository = createInMemoryAiRepository();
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "text"
      }]
    }));
    const app = buildApp({ aiProvider, aiRepository, onboardingRepository });

    const diagnosisPromise = app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: ownerHeaders
    });
    await vi.waitFor(() => {
      expect(resolveProvider).toBeTypeOf("function");
    });

    const skipped = await app.inject({
      method: "POST",
      url: "/onboarding/session/skip",
      headers: ownerHeaders
    });
    releaseProvider(resolveProvider);
    const diagnosis = await diagnosisPromise;

    expect(skipped.statusCode).toBe(200);
    expect(diagnosis.statusCode).toBe(409);
    expect(diagnosis.json().error.code).toBe("ONBOARDING_SESSION_CHANGED");
    await expect(onboardingRepository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      status: "skipped",
      diagnosis: null
    });
    await expect(aiRepository.listRuns("workspace_a")).resolves.toMatchObject([
      { status: "completed", taskKind: "onboarding_diagnosis" }
    ]);
  });

  it("does not persist a diagnosis when onboarding answers change during generation", async () => {
    let resolveProvider: (() => void) | null = null;
    const mockProvider = createMockAiProvider();
    const aiProvider: AiProvider = {
      async generateStructured(request) {
        await new Promise<void>((resolve) => {
          resolveProvider = resolve;
        });
        return mockProvider.generateStructured(request);
      },
      async transcribeAudio(request) {
        return mockProvider.transcribeAudio(request);
      }
    };
    const aiRepository = createInMemoryAiRepository();
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "text"
      }]
    }));
    const app = buildApp({ aiProvider, aiRepository, onboardingRepository });

    const diagnosisPromise = app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: ownerHeaders
    });
    await vi.waitFor(() => {
      expect(resolveProvider).toBeTypeOf("function");
    });

    const patched = await app.inject({
      method: "PATCH",
      url: "/onboarding/session",
      headers: ownerHeaders,
      payload: {
        main_answers: [{
          question_id: "operations_overview",
          theme: "business_model",
          question: "O que vende?",
          answer: "Resposta alterada durante a geracao.",
          input_mode: "text"
        }]
      }
    });
    releaseProvider(resolveProvider);
    const diagnosis = await diagnosisPromise;

    expect(patched.statusCode).toBe(200);
    expect(diagnosis.statusCode).toBe(409);
    expect(diagnosis.json().error.code).toBe("ONBOARDING_SESSION_CHANGED");
    await expect(onboardingRepository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      status: "in_progress",
      diagnosis: null,
      mainAnswers: [{ answer: "Resposta alterada durante a geracao." }]
    });
  });

  it("sends the stored session owner profile id to the onboarding diagnosis provider", async () => {
    const providerRequests: AiStructuredProviderRequest[] = [];
    const mockProvider = createMockAiProvider();
    const aiProvider: AiProvider = {
      async generateStructured(request) {
        providerRequests.push(request);
        return mockProvider.generateStructured(request);
      },
      async transcribeAudio(request) {
        return mockProvider.transcribeAudio(request);
      }
    };
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      ownerProfileId: "profile_session_owner",
      companyName: "Estudio Norte",
      segment: "Agencia de marketing",
      normalizedSegment: "Agencia de marketing",
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        inputMode: "text"
      }]
    }));
    const app = buildApp({ aiProvider, onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/diagnosis",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(201);
    expect(providerRequests[0]?.input).toMatchObject({
      context: {
        workspaceId: "workspace_a",
        ownerProfileId: "profile_session_owner"
      }
    });
  });

  it("completes onboarding by creating base records and keeping content as drafts", async () => {
    const app = buildApp({ aiProvider: createMockAiProvider() });

    await app.inject({
      method: "PATCH",
      url: "/onboarding/session",
      headers: ownerHeaders,
      payload: {
        company_name: "Estudio Norte",
        segment: "Agencia de marketing",
        normalized_segment: "Agencia de marketing",
        team_size_range: "6-15",
        goals: ["organize_team"],
        main_answers: [{
          question_id: "operations_overview",
          theme: "business_model",
          question: "O que vende?",
          answer: "Marketing recorrente para pequenos negocios.",
          input_mode: "text"
        }]
      }
    });
    await app.inject({ method: "POST", url: "/onboarding/session/diagnosis", headers: ownerHeaders });
    await app.inject({ method: "POST", url: "/onboarding/session/generate-setup", headers: ownerHeaders });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().session.status).toBe("completed");
    expect(response.json().session.createdSetupSummary).toMatchObject({
      areas: expect.any(Number),
      roles: expect.any(Number),
      processes: expect.any(Number),
      routines: expect.any(Number),
      trainings: expect.any(Number)
    });

    const [areas, people, processes, routines, trainings, announcements, today] = await Promise.all([
      app.inject({ method: "GET", url: "/areas", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/people", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/processes", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/routines", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/trainings", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/announcements", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/today?date=2026-07-07", headers: ownerHeaders })
    ]);

    expect(areas.json().areas.length).toBeGreaterThan(0);
    expect(people.json().people.some((person: { status: string }) => person.status === "placeholder")).toBe(true);
    expect(processes.json().processes[0].status).toBe("draft");
    expect(routines.json().routines[0].status).toBe("archived");
    expect(trainings.json().trainings[0].status).toBe("draft");
    expect(announcements.json().announcements[0].status).toBe("draft");
    expect(today.json().tasks).toEqual([]);
  });

  it("applies publish and activate review decisions during completion", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ onboardingRepository });

    await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: { item_type: "process", item_id: "process_entrega", action: "publish" }
    });
    await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: { item_type: "routine", item_id: "routine_abertura", action: "activate" }
    });
    await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: { item_type: "training", item_id: "training_evidencias", action: "publish" }
    });
    await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: { item_type: "announcement", item_id: "announcement_baase", action: "publish" }
    });

    const completed = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });
    const [processes, routines, trainings, announcements] = await Promise.all([
      app.inject({ method: "GET", url: "/processes", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/routines", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/trainings", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/announcements", headers: ownerHeaders })
    ]);

    expect(completed.statusCode).toBe(201);
    expect(processes.json().processes[0].status).toBe("published");
    expect(routines.json().routines[0].status).toBe("active");
    expect(trainings.json().trainings[0].status).toBe("published");
    expect(announcements.json().announcements[0].status).toBe("published");
  });

  it("skips removed review items and reflects them in the setup summary", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ onboardingRepository });

    await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: { item_type: "process", item_id: "process_entrega", action: "remove" }
    });
    const completed = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });
    const processes = await app.inject({ method: "GET", url: "/processes", headers: ownerHeaders });

    expect(completed.statusCode).toBe(201);
    expect(completed.json().session.createdSetupSummary.processes).toBe(0);
    expect(processes.json().processes).toEqual([]);
  });

  it("rejects review decisions for unknown suggestion items", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ onboardingRepository });

    const response = await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: { item_type: "process", item_id: "process_missing", action: "publish" }
    });
    const session = await onboardingRepository.getCurrentSession("workspace_a");

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("ONBOARDING_REVIEW_ITEM_NOT_FOUND");
    expect(session?.reviewDecisions).toEqual([]);
  });

  it("rejects review actions that are invalid for the item type", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ onboardingRepository });

    const response = await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: { item_type: "process", item_id: "process_entrega", action: "activate" }
    });
    const session = await onboardingRepository.getCurrentSession("workspace_a");

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ONBOARDING_REVIEW_ACTION_INVALID");
    expect(session?.reviewDecisions).toEqual([]);
  });

  it("rejects invalid edited payloads before storing the review decision", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ onboardingRepository });

    const response = await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: {
        item_type: "process",
        item_id: "process_entrega",
        action: "draft",
        edited_payload: { title: "   " }
      }
    });
    const session = await onboardingRepository.getCurrentSession("workspace_a");

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ONBOARDING_REVIEW_EDIT_INVALID");
    expect(session?.reviewDecisions).toEqual([]);
  });

  it.each([
    {
      name: "unknown fields",
      payload: {
        item_type: "process",
        item_id: "process_entrega",
        action: "draft",
        edited_payload: { title: "Entrega revisada", unexpected: "surprise" }
      }
    },
    {
      name: "invalid emails",
      payload: {
        item_type: "person",
        item_id: "person_resp_ops",
        action: "create",
        edited_payload: { email: "ana-at-example" }
      }
    },
    {
      name: "excessive field limits",
      payload: {
        item_type: "area",
        item_id: "area_ops",
        action: "create",
        edited_payload: { name: "A".repeat(81) }
      }
    }
  ])("rejects edited payloads with $name", async ({ payload }) => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ onboardingRepository });

    const response = await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload
    });
    const session = await onboardingRepository.getCurrentSession("workspace_a");

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ONBOARDING_REVIEW_EDIT_INVALID");
    expect(session?.reviewDecisions).toEqual([]);
  });

  it("applies valid edited payloads during completion", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ onboardingRepository });

    await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: {
        item_type: "process",
        item_id: "process_entrega",
        action: "draft",
        edited_payload: { title: "Entrega revisada" }
      }
    });
    await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: {
        item_type: "person",
        item_id: "person_resp_ops",
        action: "create",
        edited_payload: { name: "Ana Operacoes", role: "employee" }
      }
    });

    const completed = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });
    const [processes, people] = await Promise.all([
      app.inject({ method: "GET", url: "/processes", headers: ownerHeaders }),
      app.inject({ method: "GET", url: "/people", headers: ownerHeaders })
    ]);

    expect(completed.statusCode).toBe(201);
    expect(processes.json().processes[0]).toMatchObject({ title: "Entrega revisada" });
    expect(people.json().people[0]).toMatchObject({ name: "Ana Operacoes", role: "employee" });
  });

  it("rejects invalid edited references before creating any setup records", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const companyRepository = createInMemoryCompanyRepository();
    const processRepository = createInMemoryProcessRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ companyRepository, onboardingRepository, processRepository });

    await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: {
        item_type: "process",
        item_id: "process_entrega",
        action: "draft",
        edited_payload: { areaName: "Operacaozz" }
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ONBOARDING_REVIEW_REFERENCE_INVALID");
    await expect(companyRepository.listAreas("workspace_a")).resolves.toEqual([]);
    await expect(processRepository.listProcesses("workspace_a")).resolves.toEqual([]);
  });

  it("rejects duplicate active area names after edits before creating any setup records", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const companyRepository = createInMemoryCompanyRepository();
    const suggestion = createGeneratedSuggestion();
    suggestion.areas.push({
      id: "area_customer_success",
      name: "Customer Success",
      description: "Atendimento ao cliente.",
      metadata: suggestion.areas[0]!.metadata
    });
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: suggestion
    }));
    const app = buildApp({ companyRepository, onboardingRepository });

    await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: {
        item_type: "area",
        item_id: "area_customer_success",
        action: "create",
        edited_payload: { name: "Operacoes" }
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ONBOARDING_REVIEW_REFERENCE_INVALID");
    await expect(companyRepository.listAreas("workspace_a")).resolves.toEqual([]);
  });

  it("rejects duplicate active area names that only differ by surrounding spaces before creating any setup records", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const companyRepository = createInMemoryCompanyRepository();
    const suggestion = createGeneratedSuggestion();
    suggestion.areas.push({
      id: "area_ops_spaced",
      name: " Operacoes ",
      description: "Mesma area com espacos.",
      metadata: suggestion.areas[0]!.metadata
    });
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: suggestion
    }));
    const app = buildApp({ companyRepository, onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ONBOARDING_REVIEW_REFERENCE_INVALID");
    await expect(companyRepository.listAreas("workspace_a")).resolves.toEqual([]);
  });

  it("rejects duplicate active role names in the same area after edits before creating any setup records", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const companyRepository = createInMemoryCompanyRepository();
    const suggestion = createGeneratedSuggestion();
    suggestion.roles.push({
      id: "role_support_ops",
      areaName: "Operacoes",
      name: "Suporte de operacoes",
      description: "Apoia a entrega.",
      metadata: suggestion.roles[0]!.metadata
    });
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: suggestion
    }));
    const app = buildApp({ companyRepository, onboardingRepository });

    await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: ownerHeaders,
      payload: {
        item_type: "role",
        item_id: "role_support_ops",
        action: "create",
        edited_payload: { name: "Coordenacao de operacoes" }
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ONBOARDING_REVIEW_REFERENCE_INVALID");
    await expect(companyRepository.listAreas("workspace_a")).resolves.toEqual([]);
    await expect(companyRepository.listRoleTemplates("workspace_a")).resolves.toEqual([]);
  });

  it("rejects duplicate active role names in the same area that only differ by surrounding spaces before creating any setup records", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const companyRepository = createInMemoryCompanyRepository();
    const suggestion = createGeneratedSuggestion();
    suggestion.roles.push({
      id: "role_coord_ops_spaced",
      areaName: " Operacoes ",
      name: " Coordenacao de operacoes ",
      description: "Mesmo cargo com espacos.",
      metadata: suggestion.roles[0]!.metadata
    });
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: suggestion
    }));
    const app = buildApp({ companyRepository, onboardingRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ONBOARDING_REVIEW_REFERENCE_INVALID");
    await expect(companyRepository.listAreas("workspace_a")).resolves.toEqual([]);
    await expect(companyRepository.listRoleTemplates("workspace_a")).resolves.toEqual([]);
  });

  it("rolls back records created by a failed completion and allows a retry without duplicates", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const companyRepository = createInMemoryCompanyRepository();
    const baseProcessRepository = createInMemoryProcessRepository();
    let failProcessCreation = true;
    const processRepository: ProcessRepository = {
      ...baseProcessRepository,
      async createProcess(input) {
        if (failProcessCreation) throw new Error("PROCESS_CREATE_FAILED");
        return baseProcessRepository.createProcess(input);
      }
    };
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ companyRepository, onboardingRepository, processRepository });

    const failed = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });
    const failedSession = await onboardingRepository.getCurrentSession("workspace_a");

    expect(failed.statusCode).toBe(500);
    expect(failedSession).toMatchObject({ status: "reviewing", currentStep: "review_map" });
    await expect(companyRepository.listAreas("workspace_a")).resolves.toEqual([]);
    await expect(companyRepository.listRoleTemplates("workspace_a")).resolves.toEqual([]);
    await expect(companyRepository.listTeamMembers("workspace_a")).resolves.toEqual([]);

    failProcessCreation = false;
    const retried = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });

    expect(retried.statusCode).toBe(201);
    await expect(companyRepository.listAreas("workspace_a")).resolves.toHaveLength(1);
    await expect(companyRepository.listRoleTemplates("workspace_a")).resolves.toHaveLength(1);
    await expect(companyRepository.listTeamMembers("workspace_a")).resolves.toHaveLength(1);
    await expect(processRepository.listProcesses("workspace_a")).resolves.toHaveLength(1);
  });

  it("marks completion as failed when rollback cannot remove created records and rejects future retries safely", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const baseCompanyRepository = createInMemoryCompanyRepository();
    const companyRepository: CompanyRepository = {
      ...baseCompanyRepository,
      async deleteTeamMember() {
        throw new Error("ROLLBACK_TEAM_MEMBER_FAILED");
      }
    };
    const baseProcessRepository = createInMemoryProcessRepository();
    const processRepository: ProcessRepository = {
      ...baseProcessRepository,
      async createProcess() {
        throw new Error("PROCESS_CREATE_FAILED");
      }
    };
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ companyRepository, onboardingRepository, processRepository });

    const failed = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });
    const failedSession = await onboardingRepository.getCurrentSession("workspace_a");
    const retried = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });

    expect(failed.statusCode).toBe(500);
    expect(failedSession).toMatchObject({ status: "completion_failed", currentStep: "completion_failed" });
    expect(retried.statusCode).toBe(409);
    expect(retried.json().error.code).toBe("ONBOARDING_COMPLETION_FAILED");
  });

  it("rejects concurrent completion for the same onboarding session", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const baseCompanyRepository = createInMemoryCompanyRepository();
    const gate = createDeferred();
    const areaStarted = createDeferred();
    const companyRepository: CompanyRepository = {
      ...baseCompanyRepository,
      async createArea(input) {
        areaStarted.resolve();
        await gate.promise;
        return baseCompanyRepository.createArea(input);
      }
    };
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ companyRepository, onboardingRepository });

    const first = app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });
    await areaStarted.promise;
    const second = app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });
    setTimeout(() => gate.resolve(), 10);
    const completed = await first;
    const duplicate = await second;

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("ONBOARDING_COMPLETION_IN_PROGRESS");
    expect(completed.statusCode).toBe(201);
    await expect(companyRepository.listAreas("workspace_a")).resolves.toHaveLength(1);
  });

  it("rejects concurrent completion across app instances sharing the same onboarding repository", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const baseCompanyRepository = createInMemoryCompanyRepository();
    const processRepository = createInMemoryProcessRepository();
    const routineRepository = createInMemoryRoutineRepository();
    const trainingRepository = createInMemoryTrainingRepository();
    const announcementRepository = createInMemoryAnnouncementRepository();
    const gate = createDeferred();
    const areaStarted = createDeferred();
    let createAreaCalls = 0;
    const companyRepository: CompanyRepository = {
      ...baseCompanyRepository,
      async createArea(input) {
        createAreaCalls += 1;
        areaStarted.resolve();
        await gate.promise;
        return baseCompanyRepository.createArea(input);
      }
    };
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const firstApp = buildApp({
      companyRepository,
      processRepository,
      routineRepository,
      trainingRepository,
      announcementRepository,
      onboardingRepository
    });
    const secondApp = buildApp({
      companyRepository,
      processRepository,
      routineRepository,
      trainingRepository,
      announcementRepository,
      onboardingRepository
    });

    const first = firstApp.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });
    await areaStarted.promise;
    const secondRequest = secondApp.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    gate.resolve();
    const [completed, second] = await Promise.all([first, secondRequest]);

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("ONBOARDING_COMPLETION_IN_PROGRESS");
    expect(completed.statusCode).toBe(201);
    expect(createAreaCalls).toBe(1);
    await expect(companyRepository.listAreas("workspace_a")).resolves.toHaveLength(1);
  });

  it("rejects a second completion after onboarding is completed without duplicating records", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ onboardingRepository });

    const first = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });
    const beforeSecondCompletion = await readSetupCounts(app);
    const second = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });
    const afterSecondCompletion = await readSetupCounts(app);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("ONBOARDING_REVIEW_REQUIRED");
    expect(afterSecondCompletion).toEqual(beforeSecondCompletion);
  });

  it("rejects completion before setup review and creates nothing", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    const companyRepository = createInMemoryCompanyRepository();
    const processRepository = createInMemoryProcessRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "diagnosis_ready",
      currentStep: "diagnosis"
    }));
    const app = buildApp({ companyRepository, onboardingRepository, processRepository });

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ONBOARDING_REVIEW_REQUIRED");
    await expect(companyRepository.listAreas("workspace_a")).resolves.toEqual([]);
    await expect(processRepository.listProcesses("workspace_a")).resolves.toEqual([]);
  });

  it("rejects employee review decisions and completion", async () => {
    const onboardingRepository = createInMemoryOnboardingRepository();
    await onboardingRepository.createSession(createSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createGeneratedSuggestion()
    }));
    const app = buildApp({ onboardingRepository });

    const decision = await app.inject({
      method: "PATCH",
      url: "/onboarding/session/review-decision",
      headers: employeeHeaders,
      payload: { item_type: "process", item_id: "process_entrega", action: "publish" }
    });
    const complete = await app.inject({
      method: "POST",
      url: "/onboarding/session/complete",
      headers: employeeHeaders
    });

    expect(decision.statusCode).toBe(403);
    expect(complete.statusCode).toBe(403);
  });
});

async function readSetupCounts(app: Awaited<ReturnType<typeof buildApp>>) {
  const [areas, people, processes, routines, trainings, announcements] = await Promise.all([
    app.inject({ method: "GET", url: "/areas", headers: ownerHeaders }),
    app.inject({ method: "GET", url: "/people", headers: ownerHeaders }),
    app.inject({ method: "GET", url: "/processes", headers: ownerHeaders }),
    app.inject({ method: "GET", url: "/routines", headers: ownerHeaders }),
    app.inject({ method: "GET", url: "/trainings", headers: ownerHeaders }),
    app.inject({ method: "GET", url: "/announcements", headers: ownerHeaders })
  ]);

  return {
    areas: areas.json().areas.length,
    people: people.json().people.length,
    processes: processes.json().processes.length,
    routines: routines.json().routines.length,
    trainings: trainings.json().trainings.length,
    announcements: announcements.json().announcements.length
  };
}
