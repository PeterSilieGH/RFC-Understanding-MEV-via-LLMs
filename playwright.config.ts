import { defineConfig } from "@playwright/test";

// E2E suite against the docker compose stack (docker compose up -d first).
// Service ports come from the same unified .env the stack uses.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    screenshot: "only-on-failure",
    // system chromium (Arch) instead of a playwright-downloaded browser
    launchOptions: { executablePath: "/usr/bin/chromium" },
  },
});
