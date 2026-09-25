/**
 * نگهبانِ معماریِ مرز مشترک (فاز ۶.۱).
 *
 * این تست‌ها «ساختار» را حفظ می‌کنند تا مرز مشترک در طول فازهای بعد به یک
 * ماژولِ خداگونه یا لایه‌ای وابسته به پورتال تبدیل نشود:
 *
 *  - `shared/` نباید به کدِ هیچ پورتالی وابسته باشد (فقط برعکس مجاز است)؛
 *  - هیچ دسترسیِ مرورگری (localStorage/window/document) در هستهٔ مشترک نیست؛
 *  - تنها یک نقطهٔ فراخوانیِ `fetch` وجود دارد؛
 *  - لایهٔ حمل‌ونقل هیچ اصطلاحِ تجاری نمی‌شناسد.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UI_STATES } from "../truth-registry";
import { API_ERROR_KINDS } from "../shared/http";

const sharedRoot = path.resolve(import.meta.dirname, "..", "shared");

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (full.endsWith(".ts") || full.endsWith(".mts")) files.push(full);
  }
  return files;
}

const sharedFiles = walk(sharedRoot);

/** حذفِ توضیحات تا فقط کدِ اجرایی بررسی شود (نام فایل‌های قدیمی در توضیحات مجاز است). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const sharedSources = new Map(sharedFiles.map((file) => [file, readFileSync(file, "utf8")]));
const sharedCode = new Map([...sharedSources].map(([file, source]) => [file, stripComments(source)]));

describe("Phase 6.1 shared boundary architecture guards", () => {
  it("keeps the shared boundary independent from every portal", () => {
    const forbidden = [/from\s+"[^"]*\.\.\/storefront/, /from\s+"@\/[^"]*"/, /from\s+"@server\/[^"]*"/, /from\s+"[^"]*supplier-src/];
    for (const [file, source] of sharedSources) {
      if (file.endsWith("async-state.ts")) continue; // فقط واژگانِ truth-registry را وارد می‌کند
      for (const pattern of forbidden) {
        expect(source, `${path.relative(sharedRoot, file)} ← ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("never touches browser storage or DOM globals in the shared core", () => {
    for (const [file, source] of sharedSources) {
      expect(source, path.relative(sharedRoot, file)).not.toMatch(/window\.localStorage/);
      expect(source, path.relative(sharedRoot, file)).not.toMatch(/document\./);
    }
  });

  it("has exactly one fetch call site", () => {
    const callSites = [...sharedSources.entries()].filter(([, source]) => /globalThis\.fetch\s*\(/.test(source));
    expect(callSites).toHaveLength(1);
    expect(callSites[0]?.[0].endsWith(path.join("http", "client.ts"))).toBe(true);
  });

  it("keeps business vocabulary out of the generic transport", () => {
    const httpFiles = [...sharedSources.entries()].filter(([file]) => file.includes(`${path.sep}http${path.sep}`));
    expect(httpFiles.length).toBeGreaterThan(0);
    for (const [file] of httpFiles) {
      const code = sharedCode.get(file) ?? "";
      expect(code, path.relative(sharedRoot, file)).not.toMatch(/supplier|wholesale|vip|cart|checkout|inventory/i);
    }
  });

  it("reuses the Phase 6.0 state vocabulary instead of inventing one", () => {
    for (const kind of API_ERROR_KINDS) {
      if (kind === "MALFORMED_RESPONSE" || kind === "ABORTED" || kind === "UNKNOWN") continue;
      expect(UI_STATES, kind).toContain(kind);
    }
  });

  it("keeps the presentation cache explicitly non-authoritative", () => {
    const cacheSource = sharedSources.get(path.join(sharedRoot, "session", "presentation-cache.ts")) ?? "";
    expect(cacheSource).toContain("نمایشی");
    expect(cacheSource).toContain("KeyValueStorage");
    // هیچ تابعی برای ساختِ نشست از کش در این ماژول وجود ندارد:
    expect(cacheSource).not.toMatch(/export function .*Session\s*\(/);
  });
});
