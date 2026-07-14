import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StudioAsset, StudioDocument } from "./studio.types";
import UniversalCaptureComposer from "./UniversalCaptureComposer";

const capturedDocument: StudioDocument = {
  id: "document_1",
  workspaceId: "workspace_1",
  ownerProfileId: "owner_1",
  captureKey: "01010101-0101-4101-8101-010101010101",
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

  it("reuses one document key after a committed response is lost", async () => {
    const createDocument = vi.fn()
      .mockRejectedValueOnce(new Error("response lost after commit"))
      .mockResolvedValueOnce(capturedDocument);
    const onCaptured = vi.fn();
    render(<UniversalCaptureComposer createDocument={createDocument} onCaptured={onCaptured} />);

    await userEvent.type(
      screen.getByRole("textbox", { name: "Registre um pensamento" }),
      "Uma captura persistida"
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Tentar guardar novamente" }));

    await waitFor(() => expect(createDocument).toHaveBeenCalledTimes(2));
    const firstKey = createDocument.mock.calls[0]?.[0].capture_key;
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/u);
    expect(createDocument.mock.calls[1]?.[0].capture_key).toBe(firstKey);
    expect(onCaptured).toHaveBeenCalledTimes(1);
  });

  it("keeps document and asset keys stable and distinct across an attachment create retry", async () => {
    const fileDocument = { ...capturedDocument, id: "file_1", captureMode: "file" as const };
    const createDocument = vi.fn()
      .mockRejectedValueOnce(new Error("response lost after commit"))
      .mockResolvedValueOnce(fileDocument);
    const attachAsset = vi.fn(async (
      _documentId: string,
      _file: Blob,
      _filename: string,
      _idempotencyKey: string,
      _signal?: AbortSignal
    ) => asset({ documentId: fileDocument.id, kind: "file" }));
    render(
      <UniversalCaptureComposer
        createDocument={createDocument}
        attachAsset={attachAsset}
        onCaptured={vi.fn()}
      />
    );

    const fileInput = document.querySelector('input[type="file"]:not([accept])') as HTMLInputElement;
    await userEvent.upload(fileInput, new File(["plano"], "plano.txt", { type: "text/plain" }));
    await userEvent.click(await screen.findByRole("button", { name: "Tentar guardar novamente" }));

    await waitFor(() => expect(attachAsset).toHaveBeenCalledTimes(1));
    const firstDocumentKey = createDocument.mock.calls[0]?.[0].capture_key;
    expect(createDocument.mock.calls[1]?.[0].capture_key).toBe(firstDocumentKey);
    const assetKey = attachAsset.mock.calls[0]?.[3];
    expect(assetKey).toMatch(/^[0-9a-f-]{36}$/u);
    expect(assetKey).not.toBe(firstDocumentKey);
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

  it("does not reacquire or stop twice while an inactive recorder is waiting for its delayed stop event", async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    const recorders: TestMediaRecorder[] = [];
    const originalMediaRecorder = globalThis.MediaRecorder;
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: class extends TestMediaRecorder {
        constructor(input: MediaStream) {
          super(input);
          recorders.push(this);
        }
      }
    });
    try {
      render(<UniversalCaptureComposer createDocument={vi.fn()} onCaptured={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
      const stopButton = await screen.findByRole("button", { name: "Parar gravação" });

      fireEvent.click(stopButton);
      fireEvent.click(stopButton);

      expect(recorders).toHaveLength(1);
      expect(recorders[0]!.stopCalls).toBe(1);
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      await act(async () => recorders[0]!.emit("stop"));
      expect(await screen.findByRole("button", { name: "Gravar áudio" })).toBeInTheDocument();
      expect(stopTrack).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
      Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: originalMediaRecorder });
    }
  });

  it("ignores a MediaRecorder error delivered after unmount", async () => {
    const stopTrack = vi.fn();
    const recorders: TestMediaRecorder[] = [];
    const originalMediaRecorder = globalThis.MediaRecorder;
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) }
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: class extends TestMediaRecorder {
        constructor(input: MediaStream) {
          super(input);
          recorders.push(this);
        }
      }
    });
    try {
      const view = render(<UniversalCaptureComposer createDocument={vi.fn()} onCaptured={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
      await screen.findByRole("button", { name: "Parar gravação" });

      view.unmount();
      expect(stopTrack).toHaveBeenCalledTimes(1);
      await act(async () => recorders[0]!.emit("error"));
      expect(stopTrack).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
      Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: originalMediaRecorder });
    }
  });

  it("waits for the failed recorder terminal stop before acquiring a new session", async () => {
    const firstTrackStop = vi.fn();
    const secondTrackStop = vi.fn();
    const streams = [
      { getTracks: () => [{ stop: firstTrackStop }] },
      { getTracks: () => [{ stop: secondTrackStop }] }
    ] as unknown as MediaStream[];
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(streams[0])
      .mockResolvedValueOnce(streams[1]);
    const recorders: TestMediaRecorder[] = [];
    const createDocument = vi.fn(async () => capturedDocument);
    const attachAsset = vi.fn(async () => asset());
    const originalMediaRecorder = globalThis.MediaRecorder;
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: class extends TestMediaRecorder {
        constructor(input: MediaStream) {
          super(input);
          recorders.push(this);
        }
      }
    });
    try {
      render(
        <UniversalCaptureComposer
          createDocument={createDocument}
          attachAsset={attachAsset}
          onCaptured={vi.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
      await screen.findByRole("button", { name: "Parar gravação" });

      await act(async () => recorders[0]!.emit("error"));
      expect(screen.getByRole("button", { name: "Gravar áudio" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(firstTrackStop).not.toHaveBeenCalled();

      await act(async () => recorders[0]!.emit("stop"));
      expect(firstTrackStop).toHaveBeenCalledTimes(1);
      expect(createDocument).not.toHaveBeenCalled();
      expect(attachAsset).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
      expect(recorders).toHaveLength(2);
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

class TestMediaRecorder {
  state: RecordingState = "inactive";
  mimeType = "audio/webm";
  stopCalls = 0;
  private listeners = new Map<string, (event: { data: Blob }) => void>();

  constructor(_stream: MediaStream) {}

  addEventListener(type: string, listener: (event: { data: Blob }) => void) {
    this.listeners.set(type, listener);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    if (this.state !== "recording") throw new DOMException("Recorder is inactive", "InvalidStateError");
    this.stopCalls += 1;
    this.state = "inactive";
  }

  emit(type: "stop" | "error") {
    if (type === "error") this.state = "inactive";
    this.listeners.get(type)?.({ data: new Blob() });
  }
}

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
