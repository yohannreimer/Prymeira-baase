import { useEffect, useRef, useState, type ChangeEvent } from "react";

export type StudioRecordedAudio = { blob: Blob; filename: string };

export type StudioAudioRecorderProps = {
  disabled?: boolean;
  variant?: "icon" | "label";
  inputTestId?: string;
  onCaptured(audio: StudioRecordedAudio): void;
  onStatus(message: string): void;
  onActiveChange?(active: boolean): void;
};

type RecordingSession = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  terminal: boolean;
};

export default function StudioAudioRecorder({
  disabled = false,
  variant = "icon",
  inputTestId,
  onCaptured,
  onStatus,
  onActiveChange
}: StudioAudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recordingSessionRef = useRef<RecordingSession | null>(null);
  const acquiringMicrophoneRef = useRef(false);
  const activeRef = useRef(false);
  const mountedRef = useRef(true);
  const onCapturedRef = useRef(onCaptured);
  const onStatusRef = useRef(onStatus);
  const onActiveChangeRef = useRef(onActiveChange);
  onCapturedRef.current = onCaptured;
  onStatusRef.current = onStatus;
  onActiveChangeRef.current = onActiveChange;

  function updateActive(active: boolean) {
    if (activeRef.current === active) return;
    activeRef.current = active;
    if (mountedRef.current) onActiveChangeRef.current?.(active);
  }

  function releaseRecording(session: RecordingSession) {
    if (session.terminal) return;
    session.terminal = true;
    session.stream.getTracks().forEach((track) => track.stop());
    if (recordingSessionRef.current === session) {
      recordingSessionRef.current = null;
      if (mountedRef.current) setRecording(false);
    }
    updateActive(false);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = recordingSessionRef.current;
      if (session && !session.terminal) {
        try {
          if (session.recorder.state === "recording") session.recorder.stop();
        } finally {
          releaseRecording(session);
        }
      }
      recordingSessionRef.current = null;
    };
  }, []);

  async function toggleRecording() {
    const currentSession = recordingSessionRef.current;
    if (currentSession && !currentSession.terminal) {
      if (currentSession.recorder.state === "recording") {
        currentSession.recorder.stop();
      }
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      inputRef.current?.click();
      return;
    }
    if (acquiringMicrophoneRef.current) return;
    acquiringMicrophoneRef.current = true;
    updateActive(true);
    let grantedStream: MediaStream | null = null;
    let setupSession: RecordingSession | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      grantedStream = stream;
      acquiringMicrophoneRef.current = false;
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        grantedStream = null;
        updateActive(false);
        return;
      }

      const recorder = new MediaRecorder(stream);
      const session: RecordingSession = { recorder, stream, chunks: [], terminal: false };
      setupSession = session;
      recordingSessionRef.current = session;
      grantedStream = null;

      recorder.addEventListener("dataavailable", (event) => {
        if (!session.terminal && event.data.size) session.chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        if (session.terminal) return;
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(session.chunks, { type });
        releaseRecording(session);
        if (!mountedRef.current) return;
        if (!blob.size) {
          onStatusRef.current("Não foi possível registrar áudio desta vez.");
          return;
        }
        const extension = type.includes("mp4") ? "m4a" : "webm";
        onCapturedRef.current({
          blob,
          filename: `registro-${new Date().toISOString().replaceAll(":", "-")}.${extension}`
        });
      }, { once: true });
      recorder.addEventListener("error", () => {
        if (session.terminal) return;
        releaseRecording(session);
        if (mountedRef.current) onStatusRef.current("Não foi possível registrar áudio desta vez.");
      }, { once: true });

      recorder.start();
      if (session.terminal) return;
      setRecording(true);
      onStatusRef.current("Gravação em andamento. Seu áudio só será enviado quando você parar.");
    } catch {
      acquiringMicrophoneRef.current = false;
      if (setupSession) releaseRecording(setupSession);
      else grantedStream?.getTracks().forEach((track) => track.stop());
      updateActive(false);
      if (mountedRef.current) {
        onStatusRef.current("Não foi possível acessar o microfone. Você pode adicionar um áudio já gravado.");
        inputRef.current?.click();
      }
    }
  }

  function captureSelectedFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onCaptured({ blob: file, filename: file.name });
  }

  const accessibleName = recording ? "Parar gravação" : "Gravar áudio";

  return (
    <>
      <button
        type="button"
        aria-label={accessibleName}
        aria-pressed={recording}
        onClick={() => void toggleRecording()}
        disabled={disabled}
      >
        <i aria-hidden="true" className={`ph-light ${recording ? "ph-stop-circle" : "ph-microphone"}`} />
        {variant === "label" ? <span>{accessibleName}</span> : null}
      </button>
      <input
        hidden
        tabIndex={-1}
        data-testid={inputTestId}
        ref={inputRef}
        type="file"
        accept="audio/*"
        onChange={captureSelectedFile}
      />
    </>
  );
}
