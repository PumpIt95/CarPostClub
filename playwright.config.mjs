import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const configuredChromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/usr/bin/google-chrome-stable") ? "/usr/bin/google-chrome-stable" : "") ||
  (existsSync("/snap/bin/chromium") ? "/snap/bin/chromium" : "");

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3911",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: process.env.CARPOSTCLUB_E2E_VIDEO === "1" ? "retain-on-failure" : "off"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: configuredChromiumPath
          ? { executablePath: configuredChromiumPath }
          : {}
      }
    }
  ]
});
