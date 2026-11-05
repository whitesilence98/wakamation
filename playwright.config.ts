import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "browser.spec.ts", timeout: 60_000,
  use: { ...devices["Desktop Chrome"], channel: "msedge", launchOptions: { args: ["--enable-webgl", "--use-angle=swiftshader"] } },
});
