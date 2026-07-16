import type {
  StudioAsset,
  StudioAssetExtractionStatus,
  StudioAssetKind
} from "./studio.types";

export type StudioMaterialListProps = {
  assets: StudioAsset[];
  onSelect(asset: StudioAsset): void;
  selectedAssetId?: string | null;
};

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

function formatSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
  if (sizeBytes < 1_000_000) return `${Math.round(sizeBytes / 1_000)} KB`;
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(sizeBytes / (1024 * 1024))} MB`;
}

function metadata(asset: StudioAsset) {
  const kind = materialKind(asset).label;
  const size = formatSize(asset.sizeBytes);
  return size ? `${kind} · ${size}` : kind;
}

export default function StudioMaterialList({ assets, onSelect, selectedAssetId = null }: StudioMaterialListProps) {
  if (assets.length === 0) return null;

  return (
    <ul className="studio-material-list" aria-label="Materiais do documento">
      {assets.map((asset) => {
        const kind = materialKind(asset);
        const status = statusPresentation[asset.extractionStatus];
        const selected = selectedAssetId === asset.id;
        return (
          <li key={asset.id} className="studio-material-list__item">
            <button
              type="button"
              className="studio-material-list__row"
              aria-label={`Abrir ${asset.displayName}`}
              aria-pressed={selected}
              onClick={() => onSelect(asset)}
            >
              <span className="studio-material-list__kind" aria-hidden="true">
                <i className={`ph-light ${kind.icon}`} />
              </span>
              <span className="studio-material-list__identity">
                <h3 className="studio-material-list__name">{asset.displayName}</h3>
                <span className="studio-material-list__metadata">{metadata(asset)}</span>
              </span>
              <span
                className="studio-material-list__status"
                data-status={asset.extractionStatus}
              >
                <i aria-hidden="true" className={`ph-light ${status.icon}`} />
                <span>{status.label}</span>
              </span>
              <i aria-hidden="true" className="studio-material-list__open ph-light ph-caret-right" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
