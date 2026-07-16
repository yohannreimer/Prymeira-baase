import { defineConfig, devices } from "@playwright/test";

const authState = process.env.BAASE_PRODUCTION_AUTH_STATE;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /owner-studio-production-smoke\.spec\.ts/u,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "/tmp/baase-production-smoke-results",
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    trace: "off",
    screenshot: "off",
    video: "off",
    ...(authState ? { storageState: authState } : {})
  },
  projects: [{ name: "production-smoke" }]
});
