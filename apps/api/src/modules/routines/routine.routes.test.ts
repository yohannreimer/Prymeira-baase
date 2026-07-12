import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import type { BaaseRuntimeConfig } from "../../config/runtime";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";
import { createInMemoryRoutineRepository } from "./in-memory-routine.repository";

const managerHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "manager",
  "x-baase-profile-id": "profile_manager"
};

const employeeHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "employee",
  "x-baase-profile-id": "profile_employee"
};

const accountBearer = (subject: string) => `Bearer header.${Buffer.from(JSON.stringify({ sub: subject })).toString("base64url")}.signature`;

const operationalRuntimeConfig: BaaseRuntimeConfig = {
  mode: "production",
  auth: { mode: "account", accountApiUrl: "https://hub.prymeiradigital.com.br/api" },
  persistence: "postgres",
  operationalStore: "jsonb",
  demoSeedEnabled: false,
  ai: { structured: "openai", transcription: "deepgram" },
  objectStorage: { provider: "memory", s3: null },
  ok: true,
  warnings: []
};

async function buildOperationalAccessApp() {
  const companyRepository = createInMemoryCompanyRepository();
  const members = [
    { id: "profile_owner", name: "Owner", email: "owner@example.com", role: "owner" as const, areaId: null, areaAccessIds: [], accessScope: "workspace" as const },
    { id: "profile_peterson", name: "Peterson", email: "peterson@example.com", role: "employee" as const, areaId: "area_tecnica", areaAccessIds: [], accessScope: "assigned_only" as const },
    { id: "profile_andre", name: "Andre", email: "andre@example.com", role: "employee" as const, areaId: "area_tecnica", areaAccessIds: [], accessScope: "assigned_only" as const },
    { id: "profile_financeiro", name: "Financeiro", email: "financeiro@example.com", role: "employee" as const, areaId: "area_financeiro", areaAccessIds: [], accessScope: "assigned_only" as const },
    { id: "profile_gestor_tecnico", name: "Gestor Tecnico", email: "gestor.tecnico@example.com", role: "manager" as const, areaId: "area_tecnica", areaAccessIds: ["area_tecnica"], accessScope: "area" as const },
    { id: "profile_gestor_financeiro", name: "Gestor Financeiro", email: "gestor.financeiro@example.com", role: "manager" as const, areaId: "area_financeiro", areaAccessIds: ["area_financeiro"], accessScope: "area" as const }
  ];

  const personIdByProfile = new Map<string, string>();
  for (const member of members) {
    const person = await companyRepository.createTeamMember({
      workspaceId: "workspace_a",
      name: member.name,
      email: member.email,
      role: member.role,
      areaId: member.areaId,
      areaAccessIds: member.areaAccessIds,
      accessScope: member.accessScope,
      roleTemplateId: null,
      clerkUserId: member.id,
      customerId: `customer_${member.id}`,
      createdByProfileId: "profile_owner"
    });
    personIdByProfile.set(member.id, person.id);
  }

  const app = buildApp({
    companyRepository,
    routineRepository: createInMemoryRoutineRepository(),
    runtimeConfig: operationalRuntimeConfig,
    accountAccessFetch: async (input, init) => {
      const authorization = new Headers(init?.headers).get("authorization")!;
      const token = authorization.slice("Bearer ".length);
      const [, payload] = token.split(".");
      const subject = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")).sub as string;
      const member = members.find((candidate) => candidate.id === subject)!;

      if (String(input).endsWith("/me/products")) {
        return new Response(JSON.stringify({ customer: { email: member.email, name: member.name } }), { status: 200 });
      }

      return new Response(JSON.stringify({
        allowed: true,
        workspace_id: "workspace_a",
        workspace_name: "Workspace A",
        workspace_role: member.role,
        product_key: "base",
        product_role: member.role,
        customer_id: `customer_${member.id}`,
        customer_name: member.name,
        status: "active",
        reason: "active_entitlement"
      }), { status: 200 });
    }
  });

  return {
    app,
    headersFor: (profileId: string) => ({ authorization: accountBearer(profileId) }),
    personIdFor: (profileId: string) => personIdByProfile.get(profileId)!
  };
}

describe("routine routes", () => {
  it("isolates individual technical routine tasks by assignee and operational area", async () => {
    const { app, headersFor, personIdFor } = await buildOperationalAccessApp();
    const ownerHeaders = headersFor("profile_owner");
    const ownerId = personIdFor("profile_owner");
    const petersonId = personIdFor("profile_peterson");
    const andreId = personIdFor("profile_andre");
    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: ownerHeaders,
      payload: {
        title: "Inspecao tecnica",
        area_id: "area_tecnica",
        frequency: "daily",
        assignee_profile_ids: [petersonId, andreId],
        execution_mode: "individual",
        task_templates: [{ title: "Executar inspecao" }]
      }
    });

    expect(routineResponse.statusCode).toBe(201);

    const financeToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: headersFor("profile_financeiro")
    });
    const petersonToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: headersFor("profile_peterson")
    });
    const andreToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: headersFor("profile_andre")
    });
    const ownerToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: ownerHeaders
    });

    expect(financeToday.json().tasks).toEqual([]);
    expect(petersonToday.json().tasks).toHaveLength(1);
    expect(petersonToday.json().tasks[0]).toMatchObject({ assigneeProfileId: petersonId });
    expect(andreToday.json().tasks).toHaveLength(1);
    expect(andreToday.json().tasks[0]).toMatchObject({ assigneeProfileId: andreId });
    expect(ownerToday.json().tasks).toHaveLength(2);
    expect(ownerToday.json().tasks.map((task: { assigneeProfileId: string | null }) => task.assigneeProfileId))
      .toEqual([petersonId, andreId]);
    expect(ownerToday.json().tasks.map((task: { assigneeProfileId: string | null }) => task.assigneeProfileId))
      .not.toContain(ownerId);
  });

  it("forbids a Financeiro employee from changing or submitting a technical task by ID", async () => {
    const { app, headersFor, personIdFor } = await buildOperationalAccessApp();
    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: headersFor("profile_owner"),
      payload: {
        title: "Inspecao tecnica",
        area_id: "area_tecnica",
        frequency: "daily",
        assignee_profile_ids: [personIdFor("profile_peterson")],
        execution_mode: "individual",
        task_templates: [{ title: "Executar inspecao" }]
      }
    });
    const generated = await app.inject({
      method: "POST",
      url: `/routines/${routineResponse.json().routine.id}/occurrences/generate`,
      headers: headersFor("profile_owner"),
      payload: { due_date: "2026-07-08" }
    });
    const taskId = generated.json().tasks[0].id;

    const checklistResponse = await app.inject({
      method: "PATCH",
      url: `/tasks/${taskId}/checklist`,
      headers: headersFor("profile_financeiro"),
      payload: { checklist_items: [{ title: "Executar inspecao", done: true }] }
    });
    const submitResponse = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/submit`,
      headers: headersFor("profile_financeiro"),
      payload: {}
    });

    expect(checklistResponse.statusCode).toBe(403);
    expect(submitResponse.statusCode).toBe(403);
  });

  it("keeps manager, shared, and manual task access inside the task area policy", async () => {
    const { app, headersFor, personIdFor } = await buildOperationalAccessApp();
    const ownerHeaders = headersFor("profile_owner");
    const petersonId = personIdFor("profile_peterson");
    const individualRoutine = await app.inject({
      method: "POST",
      url: "/routines",
      headers: ownerHeaders,
      payload: {
        title: "Rotina individual tecnica",
        area_id: "area_tecnica",
        frequency: "daily",
        assignee_profile_ids: [petersonId],
        execution_mode: "individual",
        task_templates: [{ title: "Executar rotina individual" }]
      }
    });
    const individualTasks = await app.inject({
      method: "POST",
      url: `/routines/${individualRoutine.json().routine.id}/occurrences/generate`,
      headers: ownerHeaders,
      payload: { due_date: "2026-07-08" }
    });
    const individualTaskId = individualTasks.json().tasks[0].id;

    const technicalManagerToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: headersFor("profile_gestor_tecnico")
    });
    const financeManagerToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: headersFor("profile_gestor_financeiro")
    });
    const individualManagerChecklist = await app.inject({
      method: "PATCH",
      url: `/tasks/${individualTaskId}/checklist`,
      headers: headersFor("profile_gestor_tecnico"),
      payload: { checklist_items: [{ title: "Executar rotina individual", done: true }] }
    });

    expect(technicalManagerToday.json().tasks).toEqual([
      expect.objectContaining({ id: individualTaskId })
    ]);
    expect(financeManagerToday.json().tasks).toEqual([]);
    expect(individualManagerChecklist.statusCode).toBe(403);
    expect(individualManagerChecklist.json().error.code).toBe("TASK_NOT_ASSIGNED_TO_PROFILE");

    const sharedRoutine = await app.inject({
      method: "POST",
      url: "/routines",
      headers: ownerHeaders,
      payload: {
        title: "Rotina compartilhada tecnica",
        area_id: "area_tecnica",
        frequency: "daily",
        execution_mode: "shared",
        task_templates: [{ title: "Executar rotina compartilhada" }]
      }
    });
    const sharedTasks = await app.inject({
      method: "POST",
      url: `/routines/${sharedRoutine.json().routine.id}/occurrences/generate`,
      headers: ownerHeaders,
      payload: { due_date: "2026-07-08" }
    });
    const sharedTaskId = sharedTasks.json().tasks[0].id;
    const sharedTechnicalManagerToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: headersFor("profile_gestor_tecnico")
    });
    const sharedFinanceManagerToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: headersFor("profile_gestor_financeiro")
    });
    const sharedTechnicalManagerChecklist = await app.inject({
      method: "PATCH",
      url: `/tasks/${sharedTaskId}/checklist`,
      headers: headersFor("profile_gestor_tecnico"),
      payload: { checklist_items: [{ title: "Executar rotina compartilhada", done: true }] }
    });
    const sharedFinanceManagerChecklist = await app.inject({
      method: "PATCH",
      url: `/tasks/${sharedTaskId}/checklist`,
      headers: headersFor("profile_gestor_financeiro"),
      payload: { checklist_items: [{ title: "Executar rotina compartilhada", done: true }] }
    });

    expect(sharedTechnicalManagerChecklist.statusCode).toBe(200);
    expect(sharedFinanceManagerChecklist.statusCode).toBe(403);
    expect(sharedTechnicalManagerToday.json().tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sharedTaskId, assigneeProfileId: null })
    ]));
    expect(sharedFinanceManagerToday.json().tasks).toEqual([]);

    const manualTask = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: ownerHeaders,
      payload: {
        title: "Tarefa pontual tecnica",
        area_id: "area_tecnica",
        assignee_profile_id: petersonId,
        due_date: "2026-07-09"
      }
    });
    const petersonManualToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-09",
      headers: headersFor("profile_peterson")
    });
    const andreManualToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-09",
      headers: headersFor("profile_andre")
    });

    expect(petersonManualToday.json().tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: manualTask.json().task.id })
    ]));
    expect(andreManualToday.json().tasks).toEqual([]);

    const manualTaskId = manualTask.json().task.id;
    const financeManualUpdate = await app.inject({
      method: "PATCH",
      url: `/tasks/${manualTaskId}`,
      headers: headersFor("profile_gestor_financeiro"),
      payload: {
        title: "Tarefa pontual tecnica alterada",
        area_id: "area_tecnica",
        assignee_profile_id: petersonId,
        due_date: "2026-07-09"
      }
    });
    const financeManualDelete = await app.inject({
      method: "DELETE",
      url: `/tasks/${manualTaskId}`,
      headers: headersFor("profile_gestor_financeiro")
    });

    expect(financeManualUpdate.statusCode).toBe(403);
    expect(financeManualUpdate.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
    expect(financeManualDelete.statusCode).toBe(403);
    expect(financeManualDelete.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
  });

  it("blocks cross-area managers from approving or returning technical tasks by ID", async () => {
    const { app, headersFor, personIdFor } = await buildOperationalAccessApp();
    const ownerHeaders = headersFor("profile_owner");
    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: ownerHeaders,
      payload: {
        title: "Revisao tecnica",
        area_id: "area_tecnica",
        task_templates: [
          { title: "Aprovar ambiente", assignee_profile_id: personIdFor("profile_peterson"), approval_mode: "approval_required" },
          { title: "Retornar ambiente", assignee_profile_id: personIdFor("profile_peterson"), approval_mode: "approval_required" }
        ]
      }
    });
    const generated = await app.inject({
      method: "POST",
      url: `/routines/${routineResponse.json().routine.id}/occurrences/generate`,
      headers: ownerHeaders,
      payload: { due_date: "2026-07-08" }
    });

    for (const task of generated.json().tasks) {
      const submitted = await app.inject({
        method: "POST",
        url: `/tasks/${task.id}/submit`,
        headers: headersFor("profile_peterson"),
        payload: {}
      });
      expect(submitted.statusCode).toBe(200);
    }

    const financeReturn = await app.inject({
      method: "POST",
      url: `/tasks/${generated.json().tasks[0].id}/return`,
      headers: headersFor("profile_gestor_financeiro"),
      payload: { comment: "Fora da area" }
    });
    const financeApprove = await app.inject({
      method: "POST",
      url: `/tasks/${generated.json().tasks[1].id}/approve`,
      headers: headersFor("profile_gestor_financeiro")
    });

    expect(financeReturn.statusCode).toBe(403);
    expect(financeReturn.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
    expect(financeApprove.statusCode).toBe(403);
    expect(financeApprove.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
  });

  it("returns 409 when a routine aggregate changes during update", async () => {
    const base = createInMemoryRoutineRepository();
    const app = buildApp({
      routineRepository: {
        ...base,
        updateRoutine: async () => { throw new Error("ROUTINE_STALE"); }
      }
    });
    const created = await app.inject({
      method: "POST",
      url: "/routines",
      headers: managerHeaders,
      payload: { title: "Original", task_templates: [{ title: "Executar" }] }
    });
    const routine = created.json().routine;
    const response = await app.inject({
      method: "PATCH",
      url: `/routines/${routine.id}`,
      headers: managerHeaders,
      payload: {
        title: "Atualizada",
        task_templates: routine.taskTemplates.map((step: { id: string; title: string }) => ({
          id: step.id,
          title: step.title
        }))
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ROUTINE_STALE");
  });

  it.each([undefined, [], ["mon", "tue"]])(
    "returns a deterministic 400 for an invalid weekly weekday selection: %j",
    async (weekdays) => {
      const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });
      const response = await app.inject({
        method: "POST",
        url: "/routines",
        headers: managerHeaders,
        payload: {
          title: "Semanal",
          frequency: "weekly",
          ...(weekdays === undefined ? {} : { weekdays }),
          task_templates: [{ title: "Executar" }]
        }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("ROUTINE_WEEKLY_WEEKDAY_INVALID");
    }
  );

  it("returns the same weekly validation error on routine update", async () => {
    const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });
    const created = await app.inject({
      method: "POST",
      url: "/routines",
      headers: managerHeaders,
      payload: { title: "Diaria", task_templates: [{ title: "Executar" }] }
    });
    const response = await app.inject({
      method: "PATCH",
      url: `/routines/${created.json().routine.id}`,
      headers: managerHeaders,
      payload: {
        title: "Semanal invalida",
        frequency: "weekly",
        task_templates: created.json().routine.taskTemplates.map((step: { id: string; title: string }) => ({
          id: step.id,
          title: step.title
        }))
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ROUTINE_WEEKLY_WEEKDAY_INVALID");
  });

  it("runs the manager-to-employee execution flow", async () => {
    const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });

    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: managerHeaders,
      payload: {
        title: "Abertura da loja",
        area_id: "area_operacao",
        task_templates: [
          {
            title: "Fotografar recepção pronta",
            assignee_profile_id: "profile_employee",
            evidence_policy: "photo_or_comment_required",
            approval_mode: "direct"
          }
        ]
      }
    });

    expect(routineResponse.statusCode).toBe(201);
    const routineId = routineResponse.json().routine.id;

    const generationResponse = await app.inject({
      method: "POST",
      url: `/routines/${routineId}/occurrences/generate`,
      headers: managerHeaders,
      payload: {
        due_date: "2026-07-07"
      }
    });

    expect(generationResponse.statusCode).toBe(201);
    expect(generationResponse.json().tasks).toHaveLength(1);

    const todayResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-07",
      headers: employeeHeaders
    });

    expect(todayResponse.statusCode).toBe(200);
    expect(todayResponse.json().tasks[0]).toMatchObject({
      title: "Fotografar recepção pronta",
      status: "pending"
    });

    const taskId = todayResponse.json().tasks[0].id;
    const submitResponse = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/submit`,
      headers: employeeHeaders,
      payload: {
        comment: "Recepção pronta para abertura."
      }
    });

    expect(submitResponse.statusCode).toBe(200);
    expect(submitResponse.json().task.status).toBe("completed");
  });

  it("rejects routine creation for employees", async () => {
    const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });

    const response = await app.inject({
      method: "POST",
      url: "/routines",
      headers: employeeHeaders,
      payload: {
        title: "Rotina indevida",
        task_templates: [
          {
            title: "Tarefa"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it("creates individual recurring routine executions for each responsible person", async () => {
    const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });

    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: managerHeaders,
      payload: {
        title: "Organizar orquestrador",
        area_id: "area_tecnica",
        frequency: "daily",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        due_hint: "Até 09:00",
        assignee_profile_ids: ["profile_employee", "profile_manager"],
        execution_mode: "individual",
        evidence_policy: "optional",
        approval_mode: "direct",
        task_templates: [
          { title: "Atualizar demandas de ontem" },
          { title: "Planejar demandas de hoje" }
        ]
      }
    });

    expect(routineResponse.statusCode).toBe(201);
    expect(routineResponse.json().routine).toMatchObject({
      title: "Organizar orquestrador",
      areaId: "area_tecnica",
      frequency: "daily",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      dueHint: "Até 09:00",
      assigneeProfileIds: ["profile_employee", "profile_manager"],
      executionMode: "individual"
    });

    const routineId = routineResponse.json().routine.id;
    const generationResponse = await app.inject({
      method: "POST",
      url: `/routines/${routineId}/occurrences/generate`,
      headers: managerHeaders,
      payload: { due_date: "2026-07-08" }
    });

    expect(generationResponse.statusCode).toBe(201);
    expect(generationResponse.json().tasks).toHaveLength(2);

    const todayResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: employeeHeaders
    });

    expect(todayResponse.statusCode).toBe(200);
    expect(todayResponse.json().tasks).toHaveLength(1);
    expect(todayResponse.json().tasks[0]).toMatchObject({
      title: "Organizar orquestrador",
      dueHint: "Até 09:00",
      assigneeProfileId: "profile_employee",
      checklistItems: [
        { title: "Atualizar demandas de ontem", done: false },
        { title: "Planejar demandas de hoje", done: false }
      ]
    });
  });

  it("generates active routine occurrences when the employee opens today", async () => {
    const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });

    await app.inject({
      method: "POST",
      url: "/routines",
      headers: managerHeaders,
      payload: {
        title: "Atualizar orquestrador",
        area_id: "area_financeiro",
        frequency: "daily",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        due_hint: "Até 09:00",
        assignee_profile_ids: ["profile_employee"],
        execution_mode: "individual",
        task_templates: [
          { title: "Conferir dia anterior" },
          { title: "Planejar compromissos do dia" }
        ]
      }
    });

    const todayResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: employeeHeaders
    });

    expect(todayResponse.statusCode).toBe(200);
    expect(todayResponse.json().tasks).toHaveLength(1);
    expect(todayResponse.json().tasks[0]).toMatchObject({
      title: "Atualizar orquestrador",
      assigneeProfileId: "profile_employee",
      checklistItems: [
        { title: "Conferir dia anterior", done: false },
        { title: "Planejar compromissos do dia", done: false }
      ]
    });
  });

  it("keeps existing occurrences immutable when responsible people are edited", async () => {
    const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });

    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: managerHeaders,
      payload: {
        title: "Atualizar orquestrador",
        frequency: "daily",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        due_hint: "Até 09:00",
        assignee_profile_ids: ["profile_manager"],
        execution_mode: "individual",
        task_templates: [{ title: "Conferir dia anterior" }]
      }
    });
    const routineId = routineResponse.json().routine.id;

    await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: managerHeaders
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/routines/${routineId}`,
      headers: managerHeaders,
      payload: {
        title: "Atualizar orquestrador revisado",
        frequency: "daily",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        due_hint: "Até 10:00",
        assignee_profile_ids: ["profile_employee"],
        execution_mode: "individual",
        task_templates: [
          { title: "Conferir dia anterior" },
          { title: "Registrar mudanças" }
        ]
      }
    });

    expect(updateResponse.statusCode).toBe(200);

    const oldResponsibleToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: managerHeaders
    });
    const newResponsibleToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: employeeHeaders
    });

    expect(oldResponsibleToday.json().tasks).toHaveLength(1);
    expect(oldResponsibleToday.json().tasks[0]).toMatchObject({
      title: "Atualizar orquestrador",
      assigneeProfileId: "profile_manager",
      dueHint: "Até 09:00",
      checklistItems: [{ title: "Conferir dia anterior", done: false }]
    });
    expect(newResponsibleToday.json().tasks).toEqual([]);

    const newResponsibleFuture = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-09",
      headers: employeeHeaders
    });
    expect(newResponsibleFuture.json().tasks[0]).toMatchObject({
      title: "Atualizar orquestrador revisado",
      assigneeProfileId: "profile_employee",
      dueHint: "Até 10:00",
      checklistItems: [
        { title: "Conferir dia anterior", done: false },
        { title: "Registrar mudanças", done: false }
      ]
    });
  });

  it("updates routine checklist fields and archives routines", async () => {
    const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });
    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: managerHeaders,
      payload: {
        title: "Abertura da loja",
        area_id: "area_operacao",
        task_templates: [{ title: "Abrir portas" }]
      }
    });

    const routineId = routineResponse.json().routine.id;
    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/routines/${routineId}`,
      headers: managerHeaders,
      payload: {
        title: "Abertura completa da loja",
        area_id: "area_atendimento",
        task_templates: [
          {
            title: "Fotografar recepção pronta",
            assignee_profile_id: "profile_employee",
            due_hint: "Hoje 17:00",
            evidence_policy: "photo_or_comment_required",
            approval_mode: "approval_required"
          },
          {
            title: "Conferir agenda do dia",
            evidence_policy: "comment_required"
          }
        ]
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().routine).toMatchObject({
      title: "Abertura completa da loja",
      areaId: "area_atendimento"
    });
    expect(updateResponse.json().routine.taskTemplates).toHaveLength(2);
    expect(updateResponse.json().routine.taskTemplates[0]).toMatchObject({
      routineId,
      assigneeProfileId: "profile_employee",
      dueHint: "Hoje 17:00",
      evidencePolicy: "photo_or_comment_required",
      approvalMode: "approval_required"
    });

    const archiveResponse = await app.inject({
      method: "POST",
      url: `/routines/${routineId}/archive`,
      headers: managerHeaders
    });

    expect(archiveResponse.statusCode).toBe(200);
    expect(archiveResponse.json().routine.status).toBe("archived");
  });

  it("runs the employee evidence flow with manager approval and return", async () => {
    const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });

    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: managerHeaders,
      payload: {
        title: "Fechamento do dia",
        task_templates: [
          {
            title: "Enviar relatório com evidência",
            assignee_profile_id: "profile_employee",
            evidence_policy: "photo_or_comment_required",
            approval_mode: "approval_required"
          }
        ]
      }
    });
    const routineId = routineResponse.json().routine.id;

    await app.inject({
      method: "POST",
      url: `/routines/${routineId}/occurrences/generate`,
      headers: managerHeaders,
      payload: { due_date: "2026-07-07" }
    });

    const todayResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-07",
      headers: employeeHeaders
    });
    const taskId = todayResponse.json().tasks[0].id;

    const submitResponse = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/submit`,
      headers: employeeHeaders,
      payload: {
        comment: "Relatório revisado.",
        photo_url: "https://example.com/evidencia.jpg"
      }
    });

    expect(submitResponse.statusCode).toBe(200);
    expect(submitResponse.json().task).toMatchObject({
      status: "awaiting_approval",
      evidence: {
        comment: "Relatório revisado.",
        photoUrl: "https://example.com/evidencia.jpg"
      },
      submittedByProfileId: "profile_employee"
    });

    const approvalsResponse = await app.inject({
      method: "GET",
      url: "/approvals",
      headers: managerHeaders
    });

    expect(approvalsResponse.statusCode).toBe(200);
    expect(approvalsResponse.json().tasks).toHaveLength(1);
    expect(approvalsResponse.json().tasks[0]).toMatchObject({
      id: taskId,
      status: "awaiting_approval"
    });

    const returnResponse = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/return`,
      headers: managerHeaders,
      payload: {
        comment: "Inclua o print do dashboard."
      }
    });

    expect(returnResponse.statusCode).toBe(200);
    expect(returnResponse.json().task).toMatchObject({
      status: "needs_adjustment",
      reviewComment: "Inclua o print do dashboard.",
      reviewedByProfileId: "profile_manager"
    });

    const resubmitResponse = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/submit`,
      headers: employeeHeaders,
      payload: {
        comment: "Print incluído.",
        photo_url: "https://example.com/dashboard.jpg"
      }
    });

    expect(resubmitResponse.statusCode).toBe(200);
    expect(resubmitResponse.json().task.status).toBe("awaiting_approval");

    const approveResponse = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/approve`,
      headers: managerHeaders
    });

    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json().task).toMatchObject({
      status: "completed",
      reviewedByProfileId: "profile_manager"
    });
  });

  it("deletes routines and their generated task occurrences", async () => {
    const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });

    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: managerHeaders,
      payload: {
        title: "Organizar orquestrador",
        task_templates: [
          {
            title: "Atualizar demandas do dia",
            assignee_profile_id: "profile_employee"
          }
        ]
      }
    });
    const routineId = routineResponse.json().routine.id;

    await app.inject({
      method: "POST",
      url: `/routines/${routineId}/occurrences/generate`,
      headers: managerHeaders,
      payload: { due_date: "2026-07-08" }
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/routines/${routineId}`,
      headers: managerHeaders
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ ok: true });

    const routinesResponse = await app.inject({
      method: "GET",
      url: "/routines",
      headers: managerHeaders
    });
    const todayResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: employeeHeaders
    });

    expect(routinesResponse.json().routines).toEqual([]);
    expect(todayResponse.json().tasks).toEqual([]);
  });

  it("creates and deletes one-off tasks for today's execution inbox", async () => {
    const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: managerHeaders,
      payload: {
        title: "Confirmar agenda do cliente",
        area_id: "area_comercial",
        assignee_profile_id: "profile_employee",
        due_date: "2026-07-07",
        due_hint: "Até 16:00",
        evidence_policy: "comment_required",
        approval_mode: "approval_required",
        checklist_items: ["Conferir agenda", "Registrar retorno"]
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().task).toMatchObject({
      title: "Confirmar agenda do cliente",
      origin: "manual",
      routineId: null,
      taskTemplateId: null,
      areaId: "area_comercial",
      assigneeProfileId: "profile_employee",
      dueDate: "2026-07-07",
      dueHint: "Até 16:00",
      evidencePolicy: "comment_required",
      approvalMode: "approval_required",
      checklistItems: [
        { title: "Conferir agenda", done: false },
        { title: "Registrar retorno", done: false }
      ]
    });

    const taskId = createResponse.json().task.id;
    const todayResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-07",
      headers: employeeHeaders
    });

    expect(todayResponse.statusCode).toBe(200);
    expect(todayResponse.json().tasks).toHaveLength(1);
    expect(todayResponse.json().tasks[0]).toMatchObject({
      id: taskId,
      title: "Confirmar agenda do cliente",
      origin: "manual"
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/tasks/${taskId}`,
      headers: managerHeaders
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ ok: true });

    const afterDeleteResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-07",
      headers: employeeHeaders
    });

    expect(afterDeleteResponse.json().tasks).toEqual([]);
  });

  it("updates one-off task details and checklist state", async () => {
    const app = buildApp({ routineRepository: createInMemoryRoutineRepository() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: managerHeaders,
      payload: {
        title: "Terminar máquina virtual",
        assignee_profile_id: "profile_employee",
        due_date: "2026-07-07",
        due_hint: "Até 17:00",
        checklist_items: ["Instalar dependências", "Validar acesso"]
      }
    });
    const taskId = createResponse.json().task.id;

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/tasks/${taskId}`,
      headers: managerHeaders,
      payload: {
        title: "Terminar máquina virtual Krah",
        area_id: "area_tecnica",
        assignee_profile_id: "profile_employee",
        due_date: "2026-07-07",
        due_hint: "Até 18:00",
        evidence_policy: "comment_required",
        approval_mode: "direct",
        checklist_items: ["Instalar dependências", "Validar acesso", "Registrar entrega"]
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().task).toMatchObject({
      title: "Terminar máquina virtual Krah",
      areaId: "area_tecnica",
      dueHint: "Até 18:00",
      evidencePolicy: "comment_required",
      checklistItems: [
        { title: "Instalar dependências", done: false },
        { title: "Validar acesso", done: false },
        { title: "Registrar entrega", done: false }
      ]
    });

    const checklistResponse = await app.inject({
      method: "PATCH",
      url: `/tasks/${taskId}/checklist`,
      headers: employeeHeaders,
      payload: {
        checklist_items: [
          { title: "Instalar dependências", done: true },
          { title: "Validar acesso", done: false },
          { title: "Registrar entrega", done: true }
        ]
      }
    });

    expect(checklistResponse.statusCode).toBe(200);
    expect(checklistResponse.json().task.checklistItems).toEqual([
      { title: "Instalar dependências", done: true },
      { title: "Validar acesso", done: false },
      { title: "Registrar entrega", done: true }
    ]);
  });
});
