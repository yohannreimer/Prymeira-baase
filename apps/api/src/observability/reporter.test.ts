import { describe, expect, it, vi } from "vitest";
import type { ApiMonitoringConfig } from "./config";
import {
  captureUnexpectedErrorWith,
  flushMonitoringWith,
  initializeApiMonitoringWith
} from "./reporter";

const config: ApiMonitoringConfig = {
  enabled: true,
  dsn: "https://public-key@glitchtip.prymeiradigital.com.br/2",
  environment: "production",
  release: "abc123",
  tracesSampleRate: 0.01
};

describe("API monitoring reporter", () => {
  it("initializes with a privacy boundary and bounded buffering", () => {
    const init = vi.fn();

    expect(initializeApiMonitoringWith(config, {
      init,
      captureException: vi.fn(),
      flush: vi.fn()
    })).toBe(true);

    const options = init.mock.calls[0]?.[0];
    expect(options).toEqual(expect.objectContaining({
      dsn: config.dsn,
      environment: "production",
      release: "abc123",
      tracesSampleRate: 0.01,
      sendDefaultPii: false,
      autoSessionTracking: false,
      maxBreadcrumbs: 0,
      transportOptions: { bufferSize: 10 },
      registerEsmLoaderHooks: true
    }));
    expect(options.beforeSend({
      user: { email: "employee@prymeira.test" },
      exception: { values: [{ type: "Error", value: "safe failure" }] }
    })).toEqual({
      exception: { values: [{ type: "Error", value: "safe failure" }] }
    });
    expect(options.beforeSendTransaction({
      transaction: "/workspaces/123?token=private",
      spans: [{ op: "db", data: { customer: "private" } }]
    })).toEqual({
      transaction: "/workspaces/:id",
      spans: [{ op: "db" }]
    });
  });

  it("captures only normalized allowlisted context", () => {
    const captureException = vi.fn();
    const error = new Error("database unavailable");

    captureUnexpectedErrorWith({ captureException }, error, {
      component: "http",
      method: " post ",
      route: "/workspaces/123/documents/01J8R2X8M0Q3AFK7VYG9DP6TZ4?secret=yes"
    });

    expect(captureException).toHaveBeenCalledWith(error, {
      tags: {
        component: "http",
        method: "POST",
        route: "/workspaces/:id/documents/:id"
      }
    });
  });

  it("uses a fixed maintenance operation tag and accepts no arbitrary context", () => {
    const captureException = vi.fn();
    captureUnexpectedErrorWith({ captureException }, new Error("failure"), {
      component: "maintenance",
      operation: "asset-extraction"
    });

    const captureContext = captureException.mock.calls[0]?.[1];
    expect(captureContext).toEqual({
      tags: { component: "maintenance", operation: "asset-extraction" }
    });
    expect(captureContext).not.toHaveProperty("extra");
    expect(captureContext).not.toHaveProperty("contexts");
    expect(captureContext).not.toHaveProperty("user");
  });

  it("bounds flushes to two seconds and contains every SDK failure", async () => {
    const flush = vi.fn(async () => true);
    await expect(flushMonitoringWith({ flush }, 50_000)).resolves.toBe(true);
    expect(flush).toHaveBeenCalledWith(2000);

    expect(initializeApiMonitoringWith(config, {
      init: () => { throw new Error("init failed"); },
      captureException: vi.fn(),
      flush: vi.fn()
    })).toBe(false);
    expect(() => captureUnexpectedErrorWith({
      captureException: () => { throw new Error("capture failed"); }
    }, new Error("original"), { component: "startup" })).not.toThrow();
    await expect(flushMonitoringWith({
      flush: () => { throw new Error("flush failed"); }
    })).resolves.toBe(false);
  });
});
