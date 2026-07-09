import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const onboardingSuggestionMetadata = {
  reason: "Sugerido a partir do onboarding.",
  basedOn: ["respostas do onboarding"],
  expectedImpact: "Dar clareza para a operação.",
  source: "inferred",
  reviewDefault: "draft"
};

const onboardingActivationPlan = [
  { day: 1, title: "Revisar mapa", objective: "Confirmar áreas.", action: "open_company_map" },
  { day: 2, title: "Revisar processos", objective: "Ajustar processos.", action: "review_processes" },
  { day: 3, title: "Ativar rotina", objective: "Começar execução.", action: "activate_routine" },
  { day: 4, title: "Publicar treinamento", objective: "Alinhar equipe.", action: "publish_training" },
  { day: 5, title: "Convidar equipe", objective: "Trazer funcionários.", action: "invite_team" },
  { day: 6, title: "Revisar hoje", objective: "Ver primeiras execuções.", action: "review_today" },
  { day: 7, title: "Revisar painel", objective: "Ajustar gargalos.", action: "review_dashboard" }
];

function diagnosisFixture() {
  return {
    companyName: "Estudio Norte",
    normalizedSegment: "Agência de marketing",
    confidence: "medium",
    operationalSummary: "Operação de marketing recorrente com gargalo de aprovação.",
    businessModel: "Serviço recorrente",
    customerProfile: "Pequenos negócios locais",
    deliveryModel: "Atendimento, criação e aprovação",
    detectedAreas: [{ id: "area_operacoes", name: "Operações", description: "Entrega diária.", source: "inferred", reason: "Citada nas respostas." }],
    detectedPeople: [{ id: "person_marina", name: "Marina", roleHint: "Gestora", areaName: "Operações", source: "user_provided" }],
    bottlenecks: [{ id: "bottleneck_aprovacao", title: "Aprovação atrasada", description: "Entregas param esperando ok.", severity: "high", source: "user_provided" }],
    assumptions: [],
    followupQuestions: [{ id: "responsaveis_area", question: "Quem responde por cada área no dia a dia?", reason: "Define cargos.", expectedUse: "people", priority: 1 }]
  };
}

function onboardingSuggestionFixture() {
  return {
    companyName: "Estudio Norte",
    segment: "Agência de marketing",
    confidence: "medium",
    assumptions: [],
    gaps: [],
    areas: [{ id: "area_operacoes", name: "Operações", description: "Entrega diária.", metadata: { ...onboardingSuggestionMetadata, reviewDefault: "create" } }],
    roles: [{ id: "role_gestor_operacoes", areaName: "Operações", name: "Gestor de operações", description: "Garante execução.", metadata: { ...onboardingSuggestionMetadata, reviewDefault: "create" } }],
    people: [{ id: "person_marina", name: "Marina", email: null, role: "manager", areaName: "Operações", roleName: "Gestor de operações", placeholder: false, metadata: { ...onboardingSuggestionMetadata, source: "user_provided", reviewDefault: "create" } }],
    processes: [{ id: "process_onboarding", title: "Onboarding operacional", summary: "Entrada padronizada.", body: "1. Coletar acessos.", areaName: "Operações", metadata: onboardingSuggestionMetadata }],
    routines: [{ id: "routine_abertura", title: "Abertura do dia", areaName: "Operações", frequency: "daily", taskTitles: ["Conferir prioridades"], metadata: onboardingSuggestionMetadata }],
    trainings: [{ id: "training_evidencias", title: "Como registrar evidências", description: "Aula curta.", materialBody: "Registre tudo no Hoje.", quizPrompt: "Quando registrar evidência?", metadata: onboardingSuggestionMetadata }],
    announcement: { id: "announcement_base", title: "Nova base operacional", body: "Vamos centralizar a operação no Baase.", metadata: onboardingSuggestionMetadata },
    activationPlan: onboardingActivationPlan
  };
}

function onboardingSessionFixture(status: string, overrides: Record<string, unknown> = {}) {
  const currentStepByStatus: Record<string, string> = {
    in_progress: "identity",
    diagnosis_ready: "diagnosis",
    followup: "followup",
    generating_setup: "generating_setup",
    reviewing: "review_map",
    completed: "completed",
    skipped: "skipped"
  };

  return {
    id: "onboarding_session_1",
    workspaceId: "workspace_new",
    ownerProfileId: "profile_owner",
    status,
    currentStep: currentStepByStatus[status] ?? "identity",
    companyName: "Estudio Norte",
    segment: "Agência de marketing",
    customSegment: null,
    normalizedSegment: "Agência de marketing",
    teamSizeRange: "6-15",
    goals: ["organize_team"],
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
    createdAt: "2026-07-08T10:00:00.000Z",
    updatedAt: "2026-07-08T10:00:00.000Z",
    completedAt: null,
    ...overrides
  };
}

function mockLoadedWorkspace(dataByUrl: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    "/api/me": {
      workspace: { id: "workspace_a", name: "Holand" },
      profile: { id: "profile_owner", role: "owner", display_name: "Yohann Reimer", initials: "YR" },
      home_route: "/painel"
    },
    "/api/onboarding/session": { session: onboardingSessionFixture("completed", { companyName: "Holand", normalizedSegment: "Software CAD/CAM e treinamentos" }) },
    "/api/today?date=2026-07-07": { tasks: [] },
    "/api/approvals": { tasks: [] },
    "/api/processes": { processes: [] },
    "/api/routines": { routines: [] },
    "/api/trainings": { trainings: [] },
    "/api/areas": { areas: [] },
    "/api/roles": { role_templates: [] },
    "/api/people": { people: [] },
    "/api/invites": { invites: [] },
    "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
    "/api/dashboard?date=2026-07-07": {},
    "/api/ai/proactive-suggestions": { suggestions: [] }
  };

  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    return new Response(JSON.stringify({ ...defaults, ...dataByUrl }[url] ?? {}), { status: 200 });
  });
}

describe("Baase React app shell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the owner internal dashboard by default", () => {
    render(<App apiEnabled={false} />);

    expect(screen.getByText("Prymeira Baase")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bom dia, Marina." })).toBeInTheDocument();
    expect(screen.getByText("Precisa de você agora")).toBeInTheDocument();
  });

  it("keeps setup-only onboarding review links out of the owner sidebar", () => {
    render(<App apiEnabled={false} />);

    expect(screen.queryByRole("link", { name: /Onboarding IA/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Revisão sugerida/ })).not.toBeInTheDocument();
  });

  it("opens the full-screen onboarding for a new owner workspace and can skip it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/onboarding/session" && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ session: null }), { status: 200 });
      }
      if (url === "/api/onboarding/session/skip") {
        return new Response(JSON.stringify({
          session: {
            id: "onboarding_session_1",
            workspaceId: "workspace_new",
            ownerProfileId: "profile_owner",
            status: "skipped",
            currentStep: "skipped",
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
            createdAt: "2026-07-08T10:00:00.000Z",
            updatedAt: "2026-07-08T10:00:00.000Z",
            completedAt: null
          }
        }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_new", name: "Nova Empresa" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [], training_assignments: [], announcements: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    expect(await screen.findByRole("heading", { name: /Vamos montar a primeira versão operacional/ })).toBeInTheDocument();
    expect(screen.queryByText("Painel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Configurar depois/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/session/skip", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText(/Monte sua empresa com IA/)).toBeInTheDocument();
  });

  it("saves onboarding answers, generates diagnosis, answers follow-up, and generates setup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/onboarding/session" && method === "GET") {
        return new Response(JSON.stringify({ session: null }), { status: 200 });
      }
      if (url === "/api/onboarding/session" && method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("in_progress", {
            currentStep: body.current_step ?? "identity",
            companyName: body.company_name ?? "Estudio Norte",
            segment: body.segment ?? "Agência de marketing",
            normalizedSegment: body.normalized_segment ?? "Agência de marketing",
            teamSizeRange: body.team_size_range ?? "6-15",
            goals: body.goals ?? [],
            mainAnswers: body.main_answers ?? []
          })
        }), { status: 200 });
      }
      if (url === "/api/onboarding/session/diagnosis") {
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("diagnosis_ready", {
            diagnosis: diagnosisFixture(),
            followupQuestions: diagnosisFixture().followupQuestions
          })
        }), { status: 201 });
      }
      if (url === "/api/onboarding/session/followup-answer") {
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("followup", {
            diagnosis: diagnosisFixture(),
            followupQuestions: diagnosisFixture().followupQuestions,
            followupAnswers: [{ questionId: "responsaveis_area", theme: "followup", question: "Quem responde por cada área no dia a dia?", answer: "Marina", inputMode: "text" }]
          })
        }), { status: 200 });
      }
      if (url === "/api/onboarding/session/generate-setup") {
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("reviewing", {
            diagnosis: diagnosisFixture(),
            followupQuestions: diagnosisFixture().followupQuestions,
            followupAnswers: [{ questionId: "responsaveis_area", theme: "followup", question: "Quem responde por cada área no dia a dia?", answer: "Marina", inputMode: "text" }],
            generatedSuggestion: onboardingSuggestionFixture(),
            activationPlan: onboardingSuggestionFixture().activationPlan
          })
        }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_new", name: "Nova Empresa" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [], training_assignments: [], announcements: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    fireEvent.change(await screen.findByLabelText("Nome da empresa"), { target: { value: "Estudio Norte" } });
    fireEvent.click(screen.getByRole("button", { name: "6 a 15 pessoas" }));
    fireEvent.click(screen.getByRole("button", { name: "Organizar a equipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    fireEvent.change(await screen.findByLabelText(/O que sua empresa vende/), { target: { value: "Marketing recorrente para pequenos negócios." } });
    fireEvent.change(screen.getByLabelText(/Quem faz parte da equipe/), { target: { value: "Marina coordena e Bruno cria." } });
    fireEvent.change(screen.getByLabelText(/O que mais atrasa/), { target: { value: "Aprovação e cobrança por WhatsApp." } });
    fireEvent.click(screen.getByRole("button", { name: /Entender minha empresa/ }));

    expect(await screen.findByRole("heading", { name: "Entendi sua empresa" })).toBeInTheDocument();
    expect(screen.getByText("Pergunta 1 de 1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Quem responde por cada área/), { target: { value: "Marina" } });
    fireEvent.click(screen.getByRole("button", { name: /Responder e continuar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Gerar primeira versão da empresa/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/session/generate-setup", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByRole("heading", { name: /Revise sua primeira versão operacional/ })).toBeInTheDocument();
  });

  it("clears the follow-up answer field when the next AI question appears", async () => {
    const firstFollowupQuestion = {
      id: "tecnicos_especialidade",
      question: "Quais são os nomes dos técnicos e existe alguma especialidade clara entre eles?",
      reason: "Ajuda a distribuir responsabilidades.",
      expectedUse: "people",
      priority: 1
    };
    const secondFollowupQuestion = {
      id: "ferramentas_registro",
      question: "Quais ferramentas vocês usam hoje para registrar vendas, financeiro e documentação técnica?",
      reason: "Ajuda a conectar processos e rotinas.",
      expectedUse: "processes",
      priority: 2
    };
    const followupQuestions = [firstFollowupQuestion, secondFollowupQuestion];
    const firstAnswer = "Peterson e André são all-around, mas Peterson é mais sênior.";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/onboarding/session" && method === "GET") {
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("diagnosis_ready", {
            diagnosis: diagnosisFixture(),
            followupQuestions
          })
        }), { status: 200 });
      }
      if (url === "/api/onboarding/session/followup-answer" && method === "POST") {
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("followup", {
            diagnosis: diagnosisFixture(),
            followupQuestions,
            followupAnswers: [{
              questionId: "tecnicos_especialidade",
              theme: "followup",
              question: firstFollowupQuestion.question,
              answer: firstAnswer,
              inputMode: "text"
            }]
          })
        }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_new", name: "Nova Empresa" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [], training_assignments: [], announcements: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    expect(await screen.findByText("Pergunta 1 de 2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Quais são os nomes dos técnicos/), { target: { value: firstAnswer } });
    fireEvent.click(screen.getByRole("button", { name: /Responder e continuar/ }));

    expect(await screen.findByText("Pergunta 2 de 2")).toBeInTheDocument();
    const nextAnswerField = screen.getByLabelText(/Quais ferramentas vocês usam hoje/) as HTMLTextAreaElement;
    expect(nextAnswerField).toHaveValue("");
    expect(nextAnswerField).not.toHaveValue(firstAnswer);
  });

  it("shows progress as soon as the owner starts the onboarding diagnosis", async () => {
    let resolveDiagnosis!: (response: Response) => void;
    const diagnosisPromise = new Promise<Response>((resolve) => {
      resolveDiagnosis = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/onboarding/session" && method === "GET") {
        return new Response(JSON.stringify({ session: null }), { status: 200 });
      }
      if (url === "/api/onboarding/session" && method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("in_progress", {
            currentStep: body.current_step ?? "identity",
            companyName: body.company_name ?? "Estudio Norte",
            segment: body.segment ?? "Agência de marketing",
            normalizedSegment: body.normalized_segment ?? "Agência de marketing",
            teamSizeRange: body.team_size_range ?? "6-15",
            goals: body.goals ?? [],
            mainAnswers: body.main_answers ?? []
          })
        }), { status: 200 });
      }
      if (url === "/api/onboarding/session/diagnosis") {
        return diagnosisPromise;
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_new", name: "Nova Empresa" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [], training_assignments: [], announcements: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("Nome da empresa"), { target: { value: "Estudio Norte" } });
    fireEvent.click(screen.getByRole("button", { name: "6 a 15 pessoas" }));
    fireEvent.click(screen.getByRole("button", { name: "Organizar a equipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    fireEvent.change(await screen.findByLabelText(/O que sua empresa vende/), { target: { value: "Marketing recorrente para pequenos negócios." } });
    fireEvent.change(screen.getByLabelText(/Quem faz parte da equipe/), { target: { value: "Marina coordena e Bruno cria." } });
    fireEvent.change(screen.getByLabelText(/O que mais atrasa/), { target: { value: "Aprovação e cobrança por WhatsApp." } });
    fireEvent.click(screen.getByRole("button", { name: /Entender minha empresa/ }));

    expect(await screen.findByRole("heading", { name: "Entendendo sua empresa" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/session/diagnosis", expect.objectContaining({ method: "POST" })));

    resolveDiagnosis(new Response(JSON.stringify({
      session: onboardingSessionFixture("diagnosis_ready", {
        diagnosis: diagnosisFixture(),
        followupQuestions: diagnosisFixture().followupQuestions
      })
    }), { status: 201 }));
    expect(await screen.findByRole("heading", { name: "Entendi sua empresa" })).toBeInTheDocument();
  });

  it("records audio in the full-screen onboarding conversation and saves the transcript", async () => {
    class FakeMediaRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {}

      stop() {
        this.ondataavailable?.({ data: new Blob(["conversation-audio"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }

    const stopTrack = vi.fn();
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: stopTrack }]
    }));
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });

    const patchBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/onboarding/session" && method === "GET") {
        return new Response(JSON.stringify({ session: null }), { status: 200 });
      }
      if (url === "/api/onboarding/session" && method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        patchBodies.push(body);
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("in_progress", {
            currentStep: body.current_step ?? "identity",
            companyName: body.company_name ?? "Estudio Norte",
            segment: body.segment ?? "Agência de marketing",
            normalizedSegment: body.normalized_segment ?? "Agência de marketing",
            teamSizeRange: body.team_size_range ?? "6-15",
            goals: body.goals ?? [],
            main_answers: body.main_answers ?? []
          })
        }), { status: 200 });
      }
      if (url === "/api/ai/transcriptions" && init?.method === "POST") {
        return new Response(JSON.stringify({
          transcript: {
            text: "Vendemos marketing recorrente para negócios locais e entregamos por atendimento, criação e aprovação.",
            confidence: 0.96,
            duration_seconds: 8
          }
        }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_new", name: "Nova Empresa" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [], training_assignments: [], announcements: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("Nome da empresa"), { target: { value: "Estudio Norte" } });
    fireEvent.click(screen.getByRole("button", { name: "6 a 15 pessoas" }));
    fireEvent.click(screen.getByRole("button", { name: "Organizar a equipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    fireEvent.click(await screen.findByRole("button", { name: "Gravar áudio: pergunta 1" }));
    expect(await screen.findByRole("button", { name: "Parar áudio: pergunta 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Parar áudio: pergunta 1" }));

    expect(await screen.findByDisplayValue(/Vendemos marketing recorrente/)).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stopTrack).toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/ai/transcriptions", expect.objectContaining({ method: "POST" })));
    expect(patchBodies.some((body) => {
      const answers = body.main_answers as Array<Record<string, unknown>> | undefined;
      return answers?.some((answer) => answer.question_id === "operations_overview" && answer.input_mode === "audio");
    })).toBe(true);
  });

  it("keeps the full-screen onboarding open when conversation audio transcription fails", async () => {
    class FakeMediaRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {}

      stop() {
        this.ondataavailable?.({ data: new Blob(["conversation-audio"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }

    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: vi.fn() }]
    }));
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/onboarding/session" && method === "GET") {
        return new Response(JSON.stringify({ session: null }), { status: 200 });
      }
      if (url === "/api/onboarding/session" && method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("in_progress", {
            currentStep: body.current_step ?? "identity",
            companyName: body.company_name ?? "Estudio Norte",
            segment: body.segment ?? "Agência de marketing",
            normalizedSegment: body.normalized_segment ?? "Agência de marketing",
            teamSizeRange: body.team_size_range ?? "6-15",
            goals: body.goals ?? [],
            main_answers: body.main_answers ?? []
          })
        }), { status: 200 });
      }
      if (url === "/api/ai/transcriptions" && init?.method === "POST") {
        return new Response(JSON.stringify({ error: { code: "AI_TRANSCRIPTION_FAILED" } }), { status: 500 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_new", name: "Nova Empresa" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [], training_assignments: [], announcements: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("Nome da empresa"), { target: { value: "Estudio Norte" } });
    fireEvent.click(screen.getByRole("button", { name: "6 a 15 pessoas" }));
    fireEvent.click(screen.getByRole("button", { name: "Organizar a equipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    fireEvent.click(await screen.findByRole("button", { name: "Gravar áudio: pergunta 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Parar áudio: pergunta 1" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/ai/transcriptions", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByRole("heading", { name: "Conte como a empresa funciona hoje" })).toBeInTheDocument();
    expect(screen.getByText("não conseguimos transcrever")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bom dia, Marina." })).not.toBeInTheDocument();
  });

  it("edits a generated process in review and completes onboarding", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/onboarding/session" && method === "GET") {
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("reviewing", {
            generatedSuggestion: onboardingSuggestionFixture(),
            activationPlan: onboardingSuggestionFixture().activationPlan
          })
        }), { status: 200 });
      }
      if (url === "/api/onboarding/session/review-decision") {
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("reviewing", {
            generatedSuggestion: onboardingSuggestionFixture(),
            activationPlan: onboardingSuggestionFixture().activationPlan,
            reviewDecisions: [{ itemType: "process", itemId: "process_onboarding", action: "draft", editedPayload: { title: "Onboarding ajustado" } }]
          })
        }), { status: 200 });
      }
      if (url === "/api/onboarding/session/complete") {
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("completed", {
            currentStep: "completed",
            generatedSuggestion: onboardingSuggestionFixture(),
            activationPlan: onboardingSuggestionFixture().activationPlan,
            createdSetupSummary: { areas: 2, roles: 2, people: 1, placeholders: 1, processes: 1, routines: 1, trainings: 1, announcements: 1, invites: 0 }
          })
        }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_new", name: "Nova Empresa" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [], training_assignments: [], announcements: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: /Revise sua primeira versão operacional/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Processos sugeridos/ }));
    fireEvent.click(screen.getByRole("button", { name: /Editar Onboarding operacional/ }));
    fireEvent.change(await screen.findByLabelText("Titulo do processo"), { target: { value: "Onboarding ajustado" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar decisão/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/session/review-decision", expect.objectContaining({ method: "PATCH" })));

    fireEvent.click(screen.getByRole("button", { name: /Criar primeira versão da empresa/ }));
    expect(await screen.findByRole("heading", { name: /A primeira versão operacional da sua empresa está pronta/ })).toBeInTheDocument();
  });

  it("reloads the created company after finishing the intelligent onboarding", async () => {
    let completed = false;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/onboarding/session" && method === "GET") {
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("reviewing", {
            companyName: "Holand",
            generatedSuggestion: onboardingSuggestionFixture(),
            activationPlan: onboardingSuggestionFixture().activationPlan
          })
        }), { status: 200 });
      }
      if (url === "/api/onboarding/session/complete" && method === "POST") {
        completed = true;
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("completed", {
            companyName: "Holand",
            currentStep: "completed",
            generatedSuggestion: onboardingSuggestionFixture(),
            activationPlan: onboardingSuggestionFixture().activationPlan,
            createdSetupSummary: { areas: 1, roles: 1, people: 1, placeholders: 0, processes: 1, routines: 1, trainings: 1, announcements: 0, invites: 0 }
          })
        }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": {
          workspace: { id: "workspace_new", name: completed ? "Holand" : "Estudio Norte" },
          profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" },
          home_route: "/painel"
        },
        "/api/today?date=2026-07-07": { tasks: [], training_assignments: [], announcements: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: completed ? [{ id: "process_holand", title: "Registrar oportunidade comercial", status: "draft" }] : [] },
        "/api/routines": { routines: completed ? [{ id: "routine_holand", title: "Revisão dos clientes em andamento", status: "archived" }] : [] },
        "/api/trainings": { trainings: completed ? [{ id: "training_holand", title: "Como registrar entregáveis técnicos", status: "draft" }] : [] },
        "/api/areas": { areas: completed ? [{ id: "area_holand", name: "Implantação Técnica", description: "Treinamentos e entregáveis." }] : [] },
        "/api/roles": { role_templates: completed ? [{ id: "role_holand", areaId: "area_holand", name: "Técnico CAD/CAM" }] : [] },
        "/api/people": { people: completed ? [{ id: "person_peterson", name: "Peterson", role: "employee", areaId: "area_holand", roleTemplateId: "role_holand" }] : [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: /Revise sua primeira versão operacional/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Criar primeira versão da empresa/ }));
    expect(await screen.findByRole("heading", { name: /A primeira versão operacional da sua empresa está pronta/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ir para o Painel" }));

    expect(await screen.findAllByText("Holand")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("link", { name: /Mapa da Empresa/ }));
    expect(await screen.findByText("Implantação Técnica")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/me", expect.anything()));
  });

  it("shows onboarding completion summary and dashboard activation plan after going to panel", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/onboarding/session") {
        return new Response(JSON.stringify({
          session: onboardingSessionFixture("completed", {
            currentStep: "completed",
            createdSetupSummary: { areas: 2, roles: 2, people: 1, placeholders: 1, processes: 1, routines: 1, trainings: 1, announcements: 1, invites: 0 },
            activationPlan: onboardingSuggestionFixture().activationPlan
          })
        }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_new", name: "Estudio Norte" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [], training_assignments: [], announcements: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [{ id: "area_1", name: "Operações", description: "Entrega.", sortOrder: 1 }] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    expect(await screen.findByText(/Plano de 7 dias/)).toBeInTheDocument();
    expect(screen.getByText("Revisar mapa")).toBeInTheDocument();
    expect(screen.getByText("Confirmar áreas.")).toBeInTheDocument();
  });

  it("renders proactive AI suggestions from the workspace API", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/ai/proactive-suggestions": {
          suggestions: [{
            id: "area_without_routine_area_financeiro",
            signal: "area_without_routine",
            priority: "high",
            title: "Financeiro ainda não tem rotina ativa",
            reason: "Áreas sem rotina dependem de memória e cobrança manual.",
            action: {
              type: "create_routine",
              label: "Criar rotina com IA",
              prompt: "Criar rotina financeira com checklist e evidência",
              targetScreen: "rotinas"
            },
            target: { areaId: "area_financeiro" }
          }]
        }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    expect(await screen.findByText("Financeiro ainda não tem rotina ativa")).toBeInTheDocument();
    expect(screen.getByText("Áreas sem rotina dependem de memória e cobrança manual.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Criar rotina com IA" }));
    expect(screen.getByRole("heading", { name: "O que você quer criar?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pedido para a IA")).toHaveValue("Criar rotina financeira com checklist e evidência");
  });

  it("renders owner dashboard metrics from the dashboard API", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {
          date: "2026-07-07",
          role: "owner",
          metrics: {
            todayTotal: 12,
            todayCompleted: 10,
            executionRate: 83,
            awaitingApproval: 5,
            lateTasks: 2,
            pendingTrainingAssignments: 4,
            incompleteProcesses: 3
          },
          areaMetrics: [{ areaId: "area_cs", name: "Atendimento", total: 12, completed: 10, awaitingApproval: 5, late: 2, completionRate: 83 }],
          attentionItems: [{
            id: "late_tasks",
            title: "2 tarefas atrasadas",
            subtitle: "Atrasos travam a rotina do funcionário.",
            tag: "Atraso",
            tone: "danger",
            icon: "ph-clock-countdown",
            targetScreen: "rotinas"
          }]
        },
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    expect(await screen.findAllByText("83%")).toHaveLength(3);
    expect(screen.getAllByText("10 de 12 tarefas")).toHaveLength(2);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getAllByText("2 tarefas atrasadas").length).toBeGreaterThan(0);
  });

  it("switches to the manager and employee homes using React state", () => {
    render(<App apiEnabled={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Gestor" }));
    expect(screen.getByRole("heading", { name: "Painel da área · Criação" })).toBeInTheDocument();
    expect(screen.getByText("Sua equipe hoje")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Funcionário" }));
    expect(screen.getByRole("heading", { name: "Seu dia, Bruno." })).toBeInTheDocument();
    expect(screen.queryByText("Experiência mobile")).not.toBeInTheDocument();
  });

  it("keeps the main internal pages available as React screens", () => {
    render(<App apiEnabled={false} />);

    fireEvent.click(screen.getByRole("link", { name: /Processos/ }));
    expect(screen.getByRole("heading", { name: "Onboarding de cliente novo" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Rotinas/ }));
    expect(screen.getByRole("heading", { name: "Abertura do dia — Social" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Treinamentos/ }));
    expect(screen.getByRole("heading", { name: "Padrão de aprovação de peças" })).toBeInTheDocument();
  });

  it("loads the current profile and operational lists from the API", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const dataByUrl: Record<string, unknown> = {
        "/api/me": {
          workspace: { id: "workspace_a", name: "Norte Ops" },
          profile: { id: "profile_employee", role: "employee", display_name: "Bianca Ramos", initials: "BR", area_name: "CS" },
          home_route: "/hoje"
        },
        "/api/today?date=2026-07-07": {
          tasks: [{ id: "task_99", title: "Responder clientes prioritários", status: "pending", dueDate: "2026-07-07", evidencePolicy: "optional" }]
        },
        "/api/processes": { processes: [{ id: "process_99", title: "Atendimento premium", status: "published", areaId: "CS" }] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App initialRole="func" />);

    expect(await screen.findByText("Bianca Ramos")).toBeInTheDocument();
    expect(screen.getAllByText("Norte Ops")).toHaveLength(2);
    expect(screen.getAllByText("Responder clientes prioritários")).toHaveLength(1);

    fireEvent.click(screen.getByRole("link", { name: /Processos/ }));
    await waitFor(() => expect(screen.getAllByText("Atendimento premium").length).toBeGreaterThan(0));
  });

  it("lets managers create a one-off task from the Today page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/tasks" && init?.method === "POST") {
        return new Response(JSON.stringify({
          task: {
            id: "task_manual_1",
            title: "Confirmar agenda do cliente",
            status: "pending",
            origin: "manual",
            areaId: "area_tecnica",
            assigneeProfileId: "profile_employee",
            dueDate: "2026-07-07",
            dueHint: "Até 16:00",
            evidencePolicy: "comment_required",
            approvalMode: "direct",
            checklistItems: [{ title: "Registrar retorno", done: false }]
          }
        }), { status: 201 });
      }
      if (url === "/api/tasks/task_manual_1" && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === "/api/tasks/task_manual_1" && init?.method === "PATCH") {
        return new Response(JSON.stringify({
          task: {
            id: "task_manual_1",
            title: "Confirmar agenda do cliente VIP",
            status: "pending",
            origin: "manual",
            areaId: "area_tecnica",
            assigneeProfileId: "profile_employee",
            dueDate: "2026-07-07",
            dueHint: "Até 16:00",
            evidencePolicy: "comment_required",
            approvalMode: "direct",
            checklistItems: [{ title: "Registrar retorno", done: false }]
          }
        }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": {
          workspace: { id: "workspace_a", name: "Holand" },
          profile: { id: "profile_manager", role: "manager", display_name: "Yohann Reimer", initials: "YR", area_name: "Técnica" },
          home_route: "/painel-gestor"
        },
        "/api/today?date=2026-07-07": { tasks: [], training_assignments: [], announcements: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [{ id: "area_tecnica", name: "Técnica", description: "Entrega técnica." }] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [{ id: "profile_employee", name: "André", role: "employee", areaId: "area_tecnica", status: "active" }] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App initialRole="gestor" />);

    await screen.findByText("Yohann Reimer");
    fireEvent.click(screen.getByRole("link", { name: /Hoje/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Nova tarefa/ }));
    fireEvent.change(screen.getByLabelText("Título da tarefa"), { target: { value: "Confirmar agenda do cliente" } });
    fireEvent.change(screen.getByLabelText("Prazo"), { target: { value: "Até 16:00" } });
    fireEvent.change(screen.getByLabelText("Checklist item 1"), { target: { value: "Registrar retorno" } });
    fireEvent.change(screen.getByLabelText("Evidência"), { target: { value: "comment_required" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tarefa" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks", expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Confirmar agenda do cliente")
      }));
      expect(screen.getAllByText("Confirmar agenda do cliente").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /Confirmar agenda do cliente/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Editar tarefa/ }));
    fireEvent.change(await screen.findByLabelText("Título da tarefa"), { target: { value: "Confirmar agenda do cliente VIP" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tarefa" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task_manual_1", expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("Confirmar agenda do cliente VIP")
      }));
      expect(screen.getAllByText("Confirmar agenda do cliente VIP").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /Confirmar agenda do cliente VIP/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Excluir tarefa/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task_manual_1", expect.objectContaining({ method: "DELETE" }));
      expect(screen.queryByText("Confirmar agenda do cliente VIP")).not.toBeInTheDocument();
    });
  });

  it("renders training and announcement pendencies from the employee Today inbox", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const dataByUrl: Record<string, unknown> = {
        "/api/me": {
          workspace: { id: "workspace_a", name: "Norte Ops" },
          profile: { id: "profile_employee", role: "employee", display_name: "Bianca Ramos", initials: "BR", area_name: "CS" },
          home_route: "/hoje"
        },
        "/api/today?date=2026-07-07": {
          tasks: [],
          training_assignments: [{
            assignmentId: "assignment_1",
            trainingId: "training_1",
            profileId: "profile_employee",
            dueDate: "2026-07-10",
            status: "pending",
            training: { id: "training_1", title: "Atendimento em 15 minutos", status: "published" }
          }],
          announcements: [{
            id: "announcement_1",
            title: "Novo padrão de atendimento",
            body: "Confirme o novo prazo.",
            type: "simple",
            status: "published",
            requirement: "read_confirmation",
            receipt: { status: "pending" }
          }]
        },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [{ id: "training_1", title: "Atendimento em 15 minutos", status: "published" }] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App initialRole="func" />);

    expect(await screen.findByText("Bianca Ramos")).toBeInTheDocument();
    expect(screen.getByText("Confirmar leitura: Novo padrão de atendimento")).toBeInTheDocument();
    expect(screen.getByText("Treinamento: Atendimento em 15 minutos")).toBeInTheDocument();
  });

  it("confirms a real announcement from the employee announcement page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/announcements/announcement_1/confirm" && init?.method === "POST") {
        return new Response(JSON.stringify({ receipt: { id: "receipt_1", status: "confirmed" } }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": {
          workspace: { id: "workspace_a", name: "Norte Ops" },
          profile: { id: "profile_employee", role: "employee", display_name: "Bianca Ramos", initials: "BR", area_name: "CS" },
          home_route: "/hoje"
        },
        "/api/today?date=2026-07-07": {
          tasks: [],
          training_assignments: [],
          announcements: [{
            id: "announcement_1",
            title: "Novo padrão de atendimento",
            body: "Confirme o novo prazo.",
            type: "simple",
            status: "published",
            requirement: "read_confirmation",
            receipt: { status: "pending" }
          }]
        },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App initialRole="func" />);

    await screen.findByText("Bianca Ramos");
    fireEvent.click(screen.getByRole("link", { name: /Comunicados/ }));
    expect(await screen.findByRole("heading", { name: "Novo padrão de atendimento" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Li e confirmo/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/announcements/announcement_1/confirm", expect.objectContaining({ method: "POST" }));
      expect(screen.getByText("Leitura confirmada")).toBeInTheDocument();
    });
  });

  it("submits an API task when the employee completes it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/tasks/task_99/submit" && init?.method === "POST") {
        return new Response(JSON.stringify({ task: { id: "task_99", title: "Responder clientes prioritários", status: "completed", dueDate: "2026-07-07", evidencePolicy: "optional" } }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": {
          workspace: { id: "workspace_a", name: "Norte Ops" },
          profile: { id: "profile_employee", role: "employee", display_name: "Bianca Ramos", initials: "BR", area_name: "CS" },
          home_route: "/hoje"
        },
        "/api/today?date=2026-07-07": {
          tasks: [{ id: "task_99", title: "Responder clientes prioritários", status: "pending", dueDate: "2026-07-07", evidencePolicy: "optional" }]
        },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App initialRole="func" />);

    await screen.findByText("Bianca Ramos");
    fireEvent.click(screen.getByRole("button", { name: /Responder clientes prioritários/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Concluir tarefa" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task_99/submit", expect.objectContaining({ method: "POST" }));
      expect(screen.getByText("1 de 1")).toBeInTheDocument();
    });
  });

  it("shows and updates checklist progress inside the task execution modal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/tasks/task_checklist/checklist" && init?.method === "PATCH") {
        return new Response(JSON.stringify({
          task: {
            id: "task_checklist",
            title: "Terminar máquina virtual Krah",
            status: "pending",
            origin: "manual",
            dueDate: "2026-07-07",
            evidencePolicy: "optional",
            checklistItems: [
              { title: "Instalar dependências", done: true },
              { title: "Validar acesso", done: false },
              { title: "Registrar entrega", done: false }
            ]
          }
        }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": {
          workspace: { id: "workspace_a", name: "Norte Ops" },
          profile: { id: "profile_employee", role: "employee", display_name: "Bianca Ramos", initials: "BR", area_name: "CS" },
          home_route: "/hoje"
        },
        "/api/today?date=2026-07-07": {
          tasks: [{
            id: "task_checklist",
            title: "Terminar máquina virtual Krah",
            status: "pending",
            origin: "manual",
            dueDate: "2026-07-07",
            evidencePolicy: "optional",
            checklistItems: [
              { title: "Instalar dependências", done: false },
              { title: "Validar acesso", done: false },
              { title: "Registrar entrega", done: false }
            ]
          }]
        },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App initialRole="func" />);

    await screen.findByText("Bianca Ramos");
    fireEvent.click(screen.getByRole("button", { name: /Terminar máquina virtual Krah/ }));

    expect(await screen.findByText("0/3 concluído")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Instalar dependências" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task_checklist/checklist", expect.objectContaining({ method: "PATCH" }));
      expect(screen.getByText("1/3 concluído")).toBeInTheDocument();
    });
  });

  it("lets the employee attach evidence and send a task for approval", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/tasks/task_approval/submit" && init?.method === "POST") {
        return new Response(JSON.stringify({
          task: {
            id: "task_approval",
            title: "Fotografar recepção pronta",
            status: "awaiting_approval",
            dueDate: "2026-07-07",
            evidencePolicy: "photo_or_comment_required",
            approvalMode: "approval_required",
            evidence: { comment: "Recepção pronta.", photoUrl: "https://example.com/foto.jpg" }
          }
        }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": {
          workspace: { id: "workspace_a", name: "Norte Ops" },
          profile: { id: "profile_employee", role: "employee", display_name: "Bianca Ramos", initials: "BR", area_name: "CS" },
          home_route: "/hoje"
        },
        "/api/today?date=2026-07-07": {
          tasks: [{
            id: "task_approval",
            title: "Fotografar recepção pronta",
            status: "pending",
            dueDate: "2026-07-07",
            evidencePolicy: "photo_or_comment_required",
            approvalMode: "approval_required"
          }]
        },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App initialRole="func" />);

    await screen.findByText("Bianca Ramos");
    fireEvent.click(screen.getByRole("button", { name: /Fotografar recepção pronta/ }));

    fireEvent.change(await screen.findByLabelText("Comentário"), { target: { value: "Recepção pronta." } });
    fireEvent.change(screen.getByLabelText("Foto"), { target: { value: "https://example.com/foto.jpg" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar para aprovação" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task_approval/submit", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ comment: "Recepção pronta.", photo_url: "https://example.com/foto.jpg" })
      }));
      expect(screen.getByText("Enviado para aprovação")).toBeInTheDocument();
    });
  });

  it("lets managers approve and return submitted employee tasks", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/tasks/task_review/approve" && init?.method === "POST") {
        return new Response(JSON.stringify({ task: { id: "task_review", title: "Revisar relatório", status: "completed" } }), { status: 200 });
      }
      if (url === "/api/tasks/task_return/return" && init?.method === "POST") {
        return new Response(JSON.stringify({ task: { id: "task_return", title: "Enviar print", status: "needs_adjustment", reviewComment: "Inclua o print." } }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": {
          workspace: { id: "workspace_a", name: "Norte Ops" },
          profile: { id: "profile_manager", role: "manager", display_name: "Rafael Nunes", initials: "RN", area_name: "Criação" },
          home_route: "/painel"
        },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": {
          tasks: [
            { id: "task_review", title: "Revisar relatório", status: "awaiting_approval", evidence: { comment: "Feito.", photoUrl: null } },
            { id: "task_return", title: "Enviar print", status: "awaiting_approval", evidence: { comment: "Sem print.", photoUrl: null } }
          ]
        },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App initialRole="gestor" />);

    expect(await screen.findByText("Revisar relatório")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Aprovar Revisar relatório/ }));
    fireEvent.click(screen.getByRole("button", { name: /Devolver Enviar print/ }));
    fireEvent.change(await screen.findByLabelText("Comentário da devolução"), { target: { value: "Inclua o print." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar devolução" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task_review/approve", expect.objectContaining({ method: "POST" }));
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task_return/return", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ comment: "Inclua o print." })
      }));
    });
  });

  it("creates a draft process from the AI screen and shows it in Processos", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/ai/drafts" && init?.method === "POST") {
        return new Response(JSON.stringify({
          draft: {
            id: "draft_ai_run_99",
            ai_run_id: "ai_run_99",
            type: "process",
            status: "ready_for_review",
            content: {
              title: "Processo de aprovação criado",
              summary: "Gerado pela IA",
              objective: "Padronizar aprovação antes do envio.",
              trigger: "Nova peça pronta para revisão",
              areaName: "Criação",
              roleName: null,
              steps: [{
                title: "Subir peça no Baase",
                detail: "Anexe o material e marque o responsável.",
                evidencePolicy: "photo_or_comment_required",
                approvalMode: "approval_required"
              }],
              assumptions: [],
              gaps: []
            }
          }
        }), { status: 201 });
      }
      if (url === "/api/processes" && init?.method === "POST") {
        return new Response(JSON.stringify({ process: { id: "process_99", title: "Processo de aprovação criado", status: "draft", summary: "Gerado pela IA" } }), { status: 201 });
      }
      if (url === "/api/processes/process_99/publish") {
        return new Response(JSON.stringify({ process: { id: "process_99", title: "Processo de aprovação criado", status: "published", summary: "Gerado pela IA" } }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Criar com IA/ }));
    fireEvent.click(screen.getByRole("button", { name: /Gerar rascunho/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/ai/drafts", expect.objectContaining({ method: "POST" }));
      expect(fetchMock).toHaveBeenCalledWith("/api/processes", expect.objectContaining({ method: "POST" }));
      expect(fetchMock).not.toHaveBeenCalledWith("/api/processes/process_99/publish", expect.any(Object));
      expect(screen.getAllByText("Processo de aprovação criado").length).toBeGreaterThan(0);
    });
  });

  it("keeps Create with AI examples as placeholders instead of real prompt text", () => {
    render(<App apiEnabled={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Criar com IA/ }));
    const prompt = screen.getByLabelText("Pedido para a IA");

    expect(prompt).toHaveValue("");
    expect(prompt).toHaveAttribute("placeholder", "Criar um processo de aprovação de peças, do envio interno até o ok do cliente");

    fireEvent.click(screen.getByText("Criar rotina").closest("button") as HTMLElement);
    expect(prompt).toHaveValue("");
    expect(prompt).toHaveAttribute("placeholder", "Criar uma rotina diária com checklist, responsável, prazo e evidência");

    fireEvent.change(prompt, { target: { value: "Meu pedido real" } });
    fireEvent.change(prompt, { target: { value: "" } });
    expect(prompt).toHaveValue("");
    expect(prompt).toHaveAttribute("placeholder", "Criar uma rotina diária com checklist, responsável, prazo e evidência");
  });

  it("shows a premium generation state while the AI draft is being created", async () => {
    let resolveDraft: (response: Response) => void = (_response: Response) => {
      throw new Error("draft promise was not initialized");
    };
    const draftPromise = new Promise<Response>((resolve) => {
      resolveDraft = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/ai/drafts" && init?.method === "POST") {
        return draftPromise;
      }
      if (url === "/api/processes" && init?.method === "POST") {
        return new Response(JSON.stringify({ process: { id: "process_wait", title: "Processo com espera", status: "draft", summary: "Gerado pela IA" } }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Criar com IA/ }));
    fireEvent.change(await screen.findByLabelText("Pedido para a IA"), { target: { value: "Criar processo com espera" } });
    fireEvent.click(screen.getByRole("button", { name: /Gerar rascunho/ }));

    expect(await screen.findByRole("status", { name: "Criação com IA em andamento" })).toHaveTextContent("Criando com IA");
    expect(screen.getByRole("button", { name: /Gerando/ })).toBeDisabled();

    resolveDraft(new Response(JSON.stringify({
      draft: {
        id: "draft_wait",
        ai_run_id: "ai_wait",
        type: "process",
        status: "ready_for_review",
        content: {
          title: "Processo com espera",
          summary: "Gerado pela IA",
          objective: "Padronizar.",
          trigger: "Pedido recebido.",
          areaName: null,
          roleName: null,
          steps: [{ title: "Executar etapa", detail: "Fazer com evidência.", evidencePolicy: "comment_required", approvalMode: "direct" }],
          assumptions: [],
          gaps: []
        }
      }
    }), { status: 201 }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Processo com espera" })).toBeInTheDocument();
    });
  });

  it("sends attached material from Criar com IA into a training draft", async () => {
    let draftRequestBody = "";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/ai/drafts" && init?.method === "POST") {
        draftRequestBody = String(init.body ?? "");
        return new Response(JSON.stringify({
          draft: {
            id: "draft_ai_material",
            ai_run_id: "ai_material",
            type: "training",
            status: "ready_for_review",
            content: {
              title: "Treinamento do manual",
              description: "Criado a partir do material anexado.",
              targetAreaName: null,
              targetRoleName: null,
              lesson: { title: "Aula curta", body: "Registre evidências com clareza." },
              quiz: [{
                prompt: "O que deve ser registrado?",
                options: [{ id: "a", label: "Evidência clara" }, { id: "b", label: "Nada" }],
                correctOptionId: "a",
                explanation: "Evidências tornam a execução auditável."
              }],
              assumptions: [],
              gaps: []
            }
          }
        }), { status: 201 });
      }
      if (url === "/api/trainings" && init?.method === "POST") {
        return new Response(JSON.stringify({
          training: {
            id: "training_material",
            title: "Treinamento do manual",
            status: "draft",
            description: "Criado a partir do material anexado."
          }
        }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Criar com IA/ }));
    fireEvent.change(screen.getByLabelText("Arquivo para Criar com IA"), {
      target: {
        files: [new File(["Manual: registrar evidência antes de concluir."], "manual.txt", { type: "text/plain" })]
      }
    });
    expect(await screen.findByText("manual.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Gerar rascunho/ }));

    await waitFor(() => {
      const body = JSON.parse(draftRequestBody);
      expect(body).toMatchObject({
        type: "training",
        input_mode: "pdf",
        attachments: [{ name: "manual.txt", mime_type: "text/plain" }]
      });
      expect(fetchMock).toHaveBeenCalledWith("/api/trainings", expect.objectContaining({ method: "POST" }));
      expect(screen.getByRole("heading", { name: "Treinamento do manual" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("link", { name: /Criar com IA/ }));

    expect(screen.getByLabelText("Pedido para a IA")).toHaveValue("");
    expect(screen.queryByText("manual.txt")).not.toBeInTheDocument();
    expect(screen.queryByText(/áudio transcrito/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Criar processo/ })).toHaveClass("active");
  });

  it("renders AI-generated training lessons as structured material instead of raw markdown", async () => {
    mockLoadedWorkspace({
      "/api/trainings": {
        trainings: [{
          id: "training_ai_sales",
          title: "Como avaliar se a empresa está pronta para contratar vendedores",
          status: "draft",
          description: "Treinamento operacional curto.",
          source: { type: "manual", title: "Criado com IA", processId: null },
          materials: [{
            kind: "lesson",
            title: "Quando contratar vendedores sem transformar crescimento em prejuízo",
            body: [
              "## Objetivo",
              "Ensinar o responsável comercial a avaliar, de forma prática, se a empresa está pronta para contratar vendedores.",
              "",
              "---",
              "",
              "## Passo a passo prático",
              "### 1. Verifique se o fundador ou sócio já validou a venda",
              "Antes de contratar, confirme se já existem pelo menos 10 a 20 vendas realizadas.",
              "",
              "Registre:",
              "- quem comprou;",
              "- qual dor motivou a compra;"
            ].join("\n"),
            url: null
          }],
          quizQuestions: []
        }]
      }
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: /Treinamentos/ }));

    expect(await screen.findByRole("heading", { name: "Objetivo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Passo a passo prático" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1. Verifique se o fundador ou sócio já validou a venda" })).toBeInTheDocument();
    expect(screen.getByText("quem comprou;")).toBeInTheDocument();
    expect(screen.queryByText(/## Objetivo/)).not.toBeInTheDocument();
    expect(screen.queryByText("---")).not.toBeInTheDocument();
  });

  it("transcribes audio in Criar com IA before generating a process draft", async () => {
    let draftRequestBody = "";
    class FakeMediaRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }]
        }))
      }
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/ai/transcriptions" && init?.method === "POST") {
        return new Response(JSON.stringify({
          transcript: {
            text: "Todo pedido aprovado precisa virar SOP com evidência.",
            confidence: 0.93,
            duration_seconds: 9
          }
        }), { status: 201 });
      }
      if (url === "/api/ai/drafts" && init?.method === "POST") {
        draftRequestBody = String(init.body ?? "");
        return new Response(JSON.stringify({
          draft: {
            id: "draft_ai_audio",
            ai_run_id: "ai_audio",
            type: "process",
            status: "ready_for_review",
            content: {
              title: "SOP do áudio",
              summary: "Gerado a partir da fala do dono.",
              objective: "Padronizar pedidos aprovados.",
              trigger: "Pedido aprovado.",
              areaName: null,
              roleName: null,
              steps: [{
                title: "Registrar evidência",
                detail: "Documentar o que foi aprovado.",
                evidencePolicy: "comment_required",
                approvalMode: "approval_required"
              }],
              assumptions: [],
              gaps: []
            }
          }
        }), { status: 201 });
      }
      if (url === "/api/processes" && init?.method === "POST") {
        return new Response(JSON.stringify({
          process: {
            id: "process_audio",
            title: "SOP do áudio",
            status: "draft",
            summary: "Gerado a partir da fala do dono."
          }
        }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Criar com IA/ }));
    fireEvent.click(screen.getByLabelText("Usar áudio no Criar com IA"));
    expect(await screen.findByRole("status", { name: "Gravação em andamento" })).toHaveTextContent("Ouvindo sua explicação");
    fireEvent.click(await screen.findByLabelText("Parar gravação no Criar com IA"));

    expect(await screen.findByDisplayValue(/Todo pedido aprovado precisa virar SOP/)).toBeInTheDocument();
    expect(screen.getByLabelText("Pedido para a IA")).not.toHaveValue(expect.stringContaining("Transcrição do áudio"));
    fireEvent.click(screen.getByRole("button", { name: /Gerar rascunho/ }));

    await waitFor(() => {
      const body = JSON.parse(draftRequestBody);
      expect(body.input_mode).toBe("audio");
      expect(body.input).toContain("Todo pedido aprovado precisa virar SOP");
      expect(screen.getByRole("heading", { name: "SOP do áudio" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("link", { name: /Criar com IA/ }));

    expect(screen.getByLabelText("Pedido para a IA")).toHaveValue("");
    expect(screen.queryByText(/áudio transcrito/i)).not.toBeInTheDocument();
  });

  it("keeps the selected Criar com IA content type when recording audio", async () => {
    let draftRequestBody = "";
    class FakeMediaRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }]
        }))
      }
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/ai/transcriptions" && init?.method === "POST") {
        return new Response(JSON.stringify({
          transcript: {
            text: "Comunicar a equipe que evidências agora são obrigatórias.",
            confidence: 0.91,
            duration_seconds: 8
          }
        }), { status: 201 });
      }
      if (url === "/api/ai/drafts" && init?.method === "POST") {
        draftRequestBody = String(init.body ?? "");
        return new Response(JSON.stringify({
          draft: {
            id: "draft_ai_audio_announcement",
            ai_run_id: "ai_audio_announcement",
            type: "announcement",
            status: "ready_for_review",
            content: {
              title: "Comunicado do áudio",
              body: "Evidências agora são obrigatórias nas entregas.",
              type: "simple",
              requirement: "read_confirmation",
              audience: { type: "all" },
              quiz: [],
              assumptions: [],
              gaps: []
            }
          }
        }), { status: 201 });
      }
      if (url === "/api/announcements" && init?.method === "POST") {
        return new Response(JSON.stringify({
          announcement: {
            id: "announcement_audio",
            title: "Comunicado do áudio",
            body: "Evidências agora são obrigatórias nas entregas.",
            type: "simple",
            status: "draft",
            requirement: "read_confirmation"
          }
        }), { status: 201 });
      }
      if (url === "/api/processes" && init?.method === "POST") {
        return new Response(JSON.stringify({
          process: {
            id: "process_wrong",
            title: "Processo errado",
            status: "draft",
            summary: "Não deveria criar processo."
          }
        }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Criar com IA/ }));
    fireEvent.click(screen.getByRole("button", { name: /Escrever comunicado/ }));
    fireEvent.click(screen.getByLabelText("Usar áudio no Criar com IA"));
    expect(await screen.findByRole("status", { name: "Gravação em andamento" })).toHaveTextContent("Ouvindo sua explicação");
    fireEvent.click(await screen.findByLabelText("Parar gravação no Criar com IA"));

    expect(await screen.findByDisplayValue(/Comunicar a equipe que evidências agora são obrigatórias/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Gerar rascunho/ }));

    await waitFor(() => {
      const body = JSON.parse(draftRequestBody);
      expect(body.type).toBe("announcement");
      expect(body.input_mode).toBe("audio");
      expect(fetchMock).toHaveBeenCalledWith("/api/announcements", expect.objectContaining({ method: "POST" }));
      expect(fetchMock).not.toHaveBeenCalledWith("/api/processes", expect.objectContaining({ method: "POST" }));
      expect(screen.getByRole("heading", { name: "Comunicado do áudio" })).toBeInTheDocument();
    });
  });

  it("creates an invite from the team page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/invites" && init?.method === "POST") {
        return new Response(JSON.stringify({ invite: { id: "invite_9", code: "BAASE-0009", role: "employee", status: "pending" } }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: /Equipe/ }));
    fireEvent.click(screen.getByRole("button", { name: /Convidar/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/invites", expect.objectContaining({ method: "POST" }));
      expect(screen.getAllByText(/BAASE-0009/).length).toBeGreaterThan(0);
    });
  });

  it("opens a process modal, creates published content, and edits the selected process", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/processes" && init?.method === "POST") {
        return new Response(JSON.stringify({ process: { id: "process_9", title: "Aprovação de campanhas", status: "draft", summary: "Fluxo de revisão" } }), { status: 201 });
      }
      if (url === "/api/processes/process_9/publish") {
        return new Response(JSON.stringify({ process: { id: "process_9", title: "Aprovação de campanhas", status: "published", summary: "Fluxo de revisão" } }), { status: 200 });
      }
      if (url === "/api/processes/process_9/versions") {
        return new Response(JSON.stringify({ process: { id: "process_9", title: "Aprovação de campanhas v2", status: "published", summary: "Fluxo revisado" } }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: /Processos/ }));
    fireEvent.click(screen.getByRole("button", { name: /Criar processos/ }));
    expect(await screen.findByRole("heading", { name: "Novo processo" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nome do processo"), { target: { value: "Aprovação de campanhas" } });
    fireEvent.change(screen.getByLabelText("Resumo"), { target: { value: "Fluxo de revisão" } });
    fireEvent.change(screen.getByLabelText("Manual do processo"), { target: { value: "1. Revisar brief\n2. Aprovar campanha" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar e publicar" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/process_9/publish", expect.objectContaining({ method: "POST" }));
      expect(screen.getAllByText("Aprovação de campanhas").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /Editar/ }));
    fireEvent.change(screen.getByLabelText("Nome do processo"), { target: { value: "Aprovação de campanhas v2" } });
    fireEvent.change(screen.getByLabelText("Resumo"), { target: { value: "Fluxo revisado" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/process_9/versions", expect.objectContaining({ method: "POST" }));
      expect(screen.getAllByText("Aprovação de campanhas v2").length).toBeGreaterThan(0);
    });
  });

  it("creates routine, training, and invite through full forms", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/routines" && init?.method === "POST") {
        return new Response(JSON.stringify({ routine: { id: "routine_9", title: "Abertura da operação", status: "active" } }), { status: 201 });
      }
      if (url === "/api/trainings" && init?.method === "POST") {
        return new Response(JSON.stringify({ training: { id: "training_9", title: "Atendimento premium", status: "draft", description: "Aula curta" } }), { status: 201 });
      }
      if (url === "/api/trainings/training_9/publish") {
        return new Response(JSON.stringify({ training: { id: "training_9", title: "Atendimento premium", status: "published", description: "Aula curta" } }), { status: 200 });
      }
      if (url === "/api/invites" && init?.method === "POST") {
        return new Response(JSON.stringify({ invite: { id: "invite_9", code: "BAASE-0009", role: "employee", status: "pending", accessScope: "assigned_only" } }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: /Rotinas/ }));
    fireEvent.click(screen.getByRole("button", { name: /Criar rotinas/ }));
    fireEvent.change(await screen.findByLabelText("Nome da rotina"), { target: { value: "Abertura da operação" } });
    fireEvent.change(screen.getByLabelText("Checklist item 1"), { target: { value: "Conferir agenda" } });
    fireEvent.change(screen.getByLabelText("Checklist item 2"), { target: { value: "Registrar evidência" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rotina" }));

    await waitFor(() => expect(screen.getAllByText("Abertura da operação").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("link", { name: /Treinamentos/ }));
    fireEvent.click(screen.getByRole("button", { name: /Criar treinamentos/ }));
    fireEvent.change(await screen.findByLabelText("Título do treinamento"), { target: { value: "Atendimento premium" } });
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "Aula curta" } });
    fireEvent.change(screen.getByLabelText("Pergunta do quiz"), { target: { value: "Qual é o padrão?" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar e publicar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trainings/training_9/publish", expect.objectContaining({ method: "POST" })));

    fireEvent.click(screen.getByRole("link", { name: /Equipe/ }));
    fireEvent.click(screen.getByRole("button", { name: /Convidar/ }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Bruno Costa" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bruno@estudionorte.com" } });
    fireEvent.change(screen.getByLabelText("Cargo"), { target: { value: "Designer" } });
    fireEvent.change(screen.getByLabelText("Permissão"), { target: { value: "assigned_only" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar convite" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/invites", expect.objectContaining({ method: "POST" }));
      expect(screen.getAllByText(/BAASE-0009/).length).toBeGreaterThan(0);
    });
  });

  it("uses company areas and people in the routine form and detail checklist", async () => {
    let routineRequestBody = "";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/routines" && init?.method === "POST") {
        routineRequestBody = String(init.body ?? "");
        return new Response(JSON.stringify({
          routine: {
            id: "routine_ops",
            title: "Abertura operacional",
            status: "active",
            areaId: "area_ops",
            frequency: "daily",
            weekdays: ["mon", "tue", "wed", "thu", "fri"],
            dueHint: "Até 09:00",
            assigneeProfileIds: ["person_bruno", "person_ana"],
            executionMode: "individual",
            evidencePolicy: "comment_required",
            approvalMode: "direct",
            taskTemplates: [
              { id: "task_template_1", title: "Conferir agenda", evidencePolicy: "comment_required", approvalMode: "direct" },
              { id: "task_template_2", title: "Registrar pendências", evidencePolicy: "comment_required", approvalMode: "direct" }
            ]
          }
        }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [{ id: "area_ops", name: "Operação" }, { id: "area_fin", name: "Financeiro" }] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [
          { id: "person_bruno", name: "Bruno Costa", role: "employee", areaId: "area_ops" },
          { id: "person_ana", name: "Ana Lima", role: "employee", areaId: "area_ops" }
        ] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    await screen.findByText("Marina Alves");
    fireEvent.click(screen.getByRole("link", { name: /Rotinas/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Criar rotinas/ }));

    fireEvent.change(await screen.findByLabelText("Nome da rotina"), { target: { value: "Abertura operacional" } });
    fireEvent.change(screen.getByLabelText("Área"), { target: { value: "area_ops" } });
    fireEvent.change(screen.getByLabelText("Horário limite"), { target: { value: "Até 09:00" } });
    fireEvent.click(screen.getByLabelText("Ana Lima"));
    fireEvent.change(screen.getByLabelText("Evidência"), { target: { value: "comment_required" } });
    fireEvent.change(screen.getByLabelText("Checklist item 1"), { target: { value: "Conferir agenda" } });
    fireEvent.change(screen.getByLabelText("Checklist item 2"), { target: { value: "Registrar pendências" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rotina" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/routines", expect.objectContaining({ method: "POST" }));
      expect(screen.getByRole("heading", { name: "Abertura operacional" })).toBeInTheDocument();
      expect(screen.getByText("Registrar pendências")).toBeInTheDocument();
      expect(screen.getByText(/Responsáveis: Bruno Costa, Ana Lima/)).toBeInTheDocument();
      expect(screen.getAllByText("Limite: Até 09:00").length).toBeGreaterThan(0);
    });
    expect(JSON.parse(routineRequestBody)).toMatchObject({
      area_id: "area_ops",
      frequency: "daily",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      due_hint: "Até 09:00",
      assignee_profile_ids: ["person_bruno", "person_ana"],
      execution_mode: "individual",
      evidence_policy: "comment_required",
      approval_mode: "direct",
      task_templates: expect.arrayContaining([
        expect.objectContaining({ title: "Conferir agenda" })
      ])
    });
  });

  it("opens search and notifications panels from the topbar", () => {
    render(<App apiEnabled={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.getByRole("dialog", { name: "Buscar no Baase" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ir para Processos/ }));
    expect(screen.getByRole("heading", { name: "Onboarding de cliente novo" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(screen.getByRole("dialog", { name: "Notificações" })).toBeInTheDocument();
    expect(screen.getByText("3 evidências aguardando aprovação")).toBeInTheDocument();
  });

  it("creates a new company area from Mapa da Empresa", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/areas" && init?.method === "POST") {
        return new Response(JSON.stringify({ area: { id: "area_produto", name: "Produto", description: "Gestão da experiência" } }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: /Mapa da Empresa/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Nova área/ }));
    fireEvent.change(await screen.findByLabelText("Nome da área"), { target: { value: "Produto" } });
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Gestão da experiência" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar área" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/areas", expect.objectContaining({ method: "POST" }));
      expect(screen.getByText("Produto")).toBeInTheDocument();
    });
  });

  it("renames and deletes company areas from Mapa da Empresa", async () => {
    let area = { id: "area_training", name: "Treinamentos e Capacitação do Cliente", description: "Treinos de cliente" };
    let roles = [{ id: "role_trainer", areaId: "area_training", name: "Instrutor Técnico CAD/CAM" }];
    let people: Array<{ id: string; name: string; role: string; areaId: string | null; roleTemplateId: string | null }> = [
      { id: "person_tecnico", name: "Técnico 2", role: "employee", areaId: "area_training", roleTemplateId: "role_trainer" }
    ];

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/areas/area_training" && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body));
        area = { ...area, name: payload.name, description: payload.description };
        return new Response(JSON.stringify({ area }), { status: 200 });
      }
      if (url === "/api/areas/area_training" && init?.method === "DELETE") {
        roles = [];
        people = people.map((person) => ({ ...person, areaId: null, roleTemplateId: null }));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Holand" }, profile: { id: "profile_owner", role: "owner", display_name: "Yohann Reimer", initials: "YR" }, home_route: "/painel" },
        "/api/onboarding/session": { session: onboardingSessionFixture("completed", { companyName: "Holand", normalizedSegment: "Software CAD/CAM e treinamentos" }) },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: roles.length ? [area] : [] },
        "/api/roles": { role_templates: roles },
        "/api/people": { people },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    await screen.findByText("Yohann Reimer");
    fireEvent.click(screen.getByRole("link", { name: /Mapa da Empresa/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Abrir área Treinamentos e Capacitação do Cliente/ }));
    fireEvent.click(screen.getByRole("button", { name: /Renomear área/ }));
    fireEvent.change(await screen.findByLabelText("Nome da área"), { target: { value: "Treinamentos Técnicos" } });
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Treinamentos, implantação e entregáveis técnicos." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar área" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/areas/area_training", expect.objectContaining({ method: "PATCH" }));
      expect(screen.getByRole("button", { name: /Abrir área Treinamentos Técnicos/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Abrir área Treinamentos Técnicos/ }));
    fireEvent.click(screen.getByRole("button", { name: /Excluir área/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/areas/area_training", expect.objectContaining({ method: "DELETE" }));
      expect(screen.queryByRole("button", { name: /Abrir área Treinamentos Técnicos/ })).not.toBeInTheDocument();
    });
  });

  it("deletes people and pending invites from Equipe", async () => {
    const fetchMock = mockLoadedWorkspace({
      "/api/people": {
        people: [{
          id: "person_peterson",
          name: "Peterson",
          email: "peterson@empresa.com",
          role: "employee",
          areaId: null,
          roleTemplateId: null
        }]
      },
      "/api/invites": {
        invites: [{
          id: "invite_tecnico",
          code: "BAASE-0007",
          name: "André",
          email: "andre@empresa.com",
          role: "employee",
          status: "pending"
        }]
      }
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    await screen.findByText("Yohann Reimer");
    fireEvent.click(screen.getByRole("link", { name: /Equipe/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Editar Peterson/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Excluir pessoa/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/people/person_peterson", expect.objectContaining({ method: "DELETE" }));
      expect(screen.queryByRole("button", { name: /Editar Peterson/ })).not.toBeInTheDocument();
    });

    const inviteSection = screen.getByText("Convites pendentes").closest("section");
    expect(inviteSection).not.toBeNull();
    fireEvent.click(within(inviteSection as HTMLElement).getByRole("button", { name: /Excluir/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/invites/invite_tecnico", expect.objectContaining({ method: "DELETE" }));
      expect(screen.queryByText("BAASE-0007")).not.toBeInTheDocument();
    });
  });

  it("deletes processes, routines and announcements created in the app", async () => {
    const fetchMock = mockLoadedWorkspace({
      "/api/processes": {
        processes: [{
          id: "process_entregavel",
          title: "Preparar entregável técnico",
          status: "draft",
          areaId: null,
          summary: "Manual de entrega.",
          currentVersion: {
            version: 1,
            body: "Objetivo: padronizar entregas.\n\n1. Conferir escopo.\n2. Enviar ao cliente."
          }
        }]
      },
      "/api/routines": {
        routines: [{
          id: "routine_orquestrador",
          title: "Organizar orquestrador",
          status: "active",
          areaId: null,
          taskTemplates: [{ id: "task_template_1", title: "Conferir agenda" }]
        }]
      },
      "/api/today?date=2026-07-07": {
        tasks: [],
        training_assignments: [],
        announcements: [{
          id: "announcement_mudanca",
          title: "Mudança no processo comercial",
          body: "Registrar oportunidades no sistema.",
          type: "process_change",
          status: "draft",
          requirement: "read_confirmation",
          audience: { type: "all" }
        }]
      }
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    await screen.findByText("Yohann Reimer");
    fireEvent.click(screen.getByRole("link", { name: /Processos/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Excluir/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/process_entregavel", expect.objectContaining({ method: "DELETE" }));
      expect(screen.queryByRole("heading", { name: "Preparar entregável técnico" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("link", { name: /Rotinas/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Excluir/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/routines/routine_orquestrador", expect.objectContaining({ method: "DELETE" }));
      expect(screen.queryByRole("heading", { name: "Organizar orquestrador" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("link", { name: /Comunicados/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Excluir/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/announcements/announcement_mudanca", expect.objectContaining({ method: "DELETE" }));
      expect(screen.queryByRole("heading", { name: "Mudança no processo comercial" })).not.toBeInTheDocument();
    });
  });

  it("copies the workspace invite link", () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      clipboard: { writeText }
    });

    render(<App apiEnabled={false} />);

    fireEvent.click(screen.getByRole("link", { name: /Equipe/ }));
    fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("ENORTE-4192"));
    expect(screen.getByText("Link de convite copiado.")).toBeInTheDocument();
  });

  it("selects cards in the side list instead of always showing the first process", () => {
    render(<App apiEnabled={false} />);

    fireEvent.click(screen.getByRole("link", { name: /Processos/ }));
    fireEvent.click(screen.getByRole("button", { name: /Aprovação de peças/ }));

    expect(screen.getByRole("heading", { name: "Aprovação de peças" })).toBeInTheDocument();
    expect(screen.getByText(/Fluxo de revisão interna/)).toBeInTheDocument();
  });

  it("lets the owner compare real process versions", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": {
          processes: [{
            id: "process_onboarding",
            title: "Onboarding de cliente novo",
            status: "published",
            summary: "Entrada de cliente.",
            areaId: "Atendimento",
            currentVersion: { version: 3, body: "1. Confirmar contrato\n2. Abrir kickoff" },
            versions: [
              { id: "v1", version: 1, title: "Onboarding de cliente novo", body: "1. Coletar briefing original", changeNote: "Versão inicial", editorProfileId: "profile_owner", createdAt: "2026-03-03T10:00:00.000Z" },
              { id: "v2", version: 2, title: "Onboarding de cliente novo", body: "1. Coletar briefing\n2. Criar pasta do cliente", changeNote: "Incluído checklist", editorProfileId: "profile_manager", createdAt: "2026-05-22T10:00:00.000Z" },
              { id: "v3", version: 3, title: "Onboarding de cliente novo", body: "1. Confirmar contrato\n2. Abrir kickoff", changeNote: "Aprovação dupla", editorProfileId: "profile_owner", createdAt: "2026-07-07T10:00:00.000Z" }
            ]
          }]
        },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: /Processos/ }));
    expect(await screen.findByText("Confirmar contrato")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /v1 · Versão inicial/ }));

    await waitFor(() => expect(screen.getByText("Coletar briefing original")).toBeInTheDocument());
    expect(screen.getByText(/v1 · Atendimento/)).toBeInTheDocument();
  });

  it("uses a template to create real operational content", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/templates/routine_daily_social/use" && init?.method === "POST") {
        return new Response(JSON.stringify({
          kind: "routine",
          template: { id: "routine_daily_social", title: "Abertura do dia — Social", kind: "routine" },
          routine: { id: "routine_template", title: "Abertura do dia — Social", status: "active", taskTemplates: [] }
        }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/templates": {
          templates: [{
            id: "routine_daily_social",
            title: "Abertura do dia — Social",
            description: "Checklist diário para social.",
            segment: "marketing_agency",
            area: "Operação",
            kind: "routine",
            category: "Operação",
            tag: "Diária",
            icon: "ph-sun",
            adaptPrompt: "Adapte para canais e horários."
          }],
          filters: { segments: ["marketing_agency"], areas: ["Operação"], kinds: ["process", "routine", "training"] }
        }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: /Modelos/ }));
    const routineTemplate = screen.getByText("Abertura do dia — Social").closest("article");
    expect(routineTemplate).not.toBeNull();
    fireEvent.click(within(routineTemplate as HTMLElement).getByRole("button", { name: "Usar modelo" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/templates/routine_daily_social/use", expect.objectContaining({ method: "POST" }));
      expect(screen.getByRole("heading", { name: "Abertura do dia — Social" })).toBeInTheDocument();
    });
  });

  it("filters library templates by segment, area, and type", () => {
    render(<App apiEnabled={false} />);

    fireEvent.click(screen.getByRole("link", { name: /Modelos/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Filtrar por tipo" })).getByRole("button", { name: "Treinamentos" }));
    expect(screen.getByText("Padrão de aprovação de peças")).toBeInTheDocument();
    expect(screen.queryByText("Onboarding de cliente novo")).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("group", { name: "Filtrar por segmento" })).getByRole("button", { name: "Agência de marketing" }));
    expect(screen.getByText("Como registrar evidências")).toBeInTheDocument();
    expect(screen.queryByText("Padrão de aprovação de peças")).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("group", { name: "Filtrar por área" })).getByRole("button", { name: "Atendimento" }));
    expect(screen.getByText("Nenhum modelo encontrado")).toBeInTheDocument();
  });

  it("renders template cards with stable action groups", () => {
    render(<App apiEnabled={false} />);

    fireEvent.click(screen.getByRole("link", { name: /Modelos/ }));
    const onboardingTemplate = screen.getByText("Onboarding de cliente novo").closest("article");
    expect(onboardingTemplate).not.toBeNull();

    const actions = within(onboardingTemplate as HTMLElement).getByRole("group", { name: "Ações do modelo Onboarding de cliente novo" });
    expect(within(actions).getByRole("button", { name: "Adaptar com IA" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "Usar modelo" })).toBeInTheDocument();
  });

  it("adapts a template by opening Criar com IA with a prefilled prompt", () => {
    render(<App apiEnabled={false} />);

    fireEvent.click(screen.getByRole("link", { name: /Modelos/ }));
    const salesTemplate = screen.getByText("Follow-up de proposta").closest("article");
    expect(salesTemplate).not.toBeNull();
    fireEvent.click(within(salesTemplate as HTMLElement).getByRole("button", { name: "Adaptar com IA" }));

    expect(screen.getByRole("heading", { name: "O que você quer criar?" })).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Adapte o modelo "Follow-up de proposta"/)).toBeInTheDocument();
  });

  it("creates a communication draft from the selected process change", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/announcements" && init?.method === "POST") {
        return new Response(JSON.stringify({
          announcement: {
            id: "announcement_process",
            title: "Mudança no processo: Atendimento premium",
            body: "O processo Atendimento premium foi atualizado.",
            type: "process_change",
            status: "draft",
            requirement: "read_confirmation"
          }
        }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [{ id: "process_1", title: "Atendimento premium", status: "published", summary: "Fluxo de CS" }] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: /Processos/ }));
    await screen.findByRole("heading", { name: "Atendimento premium" });
    fireEvent.click(screen.getByRole("button", { name: /Comunicar mudança/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/announcements", expect.objectContaining({ method: "POST" }));
      expect(screen.getByRole("heading", { name: "Mudança no processo: Atendimento premium" })).toBeInTheDocument();
    });
  });

  it("creates a non-process AI draft when the owner changes the creation mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/ai/drafts" && init?.method === "POST") {
        return new Response(JSON.stringify({
          draft: {
            id: "draft_ai_announcement",
            ai_run_id: "ai_announcement",
            type: "announcement",
            status: "ready_for_review",
            content: {
              title: "Comunicado gerado com IA",
              body: "Rascunho de comunicado.",
              type: "simple",
              requirement: "read_confirmation",
              audience: { type: "all" },
              quiz: [],
              assumptions: [],
              gaps: []
            }
          }
        }), { status: 201 });
      }
      if (url === "/api/announcements" && init?.method === "POST") {
        return new Response(JSON.stringify({
          announcement: {
            id: "announcement_ai",
            title: "Comunicado gerado com IA",
            body: "Rascunho de comunicado.",
            type: "simple",
            status: "draft",
            requirement: "read_confirmation"
          }
        }), { status: 201 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Criar com IA/ }));
    fireEvent.click(screen.getByRole("button", { name: /Escrever comunicado/ }));
    fireEvent.change(screen.getByLabelText("Pedido para a IA"), { target: { value: "Avisar a equipe sobre novo padrão de evidência" } });
    fireEvent.click(screen.getByRole("button", { name: /Gerar rascunho/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/ai/drafts", expect.objectContaining({ method: "POST" }));
      expect(fetchMock).toHaveBeenCalledWith("/api/announcements", expect.objectContaining({ method: "POST" }));
      expect(screen.getByRole("heading", { name: "Comunicado gerado com IA" })).toBeInTheDocument();
    });
  });

  it("renders real company map and team data from the API bundle", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [{ id: "area_design", name: "Design", description: "Criação visual" }] },
        "/api/roles": { role_templates: [{ id: "role_designer", areaId: "area_design", name: "Designer" }] },
        "/api/people": { people: [{ id: "person_luiza", name: "Luiza Melo", role: "employee", areaId: "area_design", roleTemplateId: "role_designer" }] },
        "/api/invites": { invites: [{ id: "invite_1", code: "BAASE-0001", name: "Caio Lima", role: "employee", status: "pending" }] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    await screen.findByText("Marina Alves");
    fireEvent.click(screen.getByRole("link", { name: /Mapa da Empresa/ }));
    expect(await screen.findByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Designer")).toBeInTheDocument();
    expect(screen.getByText("Luiza Melo")).toBeInTheDocument();
    expect(screen.queryByText("Designer · Luiza Melo")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Equipe/ }));
    expect(screen.getByText("Luiza Melo")).toBeInTheDocument();
    expect(screen.getByText(/BAASE-0001/)).toBeInTheDocument();
  });

  it("renders onboarding-created company hierarchy and process area labels as user-facing names", async () => {
    mockLoadedWorkspace({
      "/api/areas": {
        areas: [
          { id: "area_1", name: "Comercial e Prospecção", description: "Prospecção, propostas e fechamento comercial." },
          { id: "area_2", name: "Implantação Técnica e Treinamentos", description: "Entrega técnica, treinamentos e registros de implantação." },
          { id: "area_3", name: "Financeiro e Administrativo", description: "Contas, previsibilidade e administração operacional." },
          { id: "area_4", name: "Operação e Acompanhamento de Clientes", description: "Status de clientes, pendências e rotina de acompanhamento." }
        ]
      },
      "/api/roles": {
        role_templates: [
          { id: "role_2", areaId: "area_2", name: "Técnico Sênior CAD/CAM" },
          { id: "role_3", areaId: "area_2", name: "Técnico de Implantação e Treinamento" }
        ]
      },
      "/api/people": {
        people: [
          { id: "person_4", name: "Peterson", role: "employee", areaId: "area_2", roleTemplateId: "role_2" },
          { id: "person_5", name: "André", role: "employee", areaId: "area_2", roleTemplateId: "role_3" }
        ]
      },
      "/api/processes": {
        processes: [{
          id: "process_2",
          title: "Passagem do comercial para implantação técnica",
          status: "published",
          summary: "Garante que escopo, cliente, entregáveis e responsáveis estejam claros antes de iniciar.",
          areaId: "area_4",
          currentVersion: {
            version: 1,
            body: "1. Confirmar venda fechada. 2. Registrar softwares, módulos e entregáveis. 3. Definir técnico responsável. 4. Reunir acessos e materiais necessários. 5. Abrir rotina de acompanhamento do cliente."
          }
        }]
      }
    });

    render(<App />);

    await screen.findByText("Yohann Reimer");
    fireEvent.click(screen.getByRole("link", { name: /Mapa da Empresa/ }));

    expect(await screen.findByText("Técnico Sênior CAD/CAM")).toBeInTheDocument();
    expect(screen.getByText("Peterson")).toBeInTheDocument();
    expect(screen.getByText("Técnico de Implantação e Treinamento")).toBeInTheDocument();
    expect(screen.getByText("André")).toBeInTheDocument();
    expect(screen.queryByText("Técnico Sênior CAD/CAM · Peterson")).not.toBeInTheDocument();
    expect(screen.queryByText("Técnico de Implantação e Treinamento · André")).not.toBeInTheDocument();
    const implementationAreaCard = screen.getByRole("button", { name: /Abrir área Implantação Técnica e Treinamentos/ });
    const implementationMemberRows = implementationAreaCard.querySelectorAll(".area-member");
    expect(implementationMemberRows[0]).toHaveTextContent("Peterson");
    expect(implementationMemberRows[0]).not.toHaveTextContent("Técnico Sênior CAD/CAM");
    expect(implementationAreaCard.querySelectorAll(".area-member-role")[0]).toHaveTextContent("Técnico Sênior CAD/CAM");

    fireEvent.click(screen.getByRole("link", { name: /Processos/ }));

    expect(await screen.findByRole("heading", { name: "Passagem do comercial para implantação técnica" })).toBeInTheDocument();
    expect(screen.getAllByText("Operação e Acompanhamento de Clientes").length).toBeGreaterThan(0);
    expect(screen.queryByText("area_4")).not.toBeInTheDocument();
    expect(screen.getByText("Registrar softwares, módulos e entregáveis.")).toBeInTheDocument();
    expect(screen.getByText("Definir técnico responsável.")).toBeInTheDocument();
  });

  it("renders AI SOP content as objective, trigger and grouped step cards", async () => {
    const sopBody = [
      "Objetivo: Garantir que todo entregável seja produzido, conferido, armazenado no local correto dentro do Orquestrador e enviado ao cliente sem erro de arquivo, cliente, módulo ou versão.",
      "Gatilho: Sempre que houver uma entrega prevista para um cliente, como folha de processo, arquivo digital ou qualquer outro material contratado.",
      "",
      "1. Identificar o entregável solicitado",
      "Instrução: Verifique qual material precisa ser entregue ao cliente, confirme o nome do cliente, o tipo de entregável e o módulo contratado relacionado.",
      "Resultado esperado: Entregável validado contra o escopo comprado antes da produção.",
      "Pontos de atenção:",
      "- Cliente, módulo e tipo de entregável precisam estar corretos.",
      "Evidência: comentário obrigatório. Aprovação: execução direta.",
      "",
      "2. Validar o entregável antes do envio",
      "Instrução: Abra ou visualize o arquivo carregado no Orquestrador e confira cliente, módulo, tipo de entregável, versão e conteúdo.",
      "Resultado esperado: Arquivo final conferido e pronto para envio ao cliente.",
      "Evidência: comentário obrigatório. Aprovação: precisa de aprovação."
    ].join("\n");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/processes/process_sop/publish" && init?.method === "POST") {
        return new Response(JSON.stringify({
          process: {
            id: "process_sop",
            title: "Rascunho de SOP — Preparar, validar e enviar entregável ao cliente",
            status: "published",
            summary: "Processo gerido para criar qualquer entregável do cliente.",
            areaId: null,
            currentVersion: { version: 1, body: sopBody }
          }
        }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Holand" }, profile: { id: "profile_owner", role: "owner", display_name: "Yohann Reimer", initials: "YR" }, home_route: "/painel" },
        "/api/onboarding/session": { session: onboardingSessionFixture("completed", { companyName: "Holand", normalizedSegment: "Software CAD/CAM e treinamentos" }) },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": {
          processes: [{
            id: "process_sop",
            title: "Rascunho de SOP — Preparar, validar e enviar entregável ao cliente",
            status: "draft",
            summary: "Processo gerido para criar qualquer entregável do cliente.",
            areaId: null,
            currentVersion: { version: 1, body: sopBody }
          }]
        },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    await screen.findByText("Yohann Reimer");
    fireEvent.click(screen.getByRole("link", { name: /Processos/ }));

    expect(await screen.findByRole("heading", { name: "SOP — Preparar, validar e enviar entregável ao cliente" })).toBeInTheDocument();
    expect(screen.queryByText(/Rascunho de SOP/)).not.toBeInTheDocument();
    expect(screen.getByText("Objetivo")).toBeInTheDocument();
    expect(screen.getByText(/Garantir que todo entregável seja produzido/)).toBeInTheDocument();
    expect(screen.getByText("Gatilho")).toBeInTheDocument();
    expect(screen.getByText(/Sempre que houver uma entrega prevista/)).toBeInTheDocument();
    expect(screen.getByText("Identificar o entregável solicitado")).toBeInTheDocument();
    expect(screen.getByText(/Verifique qual material precisa ser entregue/)).toBeInTheDocument();
    expect(screen.getAllByText("Resultado esperado").length).toBeGreaterThan(0);
    expect(screen.getByText("Entregável validado contra o escopo comprado antes da produção.")).toBeInTheDocument();
    expect(screen.getByText("Cliente, módulo e tipo de entregável precisam estar corretos.")).toBeInTheDocument();
    expect(screen.queryByText("Comentário obrigatório")).not.toBeInTheDocument();
    expect(screen.queryByText("Precisa de aprovação")).not.toBeInTheDocument();
    expect(screen.queryByText("Etapa registrada no processo operacional.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Baixar PDF/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Publicar SOP/ }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/process_sop/publish", expect.objectContaining({ method: "POST" }));
      expect(screen.getAllByText("Publicado").length).toBeGreaterThan(0);
    });
  });

  it("edits an onboarding placeholder person from the team page and persists it as active", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/people/person_tecnico" && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body));
        if (payload.status !== "active") {
          return new Response(JSON.stringify({ code: "VALIDATION_ERROR" }), { status: 400 });
        }

        return new Response(JSON.stringify({
          person: {
            id: "person_tecnico",
            name: "Peterson",
            email: "peterson@empresa.com",
            role: "employee",
            areaId: "area_criacao",
            roleTemplateId: "role_designer",
            status: "active"
          }
        }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [{ id: "area_cs", name: "CS" }, { id: "area_criacao", name: "Criação" }] },
        "/api/roles": { role_templates: [{ id: "role_cs", areaId: "area_cs", name: "CS Senior" }, { id: "role_designer", areaId: "area_criacao", name: "Designer" }] },
        "/api/people": { people: [{ id: "person_tecnico", name: "Técnico 1", email: null, role: "employee", areaId: "area_cs", roleTemplateId: "role_cs", status: "placeholder" }] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    await screen.findByText("Marina Alves");
    fireEvent.click(screen.getByRole("link", { name: /Equipe/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Editar Técnico 1/ }));

    expect(screen.getByRole("heading", { name: "Editar pessoa" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Peterson" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "peterson@empresa.com" } });
    fireEvent.change(screen.getByLabelText("Área"), { target: { value: "area_criacao" } });
    fireEvent.change(screen.getByLabelText("Cargo"), { target: { value: "role_designer" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar pessoa" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/people/person_tecnico", expect.objectContaining({ method: "PATCH" }));
      const updatedRow = screen.getByRole("button", { name: /Editar Peterson/ });
      expect(within(updatedRow).getByText("Designer")).toBeInTheDocument();
      expect(within(updatedRow).getByText("Funcionário")).toBeInTheDocument();
    });
  });

  it("creates role templates and people from the company map", async () => {
    const roles: Array<{ id: string; areaId: string; name: string; description?: string | null }> = [];
    const people: Array<{ id: string; name: string; email: string | null; role: string; areaId: string | null; roleTemplateId: string | null }> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/roles" && init?.method === "POST") {
        const roleTemplate = { id: "role_cs", areaId: "area_cs", name: "CS Senior", description: "Cuida da carteira" };
        roles.splice(0, roles.length, roleTemplate);
        return new Response(JSON.stringify({ role_template: roleTemplate }), { status: 201 });
      }
      if (url === "/api/people" && init?.method === "POST") {
        const person = { id: "person_bia", name: "Bia Ramos", email: "bia@empresa.com", role: "manager", areaId: "area_cs", roleTemplateId: "role_cs" };
        people.splice(0, people.length, person);
        return new Response(JSON.stringify({ person }), { status: 201 });
      }
      if (url === "/api/roles/role_cs" && init?.method === "DELETE") {
        roles.splice(0, roles.length);
        people.splice(0, people.length, ...people.map((person) => ({ ...person, roleTemplateId: null })));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [{ id: "area_cs", name: "CS", description: "Clientes" }] },
        "/api/roles": { role_templates: roles },
        "/api/people": { people },
        "/api/invites": { invites: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    await screen.findByText("Marina Alves");
    fireEvent.click(screen.getByRole("link", { name: /Mapa da Empresa/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Novo cargo/ }));
    fireEvent.change(await screen.findByLabelText("Nome do cargo"), { target: { value: "CS Senior" } });
    fireEvent.change(screen.getByLabelText("Descrição do cargo"), { target: { value: "Cuida da carteira" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar cargo" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/roles", expect.objectContaining({ method: "POST" })));
    expect(screen.getByText("CS Senior")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Nova pessoa/ }));
    fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Bia Ramos" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bia@empresa.com" } });
    fireEvent.change(screen.getByLabelText("Papel"), { target: { value: "manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar pessoa" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/people", expect.objectContaining({ method: "POST" })));
    expect(screen.getAllByText("CS Senior").length).toBeGreaterThan(0);
    expect(screen.getByText("Bia Ramos")).toBeInTheDocument();
    expect(screen.queryByText("CS Senior · Bia Ramos")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Abrir área CS/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Excluir cargo CS Senior" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/roles/role_cs", expect.objectContaining({ method: "DELETE" }));
      expect(screen.queryByRole("button", { name: "Excluir cargo CS Senior" })).not.toBeInTheDocument();
      expect(screen.getAllByText("Bia Ramos").length).toBeGreaterThan(0);
      expect(screen.getByText("Sem cargo definido")).toBeInTheDocument();
      expect(screen.getByText("Nenhum cargo criado")).toBeInTheDocument();
    });
  });

  it("previews and accepts an invite code from the team page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/invites/BAASE-0022" && init?.method === "GET") {
        return new Response(JSON.stringify({ invite: { id: "invite_22", code: "BAASE-0022", name: "Caio Lima", email: "caio@empresa.com", role: "employee", status: "pending" } }), { status: 200 });
      }
      if (url === "/api/invites/BAASE-0022/accept" && init?.method === "POST") {
        return new Response(JSON.stringify({
          invite: { id: "invite_22", code: "BAASE-0022", name: "Caio Lima", role: "employee", status: "accepted" },
          person: { id: "person_caio", name: "Caio Lima", email: "caio@empresa.com", role: "employee", status: "active" }
        }), { status: 200 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { workspace: { id: "workspace_a", name: "Norte Ops" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    await screen.findByText("Marina Alves");
    fireEvent.click(screen.getByRole("link", { name: /Equipe/ }));
    fireEvent.change(screen.getByLabelText("Código ou link de convite"), { target: { value: "BAASE-0022" } });
    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar convite" }));

    expect(await screen.findByText("Convite para Caio Lima")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aceitar convite" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/invites/BAASE-0022/accept", expect.objectContaining({ method: "POST" }));
      expect(screen.getByText("Caio Lima")).toBeInTheDocument();
    });
  });

  it("does not leak initial demo data into a live onboarding-created workspace", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const dataByUrl: Record<string, unknown> = {
        "/api/me": {
          workspace: { id: "workspace_holand", name: "Holand" },
          profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" },
          home_route: "/painel"
        },
        "/api/onboarding/session": { session: null },
        "/api/today?date=2026-07-07": { tasks: [], training_assignments: [], announcements: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [{ id: "process_holand", title: "Registrar oportunidade comercial", status: "draft", summary: "Registrar proposta e próximo passo." }] },
        "/api/routines": { routines: [{ id: "routine_holand", title: "Revisão dos clientes em andamento", status: "active", areaId: "area_ops", taskTemplates: [] }] },
        "/api/trainings": { trainings: [{ id: "training_holand", title: "Como registrar entregáveis técnicos", status: "draft", description: "Treinamento da Holand." }] },
        "/api/areas": { areas: [{ id: "area_ops", name: "Implantação Técnica", description: "Treinamentos e entregáveis." }] },
        "/api/roles": { role_templates: [{ id: "role_ops", name: "Técnico CAD/CAM", areaId: "area_ops" }] },
        "/api/people": { people: [{ id: "person_peterson", name: "Peterson", role: "employee", areaId: "area_ops", roleTemplateId: "role_ops" }] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {
          date: "2026-07-07",
          role: "owner",
          metrics: {
            todayTotal: 0,
            todayCompleted: 0,
            executionRate: 0,
            lateTasks: 0,
            awaitingApproval: 0,
            pendingTrainingAssignments: 0,
            incompleteProcesses: 1
          },
          areaMetrics: [],
          attentionItems: []
        },
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? {}), { status: 200 });
    });

    render(<App />);

    expect(await screen.findAllByText("Holand")).not.toHaveLength(0);
    expect(screen.queryByText(/Loja Vitta/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Café Aurora/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Atendimento & CS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mídia & Tráfego/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fechamento de campanha/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Hoje/ }));
    expect(await screen.findByText(/Nenhuma tarefa para hoje/)).toBeInTheDocument();
    expect(screen.queryByText(/Publicar carrossel/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Notificações/ }));
    expect(await screen.findByText(/Sem notificações agora/)).toBeInTheDocument();
    expect(screen.queryByText(/Financeiro sem rotina publicada/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Mapa da Empresa/ }));
    expect(await screen.findByText("Implantação Técnica")).toBeInTheDocument();
    expect(screen.queryByText("Estúdio Norte")).not.toBeInTheDocument();
  });
});
