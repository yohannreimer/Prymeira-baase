import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";

describe("Studio sharing routes", () => {
  it("runs the owner share, comment, and import flow through the application", async () => {
    const companyRepository = createInMemoryCompanyRepository();
    const ownerA = await companyRepository.createTeamMember({ workspaceId: "workspace_a", name: "Ana", email: null,
      role: "owner", areaId: null, roleTemplateId: null, createdByProfileId: "system" });
    const ownerB = await companyRepository.createTeamMember({ workspaceId: "workspace_a", name: "Bruno", email: null,
      role: "owner", areaId: null, roleTemplateId: null, createdByProfileId: "system" });
    const headers = (profileId: string, role = "owner") => ({ "x-baase-workspace-id": "workspace_a", "x-baase-profile-id": profileId, "x-baase-role": role });
    const app = buildApp({ companyRepository });
    const created = await app.inject({ method: "POST", url: "/studio/documents", headers: headers(ownerA.id), payload: {
      title: "Folha compartilhada", body_json: { type: "doc", content: [] }, body_text: "Conteúdo", capture_mode: "text"
    } });
    const documentId = created.json().document.id as string;

    expect((await app.inject({ method: "PUT", url: `/studio/documents/${documentId}/shares`, headers: headers(ownerA.id),
      payload: { audiences: [{ type: "owner", profileId: ownerB.id }] } })).statusCode).toBe(200);
    const shared = await app.inject({ method: "GET", url: "/studio/documents/shared", headers: headers(ownerB.id) });
    expect(shared.statusCode).toBe(200);
    expect(shared.json().documents[0].document.id).toBe(documentId);
    expect((await app.inject({ method: "POST", url: `/studio/documents/${documentId}/comments`, headers: headers(ownerB.id),
      payload: { body: "Comentário geral" } })).statusCode).toBe(201);
    const imported = await app.inject({ method: "POST", url: `/studio/documents/${documentId}/import`, headers: {
      ...headers(ownerB.id), "idempotency-key": "route-import-1"
    } });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().document.ownerProfileId).toBe(ownerB.id);

    expect((await app.inject({ method: "GET", url: "/studio/documents/shared", headers: headers(ownerB.id, "employee") })).statusCode).toBe(403);
    await app.close();
  });
});

