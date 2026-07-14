import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioDocument } from "./studio.types";
import StudioEditor from "./StudioEditor";

describe("StudioEditor", () => {
  beforeEach(() => {
    installLocalStorage();
    installTipTapDomGeometry();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a persistent save status beside the editable title", () => {
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Título do documento" })).toHaveValue("Plano anual");
    expect(screen.getByRole("status", { name: "Estado do salvamento" })).toHaveTextContent("Salvo");
    expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toBeInTheDocument();
  });

  it("offers explicit, non-destructive conflict actions", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith(`/documents/${document.id}`) && init?.method === "PATCH") {
        return response({ error: { code: "STUDIO_DOCUMENT_CHANGED", message: "Mudou no servidor." } }, 409);
      }
      return response({ document: { ...rawDocument, revision: 8, body_text: "Versão do servidor" } });
    });
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} debounceMs={0} />);

    const title = screen.getByRole("textbox", { name: "Título do documento" });
    await user.clear(title);
    await user.type(title, "Minha versão");

    expect(await screen.findByRole("alert")).toHaveTextContent("Há uma versão mais recente");
    expect(screen.getByRole("button", { name: "Recarregar versão do servidor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manter minha cópia como novo documento" })).toBeInTheDocument();
  });

  it("preserves a conflicted local draft by creating a separate document", async () => {
    const user = userEvent.setup();
    const onDocumentChange = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/documents/${document.id}`) && init?.method === "PATCH") {
        return response({ error: { code: "STUDIO_DOCUMENT_CHANGED", message: "Mudou no servidor." } }, 409);
      }
      if (url.endsWith("/documents") && init?.method === "POST") {
        return response({ document: { ...rawDocument, id: "document_copy", revision: 1, title: "Minha cópia (cópia)" } }, 201);
      }
      return response({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioEditor document={document} onDocumentChange={onDocumentChange} debounceMs={0} />);

    const title = screen.getByRole("textbox", { name: "Título do documento" });
    await user.clear(title);
    await user.type(title, "Minha cópia");
    await user.click(await screen.findByRole("button", { name: "Manter minha cópia como novo documento" }));

    await waitFor(() => expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({ id: "document_copy" })));
    const createCall = fetchSpy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      title: "Minha cópia (cópia)",
      capture_mode: "text"
    });
    const patchCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patchCalls.length).toBeGreaterThan(0);
    expect(patchCalls.every(([, init]) => JSON.parse(String(init?.body)).expected_revision === 4)).toBe(true);
  });

  it("persists TipTap JSON and its text snapshot together", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const input = JSON.parse(String(init?.body));
      return response({ document: { ...rawDocument, revision: 5, body_json: input.body_json, body_text: input.body_text } });
    });
    const onDocumentChange = vi.fn();
    render(<StudioEditor document={document} onDocumentChange={onDocumentChange} debounceMs={0} />);

    const body = screen.getByRole("textbox", { name: "Conteúdo do documento" });
    act(() => body.focus());
    await user.keyboard("Nova direção");

    await waitFor(() => expect(onDocumentChange).toHaveBeenCalled());
    const payload = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body));
    expect(payload.body_json).toMatchObject({ type: "doc", content: expect.any(Array) });
    expect(payload.body_text).toContain("Nova direção");
  });

  it("previews immutable versions and restores one through a new PATCH", async () => {
    const user = userEvent.setup();
    const onDocumentChange = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/versions")) return response({ versions: [rawVersion] });
      if (url.endsWith(`/documents/${document.id}`) && init?.method === "PATCH") {
        return response({ document: { ...rawDocument, revision: 5, body_text: rawVersion.body_text, body_json: rawVersion.body_json } });
      }
      return response({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioEditor document={document} onDocumentChange={onDocumentChange} />);

    await user.click(screen.getByRole("button", { name: "Ver histórico de versões" }));
    const drawer = await screen.findByRole("region", { name: "Histórico de versões" });
    await user.click(within(drawer).getByRole("button", { name: /Versão 2/u }));

    expect(within(drawer).getByRole("document", { name: "Prévia imutável da versão 2" }))
      .toHaveTextContent("Direção anterior preservada.");
    await user.click(within(drawer).getByRole("button", { name: "Restaurar como nova versão" }));

    await waitFor(() => expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({ revision: 5 })));
    const patchCall = fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      expected_revision: 4,
      body_text: "Direção anterior preservada."
    });
  });
});

const rawDocument = {
  id: "document_1", workspace_id: "workspace_a", owner_profile_id: "profile_owner", capture_key: null,
  title: "Plano anual", body_json: { type: "doc" }, body_text: "Original", revision: 4,
  capture_mode: "text", inbox_state: "reviewed", is_focused: false, status: "active",
  created_at: "2026-07-10T10:00:00.000Z", updated_at: "2026-07-13T10:00:00.000Z", archived_at: null
} as const;

const document: StudioDocument = {
  id: rawDocument.id, workspaceId: rawDocument.workspace_id, ownerProfileId: rawDocument.owner_profile_id,
  captureKey: null, title: rawDocument.title, bodyJson: rawDocument.body_json, bodyText: rawDocument.body_text,
  revision: rawDocument.revision, captureMode: rawDocument.capture_mode, inboxState: rawDocument.inbox_state,
  isFocused: false, status: "active", createdAt: rawDocument.created_at, updatedAt: rawDocument.updated_at,
  archivedAt: null
};

const rawVersion = {
  id: "version_2", workspace_id: "workspace_a", owner_profile_id: "profile_owner",
  document_id: "document_1", version_number: 2, body_json: { type: "doc", content: [{ type: "paragraph" }] },
  body_text: "Direção anterior preservada.", origin: "user", actor_profile_id: "profile_owner",
  ai_run_id: null, created_at: "2026-07-11T10:00:00.000Z"
} as const;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value))
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
