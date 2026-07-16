import { useEffect, useId, useRef, useState } from "react";
import {
  deleteStudioAsset,
  getStudioAssetDownload,
  retryStudioAsset
} from "./studio-api";
import { studioAssetStatusPresentation } from "./StudioAssetProcessingStatus";
import { formatStudioMaterialSize } from "./StudioMaterialList";
import type { StudioAsset } from "./studio.types";

type Download = { url: string; expiresInSeconds: number };
type PreviewDownload = Download & { assetId: string; generation: number };
type PreviewState = {
  assetId: string;
  generation: number;
  value: "idle" | "loading" | "ready" | "error";
};

export type StudioMaterialInspectorProps = {
  asset: StudioAsset;
  open: boolean;
  onClose(): void;
  onAssetChange?(asset: StudioAsset): void;
  onInsertText?(text: string): boolean | Promise<boolean>;
  onDeleted?(assetId: string): void;
  getDownload?: (assetId: string, signal?: AbortSignal) => Promise<Download>;
  retry?: (assetId: string, signal?: AbortSignal) => Promise<StudioAsset>;
  deleteAsset?: (assetId: string, signal?: AbortSignal) => Promise<void>;
};

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function extractionExcerpt(value: string, limit = 220) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= limit) return normalized;
  const clipped = normalized.slice(0, limit - 1);
  const wordBoundary = clipped.lastIndexOf(" ");
  const excerpt = wordBoundary >= Math.floor(limit * 0.65)
    ? clipped.slice(0, wordBoundary)
    : clipped;
  return `${excerpt.trimEnd()}…`;
}

async function copyText(value: string) {
  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Some browsers expose Clipboard API but deny it outside a trusted gesture.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.inset = "-9999px auto auto -9999px";
  document.body.append(textarea);
  try {
    textarea.select();
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function focusableElements(root: HTMLElement | null) {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(
    "button:not([disabled]), a[href], audio[controls], [tabindex]:not([tabindex='-1'])"
  )].filter((element) => !element.hasAttribute("hidden"));
}

function kindLabel(asset: StudioAsset) {
  if (asset.kind === "audio") return "Áudio";
  if (asset.kind === "image") return "Imagem";
  if (asset.kind === "link_snapshot") return "Link";
  if (asset.mimeType === "application/pdf") return "PDF";
  return "Arquivo";
}

export default function StudioMaterialInspector({
  asset,
  open,
  onClose,
  onAssetChange,
  onInsertText,
  onDeleted,
  getDownload = getStudioAssetDownload,
  retry = retryStudioAsset,
  deleteAsset = deleteStudioAsset
}: StudioMaterialInspectorProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const actionGenerationRef = useRef(0);
  const previewGenerationRef = useRef({ assetId: asset.id, kind: asset.kind, generation: 0 });
  const audioPlayerRef = useRef<HTMLAudioElement>(null);
  const pendingAudioDownloadRef = useRef<PreviewDownload | null>(null);
  const pendingAudioSeekRef = useRef<{ assetId: string; generation: number; url: string; position: number } | null>(null);
  const [preview, setPreview] = useState<PreviewDownload | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewState>({
    assetId: asset.id,
    generation: 0,
    value: "idle"
  });
  const [previewCycle, setPreviewCycle] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [insertState, setInsertState] = useState<"idle" | "working" | "success" | "error">("idle");
  const [retryState, setRetryState] = useState<"idle" | "working" | "error">("idle");
  const [downloadState, setDownloadState] = useState<"idle" | "working" | "error">("idle");
  const [copyState, setCopyState] = useState<"idle" | "working" | "success" | "error">("idle");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteState, setDeleteState] = useState<"idle" | "working" | "error">("idle");
  onCloseRef.current = onClose;

  if (previewGenerationRef.current.assetId !== asset.id || previewGenerationRef.current.kind !== asset.kind) {
    previewGenerationRef.current = {
      assetId: asset.id,
      kind: asset.kind,
      generation: previewGenerationRef.current.generation + 1
    };
    actionGenerationRef.current += 1;
    pendingAudioDownloadRef.current = null;
    pendingAudioSeekRef.current = null;
  }
  const previewGeneration = previewGenerationRef.current.generation;
  const activePreview = preview?.assetId === asset.id && preview.generation === previewGeneration
    ? preview
    : null;
  const previewState = previewStatus.assetId === asset.id && previewStatus.generation === previewGeneration
    ? previewStatus.value
    : "idle";

  useEffect(() => {
    setExpanded(false);
    setInsertState("idle");
    setRetryState("idle");
    setDownloadState("idle");
    setCopyState("idle");
    setDeleteConfirm(false);
    setDeleteState("idle");
  }, [asset.id]);

  useEffect(() => {
    pendingAudioDownloadRef.current = null;
    pendingAudioSeekRef.current = null;
    return () => {
      pendingAudioDownloadRef.current = null;
      pendingAudioSeekRef.current = null;
    };
  }, [asset.id, asset.kind]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    titleRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        titleRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !dialogRef.current?.contains(active);
      if (event.shiftKey && (active === first || active === titleRef.current || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === titleRef.current || outside)) {
        event.preventDefault();
        first.focus();
      }
    }

    function keepFocusInside(event: FocusEvent) {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) titleRef.current?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", keepFocusInside);
      document.body.style.overflow = previousOverflow;
      const returnTarget = returnFocusRef.current;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || (asset.kind !== "audio" && asset.kind !== "image")) {
      setPreview(null);
      setPreviewStatus({ assetId: asset.id, generation: previewGeneration, value: "idle" });
      return;
    }
    const generation = previewGeneration;
    const controller = new AbortController();
    let renewal: ReturnType<typeof setTimeout> | null = null;
    setPreviewStatus({ assetId: asset.id, generation, value: "loading" });
    void getDownload(asset.id, controller.signal).then((result) => {
      const isCurrent = previewGenerationRef.current.assetId === asset.id
        && previewGenerationRef.current.kind === asset.kind
        && previewGenerationRef.current.generation === generation;
      if (controller.signal.aborted || !isCurrent) return;
      const identified = { ...result, assetId: asset.id, generation };
      const player = audioPlayerRef.current;
      if (asset.kind === "audio" && player && !player.paused && !player.ended) {
        pendingAudioDownloadRef.current = identified;
      } else {
        pendingAudioDownloadRef.current = null;
        pendingAudioSeekRef.current = asset.kind === "audio" && player
          ? {
            assetId: asset.id,
            generation,
            url: result.url,
            position: player.ended
              ? 0
              : Number.isFinite(player.currentTime) ? Math.max(0, player.currentTime) : 0
          }
          : null;
        setPreview(identified);
      }
      setPreviewStatus({ assetId: asset.id, generation, value: "ready" });
      const lifetime = Math.max(0, result.expiresInSeconds * 1_000);
      if (lifetime > 0) {
        renewal = setTimeout(() => {
          if (!controller.signal.aborted) setPreviewCycle((cycle) => cycle + 1);
        }, Math.max(1_000, lifetime - Math.min(30_000, Math.max(1_000, lifetime * 0.1))));
      }
    }).catch(() => {
      const isCurrent = previewGenerationRef.current.assetId === asset.id
        && previewGenerationRef.current.kind === asset.kind
        && previewGenerationRef.current.generation === generation;
      if (!controller.signal.aborted && isCurrent) {
        pendingAudioDownloadRef.current = null;
        setPreviewStatus({ assetId: asset.id, generation, value: "error" });
      }
    });
    return () => {
      controller.abort();
      if (renewal) clearTimeout(renewal);
    };
  }, [asset.id, asset.kind, getDownload, open, previewCycle, previewGeneration]);

  if (!open) return null;

  const extraction = asset.extractedText?.trim() || null;
  const excerpt = extraction ? extractionExcerpt(extraction) : null;
  const status = studioAssetStatusPresentation[asset.extractionStatus];
  const canInsert = asset.extractionStatus === "ready" && Boolean(extraction) && Boolean(onInsertText);
  const externalUrl = safeExternalUrl(asset.sourceUrl);
  const size = formatStudioMaterialSize(asset.sizeBytes);

  function adoptPendingAudioDownload(ended = false) {
    const pendingDownload = pendingAudioDownloadRef.current;
    const player = audioPlayerRef.current;
    if (pendingDownload && (pendingDownload.assetId !== asset.id || pendingDownload.generation !== previewGeneration)) {
      pendingAudioDownloadRef.current = null;
      return;
    }
    const playbackEnded = ended || Boolean(player?.ended);
    if (!pendingDownload) {
      if (playbackEnded && pendingAudioSeekRef.current) {
        pendingAudioSeekRef.current = { ...pendingAudioSeekRef.current, position: 0 };
      }
      return;
    }
    const position = playbackEnded
      ? 0
      : player && Number.isFinite(player.currentTime) ? Math.max(0, player.currentTime) : 0;
    pendingAudioDownloadRef.current = null;
    pendingAudioSeekRef.current = {
      assetId: asset.id,
      generation: previewGeneration,
      url: pendingDownload.url,
      position
    };
    setPreviewStatus({ assetId: asset.id, generation: previewGeneration, value: "ready" });
    setPreview(pendingDownload);
  }

  function restorePendingAudioPosition() {
    const pendingSeek = pendingAudioSeekRef.current;
    const player = audioPlayerRef.current;
    if (!pendingSeek
      || pendingSeek.assetId !== asset.id
      || pendingSeek.generation !== previewGeneration
      || !player
      || activePreview?.url !== pendingSeek.url) return;
    pendingAudioSeekRef.current = null;
    try {
      player.currentTime = pendingSeek.position;
    } catch {
      pendingAudioSeekRef.current = pendingSeek;
    }
  }

  async function insertText() {
    if (!extraction || !onInsertText || insertState === "working") return;
    const generation = actionGenerationRef.current;
    setInsertState("working");
    try {
      const persisted = await onInsertText(extraction);
      if (generation === actionGenerationRef.current) setInsertState(persisted ? "success" : "error");
    } catch {
      if (generation === actionGenerationRef.current) setInsertState("error");
    }
  }

  async function retryProcessing() {
    if (retryState === "working") return;
    const controller = new AbortController();
    const generation = actionGenerationRef.current;
    setRetryState("working");
    try {
      const refreshed = await retry(asset.id, controller.signal);
      if (generation !== actionGenerationRef.current) return;
      onAssetChange?.(refreshed);
      setRetryState("idle");
    } catch {
      if (generation === actionGenerationRef.current) setRetryState("error");
    }
  }

  async function downloadOriginal() {
    if (downloadState === "working") return;
    const controller = new AbortController();
    const generation = actionGenerationRef.current;
    setDownloadState("working");
    try {
      const fresh = await getDownload(asset.id, controller.signal);
      if (generation !== actionGenerationRef.current) return;
      const anchor = document.createElement("a");
      anchor.href = fresh.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.download = asset.displayName;
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
      setDownloadState("idle");
    } catch {
      if (generation === actionGenerationRef.current) setDownloadState("error");
    }
  }

  async function copyOriginalLink() {
    if (!externalUrl || copyState === "working") return;
    const generation = actionGenerationRef.current;
    setCopyState("working");
    const copied = await copyText(externalUrl);
    if (generation === actionGenerationRef.current) setCopyState(copied ? "success" : "error");
  }

  async function confirmDelete() {
    if (deleteState === "working") return;
    const controller = new AbortController();
    const generation = actionGenerationRef.current;
    setDeleteState("working");
    try {
      await deleteAsset(asset.id, controller.signal);
      if (generation !== actionGenerationRef.current) return;
      onDeleted?.(asset.id);
      onClose();
    } catch {
      if (generation === actionGenerationRef.current) setDeleteState("error");
    }
  }

  return (
    <div className="studio-material-inspector-layer">
      <button
        type="button"
        className="studio-material-inspector__backdrop"
        aria-label="Fechar detalhes do material"
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        className="studio-material-inspector"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={`Material ${asset.displayName}`}
      >
        <header className="studio-material-inspector__header">
          <div>
            <p className="mono">{kindLabel(asset)}{size ? ` · ${size}` : ""}</p>
            <h2 id={titleId} ref={titleRef} tabIndex={-1}><span className="sr-only">Material</span>{" "}{asset.displayName}</h2>
          </div>
          <button type="button" aria-label="Fechar material" onClick={onClose}>
            <i aria-hidden="true" className="ph-light ph-x" />
          </button>
        </header>

        <div className="studio-material-inspector__scroll">
          <section className="studio-material-inspector__preview" aria-label="Prévia do material">
            {asset.kind === "image" && activePreview?.url ? (
              <img src={activePreview.url} alt={`Prévia de ${asset.displayName}`} />
            ) : asset.kind === "audio" && activePreview?.url ? (
              <audio
                key={`${asset.id}:${previewGeneration}`}
                ref={audioPlayerRef}
                controls
                preload="metadata"
                src={activePreview.url}
                aria-label={`Ouvir áudio original: ${asset.displayName}`}
                onPause={() => adoptPendingAudioDownload(false)}
                onEnded={() => adoptPendingAudioDownload(true)}
                onLoadedMetadata={restorePendingAudioPosition}
                onError={() => {
                  pendingAudioDownloadRef.current = null;
                  pendingAudioSeekRef.current = null;
                  setPreview(null);
                  setPreviewStatus({ assetId: asset.id, generation: previewGeneration, value: "error" });
                }}
              />
            ) : asset.kind === "link_snapshot" && externalUrl ? (
              <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                <i aria-hidden="true" className="ph-light ph-arrow-square-out" />
                Abrir link original
              </a>
            ) : (
              <div className="studio-material-inspector__file">
                <i aria-hidden="true" className={`ph-light ${asset.mimeType === "application/pdf" ? "ph-file-pdf" : "ph-file"}`} />
                <span>O original permanece preservado. A leitura completa abre somente quando você pedir.</span>
              </div>
            )}
            {previewState === "loading" ? <p role="status">Preparando prévia…</p> : null}
            {previewState === "error" ? <p role="alert">Não foi possível carregar a prévia. O original continua preservado.</p> : null}
            {previewState === "error" && asset.kind === "audio" ? (
              <button type="button" onClick={() => setPreviewCycle((cycle) => cycle + 1)}>
                Carregar áudio original
              </button>
            ) : null}
          </section>

          <section className="studio-material-inspector__processing" aria-labelledby={`${titleId}-processing`}>
            <div className="studio-material-inspector__section-heading">
              <h3 id={`${titleId}-processing`}>{asset.kind === "audio" ? "Transcrição" : "Texto encontrado"}</h3>
              <span data-status={asset.extractionStatus}><i aria-hidden="true" className={`ph-light ${status.icon}`} />{status.label}</span>
            </div>
            {extraction ? (
              <>
                {!expanded && excerpt ? (
                  <div
                    className="studio-material-inspector__excerpt"
                    aria-label={asset.kind === "audio" ? "Trecho da transcrição" : "Trecho do texto encontrado"}
                  >
                    <span className="mono">Trecho encontrado</span>
                    <p>{excerpt}</p>
                  </div>
                ) : null}
                <button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
                  {expanded ? "Ocultar texto completo" : "Ver texto completo"}
                </button>
                {expanded ? <div className="studio-material-inspector__extraction" role="document">{extraction}</div> : null}
              </>
            ) : asset.extractionStatus === "failed" ? (
              <p>O processamento encontrou um problema. Você pode solicitar uma nova tentativa.</p>
            ) : asset.extractionStatus === "ready" ? (
              <p>Este material não possui texto extraído.</p>
            ) : (
              <p role="status">O material está sendo preparado em segundo plano.</p>
            )}
            {asset.extractionStatus === "failed" ? (
              <button type="button" disabled={retryState === "working"} onClick={() => void retryProcessing()}>
                {retryState === "working" ? "Solicitando nova tentativa…" : "Tentar processamento novamente"}
              </button>
            ) : null}
            {retryState === "error" ? <p role="alert">Não foi possível solicitar a nova tentativa agora.</p> : null}
          </section>

          <section className="studio-material-inspector__actions" aria-label="Ações do material">
            {canInsert ? (
              <button className="primary" type="button" disabled={insertState === "working"} onClick={() => void insertText()}>
                {insertState === "working" ? "Salvando no documento…" : "Inserir no documento"}
              </button>
            ) : null}
            {asset.kind !== "link_snapshot" ? (
              <button type="button" disabled={downloadState === "working"} onClick={() => void downloadOriginal()}>
                {downloadState === "working" ? "Preparando original…" : "Baixar original"}
              </button>
            ) : null}
            {asset.kind === "link_snapshot" && externalUrl ? (
              <button type="button" disabled={copyState === "working"} onClick={() => void copyOriginalLink()}>
                {copyState === "working" ? "Copiando link…" : "Copiar link"}
              </button>
            ) : null}
            {insertState === "success" ? <p role="status">Texto inserido e versão preservada.</p> : null}
            {insertState === "error" ? <p role="alert">O texto não foi inserido. Sua escrita atual foi preservada; tente novamente.</p> : null}
            {downloadState === "error" ? <p role="alert">Não foi possível preparar o original agora.</p> : null}
            {copyState === "success" ? <p role="status">Link copiado.</p> : null}
            {copyState === "error" ? <p role="alert">Não foi possível copiar o link agora.</p> : null}
          </section>

          <section className="studio-material-inspector__danger" aria-label="Excluir material">
            {!deleteConfirm ? (
              <button type="button" onClick={() => setDeleteConfirm(true)}>Excluir material</button>
            ) : (
              <div>
                <p><strong>Excluir este material?</strong> O documento continuará disponível.</p>
                <span>
                  <button type="button" disabled={deleteState === "working"} onClick={() => setDeleteConfirm(false)}>Cancelar</button>
                  <button className="danger" type="button" disabled={deleteState === "working"} onClick={() => void confirmDelete()}>
                    {deleteState === "working" ? "Excluindo…" : "Confirmar exclusão"}
                  </button>
                </span>
              </div>
            )}
            {deleteState === "error" ? <p role="alert">Não foi possível excluir o material agora.</p> : null}
          </section>
        </div>
      </aside>
    </div>
  );
}
