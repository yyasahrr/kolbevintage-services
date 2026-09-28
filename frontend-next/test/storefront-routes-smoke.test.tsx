// @vitest-environment jsdom
/**
 * آزمون دودِ همهٔ مسیرهای فروشگاه — «هیچ صفحه‌ای کرش نکند».
 *
 * هر مسیر عمومی در jsdom رندر می‌شود و باید بدون استثنا یک خروجی قابل‌مشاهده بدهد.
 * فراخوانی‌های شبکه با fetch جعلی پاسخ ۲۰۰ خالی می‌گیرند (یعنی «بک‌اند خالی/قطع»)،
 * پس این تست همان مسیری را می‌سنجد که کاربر هنگام خطای سرور می‌بیند: باید صفحهٔ
 * سالم یا حالت خالی نشان داده شود، نه صفحهٔ سفید.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
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
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Observer;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = Observer;
  Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [], items: [], ok: true }), { status: 200, headers: { "content-type": "application/json" } })),
  );
  window.addEventListener("unhandledrejection", () => {});
});

afterEach(() => cleanup());

const routes = [
  "/",
  "/shop",
  "/styles",
  "/collection",
  "/blog",
  "/cart",
  "/checkout",
  "/about",
  "/contact",
  "/wishlist",
  "/compare",
  "/account",
  "/try-on",
  "/terms",
  "/privacy",
  "/returns",
  "/shipping",
  "/wholesale",
  "/vip",
  "/admin",
  "/wholesale-dashboard",
  "/this-route-does-not-exist",
];

describe("رندر همهٔ مسیرهای فروشگاه", () => {
  for (const route of routes) {
    it(`مسیر ${route} بدون استثنا رندر می‌شود`, async () => {
      window.location.hash = `#${route}`;
      const App = (await import("../storefront/App")).default;
      const { container } = render(createElement(App));
      // انتظار: درخت رندرشده محتوا دارد (نه صفحهٔ سفید)
      await vi.waitFor(
        () => {
          expect((container.textContent ?? "").trim().length).toBeGreaterThan(40);
        },
        { timeout: 8000 },
      );
    });
  }
});
