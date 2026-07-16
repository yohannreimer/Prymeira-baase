import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import RelatedThoughts from "./RelatedThoughts";

describe("RelatedThoughts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("explains, opens and persists an owner-approved relation", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const requests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/related")) return json({ index: readyIndex(), related: [{
        document: rawDocument(), excerpt: "Tema de expansão", score: 0.82,
        explanation: "Explora uma ideia próxima, mesmo usando palavras diferentes."
      }] });
      return json({ id: "relation_1" });
    });
    render(<RelatedThoughts documentId="source" onOpenDocument={open} />);
    expect(requests).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Encontrar conexões" }));
    expect(await screen.findByText(/explora uma ideia próxima/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Documento relacionado/ }));
    expect(open).toHaveBeenCalledWith("related");
    await user.click(screen.getByRole("button", { name: "Manter conexão com Documento relacionado" }));
    expect(await screen.findByRole("button", { name: "Conexão aceita com Documento relacionado" })).toBeDisabled();
    expect(requests.at(-1)).toContain("/documents/source/relations");
  });

  it("shows an accessible loading error and retries the discovery", async () => {
    const user = userEvent.setup();
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return json({ index: readyIndex(), related: [] });
    });
    render(<RelatedThoughts documentId="source" />);
    await user.click(screen.getByRole("button", { name: "Encontrar conexões" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/não puderam ser carregadas/i);
    await user.click(within(alert).getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Nenhuma conexão encontrada")).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("locks duplicate acceptance per thought while allowing different thoughts concurrently", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let firstAttempts = 0;
    const relationRequests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/related")) return json({ index: readyIndex(), related: [related("related_1", "Primeiro"), related("related_2", "Segundo")] });
      if (init?.method === "POST") {
        relationRequests.push(String(init.body));
        const target = JSON.parse(String(init.body)).target_document_id;
        if (target === "related_1") {
          firstAttempts += 1;
          return firstAttempts === 1 ? first.promise : json({ id: "relation_retry" });
        }
        return second.promise;
      }
      return json({});
    });
    render(<RelatedThoughts documentId="source" />);
    fireEvent.click(screen.getByRole("button", { name: "Encontrar conexões" }));
    const firstButton = await screen.findByRole("button", { name: "Manter conexão com Primeiro" });
    const secondButton = screen.getByRole("button", { name: "Manter conexão com Segundo" });
    fireEvent.click(firstButton);
    fireEvent.click(firstButton);
    fireEvent.click(secondButton);
    await waitFor(() => expect(relationRequests).toHaveLength(2));

    first.reject(new Error("offline"));
    second.resolve(json({ id: "relation_2" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/primeiro/i);
    expect(await screen.findByRole("button", { name: "Conexão aceita com Segundo" })).toBeDisabled();
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Conexão aceita com Primeiro" })).toBeDisabled());
    expect(relationRequests).toHaveLength(3);
  });

  it.each([
    ["pending", "Preparando conexões deste pensamento…"],
    ["processing", "Conectando este pensamento à sua memória…"],
    ["failed", "As conexões não puderam ser preparadas."],
    ["stale", "Este pensamento mudou desde a última conexão."],
    ["unavailable", "As conexões estão indisponíveis neste momento."]
  ] as const)("shows the honest %s index state rather than a false empty result", async (status, message) => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      index: {
        status,
        code: status === "pending" || status === "processing" ? null : `STUDIO_${status.toUpperCase()}`,
        indexedVersionId: null
      },
      related: []
    }));
    render(<RelatedThoughts documentId="source" />);
    await user.click(screen.getByRole("button", { name: "Encontrar conexões" }));
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.queryByText("Nenhuma conexão encontrada")).not.toBeInTheDocument();
  });

  it("announces a genuinely ready empty memory separately", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ index: readyIndex(), related: [] }));
    render(<RelatedThoughts documentId="source" />);
    await user.click(screen.getByRole("button", { name: "Encontrar conexões" }));
    expect(await screen.findByText("Nenhuma conexão encontrada")).toHaveAttribute("role", "status");
  });

  it("aborts the in-flight connection request when it leaves the document", async () => {
    let requestSignal: AbortSignal | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    const view = render(<RelatedThoughts documentId="source" />);
    fireEvent.click(screen.getByRole("button", { name: "Encontrar conexões" }));
    await waitFor(() => expect(requestSignal).not.toBeNull());
    view.unmount();
    expect(requestSignal!.aborted).toBe(true);
  });

  it("polls a stale connection index until the current revision is ready", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(json({
          index: { status: "stale", code: "STUDIO_MEMORY_INDEX_STALE", indexedVersionId: "version_old" },
          related: []
        }))
        .mockResolvedValueOnce(json({ index: readyIndex(), related: [] }));
      render(<RelatedThoughts documentId="source" />);
      fireEvent.click(screen.getByRole("button", { name: "Encontrar conexões" }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByText("Este pensamento mudou desde a última conexão.")).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(screen.getByText("Nenhuma conexão encontrada")).toBeVisible();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["collapse", "unmount"] as const)("cancels stale polling on %s without a late request", async (exit) => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
        index: { status: "stale", code: "STUDIO_MEMORY_INDEX_STALE", indexedVersionId: "version_old" },
        related: []
      }));
      const view = render(<RelatedThoughts documentId="source" />);
      fireEvent.click(screen.getByRole("button", { name: "Encontrar conexões" }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByText("Este pensamento mudou desde a última conexão.")).toBeVisible();

      if (exit === "collapse") fireEvent.click(screen.getByRole("button", { name: "Recolher" }));
      else view.unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["resolve", "reject"] as const)(
    "keeps document B acceptance isolated when document A completes with %s",
    async (settlement) => {
      const user = userEvent.setup();
      const acceptanceA = deferred<Response>();
      const acceptanceB = deferred<Response>();
      const relationRequests: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("/related")) return json({ index: readyIndex(), related: [related("shared_target", "Mesmo destino")] });
        if (init?.method === "POST") {
          relationRequests.push(url);
          return url.includes("/documents/document_a/") ? acceptanceA.promise : acceptanceB.promise;
        }
        return json({});
      });
      const view = render(<RelatedThoughts documentId="document_a" />);
      await user.click(screen.getByRole("button", { name: "Encontrar conexões" }));
      await user.click(await screen.findByRole("button", { name: "Manter conexão com Mesmo destino" }));
      expect(screen.getByRole("button", { name: "Conectando com Mesmo destino" })).toBeDisabled();

      view.rerender(<RelatedThoughts documentId="document_b" />);
      const acceptB = await screen.findByRole("button", { name: "Manter conexão com Mesmo destino" });
      await user.click(acceptB);
      expect(screen.getByRole("button", { name: "Conectando com Mesmo destino" })).toBeDisabled();

      if (settlement === "resolve") acceptanceA.resolve(json({ id: "relation_a" }));
      else acceptanceA.reject(new Error("offline A"));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });

      expect(screen.getByRole("button", { name: "Conectando com Mesmo destino" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Conexão aceita com Mesmo destino" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Conectando com Mesmo destino" }));
      expect(relationRequests).toHaveLength(2);

      acceptanceB.resolve(json({ id: "relation_b" }));
      expect(await screen.findByRole("button", { name: "Conexão aceita com Mesmo destino" })).toBeDisabled();
      expect(relationRequests).toEqual([
        expect.stringContaining("/documents/document_a/relations"),
        expect.stringContaining("/documents/document_b/relations")
      ]);
    }
  );

  it("removes loaded connection results and actions from interaction while collapsed", async () => {
    const user = userEvent.setup();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({
      index: readyIndex(), related: [related("related_1", "Conexão guardada")]
    }));
    render(<RelatedThoughts documentId="source" />);
    const toggle = screen.getByRole("button", { name: "Encontrar conexões" });
    await user.click(toggle);
    expect(await screen.findByRole("button", { name: "Manter conexão com Conexão guardada" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Recolher" }));
    expect(screen.queryByRole("button", { name: "Manter conexão com Conexão guardada" })).not.toBeInTheDocument();
    expect(screen.queryByText("Trecho Conexão guardada")).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls");

    await user.click(toggle);
    expect(await screen.findByRole("button", { name: "Manter conexão com Conexão guardada" })).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

function rawDocument() { return {
  id: "related", workspace_id: "workspace", owner_profile_id: "owner", capture_key: null,
  title: "Documento relacionado", body_json: {}, body_text: "Tema de expansão", revision: 1,
  capture_mode: "text", inbox_state: "reviewed", is_focused: false, status: "active",
  created_at: "2026-07-14T10:00:00.000Z", updated_at: "2026-07-14T10:00:00.000Z", archived_at: null
}; }
function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function related(id: string, title: string) {
  return { document: { ...rawDocument(), id, title }, excerpt: `Trecho ${title}`, score: 0.8, explanation: `Explicação ${title}` };
}
function readyIndex() { return { status: "ready", code: null, indexedVersionId: "version_ready" }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
