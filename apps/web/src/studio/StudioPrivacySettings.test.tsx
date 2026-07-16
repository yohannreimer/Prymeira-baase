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
        exportId: "export_1", status: "pending", downloadUrl: null,
        requestedAt: "2026-07-14T15:00:00.000Z", filename: "prymeira-baase-estudio-2026-07-14.zip",
        sizeBytes: null, expiresAt: "2026-07-14T15:15:00.000Z"
      } }), { status: 202, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ export: {
        exportId: "export_1", status: "ready", downloadUrl: "https://private.test/export",
        requestedAt: "2026-07-14T15:00:00.000Z", filename: "prymeira-baase-estudio-2026-07-14.zip",
        sizeBytes: 1536, expiresAt: "2026-07-14T15:15:00.000Z"
      } }), { status: 200, headers: { "content-type": "application/json" } }));

    render(<StudioPrivacySettings />);
    expect(screen.getByRole("heading", { name: "Privacidade do Estúdio" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preparar exportação" }));

    expect(await screen.findByText("Sua cópia está na fila")).toBeVisible();
    expect(screen.getByText(/Inclui documentos e metadados privados do Estúdio/u)).toBeVisible();
    const link = await screen.findByRole("link", { name: "Baixar cópia privada" }, { timeout: 2_000 });
    expect(link).toHaveAttribute("href", "https://private.test/export");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(screen.getByText("prymeira-baase-estudio-2026-07-14.zip")).toBeVisible();
    expect(screen.getByText("1,5 KB")).toBeVisible();
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/studio/export/export_1", expect.any(Object));
  });

  it("stops polling terminal states and lets the owner regenerate failed and expired exports", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonExport("failed"))
      .mockResolvedValueOnce(jsonExport("expired"));
    render(<StudioPrivacySettings />);
    await user.click(screen.getByRole("button", { name: "Preparar exportação" }));
    expect(await screen.findByText(/não conseguimos concluir/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Gerar nova cópia" }));
    expect(await screen.findByText(/expirou/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Gerar nova cópia" })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("aborts polling on unmount and ignores a stale response from a replaced export", async () => {
    const user = userEvent.setup();
    let resolvePoll!: (response: Response) => void;
    const poll = new Promise<Response>((resolve) => { resolvePoll = resolve; });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonExport("pending", "old"))
      .mockImplementationOnce((_input, init) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return poll;
      })
      .mockResolvedValueOnce(jsonExport("ready", "new"));
    const view = render(<StudioPrivacySettings />);
    await user.click(screen.getByRole("button", { name: "Preparar exportação" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    await user.click(screen.getByRole("button", { name: "Gerar nova cópia" }));
    expect(await screen.findByText("prymeira-baase-estudio-new.zip")).toBeVisible();
    resolvePoll(jsonExport("failed", "old"));
    await Promise.resolve();
    expect(screen.queryByText(/não conseguimos concluir/i)).not.toBeInTheDocument();
    view.unmount();
    const signal = fetchSpy.mock.calls[1]?.[1]?.signal;
    expect(signal?.aborted).toBe(true);
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

function jsonExport(status: "pending" | "processing" | "ready" | "failed" | "expired", id = "export_1") {
  return new Response(JSON.stringify({ export: {
    exportId: id, status, requestedAt: "2026-07-14T15:00:00.000Z",
    filename: `prymeira-baase-estudio-${id}.zip`, sizeBytes: status === "ready" ? 2048 : null,
    expiresAt: "2026-07-14T15:15:00.000Z",
    downloadUrl: status === "ready" ? `https://private.test/${id}` : null
  } }), { status: status === "pending" || status === "failed" || status === "expired" ? 202 : 200, headers: { "content-type": "application/json" } });
}
