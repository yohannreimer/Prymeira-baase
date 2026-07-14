import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import StudioLibrary from "./StudioLibrary";
import type { StudioCollection, StudioDocument, StudioDocumentPage } from "./studio.types";

const documents = [document("document_1", "Plano de expansão"), document("document_2", "Decisão de margem")];
const collections: StudioCollection[] = [
  collection("collection_1", "Estratégia"),
  collection("collection_2", "Conselho")
];

describe("StudioLibrary", () => {
  it("loads cursor pages without duplicating a document and offers calm empty states", async () => {
    const user = userEvent.setup();
    const loadDocuments = vi.fn(async ({ cursor }: { cursor?: string }): Promise<StudioDocumentPage> => cursor
      ? { items: [documents[1]!, documents[0]!], nextCursor: null }
      : { items: [documents[0]!], nextCursor: "cursor_2" });
    const { rerender } = render(
      <StudioLibrary query={{ status: "active" }} loadDocuments={loadDocuments} loadCollections={async () => []} onOpenDocument={vi.fn()} />
    );

    expect(await screen.findByRole("button", { name: /Plano de expansão/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("button", { name: /Decisão de margem/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Plano de expansão/ })).toHaveLength(1);
    expect(loadDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cursor_2" }), expect.any(AbortSignal));

    rerender(
      <StudioLibrary query={{ status: "archived" }} loadDocuments={async () => ({ items: [], nextCursor: null })} loadCollections={async () => []} onOpenDocument={vi.fn()} />
    );
    expect(await screen.findByText("Seu arquivo está livre por enquanto.")).toBeInTheDocument();
  });

  it("reviews inbox documents and keeps collection membership unique under repeated clicks", async () => {
    const user = userEvent.setup();
    const updateDocument = vi.fn(async (_id: string, input: { expected_revision: number }) => ({
      ...documents[0]!, revision: input.expected_revision + 1, inboxState: "reviewed" as const
    }));
    const addMembership = vi.fn(async (_collectionId: string, _documentId: string, _signal?: AbortSignal) => undefined);
    const removeMembership = vi.fn(async (_collectionId: string, _documentId: string, _signal?: AbortSignal) => undefined);
    render(
      <StudioLibrary
        query={{ status: "active", inboxOnly: true }}
        loadDocuments={async () => ({ items: documents, nextCursor: null })}
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
    await user.dblClick(strategy);
    await waitFor(() => expect(addMembership).toHaveBeenCalledTimes(1));
    await user.click(within(first).getByRole("checkbox", { name: "Conselho" }));
    await waitFor(() => expect(addMembership).toHaveBeenCalledTimes(2));
    expect(addMembership.mock.calls.map(([collectionId]) => collectionId)).toEqual(["collection_1", "collection_2"]);
    expect(removeMembership).not.toHaveBeenCalled();

    await user.click(within(first).getByRole("button", { name: "Marcar como revisado" }));
    await waitFor(() => expect(updateDocument).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("listitem", { name: "Plano de expansão" })).not.toBeInTheDocument();
  });

  it("archives optimistically, restores archived documents, rolls back failures, and announces status", async () => {
    const user = userEvent.setup();
    let rejectArchive!: (error: Error) => void;
    const archiveDocument = vi.fn(() => new Promise<StudioDocument>((_resolve, reject) => { rejectArchive = reject; }));
    const { rerender } = render(
      <StudioLibrary
        query={{ status: "active" }}
        loadDocuments={async () => ({ items: documents, nextCursor: null })}
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
        loadDocuments={async () => ({ items: [{ ...documents[0]!, status: "archived", archivedAt: "2026-07-13" }], nextCursor: null })}
        loadCollections={async () => []}
        restoreDocument={restoreDocument}
        onOpenDocument={vi.fn()}
      />
    );
    await user.click(await screen.findByRole("button", { name: "Restaurar" }));
    await waitFor(() => expect(restoreDocument).toHaveBeenCalledWith("document_1", expect.any(AbortSignal)));
    expect(screen.getByRole("status")).toHaveTextContent("restaurado");
  });

  it("uses roving focus for document navigation", async () => {
    const user = userEvent.setup();
    render(
      <StudioLibrary query={{ status: "active" }} loadDocuments={async () => ({ items: documents, nextCursor: null })} loadCollections={async () => []} onOpenDocument={vi.fn()} />
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
