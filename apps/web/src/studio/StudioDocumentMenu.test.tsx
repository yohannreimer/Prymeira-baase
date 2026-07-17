import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import StudioDocumentMenu from "./StudioDocumentMenu";
import type { StudioDocument } from "./studio.types";

const document: StudioDocument = {
  id: "document_1", workspaceId: "workspace_a", ownerProfileId: "owner_a", captureKey: null,
  title: "Estratégia", bodyJson: { type: "doc", content: [] }, bodyText: "Texto", revision: 1,
  captureMode: "text", inboxState: "reviewed", isFocused: false, status: "active",
  createdAt: "2026-07-17T12:00:00.000Z", updatedAt: "2026-07-17T12:00:00.000Z", archivedAt: null
};

describe("StudioDocumentMenu", () => {
  it("keeps sharing and export inside one quiet more menu", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(<StudioDocumentMenu document={document} access="owned" onExport={onExport} />);
    await user.click(screen.getByRole("button", { name: "Mais opções da folha" }));
    expect(screen.getByRole("menuitem", { name: /Compartilhar/ })).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: /Exportar/ }));
    expect(onExport).toHaveBeenCalledOnce();
  });

  it("offers comments and import without export on a shared read-only sheet", async () => {
    const user = userEvent.setup();
    render(<StudioDocumentMenu document={document} access="shared_read_comment" />);
    await user.click(screen.getByRole("button", { name: "Mais opções da folha" }));
    expect(screen.getByRole("menuitem", { name: /Comentários e importação/ })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /Exportar/ })).not.toBeInTheDocument();
  });
});

