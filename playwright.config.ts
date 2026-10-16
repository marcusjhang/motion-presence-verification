import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: { command: "MPV_DEMO_ALTERNATIVE_CODE=test-only-code npm start", url: "http://localhost:3000/health", reuseExistingServer: false, timeout: 30_000 },
});
