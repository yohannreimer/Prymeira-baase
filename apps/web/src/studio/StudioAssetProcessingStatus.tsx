import { useEffect, useId, useRef, useState } from "react";
import {
  getStudioAsset,
  getStudioAssetDownload,
  retryStudioAsset
} from "./studio-api";
import type { StudioAsset } from "./studio.types";

type Download = { url: string; expiresInSeconds: number };

type StudioAssetProcessingStatusProps = {
  asset: StudioAsset;
  onAssetChange?: (asset: StudioAsset) => void;
  onInsertTranscript?: (text: string) => boolean | Promise<boolean>;
  getStatus?: (assetId: string, signal?: AbortSignal) => Promise<StudioAsset>;
  retry?: (assetId: string, signal?: AbortSignal) => Promise<StudioAsset>;
  getDownload?: (assetId: string, signal?: AbortSignal) => Promise<Download>;
  pollDelays?: readonly number[];
};

const DEFAULT_POLL_DELAYS = Array.from({ length: 18 }, (_, index) => (
  Math.min(5_000, Math.round(750 * 1.5 ** index))
));

function shouldPoll(asset: StudioAsset) {
  return asset.extractionStatus === "pending"
    || asset.extractionStatus === "processing"
    || (asset.extractionStatus === "failed" && asset.nextAttemptAt !== null);
}

function wait(delay: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function validTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function freshestAsset(current: StudioAsset, incoming: StudioAsset) {
  if (current.id !== incoming.id) return incoming;
  const currentUpdatedAt = validTimestamp(current.updatedAt);
  const incomingUpdatedAt = validTimestamp(incoming.updatedAt);
  if (incomingUpdatedAt !== null && (currentUpdatedAt === null || incomingUpdatedAt > currentUpdatedAt)) {
    return incoming;
  }
  return current;
}

export default function StudioAssetProcessingStatus({
  asset,
  onAssetChange,
  onInsertTranscript,
  getStatus = getStudioAsset,
  retry = retryStudioAsset,
  getDownload = getStudioAssetDownload,
  pollDelays = DEFAULT_POLL_DELAYS
}: StudioAssetProcessingStatusProps) {
  const headingId = useId();
  const [current, setCurrent] = useState(asset);
  const [download, setDownload] = useState<Download | null>(null);
  const [audioDownloadError, setAudioDownloadError] = useState(false);
  const [audioDownloadCycle, setAudioDownloadCycle] = useState(0);
  const [fileDownloadLoading, setFileDownloadLoading] = useState(false);
  const [fileDownloadError, setFileDownloadError] = useState(false);
  const [pollError, setPollError] = useState(false);
  const [pollExhausted, setPollExhausted] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const [pollCycle, setPollCycle] = useState(0);
  const [insertionState, setInsertionState] = useState<"idle" | "inserting" | "inserted" | "error">("idle");
  const pollControllerRef = useRef<AbortController | null>(null);
  const retryControllerRef = useRef<AbortController | null>(null);
  const fileDownloadControllerRef = useRef<AbortController | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement>(null);
  const pendingAudioDownloadRef = useRef<Download | null>(null);
  const pendingAudioSeekRef = useRef<{ url: string; position: number } | null>(null);
  const retryingRef = useRef(false);
  const fileDownloadingRef = useRef(false);
  const insertingRef = useRef(false);
  const insertionGenerationRef = useRef(0);
  const insertionCallbackRef = useRef(onInsertTranscript);
  const assetChangeCallbackRef = useRef(onAssetChange);
  const currentRef = useRef(asset);
  assetChangeCallbackRef.current = onAssetChange;

  function resetInsertion() {
    insertionGenerationRef.current += 1;
    insertingRef.current = false;
    setInsertionState("idle");
  }

  function adoptCurrent(next: StudioAsset, notifyParent = false) {
    const previous = currentRef.current;
    const adopted = freshestAsset(previous, next);
    if (adopted === previous) return previous;
    if (previous.id !== adopted.id
      || previous.extractionStatus !== adopted.extractionStatus
      || previous.extractedText !== adopted.extractedText) {
      resetInsertion();
    }
    currentRef.current = adopted;
    setCurrent(adopted);
    if (notifyParent) assetChangeCallbackRef.current?.(adopted);
    return adopted;
  }

  useEffect(() => {
    adoptCurrent(asset);
  }, [asset]);

  useEffect(() => {
    if (insertionCallbackRef.current === onInsertTranscript) return;
    insertionCallbackRef.current = onInsertTranscript;
    resetInsertion();
  }, [onInsertTranscript]);

  useEffect(() => {
    if (asset.kind !== "audio") {
      setDownload(null);
      setAudioDownloadError(false);
      return;
    }
    const controller = new AbortController();
    let renewalTimer: ReturnType<typeof setTimeout> | null = null;
    setAudioDownloadError(false);
    void getDownload(asset.id, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      const player = audioPlayerRef.current;
      if (player && !player.paused && !player.ended) {
        pendingAudioDownloadRef.current = result;
      } else {
        pendingAudioDownloadRef.current = null;
        pendingAudioSeekRef.current = null;
        setDownload(result);
      }
      const lifetimeMs = Math.max(0, result.expiresInSeconds * 1_000);
      if (lifetimeMs > 0) {
        const renewalLeadMs = Math.min(30_000, Math.max(1_000, lifetimeMs * 0.1));
        const renewalDelayMs = Math.max(1_000, lifetimeMs - renewalLeadMs);
        renewalTimer = setTimeout(() => {
          if (controller.signal.aborted) return;
          setAudioDownloadCycle((cycle) => cycle + 1);
        }, renewalDelayMs);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        pendingAudioDownloadRef.current = null;
        if (!audioPlayerRef.current) setDownload(null);
        setAudioDownloadError(true);
      }
    });
    return () => {
      controller.abort();
      if (renewalTimer !== null) clearTimeout(renewalTimer);
    };
  }, [asset.id, asset.kind, audioDownloadCycle, getDownload]);

  useEffect(() => {
    pendingAudioDownloadRef.current = null;
    pendingAudioSeekRef.current = null;
    return () => {
      pendingAudioDownloadRef.current = null;
      pendingAudioSeekRef.current = null;
    };
  }, [asset.id, asset.kind]);

  useEffect(() => {
    setFileDownloadError(false);
    setFileDownloadLoading(false);
    return () => {
      fileDownloadControllerRef.current?.abort();
      fileDownloadControllerRef.current = null;
      fileDownloadingRef.current = false;
    };
  }, [asset.id, asset.kind]);

  useEffect(() => {
    const controller = new AbortController();
    pollControllerRef.current = controller;
    setPollError(false);
    setPollExhausted(false);
    let latest = currentRef.current;
    void (async () => {
      if (!shouldPoll(latest)) return;
      for (const delay of pollDelays) {
        await wait(delay, controller.signal);
        const refreshed = await getStatus(asset.id, controller.signal);
        if (controller.signal.aborted) return;
        latest = adoptCurrent(refreshed, true);
        if (!shouldPoll(latest)) return;
      }
      if (!controller.signal.aborted) setPollExhausted(true);
    })().catch(() => {
      if (!controller.signal.aborted) setPollError(true);
    });
    return () => {
      controller.abort();
      if (pollControllerRef.current === controller) pollControllerRef.current = null;
    };
  }, [
    asset.id,
    asset.extractionStatus,
    asset.updatedAt,
    asset.nextAttemptAt,
    getStatus,
    pollCycle,
    pollDelays
  ]);

  useEffect(() => () => {
    retryControllerRef.current?.abort();
    fileDownloadControllerRef.current?.abort();
    insertionGenerationRef.current += 1;
    insertingRef.current = false;
  }, []);

  async function downloadOriginal() {
    const target = currentRef.current;
    if (target.kind === "audio" || target.kind === "link_snapshot" || fileDownloadingRef.current) return;
    fileDownloadingRef.current = true;
    const controller = new AbortController();
    fileDownloadControllerRef.current = controller;
    setFileDownloadLoading(true);
    setFileDownloadError(false);
    try {
      const freshDownload = await getDownload(target.id, controller.signal);
      if (controller.signal.aborted) return;
      const anchor = document.createElement("a");
      anchor.href = freshDownload.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.download = target.displayName;
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
    } catch {
      if (!controller.signal.aborted) setFileDownloadError(true);
    } finally {
      if (fileDownloadControllerRef.current === controller) fileDownloadControllerRef.current = null;
      fileDownloadingRef.current = false;
      if (!controller.signal.aborted) setFileDownloadLoading(false);
    }
  }

  function adoptPendingAudioDownload(ended = false) {
    const pendingDownload = pendingAudioDownloadRef.current;
    if (!pendingDownload) return;
    const player = audioPlayerRef.current;
    const position = ended || player?.ended
      ? 0
      : player && Number.isFinite(player.currentTime) ? Math.max(0, player.currentTime) : 0;
    pendingAudioDownloadRef.current = null;
    pendingAudioSeekRef.current = { url: pendingDownload.url, position };
    setAudioDownloadError(false);
    setDownload(pendingDownload);
  }

  function restorePendingAudioPosition() {
    const pendingSeek = pendingAudioSeekRef.current;
    const player = audioPlayerRef.current;
    if (!pendingSeek || !player || download?.url !== pendingSeek.url) return;
    pendingAudioSeekRef.current = null;
    try {
      player.currentTime = pendingSeek.position;
    } catch {
      // The next metadata event can retry if the browser is not seekable yet.
      pendingAudioSeekRef.current = pendingSeek;
    }
  }

  async function retryProcessing() {
    if (retryingRef.current) return;
    retryingRef.current = true;
    pollControllerRef.current?.abort();
    const controller = new AbortController();
    retryControllerRef.current = controller;
    setRetrying(true);
    setRetryError(false);
    try {
      const retried = await retry(current.id, controller.signal);
      if (controller.signal.aborted) return;
      adoptCurrent(retried, true);
      setPollCycle((cycle) => cycle + 1);
    } catch {
      if (!controller.signal.aborted) setRetryError(true);
    } finally {
      retryingRef.current = false;
      if (retryControllerRef.current === controller) retryControllerRef.current = null;
      if (!controller.signal.aborted) setRetrying(false);
    }
  }

  async function insertTranscript() {
    if (insertingRef.current || !onInsertTranscript || !current.extractedText) return;
    const generation = insertionGenerationRef.current;
    const callback = onInsertTranscript;
    const transcript = current.extractedText;
    insertingRef.current = true;
    setInsertionState("inserting");
    try {
      const inserted = await callback(transcript);
      if (generation !== insertionGenerationRef.current) return;
      setInsertionState(inserted ? "inserted" : "error");
    } catch {
      if (generation === insertionGenerationRef.current) setInsertionState("error");
    } finally {
      if (generation === insertionGenerationRef.current) insertingRef.current = false;
    }
  }

  const isAudio = current.kind === "audio";
  const originalLabel = isAudio ? "Baixar áudio original" : "Baixar arquivo original";
  const extractedContentLabel = isAudio ? "Transcrição" : "Conteúdo extraído";
  const canInsertTranscript = isAudio
    && current.extractionStatus === "ready"
    && Boolean(current.extractedText?.trim())
    && Boolean(onInsertTranscript);

  return (
    <section className="studio-asset-status" aria-labelledby={headingId}>
      <div className="studio-asset-status__heading">
        <div>
          <p className="mono">Material original preservado</p>
          <h3 id={headingId}>{current.displayName}</h3>
        </div>
        <span data-status={current.extractionStatus}>
          {current.extractionStatus === "ready" ? "Pronto"
            : current.extractionStatus === "failed" ? "Precisa de atenção"
              : "Preparando"}
        </span>
      </div>

      {isAudio && download ? (
        <div className="studio-asset-status__original">
          <audio
            ref={audioPlayerRef}
            controls
            preload="metadata"
            src={download.url}
            onError={() => {
              pendingAudioDownloadRef.current = null;
              pendingAudioSeekRef.current = null;
              setDownload(null);
              setAudioDownloadError(true);
            }}
            onPause={() => adoptPendingAudioDownload(false)}
            onEnded={() => adoptPendingAudioDownload(true)}
            onLoadedMetadata={restorePendingAudioPosition}
            aria-label={`Ouvir áudio original: ${current.displayName}`}
            data-testid="studio-audio-player"
          />
          <a href={download.url} target="_blank" rel="noreferrer" aria-label={originalLabel}>
            <i aria-hidden="true" className="ph-light ph-download-simple" />
            {originalLabel}
          </a>
        </div>
      ) : null}
      {!isAudio && current.kind !== "link_snapshot" ? (
        <div className="studio-asset-status__original">
          <button
            type="button"
            aria-label={originalLabel}
            disabled={fileDownloadLoading}
            onClick={() => void downloadOriginal()}
          >
            <i aria-hidden="true" className="ph-light ph-download-simple" />
            {fileDownloadLoading ? "Preparando download…" : originalLabel}
          </button>
        </div>
      ) : null}
      {current.kind === "link_snapshot" && current.sourceUrl ? (
        <div className="studio-asset-status__original">
          <a href={current.sourceUrl} target="_blank" rel="noreferrer">
            <i aria-hidden="true" className="ph-light ph-arrow-square-out" />
            Abrir link original
          </a>
        </div>
      ) : null}
      {audioDownloadError && isAudio ? (
        <button className="studio-asset-status__download-retry" type="button" onClick={() => setAudioDownloadCycle((cycle) => cycle + 1)}>
          Carregar áudio original
        </button>
      ) : null}
      {fileDownloadError ? (
        <p role="alert" className="studio-asset-status__error">
          Não foi possível preparar o download. Tente novamente.
        </p>
      ) : null}

      <div className="studio-asset-status__processing" role="status" aria-live="polite">
        {current.extractionStatus === "ready" ? (
          current.extractedText
            ? <div className="studio-asset-transcript"><strong>{extractedContentLabel}</strong><p>{current.extractedText}</p></div>
            : <p>O material está pronto e o original continua disponível acima.</p>
        ) : current.extractionStatus === "failed" ? (
          <div>
            <strong>{isAudio ? "Não conseguimos transcrever este áudio." : "Não conseguimos processar este material."}</strong>
            <p>{current.nextAttemptAt
              ? "Há uma nova tentativa automática agendada. Você também pode tentar agora."
              : "O original continua guardado e pode ser processado novamente."}</p>
            <button type="button" onClick={() => void retryProcessing()} disabled={retrying}>
              {retrying ? "Solicitando…" : isAudio ? "Tentar transcrição novamente" : "Tentar processamento novamente"}
            </button>
          </div>
        ) : (
          <p>{isAudio ? "Transcrevendo o áudio em segundo plano…" : "Preparando o material em segundo plano…"}</p>
        )}

        {pollError || pollExhausted ? (
          <div className="studio-asset-status__refresh">
            <span>{pollError
              ? "Não foi possível atualizar o estado agora."
              : "O processamento continua em segundo plano."}</span>
            <button type="button" onClick={() => setPollCycle((cycle) => cycle + 1)}>Atualizar estado</button>
          </div>
        ) : null}
        {retryError ? <p className="studio-asset-status__error">Não foi possível solicitar a nova tentativa agora.</p> : null}
      </div>
      {canInsertTranscript ? (
        <div className="studio-asset-transcript__insert">
          <button
            type="button"
            disabled={insertionState === "inserting"}
            onClick={() => void insertTranscript()}
          >
            {insertionState === "inserting" ? "Adicionando…" : "Adicionar transcrição ao documento"}
          </button>
          {insertionState === "inserted" ? (
            <p role="status" aria-live="polite">Transcrição adicionada ao documento</p>
          ) : insertionState === "error" ? (
            <p role="alert">A transcrição não foi adicionada. Você pode tentar novamente.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
