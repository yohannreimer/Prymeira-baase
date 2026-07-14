import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StudioCopilot from "./StudioCopilot";
import { parseStudioSseStream, StudioAssistantStreamError } from "./studio-api";
import type { StudioDocument } from "./studio.types";

describe("Studio assistant SSE", () => {
  it("decodes arbitrary UTF-8 boundaries, named events and multiline data incrementally", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode([
      "event: run\n", "data: {\n", "data: \"ai_run_id\":\"run_1\",\"conversation_id\":\"conversation_1\"}\n\n",
      "event: delta\ndata: {\"text\":\"olá 🌿\"}\n\n",
      ": heartbeat\n\nevent: done\ndata: {\"message_id\":\"message_1\"}\n\n"
    ].join(""));
    const emojiStart = bytes.findIndex((value) => value === 0xf0);
    const chunks = [bytes.slice(0, 7), bytes.slice(7, emojiStart + 1), bytes.slice(emojiStart + 1, emojiStart + 3), bytes.slice(emojiStart + 3)];
    const deltas: string[] = [];
    const runs: string[] = [];
    const done: string[] = [];

    await parseStudioSseStream(streamResponse(chunks), {
      onRun: (run) => runs.push(run.conversationId),
      onDelta: (text) => deltas.push(text),
      onDone: (id) => done.push(id)
    });

    expect(runs).toEqual(["conversation_1"]);
    expect(deltas).toEqual(["olá 🌿"]);
    expect(done).toEqual(["message_1"]);
  });

  it("distinguishes server errors and EOF without done", async () => {
    await expect(parseStudioSseStream(sse("event: error\ndata: {\"code\":\"LIMIT\",\"retryable\":false}\n\n"), {}))
      .rejects.toMatchObject({ code: "LIMIT", retryable: false });
    await expect(parseStudioSseStream(sse("event: delta\ndata: {\"text\":\"incompleto\"}\n\n"), {}))
      .rejects.toEqual(expect.objectContaining<Partial<StudioAssistantStreamError>>({ code: "STUDIO_ASSISTANT_INCOMPLETE" }));
  });
});

describe("StudioCopilot", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
    }) });
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(), key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; }
    } });
  });

  it("requires explicit research consent on every turn and sends only bounded selected text", async () => {
    const user = userEvent.setup();
    const bodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return sse("event: run\ndata: {\"ai_run_id\":\"run\",\"conversation_id\":\"conversation\"}\n\nevent: delta\ndata: {\"text\":\"Resposta\"}\n\nevent: done\ndata: {\"message_id\":\"message\"}\n\n");
    });
    render(<StudioCopilot document={document} selectedText={"x".repeat(5_000)} onDocumentChange={vi.fn()} />);

    await user.click(screen.getByRole("checkbox", { name: /pesquisar na internet/i }));
    await user.type(screen.getByLabelText(/o que você quer entender/i), "Compare este trecho");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await screen.findByText("Resposta");
    expect(bodies[0]).toMatchObject({ allow_external_research: true, selected_text_context: "x".repeat(4_000) });
    expect(screen.getByRole("checkbox", { name: /pesquisar na internet/i })).not.toBeChecked();
  });

  it("renders secure external citations separately", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([
      "event: citation\ndata: {\"source_type\":\"external_url\",\"source_id\":null,\"url\":\"https://example.com/report\",\"label\":\"Relatório público\",\"excerpt\":\"Trecho\",\"observed_at\":\"2026-07-14T10:00:00.000Z\",\"period_from\":null,\"period_to\":null,\"metadata\":{}}\n\n",
      "event: delta\ndata: {\"text\":\"Veja a fonte.\"}\n\n",
      "event: done\ndata: {\"message_id\":\"message\"}\n\n"
    ].join("")));
    render(<StudioCopilot document={document} onDocumentChange={vi.fn()} />);
    await user.type(screen.getByLabelText(/o que você quer entender/i), "Pesquisar");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await user.click(await screen.findByRole("button", { name: /1 fonte/i }));

    const link = screen.getByRole("link", { name: /relatório público/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("previews, edits and accepts a suggestion only after the new server version arrives", async () => {
    const user = userEvent.setup();
    const onDocumentChange = vi.fn();
    const documentResponse = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/assistant/turns")) return sse(suggestionStream());
      if (url.endsWith("/suggestions/suggestion_1/accept")) return json({
        suggestion: rawSuggestion(), version: rawVersion()
      });
      if (url.endsWith("/documents/document_1") && !init?.method) return documentResponse.promise;
      return json({}, 404);
    });
    render(<StudioCopilot document={document} onDocumentChange={onDocumentChange} />);
    await user.click(screen.getByRole("checkbox", { name: /criar proposta/i }));
    await user.type(screen.getByLabelText(/o que você quer entender/i), "Organize");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const card = await screen.findByRole("region", { name: "Proposta revisável da IA" });
    expect(within(card).getByRole("heading", { name: "Fatos" })).toBeInTheDocument();
    expect(within(card).getByRole("region", { name: "Proposta" })).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Editar" }));
    await user.clear(within(card).getByLabelText("Texto"));
    await user.type(within(card).getByLabelText("Texto"), "Versão editada");
    await user.click(within(card).getByRole("button", { name: "Aceitar como nova versão" }));

    expect(onDocumentChange).not.toHaveBeenCalled();
    documentResponse.resolve(json({ document: { ...rawDocument(), revision: 2, body_text: "Versão editada" } }));
    await waitFor(() => expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({ revision: 2, bodyText: "Versão editada" })));
  });

  it("cancels an active turn and ignores stale stream updates", async () => {
    const user = userEvent.setup();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream({ start(value) { controller = value; } }), {
      headers: { "content-type": "text/event-stream" }
    }));
    render(<StudioCopilot document={document} onDocumentChange={vi.fn()} />);
    await user.type(screen.getByLabelText(/o que você quer entender/i), "Pensar");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await user.click(screen.getByRole("button", { name: "Parar resposta" }));
    controller!.enqueue(new TextEncoder().encode("event: delta\ndata: {\"text\":\"não deve aparecer\"}\n\n"));
    controller!.close();
    expect(screen.queryByText("não deve aparecer")).not.toBeInTheDocument();
  });

  it("becomes a focus-contained mobile sheet and restores the page on Escape", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn()
    }) });
    const { unmount } = render(<StudioCopilot document={document} onDocumentChange={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Copiloto do Estúdio" });
    await waitFor(() => expect(screen.getByLabelText(/o que você quer entender/i)).toHaveFocus());
    expect(documentBody()).toHaveStyle({ overflow: "hidden" });
    await user.keyboard("{Escape}");
    const trigger = screen.getByRole("button", { name: /pensar com a ia/i });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(documentBody().style.overflow).toBe("");
    unmount();
    expect(documentBody().style.overflow).toBe("");
    expect(dialog).not.toBeInTheDocument();
  });

  it("bounds a persisted desktop width", () => {
    window.localStorage.setItem("baase:studio:copilot-width", "9999");
    render(<StudioCopilot document={document} onDocumentChange={vi.fn()} />);
    expect(screen.getByRole("complementary", { name: "Copiloto do Estúdio" })).toHaveStyle({ width: "520px" });
  });

  it("retries the same turn after a terminal stream error", async () => {
    const user = userEvent.setup();
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      return calls === 1
        ? sse("event: error\ndata: {\"code\":\"STUDIO_ASSISTANT_FAILED\",\"retryable\":true}\n\n")
        : sse("event: delta\ndata: {\"text\":\"Resposta recuperada\"}\n\nevent: done\ndata: {\"message_id\":\"message\"}\n\n");
    });
    render(<StudioCopilot document={document} onDocumentChange={vi.fn()} />);
    await user.type(screen.getByLabelText(/o que você quer entender/i), "Tente responder");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const error = await screen.findByRole("alert");
    expect(error).toHaveFocus();
    await user.click(within(error).getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Resposta recuperada")).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("dismisses a pending suggestion through the API and focuses its persistent decision", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      requests.push(String(input));
      return String(input).endsWith("/assistant/turns") ? sse(suggestionStream()) : json({ suggestion: rawSuggestion(), version: null });
    });
    render(<StudioCopilot document={document} onDocumentChange={vi.fn()} />);
    await user.type(screen.getByLabelText(/o que você quer entender/i), "Sugira");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await user.click(await screen.findByRole("button", { name: "Dispensar" }));
    const decision = await screen.findByRole("status", { name: "" });
    expect(decision).toHaveTextContent("Proposta dispensada");
    await waitFor(() => expect(decision).toHaveFocus());
    expect(requests.at(-1)).toContain("/suggestions/suggestion_1/dismiss");
  });

  it("resizes by keyboard and pointer within persisted bounds, then restores focus after collapsing", async () => {
    const user = userEvent.setup();
    render(<StudioCopilot document={document} onDocumentChange={vi.fn()} />);
    const panel = screen.getByRole("complementary", { name: "Copiloto do Estúdio" });
    const separator = screen.getByRole("separator", { name: "Redimensionar copiloto" });
    separator.focus();
    await user.keyboard("{End}");
    expect(panel).toHaveStyle({ width: "520px" });
    expect(window.localStorage.getItem("baase:studio:copilot-width")).toBe("520");
    Object.defineProperty(separator, "setPointerCapture", { configurable: true, value: vi.fn() });
    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 2_000 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 2_000 });
    expect(panel).toHaveStyle({ width: "300px" });
    await waitFor(() => expect(window.localStorage.getItem("baase:studio:copilot-width")).toBe("300"));

    await user.click(screen.getByRole("button", { name: "Recolher copiloto" }));
    const reopen = screen.getByRole("button", { name: /pensar com a ia/i });
    await waitFor(() => expect(reopen).toHaveFocus());
    await user.click(reopen);
    expect(screen.getByRole("complementary", { name: "Copiloto do Estúdio" })).toBeInTheDocument();
  });

  it("forwards internal citations from a suggestion envelope", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const suggestion = rawSuggestion();
    (suggestion.payload_json as { citations: unknown[] }).citations = [{ source_type: "operational_resource", source_id: "routine_7", url: null,
      label: "Rotina semanal", excerpt: "", observed_at: "2026-07-14T10:00:00.000Z", period_from: null,
      period_to: null, metadata: { resourceType: "routine" } }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse(`event: suggestion\ndata: ${JSON.stringify(suggestion)}\n\nevent: done\ndata: {"message_id":"message"}\n\n`));
    render(<StudioCopilot document={document} onDocumentChange={vi.fn()} onOpenInternalSource={open} />);
    await user.type(screen.getByLabelText(/o que você quer entender/i), "Sugira");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const card = await screen.findByRole("region", { name: "Proposta revisável da IA" });
    await user.click(within(card).getByRole("button", { name: /1 fonte/i }));
    await user.click(screen.getByRole("button", { name: /rotina semanal/i }));
    expect(open).toHaveBeenCalledWith({ kind: "routine", resourceId: "routine_7" }, expect.objectContaining({ label: "Rotina semanal" }));
  });
});

const document: StudioDocument = {
  id: "document_1", workspaceId: "workspace", ownerProfileId: "owner", captureKey: null,
  title: "Plano", bodyJson: { type: "doc", content: [] }, bodyText: "Original", revision: 1,
  captureMode: "text", inboxState: "reviewed", isFocused: false, status: "active",
  createdAt: "2026-07-14T10:00:00.000Z", updatedAt: "2026-07-14T10:00:00.000Z", archivedAt: null
};

function suggestionStream() {
  return `event: delta\ndata: {"text":"Uma proposta."}\n\nevent: suggestion\ndata: ${JSON.stringify(rawSuggestion())}\n\nevent: done\ndata: {"message_id":"message"}\n\n`;
}
function rawSuggestion() { return {
  id: "suggestion_1", document_id: "document_1", conversation_id: "conversation", ai_run_id: "run",
  kind: "text", status: "pending", accepted_version_id: null, created_at: "2026-07-14T10:00:00.000Z", decided_at: null,
  payload_json: {
    facts: [{ statement: "Existe um plano.", citation_indexes: [] }],
    inferences: [{ statement: "Há direção.", basis: "Texto", confidence: "medium" }],
    gaps: [{ question: "Qual prazo?", reason: "Não informado" }], citations: [],
    proposal: { document_id: "document_1", expected_revision: 1, title: "Plano", body_json: { type: "doc", content: [] }, body_text: "Proposta" }
  }
}; }
function rawVersion() { return {
  id: "version_2", workspace_id: "workspace", owner_profile_id: "owner", document_id: "document_1",
  version_number: 2, body_json: { type: "doc", content: [] }, body_text: "Versão editada", origin: "accepted_ai_suggestion",
  actor_profile_id: "owner", ai_run_id: "run", created_at: "2026-07-14T10:00:00.000Z"
}; }
function rawDocument() { return {
  id: "document_1", workspace_id: "workspace", owner_profile_id: "owner", capture_key: null, title: "Plano",
  body_json: { type: "doc", content: [] }, body_text: "Original", revision: 1, capture_mode: "text",
  inbox_state: "reviewed", is_focused: false, status: "active", created_at: "2026-07-14T10:00:00.000Z",
  updated_at: "2026-07-14T10:00:00.000Z", archived_at: null
}; }
function sse(value: string) { return new Response(value, { headers: { "content-type": "text/event-stream" } }); }
function streamResponse(chunks: Uint8Array[]) { return new Response(new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } })); }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function documentBody() { return window.document.body; }
