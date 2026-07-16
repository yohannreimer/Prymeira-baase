import { act, render, screen, within } from "@testing-library/react";
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
  const row = screen.getByRole("button", { name: "Abrir strategy.pdf" });
  const liveStatus = screen.getByRole("status");
  expect(liveStatus).toHaveTextContent("Pronto");
  expect(row.contains(liveStatus)).toBe(false);
  expect(row.parentElement).toContainElement(liveStatus);
  expect(screen.queryByText(/Long text Long text/u)).not.toBeInTheDocument();
  await user.click(row);
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "asset_pdf" }));
});

it("labels every material kind and extraction state without adding inline actions", () => {
  render(<StudioMaterialList assets={[
    asset({ id: "audio", kind: "audio", displayName: "reuniao.wav", mimeType: "audio/wav", extractionStatus: "processing" }),
    asset({ id: "image", kind: "image", displayName: "quadro.png", mimeType: "image/png", extractionStatus: "pending" }),
    asset({ id: "link", kind: "link_snapshot", displayName: "Pesquisa", mimeType: null, sizeBytes: 0, extractionStatus: "failed" })
  ]} onSelect={vi.fn()} />);

  const list = screen.getByRole("list", { name: "Materiais do documento" });
  expect(within(list).getByText("Áudio · 117,2 KB")).toBeVisible();
  expect(within(list).getByText("Imagem · 117,2 KB")).toBeVisible();
  expect(within(list).getByText("Link")).toBeVisible();
  expect(within(list).getAllByRole("status").map((status) => status.textContent)).toEqual([
    "Processando",
    "Aguardando processamento",
    "Falha no processamento"
  ]);
  expect(within(list).queryByRole("heading")).not.toBeInTheDocument();
  expect(within(list).queryByRole("button", { name: /transcrição|baixar|excluir/iu })).not.toBeInTheDocument();
});

it("adopts a terminal processing status and announces the compact update", async () => {
  vi.useFakeTimers();
  const onAssetChange = vi.fn();
  const ready = asset({
    extractionStatus: "ready",
    updatedAt: "2026-07-16T10:01:00.000Z",
    extractedText: "Never render this transcript inline"
  });
  const getStatus = vi.fn().mockResolvedValue(ready);

  render(<StudioMaterialList
    assets={[asset({ extractionStatus: "pending" })]}
    onSelect={vi.fn()}
    onAssetChange={onAssetChange}
    getStatus={getStatus}
    pollDelays={[10]}
  />);

  expect(screen.getByRole("status")).toHaveTextContent("Aguardando processamento");
  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(screen.getByRole("status")).toHaveTextContent("Pronto");
  expect(screen.queryByText(ready.extractedText!)).not.toBeInTheDocument();
  expect(onAssetChange).toHaveBeenCalledWith(expect.objectContaining({ extractionStatus: "ready" }));
  vi.useRealTimers();
});

it("continues a scheduled failed asset through its background retry", async () => {
  vi.useFakeTimers();
  const onAssetChange = vi.fn();
  const failed = asset({
    extractionStatus: "failed",
    nextAttemptAt: "2026-07-16T10:02:00.000Z"
  });
  const processing = asset({
    extractionStatus: "processing",
    nextAttemptAt: null,
    updatedAt: "2026-07-16T10:01:00.000Z"
  });
  const ready = asset({
    extractionStatus: "ready",
    nextAttemptAt: null,
    updatedAt: "2026-07-16T10:02:00.000Z"
  });
  const getStatus = vi.fn().mockResolvedValueOnce(processing).mockResolvedValueOnce(ready);

  render(<StudioMaterialList
    assets={[failed]}
    onSelect={vi.fn()}
    onAssetChange={onAssetChange}
    getStatus={getStatus}
    pollDelays={[10, 10]}
  />);

  expect(screen.getByRole("status")).toHaveTextContent("Falha no processamento");
  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(screen.getByRole("status")).toHaveTextContent("Processando");
  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(screen.getByRole("status")).toHaveTextContent("Pronto");
  expect(onAssetChange).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

it("aborts an obsolete poll when the document asset identity changes", async () => {
  vi.useFakeTimers();
  let resolveObsolete!: (value: StudioAsset) => void;
  const obsoleteResult = new Promise<StudioAsset>((resolve) => {
    resolveObsolete = resolve;
  });
  const getStatus = vi.fn().mockReturnValue(obsoleteResult);
  const onAssetChange = vi.fn();
  const pendingA = asset({ id: "asset_a", documentId: "document_a", extractionStatus: "pending" });
  const readyB = asset({ id: "asset_b", documentId: "document_b", extractionStatus: "ready" });
  const view = render(<StudioMaterialList
    assets={[pendingA]}
    onSelect={vi.fn()}
    onAssetChange={onAssetChange}
    getStatus={getStatus}
    pollDelays={[10]}
  />);

  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(getStatus).toHaveBeenCalledWith("asset_a", expect.any(AbortSignal));
  const obsoleteSignal = getStatus.mock.calls[0]?.[1] as AbortSignal;
  view.rerender(<StudioMaterialList
    assets={[readyB]}
    onSelect={vi.fn()}
    onAssetChange={onAssetChange}
    getStatus={getStatus}
    pollDelays={[10]}
  />);
  expect(obsoleteSignal.aborted).toBe(true);

  await act(async () => {
    resolveObsolete(asset({
      id: "asset_a",
      documentId: "document_a",
      extractionStatus: "ready",
      updatedAt: "2026-07-16T10:01:00.000Z"
    }));
    await Promise.resolve();
  });
  expect(onAssetChange).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Abrir material.pdf" })).toBeInTheDocument();
  vi.useRealTimers();
});

it("keeps capped polling alive beyond the initial backoff schedule", async () => {
  vi.useFakeTimers();
  const pending = asset({ extractionStatus: "processing" });
  const ready = asset({
    extractionStatus: "ready",
    updatedAt: "2026-07-16T10:01:00.000Z"
  });
  let attempts = 0;
  const getStatus = vi.fn().mockImplementation(async () => {
    attempts += 1;
    return attempts > 20 ? ready : pending;
  });

  render(<StudioMaterialList
    assets={[pending]}
    onSelect={vi.fn()}
    getStatus={getStatus}
    pollDelays={[1, 2, 3]}
  />);

  await act(async () => vi.advanceTimersByTimeAsync(63));
  expect(getStatus).toHaveBeenCalledTimes(21);
  expect(screen.getByRole("status")).toHaveTextContent("Pronto");
  vi.useRealTimers();
});

it("keeps the capped delay between transient polling failures", async () => {
  vi.useFakeTimers();
  const getStatus = vi.fn().mockRejectedValue(new Error("temporary"));

  render(<StudioMaterialList
    assets={[asset({ extractionStatus: "pending" })]}
    onSelect={vi.fn()}
    getStatus={getStatus}
    pollDelays={[10]}
  />);

  await act(async () => vi.advanceTimersByTimeAsync(9));
  expect(getStatus).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(getStatus).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(9));
  expect(getStatus).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(getStatus).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

it("uses binary size boundaries without losing non-zero sub-KB files", () => {
  render(<StudioMaterialList assets={[
    asset({ id: "one-byte", displayName: "one.bin", mimeType: "application/octet-stream", sizeBytes: 1 }),
    asset({ id: "sub-kb", displayName: "small.bin", mimeType: "application/octet-stream", sizeBytes: 1023 }),
    asset({ id: "one-kb", displayName: "one-kb.bin", mimeType: "application/octet-stream", sizeBytes: 1024 }),
    asset({ id: "one-mb", displayName: "one-mb.bin", mimeType: "application/octet-stream", sizeBytes: 1024 * 1024 })
  ]} onSelect={vi.fn()} />);

  expect(screen.getByText("Arquivo · 1 B")).toBeVisible();
  expect(screen.getByText("Arquivo · 1023 B")).toBeVisible();
  expect(screen.getByText("Arquivo · 1 KB")).toBeVisible();
  expect(screen.getByText("Arquivo · 1 MB")).toBeVisible();
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
