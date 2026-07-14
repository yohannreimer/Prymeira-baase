import { DataType, newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import type { CreateOnboardingSessionInput, OnboardingSetupSuggestion } from "../modules/onboarding/onboarding.types";
import { createMockAiProvider } from "../modules/ai/providers/mock-ai.provider";
import { createPostgresRepositoryBundle, deleteWorkspaceRecords, ensurePostgresSchema } from "./postgres";

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

function createMemoryPool() {
  const db = newDb();
  db.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: () => 1
  });
  const { Pool } = db.adapters.createPg();
  return new Pool();
}

function createOnboardingSessionInput(
  overrides: Partial<CreateOnboardingSessionInput> = {}
): CreateOnboardingSessionInput {
  return {
    workspaceId: "workspace_a",
    ownerProfileId: "profile_owner",
    status: "in_progress",
    currentStep: "identity",
    companyName: "Estudio Norte",
    segment: "Outro",
    customSegment: "Agencia de conteudo",
    normalizedSegment: "Agencia de conteudo",
    teamSizeRange: "6-15",
    goals: ["extract_owner_knowledge", "organize_team"],
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

function createOnboardingSetupSuggestion(): OnboardingSetupSuggestion {
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
      description: "Organiza a entrega.",
      metadata
    }],
    people: [],
    processes: [],
    routines: [],
    trainings: [],
    announcement: null,
    activationPlan: []
  };
}

describe("Postgres repositories", () => {
  it("filters and limits JSONB operational context queries before hydrating rows", async () => {
    const pool = createMemoryPool();
    await ensurePostgresSchema(pool);
    const workspaceId = "workspace_context_bounds";
    const insert = async (kind: string, id: string, data: Record<string, unknown>, order: number) => {
      const timestamp = `2026-07-01T00:00:${String(order).padStart(2, "0")}.000Z`;
      await pool.query(
        "INSERT INTO baase_records (kind,workspace_id,id,data,created_at,updated_at) VALUES ($1,$2,$3,$4::jsonb,$5,$5)",
        [kind, workspaceId, id, JSON.stringify({ id, workspaceId, createdAt: timestamp, updatedAt: timestamp, ...data }), timestamp]
      );
    };
    await insert("area", "area_late", { name: "Primeira por ordenação", description: null, sortOrder: 1 }, 9);
    await insert("area", "area_early", { name: "Segunda", description: null, sortOrder: 2 }, 1);
    for (let index = 0; index < 5; index += 1) {
      await insert("team_member", `person_noise_${index}`, {
        name: `Ruído ${index}`, email: null, role: "employee", areaId: null, areaAccessIds: [],
        roleTemplateId: null, accessScope: "assigned_only", clerkUserId: null, customerId: null,
        status: "active", createdByProfileId: "seed"
      }, index);
      await insert("process", `process_noise_${index}`, {
        areaId: null, title: `Ruído ${index}`, summary: null, status: "published", ownerProfileId: `person_noise_${index}`,
        owner: { type: "person", personId: `person_noise_${index}` }, materials: [], currentVersion: {}, versions: [],
        createdByProfileId: "seed", publishedAt: null, archivedAt: null
      }, index);
      await insert("task_occurrence", `task_noise_${index}`, {
        routineId: null, taskTemplateId: null, title: `Ruído ${index}`, processId: null,
        assigneeProfileId: `person_noise_${index}`, approvalMode: "direct", evidencePolicy: "optional",
        status: "pending", dueDate: "2026-06-01", evidence: null, submittedByProfileId: null,
        submittedAt: null, reviewedByProfileId: null, reviewedAt: null, reviewComment: null
      }, index);
    }
    await insert("team_member", "person_target", {
      name: "Pessoa alvo", email: null, role: "employee", areaId: null, areaAccessIds: [],
      roleTemplateId: null, accessScope: "assigned_only", clerkUserId: null, customerId: null,
      status: "active", createdByProfileId: "seed"
    }, 8);
    await insert("process", "process_target", {
      areaId: null, title: "Processo alvo", summary: null, status: "published", ownerProfileId: null,
      owner: { type: "person", personId: "person_target" }, materials: [], currentVersion: {}, versions: [],
      createdByProfileId: "seed", publishedAt: null, archivedAt: null
    }, 8);
    await insert("routine", "routine_first", { areaId: null, title: "Rotina 1", status: "active", createdByProfileId: "seed", taskTemplates: [] }, 6);
    await insert("routine", "routine_second", { areaId: null, title: "Rotina 2", status: "active", createdByProfileId: "seed", taskTemplates: [] }, 7);
    await insert("task_occurrence", "task_target", {
      routineId: null, taskTemplateId: null, title: "Tarefa alvo", processId: "process_target",
      assigneeProfileId: "person_target", approvalMode: "direct", evidencePolicy: "optional",
      status: "pending", dueDate: "2026-07-10", evidence: null, submittedByProfileId: null,
      submittedAt: null, reviewedByProfileId: null, reviewedAt: null, reviewComment: null
    }, 8);
    await insert("task_occurrence", "task_completed_on_local_july_31", {
      routineId: null, taskTemplateId: null, title: "Conclusão no período local", processId: null,
      assigneeProfileId: "person_completed", approvalMode: "direct", evidencePolicy: "optional",
      status: "completed", dueDate: "2026-06-10", evidence: null, submittedByProfileId: "person_completed",
      submittedAt: "2026-08-01T01:30:00.000Z", reviewedByProfileId: "owner", reviewedAt: "2026-08-01T02:30:00.000Z",
      reviewComment: null
    }, 9);

    const bundle = createPostgresRepositoryBundle(pool);
    await expect(bundle.companyRepository.listAreas(workspaceId, { limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: "area_late", sortOrder: 1 })
    ]);
    await expect(bundle.companyRepository.listTeamMembers(workspaceId, { ids: ["person_target"], limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: "person_target" })
    ]);
    await expect(bundle.processRepository.listProcesses(workspaceId, { ownerProfileIds: ["person_target"], limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: "process_target" })
    ]);
    await expect(bundle.routineRepository.listRoutines(workspaceId, { limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: "routine_first" })
    ]);
    await expect(bundle.routineRepository.listTaskOccurrences(workspaceId, {
      assigneeProfileIds: ["person_target"], operationalFrom: "2026-07-01", operationalTo: "2026-07-31", limit: 1
    })).resolves.toEqual([expect.objectContaining({ id: "task_target" })]);
    await expect(bundle.routineRepository.listTaskOccurrences(workspaceId, {
      assigneeProfileIds: ["person_completed"], operationalFrom: "2026-07-31", operationalTo: "2026-07-31", limit: 1
    })).resolves.toEqual([expect.objectContaining({ id: "task_completed_on_local_july_31" })]);
  });

  it("creates new records after deletions without reusing sparse ids", async () => {
    const pool = createMemoryPool();
    await ensurePostgresSchema(pool);
    const app = buildApp(createPostgresRepositoryBundle(pool));

    const createdAreas = [];
    for (const name of ["QA Área 1", "QA Área 2", "QA Área 3", "QA Área 4"]) {
      const response = await app.inject({
        method: "POST",
        url: "/areas",
        headers: ownerHeaders,
        payload: { name }
      });
      expect(response.statusCode).toBe(201);
      createdAreas.push(response.json().area);
    }

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/areas/${createdAreas[2].id}`,
      headers: ownerHeaders
    });
    expect(deleteResponse.statusCode).toBe(200);

    const createAfterDeleteResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: { name: "QA Área 5" }
    });

    expect(createAfterDeleteResponse.statusCode).toBe(201);
    expect(createAfterDeleteResponse.json().area).toMatchObject({
      id: "area_5",
      name: "QA Área 5"
    });
  });

  it("persists operational data across app instances", async () => {
    const pool = createMemoryPool();
    await ensurePostgresSchema(pool);

    const firstApp = buildApp({
      ...createPostgresRepositoryBundle(pool),
      aiProvider: createMockAiProvider({
        structuredOutput: {
          title: "Responder mensagens pendentes",
          summary: "Processo para responder mensagens no início do dia.",
          objective: "Garantir retorno aos clientes.",
          trigger: "Começo do expediente",
          operationalRule: "Nenhuma conversa comercial deve ficar sem próximo passo registrado.",
          areaName: "Atendimento",
          roleName: "Atendente",
          steps: [
            {
              title: "Abrir WhatsApp Business",
              instruction: "Filtre conversas sem resposta e identifique quais precisam de retorno imediato.",
              expectedResult: "A lista de mensagens pendentes fica clara antes de responder.",
              attentionPoints: ["Não responder sem conferir histórico."]
            },
            {
              title: "Responder com próximo passo",
              instruction: "Envie uma resposta objetiva com prazo, responsável ou pergunta necessária.",
              expectedResult: "Cada conversa sai do estado de espera.",
              attentionPoints: ["Não prometer prazo sem validar."]
            },
            {
              title: "Registrar oportunidade ou pendência",
              instruction: "Quando houver valor comercial ou pendência operacional, registre no sistema correto.",
              expectedResult: "Nada importante fica somente no WhatsApp.",
              attentionPoints: []
            }
          ],
          assumptions: [],
          gaps: []
        }
      })
    });
    const areaResponse = await firstApp.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: { name: "Criação" }
    });
    const areaId = areaResponse.json().area.id;

    await firstApp.inject({
      method: "POST",
      url: "/invites",
      headers: ownerHeaders,
      payload: {
        name: "Bruno Costa",
        email: "bruno@estudionorte.com",
        role: "employee",
        area_id: areaId
      }
    });

    const processResponse = await firstApp.inject({
      method: "POST",
      url: "/processes",
      headers: ownerHeaders,
      payload: {
        title: "Aprovação de peças",
        body: "Subir peça, marcar responsável e aguardar aprovação.",
        area_id: areaId
      }
    });
    await firstApp.inject({
      method: "POST",
      url: `/processes/${processResponse.json().process.id}/publish`,
      headers: ownerHeaders
    });

    const routineResponse = await firstApp.inject({
      method: "POST",
      url: "/routines",
      headers: ownerHeaders,
      payload: {
        title: "Abertura do dia",
        area_id: areaId,
        task_templates: [
          {
            title: "Conferir prioridades",
            approval_mode: "direct",
            evidence_policy: "optional"
          }
        ]
      }
    });
    await firstApp.inject({
      method: "POST",
      url: `/routines/${routineResponse.json().routine.id}/occurrences/generate`,
      headers: ownerHeaders,
      payload: { due_date: "2026-07-07" }
    });

    const trainingResponse = await firstApp.inject({
      method: "POST",
      url: "/trainings",
      headers: ownerHeaders,
      payload: {
        title: "Padrão de aprovação",
        description: "Aula curta para criação.",
        materials: [{ kind: "lesson", title: "Aula curta", body: "Conteúdo", url: null }],
        quiz_questions: []
      }
    });
    await firstApp.inject({
      method: "POST",
      url: `/trainings/${trainingResponse.json().training.id}/publish`,
      headers: ownerHeaders
    });

    await firstApp.inject({
      method: "POST",
      url: "/ai/drafts",
      headers: ownerHeaders,
      payload: {
        type: "process",
        input_mode: "text",
        input: "Todo dia a atendente precisa responder mensagens pendentes."
      }
    });

    const secondApp = buildApp(createPostgresRepositoryBundle(pool));
    const [areas, invites, processes, routines, today, trainings, aiRuns] = await Promise.all([
      secondApp.inject({ method: "GET", url: "/areas", headers: ownerHeaders }),
      secondApp.inject({ method: "GET", url: "/invites", headers: ownerHeaders }),
      secondApp.inject({ method: "GET", url: "/processes", headers: ownerHeaders }),
      secondApp.inject({ method: "GET", url: "/routines", headers: ownerHeaders }),
      secondApp.inject({ method: "GET", url: "/today?date=2026-07-07", headers: ownerHeaders }),
      secondApp.inject({ method: "GET", url: "/trainings", headers: ownerHeaders }),
      secondApp.inject({ method: "GET", url: "/ai/runs", headers: ownerHeaders })
    ]);

    expect(areas.json().areas[0]).toMatchObject({ name: "Criação" });
    expect(invites.json().invites[0]).toMatchObject({ name: "Bruno Costa", status: "pending" });
    expect(processes.json().processes[0]).toMatchObject({ title: "Aprovação de peças", status: "published" });
    expect(routines.json().routines[0]).toMatchObject({ title: "Abertura do dia", status: "active" });
    expect(today.json().tasks[0]).toMatchObject({ title: "Conferir prioridades", status: "pending" });
    expect(trainings.json().trainings[0]).toMatchObject({ title: "Padrão de aprovação", status: "published" });
    expect(aiRuns.json().runs[0]).toMatchObject({ agentKey: "process_architect", status: "completed" });
  });

  it("resets only the selected workspace records", async () => {
    const pool = createMemoryPool();
    await ensurePostgresSchema(pool);

    const app = buildApp(createPostgresRepositoryBundle(pool));
    const otherWorkspaceHeaders = {
      ...ownerHeaders,
      "x-baase-workspace-id": "workspace_b"
    };

    const workspaceAAreaResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: { name: "Atendimento" }
    });
    const workspaceBAreaResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: otherWorkspaceHeaders,
      payload: { name: "Operações" }
    });

    await app.inject({
      method: "POST",
      url: "/processes",
      headers: ownerHeaders,
      payload: {
        title: "Responder leads",
        body: "Abrir inbox, qualificar e registrar próximo passo.",
        area_id: workspaceAAreaResponse.json().area.id
      }
    });
    await app.inject({
      method: "POST",
      url: "/processes",
      headers: otherWorkspaceHeaders,
      payload: {
        title: "Conferir produção",
        body: "Checar tarefas finalizadas e pendências críticas.",
        area_id: workspaceBAreaResponse.json().area.id
      }
    });

    await deleteWorkspaceRecords(pool, "workspace_a");

    const verificationApp = buildApp(createPostgresRepositoryBundle(pool));
    const [workspaceAAreas, workspaceAProcesses, workspaceBAreas, workspaceBProcesses] = await Promise.all([
      verificationApp.inject({ method: "GET", url: "/areas", headers: ownerHeaders }),
      verificationApp.inject({ method: "GET", url: "/processes", headers: ownerHeaders }),
      verificationApp.inject({ method: "GET", url: "/areas", headers: otherWorkspaceHeaders }),
      verificationApp.inject({ method: "GET", url: "/processes", headers: otherWorkspaceHeaders })
    ]);

    expect(workspaceAAreas.json().areas).toEqual([]);
    expect(workspaceAProcesses.json().processes).toEqual([]);
    expect(workspaceBAreas.json().areas).toEqual([
      expect.objectContaining({ name: "Operações" })
    ]);
    expect(workspaceBProcesses.json().processes).toEqual([
      expect.objectContaining({ title: "Conferir produção" })
    ]);
  });

  it("persists training assignments and announcements across app instances", async () => {
    const pool = createMemoryPool();
    await ensurePostgresSchema(pool);

    const firstApp = buildApp(createPostgresRepositoryBundle(pool));
    const trainingResponse = await firstApp.inject({
      method: "POST",
      url: "/trainings",
      headers: ownerHeaders,
      payload: {
        title: "Atendimento em 15 minutos",
        materials: [{ kind: "lesson", title: "Aula curta", body: "Responda rápido." }],
        quiz_questions: [
          {
            prompt: "Qual é o prazo?",
            options: [
              { id: "a", label: "15 minutos" },
              { id: "b", label: "2 dias" }
            ],
            correct_option_id: "a"
          }
        ]
      }
    });
    const trainingId = trainingResponse.json().training.id;
    await firstApp.inject({ method: "POST", url: `/trainings/${trainingId}/publish`, headers: ownerHeaders });
    await firstApp.inject({
      method: "POST",
      url: `/trainings/${trainingId}/assignments`,
      headers: ownerHeaders,
      payload: { audience_type: "all", due_date: "2026-07-10" }
    });

    const announcementResponse = await firstApp.inject({
      method: "POST",
      url: "/announcements",
      headers: ownerHeaders,
      payload: {
        title: "Novo padrão de atendimento",
        body: "Confirme que entendeu o prazo.",
        type: "simple",
        requirement: "read_confirmation",
        audience_type: "all"
      }
    });
    const announcementId = announcementResponse.json().announcement.id;
    await firstApp.inject({ method: "POST", url: `/announcements/${announcementId}/publish`, headers: ownerHeaders });

    const secondApp = buildApp(createPostgresRepositoryBundle(pool));
    const todayResponse = await secondApp.inject({
      method: "GET",
      url: "/today?date=2026-07-07",
      headers: employeeHeaders
    });

    expect(todayResponse.statusCode).toBe(200);
    expect(todayResponse.json()).toMatchObject({
      training_assignments: [
        expect.objectContaining({
          trainingId,
          status: "pending",
          training: expect.objectContaining({ title: "Atendimento em 15 minutos" })
        })
      ],
      announcements: [
        expect.objectContaining({
          id: announcementId,
          title: "Novo padrão de atendimento",
          receipt: expect.objectContaining({ status: "pending" })
        })
      ]
    });
  });

  it("persists onboarding sessions across repository instances", async () => {
    const pool = createMemoryPool();
    await ensurePostgresSchema(pool);

    const firstBundle = createPostgresRepositoryBundle(pool);
    const olderSession = await firstBundle.onboardingRepository.createSession(createOnboardingSessionInput({
      companyName: "Estudio Sul"
    }));
    const newerSession = await firstBundle.onboardingRepository.createSession(createOnboardingSessionInput({
      companyName: "Estudio Norte"
    }));
    const tiedTimestamp = "2026-07-08T12:00:00.000Z";
    for (const session of [olderSession, newerSession]) {
      await pool.query(
      `
        UPDATE baase_records
        SET data = $1::jsonb,
          created_at = $2,
          updated_at = $2
        WHERE kind = $3 AND workspace_id = $4 AND id = $5
      `,
      [
        JSON.stringify({ ...session, createdAt: tiedTimestamp, updatedAt: tiedTimestamp }),
        tiedTimestamp,
        "onboarding_session",
        "workspace_a",
        session.id
      ]
      );
    }

    const secondBundle = createPostgresRepositoryBundle(pool);
    await expect(secondBundle.onboardingRepository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      id: newerSession.id,
      companyName: "Estudio Norte"
    });
    expect(Number(newerSession.id.split("_").at(-1))).toBeGreaterThan(Number(olderSession.id.split("_").at(-1)));
  });

  it("advances onboarding session updatedAt when the system clock is tied or regresses", async () => {
    const pool = createMemoryPool();
    await ensurePostgresSchema(pool);

    const bundle = createPostgresRepositoryBundle(pool);
    const created = await bundle.onboardingRepository.createSession(createOnboardingSessionInput());
    const persistedUpdatedAt = "2999-01-01T00:00:00.000Z";
    await pool.query(
      `
        UPDATE baase_records
        SET data = $1::jsonb,
          updated_at = $2
        WHERE kind = $3 AND workspace_id = $4 AND id = $5
      `,
      [
        JSON.stringify({ ...created, updatedAt: persistedUpdatedAt }),
        persistedUpdatedAt,
        "onboarding_session",
        "workspace_a",
        created.id
      ]
    );

    const current = await bundle.onboardingRepository.findSession("workspace_a", created.id);
    if (!current) throw new Error("ONBOARDING_TEST_SESSION_NOT_FOUND");

    const updated = await bundle.onboardingRepository.updateSession({
      ...current,
      companyName: "Regressed Clock"
    });

    expect(updated.updatedAt).toBe("2999-01-01T00:00:00.001Z");
    await expect(bundle.onboardingRepository.findSession("workspace_a", created.id)).resolves.toMatchObject({
      companyName: "Regressed Clock",
      updatedAt: "2999-01-01T00:00:00.001Z"
    });
  });

  it("atomically claims onboarding completion across repository instances", async () => {
    const pool = createMemoryPool();
    await ensurePostgresSchema(pool);

    const firstBundle = createPostgresRepositoryBundle(pool);
    const created = await firstBundle.onboardingRepository.createSession(createOnboardingSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createOnboardingSetupSuggestion()
    }));
    const secondBundle = createPostgresRepositoryBundle(pool);

    const firstClaim = await firstBundle.onboardingRepository.claimCompletion("workspace_a", created.id);
    const secondClaim = await secondBundle.onboardingRepository.claimCompletion("workspace_a", created.id);

    expect(firstClaim).toMatchObject({
      id: created.id,
      status: "completing",
      currentStep: "completing"
    });
    expect(secondClaim).toBeNull();
    await expect(secondBundle.onboardingRepository.findSession("workspace_a", created.id)).resolves.toMatchObject({
      status: "completing",
      currentStep: "completing"
    });
  });

  it("rejects stale onboarding session updates after a completion claim", async () => {
    const pool = createMemoryPool();
    await ensurePostgresSchema(pool);

    const firstBundle = createPostgresRepositoryBundle(pool);
    const staleSession = await firstBundle.onboardingRepository.createSession(createOnboardingSessionInput({
      status: "reviewing",
      currentStep: "review_map",
      generatedSuggestion: createOnboardingSetupSuggestion()
    }));
    const secondBundle = createPostgresRepositoryBundle(pool);

    const claimed = await firstBundle.onboardingRepository.claimCompletion("workspace_a", staleSession.id);
    await expect(secondBundle.onboardingRepository.updateSession({
      ...staleSession,
      companyName: "Late patch"
    })).rejects.toThrow("ONBOARDING_SESSION_STALE");

    expect(claimed).toMatchObject({ status: "completing", currentStep: "completing" });
    await expect(secondBundle.onboardingRepository.findSession("workspace_a", staleSession.id)).resolves.toMatchObject({
      status: "completing",
      currentStep: "completing",
      companyName: staleSession.companyName
    });
  });

  it("scopes private owner studio AI runs in PostgreSQL reads and updates", async () => {
    const pool = createMemoryPool();
    await ensurePostgresSchema(pool);
    const repository = createPostgresRepositoryBundle(pool).aiRepository;
    const createPrivate = (actorProfileId: string) => repository.createRun({
      workspaceId: "workspace_a",
      actorProfileId,
      source: "owner_studio",
      inputMode: "text",
      taskKind: "studio_assist",
      agentKey: "owner_studio_companion",
      promptVersion: "agent/owner-studio-companion@1",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      status: "running",
      traceId: null,
      inputSummary: "[private owner studio input]",
      outputSummary: null,
      validationErrors: [],
      costEstimateCents: null,
      latencyMs: null
    });
    const first = await createPrivate("owner_a");
    const second = await createPrivate("owner_b");

    await expect(repository.listRuns("workspace_a", "owner_a")).resolves.toEqual([first]);
    await expect(repository.listRuns("workspace_a", "owner_b")).resolves.toEqual([second]);
    await expect(repository.listRuns("workspace_a")).resolves.toEqual([]);
    await expect(repository.findRun("workspace_a", first.id, "owner_b")).resolves.toBeNull();
    await expect(repository.updateRun({ ...first, actorProfileId: "owner_b" }))
      .rejects.toThrow("AI_RUN_NOT_FOUND");
    await expect(repository.findRun("workspace_a", first.id, "owner_a")).resolves.toEqual(first);
  });
});
