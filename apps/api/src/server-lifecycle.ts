import type { BaaseRuntimeConfig } from "./config/runtime";
import type { UnexpectedErrorContext } from "./observability/reporter";

type RuntimeEnv = Record<string, string | undefined>;

export type ApiServerApp = {
  listen(options: { port: number; host: string }): Promise<unknown>;
  close(): Promise<void>;
  log: {
    error(error: unknown): void;
    info(message: string): void;
  };
};

type MaintenanceRunner = {
  stop(): Promise<void> | void;
};

type MaintenanceOptions = {
  reportUnexpectedError(error: unknown, operation: string): void;
};

export type ApiServerDependencies = {
  readRuntimeConfig(env: RuntimeEnv): BaaseRuntimeConfig;
  assertStudioVectorProductionPrerequisite(
    runtimeConfig: BaaseRuntimeConfig,
    databaseUrl: string | undefined
  ): void;
  initializeRuntimeObjectStorage(runtimeConfig: BaaseRuntimeConfig): Promise<unknown>;
  createPostgresPool(databaseUrl: string): unknown;
  initializePostgresRuntime(
    pool: unknown,
    operationalStore: BaaseRuntimeConfig["operationalStore"],
    studio: BaaseRuntimeConfig["studio"]
  ): Promise<unknown>;
  buildApp(input: {
    repositoryBundle: unknown | null;
    runtimeConfig: BaaseRuntimeConfig;
    objectStorage: unknown;
  }): ApiServerApp;
  startStudioAssetMaintenance(
    app: ApiServerApp,
    options: MaintenanceOptions
  ): MaintenanceRunner;
  closePool(pool: unknown): Promise<void>;
  captureUnexpectedError(error: unknown, context: UnexpectedErrorContext): void;
  flushMonitoring(timeoutMs: number): Promise<boolean>;
  registerSignalHandler(signal: NodeJS.Signals, handler: () => void): void;
  exit(code: number): void;
  logStartupError(error: unknown): void;
};

type ApiServerLifecycleOptions = {
  shutdownStepTimeoutMs?: number;
};

const DEFAULT_SHUTDOWN_STEP_TIMEOUT_MS = 2000;
const MONITORING_FLUSH_TIMEOUT_MS = 2000;

export async function runApiServer(
  env: RuntimeEnv,
  dependencies: ApiServerDependencies,
  options: ApiServerLifecycleOptions = {}
): Promise<void> {
  let app: ApiServerApp | null = null;
  let pool: unknown | null = null;
  let maintenanceRunner: MaintenanceRunner | null = null;
  let shutdownStarted = false;
  const shutdownStepTimeoutMs = normalizeShutdownTimeout(
    options.shutdownStepTimeoutMs
  );

  async function shutdown(): Promise<number> {
    let shutdownError: unknown = null;
    const shutdownSteps: Array<readonly [
      timeoutCode: string,
      operation: () => Promise<void> | void
    ]> = [
      [
        "API_SERVER_MAINTENANCE_STOP_TIMEOUT",
        () => maintenanceRunner?.stop()
      ],
      [
        "API_SERVER_APP_CLOSE_TIMEOUT",
        () => app?.close()
      ],
      [
        "API_SERVER_POOL_CLOSE_TIMEOUT",
        () => pool === null ? undefined : dependencies.closePool(pool)
      ]
    ];

    for (const [timeoutCode, operation] of shutdownSteps) {
      try {
        await withDeadline(operation, shutdownStepTimeoutMs, timeoutCode);
      } catch (error) {
        shutdownError ??= error;
      }
    }
    if (shutdownError) {
      dependencies.captureUnexpectedError(shutdownError, {
        component: "shutdown"
      });
      try {
        app?.log.error(shutdownError);
      } catch {
        // Shutdown and monitoring must continue even if logging fails.
      }
    }
    await dependencies.flushMonitoring(MONITORING_FLUSH_TIMEOUT_MS);
    return shutdownError ? 1 : 0;
  }

  function handleShutdownSignal() {
    if (shutdownStarted) return;
    shutdownStarted = true;
    void shutdown().then((exitCode) => dependencies.exit(exitCode));
  }

  try {
    const port = Number(env.PORT ?? 3090);
    const host = env.HOST ?? "0.0.0.0";
    const databaseUrl = env.DATABASE_URL;
    const runtimeConfig = dependencies.readRuntimeConfig(env);
    dependencies.assertStudioVectorProductionPrerequisite(
      runtimeConfig,
      databaseUrl
    );
    const objectStorage =
      await dependencies.initializeRuntimeObjectStorage(runtimeConfig);

    pool = databaseUrl
      ? dependencies.createPostgresPool(databaseUrl)
      : null;
    const repositoryBundle = pool
      ? await dependencies.initializePostgresRuntime(
          pool,
          runtimeConfig.operationalStore,
          runtimeConfig.studio
        )
      : null;

    app = dependencies.buildApp({
      repositoryBundle,
      runtimeConfig,
      objectStorage
    });

    dependencies.registerSignalHandler("SIGINT", handleShutdownSignal);
    dependencies.registerSignalHandler("SIGTERM", handleShutdownSignal);

    await app.listen({ port, host });
    maintenanceRunner = dependencies.startStudioAssetMaintenance(app, {
      reportUnexpectedError(error, operation) {
        dependencies.captureUnexpectedError(error, {
          component: "maintenance",
          operation
        });
      }
    });
    app.log.info(`Baase API listening on ${host}:${port}`);
  } catch (error) {
    dependencies.captureUnexpectedError(error, { component: "startup" });
    try {
      if (app) app.log.error(error);
      else dependencies.logStartupError(error);
    } catch {
      // Startup failure reporting must not prevent the monitoring flush.
    }
    await dependencies.flushMonitoring(MONITORING_FLUSH_TIMEOUT_MS);
    dependencies.exit(1);
  }
}

function normalizeShutdownTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return DEFAULT_SHUTDOWN_STEP_TIMEOUT_MS;
  }
  return Math.min(Math.max(timeoutMs, 0), 10_000);
}

async function withDeadline(
  operation: () => Promise<void> | void,
  timeoutMs: number,
  timeoutCode: string
): Promise<void> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    Promise.resolve()
      .then(operation)
      .then(
        () => ({ status: "fulfilled" as const }),
        (error: unknown) => ({ status: "rejected" as const, error })
      ),
    new Promise<{ status: "rejected"; error: Error }>((resolve) => {
      deadline = setTimeout(() => resolve({
        status: "rejected",
        error: new Error(timeoutCode)
      }), timeoutMs);
    })
  ]);
  if (deadline) clearTimeout(deadline);
  if (result.status === "rejected") throw result.error;
}
