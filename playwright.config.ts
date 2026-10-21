import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL pointe vers l'environnement à vérifier (local ou Scalingo TEST).
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "fr-FR",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
