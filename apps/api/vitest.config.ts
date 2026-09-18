import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.spec.ts"],
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
});
