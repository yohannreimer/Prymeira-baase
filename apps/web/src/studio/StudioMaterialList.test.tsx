import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { StudioAsset } from "./studio.types";
import StudioMaterialList from "./StudioMaterialList";

it("keeps a very long PDF extraction out of the document and selects its compact row", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const pdf = asset({
    id: "asset_pdf",
    displayName: "strategy.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2_560_000,
    extractionStatus: "ready",
    extractedText: "Long text ".repeat(10_000)
  });

  render(<StudioMaterialList assets={[pdf]} onSelect={onSelect} />);

  expect(screen.getByText("strategy.pdf")).toBeVisible();
  expect(screen.getByText("PDF · 2,4 MB")).toBeVisible();
  expect(screen.getByText("Pronto")).toBeVisible();
  expect(screen.queryByText(/Long text Long text/u)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Abrir strategy.pdf" }));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "asset_pdf" }));
});

it("labels every material kind and extraction state without adding inline actions", () => {
  render(<StudioMaterialList assets={[
    asset({ id: "audio", kind: "audio", displayName: "reuniao.wav", mimeType: "audio/wav", extractionStatus: "processing" }),
    asset({ id: "image", kind: "image", displayName: "quadro.png", mimeType: "image/png", extractionStatus: "pending" }),
    asset({ id: "link", kind: "link_snapshot", displayName: "Pesquisa", mimeType: null, sizeBytes: 0, extractionStatus: "failed" })
  ]} onSelect={vi.fn()} />);

  const list = screen.getByRole("list", { name: "Materiais do documento" });
  expect(within(list).getByText("Áudio · 120 KB")).toBeVisible();
  expect(within(list).getByText("Imagem · 120 KB")).toBeVisible();
  expect(within(list).getByText("Link")).toBeVisible();
  expect(within(list).getByText("Processando")).toBeVisible();
  expect(within(list).getByText("Aguardando processamento")).toBeVisible();
  expect(within(list).getByText("Falha no processamento")).toBeVisible();
  expect(within(list).queryByRole("button", { name: /transcrição|baixar|excluir/iu })).not.toBeInTheDocument();
});

function asset(overrides: Partial<StudioAsset>): StudioAsset {
  return {
    id: "asset_default",
    workspaceId: "workspace_a",
    ownerProfileId: "profile_owner",
    documentId: "document_1",
    idempotencyKey: null,
    kind: "file",
    displayName: "material.pdf",
    sourceUrl: null,
    finalUrl: null,
    mimeType: "application/pdf",
    sizeBytes: 120 * 1_000,
    extractionStatus: "ready",
    extractedText: null,
    lastErrorCode: null,
    attemptCount: 0,
    nextAttemptAt: null,
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
    ...overrides
  };
}
