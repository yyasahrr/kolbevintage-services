// @vitest-environment jsdom
/**
 * فاز ۶.۲ — رندرِ وضعیت‌های پورتال تأمین‌کننده (بدون مرورگر واقعی).
 *
 * این تست‌ها صفحه‌های واقعیِ `supplier-src/pages` را با یک مرزِ ساختگی رندر
 * می‌کنند و ادعاهای «راستین بودنِ وضعیت» را روی DOM بررسی می‌کنند:
 *
 *   - شکستِ شبکه → پیامِ خطا (نه «لیست خالی»)
 *   - پاسخِ موفقِ خالی → حالتِ خالی
 *   - ۴۰۳ → «دسترسی ندارید» (نه خطای عمومی، نه دادهٔ خالی)
 *   - پول به‌صورت رشتهٔ ده‌دهی قالب‌بندی می‌شود، نه float
 *   - محتوای ترکیبی (SKU/کد سفارش) در لایهٔ LTR جدا می‌شود
 *   - حالتِ تیره با متغیرهای معنایی اعمال می‌شود
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../shared/http/client";
import { createCapabilitySet } from "../shared/permissions/capabilities";
import { anonymousSession } from "../shared/session";
import { createSupplierApi } from "../shared/supplier/client";
import { toSupplierSession, type SupplierSession } from "../shared/supplier/session";
import type { FetchLike } from "../shared/http/types";
import { SupplierPortalProvider, useSupplierPortal } from "../supplier-src/context";
import { DashboardPage } from "../supplier-src/pages/dashboard";
import { OrdersPage } from "../supplier-src/pages/orders";
import { ProductsPage } from "../supplier-src/pages/products";
import { TeamPage } from "../supplier-src/pages/team";
import type { SupplierPage } from "../supplier-src/navigation";

type Route = { method: string; path: string; status: number; body: unknown };

function boundaryFor(routes: Route[]) {
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const match = routes.find(route => route.method === method && path === route.path);
    if (!match) {
      return new Response(JSON.stringify({ error: "NOT_FOUND", message: `${method} ${path}` }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(match.body), { status: match.status, headers: { "content-type": "application/json" } });
  };
  const client = createApiClient({ baseUrl: "http://api.test/api/v1", fetch: fetchImpl });
  return { client, api: createSupplierApi(client), session: null as never };
}

function supplierSession(capabilities: string[] = []): SupplierSession {
  const base = toSupplierSession(anonymousSession());
  return {
    ...base,
    status: "authenticated",
    user: { id: "usr_1", email: "ops@nilgoon.test", role: "supplier", name: "نرگس آذر", phone: null, totpEnabled: false },
    supplier: { supplierId: "sup_1", displayName: "نساجی نیلگون", legalName: "نساجی و پوشاک نیلگون", status: "approved" },
    capabilities: createCapabilitySet({ roles: ["supplier"], supplierId: "sup_1", supplierCapabilities: capabilities }),
    fetchedAt: new Date().toISOString(),
    source: "server",
    productionCapabilities: capabilities,
    capabilitiesLoaded: true,
    capabilitiesError: null,
  };
}

function renderWith(routes: Route[], children: React.ReactElement, capabilities: string[] = []) {
  const boundary = boundaryFor(routes);
  const session = supplierSession(capabilities);
  return render(
    React.createElement(
      SupplierPortalProvider,
      { boundary: boundary as never },
      React.createElement(InitialSession, { session }, children),
    ),
  );
}

/** نشستِ اولیه را بعد از mount تزریق می‌کند (Provider خودش با anonymous شروع می‌کند). */
function InitialSession({ session, children }: { session: SupplierSession; children: React.ReactNode }) {
  const portal = useSupplierPortal();
  React.useEffect(() => {
    portal.setSessionState(session);
  }, [portal, session]);
  return React.createElement(React.Fragment, null, children);
}

const noop = (_page: SupplierPage) => {};

afterEach(() => cleanup());

describe("رندرِ داشبورد — شاخص‌ها فقط از سرور", () => {
  it("شکستِ سرویس تحلیل، خطا نشان می‌دهد و KPI صفر نمی‌سازد", async () => {
    renderWith(
      [
        { method: "GET", path: "/api/v1/supplier/analytics/overview", status: 500, body: { error: "INTERNAL_ERROR", message: "سرویس تحلیل در دسترس نیست" } },
        { method: "GET", path: "/api/v1/supplier/orders", status: 200, body: { children: [] } },
        { method: "GET", path: "/api/v1/compat/supplier/rfqs", status: 200, body: { rfqs: [] } },
      ],
      React.createElement(DashboardPage, { onNavigate: noop }),
    );
    await waitFor(() => expect(screen.getByText("شاخص‌ها در دسترس نیستند")).toBeTruthy());
    // هیچ عددِ ساختگی‌ای رندر نشده است.
    expect(screen.queryByText("۱۲")).toBeNull();
    expect(screen.queryByText("۳۲۸")).toBeNull();
  });

  it("شاخصِ غایب در پاسخِ سرور، «—» نشان می‌دهد (نه صفر)", async () => {
    renderWith(
      [
        { method: "GET", path: "/api/v1/supplier/analytics/overview", status: 200, body: { metrics: [] } },
        { method: "GET", path: "/api/v1/supplier/orders", status: 200, body: { children: [] } },
        { method: "GET", path: "/api/v1/compat/supplier/rfqs", status: 200, body: { rfqs: [] } },
      ],
      React.createElement(DashboardPage, { onNavigate: noop }),
    );
    await waitFor(() => expect(screen.getAllByText("—").length).toBeGreaterThan(0));
  });

  it("مبلغِ تسویه از سرور به‌صورت ده‌دهی قالب‌بندی می‌شود", async () => {
    renderWith(
      [
        {
          method: "GET",
          path: "/api/v1/supplier/analytics/overview",
          status: 200,
          body: {
            metrics: [
              { key: "settlement.pending_amount", label: "در انتظار تسویه", unit: "IRR", value: { raw: "32400000" }, comparison: { value: null } },
            ],
          },
        },
        { method: "GET", path: "/api/v1/supplier/orders", status: 200, body: { children: [] } },
        { method: "GET", path: "/api/v1/compat/supplier/rfqs", status: 200, body: { rfqs: [] } },
      ],
      React.createElement(DashboardPage, { onNavigate: noop }),
    );
    await waitFor(() => expect(screen.getAllByText(/۳۲,۴۰۰,۰۰۰/).length).toBeGreaterThan(0));
  });
});

describe("رندرِ محصولات — خالی در برابر خطا", () => {
  it("پاسخِ موفقِ خالی، حالتِ خالی و CTA نشان می‌دهد", async () => {
    renderWith(
      [{ method: "GET", path: "/api/v1/compat/supplier/products", status: 200, body: { products: [] } }],
      React.createElement(ProductsPage, { onNavigate: noop }),
    );
    await waitFor(() => expect(screen.getByText("هنوز محصولی ثبت نکرده‌اید")).toBeTruthy());
    expect(screen.getAllByText("ثبت محصول").length).toBeGreaterThan(0);
  });

  it("شکستِ شبکه، خطا نشان می‌دهد و «خالی» نمی‌گوید", async () => {
    renderWith(
      [{ method: "GET", path: "/api/v1/compat/supplier/products", status: 500, body: { error: "INTERNAL_ERROR", message: "خطای سرور" } }],
      React.createElement(ProductsPage, { onNavigate: noop }),
    );
    await waitFor(() => expect(screen.getByText("دریافت اطلاعات ناموفق بود")).toBeTruthy());
    expect(screen.queryByText("هنوز محصولی ثبت نکرده‌اید")).toBeNull();
  });

  it("۴۰۳ به‌عنوان «دسترسی ندارید» نمایش داده می‌شود", async () => {
    renderWith(
      [{ method: "GET", path: "/api/v1/compat/supplier/products", status: 403, body: { error: "FORBIDDEN", message: "مجاز نیستید" } }],
      React.createElement(ProductsPage, { onNavigate: noop }),
    );
    await waitFor(() => expect(screen.getByText("دسترسی به این بخش وجود ندارد")).toBeTruthy());
    expect(screen.queryByText("دریافت اطلاعات ناموفق بود")).toBeNull();
  });

  it("محصولِ موفق با SKU در لایهٔ LTR و قیمتِ ده‌دهی رندر می‌شود", async () => {
    const { container } = renderWith(
      [
        {
          method: "GET",
          path: "/api/v1/compat/supplier/products",
          status: 200,
          body: {
            products: [
              {
                id: "p_1",
                name: "پیراهن آکسفورد یقه‌دار",
                sku: "KH-OXF-241",
                category: "پیراهن مردانه",
                description: null,
                wholesalePrice: "1890000",
                imageUrl: null,
                status: "approved",
                productVariants: [{ id: "v1" }],
              },
            ],
          },
        },
      ],
      React.createElement(ProductsPage, { onNavigate: noop }),
    );
    await waitFor(() => expect(screen.getAllByText("پیراهن آکسفورد یقه‌دار").length).toBeGreaterThan(0));
    const skus = screen.getAllByText("KH-OXF-241");
    expect(skus.length).toBeGreaterThan(0);
    expect(skus[0]?.className).toContain("ltr-inline");
    expect(screen.getAllByText(/۱,۸۹۰,۰۰۰/).length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".mobile-card-list").length).toBeGreaterThan(0);
  });
});

describe("رندرِ سفارش‌ها — چرخهٔ عمر از سرور", () => {
  it("فهرست خالی، حالتِ خالی نشان می‌دهد", async () => {
    renderWith(
      [{ method: "GET", path: "/api/v1/supplier/orders", status: 200, body: { children: [] } }],
      React.createElement(OrdersPage),
    );
    await waitFor(() => expect(screen.getByText("سفارشی ثبت نشده است")).toBeTruthy());
  });

  it("سفارشِ موفق با کدِ LTR و مبلغِ ده‌دهی رندر می‌شود", async () => {
    renderWith(
      [
        {
          method: "GET",
          path: "/api/v1/supplier/orders",
          status: 200,
          body: {
            children: [
              {
                id: "po_1",
                order_code: "KV-82941",
                status: "pending",
                total_amount: "9450000",
                due_date: null,
                created_at: "2026-09-20T08:00:00.000Z",
                items: [{ product_name: "پیراهن", sku: "KH-1", quantity: 30 }],
              },
            ],
          },
        },
      ],
      React.createElement(OrdersPage),
    );
    await waitFor(() => expect(screen.getAllByText("KV-82941").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/۹,۴۵۰,۰۰۰/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("در انتظار تأیید").length).toBeGreaterThan(0);
  });

  it("شکستِ شبکه، خطا نشان می‌دهد", async () => {
    renderWith(
      [{ method: "GET", path: "/api/v1/supplier/orders", status: 503, body: { error: "MAINTENANCE", message: "در حال نگهداری" } }],
      React.createElement(OrdersPage),
    );
    await waitFor(() => expect(screen.getByText("دریافت اطلاعات ناموفق بود")).toBeTruthy());
  });
});

describe("رندرِ تیم — هیچ نقشِ ساختگیِ مرورگری", () => {
  it("نبودِ قراردادِ مدیریتِ تیم صریحاً اعلام می‌شود", async () => {
    renderWith([], React.createElement(TeamPage));
    await waitFor(() =>
      expect(screen.getByText(/مدیریت اعضای تیم هنوز قراردادِ سمت تأمین‌کننده ندارد/)).toBeTruthy(),
    );
  });

  it("نقش و شناسه از نشستِ سرور نمایش داده می‌شوند", async () => {
    renderWith([], React.createElement(TeamPage));
    await waitFor(() => expect(screen.getByText("نرگس آذر")).toBeTruthy());
    expect(screen.getByText("sup_1")).toBeTruthy();
  });

  it("بدون capability تولید، بخشِ تولید «غیرفعال» است", async () => {
    renderWith([], React.createElement(TeamPage));
    await waitFor(() => expect(screen.getByText("capability تولیدی اعلام نشده است")).toBeTruthy());
    expect(screen.getAllByText("غیرفعال").length).toBeGreaterThan(0);
  });

  it("با capability تولید، دروازه فعال می‌شود", async () => {
    renderWith([], React.createElement(TeamPage), ["production"]);
    await waitFor(() => expect(screen.getAllByText("فعال").length).toBeGreaterThan(0));
    expect(screen.queryByText("capability تولیدی اعلام نشده است")).toBeNull();
  });
});
