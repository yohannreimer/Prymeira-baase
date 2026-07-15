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

  it("reads home through bounded projections without paginating document bodies", async () => {
    const repository = createInMemoryStudioRepository();
    const setup = createStudioService(repository);
    const focused = await setup.createDocument(scope, "owner_a", documentInput("Foco"));
    const reviewed = await setup.createDocument(scope, "owner_a", documentInput("Revisado"));
    await setup.setFocused(scope, "owner_a", focused.id, true);
    await setup.updateDocument(scope, "owner_a", reviewed.id, {
      revision: reviewed.revision,
      inbox_state: "reviewed"
    });
    let recentCalls = 0;
    let focusedCalls = 0;
    let countCalls = 0;
    let nextRitualCalls = 0;
    const instrumented = {
      ...repository,
      async listDocuments() {
        throw new Error("FULL_DOCUMENT_PAGINATION_CALLED");
      },
      async listRecentDocuments(ownerScope: typeof scope, limit: number) {
        recentCalls += 1;
        return repository.listRecentDocuments(ownerScope, limit);
      },
      async listFocusedDocuments(ownerScope: typeof scope, limit: number) {
        focusedCalls += 1;
        return repository.listFocusedDocuments(ownerScope, limit);
      },
      async listNextRituals(ownerScope: typeof scope, limit: number) {
        nextRitualCalls += 1;
        expect(limit).toBe(1);
        return repository.listNextRituals(ownerScope, limit);
      },
      async countPendingReviewDocuments(ownerScope: typeof scope) {
        countCalls += 1;
        return repository.countPendingReviewDocuments(ownerScope);
      }
    };

    const home = await createStudioService(instrumented).readHome(scope);
    expect(home.focusedDocuments.map((item) => item.id)).toEqual([focused.id]);
    expect(new Set(home.recentDocuments.map((item) => item.id))).toEqual(new Set([focused.id, reviewed.id]));
    expect(home.pendingReviewCount).toBe(1);
    expect({ recentCalls, focusedCalls, countCalls, nextRitualCalls }).toEqual({
      recentCalls: 1,
      focusedCalls: 1,
      countCalls: 1,
      nextRitualCalls: 1
    });
  });

  it("shows only the next active scheduled ritual for the current owner with its document title", async () => {
    const service = createService();
    const manualDocument = await service.createDocument(scope, "owner_a", {
      ...documentInput("Ritual sob demanda"), title: "Revisão livre"
    });
    await service.createStructure(scope, "owner_a", manualDocument.id, {
      kind: "ritual",
      cadence_json: null,
      properties_json: { intention: "Parar quando for necessário" }
    });

    const laterDocument = await service.createDocument(scope, "owner_a", {
      ...documentInput("Ritual mensal"), title: "Revisão mensal"
    });
    await service.createStructure(scope, "owner_a", laterDocument.id, {
      kind: "ritual",
      cadence_json: { frequency: "daily", local_time: "11:00", timezone: "America/Sao_Paulo" },
      properties_json: { intention: "Olhar o mês" }
    });

    const nextDocument = await service.createDocument(scope, "owner_a", {
      ...documentInput("Ritual semanal"), title: "Revisão semanal"
    });
    const next = await service.createStructure(scope, "owner_a", nextDocument.id, {
      kind: "ritual",
      cadence_json: { frequency: "daily", local_time: "10:00", timezone: "America/Sao_Paulo" },
      properties_json: { intention: "Escolher a próxima atenção" }
    });

    const otherDocument = await service.createDocument(otherScope, "owner_b", {
      ...documentInput("Ritual privado de outro dono"), title: "Não pode aparecer"
    });
    await service.createStructure(otherScope, "owner_b", otherDocument.id, {
      kind: "ritual",
      cadence_json: { frequency: "daily", local_time: "09:30", timezone: "America/Sao_Paulo" },
      properties_json: { intention: "Outro escopo" }
    });

    expect(await service.readHome(scope)).toMatchObject({
      nextRituals: [{ id: next.id, title: "Revisão semanal", scheduledFor: next.nextRunAt }]
    });
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

  it("rejects future and stale revisions before a snapshot can overwrite newer content", async () => {
    const service = createService();
    const original = await service.createDocument(scope, "owner_a", documentInput("Original"));

    await expect(service.updateDocument(scope, "owner_a", original.id, {
      revision: original.revision + 100,
      body_text: "Future overwrite"
    })).rejects.toThrow("STUDIO_DOCUMENT_STALE");
    const current = await service.updateDocument(scope, "owner_a", original.id, {
      revision: original.revision,
      body_text: "Current write"
    });
    await expect(service.updateDocument(scope, "owner_a", original.id, {
      revision: original.revision,
      body_text: "Stale overwrite"
    })).rejects.toThrow("STUDIO_DOCUMENT_STALE");

    expect(await service.getDocument(scope, original.id)).toMatchObject({
      bodyText: "Current write",
      revision: current.revision
    });
    expect((await service.listVersions(scope, original.id)).map((item) => item.bodyText))
      .toEqual(["Original", "Current write"]);
  });

  it("makes concurrent identical archive, restore, and focus transitions idempotent", async () => {
    const service = createService();
    const document = await service.createDocument(scope, "owner_a", documentInput());

    const archived = await Promise.all([
      service.archiveDocument(scope, "owner_a", document.id),
      service.archiveDocument(scope, "owner_a", document.id)
    ]);
    expect(archived.every((item) => item.status === "archived")).toBe(true);

    const restored = await Promise.all([
      service.restoreDocument(scope, "owner_a", document.id),
      service.restoreDocument(scope, "owner_a", document.id)
    ]);
    expect(restored.every((item) => item.status === "active" && item.archivedAt === null)).toBe(true);

    const focused = await Promise.all([
      service.setFocused(scope, "owner_a", document.id, true),
      service.setFocused(scope, "owner_a", document.id, true)
    ]);
    expect(focused.every((item) => item.isFocused)).toBe(true);
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
    const expectedCollectionIds = [strategy, decisions]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((item) => item.id);
    expect((await repository.listDocumentCollections(scope, document.id)).map((item) => item.id))
      .toEqual(expectedCollectionIds);

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

  it("searches beyond one thousand newer active documents", async () => {
    let timestamp = Date.parse("2026-07-13T12:00:00.000Z");
    const repository = createInMemoryStudioRepository({
      now: () => new Date(timestamp++).toISOString()
    });
    const service = createStudioService(repository);
    const oldestExact = await service.createDocument(scope, "owner_a", {
      ...documentInput("Registro histórico"),
      title: "Agulha"
    });
    for (let index = 0; index < 1_001; index += 1) {
      await service.createDocument(
        scope,
        "owner_a",
        documentInput(`Documento recente ${index} menciona agulha`)
      );
    }

    expect((await service.search(scope, "agulha", 1))[0]?.documentId).toBe(oldestExact.id);
  });

  it("maps folded Unicode matches back to the original excerpt offsets", async () => {
    const service = createService();
    const decomposedPrefix = `${"a\u0301".repeat(300)} `;
    const decomposedMatch = "expansa\u0303o";
    const document = await service.createDocument(scope, "owner_a", {
      ...documentInput(`${decomposedPrefix}${decomposedMatch} sustentável`),
      title: "Unicode"
    });

    const result = await service.search(scope, "expansão", 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ documentId: document.id });
    expect(result[0]!.excerpt).toContain(decomposedMatch);
    expect(result[0]!.excerpt.length).toBeLessThanOrEqual(240);
  });

  it("returns tokenless queries without touching repository search", async () => {
    const repository = createInMemoryStudioRepository();
    let searchCalls = 0;
    const instrumented = {
      ...repository,
      async searchDocuments(...args: Parameters<typeof repository.searchDocuments>) {
        searchCalls += 1;
        return repository.searchDocuments(...args);
      }
    };
    const service = createStudioService(instrumented);

    expect(await service.search(scope, "  % __ !!!  ", 10)).toEqual([]);
    expect(searchCalls).toBe(0);
  });

  it("keeps context-sensitive lowercase matches inside long excerpts", async () => {
    const service = createService();
    const greekMatch = "ΟΣ";
    const document = await service.createDocument(scope, "owner_a", {
      ...documentInput(`${"contexto ".repeat(80)}${greekMatch} decisão`),
      title: "Grego"
    });

    const result = await service.search(scope, "ος", 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ documentId: document.id });
    expect(result[0]!.excerpt).toContain(greekMatch);
  });
});
