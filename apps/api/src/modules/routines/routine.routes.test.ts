import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
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

describe("routine routes", () => {
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
