import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import StudioMaterialInspector from "./StudioMaterialInspector";
import type { StudioAsset } from "./studio.types";

afterEach(() => {
  vi.useRealTimers();
  document.body.style.overflow = "";
});

it("keeps a long PDF extraction collapsed until the owner asks to read it", async () => {
  const user = userEvent.setup();
  const extractedText = "Direção estratégica ".repeat(2_000);
  const normalizedText = extractedText.trim();
  render(<StudioMaterialInspector
    asset={asset({ displayName: "strategy.pdf", mimeType: "application/pdf", extractedText })}
    open
    onClose={vi.fn()}
    onInsertText={vi.fn()}
    getDownload={vi.fn().mockResolvedValue({ url: "https://private.example/strategy.pdf", expiresInSeconds: 600 })}
  />);

  expect(screen.getByRole("dialog", { name: "Material strategy.pdf" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Ver texto completo" })).toBeVisible();
  expect(screen.queryByText(normalizedText)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Ver texto completo" }));
  expect(screen.getByRole("document")).toHaveTextContent(normalizedText);
});

it("previews each material kind without exposing unsafe inline content", async () => {
  const getDownload = vi.fn().mockResolvedValue({ url: "https://private.example/material", expiresInSeconds: 600 });
  const view = render(<StudioMaterialInspector
    asset={asset({ kind: "image", displayName: "mapa.png", mimeType: "image/png", extractedText: null })}
    open
    onClose={vi.fn()}
    getDownload={getDownload}
  />);
  expect(await screen.findByRole("img", { name: "Prévia de mapa.png" })).toHaveAttribute("src", "https://private.example/material");

  view.rerender(<StudioMaterialInspector
    asset={asset({ id: "audio", kind: "audio", displayName: "nota.wav", mimeType: "audio/wav" })}
    open
    onClose={vi.fn()}
    getDownload={getDownload}
  />);
  expect(await screen.findByLabelText("Ouvir áudio original: nota.wav")).toHaveAttribute("src", "https://private.example/material");

  view.rerender(<StudioMaterialInspector
    asset={asset({ id: "link", kind: "link_snapshot", displayName: "Pesquisa", sourceUrl: "https://example.com", extractedText: null })}
    open
    onClose={vi.fn()}
  />);
  expect(screen.getByRole("link", { name: "Abrir link original" })).toHaveAttribute("href", "https://example.com");
  expect(screen.getByRole("link", { name: "Abrir link original" })).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
});

it("keeps a playing audio URL and position stable until a safe renewal event", async () => {
  vi.useFakeTimers();
  const renewal = deferred<{ url: string; expiresInSeconds: number }>();
  const getDownload = vi.fn()
    .mockResolvedValueOnce({ url: "https://private.example/audio-v1", expiresInSeconds: 600 })
    .mockImplementationOnce(() => renewal.promise);
  render(<StudioMaterialInspector
    asset={asset({ id: "audio", kind: "audio", displayName: "nota.wav", mimeType: "audio/wav" })}
    open
    onClose={vi.fn()}
    getDownload={getDownload}
  />);
  await act(async () => { await Promise.resolve(); });
  const player = screen.getByLabelText("Ouvir áudio original: nota.wav") as HTMLAudioElement;
  let paused = false;
  Object.defineProperty(player, "paused", { configurable: true, get: () => paused });
  Object.defineProperty(player, "ended", { configurable: true, value: false });
  player.currentTime = 84.25;

  await act(async () => { await vi.advanceTimersByTimeAsync(570_001); });
  await act(async () => renewal.resolve({ url: "https://private.example/audio-v2", expiresInSeconds: 600 }));

  expect(screen.getByLabelText("Ouvir áudio original: nota.wav")).toBe(player);
  expect(player).toHaveAttribute("src", "https://private.example/audio-v1");
  expect(player.currentTime).toBe(84.25);
  expect(player.paused).toBe(false);

  paused = true;
  fireEvent.pause(player);
  expect(player).toHaveAttribute("src", "https://private.example/audio-v2");
  player.currentTime = 0;
  fireEvent.loadedMetadata(player);
  expect(player.currentTime).toBe(84.25);
  expect(player.paused).toBe(true);
});

it("renews a paused audio in place and restores its position after metadata", async () => {
  vi.useFakeTimers();
  const renewal = deferred<{ url: string; expiresInSeconds: number }>();
  const getDownload = vi.fn()
    .mockResolvedValueOnce({ url: "https://private.example/audio-v1", expiresInSeconds: 600 })
    .mockImplementationOnce(() => renewal.promise);
  render(<StudioMaterialInspector
    asset={asset({ id: "audio", kind: "audio", displayName: "nota.wav", mimeType: "audio/wav" })}
    open
    onClose={vi.fn()}
    getDownload={getDownload}
  />);
  await act(async () => { await Promise.resolve(); });
  const player = screen.getByLabelText("Ouvir áudio original: nota.wav") as HTMLAudioElement;
  Object.defineProperty(player, "paused", { configurable: true, value: true });
  Object.defineProperty(player, "ended", { configurable: true, value: false });
  player.currentTime = 32.5;

  await act(async () => { await vi.advanceTimersByTimeAsync(570_001); });
  await act(async () => renewal.resolve({ url: "https://private.example/audio-v2", expiresInSeconds: 600 }));

  expect(player).toHaveAttribute("src", "https://private.example/audio-v2");
  player.currentTime = 0;
  fireEvent.loadedMetadata(player);
  expect(player.currentTime).toBe(32.5);
  expect(player.paused).toBe(true);
});

it("adopts a renewed URL from an ended audio at position zero", async () => {
  vi.useFakeTimers();
  const getDownload = vi.fn()
    .mockResolvedValueOnce({ url: "https://private.example/audio-v1", expiresInSeconds: 600 })
    .mockResolvedValueOnce({ url: "https://private.example/audio-v2", expiresInSeconds: 600 });
  render(<StudioMaterialInspector
    asset={asset({ id: "audio", kind: "audio", displayName: "nota.wav", mimeType: "audio/wav" })}
    open
    onClose={vi.fn()}
    getDownload={getDownload}
  />);
  await act(async () => { await Promise.resolve(); });
  const player = screen.getByLabelText("Ouvir áudio original: nota.wav") as HTMLAudioElement;
  let ended = false;
  Object.defineProperty(player, "paused", { configurable: true, get: () => ended });
  Object.defineProperty(player, "ended", { configurable: true, get: () => ended });
  player.currentTime = 51.25;

  await act(async () => { await vi.advanceTimersByTimeAsync(570_001); });
  expect(player).toHaveAttribute("src", "https://private.example/audio-v1");
  ended = true;
  fireEvent.ended(player);
  expect(player).toHaveAttribute("src", "https://private.example/audio-v2");
  player.currentTime = 9;
  fireEvent.loadedMetadata(player);
  expect(player.currentTime).toBe(0);
});

it("ignores a late audio URL and cancels renewal after the inspected asset changes", async () => {
  vi.useFakeTimers();
  const obsolete = deferred<{ url: string; expiresInSeconds: number }>();
  const getDownload = vi.fn()
    .mockImplementationOnce(() => obsolete.promise)
    .mockResolvedValueOnce({ url: "https://private.example/audio-b", expiresInSeconds: 600 });
  const view = render(<StudioMaterialInspector
    asset={asset({ id: "audio-a", kind: "audio", displayName: "a.wav", mimeType: "audio/wav" })}
    open
    onClose={vi.fn()}
    getDownload={getDownload}
  />);

  view.rerender(<StudioMaterialInspector
    asset={asset({ id: "audio-b", kind: "audio", displayName: "b.wav", mimeType: "audio/wav" })}
    open
    onClose={vi.fn()}
    getDownload={getDownload}
  />);
  await act(async () => { await Promise.resolve(); });
  const player = screen.getByLabelText("Ouvir áudio original: b.wav");
  expect(player).toHaveAttribute("src", "https://private.example/audio-b");

  await act(async () => obsolete.resolve({ url: "https://private.example/audio-a-late", expiresInSeconds: 600 }));
  expect(player).toHaveAttribute("src", "https://private.example/audio-b");

  view.unmount();
  await vi.advanceTimersByTimeAsync(600_001);
  expect(getDownload).toHaveBeenCalledTimes(2);
});

it("waits for persisted insertion and reports save failures without claiming success", async () => {
  const user = userEvent.setup();
  const onInsertText = vi.fn()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  render(<StudioMaterialInspector
    asset={asset({ kind: "audio", displayName: "nota.wav" })}
    open
    onClose={vi.fn()}
    onInsertText={onInsertText}
    getDownload={vi.fn().mockResolvedValue({ url: "https://private.example/nota.wav", expiresInSeconds: 600 })}
  />);

  await user.click(screen.getByRole("button", { name: "Inserir no documento" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("não foi inserido");
  expect(onInsertText).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Inserir no documento" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Texto inserido e versão preservada");
  expect(onInsertText).toHaveBeenCalledTimes(2);
});

it("retries processing and deletes only after explicit confirmation", async () => {
  const user = userEvent.setup();
  const failed = asset({ extractionStatus: "failed", extractedText: null });
  const ready = asset({ extractionStatus: "ready", updatedAt: "2026-07-16T12:01:00.000Z" });
  const onAssetChange = vi.fn();
  const onDeleted = vi.fn();
  const retry = vi.fn().mockResolvedValue(ready);
  const deleteAsset = vi.fn().mockResolvedValue(undefined);
  render(<StudioMaterialInspector
    asset={failed}
    open
    onClose={vi.fn()}
    onAssetChange={onAssetChange}
    onDeleted={onDeleted}
    retry={retry}
    deleteAsset={deleteAsset}
    getDownload={vi.fn().mockResolvedValue({ url: "https://private.example/material", expiresInSeconds: 600 })}
  />);

  await user.click(screen.getByRole("button", { name: "Tentar processamento novamente" }));
  await waitFor(() => expect(onAssetChange).toHaveBeenCalledWith(ready));

  await user.click(screen.getByRole("button", { name: "Excluir material" }));
  expect(screen.getByText("Excluir este material?", { exact: true })).toBeVisible();
  expect(deleteAsset).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
  await waitFor(() => expect(deleteAsset).toHaveBeenCalledWith(failed.id, expect.any(AbortSignal)));
  expect(onDeleted).toHaveBeenCalledWith(failed.id);
});

it("traps focus, closes from escape and backdrop, then returns focus to the opener", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const opener = document.createElement("button");
  opener.textContent = "Abrir material";
  document.body.append(opener);
  opener.focus();
  const view = render(<StudioMaterialInspector asset={asset()} open onClose={onClose} />);

  expect(screen.getByRole("heading", { name: "Material Material.pdf" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);

  view.rerender(<StudioMaterialInspector asset={asset()} open={false} onClose={onClose} />);
  expect(opener).toHaveFocus();
  view.rerender(<StudioMaterialInspector asset={asset()} open onClose={onClose} />);
  await user.click(screen.getByRole("button", { name: "Fechar detalhes do material" }));
  expect(onClose).toHaveBeenCalledTimes(2);
  opener.remove();
});

function asset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: "asset_pdf",
    workspaceId: "workspace_a",
    ownerProfileId: "owner_a",
    documentId: "document_a",
    idempotencyKey: null,
    kind: "file",
    displayName: "Material.pdf",
    sourceUrl: null,
    finalUrl: null,
    mimeType: "application/pdf",
    sizeBytes: 2048,
    extractionStatus: "ready",
    extractedText: "Texto extraído",
    lastErrorCode: null,
    attemptCount: 1,
    nextAttemptAt: null,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
