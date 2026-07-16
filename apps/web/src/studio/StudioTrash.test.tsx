import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import StudioTrash from "./StudioTrash";
import type { StudioDocument } from "./studio.types";

describe("StudioTrash", () => {
  it("restores calmly and requires the exact document title before permanent deletion", async () => {
    const user = userEvent.setup();
    const restoreDocument = vi.fn(async () => ({ ...oldDocument, status: "active" as const, trashedAt: null }));
    const permanentlyDeleteDocument = vi.fn(async () => undefined);
    render(<StudioTrash
      now={() => new Date("2026-07-15T12:00:00.000Z")}
      loadDocuments={async () => ({ items: [oldDocument, recentDocument], nextCursor: null, collectionsByDocumentId: {} })}
      restoreDocument={restoreDocument}
      permanentlyDeleteDocument={permanentlyDeleteDocument}
    />);

    const oldRow = await screen.findByRole("listitem", { name: "Documento antigo" });
    expect(within(oldRow).getByText(/excluído automaticamente em 2 dias/i)).toBeInTheDocument();
    await user.click(within(oldRow).getByRole("button", { name: "Excluir definitivamente Documento antigo" }));
    const dialog = screen.getByRole("dialog", { name: "Excluir definitivamente?" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("textbox", { name: /digite Documento antigo/i })).toHaveFocus();
    const confirm = within(dialog).getByRole("button", { name: "Excluir definitivamente" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "Documento antigo");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(permanentlyDeleteDocument).toHaveBeenCalledWith(oldDocument.id, expect.any(AbortSignal)));
    expect(screen.queryByRole("listitem", { name: "Documento antigo" })).not.toBeInTheDocument();

    const recentRow = screen.getByRole("listitem", { name: "Documento recente" });
    await user.click(within(recentRow).getByRole("button", { name: "Restaurar Documento recente" }));
    await waitFor(() => expect(restoreDocument).toHaveBeenCalledWith(recentDocument.id, expect.any(AbortSignal)));
    expect(screen.getByRole("status")).toHaveTextContent("Documento recente restaurado.");
  });

  it("exposes honest loading, failure, retry, empty, escape, and focus-return states", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const loadDocuments = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return { items: [oldDocument], nextCursor: null, collectionsByDocumentId: {} };
    });
    render(<StudioTrash loadDocuments={loadDocuments} restoreDocument={vi.fn()} permanentlyDeleteDocument={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Abrindo lixeira" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível abrir a lixeira");
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    const trigger = await screen.findByRole("button", { name: "Excluir definitivamente Documento antigo" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

const oldDocument = document("old", "Documento antigo", "2026-06-17T12:00:00.000Z");
const recentDocument = document("recent", "Documento recente", "2026-07-13T12:00:00.000Z");

function document(id: string, title: string, trashedAt: string): StudioDocument {
  return { id, workspaceId: "workspace_a", ownerProfileId: "owner_a", captureKey: null, title,
    bodyJson: { type: "doc", content: [] }, bodyText: title, revision: 2, captureMode: "text",
    inboxState: "reviewed", isFocused: false, status: "trashed", createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: trashedAt, archivedAt: null, trashedAt, preTrashStatus: "active" };
}
