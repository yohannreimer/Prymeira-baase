import { describe, expect, it } from "vitest";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioService } from "./studio.service";

const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
const otherScope = { workspaceId: "workspace_a", ownerProfileId: "owner_b" };

function createService() {
  return createStudioService(createInMemoryStudioRepository(), {
    now: () => "2026-07-13T12:00:00.000Z"
  });
}

function documentInput(bodyText = "Primeira ideia") {
  return {
    title: null,
    body_json: { type: "doc", content: [] },
    body_text: bodyText,
    capture_mode: "text" as const
  };
}

describe("StudioService documents", () => {
  it("creates, gets, and updates an owner document without mutating editor JSON", async () => {
    const service = createService();
    const bodyJson = { type: "doc", content: [{ type: "paragraph" }] };
    const created = await service.createDocument(scope, "owner_a", {
      ...documentInput("  Crescer   com qualidade  "),
      body_json: bodyJson
    });
    bodyJson.content.push({ type: "external_mutation" });

    expect(created).toMatchObject({
      title: null,
      bodyJson: { type: "doc", content: [{ type: "paragraph" }] },
      bodyText: "Crescer com qualidade",
      revision: 1,
      inboxState: "pending_review",
      isFocused: false,
      status: "active"
    });
    expect(await service.getDocument(scope, created.id)).toEqual(created);

    const updatedJson = { type: "doc", content: [{ type: "heading", attrs: { level: 1 } }] };
    const updated = await service.updateDocument(scope, "owner_a", created.id, {
      revision: created.revision,
      title: "Expansão",
      body_json: updatedJson,
      body_text: "Talvez crescer depois",
      inbox_state: "reviewed"
    });
    updatedJson.content[0]!.attrs.level = 2;

    expect(updated).toMatchObject({
      title: "Expansão",
      bodyJson: { type: "doc", content: [{ type: "heading", attrs: { level: 1 } }] },
      bodyText: "Talvez crescer depois",
      captureMode: "text",
      inboxState: "reviewed",
      revision: 2
    });
  });

  it("preserves every exact normalized body version", async () => {
    const service = createService();
    const original = await service.createDocument(scope, "owner_a", {
      title: null,
      body_json: { type: "doc", content: [] },
      body_text: "Crescer sem perder qualidade",
      capture_mode: "text"
    });
    const updated = await service.updateDocument(scope, "owner_a", original.id, {
      revision: original.revision,
      title: "Expansão",
      body_json: original.bodyJson,
      body_text: "Talvez crescer depois de estabilizar"
    });

    expect((await service.listVersions(scope, original.id)).map((item) => item.bodyText))
      .toEqual(["Crescer sem perder qualidade", "Talvez crescer depois de estabilizar"]);
    expect(updated.revision).toBe(2);
  });

  it("archives and restores documents with explicit lifecycle timestamps", async () => {
    const service = createService();
    const created = await service.createDocument(scope, "owner_a", documentInput());

    const archived = await service.archiveDocument(scope, "owner_a", created.id);
    expect(archived).toMatchObject({ status: "archived", archivedAt: "2026-07-13T12:00:00.000Z" });
    const restored = await service.restoreDocument(scope, "owner_a", created.id);
    expect(restored).toMatchObject({ status: "active", archivedAt: null });
  });

  it("sets focused state and builds a home view without operational KPIs", async () => {
    const service = createService();
    const focused = await service.createDocument(scope, "owner_a", documentInput("Foco"));
    const reviewed = await service.createDocument(scope, "owner_a", documentInput("Revisado"));
    await service.setFocused(scope, "owner_a", focused.id, true);
    await service.updateDocument(scope, "owner_a", reviewed.id, {
      revision: reviewed.revision,
      inbox_state: "reviewed"
    });

    const home = await service.readHome(scope);
    expect(home.focusedDocuments.map((item) => item.id)).toEqual([focused.id]);
    expect(new Set(home.recentDocuments.map((item) => item.id))).toEqual(new Set([focused.id, reviewed.id]));
    expect(home.pendingReviewCount).toBe(1);
    expect(home.nextRituals).toEqual([]);
    expect(home).not.toHaveProperty("kpis");
  });

  it("paginates by cursor and filters lifecycle status", async () => {
    const service = createService();
    const first = await service.createDocument(scope, "owner_a", documentInput("A"));
    const second = await service.createDocument(scope, "owner_a", documentInput("B"));
    const archived = await service.createDocument(scope, "owner_a", documentInput("C"));
    await service.archiveDocument(scope, "owner_a", archived.id);

    const activePage = await service.listDocuments(scope, { limit: 1, status: "active" });
    const nextActivePage = await service.listDocuments(scope, {
      limit: 1,
      status: "active",
      cursor: activePage.nextCursor ?? undefined
    });
    expect(new Set([...activePage.items, ...nextActivePage.items].map((item) => item.id)))
      .toEqual(new Set([first.id, second.id]));
    expect(nextActivePage.nextCursor).toBeNull();

    const archivedPage = await service.listDocuments(scope, { limit: 10, status: "archived" });
    expect(archivedPage.items.map((item) => item.id)).toEqual([archived.id]);
  });

  it("hides cross-owner documents and rejects stale revisions and mismatched actors", async () => {
    const service = createService();
    const created = await service.createDocument(scope, "owner_a", documentInput());

    await expect(service.getDocument(otherScope, created.id)).rejects.toThrow("STUDIO_DOCUMENT_NOT_FOUND");
    await expect(service.listVersions(otherScope, created.id)).rejects.toThrow("STUDIO_DOCUMENT_NOT_FOUND");
    await expect(service.updateDocument(scope, "owner_a", created.id, {
      revision: created.revision + 1,
      title: "stale"
    })).rejects.toThrow("STUDIO_DOCUMENT_STALE");
    await expect(service.archiveDocument(scope, "owner_b", created.id))
      .rejects.toThrow("STUDIO_ACTOR_SCOPE_MISMATCH");
    await expect(service.createDocument(scope, "owner_b", documentInput()))
      .rejects.toThrow("STUDIO_ACTOR_SCOPE_MISMATCH");
  });
});

describe("StudioService collections", () => {
  it("creates, lists, renames, and durably deletes owner collections", async () => {
    const repository = createInMemoryStudioRepository();
    const service = createStudioService(repository);
    const created = await service.createCollection(scope, "owner_a", { name: "  Estratégia  " });

    expect(created.name).toBe("Estratégia");
    expect(await service.listCollections(scope)).toEqual([created]);
    const renamed = await service.renameCollection(scope, "owner_a", created.id, { name: "Decisões" });
    expect(renamed.name).toBe("Decisões");
    expect((await createStudioService(repository).listCollections(scope))[0]?.name).toBe("Decisões");

    expect(await service.deleteCollection(scope, "owner_a", created.id)).toEqual(renamed);
    expect(await createStudioService(repository).listCollections(scope)).toEqual([]);
  });

  it("keeps idempotent membership in multiple collections and deletes no documents", async () => {
    const repository = createInMemoryStudioRepository();
    const service = createStudioService(repository);
    const document = await service.createDocument(scope, "owner_a", documentInput());
    const strategy = await service.createCollection(scope, "owner_a", { name: "Estratégia" });
    const decisions = await service.createCollection(scope, "owner_a", { name: "Decisões" });

    const firstMembership = await service.addDocumentToCollection(
      scope, "owner_a", strategy.id, document.id
    );
    expect(await service.addDocumentToCollection(scope, "owner_a", strategy.id, document.id))
      .toEqual(firstMembership);
    await service.addDocumentToCollection(scope, "owner_a", decisions.id, document.id);
    expect((await repository.listDocumentCollections(scope, document.id)).map((item) => item.id))
      .toEqual([strategy.id, decisions.id]);

    expect(await service.removeDocumentFromCollection(scope, "owner_a", strategy.id, document.id))
      .toBe(true);
    expect(await service.removeDocumentFromCollection(scope, "owner_a", strategy.id, document.id))
      .toBe(false);
    await service.deleteCollection(scope, "owner_a", decisions.id);
    expect(await service.getDocument(scope, document.id)).toMatchObject({ id: document.id });
    expect(await repository.listDocumentCollections(scope, document.id)).toEqual([]);
  });

  it("isolates collection and membership operations by both owner scope fields", async () => {
    const service = createService();
    const ownerDocument = await service.createDocument(scope, "owner_a", documentInput());
    const ownerCollection = await service.createCollection(scope, "owner_a", { name: "Privada" });
    const otherDocument = await service.createDocument(otherScope, "owner_b", documentInput("Outra"));
    const otherCollection = await service.createCollection(otherScope, "owner_b", { name: "Outra" });

    expect(await service.listCollections(scope)).toEqual([ownerCollection]);
    await expect(service.renameCollection(otherScope, "owner_b", ownerCollection.id, { name: "Vazada" }))
      .rejects.toThrow("STUDIO_COLLECTION_NOT_FOUND");
    await expect(service.addDocumentToCollection(scope, "owner_a", ownerCollection.id, otherDocument.id))
      .rejects.toThrow("STUDIO_DOCUMENT_NOT_FOUND");
    await expect(service.addDocumentToCollection(scope, "owner_a", otherCollection.id, ownerDocument.id))
      .rejects.toThrow("STUDIO_COLLECTION_NOT_FOUND");
  });
});

describe("StudioService lexical search", () => {
  it("matches accents and case, ranks deterministically, includes collection context, and hides owners", async () => {
    const service = createService();
    const titleMatch = await service.createDocument(scope, "owner_a", {
      ...documentInput("Plano de expansão sustentável"),
      title: "EXPANSÃO"
    });
    const bodyMatch = await service.createDocument(scope, "owner_a", documentInput("Refletir sobre expansão"));
    const collection = await service.createCollection(scope, "owner_a", { name: "Estratégia" });
    await service.addDocumentToCollection(scope, "owner_a", collection.id, titleMatch.id);
    await service.createDocument(otherScope, "owner_b", documentInput("expansao privada"));
    const archived = await service.createDocument(scope, "owner_a", documentInput("expansão arquivada"));
    await service.archiveDocument(scope, "owner_a", archived.id);

    const results = await service.search(scope, "  expansao  ", 20);
    expect(results.map((item) => item.documentId)).toEqual([titleMatch.id, bodyMatch.id]);
    expect(results[0]).toMatchObject({
      title: "EXPANSÃO",
      collections: [{ id: collection.id, name: "Estratégia" }]
    });
    expect(results.every((item) => item.excerpt.length <= 240)).toBe(true);
    expect(await service.search(scope, "   ", 10)).toEqual([]);
  });
});
