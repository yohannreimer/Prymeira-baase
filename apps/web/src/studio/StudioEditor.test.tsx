import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioDocument } from "./studio.types";
import StudioEditor, { type StudioEditorHandle } from "./StudioEditor";

const studioStyles = readFileSync(resolve(process.cwd(), "src/studio/studio.css"), "utf8");

describe("StudioEditor", () => {
  beforeEach(() => {
    installLocalStorage();
    installTipTapDomGeometry();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a persistent save status beside the editable title", async () => {
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} />);
    await waitForStructureBadge();

    expect(screen.getByRole("textbox", { name: "Título do documento" })).toHaveValue("Plano anual");
    expect(screen.getByRole("status", { name: "Estado do salvamento" })).toHaveTextContent("Salvo");
    expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toBeInTheDocument();
  });

  it("places the material region between the editable body and the supporting surfaces", async () => {
    const { container } = render(
      <StudioEditor
        document={document}
        onDocumentChange={vi.fn()}
        materialRegion={<section aria-label="Materiais de teste">Materiais</section>}
      />
    );

    const editableBody = screen.getByRole("textbox", { name: "Conteúdo do documento" });
    const materialRegion = screen.getByRole("region", { name: "Materiais de teste" });
    const relatedThoughts = screen.getByRole("heading", { name: "Pensamentos relacionados" });
    const copilot = await screen.findByRole("complementary", { name: "Copiloto do Estúdio" });
    const article = container.querySelector("article.studio-editor");

    expect(article).toContainElement(materialRegion);
    expect(editableBody.compareDocumentPosition(materialRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(materialRegion.compareDocumentPosition(relatedThoughts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(relatedThoughts.compareDocumentPosition(copilot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("inserts trimmed multiline text as paragraphs at the saved cursor and queues autosave", async () => {
    const editorRef = createRef<StudioEditorHandle>();
    const source = {
      ...document,
      bodyJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Antes depois" }] }]
      },
      bodyText: "Antes depois"
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      return response({ document: {
        ...rawDocument,
        revision: 5,
        body_json: payload.body_json,
        body_text: payload.body_text
      } });
    });
    render(<StudioEditor ref={editorRef} document={source} onDocumentChange={vi.fn()} debounceMs={0} />);
    const body = screen.getByRole("textbox", { name: "Conteúdo do documento" });

    await setTipTapSelection(body, 5);
    let inserted = false;
    act(() => { inserted = editorRef.current?.insertTextAtLastSelection("  Primeira  \r\n\r\n Segunda ") ?? false; });

    expect(inserted).toBe(true);
    expect(body).toHaveFocus();
    expect(within(body).getAllByText(/Antes|Primeira|Segunda|depois/u).map((node) => node.textContent)).toEqual([
      "Antes", "Primeira", "Segunda", " depois"
    ]);
    await waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const patchCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patchCalls).toHaveLength(1);
    const patchCall = patchCalls[0];
    expect(JSON.parse(String(patchCall?.[1]?.body)).body_text).toBe("Antes\nPrimeira\nSegunda\n depois");
  });

  it("preserves the last meaningful saved edit once with keepalive on pagehide", async () => {
    const editorRef = createRef<StudioEditorHandle>();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body));
        return response({ document: {
          ...rawDocument,
          revision: 5,
          body_json: payload.body_json,
          body_text: payload.body_text
        } });
      }
      if (url.endsWith(`/documents/${document.id}/exit-checkpoint`) && init?.method === "POST") {
        return response({ document: { ...rawDocument, revision: 5 }, version: {
          ...rawVersion,
          version_number: 3,
          source_revision: 5,
          checkpoint_reason: "document_exit",
          is_legacy: false
        } });
      }
      return response({}, 404);
    });
    const view = render(
      <StudioEditor ref={editorRef} document={document} onDocumentChange={vi.fn()} debounceMs={0} />
    );

    act(() => { editorRef.current?.insertTextAtLastSelection("Mudança longa o bastante para preservar na saída"); });
    await waitFor(() => expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));

    window.dispatchEvent(new PageTransitionEvent("pagehide"));

    await waitFor(() => expect(fetchSpy.mock.calls.some(([input, init]) => (
      String(input).endsWith(`/documents/${document.id}/exit-checkpoint`) && init?.method === "POST"
    ))).toBe(true));
    const checkpointCall = fetchSpy.mock.calls.find(([input, init]) => (
      String(input).endsWith(`/documents/${document.id}/exit-checkpoint`) && init?.method === "POST"
    ));
    expect(checkpointCall?.[1]?.keepalive).toBe(true);
    expect(JSON.parse(String(checkpointCall?.[1]?.body))).toEqual({ known_revision: 5 });

    view.unmount();
    await Promise.resolve();
    expect(fetchSpy.mock.calls.filter(([input, init]) => (
      String(input).endsWith(`/documents/${document.id}/exit-checkpoint`) && init?.method === "POST"
    ))).toHaveLength(1);
  });

  it("keeps the pending PATCH and sends only a small checkpoint on pagehide", async () => {
    const editorRef = createRef<StudioEditorHandle>();
    const pendingPatch = deferred<Response>();
    let patchSignal: AbortSignal | null | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        patchSignal = init.signal;
        return pendingPatch.promise;
      }
      if (url.endsWith(`/documents/${document.id}/exit-checkpoint`) && init?.method === "POST") {
        const payload = JSON.parse(String(init.body));
        return response({
          document: { ...rawDocument, revision: payload.known_revision },
          version: { ...rawVersion, version_number: 3,
            checkpoint_reason: "document_exit", source_revision: payload.known_revision, is_legacy: false }
        });
      }
      return response({}, 404);
    });
    render(<StudioEditor ref={editorRef} document={document} onDocumentChange={vi.fn()} debounceMs={0} />);
    act(() => { editorRef.current?.insertTextAtLastSelection("Snapshot pendente para saída atômica"); });
    await waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));

    window.dispatchEvent(new PageTransitionEvent("pagehide"));

    await waitFor(() => expect(fetchSpy.mock.calls.some(([input]) => (
      String(input).endsWith(`/documents/${document.id}/exit-checkpoint`)
    ))).toBe(true));
    const exitCall = fetchSpy.mock.calls.find(([input]) => String(input).endsWith(`/documents/${document.id}/exit-checkpoint`));
    expect(patchSignal?.aborted).toBe(false);
    expect(exitCall?.[1]?.keepalive).toBe(true);
    expect(JSON.parse(String(exitCall?.[1]?.body))).toEqual({ known_revision: 4 });
    expect(new TextEncoder().encode(String(exitCall?.[1]?.body)).byteLength).toBeLessThan(64 * 1024);
  });

  it("inserts transcript blocks between two existing paragraphs", async () => {
    const editorRef = createRef<StudioEditorHandle>();
    const source: StudioDocument = {
      ...document,
      bodyJson: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Parágrafo um" }] },
          { type: "paragraph", content: [{ type: "text", text: "Parágrafo dois" }] }
        ]
      },
      bodyText: "Parágrafo um\nParágrafo dois"
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ document: { ...rawDocument, revision: 5 } }));
    render(<StudioEditor ref={editorRef} document={source} onDocumentChange={vi.fn()} debounceMs={0} />);
    const body = screen.getByRole("textbox", { name: "Conteúdo do documento" });
    const firstParagraph = body.querySelector("p");
    if (!firstParagraph) throw new Error("Expected the first paragraph");

    await setTipTapSelection(body, firstParagraph.textContent?.length ?? 0);
    act(() => { editorRef.current?.insertTextAtLastSelection("Transcrição intermediária"); });

    expect([...body.querySelectorAll("p")].map((paragraph) => paragraph.textContent)).toEqual([
      "Parágrafo um",
      "Transcrição intermediária",
      "Parágrafo dois"
    ]);
  });

  it("falls back to the document end without a saved selection and ignores empty text", async () => {
    const editorRef = createRef<StudioEditorHandle>();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ document: { ...rawDocument, revision: 5 } }));
    render(<StudioEditor ref={editorRef} document={document} onDocumentChange={vi.fn()} debounceMs={0} />);
    const body = screen.getByRole("textbox", { name: "Conteúdo do documento" });

    let emptyResult = true;
    act(() => { emptyResult = editorRef.current?.insertTextAtLastSelection(" \n\r\n ") ?? true; });
    expect(emptyResult).toBe(false);
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);

    let inserted = false;
    act(() => { inserted = editorRef.current?.insertTextAtLastSelection("No fim") ?? false; });
    expect(inserted).toBe(true);
    expect(body).toHaveTextContent("No fim");
    await waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body)).body_text)
      .toBe("No fim");
  });

  it.each([
    ["final paragraph", [
      { type: "paragraph", content: [{ type: "text", text: "Último parágrafo" }] }
    ], ["paragraph", "paragraph"]],
    ["horizontal rule", [
      { type: "horizontalRule" }
    ], ["horizontalRule", "paragraph"]],
    ["bullet list", [
      {
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Último item" }] }]
        }]
      }
    ], ["bulletList", "paragraph"]],
    ["blockquote", [
      {
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Última citação" }] }]
      }
    ], ["blockquote", "paragraph"]]
  ])("appends fallback transcript after a top-level %s without structural warnings", async (_label, content, expectedTypes) => {
    const editorRef = createRef<StudioEditorHandle>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      return response({ document: {
        ...rawDocument,
        revision: 5,
        body_json: payload.body_json,
        body_text: payload.body_text
      } });
    });
    const source: StudioDocument = {
      ...document,
      bodyJson: { type: "doc", content },
      bodyText: "Conteúdo existente"
    };
    render(<StudioEditor ref={editorRef} document={source} onDocumentChange={vi.fn()} debounceMs={0} />);

    act(() => { editorRef.current?.insertTextAtLastSelection("Transcrição final"); });

    await waitFor(() => expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));
    const patch = fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH");
    const payload = JSON.parse(String(patch?.[1]?.body));
    expect(payload.body_json.content.map((node: { type: string }) => node.type)).toEqual(expectedTypes);
    expect(payload.body_json.content.at(-1)).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Transcrição final" }]
    });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("replaces an empty document cleanly with transcript blocks in one update", async () => {
    const editorRef = createRef<StudioEditorHandle>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      return response({ document: {
        ...rawDocument,
        revision: 5,
        body_json: payload.body_json,
        body_text: payload.body_text
      } });
    });
    render(<StudioEditor ref={editorRef} document={document} onDocumentChange={vi.fn()} debounceMs={0} />);

    act(() => { editorRef.current?.insertTextAtLastSelection("Primeira\nSegunda"); });

    await waitFor(() => expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));
    const patch = fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH");
    const payload = JSON.parse(String(patch?.[1]?.body));
    expect(payload.body_json.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Primeira" }] },
      { type: "paragraph", content: [{ type: "text", text: "Segunda" }] }
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("uses the top-level fallback for an all-document selection", async () => {
    const editorRef = createRef<StudioEditorHandle>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const source: StudioDocument = {
      ...document,
      bodyJson: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Primeiro" }] },
          { type: "paragraph", content: [{ type: "text", text: "Segundo" }] }
        ]
      },
      bodyText: "Primeiro\nSegundo"
    };
    render(<StudioEditor ref={editorRef} document={source} onDocumentChange={vi.fn()} debounceMs={60_000} />);
    const body = screen.getByRole("textbox", { name: "Conteúdo do documento" });
    body.focus();
    await userEvent.keyboard("{Control>}a{/Control}");

    act(() => { editorRef.current?.insertTextAtLastSelection("Depois de tudo"); });

    expect([...body.querySelectorAll("p")].map((paragraph) => paragraph.textContent)).toEqual([
      "Primeiro",
      "Segundo",
      "Depois de tudo"
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("uses the top-level fallback for a node selection", async () => {
    const editorRef = createRef<StudioEditorHandle>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const source: StudioDocument = {
      ...document,
      bodyJson: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Antes" }] },
          { type: "horizontalRule" }
        ]
      },
      bodyText: "Antes"
    };
    render(<StudioEditor ref={editorRef} document={source} onDocumentChange={vi.fn()} debounceMs={60_000} />);
    const body = screen.getByRole("textbox", { name: "Conteúdo do documento" });
    const horizontalRule = body.querySelector("hr");
    if (!horizontalRule) throw new Error("Expected a horizontal rule");
    await setTipTapNodeSelection(body, horizontalRule);
    expect([...body.children].map((node) => node.tagName)).toEqual(["P", "HR", "P"]);
    expect(body.lastElementChild?.textContent).toBe("");

    act(() => { editorRef.current?.insertTextAtLastSelection("Depois do divisor"); });

    expect([...body.children].map((node) => node.tagName)).toEqual(["P", "HR", "P", "P"]);
    expect(body.lastElementChild).toHaveTextContent("Depois do divisor");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("binds the imperative handle to the current keyed document session", async () => {
    const editorRef = createRef<StudioEditorHandle>();
    const documentA = { ...document, id: "document_a", bodyText: "A" };
    const documentB = { ...document, id: "document_b", title: "Documento B", bodyText: "B" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const payload = JSON.parse(String(init?.body));
      return response({ document: {
        ...rawDocument,
        id: String(input).endsWith("document_b") ? "document_b" : "document_a",
        revision: 5,
        body_json: payload.body_json,
        body_text: payload.body_text
      } });
    });
    const view = render(<StudioEditor ref={editorRef} document={documentA} onDocumentChange={vi.fn()} debounceMs={0} />);
    const oldHandle = editorRef.current;

    view.rerender(<StudioEditor ref={editorRef} document={documentB} onDocumentChange={vi.fn()} debounceMs={0} />);
    await waitFor(() => expect(editorRef.current).not.toBe(oldHandle));
    act(() => { editorRef.current?.insertTextAtLastSelection("Somente B"); });

    await waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const patchUrls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([url]) => String(url));
    expect(patchUrls).toEqual([expect.stringContaining("document_b")]);
    expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent("Somente B");
  });

  it("falls back to the new document end when a saved selection is stale after a restore", async () => {
    const editorRef = createRef<StudioEditorHandle>();
    const longDocument: StudioDocument = {
      ...document,
      bodyJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Conteúdo bastante longo" }] }]
      },
      bodyText: "Conteúdo bastante longo"
    };
    const restoredDocument: StudioDocument = {
      ...longDocument,
      revision: longDocument.revision + 1,
      bodyJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Curto" }] }]
      },
      bodyText: "Curto"
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      return response({ document: {
        ...rawDocument,
        revision: restoredDocument.revision + 1,
        body_json: payload.body_json,
        body_text: payload.body_text
      } });
    });
    const view = render(
      <StudioEditor ref={editorRef} document={longDocument} onDocumentChange={vi.fn()} debounceMs={0} />
    );
    await setTipTapSelection(screen.getByRole("textbox", { name: "Conteúdo do documento" }), 20);

    view.rerender(
      <StudioEditor ref={editorRef} document={restoredDocument} onDocumentChange={vi.fn()} debounceMs={0} />
    );
    const body = screen.getByRole("textbox", { name: "Conteúdo do documento" });
    await waitFor(() => expect(body).toHaveTextContent("Curto"));
    act(() => { editorRef.current?.insertTextAtLastSelection("Depois da restauração"); });

    await waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const payload = JSON.parse(String(fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body));
    expect(payload.body_text).toBe("Curto\nDepois da restauração");
  });

  it("blocks an AI suggestion while the editor has a locally persisted dirty draft", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/assistant/turns")) return sse(studioSuggestionStream());
      return response({}, 404);
    });
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} debounceMs={60_000} />);
    await user.type(await screen.findByLabelText(/o que você quer entender/i), "Organize este plano");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const card = await screen.findByRole("region", { name: "Proposta revisável da IA" });

    await user.type(screen.getByRole("textbox", { name: "Título do documento" }), " em edição");

    expect(within(card).getByText(/aguarde suas alterações serem salvas/i)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Aceitar como nova versão" })).toBeDisabled();
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).includes("/suggestions/"))).toHaveLength(0);
    expect(JSON.parse(window.localStorage.getItem(`baase:studio:draft:${document.id}`)!).draft.title)
      .toBe("Plano anual em edição");
  });

  it("keeps an edit made while an AI suggestion is being accepted", async () => {
    const user = userEvent.setup();
    const onDocumentChange = vi.fn();
    const loadedDocument = deferred<Response>();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/assistant/turns")) return sse(studioSuggestionStream());
      if (url.endsWith("/suggestions/suggestion_1/accept")) {
        return response({ suggestion: rawStudioSuggestion(), version: acceptedStudioVersion() });
      }
      if (url.endsWith(`/documents/${document.id}`) && !init?.method) return loadedDocument.promise;
      return response({}, 404);
    });
    render(<StudioEditor document={document} onDocumentChange={onDocumentChange} debounceMs={60_000} />);
    await user.type(await screen.findByLabelText(/o que você quer entender/i), "Organize este plano");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const card = await screen.findByRole("region", { name: "Proposta revisável da IA" });
    await user.click(within(card).getByRole("button", { name: "Aceitar como nova versão" }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([input, init]) => (
      String(input).endsWith(`/documents/${document.id}`) && !init?.method
    ))).toBe(true));

    const title = screen.getByRole("textbox", { name: "Título do documento" });
    await user.type(title, " preservado");
    loadedDocument.resolve(response({ document: {
      ...rawDocument,
      revision: 5,
      title: "Título proposto",
      body_text: "Texto proposto"
    } }));

    expect(title).toHaveValue("Plano anual preservado");
    expect(await within(card).findByRole("alert")).toHaveTextContent(/sua escrita foi preservada/i);
    expect(onDocumentChange).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(`baase:studio:draft:${document.id}`)!).draft.title)
      .toBe("Plano anual preservado");
  });

  it("applies an accepted AI revision of the same document before the next edit", async () => {
    const user = userEvent.setup();
    const initialDocument = {
      ...document,
      revision: 1,
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }] }
    };
    const acceptedDocument = {
      ...rawDocument,
      revision: 2,
      title: "Título proposto",
      body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto proposto" }] }] },
      body_text: "Texto proposto"
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/assistant/turns")) return sse(studioSuggestionStream());
      if (url.endsWith("/suggestions/suggestion_1/accept")) {
        return response({
          suggestion: rawStudioSuggestion(),
          version: { ...acceptedStudioVersion(), version_number: 2 }
        });
      }
      if (url.endsWith(`/documents/${document.id}`) && !init?.method) {
        return response({ document: acceptedDocument });
      }
      if (url.endsWith(`/documents/${document.id}`) && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body));
        return response({ document: {
          ...acceptedDocument,
          revision: 3,
          title: payload.title,
          body_json: payload.body_json,
          body_text: payload.body_text
        } });
      }
      return response({}, 404);
    });

    function AcceptedRevisionHarness() {
      const [currentDocument, setCurrentDocument] = useState<StudioDocument>(initialDocument);
      return <StudioEditor document={currentDocument} onDocumentChange={setCurrentDocument} debounceMs={0} />;
    }

    render(<AcceptedRevisionHarness />);
    await user.type(await screen.findByLabelText(/o que você quer entender/i), "Organize este plano");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const card = await screen.findByRole("region", { name: "Proposta revisável da IA" });
    await user.click(within(card).getByRole("button", { name: "Aceitar como nova versão" }));

    const title = screen.getByRole("textbox", { name: "Título do documento" });
    await waitFor(() => expect(title).toHaveValue("Título proposto"));
    expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent("Texto proposto");

    await user.type(title, "!");
    await waitFor(() => expect(fetchSpy.mock.calls.some(([input, request]) => (
      String(input).endsWith(`/documents/${document.id}`) && request?.method === "PATCH"
    ))).toBe(true));
    const patchCall = fetchSpy.mock.calls.find(([input, request]) => (
      String(input).endsWith(`/documents/${document.id}`) && request?.method === "PATCH"
    ));
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      expected_revision: 2,
      title: "Título proposto!",
      body_text: "Texto proposto"
    });
  });

  it("renders a newer clean prop revision and saves from its revision", async () => {
    const user = userEvent.setup();
    const initialDocument: StudioDocument = {
      ...document,
      revision: 1,
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }] }
    };
    const newerDocument: StudioDocument = {
      ...initialDocument,
      revision: 2,
      title: "Título sincronizado",
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto sincronizado" }] }] },
      bodyText: "Texto sincronizado"
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith(`/documents/${document.id}`) && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body));
        return response({ document: {
          ...rawDocument,
          revision: 3,
          title: payload.title,
          body_json: payload.body_json,
          body_text: payload.body_text
        } });
      }
      return response({}, 404);
    });
    const { rerender } = render(
      <StudioEditor document={initialDocument} onDocumentChange={vi.fn()} debounceMs={0} />
    );

    rerender(<StudioEditor document={newerDocument} onDocumentChange={vi.fn()} debounceMs={0} />);

    const title = screen.getByRole("textbox", { name: "Título do documento" });
    await waitFor(() => expect(title).toHaveValue("Título sincronizado"));
    expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent("Texto sincronizado");
    await user.type(title, "!");
    const patchCall = await waitFor(() => {
      const found = fetchSpy.mock.calls.find(([, request]) => request?.method === "PATCH");
      expect(found).toBeDefined();
      return found!;
    });
    expect(JSON.parse(String(patchCall[1]?.body))).toMatchObject({
      expected_revision: 2,
      title: "Título sincronizado!",
      body_text: "Texto sincronizado"
    });
  });

  it("preserves a dirty editor and opens conflict when the same document advances", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const initialDocument = {
      ...document,
      revision: 1,
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }] }
    };
    const newerDocument = {
      ...document,
      revision: 2,
      title: "Título vindo do servidor",
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto do servidor" }] }] },
      bodyText: "Texto do servidor"
    };
    const { rerender } = render(
      <StudioEditor document={initialDocument} onDocumentChange={vi.fn()} debounceMs={60_000} />
    );
    const title = screen.getByRole("textbox", { name: "Título do documento" });
    await user.type(title, " em edição");

    rerender(<StudioEditor document={newerDocument} onDocumentChange={vi.fn()} debounceMs={60_000} />);

    expect(title).toHaveValue("Plano anual em edição");
    expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent("Original");
    expect(await screen.findByRole("alert", { name: "Conflito de versões" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(`baase:studio:draft:${document.id}`)!).draft.title)
      .toBe("Plano anual em edição");
    expect(fetchSpy.mock.calls.filter(([, request]) => request?.method === "PATCH")).toHaveLength(0);
  });

  it("describes blocked local storage truthfully without claiming device persistence", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("blocked", "SecurityError"); }
    });

    render(<StudioEditor document={document} onDocumentChange={vi.fn()} />);
    await waitForStructureBadge();

    expect(screen.getByRole("status", { name: "Estado do salvamento" })).toHaveTextContent("Salvo");
    expect(screen.getByRole("alert", { name: "Armazenamento local indisponível" }))
      .toHaveTextContent(/mantenha esta aba aberta/i);
    expect(screen.queryByText(/salvo neste dispositivo/i)).not.toBeInTheDocument();
  });

  it("remounts the writing session by document id and only recovers or PATCHes document B", async () => {
    const draftA = {
      title: "Rascunho A",
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Conteúdo A" }] }] },
      bodyText: "Conteúdo A"
    };
    const draftB = {
      title: "Rascunho B",
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Conteúdo B" }] }] },
      bodyText: "Conteúdo B"
    };
    const documentA = { ...document, id: "document_a", revision: 1, title: "Servidor A" };
    const documentB = { ...document, id: "document_b", revision: 1, title: "Servidor B" };
    storeDraftEnvelopeFor(documentA.id, draftA, 1);
    storeDraftEnvelopeFor(documentB.id, draftB, 1);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (init?.method !== "PATCH") return response({}, 404);
      const payload = JSON.parse(String(init.body));
      const isB = String(input).endsWith(`/documents/${documentB.id}`);
      return response({
        document: {
          ...rawDocument,
          id: isB ? documentB.id : documentA.id,
          revision: 2,
          title: payload.title,
          body_json: payload.body_json,
          body_text: payload.body_text
        }
      });
    });
    const { rerender } = render(<StudioEditor document={documentA} onDocumentChange={vi.fn()} debounceMs={0} />);

    rerender(<StudioEditor document={documentB} onDocumentChange={vi.fn()} debounceMs={0} />);

    expect(screen.getByRole("textbox", { name: "Título do documento" })).toHaveValue("Rascunho B");
    expect(screen.getByRole("textbox", { name: "Conteúdo do documento" })).toHaveTextContent("Conteúdo B");
    await waitFor(() => expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));
    const [url, init] = fetchSpy.mock.calls.find(([, request]) => request?.method === "PATCH")!;
    expect(String(url)).toContain(documentB.id);
    expect(JSON.parse(String(init?.body))).toMatchObject({ body_text: "Conteúdo B", expected_revision: 1 });
    expect(String(url)).not.toContain(documentA.id);
  });

  it("round-trips rich TipTap text through a local envelope without quarantining it", async () => {
    const user = userEvent.setup();
    const richDocument: StudioDocument = {
      ...document,
      bodyJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Primeiro" },
              { type: "hardBreak" },
              { type: "text", text: "linha" }
            ]
          },
          { type: "paragraph", content: [{ type: "text", text: "Segundo" }] },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Marcador A" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Marcador B" }] }] }
            ]
          },
          {
            type: "orderedList",
            attrs: { start: 1, type: null },
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Ordem A" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Ordem B" }] }] }
            ]
          }
        ]
      },
      bodyText: "Primeiro\nlinha\nSegundo\nMarcador A\nMarcador B\nOrdem A\nOrdem B"
    };
    const first = render(<StudioEditor document={richDocument} onDocumentChange={vi.fn()} debounceMs={60_000} />);
    await waitForStructureBadge();

    await user.type(screen.getByRole("textbox", { name: "Título do documento" }), " revisado");
    const stored = JSON.parse(window.localStorage.getItem(`baase:studio:draft:${richDocument.id}`)!);
    expect(stored.draft.bodyText).toBe(richDocument.bodyText);
    first.unmount();

    render(<StudioEditor document={richDocument} onDocumentChange={vi.fn()} debounceMs={60_000} />);
    await waitForStructureBadge();

    expect(screen.getByRole("textbox", { name: "Título do documento" })).toHaveValue("Plano anual revisado");
    expect(screen.queryByRole("alert", { name: "Rascunho local inválido" })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(`baase:studio:draft:${richDocument.id}`)!).draft.bodyText)
      .toBe(richDocument.bodyText);
  });

  it("lets the owner explicitly discard a bounded invalid-draft quarantine", async () => {
    const user = userEvent.setup();
    const invalid = { title: null, bodyJson: { type: "secretWidget" }, bodyText: "sensitive" };
    storeDraftEnvelopeFor(document.id, invalid, document.revision);
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} />);

    const warning = await screen.findByRole("alert", { name: "Rascunho local inválido" });
    expect(warning).toHaveTextContent(/isolado.*24 horas/i);
    const quarantineKey = `baase:studio:draft:${document.id}:quarantine`;
    expect(window.localStorage.getItem(quarantineKey)).not.toBeNull();
    await user.click(within(warning).getByRole("button", { name: "Descartar rascunho inválido" }));

    expect(window.localStorage.getItem(quarantineKey)).toBeNull();
    expect(screen.queryByRole("alert", { name: "Rascunho local inválido" })).not.toBeInTheDocument();
  });

  it("does not claim an invalid draft was isolated when quarantine persistence fails", async () => {
    const invalid = { title: null, bodyJson: { type: "secretWidget" }, bodyText: "sensitive" };
    storeDraftEnvelopeFor(document.id, invalid, document.revision);
    const storage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: storage.clear,
        getItem: storage.getItem,
        key: storage.key,
        get length() { return storage.length; },
        removeItem: storage.removeItem,
        setItem: () => { throw new DOMException("full", "QuotaExceededError"); }
      }
    });

    render(<StudioEditor document={document} onDocumentChange={vi.fn()} />);

    expect(await screen.findByRole("alert", { name: "Rascunho local inválido" }))
      .toHaveTextContent(/não foi possível isolar/i);
    expect(screen.getByRole("alert", { name: "Armazenamento local indisponível" })).toBeInTheDocument();
    expect(window.localStorage.getItem(`baase:studio:draft:${document.id}:quarantine`)).toBeNull();
  });

  it("keeps the recovery warning visible when discarding quarantine fails", async () => {
    const user = userEvent.setup();
    const invalid = { title: null, bodyJson: { type: "secretWidget" }, bodyText: "sensitive" };
    storeDraftEnvelopeFor(document.id, invalid, document.revision);
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} />);
    const warning = await screen.findByRole("alert", { name: "Rascunho local inválido" });
    const storage = window.localStorage;
    const quarantineKey = `baase:studio:draft:${document.id}:quarantine`;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: storage.clear,
        getItem: storage.getItem,
        key: storage.key,
        get length() { return storage.length; },
        setItem: storage.setItem,
        removeItem: (key: string) => {
          if (key === quarantineKey) throw new DOMException("blocked", "SecurityError");
          storage.removeItem(key);
        }
      }
    });

    await user.click(within(warning).getByRole("button", { name: "Descartar rascunho inválido" }));

    expect(screen.getByRole("alert", { name: "Rascunho local inválido" })).toBeInTheDocument();
    expect(screen.getByRole("alert", { name: "Armazenamento local indisponível" })).toBeInTheDocument();
    expect(window.localStorage.getItem(quarantineKey)).not.toBeNull();
  });

  it("does not overwrite newer edits when reloading the server version finishes late", async () => {
    const user = userEvent.setup();
    storeDraftEnvelope({
      title: "Rascunho em conflito",
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rascunho" }] }] },
      bodyText: "Rascunho"
    }, 3);
    const reload = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      if (String(input).endsWith(`/documents/${document.id}`)) return reload.promise;
      return Promise.resolve(response({}, 404));
    });
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Recarregar versão do servidor" }));
    const title = screen.getByRole("textbox", { name: "Título do documento" });
    await user.clear(title);
    await user.type(title, "Edição feita durante a busca");
    await act(async () => reload.resolve(response({
      document: { ...rawDocument, revision: 8, title: "Versão do servidor" }
    })));

    expect(title).toHaveValue("Edição feita durante a busca");
    expect(await screen.findByText(/não foi aplicada.*continuou editando/i)).toBeInTheDocument();
  });

  it("does not switch away from newer edits when creating a conflict copy finishes late", async () => {
    const user = userEvent.setup();
    const onDocumentChange = vi.fn();
    storeDraftEnvelope({
      title: "Rascunho em conflito",
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rascunho" }] }] },
      bodyText: "Rascunho"
    }, 3);
    const create = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (String(input).endsWith("/documents") && init?.method === "POST") return create.promise;
      return Promise.resolve(response({}, 404));
    });
    render(<StudioEditor document={document} onDocumentChange={onDocumentChange} />);

    await user.click(screen.getByRole("button", { name: "Manter minha cópia como novo documento" }));
    const title = screen.getByRole("textbox", { name: "Título do documento" });
    await user.clear(title);
    await user.type(title, "Minha edição mais recente");
    await act(async () => create.resolve(response({
      document: { ...rawDocument, id: "document_copy", revision: 1, title: "Rascunho em conflito (cópia)" }
    }, 201)));

    expect(title).toHaveValue("Minha edição mais recente");
    expect(onDocumentChange).not.toHaveBeenCalledWith(expect.objectContaining({ id: "document_copy" }));
    expect(await screen.findByText(/cópia foi criada.*continuou editando/i)).toBeInTheDocument();
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
      if (url.includes("/documents/") && init?.method === "PATCH") {
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

  it("reuses the same capture key when a committed conflict copy response is lost", async () => {
    const user = userEvent.setup();
    const onDocumentChange = vi.fn();
    let copyAttempts = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/documents/") && init?.method === "PATCH") {
        return response({ error: { code: "STUDIO_DOCUMENT_CHANGED", message: "Mudou no servidor." } }, 409);
      }
      if (url.endsWith("/documents") && init?.method === "POST") {
        copyAttempts += 1;
        if (copyAttempts === 1) throw new TypeError("response lost after commit");
        return response({ document: { ...rawDocument, id: "document_committed_copy", revision: 1 } }, 201);
      }
      return response({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    const { rerender } = render(<StudioEditor document={document} onDocumentChange={onDocumentChange} debounceMs={0} />);

    await user.type(screen.getByRole("textbox", { name: "Título do documento" }), " revisado");
    const keepCopy = await screen.findByRole("button", { name: "Manter minha cópia como novo documento" });
    await user.click(keepCopy);
    expect(await screen.findByText(/continua guardada neste dispositivo/u)).toBeInTheDocument();
    await user.click(keepCopy);

    await waitFor(() => expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({ id: "document_committed_copy" })));
    const createCalls = fetchSpy.mock.calls.filter(([input, init]) => String(input).endsWith("/documents") && init?.method === "POST");
    expect(createCalls).toHaveLength(2);
    expect(new Headers(createCalls[0]?.[1]?.headers).get("idempotency-key")).toBeTruthy();
    expect(new Headers(createCalls[1]?.[1]?.headers).get("idempotency-key"))
      .toBe(new Headers(createCalls[0]?.[1]?.headers).get("idempotency-key"));

    const copiedDocument = onDocumentChange.mock.calls.at(-1)?.[0] as StudioDocument;
    rerender(<StudioEditor document={copiedDocument} onDocumentChange={onDocumentChange} debounceMs={0} />);
    await user.type(screen.getByRole("textbox", { name: "Título do documento" }), " novamente");
    await user.click(await screen.findByRole("button", { name: "Manter minha cópia como novo documento" }));
    await waitFor(() => expect(fetchSpy.mock.calls.filter(([input, init]) => String(input).endsWith("/documents") && init?.method === "POST")).toHaveLength(3));
    const changedConflictCalls = fetchSpy.mock.calls.filter(([input, init]) => String(input).endsWith("/documents") && init?.method === "POST");
    expect(new Headers(changedConflictCalls[2]?.[1]?.headers).get("idempotency-key"))
      .not.toBe(new Headers(changedConflictCalls[1]?.[1]?.headers).get("idempotency-key"));
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
    expect(screen.queryByRole("region", { name: "Histórico de versões" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Ver histórico de versões" })).toHaveFocus());
    const patchCall = fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      expected_revision: 4,
      body_text: "Direção anterior preservada."
    });
  });

  it("turns a restore 409 into the same explicit conflict recovery flow", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/versions")) return response({ versions: [rawVersion] });
      if (url.endsWith(`/documents/${document.id}`) && init?.method === "PATCH") {
        return response({ error: { code: "STUDIO_DOCUMENT_CHANGED", message: "Mudou no servidor." } }, 409);
      }
      if (url.endsWith("/documents") && init?.method === "POST") {
        return response({ document: { ...rawDocument, id: "document_restored_copy", revision: 1 } }, 201);
      }
      return response({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Ver histórico de versões" }));
    await user.click(await screen.findByRole("button", { name: /Versão 2/u }));
    await user.click(screen.getByRole("button", { name: "Restaurar como nova versão" }));

    const conflict = await screen.findByRole("alert", { name: "Conflito de versões" });
    expect(within(conflict).getByRole("button", { name: "Recarregar versão do servidor" })).toBeInTheDocument();
    await user.click(within(conflict).getByRole("button", { name: "Manter minha cópia como novo documento" }));

    const copyCall = await waitFor(() => {
      const call = fetchSpy.mock.calls.find(([, init]) => init?.method === "POST");
      expect(call).toBeDefined();
      return call!;
    });
    expect(JSON.parse(String(copyCall[1]?.body))).toMatchObject({
      title: "Plano anual (cópia)",
      body_json: rawVersion.body_json,
      body_text: rawVersion.body_text
    });
  });

  it("preserves the newest editor draft when a restore returns 409 after another edit", async () => {
    const user = userEvent.setup();
    const restore = deferred<Response>();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/versions")) return Promise.resolve(response({ versions: [rawVersion] }));
      if (url.endsWith(`/documents/${document.id}`) && init?.method === "PATCH") return restore.promise;
      if (url.endsWith("/documents") && init?.method === "POST") {
        return Promise.resolve(response({ document: { ...rawDocument, id: "document_current_copy", revision: 1 } }, 201));
      }
      return Promise.resolve(response({}, 404));
    });
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} debounceMs={10_000} />);

    await user.click(screen.getByRole("button", { name: "Ver histórico de versões" }));
    await user.click(await screen.findByRole("button", { name: /Versão 2/u }));
    await user.click(screen.getByRole("button", { name: "Restaurar como nova versão" }));
    const body = screen.getByRole("textbox", { name: "Conteúdo do documento" });
    act(() => body.focus());
    await user.keyboard("Texto escrito durante a restauração");
    await act(async () => restore.resolve(response({
      error: { code: "STUDIO_DOCUMENT_CHANGED", message: "Mudou no servidor." }
    }, 409)));

    const conflict = await screen.findByRole("alert", { name: "Conflito de versões" });
    await user.click(within(conflict).getByRole("button", { name: "Manter minha cópia como novo documento" }));
    const copyCall = await waitFor(() => {
      const call = fetchSpy.mock.calls.find(([, init]) => init?.method === "POST");
      expect(call).toBeDefined();
      return call!;
    });
    expect(JSON.parse(String(copyCall[1]?.body))).toMatchObject({
      body_text: "Texto escrito durante a restauração"
    });
  });

  it("shows storage unavailability alongside a restore conflict when quota is exhausted", async () => {
    const user = userEvent.setup();
    const restore = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/versions")) return Promise.resolve(response({ versions: [rawVersion] }));
      if (url.endsWith(`/documents/${document.id}`) && init?.method === "PATCH") return restore.promise;
      return Promise.resolve(response({}, 404));
    });
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Ver histórico de versões" }));
    await user.click(await screen.findByRole("button", { name: /Versão 2/u }));
    await user.click(screen.getByRole("button", { name: "Restaurar como nova versão" }));
    installQuotaStorage();
    await act(async () => restore.resolve(response({
      error: { code: "STUDIO_DOCUMENT_CHANGED", message: "Mudou no servidor." }
    }, 409)));

    expect(await screen.findByRole("alert", { name: "Conflito de versões" })).toBeInTheDocument();
    const storageWarning = screen.getByRole("alert", { name: "Armazenamento local indisponível" });
    expect(storageWarning).toHaveTextContent(/esta aba é a única cópia local/i);
    expect(storageWarning).not.toHaveTextContent(/salvo neste dispositivo/i);
  });

  it("never claims device persistence when quota and the network fail together", async () => {
    const user = userEvent.setup();
    installQuotaStorage();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} debounceMs={0} />);

    await user.type(screen.getByRole("textbox", { name: "Título do documento" }), " offline");

    expect(await screen.findByRole("status", { name: "Estado do salvamento" }))
      .toHaveTextContent("Servidor indisponível");
    expect(screen.getByRole("alert", { name: "Armazenamento local indisponível" })).toBeInTheDocument();
    expect(screen.queryByText(/salvo neste dispositivo/i)).not.toBeInTheDocument();
    expect(screen.getByText(/continua apenas nesta aba/i)).toBeInTheDocument();
  });

  it("keeps formatting aria-pressed in sync with TipTap transactions", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ document: { ...rawDocument, revision: 5 } }));
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} debounceMs={10_000} />);

    const bold = screen.getByRole("button", { name: "Negrito" });
    const italic = screen.getByRole("button", { name: "Itálico" });
    const link = screen.getByRole("button", { name: "Formatar hyperlink no texto" });
    expect(bold).toHaveAttribute("aria-pressed", "false");
    expect(italic).toHaveAttribute("aria-pressed", "false");
    expect(link).toHaveAttribute("aria-pressed", "false");

    const body = screen.getByRole("textbox", { name: "Conteúdo do documento" });
    act(() => body.focus());
    await user.keyboard("Texto formatado");
    await user.keyboard("{Control>}a{/Control}");
    await user.click(bold);
    expect(bold).toHaveAttribute("aria-pressed", "true");
    await user.click(bold);
    expect(bold).toHaveAttribute("aria-pressed", "false");
    await user.click(italic);
    expect(italic).toHaveAttribute("aria-pressed", "true");
    await user.click(italic);
    expect(italic).toHaveAttribute("aria-pressed", "false");

    act(() => body.focus());
    await user.keyboard("{Control>}a{/Control}");
    await user.click(link);
    await user.type(screen.getByRole("textbox", { name: "Endereço do link" }), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(link).toHaveAttribute("aria-pressed", "true");
    await user.click(link);
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(link).toHaveAttribute("aria-pressed", "false");
  });

  it("announces the versions drawer, manages focus, and closes with Escape", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ versions: [rawVersion] }));
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Ver histórico de versões" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", "studio-version-history");
    await user.click(trigger);

    const drawer = await screen.findByRole("region", { name: "Histórico de versões" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(drawer).toHaveAttribute("id", "studio-version-history");
    expect(within(drawer).getByRole("heading", { name: "Versões preservadas" })).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Histórico de versões" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("retries a failed versions load without closing the drawer and restores useful focus", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (!String(input).endsWith("/versions")) return response({}, 404);
      attempts += 1;
      if (attempts === 1) return response({ error: { code: "TEMPORARY", message: "Falhou." } }, 503);
      return response({ versions: [rawVersion] });
    });
    render(<StudioEditor document={document} onDocumentChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Ver histórico de versões" }));
    const drawer = await screen.findByRole("region", { name: "Histórico de versões" });
    const retry = await within(drawer).findByRole("button", { name: "Tentar carregar versões novamente" });
    await user.click(retry);

    const version = await within(drawer).findByRole("button", { name: /Versão 2/u });
    expect(attempts).toBe(2);
    expect(drawer).toBeInTheDocument();
    expect(version).toHaveFocus();
  });

  it("provides coarse-pointer touch targets without enlarging the desktop controls", () => {
    expect(studioStyles).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
    expect(studioStyles).toMatch(/@media \(pointer: coarse\)[\s\S]*min-width: 44px/);
    expect(studioStyles).toMatch(/@media \(max-width: 720px\)[\s\S]*\.studio-editor__toolbar button[\s\S]*min-height: 44px/);
    expect(studioStyles).toMatch(/@media \(pointer: coarse\)[\s\S]*\.studio-editor__link-field input[\s\S]*min-height: 44px/);
    expect(studioStyles).toMatch(/@media \(max-width: 720px\)[\s\S]*\.studio-editor__link-field input[\s\S]*min-height: 44px/);
  });
});

async function waitForStructureBadge() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Estruturar este pensamento" })).toHaveTextContent("Dar forma"));
}

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
  document_id: "document_1", version_number: 2,
  body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Direção anterior preservada." }] }] },
  body_text: "Direção anterior preservada.", origin: "user", actor_profile_id: "profile_owner",
  ai_run_id: null, created_at: "2026-07-11T10:00:00.000Z"
} as const;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sse(body: string) {
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function studioSuggestionStream() {
  return `event: suggestion\ndata: ${JSON.stringify(rawStudioSuggestion())}\n\nevent: done\ndata: {"message_id":"message_1"}\n\n`;
}

function rawStudioSuggestion() {
  return {
    id: "suggestion_1",
    document_id: document.id,
    conversation_id: "conversation_1",
    ai_run_id: "run_1",
    kind: "text",
    status: "pending",
    accepted_version_id: null,
    created_at: "2026-07-14T10:00:00.000Z",
    decided_at: null,
    payload_json: {
      facts: [],
      inferences: [],
      gaps: [],
      citations: [],
      proposal: {
        document_id: document.id,
        expected_revision: document.revision,
        title: "Título proposto",
        body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto proposto" }] }] },
        body_text: "Texto proposto"
      }
    }
  };
}

function acceptedStudioVersion() {
  return {
    id: "version_5",
    workspace_id: document.workspaceId,
    owner_profile_id: document.ownerProfileId,
    document_id: document.id,
    version_number: 5,
    body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto proposto" }] }] },
    body_text: "Texto proposto",
    origin: "accepted_ai_suggestion",
    actor_profile_id: document.ownerProfileId,
    ai_run_id: "run_1",
    created_at: "2026-07-14T10:00:00.000Z"
  };
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

async function setTipTapSelection(editor: HTMLElement, offset: number) {
  const textNode = editor.querySelector("p")?.firstChild;
  if (!textNode) throw new Error("Expected a paragraph text node");
  editor.focus();
  const range = globalThis.document.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent(globalThis.document, new Event("selectionchange"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function setTipTapNodeSelection(editor: HTMLElement, node: HTMLElement) {
  await act(async () => {
    editor.focus();
    const range = globalThis.document.createRange();
    range.selectNodeContents(node);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(globalThis.document, new Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function storeDraftEnvelope(draft: { title: string | null; bodyJson: Record<string, unknown>; bodyText: string }, baseRevision: number) {
  storeDraftEnvelopeFor(document.id, draft, baseRevision);
}

function storeDraftEnvelopeFor(
  documentId: string,
  draft: { title: string | null; bodyJson: Record<string, unknown>; bodyText: string },
  baseRevision: number
) {
  window.localStorage.setItem(`baase:studio:draft:${documentId}`, JSON.stringify({
    version: 1,
    baseRevision,
    generation: 1,
    signature: JSON.stringify(draft),
    draft
  }));
}

function installQuotaStorage() {
  const storage = window.localStorage;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: storage.clear,
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem: () => { throw new DOMException("full", "QuotaExceededError"); }
    }
  });
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
