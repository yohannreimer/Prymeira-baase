import type { StudioOwnerScope } from "./studio.types";

export type StudioMaintenanceClaimBudget = { excludeOwnerKeys?: readonly string[] };

export function studioMaintenanceOwnerKey(scope: StudioOwnerScope) {
  return `${scope.workspaceId}/${scope.ownerProfileId}`;
}

export function tagStudioMaintenanceFailure(error: unknown, scope: StudioOwnerScope) {
  const failure = error instanceof Error ? error : new Error("STUDIO_MAINTENANCE_ITEM_FAILED", { cause: error });
  Object.defineProperty(failure, "studioMaintenanceOwnerKey", {
    value: studioMaintenanceOwnerKey(scope),
    configurable: true
  });
  return failure;
}

export function readStudioMaintenanceOwnerKey(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const tagged = value as { studioMaintenanceOwnerKey?: unknown; workspaceId?: unknown; ownerProfileId?: unknown };
  if (typeof tagged.studioMaintenanceOwnerKey === "string") return tagged.studioMaintenanceOwnerKey;
  return typeof tagged.workspaceId === "string" && typeof tagged.ownerProfileId === "string"
    ? studioMaintenanceOwnerKey({ workspaceId: tagged.workspaceId, ownerProfileId: tagged.ownerProfileId })
    : null;
}
