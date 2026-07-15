import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioAsset } from "./studio.types";
import StudioAssetProcessingStatus from "./StudioAssetProcessingStatus";

describe("StudioAssetProcessingStatus", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows a preserved audio asset through failure, real retry, and transcription", async () => {
    const pending = asset({ extractionStatus: "pending", updatedAt: "2026-07-13T12:01:00.000Z" });
    const failed = asset({
      extractionStatus: "failed",
      attemptCount: 1,
      lastErrorCode: "STUDIO_ASSET_PROCESSING_FAILED",
      nextAttemptAt: null,
      updatedAt: "2026-07-13T12:02:00.000Z"
    });
    const retried = asset({ extractionStatus: "pending", updatedAt: "2026-07-13T12:03:00.000Z" });
    const ready = asset({
      extractionStatus: "ready",
      extractedText: "Escolher uma direção com calma.",
      attemptCount: 1,
      updatedAt: "2026-07-13T12:04:00.000Z"
    });
    const getStatus = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(ready);
    const retry = vi.fn(async () => retried);
    const getDownload = vi.fn(async () => ({ url: "https://private.example/audio", expiresInSeconds: 600 }));

    render(
      <StudioAssetProcessingStatus
        asset={pending}
        getStatus={getStatus}
        retry={retry}
        getDownload={getDownload}
        pollDelays={[0, 0]}
      />
    );

    expect(await screen.findByText("Não conseguimos transcrever este áudio.")).toBeInTheDocument();
    expect(screen.getByTestId("studio-audio-player")).toHaveAttribute("src", "https://private.example/audio");
    expect(screen.getByRole("link", { name: "Baixar áudio original" })).toHaveAttribute("href", "https://private.example/audio");

    await userEvent.click(screen.getByRole("button", { name: "Tentar transcrição novamente" }));

    expect(retry).toHaveBeenCalledWith("asset_1", expect.any(AbortSignal));
    expect(await screen.findByText("Escolher uma direção com calma.")).toBeInTheDocument();
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("aborts status and download requests when the document closes", async () => {
    let statusSignal: AbortSignal | undefined;
    let downloadSignal: AbortSignal | undefined;
    const view = render(
      <StudioAssetProcessingStatus
        asset={asset()}
        getStatus={vi.fn((_id, signal?: AbortSignal) => {
          statusSignal = signal;
          return new Promise<StudioAsset>(() => undefined);
        })}
        retry={vi.fn()}
        getDownload={vi.fn((_id, signal?: AbortSignal) => {
          downloadSignal = signal;
          return new Promise<{ url: string; expiresInSeconds: number }>(() => undefined);
        })}
        pollDelays={[0]}
      />
    );

    await waitFor(() => expect(statusSignal).toBeDefined());
    expect(downloadSignal?.aborted).toBe(false);
    view.unmount();
    expect(statusSignal?.aborted).toBe(true);
    expect(downloadSignal?.aborted).toBe(true);
  });

  it("renews an expiring audio URL and cancels its timer when the card unmounts", async () => {
    vi.useFakeTimers();
    const getDownload = vi.fn()
      .mockResolvedValueOnce({ url: "https://private.example/audio-v1", expiresInSeconds: 600 })
      .mockResolvedValueOnce({ url: "https://private.example/audio-v2", expiresInSeconds: 600 });
    const view = render(
      <StudioAssetProcessingStatus
        asset={asset({ extractionStatus: "ready" })}
        getDownload={getDownload}
      />
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("studio-audio-player")).toHaveAttribute(
      "src",
      "https://private.example/audio-v1"
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(600_001); });
    expect(getDownload).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("studio-audio-player")).toHaveAttribute(
      "src",
      "https://private.example/audio-v2"
    );

    view.unmount();
    await vi.advanceTimersByTimeAsync(600_001);
    expect(getDownload).toHaveBeenCalledTimes(2);
  });

  it.each(["file", "image"] as const)("fetches a fresh %s download only when activated", async (kind) => {
    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function captureClick(
      this: HTMLAnchorElement
    ) {
      clicked.push(this);
    });
    const getDownload = vi.fn()
      .mockResolvedValueOnce({ url: `https://private.example/${kind}-v1`, expiresInSeconds: 600 })
      .mockResolvedValueOnce({ url: `https://private.example/${kind}-v2`, expiresInSeconds: 600 });
    render(
      <StudioAssetProcessingStatus
        asset={asset({
          kind,
          displayName: kind === "file" ? "plano.pdf" : "quadro.png",
          extractionStatus: "ready"
        })}
        getDownload={getDownload}
      />
    );

    expect(getDownload).not.toHaveBeenCalled();
    const download = screen.getByRole("button", { name: "Baixar arquivo original" });
    await userEvent.click(download);
    await waitFor(() => expect(clicked).toHaveLength(1));
    await userEvent.click(download);
    await waitFor(() => expect(clicked).toHaveLength(2));

    expect(getDownload).toHaveBeenCalledTimes(2);
    expect(clicked.map((anchor) => anchor.href)).toEqual([
      `https://private.example/${kind}-v1`,
      `https://private.example/${kind}-v2`
    ]);
    for (const anchor of clicked) {
      expect(anchor).toHaveAttribute("target", "_blank");
      expect(anchor).toHaveAttribute("rel", "noreferrer");
      expect(anchor).toHaveAttribute("download", kind === "file" ? "plano.pdf" : "quadro.png");
      expect(anchor.isConnected).toBe(false);
    }
    click.mockRestore();
  });

  it("keeps a failed file download retryable and does not act after unmount", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const pending = deferred<{ url: string; expiresInSeconds: number }>();
    const getDownload = vi.fn()
      .mockRejectedValueOnce(new Error("expired"))
      .mockImplementationOnce(() => pending.promise);
    const view = render(
      <StudioAssetProcessingStatus
        asset={asset({ kind: "file", extractionStatus: "ready" })}
        getDownload={getDownload}
      />
    );

    const download = screen.getByRole("button", { name: "Baixar arquivo original" });
    await userEvent.click(download);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível preparar o download");
    await userEvent.click(download);
    expect(download).toBeDisabled();
    view.unmount();
    await act(async () => pending.resolve({ url: "https://private.example/late", expiresInSeconds: 600 }));

    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("suppresses concurrent file download activation", async () => {
    const request = deferred<{ url: string; expiresInSeconds: number }>();
    const getDownload = vi.fn(() => request.promise);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(
      <StudioAssetProcessingStatus
        asset={asset({ kind: "file", extractionStatus: "ready" })}
        getDownload={getDownload}
      />
    );
    const download = screen.getByRole("button", { name: "Baixar arquivo original" });

    act(() => {
      download.click();
      download.click();
    });
    expect(getDownload).toHaveBeenCalledTimes(1);

    await act(async () => request.resolve({ url: "https://private.example/file", expiresInSeconds: 600 }));
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("offers one safe audio refresh after a player error", async () => {
    const getDownload = vi.fn()
      .mockResolvedValueOnce({ url: "https://private.example/broken", expiresInSeconds: 600 })
      .mockResolvedValueOnce({ url: "https://private.example/recovered", expiresInSeconds: 600 });
    render(
      <StudioAssetProcessingStatus
        asset={asset({ extractionStatus: "ready" })}
        getDownload={getDownload}
      />
    );
    const player = await screen.findByTestId("studio-audio-player");

    fireEvent.error(player);
    expect(screen.queryByTestId("studio-audio-player")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Carregar áudio original" }));

    expect(await screen.findByTestId("studio-audio-player")).toHaveAttribute(
      "src",
      "https://private.example/recovered"
    );
    expect(getDownload).toHaveBeenCalledTimes(2);
  });

  it("stops bounded polling without declaring a processing failure", async () => {
    const pending = asset();
    const getStatus = vi.fn(async () => pending);
    render(
      <StudioAssetProcessingStatus
        asset={pending}
        getStatus={getStatus}
        retry={vi.fn()}
        getDownload={vi.fn(async () => ({ url: "https://private.example/audio", expiresInSeconds: 600 }))}
        pollDelays={[0, 0]}
      />
    );

    expect(await screen.findByText("O processamento continua em segundo plano.")).toBeInTheDocument();
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Não conseguimos transcrever este áudio.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar estado" })).toBeInTheDocument();
  });

  it("resets polling when a new prop moves the same asset from ready back to pending", async () => {
    const initial = asset({
      extractionStatus: "ready",
      extractedText: "Transcrição antiga.",
      updatedAt: "2026-07-13T12:01:00.000Z"
    });
    const pending = asset({
      extractionStatus: "pending",
      extractedText: null,
      updatedAt: "2026-07-13T12:02:00.000Z"
    });
    const refreshed = asset({
      extractionStatus: "ready",
      extractedText: "Transcrição reprocessada.",
      updatedAt: "2026-07-13T12:03:00.000Z"
    });
    const getStatus = vi.fn(async () => refreshed);
    const getDownload = vi.fn(async () => ({ url: "https://private.example/audio", expiresInSeconds: 600 }));
    const pollDelays = [0] as const;
    const view = render(
      <StudioAssetProcessingStatus
        asset={initial}
        getStatus={getStatus}
        retry={vi.fn()}
        getDownload={getDownload}
        pollDelays={pollDelays}
      />
    );
    expect(screen.getByText("Transcrição antiga.")).toBeInTheDocument();

    view.rerender(
      <StudioAssetProcessingStatus
        asset={pending}
        getStatus={getStatus}
        retry={vi.fn()}
        getDownload={getDownload}
        pollDelays={pollDelays}
      />
    );

    expect(await screen.findByText("Transcrição reprocessada.")).toBeInTheDocument();
    expect(getStatus).toHaveBeenCalledWith("asset_1", expect.any(AbortSignal));
  });

  it("propagates a polled asset once and does not regress when an older prop arrives", async () => {
    const pendingT1 = asset({
      extractionStatus: "pending",
      updatedAt: "2026-07-13T12:01:00.000Z"
    });
    const processingT2 = asset({
      extractionStatus: "processing",
      updatedAt: "2026-07-13T12:02:00.000Z"
    });
    const readyT3 = asset({
      extractionStatus: "ready",
      extractedText: "Versão mais recente.",
      updatedAt: "2026-07-13T12:03:00.000Z"
    });
    const never = new Promise<StudioAsset>(() => undefined);
    const getStatus = vi.fn()
      .mockResolvedValueOnce(readyT3)
      .mockReturnValueOnce(never);
    const onAssetChange = vi.fn();
    const getDownload = vi.fn(async () => ({ url: "https://private.example/audio", expiresInSeconds: 600 }));
    const pollDelays = [0] as const;
    const view = render(
      <StudioAssetProcessingStatus
        asset={pendingT1}
        getStatus={getStatus}
        retry={vi.fn()}
        getDownload={getDownload}
        pollDelays={pollDelays}
        onAssetChange={onAssetChange}
        onInsertTranscript={() => true}
      />
    );

    expect(await screen.findByText("Versão mais recente.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar transcrição ao documento" })).toBeInTheDocument();
    expect(onAssetChange).toHaveBeenCalledTimes(1);
    expect(onAssetChange).toHaveBeenCalledWith(readyT3);

    view.rerender(
      <StudioAssetProcessingStatus
        asset={processingT2}
        getStatus={getStatus}
        retry={vi.fn()}
        getDownload={getDownload}
        pollDelays={pollDelays}
        onAssetChange={onAssetChange}
        onInsertTranscript={() => true}
      />
    );

    expect(screen.getByText("Versão mais recente.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar transcrição ao documento" })).toBeInTheDocument();
    expect(onAssetChange).toHaveBeenCalledTimes(1);
  });

  it("propagates the fresh asset returned by an explicit processing retry", async () => {
    const failed = asset({
      extractionStatus: "failed",
      updatedAt: "2026-07-13T12:01:00.000Z"
    });
    const ready = asset({
      extractionStatus: "ready",
      extractedText: "Recuperado.",
      updatedAt: "2026-07-13T12:02:00.000Z"
    });
    const onAssetChange = vi.fn();
    render(
      <StudioAssetProcessingStatus
        asset={failed}
        getStatus={vi.fn()}
        retry={vi.fn(async () => ready)}
        getDownload={vi.fn(async () => ({ url: "https://private.example/audio", expiresInSeconds: 600 }))}
        onAssetChange={onAssetChange}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Tentar transcrição novamente" }));

    expect(await screen.findByText("Recuperado.")).toBeInTheDocument();
    expect(onAssetChange).toHaveBeenCalledTimes(1);
    expect(onAssetChange).toHaveBeenCalledWith(ready);
  });

  it("uses the latest asset change callback when an in-flight poll resolves", async () => {
    const request = deferred<StudioAsset>();
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    const pending = asset({ updatedAt: "2026-07-13T12:01:00.000Z" });
    const ready = asset({
      extractionStatus: "ready",
      extractedText: "Atualizado.",
      updatedAt: "2026-07-13T12:02:00.000Z"
    });
    const getStatus = vi.fn(() => request.promise);
    const getDownload = vi.fn(async () => ({ url: "https://private.example/audio", expiresInSeconds: 600 }));
    const pollDelays = [0] as const;
    const view = render(
      <StudioAssetProcessingStatus
        asset={pending}
        getStatus={getStatus}
        getDownload={getDownload}
        pollDelays={pollDelays}
        onAssetChange={firstCallback}
      />
    );
    await waitFor(() => expect(getStatus).toHaveBeenCalledOnce());

    view.rerender(
      <StudioAssetProcessingStatus
        asset={pending}
        getStatus={getStatus}
        getDownload={getDownload}
        pollDelays={pollDelays}
        onAssetChange={latestCallback}
      />
    );
    await act(async () => request.resolve(ready));

    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledWith(ready);
  });

  it("offers transcript insertion only for ready audio with non-empty text and a callback", () => {
    const onInsertTranscript = vi.fn(() => true);
    const getDownload = vi.fn(() => new Promise<{ url: string; expiresInSeconds: number }>(() => undefined));
    const view = render(
      <StudioAssetProcessingStatus
        asset={asset({ extractionStatus: "ready", extractedText: "  Original preservado.  " })}
        onInsertTranscript={onInsertTranscript}
        getDownload={getDownload}
      />
    );
    expect(screen.getByRole("button", { name: "Adicionar transcrição ao documento" })).toBeInTheDocument();

    for (const [index, hiddenAsset] of [
      asset({ extractionStatus: "pending", extractedText: "Texto" }),
      asset({ extractionStatus: "processing", extractedText: "Texto" }),
      asset({ extractionStatus: "failed", extractedText: "Texto" }),
      asset({ kind: "file", extractionStatus: "ready", extractedText: "Texto" }),
      asset({ extractionStatus: "ready", extractedText: "  \n " })
    ].entries()) {
      view.rerender(
        <StudioAssetProcessingStatus
          asset={{ ...hiddenAsset, updatedAt: `2026-07-13T12:0${index + 1}:00.000Z` }}
          onInsertTranscript={onInsertTranscript}
          getDownload={getDownload}
        />
      );
      expect(screen.queryByRole("button", { name: "Adicionar transcrição ao documento" })).not.toBeInTheDocument();
    }

    view.rerender(
      <StudioAssetProcessingStatus
        asset={asset({ extractionStatus: "ready", extractedText: "Texto" })}
        getDownload={getDownload}
      />
    );
    expect(screen.queryByRole("button", { name: "Adicionar transcrição ao documento" })).not.toBeInTheDocument();
  });

  it.each([
    ["audio", "Transcrição"],
    ["file", "Conteúdo extraído"],
    ["image", "Conteúdo extraído"],
    ["link_snapshot", "Conteúdo extraído"]
  ] as const)("labels extracted %s content as %s", (kind, expectedLabel) => {
    render(
      <StudioAssetProcessingStatus
        asset={asset({ kind, extractionStatus: "ready", extractedText: "Texto preservado." })}
        getDownload={vi.fn(() => new Promise<{ url: string; expiresInSeconds: number }>(() => undefined))}
      />
    );

    expect(screen.getByText(expectedLabel, { selector: "strong" })).toBeInTheDocument();
  });

  it("preserves the original transcript, suppresses concurrent activation, and permits explicit repetition", async () => {
    const insertion = deferred<boolean>();
    const original = "  Linha original\nsem mutação.  ";
    const onInsertTranscript = vi.fn(() => insertion.promise);
    render(
      <StudioAssetProcessingStatus
        asset={asset({ extractionStatus: "ready", extractedText: original })}
        onInsertTranscript={onInsertTranscript}
        getDownload={vi.fn(() => new Promise<{ url: string; expiresInSeconds: number }>(() => undefined))}
      />
    );
    const button = screen.getByRole("button", { name: "Adicionar transcrição ao documento" });

    await userEvent.click(button);
    button.click();
    expect(onInsertTranscript).toHaveBeenCalledTimes(1);
    expect(onInsertTranscript).toHaveBeenCalledWith(original);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Adicionando…");

    insertion.resolve(true);
    expect(await screen.findByText("Transcrição adicionada ao documento")).toBeInTheDocument();
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onInsertTranscript).toHaveBeenCalledTimes(2);
    expect(screen.getByText((_content, element) => element?.tagName === "P" && element.textContent === original))
      .toBeInTheDocument();
  });

  it.each(["false", "rejection"])("keeps insertion retryable after a quiet %s result", async (result) => {
    const onInsertTranscript = vi.fn<(text: string) => boolean | Promise<boolean>>();
    if (result === "false") onInsertTranscript.mockReturnValueOnce(false);
    else onInsertTranscript.mockRejectedValueOnce(new Error("editor unavailable"));
    onInsertTranscript.mockReturnValueOnce(true);
    render(
      <StudioAssetProcessingStatus
        asset={asset({ extractionStatus: "ready", extractedText: "Tentar novamente." })}
        onInsertTranscript={onInsertTranscript}
        getDownload={vi.fn(() => new Promise<{ url: string; expiresInSeconds: number }>(() => undefined))}
      />
    );

    const button = screen.getByRole("button", { name: "Adicionar transcrição ao documento" });
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByText("Transcrição adicionada ao documento")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A transcrição não foi adicionada. Você pode tentar novamente."
    );

    await userEvent.click(button);
    expect(await screen.findByText("Transcrição adicionada ao documento")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onInsertTranscript).toHaveBeenCalledTimes(2);
  });

  it("releases a new asset while the previous transcript promise is pending and ignores its late result", async () => {
    const oldInsertion = deferred<boolean>();
    const insertA = vi.fn(() => oldInsertion.promise);
    const insertB = vi.fn(() => true);
    const getDownload = vi.fn(() => new Promise<{ url: string; expiresInSeconds: number }>(() => undefined));
    const view = render(
      <StudioAssetProcessingStatus
        asset={asset({ id: "asset_a", extractedText: "Transcrição A", extractionStatus: "ready" })}
        onInsertTranscript={insertA}
        getDownload={getDownload}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Adicionar transcrição ao documento" }));
    expect(screen.getByRole("button", { name: "Adicionando…" })).toBeDisabled();

    view.rerender(
      <StudioAssetProcessingStatus
        asset={asset({ id: "asset_b", extractedText: "Transcrição B", extractionStatus: "ready" })}
        onInsertTranscript={insertB}
        getDownload={getDownload}
      />
    );
    const buttonB = screen.getByRole("button", { name: "Adicionar transcrição ao documento" });
    expect(buttonB).toBeEnabled();
    await userEvent.click(buttonB);
    expect(insertB).toHaveBeenCalledWith("Transcrição B");
    expect(await screen.findByText("Transcrição adicionada ao documento")).toBeInTheDocument();

    oldInsertion.resolve(false);
    await act(async () => { await oldInsertion.promise; });
    expect(screen.getByText("Transcrição adicionada ao documento")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets pending insertion when processing status or transcript text changes", async () => {
    const oldInsertion = deferred<boolean>();
    const onInsertTranscript = vi.fn((text: string) => (
      text === "Transcrição antiga" ? oldInsertion.promise : true
    ));
    const getDownload = vi.fn(() => new Promise<{ url: string; expiresInSeconds: number }>(() => undefined));
    const view = render(
      <StudioAssetProcessingStatus
        asset={asset({
          extractionStatus: "ready",
          extractedText: "Transcrição antiga",
          updatedAt: "2026-07-13T12:01:00.000Z"
        })}
        onInsertTranscript={onInsertTranscript}
        getDownload={getDownload}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Adicionar transcrição ao documento" }));

    view.rerender(
      <StudioAssetProcessingStatus
        asset={asset({
          extractionStatus: "processing",
          extractedText: "Transcrição antiga",
          updatedAt: "2026-07-13T12:02:00.000Z"
        })}
        onInsertTranscript={onInsertTranscript}
        getDownload={getDownload}
      />
    );
    expect(screen.queryByRole("button", { name: "Adicionar transcrição ao documento" })).not.toBeInTheDocument();

    view.rerender(
      <StudioAssetProcessingStatus
        asset={asset({
          extractionStatus: "ready",
          extractedText: "Transcrição nova",
          updatedAt: "2026-07-13T12:03:00.000Z"
        })}
        onInsertTranscript={onInsertTranscript}
        getDownload={getDownload}
      />
    );
    const retry = screen.getByRole("button", { name: "Adicionar transcrição ao documento" });
    expect(retry).toBeEnabled();
    await userEvent.click(retry);
    expect(onInsertTranscript).toHaveBeenLastCalledWith("Transcrição nova");
    expect(await screen.findByText("Transcrição adicionada ao documento")).toBeInTheDocument();

    oldInsertion.resolve(false);
    await act(async () => { await oldInsertion.promise; });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets insertion feedback when only the callback changes and uses the newest callback", async () => {
    const firstCallback = vi.fn(() => true);
    const nextCallback = vi.fn(() => true);
    const ready = asset({ extractionStatus: "ready", extractedText: "Mesmo texto" });
    const getDownload = vi.fn(() => new Promise<{ url: string; expiresInSeconds: number }>(() => undefined));
    const view = render(
      <StudioAssetProcessingStatus asset={ready} onInsertTranscript={firstCallback} getDownload={getDownload} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Adicionar transcrição ao documento" }));
    expect(await screen.findByText("Transcrição adicionada ao documento")).toBeInTheDocument();

    view.rerender(
      <StudioAssetProcessingStatus asset={ready} onInsertTranscript={nextCallback} getDownload={getDownload} />
    );
    expect(screen.queryByText("Transcrição adicionada ao documento")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Adicionar transcrição ao documento" }));
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(nextCallback).toHaveBeenCalledWith("Mesmo texto");
  });

  it("keeps insertion feedback outside the processing live region", async () => {
    render(
      <StudioAssetProcessingStatus
        asset={asset({ extractionStatus: "ready", extractedText: "Texto" })}
        onInsertTranscript={() => true}
        getDownload={vi.fn(() => new Promise<{ url: string; expiresInSeconds: number }>(() => undefined))}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Adicionar transcrição ao documento" }));

    const feedback = await screen.findByText("Transcrição adicionada ao documento");
    expect(feedback).toHaveAttribute("role", "status");
    expect(feedback.parentElement?.closest("[role='status']")).toBeNull();
  });
});

function asset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: "asset_1",
    workspaceId: "workspace_1",
    ownerProfileId: "owner_1",
    documentId: "document_1",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    kind: "audio",
    displayName: "reflexao.wav",
    sourceUrl: null,
    finalUrl: null,
    mimeType: "audio/wav",
    sizeBytes: 52,
    extractionStatus: "pending",
    extractedText: null,
    lastErrorCode: null,
    attemptCount: 0,
    nextAttemptAt: null,
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
