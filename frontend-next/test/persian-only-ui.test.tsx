// @vitest-environment jsdom
/**
 * پاسبانِ «فارسی محض + بدون خطا» روی همهٔ صفحه‌ها.
 *
 * این تست همان دو شرط پذیرش کاربر را می‌سنجد:
 *  ۱) هیچ متن لاتینی در رابط دیده نشود (تصمیم ۲۲؛ حتی VIP، CRM، SKU، نام محصول).
 *  ۲) هیچ مسیری صفحهٔ خالی/کرش‌شده نشان ندهد؛ هر بخش پنل باید رندر شود.
 *
 * اجرا با jsdom است (مرورگر واقعی در این محیط نصب نمی‌شود)، پس جای آزمون چشم را
 * نمی‌گیرد؛ اما متن دیداری، کرش رندر و برچسب‌های دسترسی‌پذیری را قطعی می‌گیرد.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";

vi.mock("../storefront/lib/clientLogger", () => ({
  initializeClientLogging: () => {},
  reportApiIssue: () => {},
  logClient: () => {},
}));
vi.mock("../storefront/lib/wholesaleApi", () => ({
  restoreAdminSession: async () => true,
  signInAdmin: async () => ({ id: "acc_admin_test", name: "مدیر آزمایشی", email: "admin@kolbe.ir", role: "admin" }),
  signOutAdmin: async () => undefined,
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Observer;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = Observer;
  Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ products: [], items: [], ok: true }), { status: 200, headers: { "content-type": "application/json" } })));
});

afterEach(() => cleanup());

const LATIN = /[A-Za-z]/;
/** کلیدواژه‌های لاتینی که در رابط ممنوع‌اند (رگرسیون‌های گذشته). */
const FORBIDDEN = ["VIP", "CRM", "KOLBE", "DIRECT", "SKU", "WHOLESALE", "NEW ARRIVALS", "hi@kolbevintage.ir"];

function visibleTexts(root: HTMLElement): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((el) => {
    el.childNodes.forEach((node) => {
      if (node.nodeType === 3) {
        const text = (node.textContent ?? "").trim();
        if (text) out.push(text);
      }
    });
    for (const attr of ["placeholder", "title", "aria-label", "alt"]) {
      const value = el.getAttribute(attr) ?? "";
      if (value) out.push(value);
    }
  });
  return out;
}

function latinOffenders(root: HTMLElement): string[] {
  const offenders = new Set<string>();
  for (const text of visibleTexts(root)) {
    if (LATIN.test(text)) offenders.add(text.slice(0, 70));
  }
  return [...offenders];
}

async function goto(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await new Promise((r) => setTimeout(r, 420));
  });
}

describe("رابط فارسی محض روی همهٔ مسیرها", () => {
  it("مسیرهای اصلی فروشگاه هیچ متن لاتینی ندارند", async () => {
    const App = (await import("../storefront/App")).default;
    const { container } = render(createElement(App));
    const routes = ["#/", "#/shop", "#/cart", "#/checkout", "#/wholesale", "#/wholesale-dashboard", "#/vip", "#/styles", "#/about"];
    for (const hash of routes) {
      await goto(hash);
      expect(latinOffenders(container), `متن لاتین در ${hash}`).toEqual([]);
      expect((container.textContent ?? "").length, `صفحهٔ خالی در ${hash}`).toBeGreaterThan(200);
    }
  }, 120000);

  it("همهٔ بخش‌های پنل مدیریت بدون خطا و بدون متن لاتین رندر می‌شوند", async () => {
    const App = (await import("../storefront/App")).default;
    const { container } = render(createElement(App));
    await goto("#/admin");

    const panel = container.querySelector(".admin-system") as HTMLElement;
    expect(panel).toBeTruthy();
    const aside = panel.querySelector("aside") as HTMLElement;
    const navButtons = within(aside).getAllByRole("button");
    const labels = navButtons.map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "").filter(Boolean);
    expect(labels.length).toBeGreaterThanOrEqual(15);

    const failures: string[] = [];
    for (const label of labels) {
      const button = within(aside).getAllByRole("button").find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "") === label);
      if (!button) continue;
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 260));
      });
      const offenders = latinOffenders(panel);
      if (offenders.length) failures.push(`${label}: ${offenders.slice(0, 3).join(" / ")}`);
      if ((panel.textContent ?? "").trim().length < 80) failures.push(`${label}: بخش خالی رندر شد`);
    }
    for (const keyword of FORBIDDEN) {
      expect(panel.textContent ?? "", `کلیدواژهٔ ممنوع «${keyword}» در پنل ادمین`).not.toContain(keyword);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 180000);
});
