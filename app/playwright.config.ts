import { defineConfig, devices } from "@playwright/test";

// The built app (dist/) is served locally and opened as on an iPhone (WebKit = Safari's engine),
// an Android phone (Chromium) and a PC. No external site is contacted.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:4173/", trace: "off" },
  webServer: { command: "npm run preview", url: "http://localhost:4173/", reuseExistingServer: false, timeout: 60_000 },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 15"] } },
    { name: "iphone-se", use: { ...devices["iPhone SE"] } },
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "pc", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 800 } } },
  ],
});
