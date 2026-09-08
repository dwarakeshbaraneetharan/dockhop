import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build, because the bugs worth
 * catching here are bundler-level: MapLibre's worker only breaks once Next.js
 * has emitted it.
 *
 * Projects are split by engine rather than only by viewport. MapLibre needs
 * WebGL, and headless WebKit on Linux does not provide it, so the WebKit
 * project is opt-in and CI runs the Chromium ones.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["geolocation"],
    // Morningside Heights: dense Citi Bike coverage.
    geolocation: { latitude: 40.8075, longitude: -73.9626 },
    locale: "en-US",
    launchOptions: {
      // Software WebGL, so the map renders on CI machines with no GPU.
      args: ["--enable-unsafe-swiftshader"],
    },
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium", defaultBrowserType: "chromium" },
    },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Real iOS engine. Local only: no WebGL in headless WebKit on Linux.
    { name: "ios-safari", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "npm run build && npx next start -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { NEXT_PUBLIC_E2E: "1" },
  },
});
