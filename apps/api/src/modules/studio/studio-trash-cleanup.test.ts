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
    const blockedService = { ...service, permanentlyDeleteClaimedDocument: vi.fn(async () => { throw new Error("temporary"); }) };
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

  it("fences a stale worker after lease expiry and lets only the current token delete", async () => {
    let now = new Date("2026-07-15T12:00:00.000Z");
    const repository = createInMemoryStudioRepository({ now: () => now.toISOString() });
    const service = createStudioService(repository, { now: () => now.toISOString() });
    const document = await service.createDocument(owner, owner.ownerProfileId, documentInput("Documento disputado"));
    const old = new Date(now.getTime() - STUDIO_TRASH_RETENTION_MS - 1).toISOString();
    await repository.trashDocument(owner, document.id, old);
    const cutoff = new Date(now.getTime() - STUDIO_TRASH_RETENTION_MS).toISOString();
    const claimA = await repository.claimNextExpiredTrash(cutoff, now.toISOString(), 1_000);
    now = new Date(now.getTime() + 1_001);
    const claimB = await repository.claimNextExpiredTrash(cutoff, now.toISOString(), 1_000);

    expect(claimA?.claimToken).not.toBe(claimB?.claimToken);
    await expect(service.permanentlyDeleteClaimedDocument(
      owner, owner.ownerProfileId, document.id, claimA!.claimToken
    )).rejects.toThrow("STUDIO_TRASH_CLAIM_STALE");
    await expect(repository.findDocument(owner, document.id)).resolves.toMatchObject({ status: "trashed" });
    await expect(service.permanentlyDeleteClaimedDocument(
      owner, owner.ownerProfileId, document.id, claimB!.claimToken
    )).resolves.toBe(true);
    await expect(repository.findDocument(owner, document.id)).resolves.toBeNull();
  });

  it("invalidates a claim when the owner restores the document", async () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const repository = createInMemoryStudioRepository({ now: () => now.toISOString() });
    const service = createStudioService(repository, { now: () => now.toISOString() });
    const document = await service.createDocument(owner, owner.ownerProfileId, documentInput("Documento restaurado"));
    const old = new Date(now.getTime() - STUDIO_TRASH_RETENTION_MS - 1).toISOString();
    await repository.trashDocument(owner, document.id, old);
    const claim = await repository.claimNextExpiredTrash(
      new Date(now.getTime() - STUDIO_TRASH_RETENTION_MS).toISOString(), now.toISOString(), 1_000
    );
    await service.restoreDocumentFromTrash(owner, owner.ownerProfileId, document.id);

    await expect(service.permanentlyDeleteClaimedDocument(
      owner, owner.ownerProfileId, document.id, claim!.claimToken
    )).rejects.toThrow("STUDIO_TRASH_CLAIM_STALE");
    await expect(repository.findDocument(owner, document.id)).resolves.toMatchObject({ status: "active" });
  });

  it("passes the exact repository claim token to retention finalization", async () => {
    const claim = {
      id: "expired", workspaceId: owner.workspaceId, ownerProfileId: owner.ownerProfileId,
      claimToken: "claim_current", leaseExpiresAt: "2026-07-15T12:02:00.000Z"
    };
    const repository = { claimNextExpiredTrash: vi.fn(async () => claim) };
    const service = { permanentlyDeleteClaimedDocument: vi.fn(async () => true) };
    const processor = createStudioTrashCleanupProcessor({
      repository: repository as never, service, now: () => "2026-07-15T12:00:00.000Z"
    });
    await processor.processNext();
    expect(service.permanentlyDeleteClaimedDocument).toHaveBeenCalledWith(
      owner, owner.ownerProfileId, claim.id, claim.claimToken
    );
  });

  it("blocks restore and lease reclaim while claimed cleanup callbacks are running", async () => {
    let now = new Date("2026-07-15T12:00:00.000Z");
    let cleanupStarted!: () => void;
    let releaseCleanup!: () => void;
    const started = new Promise<void>((resolve) => { cleanupStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    const repository = createInMemoryStudioRepository({ now: () => now.toISOString() });
    const service = createStudioService(repository, {
      now: () => now.toISOString(),
      removeMemory: async () => { cleanupStarted(); await blocked; }
    });
    const document = await service.createDocument(owner, owner.ownerProfileId, documentInput("Documento em limpeza"));
    const old = new Date(now.getTime() - STUDIO_TRASH_RETENTION_MS - 1).toISOString();
    await repository.trashDocument(owner, document.id, old);
    const cutoff = new Date(now.getTime() - STUDIO_TRASH_RETENTION_MS).toISOString();
    const claim = await repository.claimNextExpiredTrash(cutoff, now.toISOString(), 1_000);
    const deletion = service.permanentlyDeleteClaimedDocument(
      owner, owner.ownerProfileId, document.id, claim!.claimToken
    );
    await started;

    await expect(service.restoreDocumentFromTrash(owner, owner.ownerProfileId, document.id))
      .rejects.toThrow("STUDIO_DOCUMENT_DELETE_IN_PROGRESS");
    now = new Date(now.getTime() + 1_001);
    await expect(repository.claimNextExpiredTrash(cutoff, now.toISOString(), 1_000)).resolves.toBeNull();
    releaseCleanup();
    await expect(deletion).resolves.toBe(true);
  });
});

function documentInput(title: string) {
  return { title, body_json: { type: "doc", content: [] }, body_text: title, capture_mode: "text" as const };
}
