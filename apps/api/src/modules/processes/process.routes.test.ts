import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import type { AuthenticatedRequest } from "../../http/auth-context";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";
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

  it("lists published processes from an employee's area without a task assignment", async () => {
    const companyRepository = createInMemoryCompanyRepository();
    const finance = await companyRepository.createArea({
      workspaceId: "workspace_a",
      name: "Financeiro e Controle",
      description: null
    });
    const technical = await companyRepository.createArea({
      workspaceId: "workspace_a",
      name: "Técnico",
      description: null
    });
    const employee = await companyRepository.createTeamMember({
      workspaceId: "workspace_a",
      name: "Teste",
      email: "teste@example.com",
      role: "employee",
      areaId: finance.id,
      areaAccessIds: [finance.id],
      roleTemplateId: null,
      accessScope: "assigned_only",
      createdByProfileId: "seed"
    });
    const app = buildApp({ companyRepository, processRepository: createInMemoryProcessRepository() });
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-test-as-employee"] !== "true") return;
      (request as AuthenticatedRequest).baaseContext = {
        workspaceId: "workspace_a",
        role: "employee",
        profileId: employee.id,
        operationalMembership: {
          person: employee,
          personId: employee.id,
          role: "employee",
          accessScope: employee.accessScope,
          areaAccessIds: employee.areaAccessIds
        }
      };
    });

    const create = async (title: string, areaId: string) => (await app.inject({
      method: "POST",
      url: "/processes",
      headers: managerHeaders,
      payload: { title, body: "Instrução operacional.", area_id: areaId }
    })).json().process;
    const financePublished = await create("Conferir fluxo financeiro", finance.id);
    const technicalPublished = await create("Executar entrega técnica", technical.id);
    await app.inject({ method: "POST", url: `/processes/${financePublished.id}/publish`, headers: managerHeaders });
    await app.inject({ method: "POST", url: `/processes/${technicalPublished.id}/publish`, headers: managerHeaders });
    await create("Rascunho financeiro", finance.id);

    const response = await app.inject({
      method: "GET",
      url: "/processes",
      headers: { ...employeeHeaders, "x-baase-profile-id": employee.id, "x-test-as-employee": "true" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().processes.map((process: { id: string }) => process.id)).toEqual([financePublished.id]);
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

  it("edits a process as a versioned operation with one responsible owner and link materials", async () => {
    const companyRepository = createInMemoryCompanyRepository();
    const area = await companyRepository.createArea({
      workspaceId: "workspace_a",
      name: "Financeiro",
      description: null
    });
    const roleTemplate = await companyRepository.createRoleTemplate({
      workspaceId: "workspace_a",
      areaId: area.id,
      name: "Controlador financeiro",
      description: null
    });
    const app = buildApp({
      companyRepository,
      processRepository: createInMemoryProcessRepository()
    });

    const created = await app.inject({
      method: "POST",
      url: "/processes",
      headers: managerHeaders,
      payload: {
        title: "Fechamento de caixa",
        body: "Conferir entradas e saídas.",
        area_id: area.id
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/processes/${created.json().process.id}`,
      headers: managerHeaders,
      payload: {
        title: "Fechamento financeiro diário",
        body: "Conferir entradas, saídas e comprovantes.",
        change_note: "Define a responsabilidade e a fonte oficial.",
        owner: { type: "role", role_template_id: roleTemplate.id },
        materials: [{
          kind: "link",
          title: "Planilha oficial",
          url: "https://example.com/fechamento"
        }]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().process).toMatchObject({
      title: "Fechamento financeiro diário",
      currentVersion: {
        version: 2,
        changeNote: "Define a responsabilidade e a fonte oficial."
      },
      owner: { type: "role", roleTemplateId: roleTemplate.id },
      materials: [{
        kind: "link",
        title: "Planilha oficial",
        url: "https://example.com/fechamento"
      }]
    });
    expect(response.json().process.versions).toHaveLength(2);

    const cleared = await app.inject({
      method: "PATCH",
      url: `/processes/${created.json().process.id}`,
      headers: managerHeaders,
      payload: {
        body: "Conferir entradas, saídas e comprovantes.",
        change_note: "Remove responsabilidade fixa.",
        owner: null
      }
    });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().process.owner).toBeNull();
  });

  it("rejects a process edit without a meaningful change note", async () => {
    const app = buildApp({ processRepository: createInMemoryProcessRepository() });
    const created = await app.inject({
      method: "POST",
      url: "/processes",
      headers: managerHeaders,
      payload: { title: "Processo", body: "Versão inicial." }
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/processes/${created.json().process.id}`,
      headers: managerHeaders,
      payload: { body: "Versão alterada.", change_note: "   " }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("REQUEST_VALIDATION_ERROR");
  });

  it("rejects a responsible person outside the current workspace", async () => {
    const app = buildApp({ processRepository: createInMemoryProcessRepository() });
    const created = await app.inject({
      method: "POST",
      url: "/processes",
      headers: managerHeaders,
      payload: { title: "Processo", body: "Versão inicial." }
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/processes/${created.json().process.id}`,
      headers: managerHeaders,
      payload: {
        body: "Versão alterada.",
        change_note: "Tentativa com pessoa inválida.",
        owner: { type: "person", person_id: "person_other_workspace" }
      }
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("PROCESS_OWNER_PERSON_NOT_FOUND");
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
