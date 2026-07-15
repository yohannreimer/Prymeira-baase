import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent
} from "react";
import { attachStudioFile, attachStudioLink } from "./studio-api";
import StudioAudioRecorder from "./StudioAudioRecorder";
import type { StudioAsset } from "./studio.types";

export type StudioMaterialComposerProps = {
  documentId: string;
  onAttached(asset: StudioAsset): void;
  attachFile?: typeof attachStudioFile;
  attachLink?: typeof attachStudioLink;
};

type PendingMaterial =
  | {
    kind: "audio" | "file" | "image";
    file: Blob;
    filename: string;
    idempotencyKey: string;
  }
  | { kind: "link"; url: string; idempotencyKey: string };

type ComposerMessage = { kind: "status" | "error"; text: string };

function isPrivateIpv4(hostname: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
  const parts = hostname.split(".").map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [first = 0, second = 0, third = 0] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function isPrivateIpv6(hostname: string) {
  if (!hostname.includes(":")) return false;
  const normalized = hostname.toLowerCase();
  return normalized.includes("%")
    || normalized === "::"
    || normalized === "::1"
    || /^f[cd]/u.test(normalized)
    || /^fe[89ab]/u.test(normalized)
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8")
    || normalized.startsWith("2001:0:")
    || normalized.startsWith("2002:")
    || normalized.startsWith("64:ff9b:")
    || normalized.startsWith("::ffff:")
    || /^::(?:\d{1,3}\.){3}\d{1,3}$/u.test(normalized);
}

function readPublicHttpUrl(value: string) {
  // This only provides immediate feedback. DNS resolution, redirect checks, and
  // the authoritative SSRF decision remain server-owned.
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    const hostname = url.hostname
      .replace(/^\[|\]$/gu, "")
      .replace(/\.$/u, "")
      .toLowerCase();
    if (!hostname
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || hostname.endsWith(".home.arpa")
      || isPrivateIpv4(hostname)
      || isPrivateIpv6(hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export default function StudioMaterialComposer({
  documentId,
  onAttached,
  attachFile = attachStudioFile,
  attachLink = attachStudioLink
}: StudioMaterialComposerProps) {
  const [busy, setBusy] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState("");
  const [pendingMaterial, setPendingMaterial] = useState<PendingMaterial | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<ComposerMessage | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreLinkFocusRef = useRef(false);
  const actionsLabelId = useId();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (linkMode) {
      linkInputRef.current?.focus();
      return;
    }
    if (restoreLinkFocusRef.current) {
      restoreLinkFocusRef.current = false;
      linkTriggerRef.current?.focus();
    }
  }, [linkMode]);

  async function submitMaterial(material: PendingMaterial) {
    if (busyRef.current) return;
    busyRef.current = true;
    if (mountedRef.current) {
      setBusy(true);
      setFailed(false);
      setPendingMaterial(material);
      setMessage({ kind: "status", text: "Adicionando material…" });
    }

    let attached: StudioAsset | null = null;
    try {
      attached = material.kind === "link"
        ? await attachLink(documentId, material.url, material.idempotencyKey)
        : await attachFile(
          documentId,
          material.file,
          material.filename,
          material.idempotencyKey
        );
      if (mountedRef.current) {
        setPendingMaterial(null);
        setFailed(false);
        setMessage({ kind: "status", text: "Material adicionado." });
        if (material.kind === "link") {
          setLink("");
          setLinkMode(false);
        }
      }
    } catch {
      if (mountedRef.current) {
        setFailed(true);
        setMessage({
          kind: "error",
          text: "O material não foi adicionado. Tente novamente ou descarte esta tentativa."
        });
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }

    if (attached && mountedRef.current) onAttached(attached);
  }

  function captureSelectedFile(
    event: ChangeEvent<HTMLInputElement>,
    kind: "file" | "image"
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busyRef.current || pendingMaterial) return;
    void submitMaterial({
      kind,
      file,
      filename: file.name,
      idempotencyKey: globalThis.crypto.randomUUID()
    });
  }

  function captureAudio({ blob, filename }: { blob: Blob; filename: string }) {
    if (busyRef.current || pendingMaterial) return;
    void submitMaterial({
      kind: "audio",
      file: blob,
      filename,
      idempotencyKey: globalThis.crypto.randomUUID()
    });
  }

  function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || pendingMaterial) return;
    const url = readPublicHttpUrl(link.trim());
    if (!url) {
      setMessage({
        kind: "error",
        text: "Use uma URL pública HTTP ou HTTPS válida, sem credenciais ou endereço de rede privada."
      });
      linkInputRef.current?.focus();
      return;
    }
    void submitMaterial({
      kind: "link",
      url,
      idempotencyKey: globalThis.crypto.randomUUID()
    });
  }

  function openLinkMode() {
    setLinkMode(true);
    if (message?.kind === "error" && !failed) setMessage(null);
  }

  function closeLinkMode() {
    restoreLinkFocusRef.current = true;
    setLinkMode(false);
    if (message?.kind === "error" && !failed) setMessage(null);
  }

  function discardFailedMaterial() {
    if (busyRef.current || !failed || !pendingMaterial) return;
    if (pendingMaterial.kind === "link") setLink("");
    setPendingMaterial(null);
    setFailed(false);
    setMessage(null);
  }

  function reportAudioStatus(text: string) {
    setMessage({
      kind: text.startsWith("Não foi possível") ? "error" : "status",
      text
    });
  }

  const unavailable = busy || Boolean(pendingMaterial);
  const competingActionUnavailable = unavailable || audioActive;

  return (
    <section aria-labelledby={actionsLabelId} aria-busy={busy}>
      <p id={actionsLabelId}>Adicionar material</p>
      <div role="group" aria-labelledby={actionsLabelId}>
        <StudioAudioRecorder
          variant="label"
          inputTestId="studio-material-audio-input"
          disabled={unavailable}
          onCaptured={captureAudio}
          onStatus={reportAudioStatus}
          onActiveChange={setAudioActive}
        />
        <button
          type="button"
          disabled={competingActionUnavailable}
          onClick={() => fileInputRef.current?.click()}
        >
          <i aria-hidden="true" className="ph-light ph-paperclip" />
          <span>Adicionar arquivo</span>
        </button>
        <button
          type="button"
          disabled={competingActionUnavailable}
          onClick={() => imageInputRef.current?.click()}
        >
          <i aria-hidden="true" className="ph-light ph-image" />
          <span>Adicionar imagem</span>
        </button>
        <button
          ref={linkTriggerRef}
          type="button"
          disabled={competingActionUnavailable}
          onClick={openLinkMode}
        >
          <i aria-hidden="true" className="ph-light ph-link" />
          <span>Capturar link</span>
        </button>
      </div>

      <input
        hidden
        tabIndex={-1}
        data-testid="studio-material-file-input"
        ref={fileInputRef}
        type="file"
        disabled={unavailable}
        onChange={(event) => captureSelectedFile(event, "file")}
      />
      <input
        hidden
        tabIndex={-1}
        data-testid="studio-material-image-input"
        ref={imageInputRef}
        type="file"
        accept="image/*"
        disabled={unavailable}
        onChange={(event) => captureSelectedFile(event, "image")}
      />

      {linkMode ? (
        <form onSubmit={submitLink} aria-label="Captura de link">
          <label htmlFor={`${actionsLabelId}-link`}>Endereço do link</label>
          <input
            id={`${actionsLabelId}-link`}
            ref={linkInputRef}
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://"
            value={link}
            disabled={unavailable}
            onChange={(event) => setLink(event.target.value)}
          />
          <button type="submit" disabled={unavailable || !link.trim()}>
            Capturar este link
          </button>
          <button
            type="button"
            aria-label="Fechar captura de link"
            disabled={unavailable}
            onClick={closeLinkMode}
          >
            Fechar
          </button>
        </form>
      ) : null}

      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          aria-live={message.kind === "error" ? "assertive" : "polite"}
        >
          {message.text}
        </p>
      ) : null}

      {failed && pendingMaterial ? (
        <div aria-label="Recuperar material">
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitMaterial(pendingMaterial)}
          >
            Tentar novamente
          </button>
          <button type="button" disabled={busy} onClick={discardFailedMaterial}>
            Descartar
          </button>
        </div>
      ) : null}
    </section>
  );
}
