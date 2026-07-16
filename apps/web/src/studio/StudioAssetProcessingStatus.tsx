import type { StudioAsset, StudioAssetExtractionStatus } from "./studio.types";

export const studioAssetStatusPresentation: Record<StudioAssetExtractionStatus, { label: string; icon: string }> = {
  pending: { label: "Aguardando processamento", icon: "ph-clock" },
  processing: { label: "Processando", icon: "ph-circle-notch" },
  ready: { label: "Pronto", icon: "ph-check" },
  failed: { label: "Falha no processamento", icon: "ph-warning-circle" }
};

export function studioAssetNeedsPolling(asset: StudioAsset) {
  return asset.extractionStatus === "pending"
    || asset.extractionStatus === "processing"
    || (asset.extractionStatus === "failed" && asset.nextAttemptAt !== null);
}

function validTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function freshestStudioAsset(current: StudioAsset, incoming: StudioAsset) {
  if (current.id !== incoming.id) return incoming;
  const currentUpdatedAt = validTimestamp(current.updatedAt);
  const incomingUpdatedAt = validTimestamp(incoming.updatedAt);
  if (incomingUpdatedAt !== null && (currentUpdatedAt === null || incomingUpdatedAt > currentUpdatedAt)) {
    return incoming;
  }
  return current;
}
