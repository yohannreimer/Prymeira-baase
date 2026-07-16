import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import StudioLibrary from "./StudioLibrary";
import type { StudioCollection, StudioDocument, StudioDocumentPage, StudioDocumentStatus } from "./studio.types";

const documents = [document("document_1", "Plano de expansão"), document("document_2", "Decisão de margem")];
const collections: StudioCollection[] = [
  collection("collection_1", "Estratégia"),
  collection("collection_2", "Conselho")
];

describe("StudioLibrary", () => {
  it("loads cursor pages without duplicating a document and offers calm empty states", async () => {
    const user = userEvent.setup();
    const loadDocuments = vi.fn(async ({ cursor }: { cursor?: string }): Promise<StudioDocumentPage> => cursor
      ? { items: [documents[1]!, documents[0]!], nextCursor: null, collectionsByDocumentId: {} }
      : { items: [documents[0]!], nextCursor: "cursor_2", collectionsByDocumentId: {} });
    const { rerender } = render(
      <StudioLibrary query={{ status: "active" }} loadDocuments={loadDocuments} loadCollections={async () => []} onOpenDocument={vi.fn()} />
    );

    expect(await screen.findByRole("button", { name: /Plano de expansão/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("button", { name: /Decisão de margem/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Plano de expansão/ })).toHaveLength(1);
    expect(loadDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cursor_2" }), expect.any(AbortSignal));

    rerender(
      <StudioLibrary query={{ status: "archived" }} loadDocuments={async () => ({ items: [], nextCursor: null, collectionsByDocumentId: {} })} loadCollections={async () => []} onOpenDocument={vi.fn()} />
    );
    expect(await screen.findByText("Seu arquivo está livre por enquanto.")).toBeInTheDocument();
  });

  it("isolates pagination state by query while an obsolete page is still pending", async () => {
    const user = userEvent.setup();
    const oldPage = deferred<StudioDocumentPage>();
    const loadDocuments = vi.fn(async (query: { status: StudioDocumentStatus; limit: number; cursor?: string }) => {
      if (query.status === "active" && query.cursor) return oldPage.promise;
      if (query.status === "active") return { items: [documents[0]!], nextCursor: "active_2", collectionsByDocumentId: {} };
      if (query.cursor) return { items: [{ ...documents[1]!, status: "archived" as const }], nextCursor: null, collectionsByDocumentId: {} };
      return { items: [{ ...documents[0]!, status: "archived" as const }], nextCursor: "archived_2", collectionsByDocumentId: {} };
    });
    const { rerender } = render(
      <StudioLibrary query={{ status: "active" }} loadDocuments={loadDocuments} loadCollections={async () => []} onOpenDocument={vi.fn()} />
    );
    await user.click(await screen.findByRole("button", { name: "Carregar mais" }));

    rerender(
      <StudioLibrary query={{ status: "archived" }} loadDocuments={loadDocuments} loadCollections={async () => []} onOpenDocument={vi.fn()} />
    );
    expect(await screen.findByRole("listitem", { name: "Plano de expansão" })).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Carregar mais" });
    expect(next).toBeEnabled();

    oldPage.resolve({ items: [documents[1]!], nextCursor: null, collectionsByDocumentId: {} });
    await user.click(next);
    await waitFor(() => expect(loadDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived", cursor: "archived_2" }), expect.any(AbortSignal)
    ));
    expect(screen.queryByRole("listitem", { name: "Decisão de margem" })).toBeInTheDocument();
  });

  it("reviews inbox documents and keeps collection membership unique under repeated clicks", async () => {
    const user = userEvent.setup();
    const updateDocument = vi.fn(async (_id: string, input: { expected_revision: number }) => ({
      ...documents[0]!, revision: input.expected_revision + 1, inboxState: "reviewed" as const
    }));
    let canonical = [collections[0]!];
    const addMembership = vi.fn(async (collectionId: string, _documentId: string, _signal?: AbortSignal) => {
      canonical = collections.filter((item) => item.id === collectionId || canonical.some((current) => current.id === item.id));
      return canonical;
    });
    const removeMembership = vi.fn(async (collectionId: string, _documentId: string, _signal?: AbortSignal) => {
      canonical = canonical.filter((item) => item.id !== collectionId);
      return canonical;
    });
    render(
      <StudioLibrary
        query={{ status: "active", inbox_state: "pending_review" }}
        loadDocuments={async (query) => {
          expect(query).toMatchObject({ inbox_state: "pending_review" });
          return { items: documents, nextCursor: null, collectionsByDocumentId: { document_1: [collections[0]!] } };
        }}
        loadCollections={async () => collections}
        updateDocument={updateDocument}
        addMembership={addMembership}
        removeMembership={removeMembership}
        onOpenDocument={vi.fn()}
      />
    );

    const first = await screen.findByRole("listitem", { name: "Plano de expansão" });
    await user.click(within(first).getByRole("button", { name: "Organizar em coleções" }));
    const strategy = within(first).getByRole("checkbox", { name: "Estratégia" });
    expect(strategy).toBeChecked();
    await user.click(strategy);
    await waitFor(() => expect(removeMembership).toHaveBeenCalledTimes(1));
    const currentStrategy = within(first).getByRole("checkbox", { name: "Estratégia" });
    await user.click(currentStrategy);
    await waitFor(() => expect(addMembership).toHaveBeenCalledTimes(1));
    await user.click(within(first).getByRole("checkbox", { name: "Conselho" }));
    await waitFor(() => expect(addMembership).toHaveBeenCalledTimes(2));
    expect(addMembership.mock.calls.map(([collectionId]) => collectionId)).toEqual(["collection_1", "collection_2"]);

    await user.click(within(first).getByRole("button", { name: "Marcar como revisado" }));
    await waitFor(() => expect(updateDocument).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("listitem", { name: "Plano de expansão" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Decisão de margem/ })).toHaveFocus());
  });

  it("serializes rapid collection changes and persists the latest desired state", async () => {
    const user = userEvent.setup();
    const firstRemoval = deferred<StudioCollection[]>();
    const removeMembership = vi.fn(() => firstRemoval.promise);
    const addMembership = vi.fn(async () => [collections[0]!]);
    render(
      <StudioLibrary
        query={{ status: "active" }}
        loadDocuments={async () => ({
          items: [documents[0]!],
          nextCursor: null,
          collectionsByDocumentId: { document_1: [collections[0]!] }
        })}
        loadCollections={async () => collections}
        addMembership={addMembership}
        removeMembership={removeMembership}
        onOpenDocument={vi.fn()}
      />
    );

    const row = await screen.findByRole("listitem", { name: "Plano de expansão" });
    await user.click(within(row).getByRole("button", { name: "Organizar em coleções" }));
    const checkbox = within(row).getByRole("checkbox", { name: "Estratégia" });
    await user.click(checkbox);
    await user.click(checkbox);

    expect(removeMembership).toHaveBeenCalledTimes(1);
    expect(addMembership).not.toHaveBeenCalled();
    expect(checkbox).toBeChecked();

    firstRemoval.resolve([]);
    await waitFor(() => expect(addMembership).toHaveBeenCalledTimes(1));
    expect(removeMembership.mock.invocationCallOrder[0]).toBeLessThan(addMembership.mock.invocationCallOrder[0]!);
    expect(checkbox).toBeChecked();
  });

  it("rehydrates canonical collection membership after mutation and rerender", async () => {
    const user = userEvent.setup();
    let persisted: StudioCollection[] = [];
    const loadDocuments = vi.fn(async (): Promise<StudioDocumentPage> => ({
      items: [documents[0]!], nextCursor: null, collectionsByDocumentId: { document_1: persisted }
    }));
    const addMembership = vi.fn(async () => {
      persisted = [collections[0]!];
      return persisted;
    });
    const props = {
      query: { status: "active" as const }, loadDocuments, loadCollections: async () => collections,
      addMembership, removeMembership: async () => [], onOpenDocument: vi.fn()
    };
    const { rerender, unmount } = render(<StudioLibrary {...props} />);
    let row = await screen.findByRole("listitem", { name: "Plano de expansão" });
    await user.click(within(row).getByRole("button", { name: "Organizar em coleções" }));
    await user.click(within(row).getByRole("checkbox", { name: "Estratégia" }));
    await waitFor(() => expect(addMembership).toHaveBeenCalledTimes(1));

    rerender(<StudioLibrary {...props} />);
    row = await screen.findByRole("listitem", { name: "Plano de expansão" });
    expect(within(row).getByRole("checkbox", { name: "Estratégia" })).toBeChecked();

    unmount();
    render(<StudioLibrary {...props} />);
    row = await screen.findByRole("listitem", { name: "Plano de expansão" });
    await user.click(within(row).getByRole("button", { name: "Organizar em coleções" }));
    expect(within(row).getByRole("checkbox", { name: "Estratégia" })).toBeChecked();
  });

  it("rolls back failed membership and ignores a completed mutation after the document query changes", async () => {
    const user = userEvent.setup();
    const pending = deferred<StudioCollection[]>();
    const addMembership = vi.fn(() => pending.promise);
    const loadDocuments = vi.fn(async ({ status }: { status: StudioDocumentStatus }): Promise<StudioDocumentPage> => ({
      items: status === "active" ? [documents[0]!] : [{ ...documents[1]!, status: "archived" }],
      nextCursor: null,
      collectionsByDocumentId: status === "active" ? { document_1: [] } : { document_2: [] }
    }));
    const props = {
      loadDocuments, loadCollections: async () => collections, addMembership,
      removeMembership: async () => [], onOpenDocument: vi.fn()
    };
    const { rerender } = render(<StudioLibrary {...props} query={{ status: "active" }} />);
    const row = await screen.findByRole("listitem", { name: "Plano de expansão" });
    await user.click(within(row).getByRole("button", { name: "Organizar em coleções" }));
    await user.click(within(row).getByRole("checkbox", { name: "Estratégia" }));

    rerender(<StudioLibrary {...props} query={{ status: "archived" }} />);
    expect(await screen.findByRole("listitem", { name: "Decisão de margem" })).toBeInTheDocument();
    pending.resolve([collections[0]!]);
    await act(async () => pending.promise);
    expect(screen.queryByRole("listitem", { name: "Plano de expansão" })).not.toBeInTheDocument();

    const failedAdd = vi.fn(async () => { throw new Error("offline"); });
    rerender(<StudioLibrary {...props} query={{ status: "active" }} addMembership={failedAdd} />);
    const activeRow = await screen.findByRole("listitem", { name: "Plano de expansão" });
    await user.click(within(activeRow).getByRole("button", { name: "Organizar em coleções" }));
    const strategy = within(activeRow).getByRole("checkbox", { name: "Estratégia" });
    await user.click(strategy);
    await waitFor(() => expect(failedAdd).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(strategy).not.toBeChecked());
    expect(screen.getByRole("status")).toHaveTextContent("seleção anterior foi restaurada");
  });

  it("archives optimistically, restores archived documents, rolls back failures, and announces status", async () => {
    const user = userEvent.setup();
    let rejectArchive!: (error: Error) => void;
    const archiveDocument = vi.fn(() => new Promise<StudioDocument>((_resolve, reject) => { rejectArchive = reject; }));
    const { rerender } = render(
      <StudioLibrary
        query={{ status: "active" }}
        loadDocuments={async () => ({ items: documents, nextCursor: null, collectionsByDocumentId: {} })}
        loadCollections={async () => []}
        archiveDocument={archiveDocument}
        onOpenDocument={vi.fn()}
      />
    );
    const first = await screen.findByRole("listitem", { name: "Plano de expansão" });
    await user.click(within(first).getByRole("button", { name: "Arquivar" }));
    const confirm = within(first).getByRole("button", { name: "Confirmar arquivo" });
    expect(confirm).toHaveFocus();
    await user.click(confirm);
    expect(screen.queryByRole("listitem", { name: "Plano de expansão" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Decisão de margem/ })).toHaveFocus());
    rejectArchive(new Error("offline"));
    expect(await screen.findByRole("status")).toHaveTextContent("Não foi possível arquivar");
    const restoredRow = await screen.findByRole("listitem", { name: "Plano de expansão" });
    await waitFor(() => expect(within(restoredRow).getByRole("button", { name: /Plano de expansão/ })).toHaveFocus());

    const restoreDocument = vi.fn(async () => ({ ...documents[0]!, status: "active" as const, archivedAt: null }));
    rerender(
      <StudioLibrary
        query={{ status: "archived" }}
        loadDocuments={async () => ({ items: [{ ...documents[0]!, status: "archived", archivedAt: "2026-07-13" }], nextCursor: null, collectionsByDocumentId: {} })}
        loadCollections={async () => []}
        restoreDocument={restoreDocument}
        onOpenDocument={vi.fn()}
      />
    );
    await user.click(await screen.findByRole("button", { name: "Restaurar" }));
    await waitFor(() => expect(restoreDocument).toHaveBeenCalledWith("document_1", expect.any(AbortSignal)));
    expect(screen.getByRole("status")).toHaveTextContent("restaurado");
  });

  it("restores a failed archived item at its exact index and focus target", async () => {
    const user = userEvent.setup();
    const archived = [documents[0]!, documents[1]!, document("document_3", "Plano de caixa")]
      .map((item) => ({ ...item, status: "archived" as const, archivedAt: "2026-07-13" }));
    const failure = deferred<StudioDocument>();
    render(
      <StudioLibrary
        query={{ status: "archived" }}
        loadDocuments={async () => ({ items: archived, nextCursor: null, collectionsByDocumentId: {} })}
        loadCollections={async () => []}
        restoreDocument={() => failure.promise}
        onOpenDocument={vi.fn()}
      />
    );
    const middle = await screen.findByRole("listitem", { name: "Decisão de margem" });
    await user.click(within(middle).getByRole("button", { name: "Restaurar" }));
    failure.reject(new Error("offline"));

    await screen.findByText(/Não foi possível restaurar/u);
    const titles = screen.getAllByRole("listitem").map((row) => within(row).getByRole("button", { name: /corpo privado/u }).textContent);
    expect(titles).toEqual([
      expect.stringContaining("Plano de expansão"),
      expect.stringContaining("Decisão de margem"),
      expect.stringContaining("Plano de caixa")
    ]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Decisão de margem/u })).toHaveFocus());
  });

  it("uses roving focus for document navigation", async () => {
    const user = userEvent.setup();
    render(
      <StudioLibrary query={{ status: "active" }} loadDocuments={async () => ({ items: documents, nextCursor: null, collectionsByDocumentId: {} })} loadCollections={async () => []} onOpenDocument={vi.fn()} />
    );
    const first = await screen.findByRole("button", { name: /Plano de expansão/ });
    const second = screen.getByRole("button", { name: /Decisão de margem/ });
    act(() => first.focus());
    await user.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(first).toHaveFocus();
  });
});

function document(id: string, title: string): StudioDocument {
  return {
    id, workspaceId: "workspace_a", ownerProfileId: "owner_a", captureKey: null, title,
    bodyJson: { type: "doc" }, bodyText: `${title} corpo privado`, revision: 1, captureMode: "text",
    inboxState: "pending_review", isFocused: false, status: "active",
    createdAt: "2026-07-12T10:00:00.000Z", updatedAt: "2026-07-13T10:00:00.000Z", archivedAt: null
  };
}

function collection(id: string, name: string): StudioCollection {
  return { id, name, workspaceId: "workspace_a", ownerProfileId: "owner_a", createdAt: "2026-07-12", updatedAt: "2026-07-12" };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
