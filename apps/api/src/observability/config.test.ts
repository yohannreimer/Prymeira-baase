import { describe, expect, it } from "vitest";
import { readApiMonitoringConfig } from "./config";

const productionEnv = {
  NODE_ENV: "production",
  SENTRY_DSN: "https://public-key@glitchtip.prymeiradigital.com.br/2",
  SENTRY_ENVIRONMENT: "production",
  SENTRY_RELEASE: "abc123"
};

describe("readApiMonitoringConfig", () => {
  it("stays disabled without a DSN", () => {
    expect(readApiMonitoringConfig({ NODE_ENV: "production", SENTRY_RELEASE: "abc123" }))
      .toMatchObject({ enabled: false, dsn: null });
  });

  it("stays disabled outside production", () => {
    expect(readApiMonitoringConfig({ ...productionEnv, NODE_ENV: "test" }).enabled).toBe(false);
    expect(readApiMonitoringConfig({ ...productionEnv, NODE_ENV: "development" }).enabled).toBe(false);
  });

  it("requires a valid HTTPS DSN with public key and numeric project", () => {
    for (const dsn of [
      "http://public@glitchtip.test/2",
      "https://glitchtip.test/2",
      "https://public@glitchtip.test/project",
      "not-a-url"
    ]) {
      expect(readApiMonitoringConfig({ ...productionEnv, SENTRY_DSN: dsn }).enabled).toBe(false);
    }
  });

  it("requires a release and trims environment values", () => {
    expect(readApiMonitoringConfig({ ...productionEnv, SENTRY_RELEASE: " " }).enabled).toBe(false);
    expect(readApiMonitoringConfig({
      ...productionEnv,
      SENTRY_DSN: ` ${productionEnv.SENTRY_DSN} `,
      SENTRY_RELEASE: " abc123 ",
      SENTRY_ENVIRONMENT: " production "
    })).toMatchObject({
      enabled: true,
      dsn: productionEnv.SENTRY_DSN,
      release: "abc123",
      environment: "production"
    });
  });

  it("defaults production traces to one percent and accepts zero", () => {
    expect(readApiMonitoringConfig(productionEnv).tracesSampleRate).toBe(0.01);
    expect(readApiMonitoringConfig({
      ...productionEnv,
      SENTRY_TRACES_SAMPLE_RATE: "0"
    })).toMatchObject({ enabled: true, tracesSampleRate: 0 });
  });

  it("disables invalid sampling rates", () => {
    for (const value of ["-0.1", "1.1", "NaN", ""]) {
      expect(readApiMonitoringConfig({
        ...productionEnv,
        SENTRY_TRACES_SAMPLE_RATE: value
      }).enabled).toBe(false);
    }
  });
});
