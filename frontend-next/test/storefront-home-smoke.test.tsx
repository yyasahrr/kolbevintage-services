// @vitest-environment jsdom
/**
 * آزمون دودِ مرورگرمانند فروشگاه — «ظاهر و کپی».
 *
 * چه چیزی را تضمین می‌کند؟
 *  ۱) صفحهٔ اصلی بدون استثنا رندر می‌شود (هیچ صفحهٔ سفید/کرشی در مسیر اول کاربر).
 *  ۲) ریزعنوان‌های فارسی جدید («تازه رسیده‌ها»، «پرفروش‌ها»، «دسته‌بندی‌ها») واقعاً دیده می‌شوند.
 *  ۳) هیچ برچسب لاتینِ رابط روی صفحهٔ اصلی برنگشته است (تصمیم کاربر: فارسی محض).
 *  ۴) قفل سبک برقرار است: نقاط ورود رندر، نشانگرهای واریانت/reveal را دارند.
 *
 * این تست با jsdom اجرا می‌شود چون ابزار مرورگر واقعی در این محیط قابل نصب نیست؛
 * پس جای «آزمون چشم» را نمی‌گیرد، اما کرش و پس‌رفت کپی/ساختار را قطعی می‌گیرد.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";

vi.mock("../storefront/lib/clientLogger", () => ({
  initializeClientLogging: () => {},
  reportApiIssue: () => {},
  logClient: () => {},
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Observer;
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Observer;
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = Observer;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = Observer;
  Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })),
  );
});

afterEach(() => cleanup());

describe("صفحهٔ اصلی فروشگاه — رندر و کپی", () => {
  it("بدون استثنا رندر می‌شود و ریزعنوان‌های فارسی را نشان می‌دهد", async () => {
    const App = (await import("../storefront/App")).default;
    render(createElement(App));

    // بخش‌های کلیدی صفحه (رندر همگام: Home بخشی از درخت اولیه است)
    expect(await screen.findByText("جدیدترین کالکشن")).toBeTruthy();
    expect(screen.getAllByText("تازه رسیده‌ها").length).toBeGreaterThan(0);
    expect(screen.getAllByText("پرفروش‌ها").length).toBeGreaterThan(0);
    expect(screen.getAllByText("دسته‌بندی‌ها").length).toBeGreaterThan(0);
  });

  it("هیچ برچسب لاتینِ رابط روی صفحهٔ اصلی باقی نمانده است", async () => {
    const App = (await import("../storefront/App")).default;
    const { container } = render(createElement(App));
    await screen.findByText("جدیدترین کالکشن");

    const text = container.textContent ?? "";
    for (const latin of ["NEW ARRIVALS", "BESTSELLERS", "SHOP BY STYLE", "SHOP THE LOOK", "AUTUMN COLLECTION", "KOLBE VINTAGE", "THE FILM"]) {
      expect(text.includes(latin), `برچسب لاتین باقی مانده: ${latin}`).toBe(false);
    }
  });

  it("قاب و نشانگر حرکت ورود در صفحهٔ اصلی اعمال شده است", async () => {
    const App = (await import("../storefront/App")).default;
    const { container } = render(createElement(App));
    await screen.findByText("جدیدترین کالکشن");

    expect(container.querySelectorAll(".kv-reveal").length).toBeGreaterThan(2);
    expect(container.querySelectorAll(".kv-title").length).toBeGreaterThan(2);
  });
});
