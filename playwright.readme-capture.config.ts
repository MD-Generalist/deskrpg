import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts/readme-capture",
  testMatch: "capture.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: "http://127.0.0.1:3310",
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 720 },
    video: { mode: "on", size: { width: 1280, height: 720 } },
    locale: "ko-KR",
    actionTimeout: 15_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  outputDir: ".artifacts/readme-capture/raw",
});
