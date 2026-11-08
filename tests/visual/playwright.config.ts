import { defineConfig } from "@playwright/test";

const baseURL = (process.env.BASE_URL || "https://searsmelvin.co.uk").replace(/\/$/, "");

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    locale: "en-GB",
    timezoneId: "Europe/London",
    colorScheme: "light",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    screenshot: "off",
    video: "off",
    trace: "off",
    launchOptions: {
      args: ["--disable-dev-shm-usage"],
    },
  },
});
