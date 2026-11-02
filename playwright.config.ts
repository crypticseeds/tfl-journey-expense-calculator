import { defineConfig, devices } from "@playwright/test";

// BASE_URL points the tests at an already running app (CI: the container).
// Without it, build and start the production server locally.
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "tests/e2e/.output/results",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "tests/e2e/.output/report" }],
  ],
  use: { baseURL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "pnpm build && pnpm start",
        env: { GEMINI_API_KEY: "dummy", PORT: "8080" },
        url: "http://127.0.0.1:8080/health",
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
