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

type VisibleText = { text: string; origin: string };

function visibleTexts(root: HTMLElement): VisibleText[] {
  const out: VisibleText[] = [];
  root.querySelectorAll("*").forEach((el) => {
    const where = `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/).slice(0, 2).join(".") : ""}`;
    el.childNodes.forEach((node) => {
      if (node.nodeType === 3) {
        const text = (node.textContent ?? "").trim();
        if (text) out.push({ text, origin: where });
      }
    });
    for (const attr of ["placeholder", "title", "aria-label", "alt"]) {
      const value = el.getAttribute(attr) ?? "";
      if (value) out.push({ text: value, origin: `${where}[${attr}]` });
    }
  });
  return out;
}

/** متن‌های لاتین با «نشانگر محل» — تا شکست، فایل و کلاس را نشان دهد نه فقط متن را. */
function latinOffenders(root: HTMLElement): string[] {
  const offenders = new Set<string>();
  for (const { text, origin } of visibleTexts(root)) {
    if (LATIN.test(text)) offenders.add(`${text.slice(0, 60)} ‹${origin}›`);
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
    // همهٔ مسیرهای ثبت‌شده در App.tsx — نه فقط مسیرهای اصلی (تصویر ۸۶/ج).
    const routes = [
      "#/", "#/shop", "#/product/classic-short-sleeve", "#/product/classic-short-sleeve?wholesale=1",
      "#/collection", "#/styles", "#/blog", "#/blog/first-post", "#/cart", "#/checkout",
      "#/about", "#/contact", "#/wishlist", "#/compare", "#/account", "#/try-on",
      "#/terms", "#/privacy", "#/returns", "#/shipping", "#/wholesale-terms",
      "#/wholesale", "#/wholesale-dashboard", "#/vip", "#/vip/dashboard",
    ];
    for (const hash of routes) {
      await goto(hash);
      expect(latinOffenders(container), `متن لاتین در ${hash}`).toEqual([]);
      expect((container.textContent ?? "").length, `صفحهٔ خالی در ${hash}`).toBeGreaterThan(200);
      // صفحهٔ سالم یعنی «پوستهٔ خطای پورتال» ظاهر نشده باشد (وگرنه سنجش بی‌معنا است).
      expect(container.querySelector("[data-portal-error]"), `پوستهٔ خطا در ${hash}`).toBeNull();
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
      if (panel.querySelector("[data-portal-error]")) failures.push(`${label}: پوستهٔ خطای پورتال ظاهر شد`);

      // تب‌های استودیوی طراحی (پاسخ ۵۰) هم باید فارسی محض باشند.
      if (label === "مرکز طراحی سایت") {
        for (let attempt = 0; attempt < 30 && !panel.querySelector('nav[aria-label="بخش‌های مرکز طراحی"] button'); attempt += 1) {
          await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
        }
        const tabButtons = Array.from(panel.querySelectorAll('nav[aria-label="بخش‌های مرکز طراحی"] button')) as HTMLButtonElement[];
        for (const tabButton of tabButtons) {
          const tabLabel = (tabButton.textContent ?? "").trim() || "تب";
          await act(async () => {
            tabButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 260));
          });
          const tabOffenders = latinOffenders(panel);
          if (tabOffenders.length) failures.push(`مرکز طراحی › ${tabLabel}: ${tabOffenders.slice(0, 3).join(" / ")}`);
          if ((panel.textContent ?? "").trim().length < 80) failures.push(`مرکز طراحی › ${tabLabel}: بخش خالی رندر شد`);
        }
      }
    }
    for (const keyword of FORBIDDEN) {
      expect(panel.textContent ?? "", `کلیدواژهٔ ممنوع «${keyword}» در پنل ادمین`).not.toContain(keyword);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 180000);
});
