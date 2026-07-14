import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudioCollections from "./StudioCollections";

const rawCollections = [
  rawCollection("collection_1", "Estratégia"),
  rawCollection("collection_2", "Conselho")
];

describe("StudioCollections", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/api/studio/documents?")) {
        return jsonResponse({ documents: [], next_cursor: null, collections_by_document_id: {} });
      }
      if (url === "/api/studio/collections" && method === "GET") return jsonResponse({ collections: rawCollections });
      if (url === "/api/studio/collections" && method === "POST") {
        return jsonResponse({ collection: rawCollection("collection_3", JSON.parse(String(init?.body)).name) }, 201);
      }
      if (url === "/api/studio/collections/collection_3" && method === "PATCH") {
        return jsonResponse({ collection: rawCollection("collection_3", JSON.parse(String(init?.body)).name) });
      }
      if (url === "/api/studio/collections/collection_3" && method === "DELETE") {
        return jsonResponse({ collection: rawCollection("collection_3", "Direção") });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("selects and filters collections, then creates, renames, and deletes without deleting documents", async () => {
    const user = userEvent.setup();
    render(<StudioCollections onOpenDocument={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Estratégia" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(requestedUrls()).toContain(
      "/api/studio/documents?status=active&limit=30&collection_id=collection_1"
    ));

    await user.click(screen.getByRole("button", { name: "Conselho" }));
    await waitFor(() => expect(requestedUrls()).toContain(
      "/api/studio/documents?status=active&limit=30&collection_id=collection_2"
    ));

    await user.type(screen.getByLabelText("Nova coleção"), "Direção");
    await user.click(screen.getByRole("button", { name: "Criar" }));
    expect(await screen.findByRole("button", { name: "Direção" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(requestedUrls()).toContain(
      "/api/studio/documents?status=active&limit=30&collection_id=collection_3"
    ));

    await user.click(screen.getByRole("button", { name: "Renomear Direção" }));
    const name = screen.getByRole("textbox", { name: "Nome de Direção" });
    await user.clear(name);
    await user.type(name, "Horizonte");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("button", { name: "Horizonte" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Excluir Horizonte" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Horizonte" })).not.toBeInTheDocument());
    expect(screen.getByText("Coleção excluída. Os documentos continuam preservados.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Estratégia" })).toHaveAttribute("aria-pressed", "true");
  });
});

function requestedUrls() {
  return vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
}

function rawCollection(id: string, name: string) {
  return {
    id,
    workspace_id: "workspace_a",
    owner_profile_id: "profile_owner",
    name,
    created_at: "2026-07-13T12:00:00.000Z",
    updated_at: "2026-07-13T12:00:00.000Z"
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
