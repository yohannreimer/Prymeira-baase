import { describe, expect, it } from "vitest";
import { createCompanyService } from "./company.service";
import { createInMemoryCompanyRepository } from "./in-memory-company.repository";

describe("company service", () => {
  it("creates areas inside the current workspace", async () => {
    const service = createCompanyService(createInMemoryCompanyRepository());

    const area = await service.createArea("workspace_a", {
      name: "Atendimento",
      description: "Relacionamento com clientes"
    });

    expect(area).toMatchObject({
      workspaceId: "workspace_a",
      name: "Atendimento",
      description: "Relacionamento com clientes",
      sortOrder: 1
    });

    await expect(service.listAreas("workspace_a")).resolves.toEqual([area]);
    await expect(service.listAreas("workspace_b")).resolves.toEqual([]);
  });

  it("trims area names and rejects empty names", async () => {
    const service = createCompanyService(createInMemoryCompanyRepository());

    await expect(service.createArea("workspace_a", { name: "   " })).rejects.toThrow("AREA_NAME_REQUIRED");

    const area = await service.createArea("workspace_a", { name: "  Financeiro  " });

    expect(area.name).toBe("Financeiro");
  });

  it("creates role templates linked to an area in the same workspace", async () => {
    const service = createCompanyService(createInMemoryCompanyRepository());
    const area = await service.createArea("workspace_a", { name: "Atendimento" });

    const roleTemplate = await service.createRoleTemplate("workspace_a", {
      areaId: area.id,
      name: "Atendente",
      description: "Responsável pelo primeiro atendimento"
    });

    expect(roleTemplate).toMatchObject({
      workspaceId: "workspace_a",
      areaId: area.id,
      name: "Atendente",
      description: "Responsável pelo primeiro atendimento"
    });

    await expect(service.listRoleTemplates("workspace_a")).resolves.toEqual([roleTemplate]);
    await expect(service.listRoleTemplates("workspace_b")).resolves.toEqual([]);
  });

  it("rejects role templates for areas outside the workspace", async () => {
    const service = createCompanyService(createInMemoryCompanyRepository());
    const area = await service.createArea("workspace_a", { name: "Atendimento" });

    await expect(
      service.createRoleTemplate("workspace_b", {
        areaId: area.id,
        name: "Atendente"
      })
    ).rejects.toThrow("AREA_NOT_FOUND");
  });

  it("rejects invites with a missing area or a role from another area", async () => {
    const service = createCompanyService(createInMemoryCompanyRepository());
    const operations = await service.createArea("workspace_a", { name: "Operações" });
    const finance = await service.createArea("workspace_a", { name: "Financeiro" });
    const role = await service.createRoleTemplate("workspace_a", { areaId: operations.id, name: "Analista" });

    await expect(service.createTeamInvite("workspace_a", {
      name: "Ana", role: "employee", areaId: "area_missing", createdByProfileId: "owner_1"
    })).rejects.toThrow("AREA_NOT_FOUND");

    await expect(service.createTeamInvite("workspace_a", {
      name: "Ana", role: "employee", areaId: finance.id, roleTemplateId: role.id, createdByProfileId: "owner_1"
    })).rejects.toThrow("ROLE_TEMPLATE_AREA_MISMATCH");
  });
});
