import { describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/react";
import type { WebMonitoringConfig } from "./config";
import { initializeWebMonitoringWith } from "./client";

const enabledConfig: WebMonitoringConfig = {
  enabled: true,
  dsn: "https://public-key@glitchtip.prymeiradigital.com.br/1",
  environment: "production",
  release: "0123456789abcdef0123456789abcdef01234567",
  tracesSampleRate: 0.01
};

describe("web monitoring client", () => {
  it("does not initialize a disabled client", () => {
    const init = vi.fn();
    expect(initializeWebMonitoringWith({ ...enabledConfig, enabled: false }, { init })).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("initializes once with privacy and bounded buffering", () => {
    const init = vi.fn();
    expect(initializeWebMonitoringWith(enabledConfig, { init })).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: enabledConfig.dsn,
      environment: "production",
      release: enabledConfig.release,
      tracesSampleRate: 0.01,
      sendDefaultPii: false,
      autoSessionTracking: false,
      maxBreadcrumbs: 0,
      transportOptions: { bufferSize: 10 },
      integrations: expect.any(Function)
    }));
    const options = init.mock.calls[0]?.[0];
    const browserTracing = { name: "BrowserTracing", setupOnce: vi.fn() };
    const processSession = { name: "ProcessSession", setupOnce: vi.fn() };
    const browserSession = { name: "BrowserSession", setupOnce: vi.fn() };
    const globalHandlers = { name: "GlobalHandlers", setupOnce: vi.fn() };
    expect(options.integrations([
      browserTracing,
      processSession,
      browserSession,
      globalHandlers
    ])).toEqual([browserTracing, globalHandlers]);
    const defaultIntegrations = Sentry.getDefaultIntegrations({});
    expect(defaultIntegrations.map(({ name }) => name)).toContain("BrowserSession");
    expect(options.integrations(defaultIntegrations)).toEqual(
      defaultIntegrations.filter(
        ({ name }) => name !== "ProcessSession" && name !== "BrowserSession"
      )
    );
    expect(options).not.toHaveProperty("replaysSessionSampleRate");
    expect(options).not.toHaveProperty("enableLogs");
    expect(options.beforeSend({
      user: { email: "employee@prymeira.test" },
      exception: { values: [{ type: "Error", value: "safe failure" }] }
    })).toEqual({
      exception: { values: [{ type: "Error", value: "[redacted]" }] }
    });
    expect(options.beforeSendTransaction({
      transaction: "/workspaces/123?token=private",
      spans: [{ op: "http", data: { authorization: "private" } }]
    })).toEqual({
      transaction: "/workspaces/:id",
      spans: [{ op: "http" }]
    });
  });

  it("contains SDK initialization failures", () => {
    const init = vi.fn(() => {
      throw new Error("transport initialization failed");
    });
    expect(initializeWebMonitoringWith(enabledConfig, { init })).toBe(false);
  });
});
