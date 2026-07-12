import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptInvite,
  approveTask,
  assignTraining,
  confirmAnnouncement,
  completeOnboardingSession,
  createArea,
  createBaaseHeaders,
  createAnnouncementDraft,
  deleteArea,
  deleteAnnouncement,
  deleteInvite,
  deletePerson,
  deleteProcess,
  deleteRoleTemplate,
  deleteRoutine,
  deleteTraining,
  createInvite,
  createOnboardingSession,
  createPerson,
  createProcessDraft,
  createProcessVersion,
  updateProcess,
  uploadProcessMaterial,
  deleteProcessMaterial,
  getProcessMaterialDownloadUrl,
  createRoutine,
  createRoleTemplate,
  createTrainingDraft,
  configureBaaseApiAuth,
  generateOnboardingDiagnosis,
  generateOnboardingSetup,
  generateAiDraft,
  generateOnboardingSuggestion,
  getOnboardingSession,
  getInviteByCode,
  loadFirstRunState,
  loadBaaseWorkspace,
  normalizeOnboardingSession,
  archiveRoutine,
  patchOnboardingSession,
  publishProcess,
  publishAnnouncement,
  publishTraining,
  saveOnboardingFollowupAnswer,
  saveOnboardingReviewDecision,
  saveOnboardingSuggestionWorkspace,
  saveReviewWorkspace,
  skipOnboardingSession,
  submitTaskExecution,
  submitTrainingQuizAttempt,
  transcribeAudioBlob,
  returnTask,
  unpublishProcess,
  unpublishTraining,
  updateArea,
  updateRoutine,
  updateTask,
  updateTaskChecklist,
  updateTraining,
  useTemplate,
  type OnboardingSuggestion
} from "./api";

const suggestionMetadata = {
  reason: "Sugerido a partir do onboarding.",
  basedOn: ["respostas do onboarding"],
  expectedImpact: "Dar clareza para a operação.",
  source: "inferred" as const,
  reviewDefault: "draft" as const
};

const activationPlan: OnboardingSuggestion["activationPlan"] = [
  { day: 1, title: "Revisar mapa", objective: "Confirmar áreas.", action: "open_company_map" },
  { day: 2, title: "Revisar processos", objective: "Ajustar processos.", action: "review_processes" },
  { day: 3, title: "Ativar rotina", objective: "Começar execução.", action: "activate_routine" },
  { day: 4, title: "Publicar treinamento", objective: "Alinhar equipe.", action: "publish_training" },
  { day: 5, title: "Convidar equipe", objective: "Trazer funcionários.", action: "invite_team" },
  { day: 6, title: "Revisar hoje", objective: "Ver primeiras execuções.", action: "review_today" },
  { day: 7, title: "Revisar painel", objective: "Ajustar gargalos.", action: "review_dashboard" }
] as const;

describe("Baase web API client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("maps UI roles to the backend local auth headers", () => {
    expect(createBaaseHeaders("dono")).toMatchObject({
      "x-baase-role": "owner",
      "x-baase-profile-id": "profile_owner"
    });
    expect(createBaaseHeaders("gestor")).toMatchObject({
      "x-baase-role": "manager",
      "x-baase-profile-id": "profile_manager"
    });
    expect(createBaaseHeaders("func")).toMatchObject({
      "x-baase-role": "employee",
      "x-baase-profile-id": "profile_employee"
    });
  });

  it("adds the Clerk bearer token to API requests when auth is configured", async () => {
    configureBaaseApiAuth({ getToken: async () => "clerk-token" });
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      const dataByUrl: Record<string, unknown> = {
        "/api/me": { profile: { role: "manager" }, workspace: { id: "workspace_a" } },
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
      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    try {
      await loadBaaseWorkspace("gestor", "2026-07-07", fetcher);
    } finally {
      configureBaaseApiAuth(null);
    }

    expect(fetcher).toHaveBeenCalled();
    const firstInit = fetcher.mock.calls[0]?.[1];
    expect(new Headers(firstInit?.headers).get("authorization")).toBe("Bearer clerk-token");
  });

  it("loads the operational workspace bundle in parallel", async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      const dataByUrl: Record<string, unknown> = {
        "/api/me": { profile: { role: "manager" }, workspace: { id: "workspace_a" } },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [{ id: "task_approval", status: "awaiting_approval" }] },
        "/api/processes": { processes: [{ id: "process_1", title: "Processo" }] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [{ id: "area_1", name: "Criação" }] },
        "/api/roles": { role_templates: [{ id: "role_1", areaId: "area_1", name: "Designer" }] },
        "/api/people": { people: [{ id: "person_1", name: "Bruno Costa", areaId: "area_1", roleTemplateId: "role_1" }] },
        "/api/invites": { invites: [{ id: "invite_1", code: "BAASE-0001", status: "pending" }] },
        "/api/templates": {
          templates: [{ id: "routine_daily_social", title: "Abertura do dia — Social", kind: "routine", area: "Operação", segment: "marketing_agency" }],
          filters: { segments: ["marketing_agency"], areas: ["Operação"], kinds: ["process", "routine", "training"] }
        },
        "/api/dashboard?date=2026-07-07": {
          date: "2026-07-07",
          role: "manager",
          metrics: {
            todayTotal: 10,
            todayCompleted: 7,
            executionRate: 70,
            awaitingApproval: 2,
            lateTasks: 1,
            pendingTrainingAssignments: 3,
            incompleteProcesses: 4
          },
          areaMetrics: [],
          attentionItems: []
        },
        "/api/ai/proactive-suggestions": {
          suggestions: [{
            id: "suggestion_1",
            signal: "area_without_routine",
            priority: "high",
            title: "Criação ainda não tem rotina ativa",
            reason: "Áreas sem rotina dependem de cobrança manual.",
            action: {
              type: "create_routine",
              label: "Criar rotina com IA",
              prompt: "Criar rotina para Criação",
              targetScreen: "rotinas"
            },
            target: { areaId: "area_1" }
          }]
        }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    const bundle = await loadBaaseWorkspace("gestor", "2026-07-07", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(13);
    expect(bundle.processes).toHaveLength(1);
    expect(bundle.dashboard?.metrics.executionRate).toBe(70);
    expect(bundle.areas).toEqual([expect.objectContaining({ name: "Criação" })]);
    expect(bundle.roleTemplates).toEqual([expect.objectContaining({ name: "Designer" })]);
    expect(bundle.people).toEqual([expect.objectContaining({ name: "Bruno Costa" })]);
    expect(bundle.invites).toEqual([expect.objectContaining({ code: "BAASE-0001" })]);
    expect(bundle.templates).toEqual([expect.objectContaining({ id: "routine_daily_social", kind: "routine" })]);
    expect(bundle.templateFilters.areas).toContain("Operação");
    expect(bundle.proactiveSuggestions).toEqual([expect.objectContaining({ signal: "area_without_routine" })]);
    expect(bundle.approvals).toHaveLength(1);
    expect(bundle.session.profile.role).toBe("manager");
  });

  it("keeps the workspace bundle when proactive suggestions are unavailable", async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "/api/ai/proactive-suggestions") {
        return new Response("Internal Server Error", { status: 500 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { profile: { role: "owner" }, workspace: { id: "workspace_a" } },
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
        "/api/dashboard?date=2026-07-07": {}
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    await expect(loadBaaseWorkspace("dono", "2026-07-07", fetcher)).resolves.toMatchObject({
      proactiveSuggestions: []
    });
  });

  it("keeps an established owner workspace available when the onboarding session read fails", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === "/api/onboarding/session") {
        return new Response("Internal Server Error", { status: 500 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { profile: { role: "owner" }, workspace: { id: "workspace_a", name: "Norte Ops" } },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [{ id: "process_1", title: "Entrega" }] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [{ id: "area_1", name: "Operações" }] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    await expect(loadFirstRunState("dono", "2026-07-07", fetcher)).resolves.toMatchObject({
      bundle: {
        areas: [{ id: "area_1", name: "Operações" }],
        processes: [{ id: "process_1", title: "Entrega" }]
      },
      onboardingSession: null,
      onboardingSessionLoadError: true
    });
  });

  it("times out and aborts a pending onboarding session read without blocking an established workspace", async () => {
    vi.useFakeTimers();
    let onboardingSignal: AbortSignal | undefined;
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/onboarding/session") {
        onboardingSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { profile: { role: "owner" }, workspace: { id: "workspace_a", name: "Norte Ops" } },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [{ id: "process_1", title: "Entrega" }] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [{ id: "area_1", name: "Operações" }] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return Promise.resolve(new Response(JSON.stringify(dataByUrl[url]), { status: 200 }));
    });

    const statePromise = loadFirstRunState("dono", "2026-07-07", fetcher);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(statePromise).resolves.toMatchObject({
      bundle: { processes: [{ id: "process_1", title: "Entrega" }] },
      onboardingSession: null,
      onboardingSessionLoadError: true
    });
    expect(onboardingSignal?.aborted).toBe(true);
  });

  it("resolves the core workspace bundle when an optional request stays pending", async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    let dashboardSignal: AbortSignal | undefined;
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/dashboard?date=2026-07-07") {
        dashboardSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { profile: { role: "owner" }, workspace: { id: "workspace_a" } },
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
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return Promise.resolve(new Response(JSON.stringify(dataByUrl[url]), { status: 200 }));
    });

    void loadBaaseWorkspace("dono", "2026-07-07", fetcher).then(settled);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ dashboard: null }));
    expect(dashboardSignal?.aborted).toBe(true);
  });

  it("rejects the bootstrap when required areas are unavailable", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === "/api/areas") {
        return new Response("Internal Server Error", { status: 500 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { profile: { role: "owner" }, workspace: { id: "workspace_a" } },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    await expect(loadBaaseWorkspace("dono", "2026-07-07", fetcher)).rejects.toThrow(
      "Baase API request failed: 500 /api/areas"
    );
  });

  it("starts and settles optional requests when an essential bootstrap request fails", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === "/api/areas" || url === "/api/trainings" || url === "/api/invites") {
        return new Response("Internal Server Error", { status: 500 });
      }

      const dataByUrl: Record<string, unknown> = {
        "/api/me": { profile: { role: "owner" }, workspace: { id: "workspace_a" } },
        "/api/today?date=2026-07-07": { tasks: [] },
        "/api/approvals": { tasks: [] },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/templates": { templates: [], filters: { segments: [], areas: [], kinds: [] } },
        "/api/dashboard?date=2026-07-07": {},
        "/api/ai/proactive-suggestions": { suggestions: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    await expect(loadBaaseWorkspace("dono", "2026-07-07", fetcher)).rejects.toThrow(
      "Baase API request failed: 500 /api/areas"
    );

    expect(fetcher).toHaveBeenCalledWith("/api/trainings", expect.anything());
    expect(fetcher).toHaveBeenCalledWith("/api/invites", expect.anything());
  });

  it("uses a library template through the backend catalog endpoint", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(JSON.stringify({
        kind: "routine",
        template: { id: "routine_daily_social", title: "Abertura do dia — Social", kind: "routine" },
        routine: { id: "routine_template", title: "Abertura do dia — Social", status: "active" }
      }), { status: 201 });
    });

    const result = await useTemplate("dono", "routine_daily_social", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/templates/routine_daily_social/use", expect.objectContaining({ method: "POST" }));
    expect(result).toMatchObject({
      kind: "routine",
      routine: { title: "Abertura do dia — Social" }
    });
  });

  it("loads training and announcement pendencies from Today", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const dataByUrl: Record<string, unknown> = {
        "/api/me": { profile: { role: "employee" }, workspace: { id: "workspace_a" } },
        "/api/today?date=2026-07-07": {
          tasks: [],
          training_assignments: [{ assignmentId: "assignment_1", trainingId: "training_1", status: "pending", training: { title: "Atendimento" } }],
          announcements: [{ id: "announcement_1", title: "Novo padrão", receipt: { status: "pending" } }]
        },
        "/api/processes": { processes: [] },
        "/api/routines": { routines: [] },
        "/api/trainings": { trainings: [] },
        "/api/areas": { areas: [] },
        "/api/roles": { role_templates: [] },
        "/api/people": { people: [] },
        "/api/invites": { invites: [] }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    const bundle = await loadBaaseWorkspace("func", "2026-07-07", fetcher);

    expect(bundle.trainingAssignments).toEqual([
      expect.objectContaining({ assignmentId: "assignment_1", status: "pending" })
    ]);
    expect(bundle.announcements).toEqual([
      expect.objectContaining({ id: "announcement_1", title: "Novo padrão" })
    ]);
  });

  it("creates company structure and accepts invite codes", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const dataByUrl: Record<string, unknown> = {
        "/api/areas": { area: { id: "area_9", name: "Produto", description: "Experiência" } },
        "/api/roles": { role_template: { id: "role_9", areaId: "area_9", name: "Product Manager" } },
        "/api/people": { person: { id: "person_9", name: "Bianca Ramos", role: "manager", areaId: "area_9", roleTemplateId: "role_9" } },
        "/api/invites/BAASE-0009": { invite: { id: "invite_9", code: "BAASE-0009", name: "Caio Lima", status: "pending" } },
        "/api/invites/BAASE-0009/accept": {
          invite: { id: "invite_9", code: "BAASE-0009", status: "accepted" },
          person: { id: "person_10", name: "Caio Lima", role: "employee", status: "active" }
        }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    const area = await createArea("dono", { name: "Produto", description: "Experiência" }, fetcher);
    const roleTemplate = await createRoleTemplate("dono", { areaId: area.id, name: "Product Manager" }, fetcher);
    const person = await createPerson("dono", {
      name: "Bianca Ramos",
      email: "bianca@empresa.com",
      role: "manager",
      areaId: area.id,
      roleTemplateId: roleTemplate.id
    }, fetcher);
    const invite = await getInviteByCode("BAASE-0009", fetcher);
    const accepted = await acceptInvite("BAASE-0009", { name: "Caio Lima" }, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/roles", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ area_id: "area_9", name: "Product Manager", description: null })
    }));
    expect(fetcher).toHaveBeenCalledWith("/api/people", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Bianca Ramos", email: "bianca@empresa.com", role: "manager", area_id: "area_9", role_template_id: "role_9" })
    }));
    expect(fetcher).toHaveBeenCalledWith("/api/invites/BAASE-0009", expect.objectContaining({ method: "GET" }));
    expect(fetcher).toHaveBeenCalledWith("/api/invites/BAASE-0009/accept", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Caio Lima", email: null })
    }));
    expect(person.name).toBe("Bianca Ramos");
    expect(invite.status).toBe("pending");
    expect(accepted.person.status).toBe("active");
  });

  it("updates and deletes company areas", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const dataByUrl: Record<string, unknown> = {
        "/api/areas/area_9": { area: { id: "area_9", name: "Treinamentos Técnicos", description: "Treinamentos e entregáveis." } }
      };

      return new Response(JSON.stringify(dataByUrl[url] ?? { ok: true }), { status: 200 });
    });

    const area = await updateArea("dono", "area_9", { name: "Treinamentos Técnicos", description: "Treinamentos e entregáveis." }, fetcher);
    await deleteArea("dono", "area_9", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/areas/area_9", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ name: "Treinamentos Técnicos", description: "Treinamentos e entregáveis." })
    }));
    expect(fetcher).toHaveBeenCalledWith("/api/areas/area_9", expect.objectContaining({ method: "DELETE" }));
    expect(area.name).toBe("Treinamentos Técnicos");
  });

  it("deletes company role templates", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await deleteRoleTemplate("dono", "role_9", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/roles/role_9", expect.objectContaining({ method: "DELETE" }));
  });

  it("deletes people and invites created in the app", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await deletePerson("dono", "person_9", fetcher);
    await deleteInvite("dono", "invite_9", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/people/person_9", expect.objectContaining({ method: "DELETE" }));
    expect(fetcher).toHaveBeenCalledWith("/api/invites/invite_9", expect.objectContaining({ method: "DELETE" }));
  });

  it("submits task execution evidence to the backend", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(JSON.stringify({ task: { id: "task_1", status: "completed" } }), { status: 200 });
    });

    const task = await submitTaskExecution("func", "task_1", { comment: "Feito." }, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/tasks/task_1/submit", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ comment: "Feito.", photo_url: null })
    }));
    expect(task.status).toBe("completed");
  });

  it("updates one-off tasks and checklist progress", async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      const dataByUrl: Record<string, unknown> = {
        "/api/tasks/task_1": { task: { id: "task_1", title: "Tarefa editada", status: "pending" } },
        "/api/tasks/task_1/checklist": { task: { id: "task_1", checklistItems: [{ title: "Validar", done: true }] } }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    await updateTask("dono", "task_1", {
      title: "Tarefa editada",
      areaId: "area_1",
      assigneeProfileId: "profile_employee",
      dueDate: "2026-07-07",
      dueHint: "Até 18:00",
      evidencePolicy: "comment_required",
      approvalMode: "direct",
      checklistItems: ["Validar"]
    }, fetcher);
    await updateTaskChecklist("func", "task_1", [{ title: "Validar", done: true }], fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/tasks/task_1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({
        title: "Tarefa editada",
        area_id: "area_1",
        assignee_profile_id: "profile_employee",
        due_date: "2026-07-07",
        due_hint: "Até 18:00",
        evidence_policy: "comment_required",
        approval_mode: "direct",
        checklist_items: ["Validar"]
      })
    }));
    expect(fetcher).toHaveBeenCalledWith("/api/tasks/task_1/checklist", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ checklist_items: [{ title: "Validar", done: true }] })
    }));
  });

  it("approves and returns tasks from the manager approval queue", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const dataByUrl: Record<string, unknown> = {
        "/api/tasks/task_1/approve": { task: { id: "task_1", status: "completed" } },
        "/api/tasks/task_2/return": { task: { id: "task_2", status: "needs_adjustment", reviewComment: "Refaça a evidência." } }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    const approved = await approveTask("gestor", "task_1", fetcher);
    const returned = await returnTask("gestor", "task_2", "Refaça a evidência.", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/tasks/task_1/approve", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenCalledWith("/api/tasks/task_2/return", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ comment: "Refaça a evidência." })
    }));
    expect(approved.status).toBe("completed");
    expect(returned.status).toBe("needs_adjustment");
  });

  it("creates and publishes core operational content", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const dataByUrl: Record<string, unknown> = {
        "/api/processes": { process: { id: "process_7", title: "Novo processo", status: "draft" } },
        "/api/processes/process_7/publish": { process: { id: "process_7", status: "published" } },
        "/api/routines": { routine: { id: "routine_7", title: "Nova rotina", status: "active" } },
        "/api/trainings": { training: { id: "training_7", title: "Novo treino", status: "draft" } },
        "/api/trainings/training_7/publish": { training: { id: "training_7", status: "published" } },
        "/api/invites": { invite: { id: "invite_7", code: "BAASE-0007", status: "pending" } }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    const process = await createProcessDraft("dono", { title: "Novo processo", body: "Passo 1", summary: "Resumo" }, fetcher);
    const publishedProcess = await publishProcess("dono", process.id, fetcher);
    const routine = await createRoutine("dono", { title: "Nova rotina", taskTitles: ["Executar checklist"] }, fetcher);
    const training = await createTrainingDraft("dono", { title: "Novo treino", description: "Aula curta" }, fetcher);
    const publishedTraining = await publishTraining("dono", training.id, fetcher);
    const invite = await createInvite("dono", { name: "Bianca Ramos", email: "bianca@estudionorte.com", role: "employee", areaId: "area_criacao" }, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/processes", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenCalledWith("/api/processes/process_7/publish", expect.objectContaining({
      method: "POST",
      headers: expect.not.objectContaining({ "content-type": "application/json" })
    }));
    expect(fetcher).toHaveBeenCalledWith("/api/routines", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenCalledWith("/api/trainings", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenCalledWith("/api/trainings/training_7/publish", expect.objectContaining({
      method: "POST",
      headers: expect.not.objectContaining({ "content-type": "application/json" })
    }));
    expect(fetcher).toHaveBeenCalledWith("/api/invites", expect.objectContaining({ method: "POST" }));
    expect(publishedProcess.status).toBe("published");
    expect(routine.status).toBe("active");
    expect(publishedTraining.status).toBe("published");
    expect(invite.code).toBe("BAASE-0007");
  });

  it("edits and unpublishes operational content through CRUD endpoints", async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      const dataByUrl: Record<string, unknown> = {
        "/api/processes/process_7/versions": { process: { id: "process_7", title: "Processo editado", status: "published" } },
        "/api/processes/process_7/unpublish": { process: { id: "process_7", status: "draft" } },
        "/api/routines/routine_7": { routine: { id: "routine_7", title: "Rotina editada", status: "active" } },
        "/api/routines/routine_7/archive": { routine: { id: "routine_7", status: "archived" } },
        "/api/trainings/training_7": { training: { id: "training_7", title: "Treino editado", status: "draft" } },
        "/api/trainings/training_7/unpublish": { training: { id: "training_7", status: "draft" } }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    await createProcessVersion("dono", "process_7", {
      title: "Processo editado",
      body: "1. Revisar. 2. Aprovar.",
      changeNote: "Atualiza etapas."
    }, fetcher);
    await unpublishProcess("dono", "process_7", fetcher);
    await updateRoutine("dono", "routine_7", {
      title: "Rotina editada",
      taskTemplates: [{ title: "Registrar evidência", assigneeProfileId: "profile_employee", dueHint: "Hoje 17:00", evidencePolicy: "photo_or_comment_required", approvalMode: "approval_required" }]
    }, fetcher);
    await archiveRoutine("dono", "routine_7", fetcher);
    await updateTraining("dono", "training_7", {
      title: "Treino editado",
      description: "Nova versão",
      materials: [{ kind: "lesson", title: "Aula", body: "Conteúdo" }],
      quizQuestions: [{ prompt: "Qual é o padrão?", options: [{ id: "a", label: "Registrar" }, { id: "b", label: "Ignorar" }], correctOptionId: "a" }]
    }, fetcher);
    await unpublishTraining("dono", "training_7", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/processes/process_7/versions", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenCalledWith("/api/processes/process_7/unpublish", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenCalledWith("/api/routines/routine_7", expect.objectContaining({ method: "PATCH" }));
    const routineCall = fetcher.mock.calls.find(([url]) => url === "/api/routines/routine_7");
    expect(JSON.parse(String(routineCall?.[1]?.body))).toMatchObject({
      task_templates: [expect.objectContaining({ title: "Registrar evidência", due_hint: "Hoje 17:00" })]
    });
    expect(fetcher).toHaveBeenCalledWith("/api/routines/routine_7/archive", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenCalledWith("/api/trainings/training_7", expect.objectContaining({ method: "PATCH" }));
    expect(fetcher).toHaveBeenCalledWith("/api/trainings/training_7/unpublish", expect.objectContaining({ method: "POST" }));
  });

  it("sends versioned process metadata and file material requests", async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "/api/processes/process_7") return new Response(JSON.stringify({ process: { id: "process_7", title: "Processo" } }), { status: 200 });
      if (url.endsWith("/download")) return new Response(JSON.stringify({ url: "https://files.example.com/signed" }), { status: 200 });
      if (url.endsWith("/materials/files")) return new Response(JSON.stringify({ material: { id: "material_1", kind: "file", title: "checklist.pdf" } }), { status: 201 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await updateProcess("dono", "process_7", {
      title: "Processo",
      body: "Corpo atualizado.",
      changeNote: "Define responsabilidade.",
      areaId: "area_financeiro",
      owner: { type: "role", roleTemplateId: "role_controller" },
      links: [{ title: "Planilha", url: "https://example.com/planilha" }]
    }, fetcher);
    await uploadProcessMaterial("dono", "process_7", new File(["arquivo"], "checklist.pdf", { type: "application/pdf" }), fetcher);
    await deleteProcessMaterial("dono", "process_7", "material_1", fetcher);
    await expect(getProcessMaterialDownloadUrl("dono", "process_7", "material_1", fetcher)).resolves.toBe("https://files.example.com/signed");

    const patchCall = fetcher.mock.calls.find(([url]) => url === "/api/processes/process_7");
    expect(patchCall?.[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      owner: { type: "role", role_template_id: "role_controller" },
      materials: [{ kind: "link", title: "Planilha" }]
    });
    const uploadCall = fetcher.mock.calls.find(([url]) => url === "/api/processes/process_7/materials/files");
    expect(uploadCall?.[1]).toMatchObject({ method: "POST" });
    expect(uploadCall?.[1]?.headers).not.toHaveProperty("content-type");
  });

  it("deletes operational content through CRUD endpoints", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await deleteProcess("dono", "process_7", fetcher);
    await deleteRoutine("dono", "routine_7", fetcher);
    await deleteTraining("dono", "training_7", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/processes/process_7", expect.objectContaining({ method: "DELETE" }));
    expect(fetcher).toHaveBeenCalledWith("/api/routines/routine_7", expect.objectContaining({ method: "DELETE" }));
    expect(fetcher).toHaveBeenCalledWith("/api/trainings/training_7", expect.objectContaining({ method: "DELETE" }));
  });

  it("assigns trainings and submits training quiz attempts", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const dataByUrl: Record<string, unknown> = {
        "/api/trainings/training_7/assignments": { assignment: { id: "assignment_7", trainingId: "training_7", dueDate: "2026-07-10" } },
        "/api/trainings/training_7/attempts": { attempt: { id: "attempt_7", score: 100, passed: true } }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    await assignTraining("dono", "training_7", { audienceType: "all", dueDate: "2026-07-10" }, fetcher);
    await submitTrainingQuizAttempt("func", "training_7", [{ questionId: "question_1", optionId: "a" }], fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/trainings/training_7/assignments", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ audience_type: "all", area_id: null, role_template_id: null, profile_id: null, due_date: "2026-07-10" })
    }));
    expect(fetcher).toHaveBeenCalledWith("/api/trainings/training_7/attempts", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ answers: [{ question_id: "question_1", option_id: "a" }] })
    }));
  });

  it("creates, publishes, and confirms announcements", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const dataByUrl: Record<string, unknown> = {
        "/api/announcements": { announcement: { id: "announcement_7", title: "Novo padrão", status: "draft" } },
        "/api/announcements/announcement_7/publish": { announcement: { id: "announcement_7", status: "published" } },
        "/api/announcements/announcement_7/confirm": { receipt: { id: "receipt_7", status: "confirmed" } }
      };

      return new Response(JSON.stringify(dataByUrl[url]), { status: 200 });
    });

    const announcement = await createAnnouncementDraft("dono", {
      title: "Novo padrão",
      body: "Confirme a mudança.",
      type: "simple",
      requirement: "read_confirmation",
      audienceType: "all"
    }, fetcher);
    await publishAnnouncement("dono", announcement.id, fetcher);
    await confirmAnnouncement("func", announcement.id, [], fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/announcements", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        title: "Novo padrão",
        body: "Confirme a mudança.",
        type: "simple",
        requirement: "read_confirmation",
        audience_type: "all",
        area_id: null,
        role_template_id: null,
        profile_id: null,
        related_process_id: null,
        related_training_id: null,
        quiz_questions: []
      })
    }));
    expect(fetcher).toHaveBeenCalledWith("/api/announcements/announcement_7/publish", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenCalledWith("/api/announcements/announcement_7/confirm", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ answers: [] })
    }));
  });

  it("deletes announcements created in the app", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await deleteAnnouncement("dono", "announcement_7", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/announcements/announcement_7", expect.objectContaining({ method: "DELETE" }));
  });

  it("saves the reviewed starter company through a complete onboarding setup", async () => {
    let setupRequestBody = "";
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      setupRequestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        setup: {
          areas: [{ id: "area_1", name: "Atendimento" }, { id: "area_2", name: "Criação" }],
          role_templates: [{ id: "role_1", areaId: "area_1", name: "Gestor de atendimento" }],
          people: [{ id: "person_1", areaId: "area_1", roleTemplateId: "role_1", name: "Marina Alves", role: "manager" }],
          processes: [{ id: "process_1", title: "Onboarding de cliente novo", status: "published" }],
          routines: [{ id: "routine_1", title: "Abertura do dia", status: "active" }],
          trainings: [{ id: "training_1", title: "Padrão de execução da área", status: "published" }]
        }
      }), { status: 201 });
    });

    const setup = await saveReviewWorkspace("dono", "Agência de marketing", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/onboarding/setup", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(setupRequestBody)).toMatchObject({
      segment: "Agência de marketing",
      areas: expect.arrayContaining([expect.objectContaining({ name: "Atendimento" })]),
      roles: expect.arrayContaining([expect.objectContaining({ name: "Gestor de atendimento" })]),
      people: expect.arrayContaining([expect.objectContaining({ name: "Marina Alves" })]),
      processes: expect.arrayContaining([expect.objectContaining({ title: "Onboarding de cliente novo" })]),
      routines: expect.arrayContaining([expect.objectContaining({ title: "Abertura do dia" })]),
      trainings: expect.arrayContaining([expect.objectContaining({ title: "Padrão de execução da área" })])
    });
    expect(setup.people).toHaveLength(1);
  });

  it("generates onboarding suggestions through the AI endpoint", async () => {
    let suggestionRequestBody = "";
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      suggestionRequestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        suggestion: {
          companyName: "Norte Ops",
          segment: "Agência de marketing",
          confidence: "high",
          assumptions: ["Equipe pequena com dono centralizando decisões."],
          gaps: [{ title: "Financeiro", reason: "Não foi citado nas respostas.", suggestedQuestion: "Quem cuida do financeiro hoje?" }],
          areas: [{ id: "area_atendimento", name: "Atendimento", description: "Relacionamento com clientes.", metadata: { ...suggestionMetadata, reviewDefault: "create" } }],
          roles: [{ id: "role_gestor_atendimento", areaName: "Atendimento", name: "Gestor de atendimento", description: "Cuida da cadência com clientes.", metadata: { ...suggestionMetadata, reviewDefault: "create" } }],
          people: [{
            id: "person_marina",
            name: "Marina Alves",
            email: "marina@empresa.com",
            role: "manager",
            areaName: "Atendimento",
            roleName: "Gestor de atendimento",
            placeholder: false,
            metadata: { ...suggestionMetadata, source: "user_provided", reviewDefault: "create" }
          }],
          processes: [{ id: "process_onboarding_cliente", title: "Onboarding de cliente novo", summary: "Entrada padronizada.", body: "1. Coletar dados.", areaName: "Atendimento", metadata: suggestionMetadata }],
          routines: [{ id: "routine_abertura_dia", title: "Abertura do dia", areaName: "Atendimento", frequency: "daily", taskTitles: ["Conferir prioridades"], metadata: suggestionMetadata }],
          trainings: [{ id: "training_atendimento", title: "Padrão de atendimento", description: "Aula curta.", materialBody: "Responda com contexto.", quizPrompt: "Qual é o padrão?", metadata: suggestionMetadata }],
          announcement: null,
          activationPlan
        },
        ai_run: { id: "ai_run_1", status: "completed" }
      }), { status: 201 });
    });

    const result = await generateOnboardingSuggestion("dono", {
      segment: "Agência de marketing",
      answers: [{
        question: "O que mais trava a empresa?",
        answer: "O dono responde tudo e não há processos claros.",
        inputMode: "audio"
      }],
      context: { workspaceName: "Norte Ops" }
    }, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/ai/onboarding/suggestions", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(suggestionRequestBody)).toMatchObject({
      segment: "Agência de marketing",
      answers: [{ question: "O que mais trava a empresa?", answer: "O dono responde tudo e não há processos claros.", input_mode: "audio" }],
      context: { workspaceName: "Norte Ops" }
    });
    expect(result.suggestion.areas[0]?.name).toBe("Atendimento");
    expect(result.ai_run.id).toBe("ai_run_1");
  });

  it("manages onboarding session API calls", async () => {
    const calls: Array<{ url: string; method: string; body: string; headers: HeadersInit | undefined }> = [];
    const session = {
      id: "onboarding_session_1",
      workspaceId: "workspace_a",
      ownerProfileId: "profile_owner",
      status: "in_progress",
      currentStep: "identity",
      companyName: "Estudio Norte",
      segment: "Outro",
      customSegment: "Agencia de conteudo",
      normalizedSegment: "Agencia de conteudo",
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
      completedAt: null
    };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? ""), headers: init?.headers });
      return new Response(JSON.stringify({ session }), {
        status: ["POST", "PATCH"].includes(init?.method ?? "GET") ? 201 : 200
      });
    });

    await getOnboardingSession("dono", fetcher);
    await createOnboardingSession("dono", "identity", fetcher);
    await patchOnboardingSession("dono", {
      currentStep: "main_questions",
      companyName: "Estudio Norte",
      customSegment: "Agencia de conteudo",
      teamSizeRange: "6-15",
      goals: ["organize_team"],
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que a empresa vende?",
        answer: "Conteudo para marcas B2B.",
        inputMode: "audio"
      }]
    }, fetcher);
    await generateOnboardingDiagnosis("dono", fetcher);
    await saveOnboardingFollowupAnswer("dono", {
      questionId: "responsaveis_area",
      question: "Quem responde pela area?",
      answer: "Marina",
      inputMode: "text"
    }, fetcher);
    await generateOnboardingSetup("dono", fetcher);
    await saveOnboardingReviewDecision("dono", {
      itemType: "process",
      itemId: "process_onboarding",
      action: "draft",
      editedPayload: { title: "Onboarding ajustado" }
    }, fetcher);
    await completeOnboardingSession("dono", fetcher);
    await skipOnboardingSession("dono", fetcher);

    expect(calls.map((call) => call.url)).toEqual([
      "/api/onboarding/session",
      "/api/onboarding/session",
      "/api/onboarding/session",
      "/api/onboarding/session/diagnosis",
      "/api/onboarding/session/followup-answer",
      "/api/onboarding/session/generate-setup",
      "/api/onboarding/session/review-decision",
      "/api/onboarding/session/complete",
      "/api/onboarding/session/skip"
    ]);
    expect(JSON.parse(calls[1]!.body)).toEqual({ current_step: "identity" });
    expect(JSON.parse(calls[2]!.body)).toMatchObject({
      current_step: "main_questions",
      company_name: "Estudio Norte",
      custom_segment: "Agencia de conteudo",
      team_size_range: "6-15",
      goals: ["organize_team"],
      main_answers: [{
        question_id: "operations_overview",
        theme: "business_model",
        question: "O que a empresa vende?",
        answer: "Conteudo para marcas B2B.",
        input_mode: "audio"
      }]
    });
    expect(JSON.parse(calls[6]!.body)).toEqual({
      item_type: "process",
      item_id: "process_onboarding",
      action: "draft",
      edited_payload: { title: "Onboarding ajustado" }
    });
    for (const index of [3, 5, 7, 8]) {
      expect(calls[index]!.headers).not.toMatchObject({ "content-type": "application/json" });
      expect(calls[index]!.body).toBe("");
    }

    expect(normalizeOnboardingSession({
      id: "onboarding_session_2",
      workspace_id: "workspace_b",
      owner_profile_id: "profile_owner",
      status: "reviewing",
      current_step: "review_map",
      company_name: "Norte Ops",
      segment: "Marketing",
      custom_segment: null,
      normalized_segment: "Agencia de marketing",
      team_size_range: "2-5",
      goals: ["standardize_delivery"],
      main_answers: [{
        question_id: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Servicos recorrentes.",
        input_mode: "text"
      }],
      attachments: [],
      diagnosis: null,
      followup_questions: [],
      followup_answers: [],
      generated_suggestion: { companyName: "Norte Ops", activationPlan: [] },
      review_decisions: [{
        item_type: "process",
        item_id: "process_onboarding",
        action: "draft",
        edited_payload: { title: "Onboarding ajustado" }
      }],
      activation_plan: [],
      created_setup_summary: { areas: 1, roles: 1, people: 1, placeholders: 0, processes: 1, routines: 1, trainings: 1, announcements: 0, invites: 0 },
      ai_run_ids: ["ai_run_1"],
      created_at: "2026-07-08T10:00:00.000Z",
      updated_at: "2026-07-08T10:01:00.000Z",
      completed_at: null
    })).toMatchObject({
      workspaceId: "workspace_b",
      currentStep: "review_map",
      mainAnswers: [{
        questionId: "operations_overview",
        inputMode: "text"
      }],
      generatedSuggestion: { companyName: "Norte Ops" },
      reviewDecisions: [{
        itemType: "process",
        itemId: "process_onboarding",
        editedPayload: { title: "Onboarding ajustado" }
      }],
      createdSetupSummary: { areas: 1 },
      aiRunIds: ["ai_run_1"]
    });
  });

  it("normalizes unfinished onboarding fields before saving", async () => {
    let requestBody = "";
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ session: {} }), { status: 200 });
    });

    await patchOnboardingSession("dono", {
      currentStep: "identity",
      companyName: "   ",
      segment: "   ",
      customSegment: "",
      normalizedSegment: "",
      teamSizeRange: "",
      goals: [],
      mainAnswers: [{
        questionId: "operations_overview",
        theme: "business_model",
        question: "O que a empresa vende?",
        answer: "   ",
        inputMode: "text"
      }]
    }, fetcher);

    expect(JSON.parse(requestBody)).toEqual({
      current_step: "identity",
      company_name: null,
      segment: null,
      custom_segment: null,
      normalized_segment: null,
      team_size_range: null,
      goals: [],
      main_answers: []
    });
  });

  it("generates structured AI drafts through the AI endpoint", async () => {
    let requestBody = "";
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        draft: {
          id: "draft_ai_run_1",
          ai_run_id: "ai_run_1",
          type: "routine",
          status: "ready_for_review",
          content: {
            title: "Abertura do dia",
            frequency: "daily",
            areaName: "Operações",
            roleName: null,
            tasks: [{
              title: "Conferir prioridades",
              dueHint: "09:00",
              evidencePolicy: "optional",
              approvalMode: "direct"
            }],
            linkedProcessTitle: null,
            assumptions: [],
            gaps: []
          }
        }
      }), { status: 201 });
    });

    const draft = await generateAiDraft("dono", {
      type: "routine",
      inputMode: "text",
      input: "Criar rotina de abertura do dia",
      context: { areaId: "area_1" }
    }, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/ai/drafts", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(requestBody)).toMatchObject({
      type: "routine",
      input_mode: "text",
      input: "Criar rotina de abertura do dia",
      context: { areaId: "area_1" }
    });
    expect(draft.content.title).toBe("Abertura do dia");
  });

  it("sends PDF/material attachments when generating AI drafts", async () => {
    let requestBody = "";
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        draft: {
          id: "draft_ai_run_pdf",
          ai_run_id: "ai_run_pdf",
          type: "training",
          status: "ready_for_review",
          content: {
            title: "Treinamento do material",
            description: "Criado a partir do PDF.",
            targetAreaName: null,
            targetRoleName: null,
            lesson: { title: "Aula curta", body: "Conteúdo extraído." },
            quiz: [{
              prompt: "Qual é o padrão?",
              options: [{ id: "a", label: "Registrar" }, { id: "b", label: "Ignorar" }],
              correctOptionId: "a",
              explanation: "O padrão precisa ser seguido."
            }],
            assumptions: [],
            gaps: []
          }
        }
      }), { status: 201 });
    });

    await generateAiDraft("dono", {
      type: "training",
      inputMode: "pdf",
      input: "Transformar material em treinamento",
      attachments: [{
        name: "manual.txt",
        mimeType: "text/plain",
        contentBase64: "bWFudWFs"
      }]
    }, fetcher);

    expect(JSON.parse(requestBody)).toMatchObject({
      type: "training",
      input_mode: "pdf",
      attachments: [{
        name: "manual.txt",
        mime_type: "text/plain",
        content_base64: "bWFudWFs"
      }]
    });
  });

  it("transcribes recorded browser audio through the AI endpoint", async () => {
    let transcriptionRequestBody = "";
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      transcriptionRequestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        transcript: {
          text: "Precisamos criar processos e rotinas para a equipe.",
          confidence: 0.94,
          duration_seconds: 6,
          words: [{ word: "Precisamos", start: 0, end: 0.5, confidence: 0.98 }]
        }
      }), { status: 201 });
    });

    const transcript = await transcribeAudioBlob("dono", {
      source: "onboarding",
      audio: new Blob(["browser-audio"], { type: "audio/webm" }),
      language: "pt-BR",
      keyterms: ["processos", "rotinas"]
    }, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/ai/transcriptions", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(transcriptionRequestBody)).toMatchObject({
      source: "onboarding",
      audio_base64: "YnJvd3Nlci1hdWRpbw==",
      mime_type: "audio/webm",
      language: "pt-BR",
      keyterms: ["processos", "rotinas"]
    });
    expect(transcript).toMatchObject({
      text: "Precisamos criar processos e rotinas para a equipe.",
      confidence: 0.94,
      durationSeconds: 6
    });
  });

  it("saves an accepted onboarding suggestion as setup payload", async () => {
    let setupRequestBody = "";
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      setupRequestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        setup: {
          areas: [{ id: "area_1", name: "Atendimento" }],
          role_templates: [{ id: "role_1", areaId: "area_1", name: "Gestor de atendimento" }],
          people: [{ id: "person_1", name: "Marina Alves", role: "manager", areaId: "area_1", roleTemplateId: "role_1" }],
          processes: [{ id: "process_1", title: "Onboarding de cliente novo", status: "published", areaId: "area_1" }],
          routines: [{ id: "routine_1", title: "Abertura do dia", status: "active", areaId: "area_1" }],
          trainings: [{ id: "training_1", title: "Padrão de atendimento", status: "published" }],
          announcements: [{ id: "announcement_1", title: "Nova base operacional", status: "draft" }]
        }
      }), { status: 201 });
    });

    const setup = await saveOnboardingSuggestionWorkspace("dono", {
      companyName: "Norte Ops",
      segment: "Agência de marketing",
      confidence: "high",
      assumptions: [],
      gaps: [],
      areas: [{ id: "area_atendimento", name: "Atendimento", description: "Relacionamento com clientes.", metadata: { ...suggestionMetadata, reviewDefault: "create" } }],
      roles: [{ id: "role_gestor_atendimento", areaName: "Atendimento", name: "Gestor de atendimento", description: "Cuida da cadência com clientes.", metadata: { ...suggestionMetadata, reviewDefault: "create" } }],
      people: [{
        id: "person_marina",
        name: "Marina Alves",
        email: null,
        role: "manager",
        areaName: "Atendimento",
        roleName: "Gestor de atendimento",
        placeholder: false,
        metadata: { ...suggestionMetadata, source: "user_provided", reviewDefault: "create" }
      }],
      processes: [{ id: "process_onboarding_cliente", title: "Onboarding de cliente novo", summary: "Entrada padronizada.", body: "1. Coletar dados.", areaName: "Atendimento", metadata: suggestionMetadata }],
      routines: [{ id: "routine_abertura_dia", title: "Abertura do dia", areaName: "Atendimento", frequency: "daily", taskTitles: ["Conferir prioridades"], metadata: suggestionMetadata }],
      trainings: [{ id: "training_atendimento", title: "Padrão de atendimento", description: "Aula curta.", materialBody: "Responda com contexto.", quizPrompt: "Qual é o padrão?", metadata: suggestionMetadata }],
      announcement: {
        id: "announcement_base",
        title: "Nova base operacional",
        body: "A empresa agora terá processos, rotinas e treinamentos centralizados no Baase.",
        metadata: suggestionMetadata
      },
      activationPlan
    }, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/onboarding/setup", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(setupRequestBody)).toMatchObject({
      segment: "Agência de marketing",
      roles: [{ area_name: "Atendimento", name: "Gestor de atendimento" }],
      people: [{ name: "Marina Alves", area_name: "Atendimento", role_name: "Gestor de atendimento" }],
      routines: [{ title: "Abertura do dia", task_titles: ["Conferir prioridades"] }],
      trainings: [{ title: "Padrão de atendimento", material_body: "Responda com contexto.", quiz_prompt: "Qual é o padrão?" }],
      announcement: {
        title: "Nova base operacional",
        body: "A empresa agora terá processos, rotinas e treinamentos centralizados no Baase."
      }
    });
    expect(setup.areas[0]?.name).toBe("Atendimento");
    expect(setup.announcements?.[0]?.status).toBe("draft");
  });
});
