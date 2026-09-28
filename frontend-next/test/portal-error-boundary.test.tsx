// @vitest-environment jsdom
/**
 * محافظ خطای پنل‌ها — الزام «هیچ صفحهٔ سفید/کرشی» (پاسخ ۷۹ کاربر).
 *
 * سنجش:
 *  ۱) استثنای رندر → پیام فارسی + دو کنش بازیابی (نه صفحهٔ سفید، نه پیام انگلیسی).
 *  ۲) کنش «تلاش دوباره» بعد از رفع خطا، محتوای واقعی را برمی‌گرداند.
 *  ۳) مسیرهای پنل در App واقعاً داخل محافظ قرار دارند (نشانگر ساختاری).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";

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
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Observer;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = Observer;
  Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })));
});

afterEach(() => cleanup());

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error("render blew up");
  return createElement("p", null, "محتوای سالم پنل");
}

describe("محافظ خطای پنل", () => {
  it("خطای رندر را با پیام فارسی و کنش بازیابی جایگزین می‌کند", async () => {
    const Boundary = (await import("../storefront/components/PortalErrorBoundary")).default;
    // خطای عمدی رندر: React خودش آن را در کنسول گزارش می‌کند؛ ما نتیجهٔ UI را می‌سنجیم.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(createElement(Boundary, { title: "پنل مدیریت" }, createElement(Boom, { explode: true })));

    expect(await screen.findByText("نمایش این بخش ممکن نشد")).toBeTruthy();
    expect(screen.getByText("تلاش دوباره")).toBeTruthy();
    expect(screen.getByText("بارگذاری مجدد صفحه")).toBeTruthy();
    spy.mockRestore();
  });

  it("پس از «تلاش دوباره» محتوای سالم برمی‌گردد", async () => {
    const Boundary = (await import("../storefront/components/PortalErrorBoundary")).default;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Switcher() {
      const [explode, setExplode] = useState(true);
      return createElement(
        "div",
        null,
        createElement("button", { type: "button", onClick: () => setExplode(false) }, "رفع خطا"),
        createElement(Boundary, null, createElement(Boom, { explode })),
      );
    }

    render(createElement(Switcher));
    expect(await screen.findByText("نمایش این بخش ممکن نشد")).toBeTruthy();

    fireEvent.click(screen.getByText("رفع خطا"));
    fireEvent.click(screen.getByText("تلاش دوباره"));
    expect(await screen.findByText("محتوای سالم پنل")).toBeTruthy();
    spy.mockRestore();
  });

  it("مسیرهای پنل داخل محافظ اجرا می‌شوند", async () => {
    const App = (await import("../storefront/App")).default;
    for (const route of ["/vip", "/wholesale", "/admin"]) {
      window.location.hash = `#${route}`;
      const { container, unmount } = render(createElement(App));
      // محافظهٔ ساختاری: مسیرهای پنل باید داخل محافظ باشند.
      expect(
        container.querySelector('[data-portal-boundary="true"], [data-portal-error="true"]'),
        `مسیر ${route} داخل محافظ خطا نیست`,
      ).toBeTruthy();
      unmount();
    }
  });
});
