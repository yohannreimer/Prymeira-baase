import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";

describe("Studio portability app authorization", () => {
  it("rechecks the persisted active owner instead of trusting a stale owner header", async () => {
    const companyRepository = createInMemoryCompanyRepository();
    const manager = await companyRepository.createTeamMember({
      workspaceId: "workspace_a",
      name: "Gestor rebaixado",
      email: null,
      role: "manager",
      areaId: null,
      areaAccessIds: [],
      roleTemplateId: null,
      accessScope: "area",
      createdByProfileId: "owner_a"
    });
    const owner = await companyRepository.createTeamMember({
      workspaceId: "workspace_a",
      name: "Dona ativa",
      email: null,
      role: "owner",
      areaId: null,
      areaAccessIds: [],
      roleTemplateId: null,
      accessScope: "workspace",
      createdByProfileId: "owner_a"
    });
    const app = buildApp({ companyRepository });

    const stale = await app.inject({
      method: "POST", url: "/studio/export",
      headers: ownerHeaders(manager.id)
    });
    expect(stale.statusCode).toBe(403);

    const otherOwner = await app.inject({
      method: "POST", url: "/studio/export",
      headers: ownerHeaders("owner_not_in_workspace")
    });
    expect(otherOwner.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "POST", url: "/studio/export",
      headers: ownerHeaders(owner.id)
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json().export.downloadUrl).toContain("expires_in=900");

    await app.close();
  });
});

function ownerHeaders(profileId: string) {
  return {
    "x-baase-workspace-id": "workspace_a",
    "x-baase-profile-id": profileId,
    "x-baase-role": "owner"
  };
}
