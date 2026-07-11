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
  it("returns 409 for a deterministic invite code collision", async () => {
    const base = createInMemoryCompanyRepository();
    const app = buildApp({
      companyRepository: {
        ...base,
        createTeamInvite: async () => { throw new Error("INVITE_CODE_CONFLICT"); }
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/invites",
      headers: ownerHeaders,
      payload: { name: "Carla Dias", role: "employee", access_scope: "workspace" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("INVITE_CODE_CONFLICT");
  });

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

  it("requires impact resolution through the deprecated delete alias", async () => {
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

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("AREA_ARCHIVE_RESOLUTION_REQUIRED");

    const archiveResponse = await app.inject({
      method: "POST",
      url: `/areas/${areaResponse.json().area.id}/archive`,
      headers: ownerHeaders,
      payload: { strategy: "unassign" }
    });
    expect(archiveResponse.statusCode).toBe(200);

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

  it("reports impact and reassigns all active links", async () => {
    const companyRepository = createInMemoryCompanyRepository();
    const app = buildApp({ companyRepository });
    const source = await app.inject({ method: "POST", url: "/areas", headers: ownerHeaders, payload: { name: "Operacao" } });
    const target = await app.inject({ method: "POST", url: "/areas", headers: ownerHeaders, payload: { name: "Financeiro" } });
    await app.inject({
      method: "POST", url: "/people", headers: ownerHeaders,
      payload: { name: "Ana", role: "employee", area_id: source.json().area.id }
    });

    const impact = await app.inject({ method: "GET", url: `/areas/${source.json().area.id}/impact`, headers: ownerHeaders });
    expect(impact.statusCode).toBe(200);
    expect(impact.json().impact).toMatchObject({
      area: { id: source.json().area.id },
      people: [{ name: "Ana" }]
    });

    const archive = await app.inject({
      method: "POST", url: `/areas/${source.json().area.id}/archive`, headers: ownerHeaders,
      payload: { strategy: "reassign", target_area_id: target.json().area.id }
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().result.reassigned.people).toBe(1);
    expect((await companyRepository.listTeamMembers("workspace_a"))[0]?.areaId).toBe(target.json().area.id);
  });

  it("isolates area lifecycle routes by workspace and permission", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });
    const source = await app.inject({ method: "POST", url: "/areas", headers: ownerHeaders, payload: { name: "Operacao" } });
    const otherWorkspace = { ...ownerHeaders, "x-baase-workspace-id": "workspace_b" };

    const isolated = await app.inject({ method: "GET", url: `/areas/${source.json().area.id}/impact`, headers: otherWorkspace });
    expect(isolated.statusCode).toBe(404);
    expect(isolated.json().error.code).toBe("AREA_NOT_FOUND");

    const forbidden = await app.inject({
      method: "POST", url: `/areas/${source.json().area.id}/archive`, headers: employeeHeaders,
      payload: { strategy: "unassign" }
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("FORBIDDEN");
  });

  it("returns deterministic errors for invalid archive targets", async () => {
    const companyRepository = createInMemoryCompanyRepository();
    const app = buildApp({ companyRepository });
    const source = await app.inject({ method: "POST", url: "/areas", headers: ownerHeaders, payload: { name: "Operacao" } });
    const sourceId = source.json().area.id;
    const archivedTarget = await app.inject({ method: "POST", url: "/areas", headers: ownerHeaders, payload: { name: "Arquivada" } });
    await app.inject({ method: "DELETE", url: `/areas/${archivedTarget.json().area.id}`, headers: ownerHeaders });
    await companyRepository.createArea({ workspaceId: "workspace_b", name: "Outra 1", description: null });
    await companyRepository.createArea({ workspaceId: "workspace_b", name: "Outra 2", description: null });
    const crossWorkspaceTarget = await companyRepository.createArea({ workspaceId: "workspace_b", name: "Outra 3", description: null });

    const same = await app.inject({
      method: "POST", url: `/areas/${sourceId}/archive`, headers: ownerHeaders,
      payload: { strategy: "reassign", target_area_id: sourceId }
    });
    expect(same.statusCode).toBe(400);
    expect(same.json().error.code).toBe("AREA_ARCHIVE_TARGET_SAME");

    for (const targetAreaId of ["missing", archivedTarget.json().area.id, crossWorkspaceTarget.id]) {
      const missing = await app.inject({
      method: "POST", url: `/areas/${sourceId}/archive`, headers: ownerHeaders,
        payload: { strategy: "reassign", target_area_id: targetAreaId }
      });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().error.code).toBe("AREA_ARCHIVE_TARGET_NOT_FOUND");
    }
  });

  it("allows the deprecated delete alias to archive an area with no impact", async () => {
    const app = buildApp({ companyRepository: createInMemoryCompanyRepository() });
    const area = await app.inject({ method: "POST", url: "/areas", headers: ownerHeaders, payload: { name: "Sem vinculos" } });
    const response = await app.inject({ method: "DELETE", url: `/areas/${area.json().area.id}`, headers: ownerHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: "/areas", headers: ownerHeaders })).json().areas).toEqual([]);
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

  it("returns 409 when an invite changes during deletion", async () => {
    const base = createInMemoryCompanyRepository();
    const app = buildApp({
      companyRepository: {
        ...base,
        deleteTeamInvite: async () => { throw new Error("INVITE_STALE"); }
      }
    });
    const inviteResponse = await app.inject({
      method: "POST",
      url: "/invites",
      headers: ownerHeaders,
      payload: { name: "Carla Dias", role: "employee", access_scope: "workspace" }
    });
    const response = await app.inject({
      method: "DELETE",
      url: `/invites/${inviteResponse.json().invite.id}`,
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("INVITE_STALE");
  });
});
