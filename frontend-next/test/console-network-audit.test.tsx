// @vitest-environment jsdom
/**
 * گزارش «بدون خطا» — تصویر ۸۶/ج.
 *
 * چه چیزی را می‌سنجد؟
 *  • هر مسیر و هر بخش پنل رندر می‌شود (نه صفحهٔ خالی، نه استثنا).
 *  • هیچ خطای کنسول، استثنای رهاشده یا rejection بی‌پاسخ ثبت نمی‌شود.
 *  • هر درخواست شبکه‌ای که رابط می‌فرستد فهرست می‌شود تا در گزارش بیاید.
 *
 * خروجی: `docs/design/no-errors-report.md` به‌روزرسانی می‌شود.
 * محدودیت صادقانه: مرورگر واقعی در این محیط نصب نمی‌شود (دانلود Playwright مسدود است)،
 * پس سنجش در jsdom انجام می‌شود؛ همین دلیل در گزارش درج می‌شود.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, within } from "@testing-library/react";
import { createElement } from "react";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { call } from "./helpers";

vi.mock("../storefront/lib/clientLogger", () => ({
  initializeClientLogging: () => {},
  reportApiIssue: () => {},
  logClient: () => {},
}));

type Call = { method: string; url: string; status: number };
const cookies = new Map<string, string>();
const cookieHeader = () => [...cookies.values()].join("; ");
const calls: Call[] = [];
const consoleErrors: string[] = [];
const runtimeErrors: string[] = [];

beforeAll(async () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Observer;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = Observer;
  Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });

  // شبیه‌ساز شبکه به هندلر واقعی API وصل است تا پاسخ‌ها و کدهای وضعیت واقعی باشند.
  // ⚠️ درخواست‌های مطلق (پروکسی سمت سرور به سرویس اصلی) به fetch واقعی می‌روند؛
  // در غیر این صورت هندلر به خودش برمی‌گردد و حلقهٔ بی‌پایان می‌سازد.
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (/^https?:\/\//i.test(rawUrl)) return realFetch(input as RequestInfo, init);
    const path = rawUrl
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/^\/api\/v1\/compat\/?/, "")
      .replace(/^\/store\/kolbe\/?/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string" && init.body) { try { body = JSON.parse(init.body); } catch { body = undefined; } }
    const result = await call(path, { method, body, headers: { cookie: cookieHeader() } });
    for (const cookie of result.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const [name] = pair.split("=");
      cookies.set(name.trim(), pair.trim());
    }
    calls.push({ method, url: path, status: result.status });

    return new Response(JSON.stringify(result.body ?? {}), { status: result.status, headers: { "content-type": "application/json" } });
  }));

  const originalError = console.error;
  console.error = (...args: unknown[]) => { consoleErrors.push(args.map(String).join(" ").slice(0, 300)); originalError(...args); };
  window.addEventListener("error", (event) => runtimeErrors.push(String(event.message).slice(0, 300)));
  window.addEventListener("unhandledrejection", (event) => runtimeErrors.push(String((event as PromiseRejectionEvent).reason).slice(0, 300)));
});

afterEach(() => cleanup());

async function goto(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await new Promise((r) => setTimeout(r, 400));
  });
}

describe("گزارش خطا و شبکه", () => {
  it("همهٔ مسیرها و بخش‌های پنل بدون خطای کنسول رندر می‌شوند", async () => {
    const App = (await import("../storefront/App")).default;
    // نشست واقعی مدیر از هندلر API — تا بخش‌های محافظت‌شده دادهٔ واقعی ببینند.
    const login = await call("auth/login", { method: "POST", body: { email: "admin@kolbe.ir", password: "KolbeAdmin1404!", role: "admin" }, headers: cookieHeader() });
    const setCookies = login.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";");
      cookies.set(pair.split("=")[0].trim(), pair.trim());
    }
    expect(login.status, `ورود مدیر در سنجش شکست خورد (${JSON.stringify(login.body).slice(0, 120)})`).toBe(200);
    expect(setCookies.length, "نشست مدیر کوکی HttpOnly نگرفت").toBeGreaterThan(0);

    const { container } = render(createElement(App));
    const checked: { route: string; title: string; nodes: number }[] = [];

    const routes: [string, string][] = [
      ["#/", "صفحهٔ اصلی فروشگاه"],
      ["#/shop", "فهرست کالاها"],
      ["#/cart", "سبد خرید"],
      ["#/checkout", "تسویه حساب"],
      ["#/wholesale", "بازار عمده"],
      ["#/wholesale-dashboard", "میزکار خریدار عمده"],
      ["#/vip", "ورود اعضای ویژه"],
      ["#/styles", "کالکشن‌های استایل"],
      ["#/about", "دربارهٔ کلبه"],
    ];
    for (const [hash, title] of routes) {
      await goto(hash);
      checked.push({ route: hash, title, nodes: container.querySelectorAll("*").length });
      expect((container.textContent ?? "").length, `صفحهٔ خالی در ${hash}`).toBeGreaterThan(200);
    }

    await goto("#/admin");
    // انتظار برای پایان بررسی نشست و ظاهر شدن پوستهٔ پنل
    for (let attempt = 0; attempt < 40 && !container.querySelector(".admin-system aside"); attempt += 1) {
      await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    }
    const panel = container.querySelector(".admin-system") as HTMLElement;
    expect(panel, "پوستهٔ پنل مدیریت رندر نشد").toBeTruthy();
    const aside = panel.querySelector("aside") as HTMLElement;
    expect(aside, "منوی کنار پنل رندر نشد").toBeTruthy();
    const navLabels = within(aside).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "").filter(Boolean);
    for (const label of navLabels) {
      const button = within(aside).getAllByRole("button").find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "") === label);
      if (!button) continue;
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 240));
      });
      checked.push({ route: `#/admin › ${label}`, title: label, nodes: panel.querySelectorAll("*").length });
    }

    const report = [
      "# گزارش «بدون خطا» — پاسبان مرورگرمانند",
      "",
      `تاریخ اجرا: ${new Date().toISOString().slice(0, 10)}`,
      "ابزار: آزمون Vitest + jsdom (مرورگر واقعی در این محیط قابل نصب نیست؛ دانلود Playwright مسدود است).",
      "",
      "## صفحه‌هایی که رندر شدند",
      "",
      "| مسیر | عنوان | تعداد گرهٔ DOM |",
      "| --- | --- | --- |",
      ...checked.map((c) => `| ${c.route} | ${c.title} | ${c.nodes} |`),
      "",
      "## خطاهای کنسول",
      "",
      consoleErrors.length ? consoleErrors.map((e) => `- ${e}`).join("\n") : "هیچ خطای کنسولی ثبت نشد.",
      "",
      "## خطاهای رهاشدهٔ زمان اجرا",
      "",
      runtimeErrors.length ? runtimeErrors.map((e) => `- ${e}`).join("\n") : "هیچ خطای رهاشده‌ای ثبت نشد.",
      "",
      "## درخواست‌های شبکهٔ دیده‌شده",
      "",
      calls.length ? [...new Set(calls.map((c) => `${c.method} ${c.url}`))].map((line) => `- ${line}`).join("\n") : "در این اجرا درخواستی ثبت نشد.",
      "",
      "> این گزارش خودکار ساخته می‌شود: `npx vitest run test/console-network-audit.test.tsx`.",
      "",
    ].join("\n");
    writeFileSync(join(process.cwd(), "..", "docs", "design", "no-errors-report.md"), report, "utf8");

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
    expect(consoleErrors.filter((line) => !line.includes("not wrapped in act")), consoleErrors.join("\n")).toEqual([]);
  }, 300000);
});
