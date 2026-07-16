import { defineConfig, devices } from "@playwright/test";

const apiPort = 3090;
const webPort = 5190;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "/tmp/baase-playwright-results",
  reporter: process.env.CI ? [["line"], ["junit", { outputFile: "/tmp/baase-playwright-junit.xml" }]] : "line",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [{
    name: "chromium",
    testIgnore: /owner-studio-production-smoke\.spec\.ts/u,
    use: { ...devices["Desktop Chrome"] }
  }],
  webServer: [
    {
      command: "pnpm --filter @prymeira/baase-api exec tsx ../../tests/e2e/owner-studio-server.ts",
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe"
    },
    {
      command: "pnpm --filter @prymeira/baase-web dev",
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_BAASE_AUTH_MODE: "local" },
      stdout: "pipe",
      stderr: "pipe"
    }
  ]
});
