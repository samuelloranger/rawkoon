import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e-results",
  fullyParallel: false, // specs may mutate shared state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Stored auth state created by auth.setup.ts
    storageState: "./e2e/.auth/state.json",
  },

  projects: [
    // Auth setup runs first without storageState
    {
      name: "auth-setup",
      testMatch: "**/auth.setup.ts",
      use: { storageState: undefined },
    },
    // The reader harness mounts the component directly and stubs the API, so it
    // needs no session and must not depend on auth-setup.
    {
      name: "reader-harness",
      testMatch: "**/reader.spec.ts",
      use: { ...devices["Desktop Chrome"], storageState: undefined },
    },
    // iOS Safari is WebKit, and the reader is read on a phone. Chromium accepts
    // layout WebKit refuses, so this project is not optional.
    {
      name: "reader-harness-webkit",
      testMatch: "**/reader.spec.ts",
      use: { ...devices["iPhone 14"], storageState: undefined },
    },
    // The phone is where the reader is actually used, and where the crash was
    // reported.
    {
      name: "reader-harness-mobile",
      testMatch: "**/reader.spec.ts",
      use: { ...devices["Pixel 7"], storageState: undefined },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "**/reader.spec.ts",
      dependencies: ["auth-setup"],
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testIgnore: "**/reader.spec.ts",
      dependencies: ["auth-setup"],
    },
  ],
});
