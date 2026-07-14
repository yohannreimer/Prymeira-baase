import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StudioAsset } from "./studio.types";
import StudioAssetProcessingStatus from "./StudioAssetProcessingStatus";

describe("StudioAssetProcessingStatus", () => {
  it("follows a preserved audio asset through failure, real retry, and transcription", async () => {
    const pending = asset({ extractionStatus: "pending" });
    const failed = asset({
      extractionStatus: "failed",
      attemptCount: 1,
      lastErrorCode: "STUDIO_ASSET_PROCESSING_FAILED",
      nextAttemptAt: null
    });
    const ready = asset({
      extractionStatus: "ready",
      extractedText: "Escolher uma direção com calma.",
      attemptCount: 1
    });
    const getStatus = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(ready);
    const retry = vi.fn(async () => pending);
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
