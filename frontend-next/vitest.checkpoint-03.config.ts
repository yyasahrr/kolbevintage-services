import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "storefront"), "@shared": path.resolve(import.meta.dirname, "shared") } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["test/checkpoint-03-*.test.ts", "test/checkpoint-03-*.test.tsx"],
    setupFiles: ["./test/checkpoint-02-setup.ts"],
    fileParallelism: false,
  },
});
