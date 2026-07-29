import { describe, expect, it } from "vitest";
import { readWebMonitoringConfig } from "./config";

const validDsn = "https://public-key@glitchtip.prymeiradigital.com.br/1";
const validRelease = "0123456789abcdef0123456789abcdef01234567";

describe("web monitoring config", () => {
  it("stays disabled without a DSN or outside a production build", () => {
    expect(readWebMonitoringConfig({}, {}, true).enabled).toBe(false);
    expect(readWebMonitoringConfig({
      VITE_GLITCHTIP_DSN: validDsn,
      VITE_BAASE_RELEASE: validRelease
    }, {}, false).enabled).toBe(false);
  });

  it("lets runtime values override build values", () => {
    expect(readWebMonitoringConfig({
      VITE_GLITCHTIP_DSN: "https://build-key@build.example/9",
      VITE_BAASE_RELEASE: "1111111111111111111111111111111111111111",
      VITE_GLITCHTIP_TRACES_SAMPLE_RATE: "0.5"
    }, {
      VITE_GLITCHTIP_DSN: `  ${validDsn}  `,
      VITE_BAASE_RELEASE: `  ${validRelease}  `,
      VITE_BAASE_ENVIRONMENT: " production ",
      VITE_GLITCHTIP_TRACES_SAMPLE_RATE: "0.01"
    }, true)).toEqual({
      enabled: true,
      dsn: validDsn,
      environment: "production",
      release: validRelease,
      tracesSampleRate: 0.01
    });
  });

  it.each([
    ["http://public-key@glitchtip.example/1", "0.01"],
    ["https://glitchtip.example/1", "0.01"],
    ["https://public-key@glitchtip.example/project", "0.01"],
    [validDsn, "-0.1"],
    [validDsn, "1.1"],
    [validDsn, "not-a-number"]
  ])("disables invalid DSN or sample rate", (dsn, tracesSampleRate) => {
    expect(readWebMonitoringConfig({
      VITE_GLITCHTIP_DSN: dsn,
      VITE_BAASE_RELEASE: validRelease,
      VITE_GLITCHTIP_TRACES_SAMPLE_RATE: tracesSampleRate
    }, {}, true).enabled).toBe(false);
  });

  it("requires a full Git SHA release and defaults production sampling to one percent", () => {
    expect(readWebMonitoringConfig({
      VITE_GLITCHTIP_DSN: validDsn
    }, {}, true)).toMatchObject({
      enabled: false,
      environment: "production",
      tracesSampleRate: 0.01
    });
    expect(readWebMonitoringConfig({
      VITE_GLITCHTIP_DSN: validDsn,
      VITE_BAASE_RELEASE: validRelease
    }, {}, true)).toEqual({
      enabled: true,
      dsn: validDsn,
      environment: "production",
      release: validRelease,
      tracesSampleRate: 0.01
    });
    for (const release of ["abc123", `${validRelease}0`, "g".repeat(40)]) {
      expect(readWebMonitoringConfig({
        VITE_GLITCHTIP_DSN: validDsn,
        VITE_BAASE_RELEASE: release
      }, {}, true).enabled).toBe(false);
    }
  });

  it("accepts zero as the emergency performance-off value", () => {
    expect(readWebMonitoringConfig({
      VITE_GLITCHTIP_DSN: validDsn,
      VITE_BAASE_RELEASE: validRelease,
      VITE_GLITCHTIP_TRACES_SAMPLE_RATE: "0"
    }, {}, true)).toMatchObject({ enabled: true, tracesSampleRate: 0 });
  });
});
