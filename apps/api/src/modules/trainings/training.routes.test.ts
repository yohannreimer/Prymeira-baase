import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryTrainingRepository } from "./in-memory-training.repository";

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

describe("training routes", () => {
  it("creates, publishes, and scores a training quiz", async () => {
    const app = buildApp({ trainingRepository: createInMemoryTrainingRepository() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/trainings",
      headers: managerHeaders,
      payload: {
        title: "Atendimento inicial",
        materials: [
          {
            kind: "lesson",
            title: "Aula curta",
            body: "Cumprimente e qualifique."
          }
        ],
        quiz_questions: [
          {
            prompt: "Qual é o primeiro passo?",
            options: [
              { id: "a", label: "Cumprimentar" },
              { id: "b", label: "Encerrar" }
            ],
            correct_option_id: "a"
          }
        ]
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const training = createResponse.json().training;

    const publishResponse = await app.inject({
      method: "POST",
      url: `/trainings/${training.id}/publish`,
      headers: managerHeaders
    });

    expect(publishResponse.statusCode).toBe(200);
    expect(publishResponse.json().training.status).toBe("published");

    const attemptResponse = await app.inject({
      method: "POST",
      url: `/trainings/${training.id}/attempts`,
      headers: employeeHeaders,
      payload: {
        answers: [
          {
            question_id: training.quizQuestions[0].id,
            option_id: "a"
          }
        ]
      }
    });

    expect(attemptResponse.statusCode).toBe(201);
    expect(attemptResponse.json().attempt).toMatchObject({
      score: 100,
      passed: true,
      profileId: "profile_employee"
    });
  });

  it("rejects training creation for employees", async () => {
    const app = buildApp({ trainingRepository: createInMemoryTrainingRepository() });

    const response = await app.inject({
      method: "POST",
      url: "/trainings",
      headers: employeeHeaders,
      payload: {
        title: "Treinamento indevido",
        materials: [{ kind: "lesson", title: "Aula", body: "Conteúdo." }],
        quiz_questions: []
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it("updates and unpublishes trainings", async () => {
    const app = buildApp({ trainingRepository: createInMemoryTrainingRepository() });
    const createResponse = await app.inject({
      method: "POST",
      url: "/trainings",
      headers: managerHeaders,
      payload: {
        title: "Atendimento inicial",
        description: "Versão antiga",
        materials: [{ kind: "lesson", title: "Aula", body: "Cumprimente." }],
        quiz_questions: []
      }
    });

    const trainingId = createResponse.json().training.id;
    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/trainings/${trainingId}`,
      headers: managerHeaders,
      payload: {
        title: "Atendimento premium",
        description: "Aula curta com PDF e quiz.",
        materials: [
          { kind: "lesson", title: "Aula curta", body: "Cumprimente, qualifique e registre." },
          { kind: "pdf", title: "Manual de atendimento.pdf", url: "https://example.com/manual.pdf" }
        ],
        quiz_questions: [
          {
            prompt: "O que registrar depois do contato?",
            options: [
              { id: "a", label: "A evidência no Baase" },
              { id: "b", label: "Nada" }
            ],
            correct_option_id: "a"
          }
        ]
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().training).toMatchObject({
      title: "Atendimento premium",
      description: "Aula curta com PDF e quiz."
    });
    expect(updateResponse.json().training.materials).toHaveLength(2);
    expect(updateResponse.json().training.quizQuestions).toHaveLength(1);

    await app.inject({
      method: "POST",
      url: `/trainings/${trainingId}/publish`,
      headers: managerHeaders
    });

    const unpublishResponse = await app.inject({
      method: "POST",
      url: `/trainings/${trainingId}/unpublish`,
      headers: managerHeaders
    });

    expect(unpublishResponse.statusCode).toBe(200);
    expect(unpublishResponse.json().training).toMatchObject({
      status: "draft",
      publishedAt: null
    });
  });

  it("creates training from a process source and deletes it", async () => {
    const app = buildApp({ trainingRepository: createInMemoryTrainingRepository() });
    const createResponse = await app.inject({
      method: "POST",
      url: "/trainings",
      headers: managerHeaders,
      payload: {
        title: "Treinar execução de SOP",
        description: "Treinamento vinculado ao processo publicado.",
        source: {
          type: "process",
          process_id: "process_entregas",
          title: "Executar e documentar entregáveis técnicos"
        },
        audience: {
          type: "area",
          area_id: "area_tecnica"
        },
        due_date: "2026-07-20",
        materials: [{ kind: "lesson", title: "Resumo do SOP", body: "Leia o processo e responda o quiz." }],
        quiz_questions: [
          {
            prompt: "Onde o padrão principal deve ficar?",
            options: [
              { id: "a", label: "No processo publicado" },
              { id: "b", label: "Apenas no WhatsApp" }
            ],
            correct_option_id: "a"
          }
        ]
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().training).toMatchObject({
      source: {
        type: "process",
        processId: "process_entregas",
        title: "Executar e documentar entregáveis técnicos"
      },
      audience: { type: "area", areaId: "area_tecnica" },
      dueDate: "2026-07-20"
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/trainings/${createResponse.json().training.id}`,
      headers: managerHeaders
    });
    const listResponse = await app.inject({
      method: "GET",
      url: "/trainings",
      headers: managerHeaders
    });

    expect(deleteResponse.statusCode).toBe(204);
    expect(listResponse.json().trainings).toEqual([]);
  });

  it("assigns published trainings and lists employee progress", async () => {
    const app = buildApp({ trainingRepository: createInMemoryTrainingRepository() });
    const createResponse = await app.inject({
      method: "POST",
      url: "/trainings",
      headers: managerHeaders,
      payload: {
        title: "Padrão de atendimento",
        materials: [{ kind: "lesson", title: "Aula", body: "Responda em até 15 minutos." }],
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
    const training = createResponse.json().training;
    await app.inject({
      method: "POST",
      url: `/trainings/${training.id}/publish`,
      headers: managerHeaders
    });

    const assignResponse = await app.inject({
      method: "POST",
      url: `/trainings/${training.id}/assignments`,
      headers: managerHeaders,
      payload: {
        audience_type: "all",
        due_date: "2026-07-10"
      }
    });
    const pendingResponse = await app.inject({
      method: "GET",
      url: "/training-assignments?date=2026-07-07",
      headers: employeeHeaders
    });

    expect(assignResponse.statusCode).toBe(201);
    expect(assignResponse.json().assignment).toMatchObject({
      trainingId: training.id,
      audience: { type: "all" },
      dueDate: "2026-07-10"
    });
    expect(pendingResponse.statusCode).toBe(200);
    expect(pendingResponse.json().assignments).toEqual([
      expect.objectContaining({
        trainingId: training.id,
        profileId: "profile_employee",
        status: "pending",
        training: expect.objectContaining({ title: "Padrão de atendimento" })
      })
    ]);

    await app.inject({
      method: "POST",
      url: `/trainings/${training.id}/attempts`,
      headers: employeeHeaders,
      payload: {
        answers: [{ question_id: training.quizQuestions[0].id, option_id: "a" }]
      }
    });
    const completedResponse = await app.inject({
      method: "GET",
      url: "/training-assignments?date=2026-07-07",
      headers: employeeHeaders
    });

    expect(completedResponse.json().assignments[0]).toMatchObject({
      status: "completed",
      score: 100,
      passed: true
    });
  });
});
