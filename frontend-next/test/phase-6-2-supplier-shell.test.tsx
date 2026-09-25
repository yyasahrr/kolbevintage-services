// @vitest-environment jsdom
/**
 * فاز ۶.۲ — پوستهٔ پورتال تأمین‌کننده.
 *
 * صفحه‌ها در تست‌های دیگر پوشش داده شده‌اند؛ اینجا خودِ **پوسته** بررسی می‌شود،
 * چون نقطهٔ ورود است و بیشترین احتمالِ کرشِ بی‌صدا را دارد:
 *
 *   - بازیابیِ نشست قبل از رندرِ پورتال
 *   - کاربرِ ناشناس → فرمِ ورود (نه پورتال، نه کرش)
 *   - خطای واقعیِ بازیابیِ نشست → پیامِ خطا (نه «وانمود به خروج»)
 *   - ناوبری، capability-gating و کلیدِ تم
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../shared/http/client";
import { createSupplierApi } from "../shared/supplier/client";
import type { FetchLike } from "../shared/http/types";
import SupplierApp from "../supplier-src/App";

type Route = { method: string; path: string; status: number; body: unknown };

function withRoutes(routes: Route[]) {
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
  return createApiClient({ baseUrl: "http://api.test/api/v1", fetch: fetchImpl });
}

const ME = {
  id: "usr_1",
  email: "ops@nilgoon.test",
  role: "supplier",
  name: "نرگس آذر",
  phone: null,
  totpEnabled: false,
  supplier: { supplierId: "sup_1", displayName: "نساجی نیلگون", legalName: "نساجی و پوشاک نیلگون", status: "approved" },
};

/** پوسته با کلاینتِ تزریق‌شده (Provider داخلیِ App کلاینتِ واقعی می‌سازد). */
function renderShell(routes: Route[]) {
  const client = withRoutes(routes);
  const api = createSupplierApi(client);
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const match = routes.find(route => route.method === method && path === route.path);
    if (!match) {
      return new Response(JSON.stringify({ error: "NOT_FOUND", message: "no route" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(match.body), { status: match.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const utils = render(React.createElement(SupplierApp));
  return { ...utils, api, restore: () => { globalThis.fetch = original; } };
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-supplier-theme");
});

describe("پوستهٔ پورتال — بازیابیِ نشست", () => {
  it("کاربرِ ناشناس فرمِ ورود می‌بیند، نه پورتال", async () => {
    const shell = renderShell([{ method: "GET", path: "/api/v1/auth/me", status: 401, body: { error: "UNAUTHORIZED", message: "نشست ندارید" } }]);
    try {
      await waitFor(() => expect(screen.getByText("به فضای کاری خود وارد شوید")).toBeTruthy());
      expect(screen.queryByText("داشبورد عملیات")).toBeNull();
      expect(screen.getByText("درخواست عضویت")).toBeTruthy();
    } finally {
      shell.restore();
    }
  });

  it("نشستِ معتبرِ تأمین‌کننده، پوستهٔ پورتال را باز می‌کند", async () => {
    const shell = renderShell([
      { method: "GET", path: "/api/v1/auth/me", status: 200, body: ME },
      { method: "GET", path: "/api/v1/supplier/production/capabilities", status: 200, body: { capabilities: [] } },
      { method: "GET", path: "/api/v1/supplier/analytics/overview", status: 200, body: { metrics: [] } },
      { method: "GET", path: "/api/v1/supplier/orders", status: 200, body: { children: [] } },
      { method: "GET", path: "/api/v1/compat/supplier/rfqs", status: 200, body: { rfqs: [] } },
    ]);
    try {
      await waitFor(() => expect(screen.getByText("داشبورد عملیات")).toBeTruthy());
      expect(screen.getByText("نساجی نیلگون")).toBeTruthy();
    } finally {
      shell.restore();
    }
  });

  it("خطای واقعیِ بازیابیِ نشست پیامِ خطا نشان می‌دهد (نه وانمود به خروج)", async () => {
    const shell = renderShell([{ method: "GET", path: "/api/v1/auth/me", status: 500, body: { error: "INTERNAL_ERROR", message: "خطای سرور" } }]);
    try {
      await waitFor(() => expect(screen.getByText("بازیابی نشست ناموفق بود")).toBeTruthy());
      expect(screen.getByText("خطای سرور")).toBeTruthy();
    } finally {
      shell.restore();
    }
  });

  it("نشستِ غیرِ supplier با پیامِ دسترسی رد می‌شود", async () => {
    const shell = renderShell([
      { method: "GET", path: "/api/v1/auth/me", status: 200, body: { ...ME, role: "customer", supplier: null } },
    ]);
    try {
      // پورتال باز نمی‌شود؛ کاربر به فرمِ ورود برمی‌گردد.
      await waitFor(() => expect(screen.getByText("به فضای کاری خود وارد شوید")).toBeTruthy());
      expect(screen.queryByText("داشبورد عملیات")).toBeNull();
    } finally {
      shell.restore();
    }
  });
});

describe("پوستهٔ پورتال — ناوبری و capability", () => {
  const authenticated = [
    { method: "GET", path: "/api/v1/auth/me", status: 200, body: ME },
    { method: "GET", path: "/api/v1/supplier/analytics/overview", status: 200, body: { metrics: [] } },
    { method: "GET", path: "/api/v1/supplier/orders", status: 200, body: { children: [] } },
    { method: "GET", path: "/api/v1/compat/supplier/rfqs", status: 200, body: { rfqs: [] } },
  ];

  it("بدون capability تولید، آیتمِ تولید در ناوبری رندر نمی‌شود", async () => {
    const shell = renderShell([
      ...authenticated,
      { method: "GET", path: "/api/v1/supplier/production/capabilities", status: 200, body: { capabilities: [] } },
    ]);
    try {
      await waitFor(() => expect(screen.getByText("داشبورد عملیات")).toBeTruthy());
      expect(screen.queryByText("تولید و کنترل کیفیت")).toBeNull();
      expect(screen.queryByText("ظرفیت و تعطیلی")).toBeNull();
    } finally {
      shell.restore();
    }
  });

  it("با capability تولید، آیتمِ تولید ظاهر می‌شود", async () => {
    const shell = renderShell([
      ...authenticated,
      { method: "GET", path: "/api/v1/supplier/production/capabilities", status: 200, body: { capabilities: [{ id: "c1", capabilityCode: "production" }] } },
    ]);
    try {
      await waitFor(() => expect(screen.getByText("تولید و کنترل کیفیت")).toBeTruthy());
      expect(screen.getByText("ظرفیت و تعطیلی")).toBeTruthy();
    } finally {
      shell.restore();
    }
  });

  it("ناوبری، صفحهٔ هدف را عوض می‌کند", async () => {
    const shell = renderShell([
      ...authenticated,
      { method: "GET", path: "/api/v1/supplier/production/capabilities", status: 200, body: { capabilities: [] } },
      { method: "GET", path: "/api/v1/compat/supplier/products", status: 200, body: { products: [] } },
    ]);
    try {
      await waitFor(() => expect(screen.getByText("داشبورد عملیات")).toBeTruthy());
      screen.getByText("محصولات").click();
      await waitFor(() => expect(screen.getByText("هنوز محصولی ثبت نکرده‌اید")).toBeTruthy());
    } finally {
      shell.restore();
    }
  });
});

describe("پوستهٔ پورتال — تم و ذخیره‌سازی", () => {
  it("کلیدِ تم روی ریشهٔ سند اعمال می‌شود", async () => {
    const shell = renderShell([
      { method: "GET", path: "/api/v1/auth/me", status: 200, body: ME },
      { method: "GET", path: "/api/v1/supplier/production/capabilities", status: 200, body: { capabilities: [] } },
      { method: "GET", path: "/api/v1/supplier/analytics/overview", status: 200, body: { metrics: [] } },
      { method: "GET", path: "/api/v1/supplier/orders", status: 200, body: { children: [] } },
      { method: "GET", path: "/api/v1/compat/supplier/rfqs", status: 200, body: { rfqs: [] } },
    ]);
    try {
      await waitFor(() => expect(screen.getByText("داشبورد عملیات")).toBeTruthy());
      const theme = document.documentElement.dataset.supplierTheme;
      expect(theme === "light" || theme === "dark").toBe(true);
      // تنها کلیدِ localStorage، ترجیحِ تم است.
      const keys = Object.keys(window.localStorage);
      expect(keys.every(key => key === "kolbe-supplier-theme")).toBe(true);
    } finally {
      shell.restore();
    }
  });
});
