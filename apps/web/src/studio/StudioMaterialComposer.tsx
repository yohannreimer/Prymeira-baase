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
    documentId: string;
    file: Blob;
    filename: string;
    idempotencyKey: string;
  }
  | { kind: "link"; documentId: string; url: string; idempotencyKey: string };

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

function parseIpv6Address(hostname: string): bigint | null {
  if (!hostname.includes(":")) return null;
  let normalized = hostname.toLowerCase();
  if (normalized.includes("%")) return null;
  const ipv4Match = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u);
  if (ipv4Match) {
    const parts = ipv4Match[1]!.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => part > 255)) return null;
    const high = ((parts[0] ?? 0) << 8) | (parts[1] ?? 0);
    const low = ((parts[2] ?? 0) << 8) | (parts[3] ?? 0);
    normalized = `${normalized.slice(0, -ipv4Match[1]!.length)}${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - head.length - tail.length;
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return null;
  const groups = [...head, ...Array.from({ length: omitted }, () => "0"), ...tail];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return null;
  return groups.reduce((address, group) => (address << 16n) | BigInt(`0x${group}`), 0n);
}

const blockedIpv6Networks = [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
] as const;

function isInIpv6Network(address: bigint, networkValue: string, prefixLength: number) {
  const network = parseIpv6Address(networkValue);
  if (network === null) return false;
  const shift = 128n - BigInt(prefixLength);
  return (address >> shift) === (network >> shift);
}

function mappedIpv4Address(address: bigint) {
  if (!isInIpv6Network(address, "::ffff:0:0", 96)) return null;
  const ipv4 = Number(address & 0xffff_ffffn);
  return [24, 16, 8, 0]
    .map((shift) => String((ipv4 >>> shift) & 0xff))
    .join(".");
}

function isPrivateIpv6(hostname: string) {
  if (!hostname.includes(":")) return false;
  const address = parseIpv6Address(hostname);
  if (address === null) return true;
  const mappedIpv4 = mappedIpv4Address(address);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  // Local feedback accepts only global-unicast IPv6. The server remains the
  // authority for DNS, redirects, and the final SSRF decision.
  if (!isInIpv6Network(address, "2000::", 3)) return true;
  return blockedIpv6Networks.some(([networkValue, prefixLength]) => (
    isInIpv6Network(address, networkValue, prefixLength)
  ));
}

function readPublicHttpUrl(value: string) {
  // This only provides immediate feedback. DNS resolution, redirect checks, and
  // the authoritative SSRF decision remain server-owned.
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    if (url.hostname.endsWith(".")) return null;
    const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    if (!hostname
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || hostname.endsWith(".home.arpa")
      || (!hostname.includes(":") && !hostname.includes("."))
      || isPrivateIpv4(hostname)
      || isPrivateIpv6(hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

type StudioMaterialComposerSessionProps = Required<
  Pick<StudioMaterialComposerProps, "attachFile" | "attachLink">
> & Omit<StudioMaterialComposerProps, "attachFile" | "attachLink">;

export default function StudioMaterialComposer(props: StudioMaterialComposerProps) {
  return (
    <StudioMaterialComposerSession
      key={props.documentId}
      {...props}
      attachFile={props.attachFile ?? attachStudioFile}
      attachLink={props.attachLink ?? attachStudioLink}
    />
  );
}

function StudioMaterialComposerSession({
  documentId,
  onAttached,
  attachFile,
  attachLink
}: StudioMaterialComposerSessionProps) {
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
  const actionsRef = useRef<HTMLDivElement>(null);
  const fileTriggerRef = useRef<HTMLButtonElement>(null);
  const imageTriggerRef = useRef<HTMLButtonElement>(null);
  const linkTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreLinkFocusRef = useRef(false);
  const restoreMaterialFocusRef = useRef<PendingMaterial["kind"] | null>(null);
  const attachFileRef = useRef(attachFile);
  const attachLinkRef = useRef(attachLink);
  const onAttachedRef = useRef(onAttached);
  const actionsLabelId = useId();
  attachFileRef.current = attachFile;
  attachLinkRef.current = attachLink;
  onAttachedRef.current = onAttached;

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

  useEffect(() => {
    if (pendingMaterial || !restoreMaterialFocusRef.current) return;
    const origin = restoreMaterialFocusRef.current;
    restoreMaterialFocusRef.current = null;
    if (origin === "file") fileTriggerRef.current?.focus();
    else if (origin === "image") imageTriggerRef.current?.focus();
    else if (origin === "link") linkTriggerRef.current?.focus();
    else actionsRef.current
      ?.querySelector<HTMLButtonElement>('button[aria-pressed]')
      ?.focus();
  }, [pendingMaterial]);

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
        ? await attachLinkRef.current(material.documentId, material.url, material.idempotencyKey)
        : await attachFileRef.current(
          material.documentId,
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
          restoreLinkFocusRef.current = true;
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

    if (attached) onAttachedRef.current(attached);
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
      documentId,
      file,
      filename: file.name,
      idempotencyKey: globalThis.crypto.randomUUID()
    });
  }

  function captureAudio({ blob, filename }: { blob: Blob; filename: string }) {
    if (busyRef.current || pendingMaterial) return;
    void submitMaterial({
      kind: "audio",
      documentId,
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
      documentId,
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
    restoreMaterialFocusRef.current = pendingMaterial.kind;
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
    <section className="studio-material-composer" aria-labelledby={actionsLabelId}>
      <p className="studio-material-composer__label" id={actionsLabelId}>
        Adicionar material
      </p>
      <div
        className="studio-material-composer__actions"
        ref={actionsRef}
        role="group"
        aria-labelledby={actionsLabelId}
        aria-busy={busy}
      >
        <StudioAudioRecorder
          className="studio-material-composer__action"
          iconClassName="studio-material-composer__action-icon"
          variant="label"
          inputTestId="studio-material-audio-input"
          disabled={unavailable}
          onCaptured={captureAudio}
          onStatus={reportAudioStatus}
          onActiveChange={setAudioActive}
        />
        <button
          className="studio-material-composer__action"
          ref={fileTriggerRef}
          type="button"
          disabled={competingActionUnavailable}
          onClick={() => fileInputRef.current?.click()}
        >
          <i aria-hidden="true" className="studio-material-composer__action-icon ph-light ph-paperclip" />
          <span>Adicionar arquivo</span>
        </button>
        <button
          className="studio-material-composer__action"
          ref={imageTriggerRef}
          type="button"
          disabled={competingActionUnavailable}
          onClick={() => imageInputRef.current?.click()}
        >
          <i aria-hidden="true" className="studio-material-composer__action-icon ph-light ph-image" />
          <span>Adicionar imagem</span>
        </button>
        <button
          className="studio-material-composer__action"
          ref={linkTriggerRef}
          type="button"
          disabled={competingActionUnavailable}
          onClick={openLinkMode}
        >
          <i aria-hidden="true" className="studio-material-composer__action-icon ph-light ph-link" />
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
        <form
          className="studio-material-composer__link"
          onSubmit={submitLink}
          aria-label="Captura de link"
        >
          <label
            className="studio-material-composer__link-label"
            htmlFor={`${actionsLabelId}-link`}
          >
            Endereço do link
          </label>
          <input
            className="studio-material-composer__link-input"
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
          <button
            className="studio-material-composer__link-action studio-material-composer__link-action--primary"
            type="submit"
            disabled={unavailable || !link.trim()}
          >
            Capturar este link
          </button>
          <button
            className="studio-material-composer__link-action"
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
          className={`studio-material-composer__status studio-material-composer__status--${message.kind}`}
          role={message.kind === "error" ? "alert" : "status"}
          aria-live={message.kind === "error" ? "assertive" : "polite"}
        >
          {message.text}
        </p>
      ) : null}

      {failed && pendingMaterial ? (
        <div
          className="studio-material-composer__recovery"
          role="group"
          aria-label="Recuperar material"
        >
          <button
            className="studio-material-composer__recovery-action studio-material-composer__recovery-action--primary"
            type="button"
            disabled={busy}
            onClick={() => void submitMaterial(pendingMaterial)}
          >
            Tentar novamente
          </button>
          <button
            className="studio-material-composer__recovery-action"
            type="button"
            disabled={busy}
            onClick={discardFailedMaterial}
          >
            Descartar
          </button>
        </div>
      ) : null}
    </section>
  );
}
