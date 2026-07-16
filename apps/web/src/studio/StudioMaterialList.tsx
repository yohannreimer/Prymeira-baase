import { useEffect, useRef, useState } from "react";
import { getStudioAsset } from "./studio-api";
import type {
  StudioAsset,
  StudioAssetExtractionStatus,
  StudioAssetKind
} from "./studio.types";

export type StudioMaterialListProps = {
  assets: StudioAsset[];
  onSelect(asset: StudioAsset): void;
  onAssetChange?(asset: StudioAsset): void;
  selectedAssetId?: string | null;
  getStatus?: (assetId: string, signal?: AbortSignal) => Promise<StudioAsset>;
  pollDelays?: readonly number[];
};

const DEFAULT_POLL_DELAYS = Array.from({ length: 18 }, (_, index) => (
  Math.min(5_000, Math.round(750 * 1.5 ** index))
));

const kindPresentation: Record<StudioAssetKind, { label: string; icon: string }> = {
  audio: { label: "Áudio", icon: "ph-waveform" },
  image: { label: "Imagem", icon: "ph-image" },
  file: { label: "Arquivo", icon: "ph-file" },
  link_snapshot: { label: "Link", icon: "ph-link" }
};

const statusPresentation: Record<StudioAssetExtractionStatus, { label: string; icon: string }> = {
  pending: { label: "Aguardando processamento", icon: "ph-clock" },
  processing: { label: "Processando", icon: "ph-circle-notch" },
  ready: { label: "Pronto", icon: "ph-check" },
  failed: { label: "Falha no processamento", icon: "ph-warning-circle" }
};

function materialKind(asset: StudioAsset) {
  if (asset.kind === "file" && asset.mimeType === "application/pdf") {
    return { label: "PDF", icon: "ph-file-pdf" };
  }
  return kindPresentation[asset.kind];
}

export function formatStudioMaterialSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
  if (sizeBytes < 1024) return `${Math.round(sizeBytes)} B`;
  const divisor = sizeBytes < 1024 * 1024 ? 1024 : 1024 * 1024;
  const unit = sizeBytes < 1024 * 1024 ? "KB" : "MB";
  const value = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(sizeBytes / divisor);
  return `${value} ${unit}`;
}

function metadata(asset: StudioAsset) {
  const kind = materialKind(asset).label;
  const size = formatStudioMaterialSize(asset.sizeBytes);
  return size ? `${kind} · ${size}` : kind;
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
  return incomingUpdatedAt !== null && (currentUpdatedAt === null || incomingUpdatedAt > currentUpdatedAt)
    ? incoming
    : current;
}

function shouldPoll(asset: StudioAsset) {
  return asset.extractionStatus === "pending"
    || asset.extractionStatus === "processing"
    || (asset.extractionStatus === "failed" && asset.nextAttemptAt !== null);
}

function wait(delay: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function StudioMaterialRow({
  asset,
  selected,
  onSelect,
  onAssetChange,
  getStatus,
  pollDelays
}: {
  asset: StudioAsset;
  selected: boolean;
  onSelect(asset: StudioAsset): void;
  onAssetChange?(asset: StudioAsset): void;
  getStatus: (assetId: string, signal?: AbortSignal) => Promise<StudioAsset>;
  pollDelays: readonly number[];
}) {
  const [current, setCurrent] = useState(asset);
  const currentRef = useRef(asset);
  const onAssetChangeRef = useRef(onAssetChange);
  onAssetChangeRef.current = onAssetChange;

  useEffect(() => {
    const adopted = freshestAsset(currentRef.current, asset);
    currentRef.current = adopted;
    setCurrent(adopted);
  }, [asset]);

  useEffect(() => {
    const controller = new AbortController();
    let latest = currentRef.current;
    void (async () => {
      if (!shouldPoll(latest)) return;
      let attempt = 0;
      while (shouldPoll(latest)) {
        const configuredDelay = pollDelays[Math.min(attempt, Math.max(0, pollDelays.length - 1))];
        const delay = Number.isFinite(configuredDelay) ? Math.max(1, configuredDelay ?? 1) : 5_000;
        await wait(delay, controller.signal);
        attempt += 1;
        let refreshed: StudioAsset;
        try {
          refreshed = await getStatus(asset.id, controller.signal);
        } catch {
          if (controller.signal.aborted) return;
          continue;
        }
        if (controller.signal.aborted) return;
        const adopted = freshestAsset(latest, refreshed);
        if (adopted !== latest) {
          latest = adopted;
          currentRef.current = adopted;
          setCurrent(adopted);
          onAssetChangeRef.current?.(adopted);
        }
        if (!shouldPoll(latest)) return;
      }
    })().catch(() => undefined);
    return () => controller.abort();
  }, [asset.id, asset.extractionStatus, asset.nextAttemptAt, getStatus, pollDelays]);

  const kind = materialKind(current);
  const status = statusPresentation[current.extractionStatus];
  return (
    <li className="studio-material-list__item">
      <button
        type="button"
        className="studio-material-list__row"
        aria-label={`Abrir ${current.displayName}`}
        aria-pressed={selected}
        onClick={() => onSelect(current)}
      >
        <span className="studio-material-list__kind" aria-hidden="true">
          <i className={`ph-light ${kind.icon}`} />
        </span>
        <span className="studio-material-list__identity">
          <strong className="studio-material-list__name">{current.displayName}</strong>
          <span className="studio-material-list__metadata">{metadata(current)}</span>
        </span>
        <span
          className="studio-material-list__status"
          data-status={current.extractionStatus}
          aria-hidden="true"
        >
          <i aria-hidden="true" className={`ph-light ${status.icon}`} />
          <span>{status.label}</span>
        </span>
        <i aria-hidden="true" className="studio-material-list__open ph-light ph-caret-right" />
      </button>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status.label}
      </span>
    </li>
  );
}

export default function StudioMaterialList({
  assets,
  onSelect,
  onAssetChange,
  selectedAssetId = null,
  getStatus = getStudioAsset,
  pollDelays = DEFAULT_POLL_DELAYS
}: StudioMaterialListProps) {
  if (assets.length === 0) return null;

  return (
    <ul className="studio-material-list" aria-label="Materiais do documento">
      {assets.map((asset) => (
        <StudioMaterialRow
          key={asset.id}
          asset={asset}
          selected={selectedAssetId === asset.id}
          onSelect={onSelect}
          onAssetChange={onAssetChange}
          getStatus={getStatus}
          pollDelays={pollDelays}
        />
      ))}
    </ul>
  );
}
