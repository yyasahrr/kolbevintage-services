// @vitest-environment jsdom
/**
 * نمایش کاتالوگ واقعی در فروشگاه — «اتصال به بک‌اند» با شاهد قابل‌تکرار.
 *
 * سه چیز سنجیده می‌شود:
 *  ۱) وقتی API کالای واقعی می‌دهد، همان کالا (نه دادهٔ نمایشی) در صفحه دیده می‌شود.
 *  ۲) کالای بدون قیمت رسمی، «قیمت به‌زودی» نشان می‌دهد — نه عدد ساختگی و نه قیمت ۰.
 *  ۳) وقتی API خطا می‌دهد، صفحهٔ سفید نمی‌شود: در توسعه فهرست نمایشی با برچسب صریح می‌آید.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";

vi.mock("../storefront/lib/clientLogger", () => ({
  initializeClientLogging: () => {},
  reportApiIssue: () => {},
  logClient: () => {},
}));

const liveProduct = {
  id: "prod_classic",
  slug: "classic-short-sleeve",
  name: "پیراهن کلاسیک نیم‌آستین",
  description: "تولید کارخانه، کیفیت صادراتی",
  category: null,
  updated_at: "2026-09-01T10:00:00.000Z",
  variants: [{ id: "var_classic", sku: "NL-CLASSIC-M", color: "شیری", size: "M", available: 60 }],
  available_total: 60,
  retail_price: null,
  price_source: "PENDING_RETAIL_PRICING",
};

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String((input as Request).url);
      return handler(url);
    }),
  );
}

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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("اتصال فروشگاه به کاتالوگ واقعی", () => {
  it("کالای بازگشتی از API در صفحهٔ فروشگاه دیده می‌شود و قیمت ساختگی ندارد", async () => {
    stubFetch((url) => {
      if (url.includes("/catalog/products")) {
        return new Response(JSON.stringify({ products: [liveProduct] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    });

    window.location.hash = "#/shop";
    const App = (await import("../storefront/App")).default;
    render(createElement(App));

    expect(await screen.findByText("پیراهن کلاسیک نیم‌آستین", undefined, { timeout: 8000 })).toBeTruthy();
    expect(screen.getAllByText("قیمت به‌زودی").length).toBeGreaterThan(0);
    expect(screen.getAllByText("تصویر به‌زودی").length).toBeGreaterThan(0);
    // برچسب دادهٔ نمایشی نباید ظاهر شود، چون داده واقعی از سرور آمده است.
    expect(screen.queryByText("دادهٔ نمایشی محیط توسعه — کالاهای واقعی از سرور خوانده نشد.")).toBeNull();
  });

  it("خطای سرور صفحهٔ سفید نمی‌دهد؛ فهرست نمایشی با برچسب صریح می‌آید", async () => {
    stubFetch((url) => {
      if (url.includes("/catalog/products")) throw new Error("network down");
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    });

    window.location.hash = "#/shop";
    const App = (await import("../storefront/App")).default;
    const { container } = render(createElement(App));

    expect(
      await screen.findAllByText("دادهٔ نمایشی محیط توسعه — کالاهای واقعی از سرور خوانده نشد.", undefined, { timeout: 8000 }),
    ).toBeTruthy();
    expect((container.textContent ?? "").trim().length).toBeGreaterThan(200);
  });
});
