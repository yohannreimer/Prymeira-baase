import { describe, expect, it, vi } from "vitest";
import { readRuntimeConfig } from "./config/runtime";
import {
  runApiServer,
  type ApiServerApp,
  type ApiServerDependencies
} from "./server-lifecycle";

function createApp(overrides: Partial<ApiServerApp> = {}): ApiServerApp {
  return {
    listen: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    log: {
      error: vi.fn(),
      info: vi.fn()
    },
    ...overrides
  };
}

function createDependencies(overrides: Partial<ApiServerDependencies> = {}) {
  const app = createApp();
  const runtimeConfig = readRuntimeConfig({ NODE_ENV: "test" });
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const dependencies: ApiServerDependencies = {
    readRuntimeConfig: vi.fn(() => runtimeConfig),
    assertStudioVectorProductionPrerequisite: vi.fn(),
    initializeRuntimeObjectStorage: vi.fn(async () => ({ storage: true })),
    createPostgresPool: vi.fn(() => ({ pool: true })),
    initializePostgresRuntime: vi.fn(async () => ({ repositories: true })),
    buildApp: vi.fn(() => app),
    startStudioAssetMaintenance: vi.fn(() => ({
      stop: vi.fn(async () => undefined)
    })),
    closePool: vi.fn(async () => undefined),
    captureUnexpectedError: vi.fn(),
    flushMonitoring: vi.fn(async () => true),
    registerSignalHandler: vi.fn((signal, handler) => {
      signalHandlers.set(signal, handler);
    }),
    exit: vi.fn(),
    logStartupError: vi.fn(),
    ...overrides
  };
  return { app, dependencies, runtimeConfig, signalHandlers };
}

describe("API server lifecycle", () => {
  it.each([
    {
      stage: "runtime validation",
      override(error: Error) {
        return { readRuntimeConfig: vi.fn(() => { throw error; }) };
      }
    },
    {
      stage: "Studio vector prerequisite validation",
      override(error: Error) {
        return {
          assertStudioVectorProductionPrerequisite: vi.fn(() => { throw error; })
        };
      }
    },
    {
      stage: "object-storage initialization",
      override(error: Error) {
        return {
          initializeRuntimeObjectStorage: vi.fn(async () => { throw error; })
        };
      }
    },
    {
      stage: "PostgreSQL pool creation",
      override(error: Error) {
        return {
          createPostgresPool: vi.fn(() => { throw error; })
        };
      }
    },
    {
      stage: "PostgreSQL schema initialization",
      override(error: Error) {
        return {
          initializePostgresRuntime: vi.fn(async () => { throw error; })
        };
      }
    },
    {
      stage: "application construction",
      override(error: Error) {
        return {
          buildApp: vi.fn(() => { throw error; })
        };
      }
    },
    {
      stage: "HTTP listener startup",
      override(error: Error) {
        return {
          buildApp: vi.fn(() => createApp({
            listen: vi.fn(async () => { throw error; })
          }))
        };
      }
    },
    {
      stage: "maintenance runner startup",
      override(error: Error) {
        return {
          startStudioAssetMaintenance: vi.fn(() => { throw error; })
        };
      }
    }
  ])("captures and flushes a $stage failure before exiting", async ({ override }) => {
    const error = new Error("startup failed");
    const { dependencies } = createDependencies(override(error));

    await runApiServer(
      { PORT: "3091", HOST: "127.0.0.1", DATABASE_URL: "postgres://test" },
      dependencies
    );

    expect(dependencies.captureUnexpectedError).toHaveBeenCalledWith(error, {
      component: "startup"
    });
    expect(dependencies.flushMonitoring).toHaveBeenCalledWith(2000);
    expect(dependencies.exit).toHaveBeenCalledWith(1);
  });

  it("bounds app and pool shutdown so monitoring is flushed before exit", async () => {
    vi.useFakeTimers();
    try {
      const appClose = vi.fn(() => new Promise<void>(() => undefined));
      const poolClose = vi.fn(() => new Promise<void>(() => undefined));
      const { dependencies, signalHandlers } = createDependencies({
        buildApp: vi.fn(() => createApp({ close: appClose })),
        closePool: poolClose
      });

      await runApiServer(
        { PORT: "3091", HOST: "127.0.0.1", DATABASE_URL: "postgres://test" },
        dependencies,
        { shutdownStepTimeoutMs: 25 }
      );
      signalHandlers.get("SIGTERM")?.();

      await vi.advanceTimersByTimeAsync(25);
      expect(poolClose).toHaveBeenCalledOnce();
      expect(dependencies.flushMonitoring).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(25);
      expect(dependencies.captureUnexpectedError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "API_SERVER_APP_CLOSE_TIMEOUT" }),
        { component: "shutdown" }
      );
      expect(dependencies.flushMonitoring).toHaveBeenCalledWith(2000);
      expect(dependencies.exit).toHaveBeenCalledWith(1);
      expect(
        vi.mocked(dependencies.flushMonitoring).mock.invocationCallOrder[0]
      ).toBeLessThan(
        vi.mocked(dependencies.exit).mock.invocationCallOrder[0]!
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a stalled maintenance stop before closing the app and pool", async () => {
    vi.useFakeTimers();
    try {
      const maintenanceStop = vi.fn(() => new Promise<void>(() => undefined));
      const appClose = vi.fn(async () => undefined);
      const poolClose = vi.fn(async () => undefined);
      const { dependencies, signalHandlers } = createDependencies({
        buildApp: vi.fn(() => createApp({ close: appClose })),
        startStudioAssetMaintenance: vi.fn(() => ({
          stop: maintenanceStop
        })),
        closePool: poolClose
      });

      await runApiServer(
        { PORT: "3091", HOST: "127.0.0.1", DATABASE_URL: "postgres://test" },
        dependencies,
        { shutdownStepTimeoutMs: 25 }
      );
      signalHandlers.get("SIGTERM")?.();

      await vi.advanceTimersByTimeAsync(24);
      expect(appClose).not.toHaveBeenCalled();
      expect(poolClose).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(appClose).toHaveBeenCalledOnce();
      expect(poolClose).toHaveBeenCalledOnce();
      expect(dependencies.captureUnexpectedError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "API_SERVER_MAINTENANCE_STOP_TIMEOUT"
        }),
        { component: "shutdown" }
      );
      expect(dependencies.flushMonitoring).toHaveBeenCalledWith(2000);
      expect(dependencies.exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the successful startup behavior and registers both shutdown signals", async () => {
    const { app, dependencies, runtimeConfig, signalHandlers } = createDependencies();

    await runApiServer(
      { PORT: "3091", HOST: "127.0.0.1", DATABASE_URL: "postgres://test" },
      dependencies
    );

    expect(dependencies.initializePostgresRuntime).toHaveBeenCalledWith(
      { pool: true },
      runtimeConfig.operationalStore,
      runtimeConfig.studio
    );
    expect(dependencies.buildApp).toHaveBeenCalledWith({
      repositoryBundle: { repositories: true },
      runtimeConfig,
      objectStorage: { storage: true }
    });
    expect(app.listen).toHaveBeenCalledWith({ port: 3091, host: "127.0.0.1" });
    expect(dependencies.startStudioAssetMaintenance).toHaveBeenCalledWith(
      app,
      expect.objectContaining({ reportUnexpectedError: expect.any(Function) })
    );
    expect(signalHandlers.has("SIGINT")).toBe(true);
    expect(signalHandlers.has("SIGTERM")).toBe(true);
    expect(dependencies.exit).not.toHaveBeenCalled();
  });

  it("preserves a clean shutdown exit code after closing resources and flushing", async () => {
    const { app, dependencies, signalHandlers } = createDependencies();

    await runApiServer(
      { PORT: "3091", HOST: "127.0.0.1", DATABASE_URL: "postgres://test" },
      dependencies
    );
    signalHandlers.get("SIGINT")?.();
    await vi.waitFor(() => {
      expect(dependencies.exit).toHaveBeenCalledWith(0);
    });

    expect(app.close).toHaveBeenCalledOnce();
    expect(dependencies.closePool).toHaveBeenCalledOnce();
    expect(dependencies.flushMonitoring).toHaveBeenCalledWith(2000);
    expect(dependencies.captureUnexpectedError).not.toHaveBeenCalled();
    expect(
      vi.mocked(dependencies.flushMonitoring).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(dependencies.exit).mock.invocationCallOrder[0]!
    );
  });
});
