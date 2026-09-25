import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/phase-6-0-truth-registry.test.ts"],
  },
});
