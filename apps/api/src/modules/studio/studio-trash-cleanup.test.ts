import { describe, expect, it, vi } from "vitest";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioService } from "./studio.service";
import { createStudioTrashCleanupProcessor, STUDIO_TRASH_RETENTION_MS } from "./studio-trash-cleanup";

const owner = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
const otherOwner = { workspaceId: "workspace_a", ownerProfileId: "owner_b" };

describe("Studio trash retention cleanup", () => {
  it("claims and permanently removes only trash older than 30 days", async () => {
    let now = new Date("2026-07-15T12:00:00.000Z");
    const repository = createInMemoryStudioRepository({ now: () => now.toISOString() });
    const service = createStudioService(repository, { now: () => now.toISOString() });
    const expired = await service.createDocument(owner, owner.ownerProfileId, documentInput("Documento antigo"));
    const fresh = await service.createDocument(owner, owner.ownerProfileId, documentInput("Documento recente"));
    await repository.trashDocument(owner, expired.id, new Date(now.getTime() - STUDIO_TRASH_RETENTION_MS - 1).toISOString());
    await repository.trashDocument(owner, fresh.id, new Date(now.getTime() - STUDIO_TRASH_RETENTION_MS + 1).toISOString());

    const processor = createStudioTrashCleanupProcessor({ repository, service, now: () => now.toISOString() });
    await expect(processor.processNext()).resolves.toMatchObject({ id: expired.id, ownerProfileId: owner.ownerProfileId });
    await expect(repository.findDocument(owner, expired.id)).resolves.toBeNull();
    await expect(repository.findDocument(owner, fresh.id)).resolves.not.toBeNull();
    await expect(processor.processNext()).resolves.toBeNull();
  });

  it("leases a claim once, scopes deletion to its owner, and retries after lease expiry", async () => {
    let now = new Date("2026-07-15T12:00:00.000Z");
    const repository = createInMemoryStudioRepository({ now: () => now.toISOString() });
    const service = createStudioService(repository, { now: () => now.toISOString() });
    const left = await service.createDocument(owner, owner.ownerProfileId, documentInput("Mesmo id A"));
    const right = await service.createDocument(otherOwner, otherOwner.ownerProfileId, documentInput("Documento B"));
    const old = new Date(now.getTime() - STUDIO_TRASH_RETENTION_MS - 1).toISOString();
    await repository.trashDocument(owner, left.id, old);
    await repository.trashDocument(otherOwner, right.id, old);
    const blockedService = { ...service, permanentlyDeleteDocument: vi.fn(async () => { throw new Error("temporary"); }) };
    const processor = createStudioTrashCleanupProcessor({ repository, service: blockedService, now: () => now.toISOString(), leaseMs: 1_000 });

    const ownerKeys: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      try { await processor.processNext(); } catch (error) {
        expect(error).toMatchObject({ message: "temporary" });
        ownerKeys.push((error as Error & { studioMaintenanceOwnerKey: string }).studioMaintenanceOwnerKey);
      }
    }
    expect(ownerKeys.sort()).toEqual([
      `${owner.workspaceId}/${owner.ownerProfileId}`,
      `${otherOwner.workspaceId}/${otherOwner.ownerProfileId}`
    ].sort());
    expect(await repository.findDocument(owner, left.id)).not.toBeNull();
    expect(await repository.findDocument(otherOwner, right.id)).not.toBeNull();
    now = new Date(now.getTime() + 1_001);
    await expect(processor.processNext()).rejects.toThrow("temporary");
  });
});

function documentInput(title: string) {
  return { title, body_json: { type: "doc", content: [] }, body_text: title, capture_mode: "text" as const };
}
