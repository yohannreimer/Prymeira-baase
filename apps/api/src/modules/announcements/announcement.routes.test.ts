import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryAnnouncementRepository } from "./in-memory-announcement.repository";

const ownerHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "owner",
  "x-baase-profile-id": "profile_owner"
};

const employeeHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "employee",
  "x-baase-profile-id": "profile_employee"
};

describe("announcement routes", () => {
  it("creates, publishes, lists, and confirms an announcement", async () => {
    const app = buildApp({ announcementRepository: createInMemoryAnnouncementRepository() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/announcements",
      headers: ownerHeaders,
      payload: {
        title: "Novo fluxo de aprovação",
        body: "Toda peça precisa passar pelo gestor antes de ir ao cliente.",
        type: "process_change",
        requirement: "read_confirmation",
        audience_type: "all",
        related_process_id: "process_1"
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const announcement = createResponse.json().announcement;
    expect(announcement).toMatchObject({
      title: "Novo fluxo de aprovação",
      status: "draft",
      requirement: "read_confirmation",
      audience: { type: "all" }
    });

    const publishResponse = await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/publish`,
      headers: ownerHeaders
    });
    expect(publishResponse.statusCode).toBe(200);
    expect(publishResponse.json().announcement.status).toBe("published");

    const employeeListResponse = await app.inject({
      method: "GET",
      url: "/announcements",
      headers: employeeHeaders
    });
    expect(employeeListResponse.statusCode).toBe(200);
    expect(employeeListResponse.json().announcements).toEqual([
      expect.objectContaining({
        id: announcement.id,
        status: "published",
        receipt: expect.objectContaining({
          profileId: "profile_employee",
          status: "pending"
        })
      })
    ]);

    const confirmResponse = await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/confirm`,
      headers: employeeHeaders
    });
    expect(confirmResponse.statusCode).toBe(200);
    expect(confirmResponse.json().receipt).toMatchObject({
      announcementId: announcement.id,
      profileId: "profile_employee",
      status: "confirmed"
    });

    const receiptsResponse = await app.inject({
      method: "GET",
      url: `/announcement-receipts?announcement_id=${announcement.id}`,
      headers: ownerHeaders
    });
    expect(receiptsResponse.statusCode).toBe(200);
    expect(receiptsResponse.json().receipts).toEqual([
      expect.objectContaining({
        announcementId: announcement.id,
        profileId: "profile_employee",
        status: "confirmed"
      })
    ]);
  });

  it("requires a passing quiz answer when confirmation uses quiz", async () => {
    const app = buildApp({ announcementRepository: createInMemoryAnnouncementRepository() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/announcements",
      headers: ownerHeaders,
      payload: {
        title: "Mudança no atendimento",
        body: "A partir de hoje o primeiro retorno deve acontecer em até 15 minutos.",
        type: "simple",
        requirement: "quiz_confirmation",
        audience_type: "all",
        quiz_questions: [
          {
            prompt: "Qual é o prazo do primeiro retorno?",
            options: [
              { id: "a", label: "15 minutos" },
              { id: "b", label: "2 dias" }
            ],
            correct_option_id: "a"
          }
        ]
      }
    });
    const announcement = createResponse.json().announcement;
    await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/publish`,
      headers: ownerHeaders
    });

    const wrongResponse = await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/confirm`,
      headers: employeeHeaders,
      payload: {
        answers: [{ question_id: announcement.quizQuestions[0].id, option_id: "b" }]
      }
    });
    const correctResponse = await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/confirm`,
      headers: employeeHeaders,
      payload: {
        answers: [{ question_id: announcement.quizQuestions[0].id, option_id: "a" }]
      }
    });

    expect(wrongResponse.statusCode).toBe(200);
    expect(wrongResponse.json().receipt).toMatchObject({
      status: "pending",
      quizScore: 0,
      passed: false
    });
    expect(correctResponse.statusCode).toBe(200);
    expect(correctResponse.json().receipt).toMatchObject({
      status: "quiz_completed",
      quizScore: 100,
      passed: true
    });
  });

  it("rejects announcement creation for employees", async () => {
    const app = buildApp({ announcementRepository: createInMemoryAnnouncementRepository() });

    const response = await app.inject({
      method: "POST",
      url: "/announcements",
      headers: employeeHeaders,
      payload: {
        title: "Comunicado indevido",
        body: "Funcionário não pode publicar.",
        type: "simple",
        requirement: "read_confirmation",
        audience_type: "all"
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it("deletes announcements and their receipts", async () => {
    const app = buildApp({ announcementRepository: createInMemoryAnnouncementRepository() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/announcements",
      headers: ownerHeaders,
      payload: {
        title: "Mudança no processo comercial",
        body: "Registrar toda oportunidade no sistema.",
        type: "process_change",
        requirement: "read_confirmation",
        audience_type: "all"
      }
    });
    const announcement = createResponse.json().announcement;

    await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/publish`,
      headers: ownerHeaders
    });
    await app.inject({
      method: "POST",
      url: `/announcements/${announcement.id}/confirm`,
      headers: employeeHeaders
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/announcements/${announcement.id}`,
      headers: ownerHeaders
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ ok: true });

    const listResponse = await app.inject({
      method: "GET",
      url: "/announcements",
      headers: ownerHeaders
    });
    const receiptsResponse = await app.inject({
      method: "GET",
      url: `/announcement-receipts?announcement_id=${announcement.id}`,
      headers: ownerHeaders
    });

    expect(listResponse.json().announcements).toEqual([]);
    expect(receiptsResponse.json().receipts).toEqual([]);
  });
});
