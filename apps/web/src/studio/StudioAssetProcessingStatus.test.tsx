import { describe, expect, it } from "vitest";
import {
  freshestStudioAsset,
  studioAssetNeedsPolling,
  studioAssetStatusPresentation
} from "./StudioAssetProcessingStatus";
import type { StudioAsset } from "./studio.types";

describe("Studio asset status primitives", () => {
  it("keeps the compact material status vocabulary in one place", () => {
    expect(studioAssetStatusPresentation).toEqual({
      pending: { label: "Aguardando processamento", icon: "ph-clock" },
      processing: { label: "Processando", icon: "ph-circle-notch" },
      ready: { label: "Pronto", icon: "ph-check" },
      failed: { label: "Falha no processamento", icon: "ph-warning-circle" }
    });
  });

  it.each([
    ["pending", null, true],
    ["processing", null, true],
    ["failed", "2026-07-16T12:10:00.000Z", true],
    ["failed", null, false],
    ["ready", null, false]
  ] as const)("decides polling for %s with next attempt %s", (extractionStatus, nextAttemptAt, expected) => {
    expect(studioAssetNeedsPolling(asset({ extractionStatus, nextAttemptAt }))).toBe(expected);
  });

  it("adopts a different asset and only adopts a newer snapshot of the same asset", () => {
    const current = asset({ updatedAt: "2026-07-16T12:05:00.000Z", extractedText: "Atual" });
    const older = asset({ updatedAt: "2026-07-16T12:04:00.000Z", extractedText: "Antigo" });
    const newer = asset({ updatedAt: "2026-07-16T12:06:00.000Z", extractedText: "Novo" });
    const other = asset({ id: "asset_b", updatedAt: "2026-07-16T11:00:00.000Z" });

    expect(freshestStudioAsset(current, older)).toBe(current);
    expect(freshestStudioAsset(current, newer)).toBe(newer);
    expect(freshestStudioAsset(current, other)).toBe(other);
  });

  it("does not replace a valid current snapshot with an invalid or equal timestamp", () => {
    const current = asset({ updatedAt: "2026-07-16T12:05:00.000Z" });
    expect(freshestStudioAsset(current, asset({ updatedAt: "invalid" }))).toBe(current);
    expect(freshestStudioAsset(current, asset({ updatedAt: current.updatedAt }))).toBe(current);
  });
});

function asset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: "asset_a",
    workspaceId: "workspace_a",
    ownerProfileId: "owner_a",
    documentId: "document_a",
    idempotencyKey: null,
    kind: "file",
    displayName: "Material.pdf",
    sourceUrl: null,
    finalUrl: null,
    mimeType: "application/pdf",
    sizeBytes: 2048,
    extractionStatus: "ready",
    extractedText: "Texto atual",
    lastErrorCode: null,
    attemptCount: 1,
    nextAttemptAt: null,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:05:00.000Z",
    ...overrides
  };
}
