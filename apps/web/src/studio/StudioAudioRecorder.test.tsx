import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudioAudioRecorder from "./StudioAudioRecorder";

const originalMediaRecorder = globalThis.MediaRecorder;
const originalMediaDevices = navigator.mediaDevices;

afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: originalMediaRecorder });
});

describe("StudioAudioRecorder", () => {
  it("changes the accessible control to a pressed stop button while recording", async () => {
    const { recorders } = installRecorder();
    renderRecorder();

    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));

    const stop = await screen.findByRole("button", { name: "Parar gravação" });
    expect(stop).toHaveAttribute("aria-pressed", "true");
    expect(recorders).toHaveLength(1);
  });

  it("shows its accessible name as text only in the label variant", () => {
    const icon = render(
      <StudioAudioRecorder variant="icon" onCaptured={vi.fn()} onStatus={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Gravar áudio" })).toHaveTextContent("");
    icon.unmount();

    renderRecorder();
    expect(screen.getByRole("button", { name: "Gravar áudio" })).toHaveTextContent("Gravar áudio");
  });

  it("emits the recorded blob and a timestamped webm filename after data and stop", async () => {
    const { recorders } = installRecorder();
    const onCaptured = vi.fn();
    renderRecorder({ onCaptured });

    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    const stop = await screen.findByRole("button", { name: "Parar gravação" });
    await act(async () => recorders[0]!.emit("dataavailable", new Blob(["audio"])));
    fireEvent.click(stop);
    await act(async () => recorders[0]!.emit("stop"));

    expect(onCaptured).toHaveBeenCalledTimes(1);
    const audio = onCaptured.mock.calls[0]![0];
    expect(audio.filename).toMatch(/^registro-\d{4}-\d{2}-\d{2}T.*\.webm$/u);
    expect(audio.blob).toBeInstanceOf(Blob);
    expect(audio.blob).toHaveProperty("size", 5);
    expect(audio.blob).toHaveProperty("type", "audio/webm");
  });

  it.each([
    ["audio/webm; codecs=opus", "webm"],
    ["audio/mp4", "m4a"],
    ["audio/x-m4a", "m4a"],
    ["audio/ogg", "ogg"],
    ["audio/wav", "wav"],
    ["audio/x-wav", "wav"],
    ["audio/mpeg", "mp3"],
    ["audio/mp3", "mp3"],
    ["audio/aac", "aac"],
    ["audio/unknown", "webm"]
  ])("maps recording MIME %s to .%s", async (mimeType, extension) => {
    const { recorders } = installRecorder();
    const onCaptured = vi.fn();
    renderRecorder({ onCaptured });

    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    const stop = await screen.findByRole("button", { name: "Parar gravação" });
    recorders[0]!.mimeType = mimeType;
    await act(async () => recorders[0]!.emit("dataavailable", new Blob(["audio"])));
    fireEvent.click(stop);
    await act(async () => recorders[0]!.emit("stop"));

    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(onCaptured.mock.calls[0]![0].filename).toMatch(new RegExp(`\\.${extension}$`, "u"));
  });

  it("opens the hidden audio input when MediaRecorder is unsupported", () => {
    Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: undefined });
    const onInputClick = vi.fn();
    renderRecorder();
    screen.getByTestId("audio-fallback").addEventListener("click", onInputClick);

    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));

    expect(onInputClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("audio-fallback")).toHaveAttribute("accept", "audio/*");
  });

  it("emits a selected audio file without changing it", async () => {
    const onCaptured = vi.fn();
    const file = new File(["selected audio"], "entrevista.m4a", { type: "audio/mp4" });
    renderRecorder({ onCaptured });

    await userEvent.upload(screen.getByTestId("audio-fallback"), file);

    expect(onCaptured).toHaveBeenCalledWith({ blob: file, filename: file.name });
    expect(onCaptured.mock.calls[0]![0].blob).toBe(file);
  });

  it("does not reacquire the microphone after stop is clicked twice", async () => {
    const { getUserMedia, recorders } = installRecorder();
    const onActiveChange = vi.fn();
    renderRecorder({ onActiveChange });
    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    const stop = await screen.findByRole("button", { name: "Parar gravação" });

    fireEvent.click(stop);
    fireEvent.click(stop);

    expect(recorders[0]!.stopCalls).toBe(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(onActiveChange).toHaveBeenCalledTimes(1);
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    await act(async () => recorders[0]!.emit("stop"));
    expect(onActiveChange.mock.calls).toEqual([[true], [false]]);
  });

  it("uses the latest capture and activity callbacks when a recording finishes", async () => {
    const { recorders } = installRecorder();
    const firstCaptured = vi.fn();
    const latestCaptured = vi.fn();
    const firstActiveChange = vi.fn();
    const latestActiveChange = vi.fn();
    const view = render(
      <StudioAudioRecorder
        onCaptured={firstCaptured}
        onStatus={vi.fn()}
        onActiveChange={firstActiveChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    const stop = await screen.findByRole("button", { name: "Parar gravação" });

    view.rerender(
      <StudioAudioRecorder
        onCaptured={latestCaptured}
        onStatus={vi.fn()}
        onActiveChange={latestActiveChange}
      />
    );
    await act(async () => recorders[0]!.emit("dataavailable", new Blob(["audio atualizado"])));
    fireEvent.click(stop);
    await act(async () => recorders[0]!.emit("stop"));

    expect(firstCaptured).not.toHaveBeenCalled();
    expect(latestCaptured).toHaveBeenCalledTimes(1);
    expect(firstActiveChange.mock.calls).toEqual([[true]]);
    expect(latestActiveChange.mock.calls).toEqual([[false]]);
  });

  it("uses the latest status callback for an asynchronous terminal result", async () => {
    const { recorders } = installRecorder();
    const firstStatus = vi.fn();
    const latestStatus = vi.fn();
    const view = render(
      <StudioAudioRecorder onCaptured={vi.fn()} onStatus={firstStatus} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    const stop = await screen.findByRole("button", { name: "Parar gravação" });
    view.rerender(
      <StudioAudioRecorder onCaptured={vi.fn()} onStatus={latestStatus} />
    );

    fireEvent.click(stop);
    await act(async () => recorders[0]!.emit("stop"));

    expect(firstStatus).toHaveBeenCalledTimes(1);
    expect(latestStatus).toHaveBeenCalledWith("Não foi possível registrar áudio desta vez.");
  });

  it("reports an empty recording instead of emitting it", async () => {
    const { recorders } = installRecorder();
    const onCaptured = vi.fn();
    const onStatus = vi.fn();
    renderRecorder({ onCaptured, onStatus });
    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    fireEvent.click(await screen.findByRole("button", { name: "Parar gravação" }));

    await act(async () => recorders[0]!.emit("stop"));

    expect(onCaptured).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith("Não foi possível registrar áudio desta vez.");
  });

  it("reports and opens the file fallback once when microphone permission is denied", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    installRecorder({ getUserMedia });
    const onStatus = vi.fn();
    const onActiveChange = vi.fn();
    renderRecorder({ onStatus, onActiveChange });
    const onInputClick = vi.fn();
    screen.getByTestId("audio-fallback").addEventListener("click", onInputClick);

    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));

    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(
      "Não foi possível acessar o microfone. Você pode adicionar um áudio já gravado."
    ));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(onInputClick).toHaveBeenCalledTimes(1);
    expect(onActiveChange.mock.calls).toEqual([[true], [false]]);
  });

  it("stops every recording track on unmount", async () => {
    const stopTrack = vi.fn();
    installRecorder({ stream: streamWith(stopTrack) });
    const view = renderRecorder();
    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    await screen.findByRole("button", { name: "Parar gravação" });

    view.unmount();

    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("ignores a terminal error delivered after unmount", async () => {
    const stopTrack = vi.fn();
    const { recorders } = installRecorder({ stream: streamWith(stopTrack) });
    const onCaptured = vi.fn();
    const view = renderRecorder({ onCaptured });
    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    await screen.findByRole("button", { name: "Parar gravação" });

    view.unmount();
    await act(async () => recorders[0]!.emit("error"));

    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it("releases a stream granted after unmount", async () => {
    let grant!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve; }));
    installRecorder({ getUserMedia });
    const stopTrack = vi.fn();
    const view = renderRecorder();
    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));

    view.unmount();
    grant(streamWith(stopTrack));

    await waitFor(() => expect(stopTrack).toHaveBeenCalledTimes(1));
  });

  it("releases the granted stream when MediaRecorder construction fails", async () => {
    const stopTrack = vi.fn();
    const getUserMedia = vi.fn(async () => streamWith(stopTrack));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: class {
        constructor() {
          throw new Error("construction failed");
        }
      }
    });
    const onCaptured = vi.fn();
    const onStatus = vi.fn();
    renderRecorder({ onCaptured, onStatus });

    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));

    await waitFor(() => expect(stopTrack).toHaveBeenCalledTimes(1));
    expect(onCaptured).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith(
      "Não foi possível acessar o microfone. Você pode adicionar um áudio já gravado."
    );
  });

  it("isolates start failure events and releases its stream before a retry", async () => {
    const firstStopTrack = vi.fn();
    const secondStopTrack = vi.fn();
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(streamWith(firstStopTrack))
      .mockResolvedValueOnce(streamWith(secondStopTrack));
    const recorders: TestMediaRecorder[] = [];
    let count = 0;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: class extends TestMediaRecorder {
        readonly failStart: boolean;
        constructor(stream: MediaStream) {
          super(stream);
          this.failStart = count++ === 0;
          recorders.push(this);
        }
        override start() {
          if (this.failStart) throw new Error("start failed");
          super.start();
        }
      }
    });
    const onCaptured = vi.fn();
    renderRecorder({ onCaptured });

    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    await waitFor(() => expect(firstStopTrack).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    await screen.findByRole("button", { name: "Parar gravação" });
    await act(async () => {
      recorders[0]!.emit("dataavailable", new Blob(["obsolete"]));
      recorders[0]!.emit("stop");
    });

    expect(onCaptured).not.toHaveBeenCalled();
    await act(async () => {
      recorders[1]!.emit("dataavailable", new Blob(["valid"]));
      recorders[1]!.emit("stop");
    });
    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(firstStopTrack).toHaveBeenCalledTimes(1);
    expect(secondStopTrack).toHaveBeenCalledTimes(1);
  });

  it("releases a terminal error immediately, permits retry, and ignores obsolete events", async () => {
    const firstStopTrack = vi.fn();
    const secondStopTrack = vi.fn();
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(streamWith(firstStopTrack))
      .mockResolvedValueOnce(streamWith(secondStopTrack));
    const { recorders } = installRecorder({ getUserMedia });
    const onCaptured = vi.fn();
    const onStatus = vi.fn();
    const onActiveChange = vi.fn();
    const view = renderRecorder({ onCaptured, onStatus, onActiveChange });
    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    await screen.findByRole("button", { name: "Parar gravação" });

    await act(async () => recorders[0]!.emit("error"));
    expect(onStatus).toHaveBeenLastCalledWith("Não foi possível registrar áudio desta vez.");
    expect(firstStopTrack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Gravar áudio" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    await act(async () => {
      recorders[0]!.emit("dataavailable", new Blob(["obsolete"]));
      recorders[0]!.emit("stop");
    });

    expect(firstStopTrack).toHaveBeenCalledTimes(1);
    expect(onCaptured).not.toHaveBeenCalled();
    await screen.findByRole("button", { name: "Parar gravação" });
    expect(onActiveChange.mock.calls).toEqual([[true], [false], [true]]);
    view.unmount();
    expect(secondStopTrack).toHaveBeenCalledTimes(1);
  });
});

type RecorderOverrides = {
  onCaptured?: ReturnType<typeof vi.fn>;
  onStatus?: ReturnType<typeof vi.fn>;
  onActiveChange?: ReturnType<typeof vi.fn>;
};

function renderRecorder(overrides: RecorderOverrides = {}) {
  return render(
    <StudioAudioRecorder
      variant="label"
      inputTestId="audio-fallback"
      onCaptured={overrides.onCaptured ?? vi.fn()}
      onStatus={overrides.onStatus ?? vi.fn()}
      onActiveChange={overrides.onActiveChange}
    />
  );
}

function installRecorder(options: { stream?: MediaStream; getUserMedia?: ReturnType<typeof vi.fn> } = {}) {
  const stream = options.stream ?? streamWith(vi.fn());
  const getUserMedia = options.getUserMedia ?? vi.fn(async () => stream);
  const recorders: TestMediaRecorder[] = [];
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
  return { getUserMedia, recorders, stream };
}

function streamWith(stop: ReturnType<typeof vi.fn>) {
  return { getTracks: () => [{ stop }] } as unknown as MediaStream;
}

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

  emit(type: "stop" | "error" | "dataavailable", data = new Blob()) {
    if (type === "error") this.state = "inactive";
    this.listeners.get(type)?.({ data });
  }
}
