import { describe, expect, it } from "vitest";
import { createInMemoryProcessRepository } from "../processes/in-memory-process.repository";
import { createInMemoryStudioRepository } from "../studio/in-memory-studio.repository";
import { createInMemoryObjectStorage } from "../../storage/in-memory-object-storage";
import { createPublicationService } from "./publication.service";
import { createInMemoryPublicationStore } from "./publication.store";

describe("PublicationService", () => {
  it("renders an owner sheet, stores it and creates an expiring external access", async () => {
    const date = new Date("2026-07-17T12:00:00.000Z");
    const studioRepository = createInMemoryStudioRepository({ now: () => date.toISOString() });
    const document = await studioRepository.createDocument({
      workspaceId: "workspace_a", ownerProfileId: "owner_a", title: "Plano 2027",
      bodyJson: {}, bodyText: "# Direção\nCrescer com qualidade.", captureMode: "text", inboxState: "reviewed",
      isFocused: true, status: "active", trashedAt: null, preTrashStatus: null
    });
    let rendered = "";
    const objectStorage = createInMemoryObjectStorage();
    const service = createPublicationService({
      store: createInMemoryPublicationStore(() => date),
      renderer: { async renderPdf(html) { rendered = html; return Buffer.from("pdf-test"); } },
      objectStorage, studioRepository,
      processRepository: createInMemoryProcessRepository(), now: () => date
    });
    const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
    const publication = await service.create({ ...scope, resourceType: "studio_document", resourceId: document.id,
      format: "pdf", workspaceName: "Acme", profileName: "Ana" });
    expect(publication).toMatchObject({ status: "ready", format: "pdf", title: "Plano 2027", sizeBytes: 8 });
    expect(rendered).toContain("Plano 2027");
    expect(await service.createDownloadUrl(scope, publication.id)).toContain("memory://publications");

    const external = await service.createExternalGrant(scope, publication.id, "2026-07-20T12:00:00.000Z");
    expect((await service.resolveExternal(external.token)).publication.id).toBe(publication.id);
    await service.revokeExternalGrant(scope, publication.id, external.grant.id);
    await expect(service.resolveExternal(external.token)).rejects.toMatchObject({ message: "PUBLICATION_LINK_UNAVAILABLE" });

    const bundle = await service.create({ ...scope, resourceType: "studio_document", resourceId: document.id,
      format: "zip", workspaceName: "Acme", profileName: "Ana" });
    const stored = await objectStorage.get(bundle.objectKey!);
    const chunks: Buffer[] = [];
    for await (const chunk of stored.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const zip = Buffer.concat(chunks);
    expect(zip.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(zip.toString("utf8")).toContain("Plano-2027.pdf");
  });
});
