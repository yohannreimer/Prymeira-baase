import { describe, expect, it, vi } from "vitest";
import type { WebMonitoringConfig } from "./config";
import { initializeWebMonitoringWith } from "./client";

const enabledConfig: WebMonitoringConfig = {
  enabled: true,
  dsn: "https://public-key@glitchtip.prymeiradigital.com.br/1",
  environment: "production",
  release: "abc123",
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
      release: "abc123",
      tracesSampleRate: 0.01,
      sendDefaultPii: false,
      autoSessionTracking: false,
      maxBreadcrumbs: 0,
      transportOptions: { bufferSize: 10 }
    }));
    const options = init.mock.calls[0]?.[0];
    expect(options).not.toHaveProperty("replaysSessionSampleRate");
    expect(options).not.toHaveProperty("enableLogs");
    expect(options.beforeSend({
      user: { email: "employee@prymeira.test" },
      exception: { values: [{ type: "Error", value: "safe failure" }] }
    })).toEqual({
      exception: { values: [{ type: "Error", value: "safe failure" }] }
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
