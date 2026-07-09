import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryProcessRepository } from "./in-memory-process.repository";

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

describe("process routes", () => {
  it("creates draft processes for managers", async () => {
    const app = buildApp({ processRepository: createInMemoryProcessRepository() });

    const response = await app.inject({
      method: "POST",
      url: "/processes",
      headers: managerHeaders,
      payload: {
        title: "Atendimento inicial",
        body: "Responder o cliente com saudação e pergunta de qualificação."
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().process).toMatchObject({
      workspaceId: "workspace_a",
      title: "Atendimento inicial",
      status: "draft",
      currentVersion: {
        version: 1,
        editorProfileId: "profile_manager"
      }
    });
  });

  it("rejects process creation for employees", async () => {
    const app = buildApp({ processRepository: createInMemoryProcessRepository() });

    const response = await app.inject({
      method: "POST",
      url: "/processes",
      headers: employeeHeaders,
      payload: {
        title: "Atendimento inicial",
        body: "Responder cliente."
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it("lists processes for the current workspace", async () => {
    const app = buildApp({ processRepository: createInMemoryProcessRepository() });

    await app.inject({
      method: "POST",
      url: "/processes",
      headers: managerHeaders,
      payload: {
        title: "Fechamento de caixa",
        body: "Conferir caixa."
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/processes",
      headers: managerHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().processes).toHaveLength(1);
  });

  it("creates versions and publishes processes", async () => {
    const app = buildApp({ processRepository: createInMemoryProcessRepository() });
    const createResponse = await app.inject({
      method: "POST",
      url: "/processes",
      headers: managerHeaders,
      payload: {
        title: "Fechamento de caixa",
        body: "Conferir caixa."
      }
    });

    const processId = createResponse.json().process.id;
    const versionResponse = await app.inject({
      method: "POST",
      url: `/processes/${processId}/versions`,
      headers: managerHeaders,
      payload: {
        body: "Conferir caixa e fotografar comprovantes.",
        change_note: "Inclui foto obrigatória."
      }
    });

    expect(versionResponse.statusCode).toBe(201);
    expect(versionResponse.json().process.currentVersion.version).toBe(2);

    const publishResponse = await app.inject({
      method: "POST",
      url: `/processes/${processId}/publish`,
      headers: managerHeaders
    });

    expect(publishResponse.statusCode).toBe(200);
    expect(publishResponse.json().process.status).toBe("published");
  });

  it("unpublishes processes back to draft without deleting their versions", async () => {
    const app = buildApp({ processRepository: createInMemoryProcessRepository() });
    const createResponse = await app.inject({
      method: "POST",
      url: "/processes",
      headers: managerHeaders,
      payload: {
        title: "Aprovação de peças",
        body: "Revisar peça antes de enviar."
      }
    });

    const processId = createResponse.json().process.id;
    await app.inject({
      method: "POST",
      url: `/processes/${processId}/publish`,
      headers: managerHeaders
    });

    const unpublishResponse = await app.inject({
      method: "POST",
      url: `/processes/${processId}/unpublish`,
      headers: managerHeaders
    });

    expect(unpublishResponse.statusCode).toBe(200);
    expect(unpublishResponse.json().process).toMatchObject({
      status: "draft",
      publishedAt: null
    });
    expect(unpublishResponse.json().process.versions).toHaveLength(1);
  });

  it("deletes processes created in the app", async () => {
    const app = buildApp({ processRepository: createInMemoryProcessRepository() });
    const createResponse = await app.inject({
      method: "POST",
      url: "/processes",
      headers: managerHeaders,
      payload: {
        title: "Preparar entregável técnico",
        body: "Confirmar escopo, produzir arquivo e registrar evidência."
      }
    });

    const processId = createResponse.json().process.id;
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/processes/${processId}`,
      headers: managerHeaders
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ ok: true });

    const listResponse = await app.inject({
      method: "GET",
      url: "/processes",
      headers: managerHeaders
    });
    expect(listResponse.json().processes).toEqual([]);
  });
});
