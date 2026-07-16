import { tagStudioMaintenanceFailure, type StudioMaintenanceClaimBudget } from "./studio-maintenance-budget";
import type { StudioRepository, StudioService, StudioTrashCleanupClaim } from "./studio.types";

export const STUDIO_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export function createStudioTrashCleanupProcessor(options: {
  repository: StudioRepository;
  service: Pick<StudioService, "permanentlyDeleteDocument">;
  now?: () => string;
  leaseMs?: number;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  const leaseMs = options.leaseMs ?? 120_000;
  return {
    async processNext(signal?: AbortSignal, budget?: StudioMaintenanceClaimBudget): Promise<StudioTrashCleanupClaim | null> {
      throwIfAborted(signal);
      const current = now();
      const cutoff = new Date(new Date(current).getTime() - STUDIO_TRASH_RETENTION_MS).toISOString();
      const claim = await options.repository.claimNextExpiredTrash(
        cutoff, current, leaseMs, budget?.excludeOwnerKeys
      );
      if (!claim) return null;
      const scope = { workspaceId: claim.workspaceId, ownerProfileId: claim.ownerProfileId };
      try {
        throwIfAborted(signal);
        await options.service.permanentlyDeleteDocument(scope, scope.ownerProfileId, claim.id);
        return claim;
      } catch (error) {
        throw tagStudioMaintenanceFailure(error, scope);
      }
    }
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("STUDIO_TRASH_CLEANUP_ABORTED");
}
