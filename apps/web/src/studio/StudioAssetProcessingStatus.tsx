import { useEffect, useRef, useState } from "react";
import {
  getStudioAsset,
  getStudioAssetDownload,
  retryStudioAsset
} from "./studio-api";
import type { StudioAsset } from "./studio.types";

type Download = { url: string; expiresInSeconds: number };

type StudioAssetProcessingStatusProps = {
  asset: StudioAsset;
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

export default function StudioAssetProcessingStatus({
  asset,
  getStatus = getStudioAsset,
  retry = retryStudioAsset,
  getDownload = getStudioAssetDownload,
  pollDelays = DEFAULT_POLL_DELAYS
}: StudioAssetProcessingStatusProps) {
  const [current, setCurrent] = useState(asset);
  const [download, setDownload] = useState<Download | null>(null);
  const [downloadError, setDownloadError] = useState(false);
  const [downloadCycle, setDownloadCycle] = useState(0);
  const [pollError, setPollError] = useState(false);
  const [pollExhausted, setPollExhausted] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const [pollCycle, setPollCycle] = useState(0);
  const pollControllerRef = useRef<AbortController | null>(null);
  const retryControllerRef = useRef<AbortController | null>(null);
  const retryingRef = useRef(false);

  useEffect(() => {
    setCurrent(asset);
  }, [asset]);

  useEffect(() => {
    if (asset.kind === "link_snapshot") {
      setDownload(null);
      setDownloadError(false);
      return;
    }
    const controller = new AbortController();
    setDownloadError(false);
    void getDownload(asset.id, controller.signal).then((result) => {
      if (!controller.signal.aborted) setDownload(result);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setDownload(null);
        setDownloadError(true);
      }
    });
    return () => controller.abort();
  }, [asset.id, asset.kind, downloadCycle, getDownload]);

  useEffect(() => {
    const controller = new AbortController();
    pollControllerRef.current = controller;
    setPollError(false);
    setPollExhausted(false);
    let latest = current;
    void (async () => {
      if (!shouldPoll(latest)) return;
      for (const delay of pollDelays) {
        await wait(delay, controller.signal);
        latest = await getStatus(asset.id, controller.signal);
        if (controller.signal.aborted) return;
        setCurrent(latest);
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
    // current is deliberately restarted through pollCycle after a manual action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id, getStatus, pollCycle, pollDelays]);

  useEffect(() => () => retryControllerRef.current?.abort(), []);

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
      setCurrent(retried);
      setPollCycle((cycle) => cycle + 1);
    } catch {
      if (!controller.signal.aborted) setRetryError(true);
    } finally {
      retryingRef.current = false;
      if (retryControllerRef.current === controller) retryControllerRef.current = null;
      if (!controller.signal.aborted) setRetrying(false);
    }
  }

  const isAudio = current.kind === "audio";
  const originalLabel = isAudio ? "Baixar áudio original" : "Baixar arquivo original";

  return (
    <section className="studio-asset-status" aria-labelledby="studio-asset-status-title">
      <div className="studio-asset-status__heading">
        <div>
          <p className="mono">Material original preservado</p>
          <h3 id="studio-asset-status-title">{current.displayName}</h3>
        </div>
        <span data-status={current.extractionStatus}>
          {current.extractionStatus === "ready" ? "Pronto"
            : current.extractionStatus === "failed" ? "Precisa de atenção"
              : "Preparando"}
        </span>
      </div>

      {download ? (
        <div className="studio-asset-status__original">
          {isAudio ? (
            <audio
              controls
              preload="metadata"
              src={download.url}
              onError={() => {
                setDownload(null);
                setDownloadError(true);
              }}
              aria-label={`Ouvir áudio original: ${current.displayName}`}
              data-testid="studio-audio-player"
            />
          ) : null}
          <a href={download.url} target="_blank" rel="noreferrer" aria-label={originalLabel}>
            <i aria-hidden="true" className="ph-light ph-download-simple" />
            {originalLabel}
          </a>
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
      {downloadError ? (
        <button className="studio-asset-status__download-retry" type="button" onClick={() => setDownloadCycle((cycle) => cycle + 1)}>
          {isAudio ? "Carregar áudio original" : "Carregar arquivo original"}
        </button>
      ) : null}

      <div className="studio-asset-status__processing" role="status" aria-live="polite">
        {current.extractionStatus === "ready" ? (
          current.extractedText
            ? <div className="studio-asset-transcript"><strong>Transcrição</strong><p>{current.extractedText}</p></div>
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
    </section>
  );
}
