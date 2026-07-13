import { scavengeStaleStudioUploadDirectories } from "./studio-asset-upload";

type Processor = { processNext(): Promise<unknown | null> };
type MaintenanceLogger = { error(error: unknown, message?: string): void };

export function createStudioAssetMaintenanceRunner(options: {
  assetProcessor: Processor;
  cleanupProcessor: Processor;
  uploadCleanupProcessor: Processor;
  logger: MaintenanceLogger;
  maxItemsPerProcessor?: number;
  intervalMs?: number;
  jitterRatio?: number;
  random?: () => number;
  scavenge?: () => Promise<unknown>;
}) {
  const maxItems = options.maxItemsPerProcessor ?? 10;
  const intervalMs = options.intervalMs ?? 30_000;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const random = options.random ?? Math.random;
  const reportError = (error: unknown, message: string) => {
    try {
      options.logger.error(error, message);
    } catch {
      // Maintenance must keep scheduling even if a custom logger fails.
    }
  };
  const scavenge = options.scavenge ?? (() => scavengeStaleStudioUploadDirectories({
    onError(error, path) {
      reportError({ err: error, path }, "Studio upload scavenger failed");
    }
  }));
  let activeRun: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let stopped = false;
  let scavenged = false;

  async function executeRun() {
    if (!scavenged) {
      scavenged = true;
      try {
        await scavenge();
      } catch (error) {
        reportError(error, "Studio upload scavenger failed");
      }
    }
    for (const [name, processor] of [
      ["asset extraction", options.assetProcessor],
      ["asset deletion", options.cleanupProcessor],
      ["upload intent cleanup", options.uploadCleanupProcessor]
    ] as const) {
      for (let index = 0; index < maxItems; index += 1) {
        try {
          if (await processor.processNext() === null) break;
        } catch (error) {
          reportError(error, `Studio ${name} maintenance failed`);
        }
      }
    }
  }

  function runOnce() {
    if (activeRun) return activeRun;
    activeRun = executeRun().finally(() => {
      activeRun = null;
    });
    return activeRun;
  }

  function scheduleNext() {
    if (stopped) return;
    const jitter = intervalMs * jitterRatio * (random() * 2 - 1);
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, Math.max(1, intervalMs + jitter));
    timer.unref?.();
  }

  async function tick() {
    await runOnce();
    scheduleNext();
  }

  return {
    runOnce,
    start() {
      if (started) return;
      started = true;
      stopped = false;
      void tick();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await activeRun;
    }
  };
}

export function startStudioAssetMaintenance(input: {
  studioAssetProcessor: Processor;
  studioAssetCleanupProcessor: Processor;
  studioAssetUploadCleanupProcessor: Processor;
  log: MaintenanceLogger;
}, options: {
  maxItemsPerProcessor?: number;
  intervalMs?: number;
  jitterRatio?: number;
  random?: () => number;
  scavenge?: () => Promise<unknown>;
} = {}) {
  const runner = createStudioAssetMaintenanceRunner({
    assetProcessor: input.studioAssetProcessor,
    cleanupProcessor: input.studioAssetCleanupProcessor,
    uploadCleanupProcessor: input.studioAssetUploadCleanupProcessor,
    logger: input.log,
    ...options
  });
  runner.start();
  return runner;
}
