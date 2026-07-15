import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  attachStudioFile,
  attachStudioLink,
  createStudioDocument,
  type CreateStudioDocumentInput
} from "./studio-api";
import StudioAudioRecorder from "./StudioAudioRecorder";
import type { StudioAsset, StudioCaptureMode, StudioDocument } from "./studio.types";

export type StudioCaptureOutcome = {
  processing: "none" | "pending" | "retry";
  asset?: StudioAsset;
  message?: string;
};

type CreateDocument = (input: CreateStudioDocumentInput, signal?: AbortSignal) => Promise<StudioDocument>;
type AttachAsset = (
  documentId: string,
  file: Blob,
  filename: string,
  idempotencyKey: string,
  signal?: AbortSignal
) => Promise<StudioAsset>;
type AttachLink = (documentId: string, url: string, idempotencyKey: string, signal?: AbortSignal) => Promise<StudioAsset>;

type UniversalCaptureComposerProps = {
  onCaptured(document: StudioDocument, outcome: StudioCaptureOutcome): void;
  createDocument?: CreateDocument;
  attachAsset?: AttachAsset;
  attachLink?: AttachLink;
};

type CaptureInput = {
  mode: StudioCaptureMode;
  captureKey: string;
  bodyText: string;
  title?: string | null;
  file?: Blob;
  filename?: string;
  url?: string;
  idempotencyKey?: string;
};

type RetryAttachment = {
  document: StudioDocument | null;
  input: CaptureInput;
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
  const [audioActive, setAudioActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [retryAttachment, setRetryAttachment] = useState<RetryAttachment | null>(null);
  const busyRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkTriggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (linkMode) linkInputRef.current?.focus();
  }, [linkMode]);

  async function attachInput(document: StudioDocument, input: CaptureInput, signal?: AbortSignal) {
    if ((input.file || input.url) && !input.idempotencyKey) throw new Error("STUDIO_CAPTURE_IDEMPOTENCY_KEY_MISSING");
    if (input.file && input.filename) {
      return attachAsset(document.id, input.file, input.filename, input.idempotencyKey!, signal);
    }
    if (input.url) return attachLink(document.id, input.url, input.idempotencyKey!, signal);
    return undefined;
  }

  function clearComposer() {
    setText("");
    setLink("");
    setLinkMode(false);
    setRetryAttachment(null);
  }

  function uploadFailureMessage(input: CaptureInput, document: StudioDocument | null) {
    if (!document) return "O material ainda não foi guardado. Tente enviar novamente.";
    if (input.mode === "audio") return "O documento foi criado, mas o áudio não foi enviado.";
    if (input.mode === "link") return "O documento foi criado, mas o link não foi adicionado.";
    if (input.mode === "image") return "O documento foi criado, mas a imagem não foi enviada.";
    return "O documento foi criado, mas o arquivo não foi enviado.";
  }

  async function capture(input: CaptureInput) {
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setMessage("Guardando sua captura…");
    const controller = new AbortController();
    controllerRef.current = controller;
    let document: StudioDocument | null = null;
    let completed: { document: StudioDocument; outcome: StudioCaptureOutcome } | null = null;
    try {
      const captureMode = input.mode !== "text" && input.bodyText ? "mixed" : input.mode;
      document = await create({
        title: input.title ?? null,
        body_json: editorBody(input.bodyText),
        body_text: input.bodyText,
        capture_mode: captureMode,
        capture_key: input.captureKey
      }, controller.signal);
      if (controllerRef.current === controller) controllerRef.current = null;

      // Once the document exists, the bounded server-owned upload must outlive this surface.
      // Losing the response is safe because retries reuse input.idempotencyKey.
      const asset = await attachInput(document, input);

      const outcome = assetOutcome(asset, input.mode);
      if (mountedRef.current) {
        clearComposer();
        setMessage(outcome.message ?? (outcome.processing === "pending"
          ? "Captura guardada. O conteúdo continua sendo preparado."
          : "Captura guardada."));
      }
      completed = { document, outcome };
    } catch {
      if (controller.signal.aborted) return;
      if (mountedRef.current) {
        setRetryAttachment({ document, input });
        setMessage(input.file || input.url
          ? uploadFailureMessage(input, document)
          : "Não foi possível guardar agora. Seu conteúdo continua aqui para tentar novamente.");
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      busyRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
    if (completed && mountedRef.current) onCaptured(completed.document, completed.outcome);
  }

  async function retryPendingAttachment() {
    const pending = retryAttachment;
    if (!pending || busyRef.current) return;
    if (!pending.document) {
      setRetryAttachment(null);
      await capture(pending.input);
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setMessage("Enviando o material novamente…");
    let completed: StudioCaptureOutcome | null = null;
    try {
      const asset = await attachInput(pending.document, pending.input);
      completed = assetOutcome(asset, pending.input.mode);
      if (mountedRef.current) {
        clearComposer();
        setMessage(completed.message ?? (completed.processing === "pending"
          ? "Material enviado. O conteúdo continua sendo preparado."
          : "Material enviado."));
      }
    } catch {
      if (mountedRef.current) {
        setMessage(uploadFailureMessage(pending.input, pending.document));
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
    if (completed && mountedRef.current) onCaptured(pending.document, completed);
  }

  function continueWithoutAttachment() {
    const pending = retryAttachment;
    if (!pending?.document) return;
    clearComposer();
    setMessage("Documento aberto sem o material que não foi enviado.");
    onCaptured(pending.document, {
      processing: "none",
      message: "O material não foi enviado."
    });
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
      void capture({
        mode: "link",
        captureKey: globalThis.crypto.randomUUID(),
        bodyText: text.trim(),
        title: null,
        url,
        idempotencyKey: globalThis.crypto.randomUUID()
      });
      return;
    }
    const bodyText = text.trim();
    if (!bodyText) return;
    void capture({ mode: "text", bodyText, captureKey: globalThis.crypto.randomUUID() });
  }

  function captureSelectedFile(event: ChangeEvent<HTMLInputElement>, mode: "file" | "image") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void capture({
      mode,
      captureKey: globalThis.crypto.randomUUID(),
      bodyText: text.trim(),
      title: file.name,
      file,
      filename: file.name,
      idempotencyKey: globalThis.crypto.randomUUID()
    });
  }

  function showLinkMode() {
    setLinkMode(true);
    setMessage(null);
  }

  function closeLinkMode() {
    setLinkMode(false);
    linkTriggerRef.current?.focus();
  }

  return (
    <form className="studio-composer" onSubmit={submitCapture} aria-label="Nova captura">
      <label className="sr-only" htmlFor="studio-capture">Registre um pensamento</label>
      <textarea
        id="studio-capture"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={Boolean(retryAttachment)}
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
            disabled={Boolean(retryAttachment)}
          />
          <button type="button" onClick={closeLinkMode} disabled={Boolean(retryAttachment)}>Fechar</button>
        </div>
      ) : null}

      <div className="studio-composer-actions">
        <div className="studio-composer-tools" aria-label="Formatos de captura">
          <StudioAudioRecorder
            variant="icon"
            inputTestId="studio-audio-input"
            disabled={saving || Boolean(retryAttachment)}
            onStatus={setMessage}
            onActiveChange={setAudioActive}
            onCaptured={({ blob, filename }) => void capture({
              mode: "audio",
              captureKey: globalThis.crypto.randomUUID(),
              bodyText: text.trim(),
              title: "Registro em áudio",
              file: blob,
              filename,
              idempotencyKey: globalThis.crypto.randomUUID()
            })}
          />
          <button type="button" aria-label="Adicionar arquivo" onClick={() => fileInputRef.current?.click()} disabled={saving || audioActive || Boolean(retryAttachment)}>
            <i aria-hidden="true" className="ph-light ph-paperclip" />
          </button>
          <button type="button" aria-label="Adicionar imagem" onClick={() => imageInputRef.current?.click()} disabled={saving || audioActive || Boolean(retryAttachment)}>
            <i aria-hidden="true" className="ph-light ph-image" />
          </button>
          <button ref={linkTriggerRef} type="button" aria-label="Adicionar link" onClick={showLinkMode} disabled={saving || audioActive || Boolean(retryAttachment)}>
            <i aria-hidden="true" className="ph-light ph-link" />
          </button>
        </div>
        <button className="studio-composer__submit" type="submit" disabled={saving || audioActive || Boolean(retryAttachment) || (linkMode ? !link.trim() : !text.trim())}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>

      <input hidden tabIndex={-1} ref={fileInputRef} type="file" onChange={(event) => captureSelectedFile(event, "file")} />
      <input hidden tabIndex={-1} ref={imageInputRef} type="file" accept="image/*" onChange={(event) => captureSelectedFile(event, "image")} />

      {message ? <p className="studio-composer__status" role="status" aria-live="polite">{message}</p> : null}
      {retryAttachment ? (
        <div className="studio-composer__retry">
          <button type="button" onClick={() => void retryPendingAttachment()} disabled={saving}>
            {saving ? "Enviando…" : retryAttachment.document
              ? retryAttachment.input.mode === "audio" ? "Tentar enviar áudio novamente"
                : retryAttachment.input.mode === "link" ? "Tentar adicionar link novamente"
                  : retryAttachment.input.mode === "image" ? "Tentar enviar imagem novamente"
                    : "Tentar enviar arquivo novamente"
              : "Tentar guardar novamente"}
          </button>
          {retryAttachment.document ? (
            <button type="button" onClick={continueWithoutAttachment} disabled={saving}>Seguir sem anexo</button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
