import type { ObjectStorage } from "../../storage/object-storage";
import type { StudioAssetCleanupJob, StudioRepository } from "./studio.types";

export function createStudioAssetCleanupProcessor(options: {
  repository: StudioRepository;
  objectStorage: ObjectStorage;
  now?: () => string;
  leaseMs?: number;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  const leaseMs = options.leaseMs ?? 120_000;
  return {
    async processNext(): Promise<StudioAssetCleanupJob | null> {
      const job = await options.repository.claimNextAssetCleanup(now(), leaseMs);
      if (!job) return null;
      try {
        if (job.objectKey) await options.objectStorage.delete(job.objectKey);
      } catch (error) {
        const nextAttemptAt = new Date(
          new Date(now()).getTime() + Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, job.attemptCount - 1))
        ).toISOString();
        await options.repository.failAssetCleanup({
          scope: { workspaceId: job.workspaceId, ownerProfileId: job.ownerProfileId },
          jobId: job.id,
          claimToken: job.claimToken!,
          lastErrorCode: "STUDIO_ASSET_STORAGE_DELETE_FAILED",
          nextAttemptAt
        });
        throw error;
      }
      const completed = await options.repository.completeAssetCleanup({
        scope: { workspaceId: job.workspaceId, ownerProfileId: job.ownerProfileId },
        jobId: job.id,
        claimToken: job.claimToken!
      });
      return completed ? job : null;
    }
  };
}
