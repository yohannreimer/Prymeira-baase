import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  attachStudioFile,
  attachStudioLink,
  createStudioDocument,
  type CreateStudioDocumentInput
} from "./studio-api";
import type { StudioAsset, StudioCaptureMode, StudioDocument } from "./studio.types";

export type StudioCaptureOutcome = {
  processing: "none" | "pending" | "retry";
  asset?: StudioAsset;
  message?: string;
};

type CreateDocument = (input: CreateStudioDocumentInput, signal?: AbortSignal) => Promise<StudioDocument>;
type AttachAsset = (documentId: string, file: Blob, filename: string, signal?: AbortSignal) => Promise<StudioAsset>;
type AttachLink = (documentId: string, url: string, signal?: AbortSignal) => Promise<StudioAsset>;

type UniversalCaptureComposerProps = {
  onCaptured(document: StudioDocument, outcome: StudioCaptureOutcome): void;
  createDocument?: CreateDocument;
  attachAsset?: AttachAsset;
  attachLink?: AttachLink;
};

function assetOutcome(asset: StudioAsset | undefined, mode: StudioCaptureMode): StudioCaptureOutcome {
  if (!asset) return { processing: "none" };
  if (asset.extractionStatus === "failed") {
    return {
      asset,
      processing: "retry",
      message: mode === "audio"
        ? "A captura foi guardada como áudio, mas a transcrição precisa ser tentada novamente."
        : "A captura foi guardada, mas o processamento precisa ser tentado novamente."
    };
  }
  if (asset.extractionStatus === "pending" || asset.extractionStatus === "processing") {
    return { asset, processing: "pending" };
  }
  return { asset, processing: "none" };
}

function editorBody(text: string) {
  return {
    type: "doc",
    version: 1,
    content: text
      ? [{ type: "paragraph", content: [{ type: "text", text }] }]
      : []
  };
}

function validPublicUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export default function UniversalCaptureComposer({
  onCaptured,
  createDocument: create = createStudioDocument,
  attachAsset = attachStudioFile,
  attachLink = attachStudioLink
}: UniversalCaptureComposerProps) {
  const [text, setText] = useState("");
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (linkMode) linkInputRef.current?.focus();
  }, [linkMode]);

  async function capture(input: {
    mode: StudioCaptureMode;
    bodyText: string;
    title?: string | null;
    file?: Blob;
    filename?: string;
    url?: string;
  }) {
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setMessage("Guardando sua captura…");
    const controller = new AbortController();
    controllerRef.current = controller;
    let document: StudioDocument | undefined;
    try {
      const captureMode = input.mode !== "text" && input.bodyText ? "mixed" : input.mode;
      document = await create({
        title: input.title ?? null,
        body_json: editorBody(input.bodyText),
        body_text: input.bodyText,
        capture_mode: captureMode
      }, controller.signal);

      let asset: StudioAsset | undefined;
      if (input.file && input.filename) {
        asset = await attachAsset(document.id, input.file, input.filename, controller.signal);
      } else if (input.url) {
        asset = await attachLink(document.id, input.url, controller.signal);
      }

      const outcome = assetOutcome(asset, input.mode);
      if (mountedRef.current) {
        setText("");
        setLink("");
        setLinkMode(false);
        setMessage(outcome.message ?? (outcome.processing === "pending"
          ? "Captura guardada. O conteúdo continua sendo preparado."
          : "Captura guardada."));
      }
      onCaptured(document, outcome);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (document) {
        const processingMessage = input.mode === "audio"
          ? "A captura foi guardada como áudio, mas a transcrição precisa ser tentada novamente."
          : "A captura foi guardada, mas o anexo precisa ser tentado novamente.";
        if (mountedRef.current) setMessage(processingMessage);
        onCaptured(document, { processing: "retry", message: processingMessage });
      } else {
        if (mountedRef.current) setMessage(error instanceof Error && error.message
          ? "Não foi possível guardar agora. Seu conteúdo continua aqui para tentar novamente."
          : "Não foi possível guardar agora.");
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      busyRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  function submitCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (linkMode) {
      const url = validPublicUrl(link.trim());
      if (!url) {
        setMessage("Use um endereço HTTP ou HTTPS válido, sem usuário ou senha.");
        linkInputRef.current?.focus();
        return;
      }
      void capture({ mode: "link", bodyText: text.trim(), title: null, url });
      return;
    }
    const bodyText = text.trim();
    if (!bodyText) return;
    void capture({ mode: "text", bodyText });
  }

  function captureSelectedFile(event: ChangeEvent<HTMLInputElement>, mode: "audio" | "file" | "image") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void capture({ mode, bodyText: text.trim(), title: file.name, file, filename: file.name });
  }

  function releaseRecording() {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    recorderRef.current = null;
    if (mountedRef.current) setRecording(false);
  }

  async function toggleRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      audioInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      recordingStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) audioChunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        const type = recorder.mimeType || "audio/webm";
        const audio = new Blob(audioChunksRef.current, { type });
        releaseRecording();
        if (!mountedRef.current) return;
        if (!audio.size) {
          setMessage("Não foi possível registrar áudio desta vez.");
          return;
        }
        const extension = type.includes("mp4") ? "m4a" : "webm";
        void capture({
          mode: "audio",
          bodyText: text.trim(),
          title: "Registro em áudio",
          file: audio,
          filename: `registro-${new Date().toISOString().replaceAll(":", "-")}.${extension}`
        });
      }, { once: true });
      recorder.addEventListener("error", () => {
        releaseRecording();
        setMessage("Não foi possível registrar áudio desta vez.");
      }, { once: true });
      recorder.start();
      setRecording(true);
      setMessage("Gravação em andamento. Seu áudio só será enviado quando você parar.");
    } catch {
      releaseRecording();
      if (mountedRef.current) {
        setMessage("Não foi possível acessar o microfone. Você pode adicionar um áudio já gravado.");
      }
    }
  }

  function showLinkMode() {
    setLinkMode(true);
    setMessage(null);
  }

  return (
    <form className="studio-composer" onSubmit={submitCapture} aria-label="Nova captura">
      <label className="sr-only" htmlFor="studio-capture">Registre um pensamento</label>
      <textarea
        id="studio-capture"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Escreva, grave ou adicione qualquer coisa…"
        rows={4}
      />

      {linkMode ? (
        <div className="studio-composer__link">
          <label htmlFor="studio-capture-link">Endereço do link</label>
          <input
            id="studio-capture-link"
            ref={linkInputRef}
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://"
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
          <button type="button" onClick={() => setLinkMode(false)}>Fechar</button>
        </div>
      ) : null}

      <div className="studio-composer-actions">
        <div className="studio-composer-tools" aria-label="Formatos de captura">
          <button
            type="button"
            aria-label={recording ? "Parar gravação" : "Gravar áudio"}
            aria-pressed={recording}
            onClick={() => void toggleRecording()}
            disabled={saving}
          >
            <i aria-hidden="true" className={`ph-light ${recording ? "ph-stop-circle" : "ph-microphone"}`} />
          </button>
          <button type="button" aria-label="Adicionar arquivo" onClick={() => fileInputRef.current?.click()} disabled={saving || recording}>
            <i aria-hidden="true" className="ph-light ph-paperclip" />
          </button>
          <button type="button" aria-label="Adicionar imagem" onClick={() => imageInputRef.current?.click()} disabled={saving || recording}>
            <i aria-hidden="true" className="ph-light ph-image" />
          </button>
          <button type="button" aria-label="Adicionar link" onClick={showLinkMode} disabled={saving || recording}>
            <i aria-hidden="true" className="ph-light ph-link" />
          </button>
        </div>
        <button className="studio-composer__submit" type="submit" disabled={saving || recording || (linkMode ? !link.trim() : !text.trim())}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>

      <input hidden tabIndex={-1} ref={fileInputRef} type="file" onChange={(event) => captureSelectedFile(event, "file")} />
      <input hidden tabIndex={-1} ref={imageInputRef} type="file" accept="image/*" onChange={(event) => captureSelectedFile(event, "image")} />
      <input hidden tabIndex={-1} data-testid="studio-audio-input" ref={audioInputRef} type="file" accept="audio/*" onChange={(event) => captureSelectedFile(event, "audio")} />

      {message ? <p className="studio-composer__status" role="status" aria-live="polite">{message}</p> : null}
    </form>
  );
}
