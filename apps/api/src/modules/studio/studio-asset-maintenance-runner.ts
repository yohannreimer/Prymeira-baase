import { scavengeStaleStudioUploadDirectories } from "./studio-asset-upload";

type Processor = { processNext(signal?: AbortSignal): Promise<unknown | null> };
type MaintenanceLogger = { error(error: unknown, message?: string): void };
type ScavengeResult = { nextCursor?: string | null } | unknown;
type Scavenge = (options?: { signal?: AbortSignal; cursor?: string | null }) => Promise<ScavengeResult>;

export function createStudioAssetMaintenanceRunner(options: {
  assetProcessor: Processor;
  cleanupProcessor: Processor;
  uploadCleanupProcessor: Processor;
  memoryProcessor?: Processor;
  portabilityProcessor?: Processor;
  logger: MaintenanceLogger;
  maxItemsPerProcessor?: number;
  intervalMs?: number;
  jitterRatio?: number;
  perItemTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  scavengeIntervalMs?: number;
  now?: () => number;
  random?: () => number;
  scavenge?: Scavenge;
}) {
  const maxItems = options.maxItemsPerProcessor ?? 10;
  const intervalMs = options.intervalMs ?? 30_000;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const perItemTimeoutMs = options.perItemTimeoutMs ?? 30_000;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
  const scavengeIntervalMs = options.scavengeIntervalMs ?? 60 * 60_000;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const reportError = (error: unknown, message: string) => {
    try {
      options.logger.error(error, message);
    } catch {
      // Maintenance must keep scheduling even if a custom logger fails.
    }
  };
  const scavenge: Scavenge = options.scavenge ?? ((input) => scavengeStaleStudioUploadDirectories({
    cursor: input?.cursor,
    signal: input?.signal,
    onError(error, path) {
      reportError({ err: error, path }, "Studio upload scavenger failed");
    }
  }));
  let activeRun: Promise<void> | null = null;
  let activeController: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let stopped = false;
  let lastScavengeAt = Number.NEGATIVE_INFINITY;
  let scavengeCursor: string | null = null;

  async function executeRun(signal: AbortSignal) {
    const currentTime = now();
    if (currentTime - lastScavengeAt >= scavengeIntervalMs) {
      lastScavengeAt = currentTime;
      try {
        const result = await withAbortDeadline(
          (itemSignal) => scavenge({ signal: itemSignal, cursor: scavengeCursor }),
          signal,
          perItemTimeoutMs,
          "STUDIO_UPLOAD_SCAVENGE_TIMEOUT"
        );
        if (result && typeof result === "object" && "nextCursor" in result) {
          scavengeCursor = (result as { nextCursor?: string | null }).nextCursor ?? null;
        }
      } catch (error) {
        if (!signal.aborted) reportError(error, "Studio upload scavenger failed");
      }
    }
    const processors: Array<readonly [string, Processor]> = [
      ["asset extraction", options.assetProcessor],
      ["asset deletion", options.cleanupProcessor],
      ["upload intent cleanup", options.uploadCleanupProcessor]
    ];
    if (options.memoryProcessor) processors.push(["memory indexing", options.memoryProcessor]);
    if (options.portabilityProcessor) processors.push(["private data reconciliation", options.portabilityProcessor]);
    for (const [name, processor] of processors) {
      for (let index = 0; index < maxItems && !signal.aborted; index += 1) {
        try {
          const result = await withAbortDeadline(
            (itemSignal) => processor.processNext(itemSignal),
            signal,
            perItemTimeoutMs,
            "STUDIO_ASSET_MAINTENANCE_ITEM_TIMEOUT"
          );
          if (result === null) break;
        } catch (error) {
          if (!signal.aborted) reportError(error, `Studio ${name} maintenance failed`);
        }
      }
      if (signal.aborted) break;
    }
  }

  function runOnce() {
    if (activeRun) return activeRun;
    const controller = new AbortController();
    activeController = controller;
    const run = executeRun(controller.signal);
    let wrapped!: Promise<void>;
    wrapped = run.finally(() => {
      if (activeController === controller) activeController = null;
      if (activeRun === wrapped) activeRun = null;
    });
    activeRun = wrapped;
    return wrapped;
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
    try {
      await runOnce();
    } catch (error) {
      reportError(error, "Studio maintenance run failed");
    } finally {
      scheduleNext();
    }
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
      activeController?.abort(new Error("STUDIO_ASSET_MAINTENANCE_SHUTDOWN"));
      const running = activeRun;
      if (!running) return;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const finished = await Promise.race([
        running.then(() => true, (error) => {
          reportError(error, "Studio maintenance shutdown failed");
          return true;
        }),
        new Promise<false>((resolve) => {
          deadline = setTimeout(() => resolve(false), shutdownTimeoutMs);
          deadline.unref?.();
        })
      ]);
      if (deadline) clearTimeout(deadline);
      if (!finished) {
        reportError(new Error("STUDIO_ASSET_MAINTENANCE_SHUTDOWN_TIMEOUT"),
          "Studio maintenance shutdown deadline exceeded");
      }
    }
  };
}

async function withAbortDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs: number,
  timeoutCode: string
) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) abortFromParent();
  else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error(timeoutCode)), timeoutMs);
  timeout.unref?.();
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  try {
    // Do not abandon an in-flight provider call. The operation receives the
    // deadline signal and the runner waits until it acknowledges that abort,
    // preserving single-flight behavior across maintenance cycles.
    return await operationPromise;
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

export function startStudioAssetMaintenance(input: {
  studioAssetProcessor: Processor;
  studioAssetCleanupProcessor: Processor;
  studioAssetUploadCleanupProcessor: Processor;
  studioMemoryIndexProcessor?: Processor;
  studioPortabilityReconciliationProcessor?: Processor;
  log: MaintenanceLogger;
}, options: {
  maxItemsPerProcessor?: number;
  intervalMs?: number;
  jitterRatio?: number;
  perItemTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  scavengeIntervalMs?: number;
  now?: () => number;
  random?: () => number;
  scavenge?: Scavenge;
} = {}) {
  const runner = createStudioAssetMaintenanceRunner({
    assetProcessor: input.studioAssetProcessor,
    cleanupProcessor: input.studioAssetCleanupProcessor,
    uploadCleanupProcessor: input.studioAssetUploadCleanupProcessor,
    memoryProcessor: input.studioMemoryIndexProcessor,
    portabilityProcessor: input.studioPortabilityReconciliationProcessor,
    logger: input.log,
    ...options
  });
  runner.start();
  return runner;
}
