import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StudioDocument, StudioHome as StudioHomeModel } from "./studio.types";
import StudioHome from "./StudioHome";

const document: StudioDocument = {
  id: "document_1",
  workspaceId: "workspace_1",
  ownerProfileId: "owner_1",
  captureKey: null,
  title: "Escolha de posicionamento",
  bodyJson: { type: "doc" },
  bodyText: "Precisamos escolher a direção.",
  revision: 1,
  captureMode: "text",
  inboxState: "pending_review",
  isFocused: true,
  status: "active",
  createdAt: "2026-07-13T12:00:00.000Z",
  updatedAt: "2026-07-13T12:00:00.000Z",
  archivedAt: null
};

const home: StudioHomeModel = {
  recentDocuments: [document],
  focusedDocuments: [document],
  pendingReviewCount: 1,
  nextRituals: [{ id: "ritual_1", title: "Revisão semanal", scheduledFor: "2026-07-17T12:00:00.000Z" }]
};

describe("StudioHome", () => {
  it("presents a calm return path without productivity pressure", async () => {
    render(<StudioHome loadHome={async () => home} onOpenDocument={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Continue de onde parou" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Em foco" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recentes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Próximo ritual" })).toBeInTheDocument();
    expect(screen.queryByText(/score|streak|atrasad|progresso|produtividade/i)).not.toBeInTheDocument();
  });

  it("opens a document directly from the calm home", async () => {
    const user = userEvent.setup();
    const onOpenDocument = vi.fn();
    render(<StudioHome loadHome={async () => home} onOpenDocument={onOpenDocument} />);

    const section = await screen.findByRole("region", { name: "Continue de onde parou" });
    await user.click(within(section).getByRole("button", { name: /Escolha de posicionamento/ }));
    expect(onOpenDocument).toHaveBeenCalledWith(document);
  });

  it("opens the next configured ritual without framing it as overdue", async () => {
    const user = userEvent.setup();
    const onOpenRitual = vi.fn();
    render(<StudioHome loadHome={async () => home} onOpenDocument={vi.fn()} onOpenRitual={onOpenRitual} />);

    await user.click(await screen.findByRole("button", { name: "Iniciar Revisão semanal" }));

    expect(onOpenRitual).toHaveBeenCalledWith("ritual_1");
    expect(screen.queryByText(/atrasad|vencid/i)).not.toBeInTheDocument();
  });

  it("invites capture in empty sections without declaring there is nothing to do", async () => {
    render(<StudioHome loadHome={async () => ({ ...home, recentDocuments: [], focusedDocuments: [], nextRituals: [] })} onOpenDocument={vi.fn()} />);

    await screen.findByRole("heading", { name: "Continue de onde parou" });
    expect(screen.queryByRole("heading", { name: "Próximo ritual" })).not.toBeInTheDocument();
    expect(screen.getByText("Seu próximo registro pode começar aqui, sem precisar de categoria.")).toBeInTheDocument();
    expect(screen.queryByText(/nada para fazer/i)).not.toBeInTheDocument();
  });

  it("cancels home loading when the owner leaves the Studio", () => {
    let receivedSignal: AbortSignal | undefined;
    const loadHome = vi.fn((signal?: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<StudioHomeModel>(() => undefined);
    });
    const view = render(<StudioHome loadHome={loadHome} onOpenDocument={vi.fn()} />);

    expect(receivedSignal?.aborted).toBe(false);
    view.unmount();
    expect(receivedSignal?.aborted).toBe(true);
  });
});
