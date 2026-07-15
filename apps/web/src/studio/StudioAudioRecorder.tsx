import { useEffect, useRef, useState, type ChangeEvent } from "react";

export type StudioRecordedAudio = { blob: Blob; filename: string };

export type StudioAudioRecorderProps = {
  disabled?: boolean;
  variant?: "icon" | "label";
  inputTestId?: string;
  onCaptured(audio: StudioRecordedAudio): void;
  onStatus(message: string): void;
};

type RecordingSession = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  failed: boolean;
  terminal: boolean;
};

export default function StudioAudioRecorder({
  disabled = false,
  variant = "icon",
  inputTestId,
  onCaptured,
  onStatus
}: StudioAudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recordingSessionRef = useRef<RecordingSession | null>(null);
  const acquiringMicrophoneRef = useRef(false);
  const mountedRef = useRef(true);

  function releaseRecording(session: RecordingSession) {
    if (session.terminal) return;
    session.terminal = true;
    session.stream.getTracks().forEach((track) => track.stop());
    if (recordingSessionRef.current === session) {
      recordingSessionRef.current = null;
      if (mountedRef.current) setRecording(false);
    }
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
      if (!currentSession.failed && currentSession.recorder.state === "recording") {
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
    let grantedStream: MediaStream | null = null;
    let setupSession: RecordingSession | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      grantedStream = stream;
      acquiringMicrophoneRef.current = false;
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        grantedStream = null;
        return;
      }

      const recorder = new MediaRecorder(stream);
      const session: RecordingSession = { recorder, stream, chunks: [], failed: false, terminal: false };
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
        const failed = session.failed;
        releaseRecording(session);
        if (!mountedRef.current || failed) return;
        if (!blob.size) {
          onStatus("Não foi possível registrar áudio desta vez.");
          return;
        }
        const extension = type.includes("mp4") ? "m4a" : "webm";
        onCaptured({
          blob,
          filename: `registro-${new Date().toISOString().replaceAll(":", "-")}.${extension}`
        });
      }, { once: true });
      recorder.addEventListener("error", () => {
        if (session.terminal) return;
        session.failed = true;
        if (recordingSessionRef.current === session && mountedRef.current) {
          setRecording(false);
          onStatus("Não foi possível registrar áudio desta vez.");
        }
      }, { once: true });

      recorder.start();
      setRecording(true);
      onStatus("Gravação em andamento. Seu áudio só será enviado quando você parar.");
    } catch {
      acquiringMicrophoneRef.current = false;
      if (setupSession) releaseRecording(setupSession);
      else grantedStream?.getTracks().forEach((track) => track.stop());
      if (mountedRef.current) {
        onStatus("Não foi possível acessar o microfone. Você pode adicionar um áudio já gravado.");
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
