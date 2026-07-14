import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RelatedThoughts from "./RelatedThoughts";

describe("RelatedThoughts", () => {
  it("explains, opens and persists an owner-approved relation", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const requests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/related")) return json({ related: [{
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
      return json({ related: [] });
    });
    render(<RelatedThoughts documentId="source" />);
    await user.click(screen.getByRole("button", { name: "Encontrar conexões" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/não puderam ser carregadas/i);
    await user.click(within(alert).getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText(/conexões aparecem conforme/i)).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("locks duplicate acceptance per thought while allowing different thoughts concurrently", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let firstAttempts = 0;
    const relationRequests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/related")) return json({ related: [related("related_1", "Primeiro"), related("related_2", "Segundo")] });
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
