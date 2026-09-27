import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "storefront"), "@shared": path.resolve(import.meta.dirname, "shared") } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: [
      "test/checkpoint-04-*.test.ts",
      "test/checkpoint-04-*.test.tsx",
      "test/phase-6-3-wholesale-catalog.test.ts",
      "test/phase-6-3-wholesale-catalog-ui.test.tsx",
      "test/panels-honesty.test.ts",
    ],
    setupFiles: ["./test/checkpoint-02-setup.ts"],
    fileParallelism: false,
  },
});
