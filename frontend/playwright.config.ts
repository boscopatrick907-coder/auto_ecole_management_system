import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4200",
    viewport: { width: 390, height: 844 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_USE_BUNDLED
        ? undefined
        : process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "node tests/serve.mjs",
    url: "http://127.0.0.1:4200",
    reuseExistingServer: true,
  },
  reporter: "list",
});
