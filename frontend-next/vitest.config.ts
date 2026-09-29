import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@server": path.resolve(__dirname, "server"),
      "@": path.resolve(__dirname, "storefront"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    // The suites share one real PostgreSQL fixture; serialize files so
    // inventory counters and idempotency assertions stay deterministic.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
