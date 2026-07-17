import { describe, expect, it } from "vitest";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioService } from "./studio.service";
import { createInMemoryStudioSharingStore } from "./studio-sharing.store";
import { createStudioSharingService } from "./studio-sharing.service";

const workspaceId = "workspace_a";

async function setup() {
  const now = () => "2026-07-17T12:00:00.000Z";
  const companyRepository = createInMemoryCompanyRepository({ now });
  const ownerA = await companyRepository.createTeamMember({ workspaceId, name: "Ana", email: "ana@test.local", role: "owner",
    areaId: null, roleTemplateId: null, createdByProfileId: "system" });
  const ownerB = await companyRepository.createTeamMember({ workspaceId, name: "Bruno", email: "bruno@test.local", role: "owner",
    areaId: null, roleTemplateId: null, createdByProfileId: "system" });
  const employee = await companyRepository.createTeamMember({ workspaceId, name: "Eva", email: "eva@test.local", role: "employee",
    areaId: null, roleTemplateId: null, createdByProfileId: "system" });
  const repository = createInMemoryStudioRepository({ now });
  const studioService = createStudioService(repository, { now });
  const sharing = createStudioSharingService({ store: createInMemoryStudioSharingStore(), repository, studioService, companyRepository, now });
  const a = { workspaceId, ownerProfileId: ownerA.id };
  const b = { workspaceId, ownerProfileId: ownerB.id };
  const document = await studioService.createDocument(a, ownerA.id, { title: "Estratégia", body_json: { type: "doc", content: [] },
    body_text: "Plano original", capture_mode: "text" });
  return { companyRepository, repository, studioService, sharing, a, b, employee, document };
}

describe("StudioSharingService", () => {
  it("shares nominally, supports general comments, and imports an independent idempotent copy", async () => {
    const { sharing, studioService, a, b, document } = await setup();
    await sharing.replaceShares(a, document.id, [{ type: "owner", profileId: b.ownerProfileId }]);
    expect((await sharing.listSharedWithMe(b))[0]).toMatchObject({ document: { id: document.id }, author: { name: "Ana" } });
    const comment = await sharing.addComment(b, document.id, "Vamos revisar juntos.");
    expect(await sharing.listComments(a, document.id)).toEqual([comment]);

    const first = await sharing.importSheet(b, document.id, "import-1");
    const repeated = await sharing.importSheet(b, document.id, "import-1");
    expect(repeated.id).toBe(first.id);
    await studioService.updateDocument(a, a.ownerProfileId, document.id, { revision: document.revision, body_text: "Fonte alterada" });
    expect((await studioService.getDocument(b, first.id)).bodyText).toBe("Plano original");
    expect(await sharing.readImportUpdate(b, first.id)).toMatchObject({ status: "updated", source: { currentRevision: 2 } });

    await sharing.replaceShares(a, document.id, []);
    expect(await sharing.readImportUpdate(b, first.id)).toMatchObject({ status: "unavailable", sourceDocument: null });
    expect((await studioService.getDocument(b, first.id)).bodyText).toBe("Plano original");
  });

  it("keeps all-owner sharing dynamic and rejects non-owner nominal recipients", async () => {
    const { sharing, a, b, employee, document } = await setup();
    await sharing.replaceShares(a, document.id, [{ type: "all_owners" }]);
    expect(await sharing.listSharedWithMe(b)).toHaveLength(1);
    await expect(sharing.replaceShares(a, document.id, [{ type: "owner", profileId: employee.id }]))
      .rejects.toMatchObject({ code: "STUDIO_SHARE_RECIPIENT_INVALID" });
  });

  it("limits comment editing to its author while the source owner can moderate", async () => {
    const { sharing, a, b, document } = await setup();
    await sharing.replaceShares(a, document.id, [{ type: "owner", profileId: b.ownerProfileId }]);
    const comment = await sharing.addComment(b, document.id, "Primeira versão");
    await expect(sharing.editOwnComment(a, comment.id, "Tentativa")).rejects.toMatchObject({ code: "STUDIO_COMMENT_FORBIDDEN" });
    await sharing.moderateComment(a, document.id, comment.id);
    expect(await sharing.listComments(a, document.id)).toEqual([]);
  });
});

