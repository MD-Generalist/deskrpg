import { defineConfig } from "@playwright/test";

// Homepage only: existing game E2E configuration and live Hermes are independent.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "homepage-commute.spec.ts",
  projects: [{ name: "homepage" }],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  outputDir: ".artifacts/homepage-commute/test-results",
  reporter: [["list"], ["json", { outputFile: ".artifacts/homepage-commute/results.json" }]],
  use: {
    baseURL: process.env.HOMEPAGE_BASE_URL ?? "http://127.0.0.1:3110",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    locale: "ko-KR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "on",
  },
});
