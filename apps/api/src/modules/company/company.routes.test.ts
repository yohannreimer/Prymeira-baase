import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryCompanyRepository } from "./in-memory-company.repository";

const ownerHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "owner"
};

const employeeHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "employee"
};

describe("company routes", () => {
  it("lists areas for the current workspace", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const response = await app.inject({
      method: "GET",
      url: "/areas",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ areas: [] });
  });

  it("creates areas for owners", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const response = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: {
        name: "Atendimento",
        description: "Relacionamento com clientes"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().area).toMatchObject({
      workspaceId: "workspace_a",
      name: "Atendimento",
      description: "Relacionamento com clientes"
    });
  });

  it("rejects area creation for employees", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const response = await app.inject({
      method: "POST",
      url: "/areas",
      headers: employeeHeaders,
      payload: {
        name: "Financeiro"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Você não tem permissão para executar esta ação.",
        details: {}
      }
    });
  });

  it("renames existing company areas", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const areaResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: {
        name: "Treinamentos e Capacitação do Cliente",
        description: "Treinos de cliente"
      }
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/areas/${areaResponse.json().area.id}`,
      headers: ownerHeaders,
      payload: {
        name: "Treinamentos Técnicos",
        description: "Treinamentos, implantação e entregáveis técnicos."
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().area).toMatchObject({
      id: areaResponse.json().area.id,
      name: "Treinamentos Técnicos",
      description: "Treinamentos, implantação e entregáveis técnicos."
    });
  });

  it("deletes an area, removes its cargos and keeps people unassigned", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const areaResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: { name: "Implantação técnica" }
    });
    const roleResponse = await app.inject({
      method: "POST",
      url: "/roles",
      headers: ownerHeaders,
      payload: {
        area_id: areaResponse.json().area.id,
        name: "Técnico de implantação"
      }
    });
    const personResponse = await app.inject({
      method: "POST",
      url: "/people",
      headers: ownerHeaders,
      payload: {
        name: "André",
        role: "employee",
        area_id: areaResponse.json().area.id,
        role_template_id: roleResponse.json().role_template.id
      }
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/areas/${areaResponse.json().area.id}`,
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    const areasResponse = await app.inject({ method: "GET", url: "/areas", headers: ownerHeaders });
    const rolesResponse = await app.inject({ method: "GET", url: "/roles", headers: ownerHeaders });
    const peopleResponse = await app.inject({ method: "GET", url: "/people", headers: ownerHeaders });

    expect(areasResponse.json().areas).toEqual([]);
    expect(rolesResponse.json().role_templates).toEqual([]);
    expect(peopleResponse.json().people).toEqual([
      expect.objectContaining({
        id: personResponse.json().person.id,
        name: "André",
        areaId: null,
        roleTemplateId: null
      })
    ]);
  });

  it("creates role templates linked to existing areas", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const areaResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: { name: "Atendimento" }
    });

    const roleResponse = await app.inject({
      method: "POST",
      url: "/roles",
      headers: ownerHeaders,
      payload: {
        area_id: areaResponse.json().area.id,
        name: "Atendente"
      }
    });

    expect(roleResponse.statusCode).toBe(201);
    expect(roleResponse.json().role_template).toMatchObject({
      workspaceId: "workspace_a",
      areaId: areaResponse.json().area.id,
      name: "Atendente"
    });
  });

  it("deletes a role template and keeps linked people in the area without cargo", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const areaResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: { name: "Comercial" }
    });
    const roleResponse = await app.inject({
      method: "POST",
      url: "/roles",
      headers: ownerHeaders,
      payload: {
        area_id: areaResponse.json().area.id,
        name: "Vendedor Consultivo"
      }
    });
    const personResponse = await app.inject({
      method: "POST",
      url: "/people",
      headers: ownerHeaders,
      payload: {
        name: "Cláudio",
        role: "employee",
        area_id: areaResponse.json().area.id,
        role_template_id: roleResponse.json().role_template.id
      }
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/roles/${roleResponse.json().role_template.id}`,
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    const rolesResponse = await app.inject({ method: "GET", url: "/roles", headers: ownerHeaders });
    const peopleResponse = await app.inject({ method: "GET", url: "/people", headers: ownerHeaders });

    expect(rolesResponse.json().role_templates).toEqual([]);
    expect(peopleResponse.json().people).toEqual([
      expect.objectContaining({
        id: personResponse.json().person.id,
        areaId: areaResponse.json().area.id,
        roleTemplateId: null
      })
    ]);
  });

  it("creates invites with role template and access scope", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const areaResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: { name: "Criação" }
    });
    const roleResponse = await app.inject({
      method: "POST",
      url: "/roles",
      headers: ownerHeaders,
      payload: {
        area_id: areaResponse.json().area.id,
        name: "Designer"
      }
    });

    const inviteResponse = await app.inject({
      method: "POST",
      url: "/invites",
      headers: ownerHeaders,
      payload: {
        name: "Bruno Costa",
        email: "bruno@estudionorte.com",
        role: "employee",
        area_id: areaResponse.json().area.id,
        role_template_id: roleResponse.json().role_template.id,
        access_scope: "assigned_only"
      }
    });

    expect(inviteResponse.statusCode).toBe(201);
    expect(inviteResponse.json().invite).toMatchObject({
      name: "Bruno Costa",
      roleTemplateId: roleResponse.json().role_template.id,
      accessScope: "assigned_only",
      code: "BAASE-0001"
    });
  });

  it("previews invites by code without requiring workspace headers", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const areaResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: { name: "Criação" }
    });
    const roleResponse = await app.inject({
      method: "POST",
      url: "/roles",
      headers: ownerHeaders,
      payload: {
        area_id: areaResponse.json().area.id,
        name: "Designer"
      }
    });
    const inviteResponse = await app.inject({
      method: "POST",
      url: "/invites",
      headers: ownerHeaders,
      payload: {
        name: "Bruno Costa",
        email: "bruno@estudionorte.com",
        role: "employee",
        area_id: areaResponse.json().area.id,
        role_template_id: roleResponse.json().role_template.id,
        access_scope: "area"
      }
    });

    const previewResponse = await app.inject({
      method: "GET",
      url: `/invites/${inviteResponse.json().invite.code}`
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json().invite).toMatchObject({
      name: "Bruno Costa",
      email: "bruno@estudionorte.com",
      role: "employee",
      areaId: areaResponse.json().area.id,
      roleTemplateId: roleResponse.json().role_template.id,
      accessScope: "area",
      status: "pending"
    });
  });

  it("accepts an invite code, creates a team member, and marks the invite accepted", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const areaResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: { name: "Atendimento" }
    });
    const roleResponse = await app.inject({
      method: "POST",
      url: "/roles",
      headers: ownerHeaders,
      payload: {
        area_id: areaResponse.json().area.id,
        name: "Atendente"
      }
    });
    const inviteResponse = await app.inject({
      method: "POST",
      url: "/invites",
      headers: ownerHeaders,
      payload: {
        name: "Maria Souza",
        email: "maria@empresa.com",
        role: "employee",
        area_id: areaResponse.json().area.id,
        role_template_id: roleResponse.json().role_template.id,
        access_scope: "assigned_only"
      }
    });

    const acceptResponse = await app.inject({
      method: "POST",
      url: `/invites/${inviteResponse.json().invite.code}/accept`,
      payload: {
        name: "Maria Souza",
        email: "maria@empresa.com"
      }
    });

    expect(acceptResponse.statusCode).toBe(200);
    expect(acceptResponse.json().person).toMatchObject({
      name: "Maria Souza",
      email: "maria@empresa.com",
      role: "employee",
      areaId: areaResponse.json().area.id,
      roleTemplateId: roleResponse.json().role_template.id,
      status: "active"
    });
    expect(acceptResponse.json().invite).toMatchObject({
      code: inviteResponse.json().invite.code,
      status: "accepted"
    });

    const peopleResponse = await app.inject({
      method: "GET",
      url: "/people",
      headers: ownerHeaders
    });

    expect(peopleResponse.json().people).toHaveLength(1);
    expect(peopleResponse.json().people[0]).toMatchObject({ name: "Maria Souza" });
  });

  it("updates a team member role, area and role template", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const atendimentoResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: { name: "Atendimento" }
    });
    const criacaoResponse = await app.inject({
      method: "POST",
      url: "/areas",
      headers: ownerHeaders,
      payload: { name: "Criação" }
    });
    const roleResponse = await app.inject({
      method: "POST",
      url: "/roles",
      headers: ownerHeaders,
      payload: {
        area_id: criacaoResponse.json().area.id,
        name: "Designer"
      }
    });
    const personResponse = await app.inject({
      method: "POST",
      url: "/people",
      headers: ownerHeaders,
      payload: {
        name: "Bruno Costa",
        email: "bruno@empresa.com",
        role: "employee",
        area_id: atendimentoResponse.json().area.id
      }
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/people/${personResponse.json().person.id}`,
      headers: ownerHeaders,
      payload: {
        name: "Bruno Costa",
        email: "bruno@empresa.com",
        role: "manager",
        area_id: criacaoResponse.json().area.id,
        role_template_id: roleResponse.json().role_template.id,
        status: "active"
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().person).toMatchObject({
      id: personResponse.json().person.id,
      role: "manager",
      areaId: criacaoResponse.json().area.id,
      roleTemplateId: roleResponse.json().role_template.id,
      status: "active"
    });
  });

  it("deletes team members created in the app", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const personResponse = await app.inject({
      method: "POST",
      url: "/people",
      headers: ownerHeaders,
      payload: {
        name: "Peterson",
        email: "peterson@empresa.com",
        role: "employee"
      }
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/people/${personResponse.json().person.id}`,
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    const peopleResponse = await app.inject({
      method: "GET",
      url: "/people",
      headers: ownerHeaders
    });
    expect(peopleResponse.json().people).toEqual([]);
  });

  it("deletes pending invites created in the app", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const inviteResponse = await app.inject({
      method: "POST",
      url: "/invites",
      headers: ownerHeaders,
      payload: {
        name: "Carla Dias",
        role: "employee",
        access_scope: "workspace"
      }
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/invites/${inviteResponse.json().invite.id}`,
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    const invitesResponse = await app.inject({
      method: "GET",
      url: "/invites",
      headers: ownerHeaders
    });
    expect(invitesResponse.json().invites).toEqual([]);
  });

  it("rejects accepting an invite that was already accepted", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });

    const inviteResponse = await app.inject({
      method: "POST",
      url: "/invites",
      headers: ownerHeaders,
      payload: {
        name: "Carla Dias",
        role: "employee",
        access_scope: "workspace"
      }
    });

    await app.inject({
      method: "POST",
      url: `/invites/${inviteResponse.json().invite.code}/accept`
    });
    const secondAcceptResponse = await app.inject({
      method: "POST",
      url: `/invites/${inviteResponse.json().invite.code}/accept`
    });

    expect(secondAcceptResponse.statusCode).toBe(409);
    expect(secondAcceptResponse.json()).toMatchObject({
      error: {
        code: "INVITE_ALREADY_ACCEPTED"
      }
    });
  });
});
