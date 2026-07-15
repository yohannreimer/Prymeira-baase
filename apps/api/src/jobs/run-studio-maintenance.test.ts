import { describe, expect, it, vi } from "vitest";
import { runStudioMaintenanceOnce } from "./run-studio-maintenance";

describe("runStudioMaintenanceOnce", () => {
  it("drains bounded private queues before preparing due rituals", async () => {
    const order: string[] = [];
    const processor = (name: string) => ({
      processNext: vi.fn(async () => {
        order.push(name);
        return null;
      })
    });
    const runDuePreparations = vi.fn(async () => {
      order.push("proactivity");
      return { claimed: 1, prepared: 1, failed: 0 };
    });

    const result = await runStudioMaintenanceOnce({
      studioAssetProcessor: processor("assets"),
      studioAssetCleanupProcessor: processor("asset-cleanup"),
      studioAssetUploadCleanupProcessor: processor("upload-cleanup"),
      studioMemoryIndexProcessor: processor("memory-index"),
      studioProactivityService: { runDuePreparations },
      log: { error: vi.fn() }
    }, {
      now: () => new Date("2026-07-14T12:00:00.000Z"),
      proactivityLimit: 7,
      scavenge: vi.fn(async () => undefined)
    });

    expect(order).toEqual([
      "assets",
      "asset-cleanup",
      "upload-cleanup",
      "memory-index",
      "proactivity"
    ]);
    expect(runDuePreparations).toHaveBeenCalledWith(new Date("2026-07-14T12:00:00.000Z"), 7);
    expect(result).toEqual({ claimed: 1, prepared: 1, failed: 0 });
  });

  it("isolates item failures but surfaces proactivity infrastructure failures", async () => {
    const logger = { error: vi.fn() };
    const runDuePreparations = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    await expect(runStudioMaintenanceOnce({
      studioAssetProcessor: { processNext: vi.fn(async () => { throw new Error("broken document"); }) },
      studioAssetCleanupProcessor: { processNext: vi.fn(async () => null) },
      studioAssetUploadCleanupProcessor: { processNext: vi.fn(async () => null) },
      studioProactivityService: { runDuePreparations },
      log: logger
    }, {
      maxItemsPerProcessor: 1,
      scavenge: vi.fn(async () => undefined)
    })).rejects.toThrow("database unavailable");
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), expect.stringContaining("asset extraction"));
    expect(runDuePreparations).toHaveBeenCalledTimes(1);
  });
});
