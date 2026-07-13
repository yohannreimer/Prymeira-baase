import type { ObjectStorage } from "../../storage/object-storage";
import type { StudioAssetUploadIntent, StudioRepository } from "./studio.types";

export function createStudioAssetUploadCleanupProcessor(options: {
  repository: StudioRepository;
  objectStorage: ObjectStorage;
  now?: () => string;
  leaseMs?: number;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  const leaseMs = options.leaseMs ?? 120_000;
  return {
    async processNext(): Promise<StudioAssetUploadIntent | null> {
      const intent = await options.repository.claimNextAssetUploadCleanup(now(), leaseMs);
      if (!intent) return null;
      const scope = { workspaceId: intent.workspaceId, ownerProfileId: intent.ownerProfileId };
      const existing = await options.repository.resolveClaimedAssetUploadIntent({
        scope,
        intentId: intent.id,
        claimToken: intent.claimToken!
      });
      if (existing) return intent;
      try {
        await options.objectStorage.delete(intent.objectKey);
      } catch (error) {
        const nextAttemptAt = new Date(
          new Date(now()).getTime() + Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, intent.attemptCount - 1))
        ).toISOString();
        await options.repository.failAssetUploadCleanup({
          scope,
          intentId: intent.id,
          claimToken: intent.claimToken!,
          lastErrorCode: "STUDIO_ASSET_UPLOAD_CLEANUP_FAILED",
          nextAttemptAt
        });
        throw error;
      }
      const completed = await options.repository.completeAssetUploadCleanup({
        scope,
        intentId: intent.id,
        claimToken: intent.claimToken!
      });
      return completed ? intent : null;
    }
  };
}
