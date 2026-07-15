import type { ObjectStorage } from "../../storage/object-storage";
import { tagStudioMaintenanceFailure, type StudioMaintenanceClaimBudget } from "./studio-maintenance-budget";
import type { StudioAssetCleanupJob, StudioOwnerScope, StudioRepository } from "./studio.types";

export function createStudioAssetCleanupProcessor(options: {
  repository: StudioRepository;
  objectStorage: ObjectStorage;
  now?: () => string;
  leaseMs?: number;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  const leaseMs = options.leaseMs ?? 120_000;
  return {
    async processNext(signal?: AbortSignal, budget?: StudioMaintenanceClaimBudget): Promise<StudioAssetCleanupJob | null> {
      throwIfAborted(signal);
      const job = await options.repository.claimNextAssetCleanup(now(), leaseMs, budget?.excludeOwnerKeys);
      if (!job) return null;
      return await runClaimedJob(job, false, signal) ? job : null;
    },

    async processJob(scope: StudioOwnerScope, jobId: string, signal?: AbortSignal): Promise<boolean> {
      throwIfAborted(signal);
      const job = await options.repository.claimAssetCleanup(scope, jobId, now(), leaseMs);
      if (!job) return false;
      return runClaimedJob(job, true, signal);
    }
  };

  async function runClaimedJob(
    job: StudioAssetCleanupJob,
    suppressErrors: boolean,
    signal?: AbortSignal
  ): Promise<boolean> {
    const scope = { workspaceId: job.workspaceId, ownerProfileId: job.ownerProfileId };
    try {
      try {
        if (job.objectKey) await options.objectStorage.delete(job.objectKey, { signal });
        throwIfAborted(signal);
      } catch (error) {
        const nextAttemptAt = new Date(
          new Date(now()).getTime() + Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, job.attemptCount - 1))
        ).toISOString();
        await options.repository.failAssetCleanup({
          scope,
          jobId: job.id,
          claimToken: job.claimToken!,
          lastErrorCode: "STUDIO_ASSET_STORAGE_DELETE_FAILED",
          nextAttemptAt
        });
        throw error;
      }
      throwIfAborted(signal);
      const completed = await options.repository.completeAssetCleanup({
        scope,
        jobId: job.id,
        claimToken: job.claimToken!
      });
      return completed;
    } catch (error) {
      if (suppressErrors) return false;
      throw tagStudioMaintenanceFailure(error, scope);
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("STUDIO_ASSET_MAINTENANCE_ABORTED");
  }
}
