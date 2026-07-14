import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudioPage from "./StudioPage";

const studioStyles = readFileSync(resolve(process.cwd(), "src/studio/studio.css"), "utf8");

describe("StudioPage", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/#estudio");
    installLocalStorage();
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
      "Arquivo"
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
      if (url.endsWith("/api/studio/collections")) return jsonResponse({ collections: [] });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });

    render(<StudioPage />);

    expect(screen.getByRole("button", { name: "Entrada" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("Toda captura já foi revisada.")).toBeInTheDocument();

    window.history.replaceState(null, "", "/#estudio/plans");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.getByRole("button", { name: "Planos" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Planos" })).toBeInTheDocument();
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
    vi.mocked(globalThis.fetch).mockImplementation(async () => jsonResponse({
      error: { code: status === 403 ? "STUDIO_OWNER_SCOPE_DENIED" : "STUDIO_DOCUMENT_NOT_FOUND", message: "private" }
    }, status));
    window.history.replaceState(null, "", "/#estudio/document/missing");
    render(<StudioPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Este registro não está disponível");
    const back = screen.getByRole("button", { name: "Voltar para Tudo" });
    expect(back).toHaveFocus();
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

  it("keeps every section accessible in the responsive overflow navigation", () => {
    render(<StudioPage />);

    const navigation = screen.getByRole("navigation", { name: "Seções do Estúdio" });
    expect(navigation).not.toHaveAttribute("aria-hidden");
    expect(within(navigation).getAllByRole("button")).toHaveLength(9);
    expect(screen.getByRole("region", { name: "Conteúdo da seção" })).toBeVisible();
    expect(studioStyles).toMatch(/@media \(max-width: 760px\)[\s\S]*overflow-x: auto/);
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

  it("opens a recent document with persisted assets, transcript, original, and focused heading", async () => {
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
    expect(await screen.findByText("Escolher uma direção com calma.")).toBeInTheDocument();
    expect(screen.getByTestId("studio-audio-player")).toHaveAttribute("src", "https://private.example/reflexao.wav");
    expect(screen.getByRole("link", { name: "Baixar áudio original" })).toHaveAttribute(
      "href", "https://private.example/reflexao.wav"
    );
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
