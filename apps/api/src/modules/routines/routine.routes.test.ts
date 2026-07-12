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

async function buildLocalRoutineAppWithEmployee(areaId: string) {
  const companyRepository = createInMemoryCompanyRepository();
  const manager = await companyRepository.createTeamMember({
    workspaceId: "workspace_a",
    name: "Gestor",
    email: null,
    role: "manager",
    areaId,
    areaAccessIds: [areaId],
    accessScope: "area",
    roleTemplateId: null,
    createdByProfileId: "profile_manager"
  });
  const employee = await companyRepository.createTeamMember({
    workspaceId: "workspace_a",
    name: "Funcionário",
    email: null,
    role: "employee",
    areaId,
    roleTemplateId: null,
    createdByProfileId: manager.id
  });
  return {
    app: buildApp({ companyRepository, routineRepository: createInMemoryRoutineRepository() }),
    managerId: manager.id,
    employeeId: employee.id,
    managerHeaders: { ...managerHeaders, "x-baase-profile-id": manager.id },
    employeeHeaders: { ...employeeHeaders, "x-baase-profile-id": employee.id }
  };
}

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
    { id: "profile_apoio_tecnico", name: "Apoio Tecnico", email: "apoio.tecnico@example.com", role: "employee" as const, areaId: "area_tecnica", areaAccessIds: ["area_tecnica"], accessScope: "area" as const },
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
    const technicalSupportToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: headersFor("profile_apoio_tecnico")
    });

    expect(financeToday.json().tasks).toEqual([]);
    expect(petersonToday.json().tasks).toHaveLength(1);
    expect(petersonToday.json().tasks[0]).toMatchObject({ assigneeProfileId: petersonId });
    expect(andreToday.json().tasks).toHaveLength(1);
    expect(andreToday.json().tasks[0]).toMatchObject({ assigneeProfileId: andreId });
    expect(technicalSupportToday.json().tasks).toHaveLength(2);
    expect(ownerToday.json().tasks).toHaveLength(2);
    expect(ownerToday.json().tasks.map((task: { assigneeProfileId: string | null }) => task.assigneeProfileId))
      .toEqual([petersonId, andreId]);
    expect(ownerToday.json().tasks.map((task: { assigneeProfileId: string | null }) => task.assigneeProfileId))
      .not.toContain(ownerId);
  });

  it("keeps null-area routines and approvals owner-only and validates manual task assignees", async () => {
    const { app, headersFor, personIdFor } = await buildOperationalAccessApp();
    const ownerHeaders = headersFor("profile_owner");
    const technicalPersonId = personIdFor("profile_peterson");
    const financePersonId = personIdFor("profile_financeiro");
    const nullAreaRoutine = await app.inject({
      method: "POST",
      url: "/routines",
      headers: ownerHeaders,
      payload: {
        title: "Rotina sem area",
        approval_mode: "approval_required",
        task_templates: [{ title: "Aprovar rotina", approval_mode: "approval_required" }]
      }
    });
    const generated = await app.inject({
      method: "POST",
      url: `/routines/${nullAreaRoutine.json().routine.id}/occurrences/generate`,
      headers: ownerHeaders,
      payload: { due_date: "2026-07-08" }
    });
    const nullAreaTaskId = generated.json().tasks[0].id;
    const submitted = await app.inject({
      method: "POST",
      url: `/tasks/${nullAreaTaskId}/submit`,
      headers: ownerHeaders,
      payload: {}
    });

    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().task.status).toBe("awaiting_approval");

    const financeRoutines = await app.inject({
      method: "GET",
      url: "/routines",
      headers: headersFor("profile_gestor_financeiro")
    });
    const financeApprovals = await app.inject({
      method: "GET",
      url: "/approvals",
      headers: headersFor("profile_gestor_financeiro")
    });
    const financeApprove = await app.inject({
      method: "POST",
      url: `/tasks/${nullAreaTaskId}/approve`,
      headers: headersFor("profile_gestor_financeiro")
    });

    expect(financeRoutines.json().routines).toEqual([]);
    expect(financeApprovals.json().tasks).toEqual([]);
    expect(financeApprove.statusCode).toBe(403);
    expect(financeApprove.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
    expect(financeApprove.json()).not.toHaveProperty("task");

    const financeHeaders = headersFor("profile_gestor_financeiro");
    const nullAreaTask = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: financeHeaders,
      payload: {
        title: "Tarefa nula para tecnico",
        assignee_profile_id: technicalPersonId,
        due_date: "2026-07-08"
      }
    });
    const crossAreaTask = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: financeHeaders,
      payload: {
        title: "Tarefa financeira para tecnico",
        area_id: "area_financeiro",
        assignee_profile_id: technicalPersonId,
        due_date: "2026-07-08"
      }
    });
    const financeTask = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: financeHeaders,
      payload: {
        title: "Tarefa financeira",
        area_id: "area_financeiro",
        assignee_profile_id: financePersonId,
        due_date: "2026-07-08"
      }
    });

    expect(nullAreaTask.statusCode).toBe(403);
    expect(crossAreaTask.statusCode).toBe(403);
    expect(financeTask.statusCode).toBe(201);
    expect(financeTask.json().task).toMatchObject({
      areaId: "area_financeiro",
      assigneeProfileId: financePersonId
    });

    const financeTaskId = financeTask.json().task.id;
    const financeTaskAssigneePatch = await app.inject({
      method: "PATCH",
      url: `/tasks/${financeTaskId}`,
      headers: financeHeaders,
      payload: {
        title: "Tarefa financeira alterada",
        area_id: "area_financeiro",
        assignee_profile_id: technicalPersonId,
        due_date: "2026-07-08"
      }
    });
    const financeTaskNullAreaPatch = await app.inject({
      method: "PATCH",
      url: `/tasks/${financeTaskId}`,
      headers: financeHeaders,
      payload: {
        title: "Tarefa financeira sem area",
        assignee_profile_id: financePersonId,
        due_date: "2026-07-08"
      }
    });
    const ownerNullAreaTask = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: ownerHeaders,
      payload: {
        title: "Tarefa manual do owner",
        due_date: "2026-07-08"
      }
    });

    expect(financeTaskAssigneePatch.statusCode).toBe(403);
    expect(financeTaskNullAreaPatch.statusCode).toBe(403);
    expect(ownerNullAreaTask.statusCode).toBe(201);
    expect(ownerNullAreaTask.json().task.areaId).toBeNull();
  });

  it("validates routine assignees against the requested area", async () => {
    const { app, headersFor, personIdFor } = await buildOperationalAccessApp();
    const financeHeaders = headersFor("profile_gestor_financeiro");
    const technicalPersonId = personIdFor("profile_peterson");
    const financePersonId = personIdFor("profile_financeiro");
    const globalCrossAreaCreate = await app.inject({
      method: "POST",
      url: "/routines",
      headers: financeHeaders,
      payload: {
        title: "Rotina financeira para tecnico",
        area_id: "area_financeiro",
        assignee_profile_ids: [technicalPersonId],
        execution_mode: "individual",
        task_templates: [{ title: "Conferir saldo" }]
      }
    });
    const templateCrossAreaCreate = await app.inject({
      method: "POST",
      url: "/routines",
      headers: financeHeaders,
      payload: {
        title: "Rotina financeira com etapa tecnica",
        area_id: "area_financeiro",
        task_templates: [{ title: "Conferir saldo", assignee_profile_id: technicalPersonId }]
      }
    });
    const financeRoutine = await app.inject({
      method: "POST",
      url: "/routines",
      headers: financeHeaders,
      payload: {
        title: "Rotina financeira",
        area_id: "area_financeiro",
        assignee_profile_ids: [financePersonId],
        execution_mode: "individual",
        task_templates: [{ title: "Conferir saldo" }]
      }
    });

    expect(globalCrossAreaCreate.statusCode).toBe(403);
    expect(templateCrossAreaCreate.statusCode).toBe(403);
    for (const response of [globalCrossAreaCreate, templateCrossAreaCreate]) {
      expect(response.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
      expect(response.json()).not.toHaveProperty("routine");
    }
    expect(financeRoutine.statusCode).toBe(201);
    expect(financeRoutine.json().routine.assigneeProfileIds).toEqual([financePersonId]);

    const financeUpdate = await app.inject({
      method: "PATCH",
      url: `/routines/${financeRoutine.json().routine.id}`,
      headers: financeHeaders,
      payload: {
        title: "Rotina financeira alterada",
        area_id: "area_financeiro",
        assignee_profile_ids: [technicalPersonId],
        execution_mode: "individual",
        task_templates: [{ title: "Conferir saldo" }]
      }
    });

    expect(financeUpdate.statusCode).toBe(403);
    expect(financeUpdate.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
    expect(financeUpdate.json()).not.toHaveProperty("routine");
  });

  it("restricts technical routine occurrence generation to the routine area", async () => {
    const { app, headersFor } = await buildOperationalAccessApp();
    const ownerHeaders = headersFor("profile_owner");
    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: ownerHeaders,
      payload: {
        title: "Gerar rotina tecnica",
        area_id: "area_tecnica",
        frequency: "daily",
        task_templates: [{ title: "Executar rotina" }]
      }
    });
    const routineId = routineResponse.json().routine.id;

    const financeGeneration = await app.inject({
      method: "POST",
      url: `/routines/${routineId}/occurrences/generate`,
      headers: headersFor("profile_gestor_financeiro"),
      payload: { due_date: "2026-07-06" }
    });
    const ownerGeneration = await app.inject({
      method: "POST",
      url: `/routines/${routineId}/occurrences/generate`,
      headers: ownerHeaders,
      payload: { due_date: "2026-07-07" }
    });
    const technicalManagerGeneration = await app.inject({
      method: "POST",
      url: `/routines/${routineId}/occurrences/generate`,
      headers: headersFor("profile_gestor_tecnico"),
      payload: { due_date: "2026-07-08" }
    });

    expect(financeGeneration.statusCode).toBe(403);
    expect(financeGeneration.json()).toEqual({
      error: expect.objectContaining({ code: "BAASE_SCOPE_FORBIDDEN" })
    });
    expect(financeGeneration.json()).not.toHaveProperty("tasks");
    expect(ownerGeneration.statusCode).toBe(201);
    expect(ownerGeneration.json().tasks).toHaveLength(1);
    expect(technicalManagerGeneration.statusCode).toBe(201);
    expect(technicalManagerGeneration.json().tasks).toHaveLength(1);
  });

  it("reserves no-area routine lifecycle actions for owners", async () => {
    const { app, headersFor } = await buildOperationalAccessApp();
    const ownerHeaders = headersFor("profile_owner");
    const noAreaRoutinePayload = {
      title: "Rotina compartilhada do owner",
      execution_mode: "shared",
      task_templates: [{ title: "Executar rotina" }]
    };

    const technicalManagerCreate = await app.inject({
      method: "POST",
      url: "/routines",
      headers: headersFor("profile_gestor_tecnico"),
      payload: noAreaRoutinePayload
    });
    const financeManagerCreate = await app.inject({
      method: "POST",
      url: "/routines",
      headers: headersFor("profile_gestor_financeiro"),
      payload: noAreaRoutinePayload
    });

    for (const response of [technicalManagerCreate, financeManagerCreate]) {
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
      expect(response.json()).not.toHaveProperty("routine");
    }

    const ownerNoAreaRoutine = await app.inject({
      method: "POST",
      url: "/routines",
      headers: ownerHeaders,
      payload: noAreaRoutinePayload
    });
    const noAreaRoutineId = ownerNoAreaRoutine.json().routine.id;
    const technicalManagerGenerate = await app.inject({
      method: "POST",
      url: `/routines/${noAreaRoutineId}/occurrences/generate`,
      headers: headersFor("profile_gestor_tecnico"),
      payload: { due_date: "2026-07-08" }
    });
    const financeManagerArchive = await app.inject({
      method: "POST",
      url: `/routines/${noAreaRoutineId}/archive`,
      headers: headersFor("profile_gestor_financeiro")
    });
    const technicalManagerDelete = await app.inject({
      method: "DELETE",
      url: `/routines/${noAreaRoutineId}`,
      headers: headersFor("profile_gestor_tecnico")
    });
    const ownerGenerate = await app.inject({
      method: "POST",
      url: `/routines/${noAreaRoutineId}/occurrences/generate`,
      headers: ownerHeaders,
      payload: { due_date: "2026-07-08" }
    });

    expect(ownerNoAreaRoutine.statusCode).toBe(201);
    expect(technicalManagerGenerate.statusCode).toBe(403);
    expect(technicalManagerGenerate.json()).not.toHaveProperty("tasks");
    expect(financeManagerArchive.statusCode).toBe(403);
    expect(financeManagerArchive.json()).not.toHaveProperty("routine");
    expect(technicalManagerDelete.statusCode).toBe(403);
    expect(ownerGenerate.statusCode).toBe(201);
    expect(ownerGenerate.json().tasks).toHaveLength(1);

    const technicalRoutine = await app.inject({
      method: "POST",
      url: "/routines",
      headers: ownerHeaders,
      payload: {
        title: "Rotina tecnica",
        area_id: "area_tecnica",
        task_templates: [{ title: "Executar rotina" }]
      }
    });
    const technicalRoutineId = technicalRoutine.json().routine.id;
    const moveToNoAreaPayload = {
      title: "Mover rotina tecnica",
      task_templates: [{ title: "Executar rotina" }]
    };
    const technicalManagerMove = await app.inject({
      method: "PATCH",
      url: `/routines/${technicalRoutineId}`,
      headers: headersFor("profile_gestor_tecnico"),
      payload: moveToNoAreaPayload
    });
    const financeManagerMove = await app.inject({
      method: "PATCH",
      url: `/routines/${technicalRoutineId}`,
      headers: headersFor("profile_gestor_financeiro"),
      payload: moveToNoAreaPayload
    });

    for (const response of [technicalManagerMove, financeManagerMove]) {
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
      expect(response.json()).not.toHaveProperty("routine");
    }
  });

  it("scopes routine lifecycle mutations to the existing and requested areas", async () => {
    const { app, headersFor } = await buildOperationalAccessApp();
    const ownerHeaders = headersFor("profile_owner");
    const technicalRoutine = await app.inject({
      method: "POST",
      url: "/routines",
      headers: ownerHeaders,
      payload: {
        title: "Rotina tecnica protegida",
        area_id: "area_tecnica",
        task_templates: [{ title: "Executar rotina" }]
      }
    });
    const technicalRoutineId = technicalRoutine.json().routine.id;
    const financeHeaders = headersFor("profile_gestor_financeiro");

    const financePatch = await app.inject({
      method: "PATCH",
      url: `/routines/${technicalRoutineId}`,
      headers: financeHeaders,
      payload: {
        title: "Rotina tecnica alterada",
        area_id: "area_tecnica",
        task_templates: [{ title: "Executar rotina" }]
      }
    });
    const financeArchive = await app.inject({
      method: "POST",
      url: `/routines/${technicalRoutineId}/archive`,
      headers: financeHeaders
    });
    const financeDelete = await app.inject({
      method: "DELETE",
      url: `/routines/${technicalRoutineId}`,
      headers: financeHeaders
    });

    for (const response of [financePatch, financeArchive, financeDelete]) {
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
      expect(response.json()).not.toHaveProperty("routine");
      expect(response.json()).not.toHaveProperty("tasks");
    }

    const technicalManagerMove = await app.inject({
      method: "PATCH",
      url: `/routines/${technicalRoutineId}`,
      headers: headersFor("profile_gestor_tecnico"),
      payload: {
        title: "Mover rotina tecnica",
        area_id: "area_financeiro",
        task_templates: [{ title: "Executar rotina" }]
      }
    });
    const technicalManagerPatch = await app.inject({
      method: "PATCH",
      url: `/routines/${technicalRoutineId}`,
      headers: headersFor("profile_gestor_tecnico"),
      payload: {
        title: "Atualizar rotina tecnica",
        area_id: "area_tecnica",
        task_templates: [{ title: "Executar rotina" }]
      }
    });
    const technicalManagerArchive = await app.inject({
      method: "POST",
      url: `/routines/${technicalRoutineId}/archive`,
      headers: headersFor("profile_gestor_tecnico")
    });

    expect(technicalManagerMove.statusCode).toBe(403);
    expect(technicalManagerMove.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
    expect(technicalManagerPatch.statusCode).toBe(200);
    expect(technicalManagerPatch.json().routine.areaId).toBe("area_tecnica");
    expect(technicalManagerArchive.statusCode).toBe(200);
    expect(technicalManagerArchive.json().routine.status).toBe("archived");

    const ownerRoutine = await app.inject({
      method: "POST",
      url: "/routines",
      headers: ownerHeaders,
      payload: {
        title: "Rotina do owner",
        area_id: "area_tecnica",
        task_templates: [{ title: "Executar rotina" }]
      }
    });
    const ownerDelete = await app.inject({
      method: "DELETE",
      url: `/routines/${ownerRoutine.json().routine.id}`,
      headers: ownerHeaders
    });

    expect(ownerDelete.statusCode).toBe(200);
    expect(ownerDelete.json()).toEqual({ ok: true });
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
    expect(checklistResponse.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
    expect(submitResponse.statusCode).toBe(403);
    expect(submitResponse.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");
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
    expect(individualManagerChecklist.json().error.code).toBe("BAASE_SCOPE_FORBIDDEN");

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
      payload: { title: "Original", area_id: "area_tecnica", task_templates: [{ title: "Executar" }] }
    });
    const routine = created.json().routine;
    const response = await app.inject({
      method: "PATCH",
      url: `/routines/${routine.id}`,
      headers: managerHeaders,
      payload: {
        title: "Atualizada",
        area_id: "area_tecnica",
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
          area_id: "area_tecnica",
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
      payload: { title: "Diaria", area_id: "area_tecnica", task_templates: [{ title: "Executar" }] }
    });
    const response = await app.inject({
      method: "PATCH",
      url: `/routines/${created.json().routine.id}`,
      headers: managerHeaders,
      payload: {
        title: "Semanal invalida",
        area_id: "area_tecnica",
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
    const { app, employeeId, managerHeaders: localManagerHeaders, employeeHeaders: localEmployeeHeaders } = await buildLocalRoutineAppWithEmployee("area_operacao");

    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: localManagerHeaders,
      payload: {
        title: "Abertura da loja",
        area_id: "area_operacao",
        task_templates: [
          {
            title: "Fotografar recepção pronta",
            assignee_profile_id: employeeId,
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
      headers: localManagerHeaders,
      payload: {
        due_date: "2026-07-07"
      }
    });

    expect(generationResponse.statusCode).toBe(201);
    expect(generationResponse.json().tasks).toHaveLength(1);

    const todayResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-07",
      headers: localEmployeeHeaders
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
      headers: localEmployeeHeaders,
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
    const {
      app,
      employeeId,
      managerId,
      managerHeaders: localManagerHeaders,
      employeeHeaders: localEmployeeHeaders
    } = await buildLocalRoutineAppWithEmployee("area_tecnica");

    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: localManagerHeaders,
      payload: {
        title: "Organizar orquestrador",
        area_id: "area_tecnica",
        frequency: "daily",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        due_hint: "Até 09:00",
        assignee_profile_ids: [employeeId, managerId],
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
      assigneeProfileIds: [employeeId, managerId],
      executionMode: "individual"
    });

    const routineId = routineResponse.json().routine.id;
    const generationResponse = await app.inject({
      method: "POST",
      url: `/routines/${routineId}/occurrences/generate`,
      headers: localManagerHeaders,
      payload: { due_date: "2026-07-08" }
    });

    expect(generationResponse.statusCode).toBe(201);
    expect(generationResponse.json().tasks).toHaveLength(2);

    const todayResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: localEmployeeHeaders
    });

    expect(todayResponse.statusCode).toBe(200);
    expect(todayResponse.json().tasks).toHaveLength(2);
    expect(todayResponse.json().tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Organizar orquestrador",
        dueHint: "Até 09:00",
        assigneeProfileId: employeeId,
        checklistItems: [
          { title: "Atualizar demandas de ontem", done: false },
          { title: "Planejar demandas de hoje", done: false }
        ]
      })
    ]));
  });

  it("generates active routine occurrences when the employee opens today", async () => {
    const { app, employeeId, managerHeaders: localManagerHeaders, employeeHeaders: localEmployeeHeaders } = await buildLocalRoutineAppWithEmployee("area_financeiro");

    await app.inject({
      method: "POST",
      url: "/routines",
      headers: localManagerHeaders,
      payload: {
        title: "Atualizar orquestrador",
        area_id: "area_financeiro",
        frequency: "daily",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        due_hint: "Até 09:00",
        assignee_profile_ids: [employeeId],
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
      headers: localEmployeeHeaders
    });

    expect(todayResponse.statusCode).toBe(200);
    expect(todayResponse.json().tasks).toHaveLength(1);
    expect(todayResponse.json().tasks[0]).toMatchObject({
      title: "Atualizar orquestrador",
      assigneeProfileId: employeeId,
      checklistItems: [
        { title: "Conferir dia anterior", done: false },
        { title: "Planejar compromissos do dia", done: false }
      ]
    });
  });

  it("keeps existing occurrences immutable when responsible people are edited", async () => {
    const {
      app,
      employeeId,
      managerId,
      managerHeaders: localManagerHeaders,
      employeeHeaders: localEmployeeHeaders
    } = await buildLocalRoutineAppWithEmployee("area_tecnica");

    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: localManagerHeaders,
      payload: {
        title: "Atualizar orquestrador",
        area_id: "area_tecnica",
        frequency: "daily",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        due_hint: "Até 09:00",
        assignee_profile_ids: [managerId],
        execution_mode: "individual",
        task_templates: [{ title: "Conferir dia anterior" }]
      }
    });
    const routineId = routineResponse.json().routine.id;

    await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: localManagerHeaders
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/routines/${routineId}`,
      headers: localManagerHeaders,
      payload: {
        title: "Atualizar orquestrador revisado",
        area_id: "area_tecnica",
        frequency: "daily",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        due_hint: "Até 10:00",
        assignee_profile_ids: [employeeId],
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
      headers: localManagerHeaders
    });
    const newResponsibleToday = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: localEmployeeHeaders
    });

    expect(oldResponsibleToday.json().tasks).toHaveLength(1);
    expect(oldResponsibleToday.json().tasks[0]).toMatchObject({
      title: "Atualizar orquestrador",
      assigneeProfileId: managerId,
      dueHint: "Até 09:00",
      checklistItems: [{ title: "Conferir dia anterior", done: false }]
    });
    expect(newResponsibleToday.json().tasks).toEqual([
      expect.objectContaining({
        title: "Atualizar orquestrador",
        assigneeProfileId: managerId,
        dueHint: "Até 09:00",
        checklistItems: [{ title: "Conferir dia anterior", done: false }]
      })
    ]);

    const newResponsibleFuture = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-09",
      headers: localEmployeeHeaders
    });
    expect(newResponsibleFuture.json().tasks[0]).toMatchObject({
      title: "Atualizar orquestrador revisado",
      assigneeProfileId: employeeId,
      dueHint: "Até 10:00",
      checklistItems: [
        { title: "Conferir dia anterior", done: false },
        { title: "Registrar mudanças", done: false }
      ]
    });
  });

  it("updates routine checklist fields and archives routines", async () => {
    const { app, employeeId, managerHeaders: localManagerHeaders } = await buildLocalRoutineAppWithEmployee("area_atendimento");
    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: localManagerHeaders,
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
      headers: localManagerHeaders,
      payload: {
        title: "Abertura completa da loja",
        area_id: "area_atendimento",
        task_templates: [
          {
            title: "Fotografar recepção pronta",
            assignee_profile_id: employeeId,
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
      assigneeProfileId: employeeId,
      dueHint: "Hoje 17:00",
      evidencePolicy: "photo_or_comment_required",
      approvalMode: "approval_required"
    });

    const archiveResponse = await app.inject({
      method: "POST",
      url: `/routines/${routineId}/archive`,
      headers: localManagerHeaders
    });

    expect(archiveResponse.statusCode).toBe(200);
    expect(archiveResponse.json().routine.status).toBe("archived");
  });

  it("runs the employee evidence flow with manager approval and return", async () => {
    const {
      app,
      employeeId,
      managerId,
      managerHeaders: localManagerHeaders,
      employeeHeaders: localEmployeeHeaders
    } = await buildLocalRoutineAppWithEmployee("area_tecnica");

    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: localManagerHeaders,
      payload: {
        title: "Fechamento do dia",
        area_id: "area_tecnica",
        task_templates: [
          {
            title: "Enviar relatório com evidência",
            assignee_profile_id: employeeId,
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
      headers: localManagerHeaders,
      payload: { due_date: "2026-07-07" }
    });

    const todayResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-07",
      headers: localEmployeeHeaders
    });
    const taskId = todayResponse.json().tasks[0].id;

    const submitResponse = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/submit`,
      headers: localEmployeeHeaders,
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
      submittedByProfileId: employeeId
    });

    const approvalsResponse = await app.inject({
      method: "GET",
      url: "/approvals",
      headers: localManagerHeaders
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
      headers: localManagerHeaders,
      payload: {
        comment: "Inclua o print do dashboard."
      }
    });

    expect(returnResponse.statusCode).toBe(200);
    expect(returnResponse.json().task).toMatchObject({
      status: "needs_adjustment",
      reviewComment: "Inclua o print do dashboard.",
      reviewedByProfileId: managerId
    });

    const resubmitResponse = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/submit`,
      headers: localEmployeeHeaders,
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
      headers: localManagerHeaders
    });

    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json().task).toMatchObject({
      status: "completed",
      reviewedByProfileId: managerId
    });
  });

  it("deletes routines and their generated task occurrences", async () => {
    const { app, employeeId, managerHeaders: localManagerHeaders, employeeHeaders: localEmployeeHeaders } = await buildLocalRoutineAppWithEmployee("area_tecnica");

    const routineResponse = await app.inject({
      method: "POST",
      url: "/routines",
      headers: localManagerHeaders,
      payload: {
        title: "Organizar orquestrador",
        area_id: "area_tecnica",
        task_templates: [
          {
            title: "Atualizar demandas do dia",
            assignee_profile_id: employeeId
          }
        ]
      }
    });
    const routineId = routineResponse.json().routine.id;

    await app.inject({
      method: "POST",
      url: `/routines/${routineId}/occurrences/generate`,
      headers: localManagerHeaders,
      payload: { due_date: "2026-07-08" }
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/routines/${routineId}`,
      headers: localManagerHeaders
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ ok: true });

    const routinesResponse = await app.inject({
      method: "GET",
      url: "/routines",
      headers: localManagerHeaders
    });
    const todayResponse = await app.inject({
      method: "GET",
      url: "/today?date=2026-07-08",
      headers: localEmployeeHeaders
    });

    expect(routinesResponse.json().routines).toEqual([]);
    expect(todayResponse.json().tasks).toEqual([]);
  });

  it("creates and deletes one-off tasks for today's execution inbox", async () => {
    const { app, employeeId, employeeHeaders: assignedEmployeeHeaders } = await buildLocalRoutineAppWithEmployee("area_comercial");

    const createResponse = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: managerHeaders,
      payload: {
        title: "Confirmar agenda do cliente",
        area_id: "area_comercial",
        assignee_profile_id: employeeId,
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
      assigneeProfileId: employeeId,
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
      headers: assignedEmployeeHeaders
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
      headers: assignedEmployeeHeaders
    });

    expect(afterDeleteResponse.json().tasks).toEqual([]);
  });

  it("updates one-off task details and checklist state", async () => {
    const { app, employeeId, employeeHeaders: assignedEmployeeHeaders } = await buildLocalRoutineAppWithEmployee("area_tecnica");

    const createResponse = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: managerHeaders,
      payload: {
        title: "Terminar máquina virtual",
        area_id: "area_tecnica",
        assignee_profile_id: employeeId,
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
        assignee_profile_id: employeeId,
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
      headers: assignedEmployeeHeaders,
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
