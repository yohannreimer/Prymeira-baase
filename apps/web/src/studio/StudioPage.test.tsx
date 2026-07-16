import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudioPage, { mergeAssets } from "./StudioPage";
import type { StudioAsset } from "./studio.types";
import { subscribeStudioEvents } from "./studio-events";

describe("mergeAssets", () => {
  it("preserves a ready current asset when an older pending version arrives", () => {
    const current = studioAssetWith({
      id: "asset_same",
      extractionStatus: "ready",
      updatedAt: "2026-07-15T15:00:00.000Z"
    });
    const incoming = studioAssetWith({
      id: "asset_same",
      extractionStatus: "pending",
      updatedAt: "2026-07-15T14:00:00.000Z"
    });

    expect(mergeAssets([current], [incoming])).toEqual([current]);
  });

  it("replaces an older pending current asset with a newer ready version", () => {
    const current = studioAssetWith({
      id: "asset_same",
      extractionStatus: "pending",
      updatedAt: "2026-07-15T14:00:00.000Z"
    });
    const incoming = studioAssetWith({
      id: "asset_same",
      extractionStatus: "ready",
      updatedAt: "2026-07-15T15:00:00.000Z"
    });

    expect(mergeAssets([current], [incoming])).toEqual([incoming]);
  });

  it("preserves the current asset when updated timestamps tie", () => {
    const current = studioAssetWith({ id: "asset_same", displayName: "current", updatedAt: "2026-07-15T15:00:00.000Z" });
    const incoming = studioAssetWith({ id: "asset_same", displayName: "incoming", updatedAt: "2026-07-15T12:00:00.000-03:00" });

    expect(mergeAssets([current], [incoming])).toEqual([current]);
  });

  it("preserves a valid current timestamp from invalid incoming values and repairs an invalid current", () => {
    const current = studioAssetWith({ id: "asset_same", displayName: "current" });
    const invalid = studioAssetWith({ id: "asset_same", displayName: "invalid", updatedAt: "not-a-date" });
    const absent = studioAssetWith({
      id: "asset_same",
      displayName: "absent",
      updatedAt: undefined as unknown as string
    });

    expect(mergeAssets([current], [invalid, absent])).toEqual([current]);

    const invalidCurrent = studioAssetWith({ id: "asset_same", displayName: "invalid current", updatedAt: "not-a-date" });
    const validIncoming = studioAssetWith({ id: "asset_same", displayName: "valid incoming", updatedAt: "2026-07-15T18:00:00.000Z" });
    expect(mergeAssets([invalidCurrent], [validIncoming])).toEqual([validIncoming]);
  });

  it("keeps the valid version across duplicate entries within one incoming list", () => {
    const invalidFirst = studioAssetWith({ id: "asset_same", displayName: "invalid first", updatedAt: "not-a-date" });
    const validSecond = studioAssetWith({ id: "asset_same", displayName: "valid second", updatedAt: "2026-07-15T18:00:00.000Z" });
    const validFirst = studioAssetWith({ id: "asset_same", displayName: "valid first", updatedAt: "2026-07-15T19:00:00.000Z" });
    const invalidSecond = studioAssetWith({ id: "asset_same", displayName: "invalid second", updatedAt: "not-a-date" });

    expect(mergeAssets([], [invalidFirst, validSecond])).toEqual([validSecond]);
    expect(mergeAssets([], [validFirst, invalidSecond])).toEqual([validFirst]);
  });

  it("orders valid creation instants before invalid values with stable ties and one entry per id", () => {
    const equivalentOffset = studioAssetWith({
      id: "asset_offset",
      createdAt: "2026-07-15T09:00:00.000-03:00"
    });
    const invalidCurrent = studioAssetWith({ id: "asset_invalid_a", createdAt: "invalid-a" });
    const duplicateCurrent = studioAssetWith({
      id: "asset_duplicate",
      createdAt: "2026-07-15T13:00:00.000Z",
      updatedAt: "2026-07-15T13:00:00.000Z"
    });
    const equivalentZulu = studioAssetWith({
      id: "asset_zulu",
      createdAt: "2026-07-15T12:00:00.000Z"
    });
    const invalidIncoming = studioAssetWith({ id: "asset_invalid_b", createdAt: "invalid-b" });
    const duplicateNewer = studioAssetWith({
      id: "asset_duplicate",
      displayName: "newer duplicate",
      createdAt: "2026-07-15T11:00:00.000Z",
      updatedAt: "2026-07-15T14:00:00.000Z"
    });

    const merged = mergeAssets(
      [equivalentOffset, invalidCurrent, duplicateCurrent],
      [equivalentZulu, invalidIncoming, duplicateNewer]
    );

    expect(merged.map((asset) => asset.id)).toEqual([
      "asset_duplicate",
      "asset_offset",
      "asset_zulu",
      "asset_invalid_a",
      "asset_invalid_b"
    ]);
    expect(merged.find((asset) => asset.id === "asset_duplicate")).toBe(duplicateNewer);
  });
});

describe("StudioPage", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/#estudio");
    installLocalStorage();
    installTipTapDomGeometry();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("owns its secondary navigation and section state", () => {
    render(<StudioPage />);

    const studio = screen.getByRole("region", { name: "Estúdio" });
    const navigation = within(studio).getByRole("navigation", { name: "Seções do Estúdio" });
    const expectedSections = [
      "Início",
      "Entrada",
      "Tudo",
      "Metas",
      "Decisões",
      "Planos",
      "Rituais",
      "Coleções",
      "Arquivo",
      "Privacidade"
    ];

    expect(within(navigation).getAllByRole("button").map((button) => button.textContent?.trim())).toEqual(expectedSections);
    expect(within(navigation).getByRole("button", { name: "Início" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Um espaço para pensar com clareza." })).toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Decisões" }));
    expect(within(navigation).getByRole("button", { name: "Decisões" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Decisões" })).toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Arquivo" }));
    expect(screen.getByRole("heading", { name: "Arquivo" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#estudio/archive");
  });

  it("restores an internal section from the URL and follows browser navigation", async () => {
    window.history.replaceState(null, "", "/#estudio/inbox");
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/studio/documents?")) {
        return jsonResponse({ documents: [], next_cursor: null, collections_by_document_id: {} });
      }
      if (url.includes("/api/studio/structures?")) return jsonResponse({ structures: [], next_cursor: null });
      if (url.endsWith("/api/studio/collections")) return jsonResponse({ collections: [] });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });

    render(<StudioPage />);

    expect(screen.getByRole("button", { name: "Entrada" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("Toda captura já foi revisada.")).toBeInTheDocument();

    const navigationStatus = screen.getByRole("status", { name: "Mudança de seção" });
    fireEvent.click(screen.getByRole("button", { name: "Tudo" }));
    expect(navigationStatus).toHaveTextContent("Seção Tudo aberta.");

    window.history.replaceState(null, "", "/#estudio/plans");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(navigationStatus).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Planos" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Planos" })).toBeInTheDocument();
    expect(await screen.findByText("Nenhum plano organizado ainda.")).toBeInTheDocument();
  });

  it("connects strategic navigation to the active structure library", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = new URL(String(input), "https://baase.local");
      if (url.pathname === "/api/studio/structures" && url.searchParams.get("kind") === "decision") {
        return jsonResponse({
          structures: [{
            id: "decision_1",
            workspace_id: "workspace_a",
            owner_profile_id: "profile_owner",
            document_id: "document_decision",
            document_title: "Escolher o novo canal",
            kind: "decision",
            lifecycle_status: "active",
            revision: 1,
            horizon_at: null,
            metric_json: null,
            cadence_json: null,
            next_run_at: null,
            properties_json: { decision: "Priorizar indicação" },
            created_at: "2026-07-14T10:00:00.000Z",
            updated_at: "2026-07-15T10:00:00.000Z",
            archived_at: null
          }],
          next_cursor: null
        });
      }
      return jsonResponse({ structures: [], next_cursor: null });
    });

    render(<StudioPage />);
    await user.click(screen.getByRole("button", { name: "Decisões" }));

    const library = await screen.findByRole("region", { name: "Decisões" });
    expect(within(library).getByRole("list", { name: "Decisões organizadas" })).toBeInTheDocument();
    expect(within(library).getByRole("button", { name: "Abrir Escolher o novo canal" })).toBeInTheDocument();
  });

  it("shows a newly persisted decision as soon as the owner moves from its document to Decisions", async () => {
    const user = userEvent.setup();
    let decisionCreated = false;
    const rawDecision = {
      id: "decision_immediate",
      workspace_id: "workspace_a",
      owner_profile_id: "profile_owner",
      document_id: rawDocument.id,
      document_title: rawDocument.title,
      kind: "decision",
      lifecycle_status: "active",
      revision: 1,
      horizon_at: null,
      metric_json: null,
      cadence_json: null,
      next_run_at: null,
      properties_json: { decision: "Nova decisão estratégica" },
      created_at: "2026-07-16T14:00:00.000Z",
      updated_at: "2026-07-16T14:00:00.000Z",
      archived_at: null
    };
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input), "https://baase.local");
      if (url.pathname === `/api/studio/documents/${rawDocument.id}` && !init?.method) {
        return jsonResponse({ document: { ...rawDocument, revision: 5 } });
      }
      if (url.pathname === `/api/studio/documents/${rawDocument.id}/assets`) return jsonResponse({ assets: [] });
      if (url.pathname === "/api/studio/structures" && url.searchParams.get("document_id") === rawDocument.id) {
        return jsonResponse({ structures: decisionCreated ? [rawDecision] : [], next_cursor: null });
      }
      if (url.pathname === "/api/studio/structures" && url.searchParams.get("kind") === "decision") {
        return jsonResponse({ structures: decisionCreated ? [rawDecision] : [], next_cursor: null });
      }
      if (url.pathname === `/api/studio/documents/${rawDocument.id}/structures` && init?.method === "POST") {
        decisionCreated = true;
        return jsonResponse({ structure: rawDecision }, 201);
      }
      if (url.pathname === `/api/studio/documents/${rawDocument.id}/checkpoints` && init?.method === "POST") {
        return jsonResponse({ version: {
          id: "version_structure",
          workspace_id: "workspace_a",
          owner_profile_id: "profile_owner",
          document_id: rawDocument.id,
          version_number: 5,
          body_json: rawDocument.body_json,
          body_text: rawDocument.body_text,
          origin: "user",
          actor_profile_id: "profile_owner",
          ai_run_id: null,
          created_at: "2026-07-16T14:00:00.000Z",
          checkpoint_reason: "structure_changed",
          source_revision: 5,
          is_legacy: false
        } }, 201);
      }
      if (url.pathname === "/api/studio/collections") return jsonResponse({ collections: [] });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    render(<StudioPage />);

    await screen.findByRole("heading", { name: rawDocument.title });
    await user.click(await screen.findByRole("button", { name: /estruturar este pensamento/i }));
    await user.click(screen.getByRole("button", { name: "Decisão" }));
    await user.type(screen.getByRole("textbox", { name: "Decisão tomada" }), "Nova decisão estratégica");
    await user.click(screen.getByRole("button", { name: "Criar decisão" }));
    await user.click(screen.getByRole("button", { name: "Decisões" }));

    expect(await screen.findByText(rawDocument.title)).toBeInTheDocument();
    expect(screen.getByText("Nova decisão estratégica")).toBeInTheDocument();
  });

  it("publishes document lifecycle changes only after the archive request succeeds", async () => {
    const user = userEvent.setup();
    const received = vi.fn();
    const unsubscribe = subscribeStudioEvents(received);
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/documents?")) {
        return jsonResponse({ documents: [rawDocument], next_cursor: null, collections_by_document_id: {} });
      }
      if (url.endsWith("/api/studio/collections")) return jsonResponse({ collections: [] });
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/archive`) && init?.method === "POST") {
        return jsonResponse({ document: { ...rawDocument, status: "archived", archived_at: "2026-07-16T15:00:00.000Z" } });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioPage />);

    await user.click(screen.getByRole("button", { name: "Tudo" }));
    const row = await screen.findByRole("listitem", { name: rawDocument.title });
    await user.click(within(row).getByRole("button", { name: "Arquivar" }));
    await user.click(within(row).getByRole("button", { name: "Confirmar arquivo" }));

    await waitFor(() => expect(received).toHaveBeenCalledWith({
      type: "document-lifecycle-changed",
      documentId: rawDocument.id
    }));
    unsubscribe();
  });

  it("does not publish a document lifecycle change when archiving fails", async () => {
    const user = userEvent.setup();
    const received = vi.fn();
    const unsubscribe = subscribeStudioEvents(received);
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/documents?")) {
        return jsonResponse({ documents: [rawDocument], next_cursor: null, collections_by_document_id: {} });
      }
      if (url.endsWith("/api/studio/collections")) return jsonResponse({ collections: [] });
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/archive`) && init?.method === "POST") {
        return jsonResponse({ error: { code: "TEMPORARY", message: "offline" } }, 503);
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioPage />);

    await user.click(screen.getByRole("button", { name: "Tudo" }));
    const row = await screen.findByRole("listitem", { name: rawDocument.title });
    await user.click(within(row).getByRole("button", { name: "Arquivar" }));
    await user.click(within(row).getByRole("button", { name: "Confirmar arquivo" }));

    expect(await screen.findByText(/não foi possível arquivar reflexão estratégica/i)).toBeInTheDocument();
    expect(received).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("clears and reissues section announcements around document transitions", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/studio/documents?")) {
        return jsonResponse({
          documents: [rawDocument],
          next_cursor: null,
          collections_by_document_id: {}
        });
      }
      if (url.endsWith("/api/studio/collections")) return jsonResponse({ collections: [] });
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return jsonResponse({ assets: [] });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioPage />);

    const navigationStatus = screen.getByRole("status", { name: "Mudança de seção" });
    const all = screen.getByRole("button", { name: "Tudo" });
    await user.click(all);
    expect(navigationStatus).toHaveTextContent("Seção Tudo aberta.");

    const row = await screen.findByRole("listitem", { name: "Reflexão estratégica" });
    await user.click(within(row).getByRole("button", { name: /Reflexão estratégica/u }));
    expect(await screen.findByRole("heading", { name: "Reflexão estratégica" })).toBeInTheDocument();
    expect(navigationStatus).toBeEmptyDOMElement();

    await user.click(all);
    expect(navigationStatus).toHaveTextContent("Seção Tudo aberta.");
  });

  it("opens a document URL without writing a duplicate history entry", async () => {
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    const pushState = vi.spyOn(window.history, "pushState");
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`)) return jsonResponse({ document: rawDocument });
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return jsonResponse({ assets: [] });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });

    render(<StudioPage />);

    expect(await screen.findByRole("heading", { name: "Reflexão estratégica" })).toBeInTheDocument();
    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(`#estudio/document/${rawDocument.id}`);
  });

  it("treats malformed or unknown document hashes as a safe home route", () => {
    window.history.replaceState(null, "", "/#estudio/document/%E0%A4%A");
    const { unmount } = render(<StudioPage />);
    expect(screen.getByRole("button", { name: "Início" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Um espaço para pensar com clareza." })).toBeInTheDocument();
    unmount();

    window.history.replaceState(null, "", "/#estudio/document/known/extra");
    render(<StudioPage />);
    expect(screen.getByRole("button", { name: "Início" })).toHaveAttribute("aria-current", "page");
  });

  it("clears document A immediately while document B is pending and ignores B after leaving its route", async () => {
    const documentB = deferred<Response>();
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`)) return Promise.resolve(jsonResponse({ document: rawDocument }));
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return Promise.resolve(jsonResponse({ assets: [] }));
      if (url.endsWith(`/api/studio/documents/${rawDocumentB.id}`)) return documentB.promise;
      return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404));
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    render(<StudioPage />);
    expect(await screen.findByRole("heading", { name: "Reflexão estratégica" })).toBeInTheDocument();

    window.history.replaceState(null, "", `/#estudio/document/${rawDocumentB.id}`);
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.queryByRole("heading", { name: "Reflexão estratégica" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Abrindo caderno" })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Início" }));
    await act(async () => documentB.resolve(jsonResponse({ document: rawDocumentB })));
    expect(screen.getByRole("heading", { name: "Um espaço para pensar com clareza." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Plano comercial" })).not.toBeInTheDocument();
  });

  it.each([404, 403])("keeps an unavailable document route recoverable for status %s", async (status) => {
    const documentFailure = deferred<Response>();
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/studio/documents/missing")) return documentFailure.promise;
      if (url.endsWith("/api/studio/collections")) return Promise.resolve(jsonResponse({ collections: [] }));
      return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404));
    });
    window.history.replaceState(null, "", "/#estudio/document/missing");
    render(<StudioPage />);

    await act(async () => documentFailure.resolve(jsonResponse({
      error: { code: status === 403 ? "STUDIO_OWNER_SCOPE_DENIED" : "STUDIO_DOCUMENT_NOT_FOUND", message: "private" }
    }, status)));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Este registro não está disponível");
    const back = screen.getByRole("button", { name: "Voltar para Tudo" });
    await waitFor(() => expect(back).toHaveFocus());
    await userEvent.setup().click(back);
    expect(screen.getByRole("heading", { name: "Tudo" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#estudio/all");
  });

  it("offers retry for a temporary document loading failure", async () => {
    let attempts = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/studio/documents/temporary")) {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ error: { code: "TEMPORARY", message: "try again" } }, 503)
          : jsonResponse({ document: rawDocument });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return jsonResponse({ assets: [] });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    window.history.replaceState(null, "", "/#estudio/document/temporary");
    render(<StudioPage />);

    const retry = await screen.findByRole("button", { name: "Tentar novamente" });
    expect(retry).toHaveFocus();
    await userEvent.setup().click(retry);
    expect(await screen.findByRole("heading", { name: "Reflexão estratégica" })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("sweeps expired draft quarantines for other documents when Studio opens", async () => {
    const expiredKey = "baase:studio:draft:another-document:quarantine";
    const retainedKey = "baase:studio:draft:retained-document:quarantine";
    window.localStorage.setItem(expiredKey, JSON.stringify({
      version: 1,
      quarantinedAt: Date.now() - 100_000,
      expiresAt: Date.now() - 1,
      raw: "expired-sensitive-copy"
    }));
    window.localStorage.setItem(retainedKey, JSON.stringify({
      version: 1,
      quarantinedAt: Date.now(),
      expiresAt: Date.now() + 100_000,
      raw: "retained-sensitive-copy"
    }));

    render(<StudioPage />);

    await waitFor(() => expect(window.localStorage.getItem(expiredKey)).toBeNull());
    expect(window.localStorage.getItem(retainedKey)).not.toBeNull();
  });

  it("supports native keyboard activation and ordered focus", async () => {
    const user = userEvent.setup();
    render(<StudioPage />);

    const navigation = screen.getByRole("navigation", { name: "Seções do Estúdio" });
    const home = within(navigation).getByRole("button", { name: "Início" });
    const inbox = screen.getByRole("button", { name: "Entrada" });
    const all = within(navigation).getByRole("button", { name: "Tudo" });

    await user.tab();
    expect(home).toHaveFocus();
    await user.tab();
    expect(inbox).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(inbox).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Entrada" })).toBeInTheDocument();

    await user.tab();
    expect(all).toHaveFocus();
    await user.keyboard(" ");
    expect(all).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Tudo" })).toBeInTheDocument();
  });

  it("keeps every section accessible in the internal navigation", () => {
    render(<StudioPage />);

    const navigation = screen.getByRole("navigation", { name: "Seções do Estúdio" });
    expect(navigation).not.toHaveAttribute("aria-hidden");
    expect(within(navigation).getAllByRole("button")).toHaveLength(10);
    expect(screen.getByRole("region", { name: "Conteúdo da seção" })).toBeVisible();
  });

  it("connects inbox, search, and archive to one private library surface", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/studio/home")) {
        return jsonResponse({ home: { recent_documents: [], focused_documents: [], pending_review_count: 0, next_rituals: [] } });
      }
      if (url.includes("/api/studio/documents?")) return jsonResponse({ documents: [], nextCursor: null });
      if (url.endsWith("/api/studio/collections")) return jsonResponse({ collections: [] });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioPage />);

    await user.click(screen.getByRole("button", { name: "Entrada" }));
    expect(await screen.findByText("Toda captura já foi revisada.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tudo" }));
    expect(screen.getByRole("searchbox", { name: "Buscar no Estúdio" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Arquivo" }));
    expect(await screen.findByText("Seu arquivo está livre por enquanto.")).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url))).toContain(
      "/api/studio/documents?status=archived&limit=30"
    );
  });

  it("shares one collection source across management, filters, and library checkboxes", async () => {
    const user = userEvent.setup();
    let collectionReads = 0;
    let collectionName = "Estratégia";
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/studio/home")) {
        return jsonResponse({ home: { recent_documents: [], focused_documents: [], pending_review_count: 0, next_rituals: [] } });
      }
      if (url === "/api/studio/collections" && method === "GET") {
        collectionReads += 1;
        return jsonResponse({ collections: [rawCollection(collectionName)] });
      }
      if (url === "/api/studio/collections/collection_1" && method === "PATCH") {
        collectionName = JSON.parse(String(init?.body)).name;
        return jsonResponse({ collection: rawCollection(collectionName) });
      }
      if (url === "/api/studio/collections/collection_1" && method === "DELETE") {
        return jsonResponse({ collection: rawCollection(collectionName) });
      }
      if (url.includes("/api/studio/documents?")) {
        return jsonResponse({
          documents: [rawDocument],
          next_cursor: null,
          collections_by_document_id: { [rawDocument.id]: [rawCollection(collectionName)] }
        });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioPage />);

    await user.click(screen.getByRole("button", { name: "Tudo" }));
    const row = await screen.findByRole("listitem", { name: "Reflexão estratégica" });
    await user.click(within(row).getByRole("button", { name: "Organizar em coleções" }));
    expect(within(row).getByRole("checkbox", { name: "Estratégia" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Coleções" }));
    await user.click(await screen.findByRole("button", { name: "Renomear Estratégia" }));
    const name = screen.getByRole("textbox", { name: "Nome de Estratégia" });
    await user.clear(name);
    await user.type(name, "Horizonte");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("button", { name: "Horizonte" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tudo" }));
    const updatedRow = await screen.findByRole("listitem", { name: "Reflexão estratégica" });
    await user.click(within(updatedRow).getByRole("button", { name: "Organizar em coleções" }));
    expect(within(updatedRow).getByRole("checkbox", { name: "Horizonte" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Coleções" }));
    await user.click(await screen.findByRole("button", { name: "Excluir Horizonte" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Horizonte" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Tudo" }));
    const withoutCollection = await screen.findByRole("listitem", { name: "Reflexão estratégica" });
    expect(within(withoutCollection).queryByRole("button", { name: "Organizar em coleções" })).not.toBeInTheDocument();
    expect(collectionReads).toBe(1);
  });

  it("opens a recent document with a compact material row and focused heading", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/studio/home")) {
        return jsonResponse({
          home: {
            recent_documents: [rawDocument], focused_documents: [], pending_review_count: 0, next_rituals: []
          }
        });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) {
        return jsonResponse({ assets: [rawAsset] });
      }
      if (url.endsWith(`/api/studio/assets/${rawAsset.id}/download`)) {
        return jsonResponse({ url: "https://private.example/reflexao.wav", expires_in_seconds: 600 });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioPage />);

    const documentButtons = await screen.findAllByRole("button", { name: /Reflexão estratégica/u });
    await user.click(documentButtons.at(-1)!);

    const heading = await screen.findByRole("heading", { name: "Reflexão estratégica" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveFocus();
    const material = await screen.findByRole("button", { name: "Abrir reflexao.wav" });
    expect(material).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Escolher uma direção com calma.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("studio-audio-player")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Baixar áudio original" })).not.toBeInTheDocument();
    await user.click(material);
    expect(material).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps existing and newly attached materials together inside the editor without reopening", async () => {
    const user = userEvent.setup();
    const fileAsset = rawAssetWith({
      id: "asset_file",
      kind: "file",
      display_name: "premissas.pdf",
      mime_type: "application/pdf",
      created_at: "2026-07-13T13:00:00.000Z"
    });
    const imageAsset = rawAssetWith({
      id: "asset_image",
      kind: "image",
      display_name: "mapa.png",
      mime_type: "image/png",
      created_at: "2026-07-13T14:00:00.000Z"
    });
    let attachment = 0;
    let assetLists = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`)) return jsonResponse({ document: rawDocument });
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`) && method === "POST") {
        attachment += 1;
        return jsonResponse({ asset: attachment === 1 ? fileAsset : imageAsset }, 201);
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`) && method === "GET") {
        assetLists += 1;
        return jsonResponse({ assets: [rawAsset] });
      }
      if (url.includes("/api/studio/assets/") && url.endsWith("/download")) {
        return jsonResponse({ url: `https://private.example/${url.split("/").at(-2)}`, expires_in_seconds: 600 });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    const { container } = render(<StudioPage />);

    expect(await screen.findByRole("button", { name: "Abrir reflexao.wav" })).toBeInTheDocument();
    await user.upload(screen.getByTestId("studio-material-file-input"), new File(["pdf"], "premissas.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("button", { name: "Abrir premissas.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir reflexao.wav" })).toBeInTheDocument();

    await user.upload(screen.getByTestId("studio-material-image-input"), new File(["png"], "mapa.png", { type: "image/png" }));
    const materialRegion = screen.getByRole("region", { name: "Materiais do documento" });
    expect(await within(materialRegion).findByRole("button", { name: "Abrir mapa.png" })).toBeInTheDocument();
    expect(within(materialRegion).getAllByRole("button", { name: /^Abrir /u }).map((button) => button.getAttribute("aria-label")?.replace("Abrir ", ""))).toEqual([
      "reflexao.wav",
      "premissas.pdf",
      "mapa.png"
    ]);
    const composer = within(materialRegion).getByRole("group", { name: "Adicionar material" });
    const firstMaterial = within(materialRegion).getByRole("button", { name: "Abrir reflexao.wav" });
    expect(composer.compareDocumentPosition(firstMaterial) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("region", { name: "Materiais do documento" })).toHaveLength(1);
    expect(materialRegion.closest("article.studio-editor")).not.toBeNull();
    expect(container.querySelector(".studio-writing-layout + .studio-document-assets")).toBeNull();
    expect(assetLists).toBe(1);
  });

  it("keeps a ready audio transcript out of the document when its compact row is selected", async () => {
    const user = userEvent.setup();
    const sourceDocument = {
      ...rawDocument,
      body_json: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Antes depois" }] }]
      },
      body_text: "Antes depois"
    };
    const fetchSpy = vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`) && !init?.method) {
        return jsonResponse({ document: sourceDocument });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) {
        return jsonResponse({ assets: [rawAsset] });
      }
      if (url.endsWith(`/api/studio/assets/${rawAsset.id}/download`)) {
        return jsonResponse({ url: "https://private.example/reflexao.wav", expires_in_seconds: 600 });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`) && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body));
        return jsonResponse({ document: {
          ...sourceDocument,
          revision: 2,
          body_json: payload.body_json,
          body_text: payload.body_text
        } });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    render(<StudioPage />);
    const body = await screen.findByRole("textbox", { name: "Conteúdo do documento" });

    await user.click(await screen.findByRole("button", { name: "Abrir reflexao.wav" }));

    expect(body).toHaveTextContent("Antes depois");
    expect(screen.getByRole("dialog", { name: "Material reflexao.wav" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Inserir no documento" })).toBeVisible();
    expect(body).not.toHaveTextContent("Escolher uma direção com calma.");
    expect(screen.getByLabelText("Trecho da transcrição")).toHaveTextContent("Escolher uma direção com calma.");
    expect(screen.queryByRole("button", { name: "Adicionar transcrição ao documento" })).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([url, init]) => (
      String(url).endsWith(`/api/studio/documents/${rawDocument.id}`) && init?.method === "PATCH"
    ))).toBe(false);
  });

  it("preserves exactly one transcript checkpoint only after the inserted text is persisted", async () => {
    const user = userEvent.setup();
    const sourceDocument = {
      ...rawDocument,
      body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Contexto atual" }] }] },
      body_text: "Contexto atual"
    };
    let persistedDocument: Record<string, unknown> = sourceDocument;
    const checkpointBodies: Array<Record<string, unknown>> = [];
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`) && method === "GET") {
        return jsonResponse({ document: persistedDocument });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return jsonResponse({ assets: [rawAsset] });
      if (url.endsWith(`/api/studio/assets/${rawAsset.id}/download`)) {
        return jsonResponse({ url: "https://private.example/reflexao.wav", expires_in_seconds: 600 });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`) && method === "PATCH") {
        const payload = JSON.parse(String(init?.body));
        persistedDocument = {
          ...sourceDocument,
          revision: 2,
          body_json: payload.body_json,
          body_text: payload.body_text,
          updated_at: "2026-07-16T12:01:00.000Z"
        };
        return jsonResponse({ document: persistedDocument });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/checkpoints`) && method === "POST") {
        checkpointBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ version: {
          id: "version_transcript",
          workspace_id: "workspace_a",
          owner_profile_id: "profile_owner",
          document_id: rawDocument.id,
          version_number: 1,
          title: sourceDocument.title,
          body_json: persistedDocument.body_json,
          body_text: persistedDocument.body_text,
          origin: "user",
          actor_profile_id: "profile_owner",
          ai_run_id: null,
          checkpoint_reason: "transcript_inserted",
          source_revision: 2,
          is_legacy: false,
          created_at: "2026-07-16T12:01:01.000Z"
        } }, 201);
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    render(<StudioPage />);

    await user.click(await screen.findByRole("button", { name: "Abrir reflexao.wav" }));
    await user.click(screen.getByRole("button", { name: "Inserir no documento" }));

    await waitFor(() => expect(checkpointBodies).toEqual([{
      expected_revision: 2,
      reason: "transcript_inserted"
    }]), { timeout: 4_000 });
    expect(await screen.findByText("Texto inserido e versão preservada.")).toBeVisible();
    expect(checkpointBodies).toHaveLength(1);
  }, 8_000);

  it("checkpoints a selected-range replacement even when the transcript occurrence count stays equal", async () => {
    const user = userEvent.setup();
    const transcript = String(rawAsset.extracted_text);
    const originalText = `Antes ${transcript} depois`;
    const sourceDocument = {
      ...rawDocument,
      body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: originalText }] }] },
      body_text: originalText
    };
    let persistedDocument: Record<string, unknown> = sourceDocument;
    const checkpointBodies: Array<Record<string, unknown>> = [];
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`) && method === "GET") {
        return jsonResponse({ document: persistedDocument });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return jsonResponse({ assets: [rawAsset] });
      if (url.endsWith(`/api/studio/assets/${rawAsset.id}/download`)) {
        return jsonResponse({ url: "https://private.example/reflexao.wav", expires_in_seconds: 600 });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`) && method === "PATCH") {
        const payload = JSON.parse(String(init?.body));
        persistedDocument = {
          ...sourceDocument,
          revision: 2,
          body_json: payload.body_json,
          body_text: payload.body_text,
          updated_at: "2026-07-16T12:01:00.000Z"
        };
        return jsonResponse({ document: persistedDocument });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/checkpoints`) && method === "POST") {
        checkpointBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ version: {
          id: "version_replaced_transcript",
          workspace_id: "workspace_a",
          owner_profile_id: "profile_owner",
          document_id: rawDocument.id,
          version_number: 1,
          title: sourceDocument.title,
          body_json: persistedDocument.body_json,
          body_text: persistedDocument.body_text,
          origin: "user",
          actor_profile_id: "profile_owner",
          ai_run_id: null,
          checkpoint_reason: "transcript_inserted",
          source_revision: 2,
          is_legacy: false,
          created_at: "2026-07-16T12:01:01.000Z"
        } }, 201);
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    render(<StudioPage />);
    const body = await screen.findByRole("textbox", { name: "Conteúdo do documento" });
    await setTipTapRange(body, "Antes ".length, "Antes ".length + transcript.length);
    await user.click(await screen.findByRole("button", { name: "Abrir reflexao.wav" }));
    await user.click(screen.getByRole("button", { name: "Inserir no documento" }));

    await waitFor(() => expect(checkpointBodies).toEqual([{
      expected_revision: 2,
      reason: "transcript_inserted"
    }]), { timeout: 4_000 });
    expect(String(persistedDocument.body_text).match(new RegExp(transcript, "gu"))).toHaveLength(1);
    expect(await screen.findByText("Texto inserido e versão preservada.")).toBeVisible();
  }, 8_000);

  it("retries a transcript checkpoint conflict against the exact saved draft without inserting twice", async () => {
    const user = userEvent.setup();
    const sourceDocument = {
      ...rawDocument,
      body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Contexto" }] }] },
      body_text: "Contexto"
    };
    let persistedDocument: Record<string, unknown> = sourceDocument;
    const checkpointBodies: Array<Record<string, unknown>> = [];
    let checkpointAttempt = 0;
    let patchCount = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`) && method === "GET") {
        return jsonResponse({ document: persistedDocument });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return jsonResponse({ assets: [rawAsset] });
      if (url.endsWith(`/api/studio/assets/${rawAsset.id}/download`)) {
        return jsonResponse({ url: "https://private.example/reflexao.wav", expires_in_seconds: 600 });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`) && method === "PATCH") {
        patchCount += 1;
        const payload = JSON.parse(String(init?.body));
        persistedDocument = {
          ...sourceDocument,
          revision: 2,
          body_json: payload.body_json,
          body_text: payload.body_text,
          updated_at: "2026-07-16T12:01:00.000Z"
        };
        return jsonResponse({ document: persistedDocument });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/checkpoints`) && method === "POST") {
        checkpointAttempt += 1;
        checkpointBodies.push(JSON.parse(String(init?.body)));
        if (checkpointAttempt === 1) {
          persistedDocument = { ...persistedDocument, revision: 3, updated_at: "2026-07-16T12:02:00.000Z" };
          return jsonResponse({ error: { code: "REVISION_CONFLICT", message: "conflict" } }, 409);
        }
        return jsonResponse({ version: {
          id: "version_after_conflict",
          workspace_id: "workspace_a",
          owner_profile_id: "profile_owner",
          document_id: rawDocument.id,
          version_number: 1,
          title: sourceDocument.title,
          body_json: persistedDocument.body_json,
          body_text: persistedDocument.body_text,
          origin: "user",
          actor_profile_id: "profile_owner",
          ai_run_id: null,
          checkpoint_reason: "transcript_inserted",
          source_revision: 3,
          is_legacy: false,
          created_at: "2026-07-16T12:02:01.000Z"
        } }, 201);
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    render(<StudioPage />);
    await user.click(await screen.findByRole("button", { name: "Abrir reflexao.wav" }));
    await user.click(screen.getByRole("button", { name: "Inserir no documento" }));
    expect(await screen.findByText("Texto inserido e versão preservada.", {}, { timeout: 4_000 })).toBeVisible();
    expect(checkpointBodies).toEqual([
      { expected_revision: 2, reason: "transcript_inserted" },
      { expected_revision: 3, reason: "transcript_inserted" }
    ]);

    await user.click(screen.getByRole("button", { name: "Inserir no documento" }));
    await act(async () => { await Promise.resolve(); });
    expect(patchCount).toBe(1);
    expect(checkpointBodies).toHaveLength(2);
    expect(String(persistedDocument.body_text).match(new RegExp(String(rawAsset.extracted_text), "gu"))).toHaveLength(1);
  }, 8_000);

  it("moves focus to the next material and then to add material as deleted openers disappear", async () => {
    const user = userEvent.setup();
    const secondAsset = rawAssetWith({
      id: "asset_second",
      display_name: "segunda-reflexao.wav",
      created_at: "2026-07-16T12:01:00.000Z",
      updated_at: "2026-07-16T12:01:00.000Z"
    });
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`) && method === "GET") {
        return jsonResponse({ document: rawDocument });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) {
        return jsonResponse({ assets: [rawAsset, secondAsset] });
      }
      if (url.includes("/api/studio/assets/") && url.endsWith("/download")) {
        return jsonResponse({ url: "https://private.example/reflexao.wav", expires_in_seconds: 600 });
      }
      if (url.includes("/api/studio/assets/") && method === "DELETE") return jsonResponse({});
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    render(<StudioPage />);

    await user.click(await screen.findByRole("button", { name: "Abrir reflexao.wav" }));
    await user.click(screen.getByRole("button", { name: "Excluir material" }));
    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Abrir segunda-reflexao.wav" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Abrir segunda-reflexao.wav" }));
    await user.click(screen.getByRole("button", { name: "Excluir material" }));
    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Adicionar arquivo" })).toHaveFocus());
  });

  it("uses the current document's compact material selection after switching documents", async () => {
    const user = userEvent.setup();
    const documentA = {
      ...rawDocument,
      body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Documento A" }] }] },
      body_text: "Documento A"
    };
    const documentB = {
      ...rawDocumentB,
      body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Documento B" }] }] },
      body_text: "Documento B"
    };
    const assetB = rawAssetWith({
      id: "asset_b_audio",
      document_id: documentB.id,
      extracted_text: "Transcrição somente B."
    });
    const fetchSpy = vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith(`/api/studio/documents/${documentA.id}`) && method === "GET") {
        return jsonResponse({ document: documentA });
      }
      if (url.endsWith(`/api/studio/documents/${documentB.id}`) && method === "GET") {
        return jsonResponse({ document: documentB });
      }
      if (url.endsWith(`/api/studio/documents/${documentA.id}/assets`)) return jsonResponse({ assets: [] });
      if (url.endsWith(`/api/studio/documents/${documentB.id}/assets`)) return jsonResponse({ assets: [assetB] });
      if (url.endsWith(`/api/studio/assets/${assetB.id}/download`)) {
        return jsonResponse({ url: "https://private.example/b.wav", expires_in_seconds: 600 });
      }
      if (url.endsWith(`/api/studio/documents/${documentB.id}`) && method === "PATCH") {
        const payload = JSON.parse(String(init?.body));
        return jsonResponse({ document: {
          ...documentB,
          revision: 2,
          body_json: payload.body_json,
          body_text: payload.body_text
        } });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    window.history.replaceState(null, "", `/#estudio/document/${documentA.id}`);
    render(<StudioPage />);
    expect(await screen.findByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent("Documento A");

    window.history.replaceState(null, "", `/#estudio/document/${documentB.id}`);
    fireEvent(window, new PopStateEvent("popstate"));
    const bodyB = await screen.findByRole("textbox", { name: "Conteúdo do documento" });
    await waitFor(() => expect(bodyB).toHaveTextContent("Documento B"));
    const materialB = await screen.findByRole("button", { name: "Abrir reflexao.wav" });
    await user.click(materialB);

    expect(materialB).toHaveAttribute("aria-pressed", "true");
    expect(fetchSpy.mock.calls.some(([url, init]) => (
      String(url).endsWith(`/api/studio/documents/${documentA.id}`) && init?.method === "PATCH"
    ))).toBe(false);
    expect(fetchSpy.mock.calls.some(([url, init]) => (
      String(url).endsWith(`/api/studio/documents/${documentB.id}`) && init?.method === "PATCH"
    ))).toBe(false);
    expect(bodyB).toHaveTextContent("Documento B");
    expect(bodyB).not.toHaveTextContent("Transcrição somente B.");
    expect(screen.getByLabelText("Trecho da transcrição")).toHaveTextContent("Transcrição somente B.");
  });

  it("keeps a document B attachment when document A's obsolete asset list resolves", async () => {
    const user = userEvent.setup();
    const assetsA = deferred<Response>();
    const assetB = rawAssetWith({
      id: "asset_b",
      document_id: rawDocumentB.id,
      kind: "file",
      display_name: "plano-b.pdf",
      mime_type: "application/pdf",
      created_at: "2026-07-13T15:00:00.000Z"
    });
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/studio/home")) return Promise.resolve(jsonResponse({
        home: { recent_documents: [rawDocument, rawDocumentB], focused_documents: [], pending_review_count: 0, next_rituals: [] }
      }));
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return assetsA.promise;
      if (url.endsWith(`/api/studio/documents/${rawDocumentB.id}/assets`) && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ asset: assetB }, 201));
      }
      if (url.endsWith(`/api/studio/documents/${rawDocumentB.id}/assets`)) return Promise.resolve(jsonResponse({ assets: [] }));
      if (url.endsWith(`/api/studio/assets/${assetB.id}/download`)) {
        return Promise.resolve(jsonResponse({ url: "https://private.example/plano-b.pdf", expires_in_seconds: 600 }));
      }
      return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404));
    });
    render(<StudioPage />);

    await user.click((await screen.findAllByRole("button", { name: /Reflexão estratégica/u })).at(-1)!);
    await user.click(screen.getByRole("button", { name: "Início" }));
    await user.click((await screen.findAllByRole("button", { name: /Plano comercial/u })).at(-1)!);
    await user.upload(screen.getByTestId("studio-material-file-input"), new File(["b"], "plano-b.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("button", { name: "Abrir plano-b.pdf" })).toBeInTheDocument();

    await act(async () => assetsA.resolve(jsonResponse({ assets: [rawAsset] })));
    expect(screen.getByRole("button", { name: "Abrir plano-b.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir reflexao.wav" })).not.toBeInTheDocument();
  });

  it("does not show a server-owned A upload when it resolves while B remains selected", async () => {
    const user = userEvent.setup();
    const uploadA = deferred<Response>();
    const attachedA = rawAssetWith({
      id: "asset_late_a",
      kind: "file",
      display_name: "tardio-a.pdf",
      mime_type: "application/pdf",
      created_at: "2026-07-15T15:00:00.000Z",
      updated_at: "2026-07-15T15:00:00.000Z"
    });
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/studio/home")) return Promise.resolve(jsonResponse({
        home: { recent_documents: [rawDocument, rawDocumentB], focused_documents: [], pending_review_count: 0, next_rituals: [] }
      }));
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`) && init?.method === "POST") return uploadA.promise;
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return Promise.resolve(jsonResponse({ assets: [] }));
      if (url.endsWith(`/api/studio/documents/${rawDocumentB.id}/assets`)) return Promise.resolve(jsonResponse({ assets: [] }));
      return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404));
    });
    render(<StudioPage />);

    await user.click((await screen.findAllByRole("button", { name: /Reflexão estratégica/u })).at(-1)!);
    await user.upload(screen.getByTestId("studio-material-file-input"), new File(["A"], "tardio-a.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Início" }));
    await user.click((await screen.findAllByRole("button", { name: /Plano comercial/u })).at(-1)!);

    await act(async () => uploadA.resolve(jsonResponse({ asset: attachedA }, 201)));

    expect(screen.getByRole("heading", { name: "Plano comercial" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "tardio-a.pdf" })).not.toBeInTheDocument();
  });

  it("shows a server-owned A upload that resolves after navigating A to B and back to A", async () => {
    const user = userEvent.setup();
    const uploadA = deferred<Response>();
    const returnedAAssets = deferred<Response>();
    const attachedA = rawAssetWith({
      id: "asset_returned_a",
      kind: "file",
      display_name: "retornado-a.pdf",
      mime_type: "application/pdf",
      created_at: "2026-07-15T15:00:00.000Z",
      updated_at: "2026-07-15T15:00:00.000Z"
    });
    let aAssetLists = 0;
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/studio/home")) return Promise.resolve(jsonResponse({
        home: { recent_documents: [rawDocument, rawDocumentB], focused_documents: [], pending_review_count: 0, next_rituals: [] }
      }));
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`) && init?.method === "POST") return uploadA.promise;
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) {
        aAssetLists += 1;
        return aAssetLists === 1 ? Promise.resolve(jsonResponse({ assets: [] })) : returnedAAssets.promise;
      }
      if (url.endsWith(`/api/studio/documents/${rawDocumentB.id}/assets`)) return Promise.resolve(jsonResponse({ assets: [] }));
      if (url.endsWith(`/api/studio/assets/${attachedA.id}/download`)) {
        return Promise.resolve(jsonResponse({ url: "https://private.example/retornado-a.pdf", expires_in_seconds: 600 }));
      }
      return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404));
    });
    render(<StudioPage />);

    await user.click((await screen.findAllByRole("button", { name: /Reflexão estratégica/u })).at(-1)!);
    await user.upload(screen.getByTestId("studio-material-file-input"), new File(["A"], "retornado-a.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Início" }));
    await user.click((await screen.findAllByRole("button", { name: /Plano comercial/u })).at(-1)!);
    await user.click(screen.getByRole("button", { name: "Início" }));
    await user.click((await screen.findAllByRole("button", { name: /Reflexão estratégica/u })).at(-1)!);
    await waitFor(() => expect(aAssetLists).toBe(2));
    await act(async () => returnedAAssets.resolve(jsonResponse({ assets: [] })));

    await act(async () => uploadA.resolve(jsonResponse({ asset: attachedA }, 201)));

    expect(await screen.findByRole("button", { name: "Abrir retornado-a.pdf" })).toBeInTheDocument();
    expect(aAssetLists).toBe(2);
  });

  it("ignores a server-owned upload callback after the entire StudioPage unmounts", async () => {
    const user = userEvent.setup();
    const upload = deferred<Response>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let uploadRequests = 0;
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`)) return Promise.resolve(jsonResponse({ document: rawDocument }));
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`) && init?.method === "POST") {
        uploadRequests += 1;
        return upload.promise;
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return Promise.resolve(jsonResponse({ assets: [] }));
      return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404));
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    const view = render(<StudioPage />);

    await screen.findByRole("heading", { name: "Reflexão estratégica" });
    await user.upload(screen.getByTestId("studio-material-file-input"), new File(["late"], "apos-unmount.pdf", { type: "application/pdf" }));
    expect(uploadRequests).toBe(1);
    view.unmount();
    const fetchCallsAfterUnmount = vi.mocked(globalThis.fetch).mock.calls.length;
    const errorsAfterUnmount = consoleError.mock.calls.length;

    await act(async () => upload.resolve(jsonResponse({ asset: rawAssetWith({
      id: "asset_after_page_unmount",
      kind: "file",
      display_name: "apos-unmount.pdf",
      mime_type: "application/pdf",
      created_at: "2026-07-15T15:00:00.000Z",
      updated_at: "2026-07-15T15:00:00.000Z"
    }) }, 201)));

    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(fetchCallsAfterUnmount);
    expect(consoleError.mock.calls).toHaveLength(errorsAfterUnmount);
    expect(screen.queryByRole("button", { name: "Abrir apos-unmount.pdf" })).not.toBeInTheDocument();
  });

  it("merges a late initial list with a newly attached material for the same document", async () => {
    const user = userEvent.setup();
    const initialAssets = deferred<Response>();
    const attached = rawAssetWith({
      id: "asset_new",
      kind: "file",
      display_name: "novo.pdf",
      mime_type: "application/pdf",
      created_at: "2026-07-13T14:00:00.000Z"
    });
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`)) return Promise.resolve(jsonResponse({ document: rawDocument }));
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`) && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ asset: attached }, 201));
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return initialAssets.promise;
      return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404));
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    render(<StudioPage />);

    await screen.findByRole("heading", { name: "Reflexão estratégica" });
    await user.upload(screen.getByTestId("studio-material-file-input"), new File(["new"], "novo.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("button", { name: "Abrir novo.pdf" })).toBeInTheDocument();
    await act(async () => initialAssets.resolve(jsonResponse({ assets: [rawAsset] })));

    expect(screen.getByRole("button", { name: "Abrir reflexao.wav" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir novo.pdf" })).toBeInTheDocument();
  });

  it("keeps a newly attached material visible when the current document list fails", async () => {
    const user = userEvent.setup();
    const initialAssets = deferred<Response>();
    const attached = rawAssetWith({
      id: "asset_preserved",
      kind: "file",
      display_name: "preservado.pdf",
      mime_type: "application/pdf",
      created_at: "2026-07-13T14:00:00.000Z"
    });
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`)) return Promise.resolve(jsonResponse({ document: rawDocument }));
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`) && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ asset: attached }, 201));
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return initialAssets.promise;
      return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404));
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    render(<StudioPage />);

    await screen.findByRole("heading", { name: "Reflexão estratégica" });
    await user.upload(screen.getByTestId("studio-material-file-input"), new File(["known"], "preservado.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("button", { name: "Abrir preservado.pdf" })).toBeInTheDocument();

    await act(async () => initialAssets.resolve(jsonResponse({
      error: { code: "TEMPORARY", message: "retry" }
    }, 503)));

    expect(screen.getByRole("button", { name: "Abrir preservado.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("alert", { name: "Falha ao carregar materiais do documento Reflexão estratégica" }))
      .toHaveTextContent("Não foi possível carregar os materiais preservados agora.");
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it("deduplicates assets by id while preserving the freshest known version", async () => {
    const user = userEvent.setup();
    const initialAssets = deferred<Response>();
    const firstAttached = rawAssetWith({
      id: "asset_same",
      kind: "file",
      display_name: "retornado-primeiro.pdf",
      mime_type: "application/pdf",
      created_at: "2026-07-13T14:00:00.000Z",
      updated_at: "2026-07-13T16:00:00.000Z"
    });
    const listedVersion = rawAssetWith({
      id: "asset_same",
      kind: "file",
      display_name: "listado-depois.pdf",
      mime_type: "application/pdf",
      created_at: "2026-07-13T14:00:00.000Z",
      updated_at: "2026-07-13T15:00:00.000Z"
    });
    const finalAttached = rawAssetWith({
      id: "asset_same",
      kind: "file",
      display_name: "retornado-por-ultimo.pdf",
      mime_type: "application/pdf",
      created_at: "2026-07-13T14:00:00.000Z",
      updated_at: "2026-07-13T17:00:00.000Z"
    });
    let attachments = 0;
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}`)) return Promise.resolve(jsonResponse({ document: rawDocument }));
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`) && init?.method === "POST") {
        attachments += 1;
        return Promise.resolve(jsonResponse({ asset: attachments === 1 ? firstAttached : finalAttached }, 201));
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return initialAssets.promise;
      return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404));
    });
    window.history.replaceState(null, "", `/#estudio/document/${rawDocument.id}`);
    render(<StudioPage />);

    await screen.findByRole("heading", { name: "Reflexão estratégica" });
    const input = screen.getByTestId("studio-material-file-input");
    await user.upload(input, new File(["first"], "primeiro.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("button", { name: "Abrir retornado-primeiro.pdf" })).toBeInTheDocument();

    await act(async () => initialAssets.resolve(jsonResponse({ assets: [listedVersion] })));
    expect(screen.getByRole("button", { name: "Abrir retornado-primeiro.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir listado-depois.pdf" })).not.toBeInTheDocument();

    await user.upload(input, new File(["last"], "ultimo.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("button", { name: "Abrir retornado-por-ultimo.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir listado-depois.pdf" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Materiais do documento" })).getAllByRole("button", { name: /^Abrir /u })).toHaveLength(1);
  });

  it("opens the configured ritual from the calm home in the private session surface", async () => {
    const user = userEvent.setup();
    const ritualId = "ritual_weekly";
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/studio/home")) return jsonResponse({
        home: {
          recent_documents: [],
          focused_documents: [],
          pending_review_count: 0,
          next_rituals: [{ id: ritualId, title: "Revisão semanal", scheduled_for: "2026-07-17T12:00:00.000Z" }]
        }
      });
      if (url.includes("/api/studio/structures?") && !init?.method) return jsonResponse({
        structures: [{
          id: ritualId,
          workspace_id: "workspace_a",
          owner_profile_id: "profile_owner",
          document_id: "document_ritual",
          document_title: "Revisão semanal",
          kind: "ritual",
          lifecycle_status: "active",
          revision: 1,
          horizon_at: null,
          metric_json: null,
          cadence_json: { frequency: "weekly", weekdays: [5], local_time: "09:00", timezone: "America/Sao_Paulo" },
          next_run_at: "2026-07-17T12:00:00.000Z",
          properties_json: { intention: "Revisar a semana", guide_questions: ["O que mudou?"] },
          created_at: "2026-07-14T12:00:00.000Z",
          updated_at: "2026-07-14T12:00:00.000Z",
          archived_at: null
        }],
        next_cursor: null
      });
      if (url.endsWith(`/api/studio/rituals/${ritualId}/sessions`) && init?.method === "POST") return jsonResponse({
        session: {
          id: "session_weekly",
          workspace_id: "workspace_a",
          owner_profile_id: "profile_owner",
          ritual_id: ritualId,
          status: "failed",
          revision: 1,
          context_json: null,
          preparation_json: null,
          answers_json: {},
          synthesis_json: null,
          prepare_ai_run_id: null,
          synthesis_ai_run_id: null,
          failure_code: "STUDIO_RITUAL_PREPARATION_FAILED",
          created_at: "2026-07-14T12:00:00.000Z",
          updated_at: "2026-07-14T12:00:00.000Z",
          completed_at: null
        }
      }, 201);
      if (url.endsWith("/api/studio/collections")) return jsonResponse({ collections: [] });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioPage />);

    const navigationStatus = screen.getByRole("status", { name: "Mudança de seção" });
    await user.click(screen.getByRole("button", { name: "Metas" }));
    expect(navigationStatus).toHaveTextContent("Seção Metas aberta.");
    await user.click(screen.getByRole("button", { name: "Início" }));
    expect(navigationStatus).toHaveTextContent("Seção Início aberta.");
    await user.click(await screen.findByRole("button", { name: "Iniciar Revisão semanal" }));

    expect(await screen.findByRole("heading", { name: "A preparação está indisponível agora." })).toBeInTheDocument();
    expect(navigationStatus).toBeEmptyDOMElement();
    expect(within(screen.getByRole("navigation", { name: "Seções do Estúdio" }))
      .getByRole("button", { name: "Rituais" })).toHaveAttribute("aria-current", "page");
    expect(window.location.hash).toBe("#estudio/rituals");
  });

  it("does not move focus back to the document heading when persisted assets are retried", async () => {
    const user = userEvent.setup();
    let assetRequests = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/studio/home")) {
        return jsonResponse({
          home: {
            recent_documents: [rawDocument], focused_documents: [], pending_review_count: 0, next_rituals: []
          }
        });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) {
        assetRequests += 1;
        if (assetRequests === 1) return jsonResponse({ error: { code: "TEMPORARY", message: "retry" } }, 503);
        return new Promise<Response>(() => undefined);
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioPage />);

    const documentButtons = await screen.findAllByRole("button", { name: /Reflexão estratégica/u });
    await user.click(documentButtons.at(-1)!);
    await screen.findByRole("alert");
    const persistentTarget = screen.getByRole("button", { name: "Tudo" });
    persistentTarget.focus();
    expect(persistentTarget).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(assetRequests).toBe(2));
    expect(persistentTarget).toHaveFocus();
  });

  it("never renders materials from a previous document while the next one is pending or fails", async () => {
    const user = userEvent.setup();
    const firstAssets = deferred<Response>();
    const secondAssets = deferred<Response>();
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/studio/home")) {
        return Promise.resolve(jsonResponse({
          home: {
            recent_documents: [rawDocument, rawDocumentB], focused_documents: [], pending_review_count: 0, next_rituals: []
          }
        }));
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) return firstAssets.promise;
      if (url.endsWith(`/api/studio/documents/${rawDocumentB.id}/assets`)) return secondAssets.promise;
      return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404));
    });
    render(<StudioPage />);

    await user.click((await screen.findAllByRole("button", { name: /Reflexão estratégica/u })).at(-1)!);
    expect(await screen.findByRole("status", { name: "Carregando materiais do documento Reflexão estratégica" }))
      .toHaveTextContent("Carregando materiais preservados");

    await user.click(screen.getByRole("button", { name: "Início" }));
    await user.click((await screen.findAllByRole("button", { name: /Plano comercial/u })).at(-1)!);
    expect(await screen.findByRole("status", { name: "Carregando materiais do documento Plano comercial" }))
      .toBeInTheDocument();

    await act(async () => firstAssets.resolve(jsonResponse({ assets: [rawAsset] })));
    expect(screen.queryByText("Escolher uma direção com calma.")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Carregando materiais do documento Plano comercial" })).toBeInTheDocument();

    await act(async () => secondAssets.resolve(jsonResponse({
      error: { code: "TEMPORARY", message: "retry" }
    }, 503)));
    const error = await screen.findByRole("alert", { name: "Falha ao carregar materiais do documento Plano comercial" });
    expect(error).toHaveTextContent("Não foi possível carregar os materiais preservados agora.");
    expect(screen.queryByText("Escolher uma direção com calma.")).not.toBeInTheDocument();
  });
});

const rawDocument = {
  id: "document_recent", workspace_id: "workspace_a", owner_profile_id: "profile_owner",
  title: "Reflexão estratégica", body_json: { type: "doc" }, body_text: "Escolher uma direção.",
  revision: 1, capture_mode: "audio", inbox_state: "pending_review", is_focused: false,
  status: "active", created_at: "2026-07-13T12:00:00.000Z",
  updated_at: "2026-07-13T12:01:00.000Z", archived_at: null
} as const;

const rawAsset = {
  id: "asset_recent", workspace_id: "workspace_a", owner_profile_id: "profile_owner",
  document_id: rawDocument.id, idempotency_key: "44444444-4444-4444-8444-444444444444",
  kind: "audio", display_name: "reflexao.wav", source_url: null, final_url: null,
  mime_type: "audio/wav", size_bytes: 52, extraction_status: "ready",
  extracted_text: "Escolher uma direção com calma.", last_error_code: null, attempt_count: 1,
  next_attempt_at: null, created_at: "2026-07-13T12:00:00.000Z",
  updated_at: "2026-07-13T12:01:00.000Z"
} as const;

const rawDocumentB = {
  ...rawDocument,
  id: "document_plan",
  title: "Plano comercial",
  body_text: "Crescer com consistência.",
  capture_mode: "text"
} as const;

function rawAssetWith(overrides: Record<string, unknown>) {
  return { ...rawAsset, ...overrides };
}

function studioAssetWith(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: "asset_default",
    workspaceId: "workspace_a",
    ownerProfileId: "profile_owner",
    documentId: rawDocument.id,
    idempotencyKey: null,
    kind: "file",
    displayName: "material.pdf",
    sourceUrl: null,
    finalUrl: null,
    mimeType: "application/pdf",
    sizeBytes: 10,
    extractionStatus: "pending",
    extractedText: null,
    lastErrorCode: null,
    attemptCount: 0,
    nextAttemptAt: null,
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function rawCollection(name: string) {
  return {
    id: "collection_1", workspace_id: "workspace_a", owner_profile_id: "profile_owner", name,
    created_at: "2026-07-13T12:00:00.000Z", updated_at: "2026-07-13T12:00:00.000Z"
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; }
    }
  });
}

function installTipTapDomGeometry() {
  const rectangle = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) };
  Object.defineProperty(globalThis.document, "elementFromPoint", {
    configurable: true,
    value: () => globalThis.document.body
  });
  Object.defineProperty(Document.prototype, "elementFromPoint", {
    configurable: true,
    value: () => globalThis.document.body
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => rectangle
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => ({ item: () => null, length: 0, [Symbol.iterator]: function* () {} })
  });
}

async function setTipTapSelection(editor: HTMLElement, offset: number) {
  const textNode = editor.querySelector("p")?.firstChild;
  if (!textNode) throw new Error("Expected a paragraph text node");
  editor.focus();
  const range = document.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function setTipTapRange(editor: HTMLElement, start: number, end: number) {
  const textNode = editor.querySelector("p")?.firstChild;
  if (!textNode) throw new Error("Expected a paragraph text node");
  editor.focus();
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
