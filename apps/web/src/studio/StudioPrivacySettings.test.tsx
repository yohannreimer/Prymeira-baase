import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudioPrivacySettings from "./StudioPrivacySettings";

describe("StudioPrivacySettings", () => {
  afterEach(() => vi.restoreAllMocks());

  it("exports from the private Studio surface and exposes the short-lived download", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ export: {
        exportId: "export_1", status: "pending", downloadUrl: null, expiresAt: "2026-07-14T15:15:00.000Z"
      } }), { status: 202, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ export: {
        exportId: "export_1", status: "ready", downloadUrl: "https://private.test/export",
        expiresAt: "2026-07-14T15:15:00.000Z"
      } }), { status: 200, headers: { "content-type": "application/json" } }));

    render(<StudioPrivacySettings />);
    expect(screen.getByRole("heading", { name: "Privacidade do Estúdio" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preparar exportação" }));

    const link = await screen.findByRole("link", { name: "Baixar arquivo privado" }, { timeout: 2_000 });
    expect(link).toHaveAttribute("href", "https://private.test/export");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/studio/export/export_1", expect.any(Object));
  });

  it("requires the exact irreversible confirmation and reports safe cleanup", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ deletion: {
      requestId: "delete_1", status: "reconciliation_pending", pendingObjectCount: 0, cleanupContinues: true
    } }), { status: 202, headers: { "content-type": "application/json" } }));

    render(<StudioPrivacySettings />);
    expect(screen.getByText(/não apaga tarefas, rotinas, processos ou comunicados/i)).toBeInTheDocument();
    const confirm = screen.getByRole("textbox", { name: "Confirmação de exclusão" });
    const button = screen.getByRole("button", { name: "Excluir meu Estúdio" });
    expect(button).toBeDisabled();
    await user.type(confirm, "EXCLUIR MEU ESTÚDIO");
    expect(button).toBeEnabled();
    await user.click(button);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/studio/data", expect.objectContaining({ method: "DELETE" })));
    expect(await screen.findByRole("status")).toHaveTextContent(/conteúdo privado foi removido/i);
    expect(screen.getByRole("status")).toHaveTextContent(/continuará em segundo plano/i);
  });

  it("never claims that nothing was removed when the final deletion response is unavailable", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection lost after commit"));
    render(<StudioPrivacySettings />);
    await user.type(screen.getByRole("textbox", { name: "Confirmação de exclusão" }), "EXCLUIR MEU ESTÚDIO");
    await user.click(screen.getByRole("button", { name: "Excluir meu Estúdio" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/não foi possível confirmar o estado final/i);
    expect(alert).not.toHaveTextContent(/nada foi ocultado/i);
  });
});
