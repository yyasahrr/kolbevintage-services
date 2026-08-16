import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "vip-qa.spec.ts",
  workers: 1,
  use: {
    channel: "chrome",
    headless: true,
  },
});
