import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",

  fullyParallel: false,
  workers: 1,

  use: {
    baseURL: "http://127.0.0.1:4200",

    viewport: {
      width: 390,
      height: 844,
    },

    launchOptions: {
      // Use Playwright's installed Chromium by default.
      // A custom browser can be supplied through CHROMIUM_PATH.
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  },

  webServer: {
    command: "node tests/serve.mjs",
    url: "http://127.0.0.1:4200",
    reuseExistingServer: true,
  },

  reporter: "list",
});
