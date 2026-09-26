import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "../shared/design/components.css"), "utf8");

describe("Checkpoint 02 responsive and motion foundation", () => {
  it("uses logical placement for shared controls", () => {
    expect(css).toContain("inset-inline-end");
    expect(css).toContain("padding-inline-end");
    expect(css).not.toMatch(/\b(right|left|margin-left|margin-right|padding-left|padding-right)\s*:/);
  });
  it("governs reduced motion and reduced transparency", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("prefers-reduced-transparency: reduce");
    expect(css).toContain("transition-duration: .01ms");
  });
  it("provides an intentional mobile table and overlay strategy", () => {
    expect(css).toContain(".kolbe-responsive-table__cards");
    expect(css).toContain("max-height: calc(100dvh - 1rem)");
  });
});
