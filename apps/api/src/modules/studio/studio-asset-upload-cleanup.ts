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
    async processNext(signal?: AbortSignal): Promise<StudioAssetUploadIntent | null> {
      throwIfAborted(signal);
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
        if (intent.storageUploadId) {
          await options.objectStorage.abortAtomicUpload({
            key: intent.objectKey,
            uploadId: intent.storageUploadId
          }, { signal });
          throwIfAborted(signal);
          const session = await options.objectStorage.inspectAtomicUpload({
            key: intent.objectKey,
            uploadId: intent.storageUploadId
          }, { signal });
          if (session.active) throw new Error("STUDIO_ASSET_UPLOAD_ABORT_UNCONFIRMED");
          throwIfAborted(signal);
        }
        await options.objectStorage.delete(intent.objectKey, { signal });
        throwIfAborted(signal);
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
      throwIfAborted(signal);
      const completed = await options.repository.completeAssetUploadCleanup({
        scope,
        intentId: intent.id,
        claimToken: intent.claimToken!
      });
      return completed ? intent : null;
    }
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("STUDIO_ASSET_MAINTENANCE_ABORTED");
  }
}
