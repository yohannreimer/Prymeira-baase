import { newDb } from "pg-mem";
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
  it("creates new records after deletions without reusing sparse ids", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
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
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
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
            assignee_profile_id: "profile_employee",
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
      secondApp.inject({ method: "GET", url: "/today?date=2026-07-07", headers: employeeHeaders }),
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
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
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
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
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
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
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
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
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
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
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
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
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
});
