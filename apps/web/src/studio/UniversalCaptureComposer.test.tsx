import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StudioAsset, StudioDocument } from "./studio.types";
import UniversalCaptureComposer from "./UniversalCaptureComposer";

const capturedDocument: StudioDocument = {
  id: "document_1",
  workspaceId: "workspace_1",
  ownerProfileId: "owner_1",
  title: null,
  bodyJson: { type: "doc" },
  bodyText: "Uma ideia que precisa amadurecer",
  revision: 1,
  captureMode: "text",
  inboxState: "pending_review",
  isFocused: false,
  status: "active",
  createdAt: "2026-07-13T12:00:00.000Z",
  updatedAt: "2026-07-13T12:00:00.000Z",
  archivedAt: null
};

describe("UniversalCaptureComposer", () => {
  it("creates a text capture once and opens the returned document", async () => {
    const user = userEvent.setup();
    const createDocument = vi.fn(async () => capturedDocument);
    const onCaptured = vi.fn();
    render(<UniversalCaptureComposer createDocument={createDocument} onCaptured={onCaptured} />);

    await user.type(screen.getByRole("textbox", { name: "Registre um pensamento" }), "Uma ideia que precisa amadurecer");
    const submit = screen.getByRole("button", { name: "Guardar" });
    await Promise.all([user.click(submit), user.click(submit)]);

    await waitFor(() => expect(createDocument).toHaveBeenCalledTimes(1));
    expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({
      body_text: "Uma ideia que precisa amadurecer",
      capture_mode: "text"
    }), expect.any(AbortSignal));
    expect(onCaptured).toHaveBeenCalledWith(capturedDocument, expect.objectContaining({ processing: "none" }));
  });

  it("offers native keyboard access to audio, file, image, and link capture", async () => {
    const user = userEvent.setup();
    render(<UniversalCaptureComposer createDocument={vi.fn()} onCaptured={vi.fn()} />);

    const audio = screen.getByRole("button", { name: "Gravar áudio" });
    const file = screen.getByRole("button", { name: "Adicionar arquivo" });
    const image = screen.getByRole("button", { name: "Adicionar imagem" });
    const link = screen.getByRole("button", { name: "Adicionar link" });

    expect(audio).toHaveAttribute("type", "button");
    expect(file).toHaveAttribute("type", "button");
    expect(image).toHaveAttribute("type", "button");
    expect(link).toHaveAttribute("type", "button");

    await user.tab();
    expect(screen.getByRole("textbox", { name: "Registre um pensamento" })).toHaveFocus();
    await user.tab();
    expect(audio).toHaveFocus();
    await user.tab();
    expect(file).toHaveFocus();
    await user.tab();
    expect(image).toHaveFocus();
    await user.tab();
    expect(link).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "Endereço do link" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(link).toHaveFocus();
  });

  it("separates a failed audio upload from later transcription and retries the same document", async () => {
    const audioDocument = { ...capturedDocument, id: "audio_1", bodyText: "", captureMode: "audio" as const };
    const createDocument = vi.fn(async () => audioDocument);
    const pendingAsset = asset({ extractionStatus: "pending" });
    const attachAsset = vi.fn()
      .mockRejectedValueOnce(new Error("upload unavailable"))
      .mockResolvedValueOnce(pendingAsset);
    const onCaptured = vi.fn();
    const file = new File(["audio"], "reflexao.webm", { type: "audio/webm" });

    render(
      <UniversalCaptureComposer
        createDocument={createDocument}
        attachAsset={attachAsset}
        onCaptured={onCaptured}
      />
    );

    await userEvent.upload(screen.getByTestId("studio-audio-input"), file);

    await waitFor(() => expect(attachAsset).toHaveBeenCalledTimes(1));
    expect(onCaptured).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("documento foi criado, mas o áudio não foi enviado");

    await userEvent.click(screen.getByRole("button", { name: "Tentar enviar áudio novamente" }));

    await waitFor(() => expect(attachAsset).toHaveBeenCalledTimes(2));
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(attachAsset.mock.calls[1]?.[0]).toBe(audioDocument.id);
    expect(attachAsset.mock.calls[0]?.[3]).toBe(attachAsset.mock.calls[1]?.[3]);
    expect(attachAsset.mock.calls[0]?.[3]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(onCaptured).toHaveBeenCalledWith(audioDocument, expect.objectContaining({
      asset: pendingAsset,
      processing: "pending"
    }));
  });

  it("lets an attachment already started for a persisted document finish after unmount", async () => {
    const audioDocument = { ...capturedDocument, id: "audio_detached", bodyText: "", captureMode: "audio" as const };
    let resolveAttachment!: (asset: StudioAsset) => void;
    let attachmentSignal: AbortSignal | undefined;
    const attachAsset = vi.fn((_documentId, _file, _filename, _key, signal?: AbortSignal) => {
      attachmentSignal = signal;
      return new Promise<StudioAsset>((resolve) => { resolveAttachment = resolve; });
    });
    const onCaptured = vi.fn();
    const view = render(
      <UniversalCaptureComposer
        createDocument={vi.fn(async () => audioDocument)}
        attachAsset={attachAsset}
        onCaptured={onCaptured}
      />
    );

    await userEvent.upload(
      screen.getByTestId("studio-audio-input"),
      new File(["audio"], "reflexao.webm", { type: "audio/webm" })
    );
    await waitFor(() => expect(attachAsset).toHaveBeenCalledTimes(1));
    view.unmount();

    expect(attachmentSignal?.aborted).not.toBe(true);
    resolveAttachment(asset({ id: "asset_detached", documentId: audioDocument.id }));
    await Promise.resolve();
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it("acquires the microphone once and closes an obsolete stream after unmount", async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const stop = vi.fn();
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { resolveStream = resolve; }));
    const originalMediaRecorder = globalThis.MediaRecorder;
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: class {
        state = "inactive";
        mimeType = "audio/webm";
        addEventListener() {}
        start() {}
        stop() {}
      }
    });
    try {
      const view = render(<UniversalCaptureComposer createDocument={vi.fn()} onCaptured={vi.fn()} />);
      const trigger = screen.getByRole("button", { name: "Gravar áudio" });
      fireEvent.click(trigger);
      fireEvent.click(trigger);
      expect(getUserMedia).toHaveBeenCalledTimes(1);

      view.unmount();
      resolveStream({ getTracks: () => [{ stop }] } as unknown as MediaStream);
      await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
      Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: originalMediaRecorder });
    }
  });

  it("cancels an in-flight capture when its surface closes", async () => {
    const user = userEvent.setup();
    let receivedSignal: AbortSignal | undefined;
    const createDocument = vi.fn((_input, signal?: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<StudioDocument>(() => undefined);
    });
    const view = render(<UniversalCaptureComposer createDocument={createDocument} onCaptured={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Registre um pensamento" }), "Guardar antes de sair");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(receivedSignal?.aborted).toBe(false);

    view.unmount();
    expect(receivedSignal?.aborted).toBe(true);
  });
});

function asset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: "asset_1",
    workspaceId: "workspace_1",
    ownerProfileId: "owner_1",
    documentId: "audio_1",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    kind: "audio",
    displayName: "reflexao.webm",
    sourceUrl: null,
    finalUrl: null,
    mimeType: "audio/webm",
    sizeBytes: 5,
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
