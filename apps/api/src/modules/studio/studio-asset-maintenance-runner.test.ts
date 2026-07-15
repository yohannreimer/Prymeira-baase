import { describe, expect, it, vi } from "vitest";
import { createStudioAssetMaintenanceRunner } from "./studio-asset-maintenance-runner";
import { tagStudioMaintenanceFailure } from "./studio-maintenance-budget";

const idle = { processNext: vi.fn(async () => null) };

describe("Studio asset maintenance runner", () => {
  it("gives every owner a turn in every private queue before filling the batch", async () => {
    const claimed: Record<string, string[]> = {};
    const fairProcessor = (name: string) => {
      const backlog = ["owner_a", "owner_a", "owner_a", "owner_b"];
      claimed[name] = [];
      return {
        async processNext(_signal?: AbortSignal, budget?: { excludeOwnerKeys?: readonly string[] }) {
          const index = backlog.findIndex((ownerProfileId) => !budget?.excludeOwnerKeys?.includes(`workspace/${ownerProfileId}`));
          if (index < 0) return null;
          const [ownerProfileId] = backlog.splice(index, 1);
          claimed[name]!.push(ownerProfileId!);
          return { workspaceId: "workspace", ownerProfileId };
        }
      };
    };
    const runner = createStudioAssetMaintenanceRunner({
      assetProcessor: fairProcessor("asset"),
      cleanupProcessor: fairProcessor("cleanup"),
      uploadCleanupProcessor: fairProcessor("upload-cleanup"),
      memoryProcessor: fairProcessor("index"),
      logger: { error: vi.fn() },
      maxItemsPerProcessor: 3,
      scavenge: vi.fn(async () => undefined)
    });

    await runner.runOnce();
    for (const queue of Object.values(claimed)) expect(queue.slice(0, 2)).toEqual(["owner_a", "owner_b"]);
  });

  it("isolates a failed owner and still gives the next owner a turn", async () => {
    const backlog = ["owner_a", "owner_a", "owner_b"];
    const claimed: string[] = [];
    const processor = {
      async processNext(_signal?: AbortSignal, budget?: { excludeOwnerKeys?: readonly string[] }) {
        const index = backlog.findIndex((ownerProfileId) => !budget?.excludeOwnerKeys?.includes(`workspace/${ownerProfileId}`));
        if (index < 0) return null;
        const [ownerProfileId] = backlog.splice(index, 1) as [string];
        claimed.push(ownerProfileId);
        const scope = { workspaceId: "workspace", ownerProfileId };
        if (claimed.length === 1) throw tagStudioMaintenanceFailure(new Error("broken owner item"), scope);
        return scope;
      }
    };
    const logger = { error: vi.fn() };
    const runner = createStudioAssetMaintenanceRunner({
      assetProcessor: processor,
      cleanupProcessor: idle,
      uploadCleanupProcessor: idle,
      logger,
      maxItemsPerProcessor: 2,
      scavenge: vi.fn(async () => undefined)
    });

    await runner.runOnce();

    expect(claimed).toEqual(["owner_a", "owner_b"]);
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), "Studio asset extraction maintenance failed");
  });

  it("drains optional semantic-memory and private-data reconciliation with Studio maintenance", async () => {
    const memoryProcessor = { processNext: vi.fn(async () => null) };
    const portabilityProcessor = { processNext: vi.fn(async () => null) };
    const runner = createStudioAssetMaintenanceRunner({
      assetProcessor: idle,
      cleanupProcessor: idle,
      uploadCleanupProcessor: idle,
      memoryProcessor,
      portabilityProcessor,
      logger: { error: vi.fn() },
      scavenge: vi.fn(async () => undefined)
    });
    await runner.runOnce();
    expect(memoryProcessor.processNext).toHaveBeenCalledTimes(1);
    expect(portabilityProcessor.processNext).toHaveBeenCalledTimes(1);
  });

  it("runs single-flight drains with a bounded item count", async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const processor = {
      processNext: vi.fn()
        .mockImplementationOnce(async () => { await first; return {}; })
        .mockResolvedValue({})
    };
    const runner = createStudioAssetMaintenanceRunner({
      assetProcessor: processor,
      cleanupProcessor: idle,
      uploadCleanupProcessor: idle,
      logger: { error: vi.fn() },
      maxItemsPerProcessor: 2,
      scavenge: vi.fn(async () => undefined)
    });
    const left = runner.runOnce();
    const right = runner.runOnce();
    expect(left).toBe(right);
    release();
    await left;
    expect(processor.processNext).toHaveBeenCalledTimes(2);
  });

  it("starts immediately, survives errors, schedules without overlap, and awaits stop", async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      const processor = {
        processNext: vi.fn()
          .mockRejectedValueOnce(new Error("worker failed"))
          .mockResolvedValueOnce(null)
          .mockImplementationOnce(async () => { await blocked; return null; })
      };
      const logger = { error: vi.fn() };
      const scavenge = vi.fn(async () => undefined);
      const runner = createStudioAssetMaintenanceRunner({
        assetProcessor: processor,
        cleanupProcessor: { processNext: vi.fn(async () => null) },
        uploadCleanupProcessor: { processNext: vi.fn(async () => null) },
        logger,
        maxItemsPerProcessor: 2,
        intervalMs: 100,
        jitterRatio: 0,
        scavenge
      });
      runner.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(scavenge).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(expect.any(Error), expect.stringContaining("maintenance failed"));
      expect(processor.processNext).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(100);
      expect(processor.processNext).toHaveBeenCalledTimes(3);
      let stopped = false;
      const stopping = runner.stop().then(() => { stopped = true; });
      await Promise.resolve();
      expect(stopped).toBe(false);
      release();
      await stopping;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(processor.processNext).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts stalled work and resolves stop within the configured shutdown bound", async () => {
    let observedSignal: AbortSignal | undefined;
    const processor = {
      processNext: vi.fn((signal?: AbortSignal) => {
        observedSignal = signal;
        return new Promise<null>(() => undefined);
      })
    };
    const runner = createStudioAssetMaintenanceRunner({
      assetProcessor: processor,
      cleanupProcessor: idle,
      uploadCleanupProcessor: idle,
      logger: { error: vi.fn() },
      shutdownTimeoutMs: 25,
      perItemTimeoutMs: 60_000,
      scavenge: vi.fn(async () => undefined)
    });
    runner.start();
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    await expect(runner.stop()).resolves.toBeUndefined();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("aborts an item at its deadline and periodically rotates scavenger cursors", async () => {
    vi.useFakeTimers();
    try {
      const seenCursors: Array<string | null | undefined> = [];
      let stalledSignal: AbortSignal | undefined;
      const processor = {
        processNext: vi.fn((signal?: AbortSignal) => {
          stalledSignal = signal;
          return new Promise<null>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        })
      };
      const scavenge = vi.fn(async (input?: { cursor?: string | null }) => {
        seenCursors.push(input?.cursor);
        return { nextCursor: seenCursors.length === 1 ? "batch-1" : null };
      });
      const runner = createStudioAssetMaintenanceRunner({
        assetProcessor: processor,
        cleanupProcessor: idle,
        uploadCleanupProcessor: idle,
        logger: { error: vi.fn() },
        maxItemsPerProcessor: 1,
        intervalMs: 100,
        jitterRatio: 0,
        perItemTimeoutMs: 10,
        scavengeIntervalMs: 100,
        scavenge
      });
      runner.start();
      await vi.advanceTimersByTimeAsync(25);
      expect(stalledSignal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(120);
      expect(scavenge).toHaveBeenCalledTimes(2);
      expect(seenCursors).toEqual([null, "batch-1"]);
      await runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not abandon timed-out memory work or overlap the next maintenance run", async () => {
    vi.useFakeTimers();
    try {
      let active = 0;
      let maximumActive = 0;
      const memoryProcessor = {
        processNext: vi.fn((signal?: AbortSignal) => new Promise<null>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          signal?.addEventListener("abort", () => {
            setTimeout(() => {
              active -= 1;
              resolve(null);
            }, 20);
          }, { once: true });
        }))
      };
      const runner = createStudioAssetMaintenanceRunner({
        assetProcessor: idle,
        cleanupProcessor: idle,
        uploadCleanupProcessor: idle,
        memoryProcessor,
        logger: { error: vi.fn() },
        maxItemsPerProcessor: 1,
        perItemTimeoutMs: 10,
        scavenge: vi.fn(async () => undefined)
      });
      const first = runner.runOnce();
      await vi.advanceTimersByTimeAsync(10);
      const second = runner.runOnce();
      expect(second).toBe(first);
      expect(memoryProcessor.processNext).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20);
      await first;
      expect(maximumActive).toBe(1);
      expect(active).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
