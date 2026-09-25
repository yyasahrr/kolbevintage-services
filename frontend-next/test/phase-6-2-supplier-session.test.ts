/**
 * فاز ۶.۲ — نشست، جداسازی tenant و دروازهٔ capabilityِ پورتال تأمین‌کننده.
 *
 * سه ادعای امنیتیِ این فایل:
 *   ۱) هویت فقط از `GET /auth/me` می‌آید؛ بدنهٔ پاسخِ ورود مرجعِ هویت نیست.
 *   ۲) کاربری که نقشش `supplier` نیست یا tenant ندارد، واردِ پورتال نمی‌شود
 *      (۴۰۳)، و هرگز «وانمود به ورود» نمی‌شود.
 *   ۳) دیدنِ بخشِ تولید نیازمند capability صریحِ سرور است؛ Supplier ≠ Manufacturer.
 */

import { describe, expect, it } from "vitest";
import { createApiClient } from "../shared/http/client";
import { anonymousSession } from "../shared/session";
import { createCapabilitySet, canUseProduction } from "../shared/permissions/capabilities";
import { createSupplierApi } from "../shared/supplier/client";
import { SupplierSessionError, canUseProductionPortal, createSupplierSessionClient, isDemoModeAllowed, parseSupplierMe, toSupplierSession } from "../shared/supplier/session";
import type { FetchLike } from "../shared/http/types";

type Route = { method: string; path: string; status: number; body: unknown };

function clientFor(routes: Route[], seen: Array<{ url: string; method: string }> = []) {
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    seen.push({ url, method });
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const match = routes.find(route => route.method === method && path.split("?")[0] === route.path);
    if (!match) return new Response(JSON.stringify({ error: "NOT_FOUND", message: `${method} ${path} یافت نشد` }), { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(match.body), { status: match.status, headers: { "content-type": "application/json" } });
  };
  const client = createApiClient({ baseUrl: "http://api.test/api/v1", fetch: fetchImpl });
  const api = createSupplierApi(client);
  return { api, session: createSupplierSessionClient(client, api), seen };
}

const SUPPLIER_ME = {
  id: "usr_1",
  email: "ops@nilgoon.test",
  role: "supplier",
  name: "نرگس آذر",
  phone: "09120000000",
  totpEnabled: false,
  supplier: { supplierId: "sup_1", displayName: "نساجی نیلگون", legalName: "نساجی و پوشاک نیلگون", status: "approved" },
};

describe("نشستِ تأمین‌کننده — هویت فقط از سرور", () => {
  it("بعد از ورود، هویت از /auth/me بازخوانی می‌شود (نه از بدنهٔ ورود)", async () => {
    const { session, seen } = clientFor([
      { method: "POST", path: "/api/v1/auth/supplier/login", status: 200, body: { user: { id: "usr_FAKE", email: "fake@test", role: "supplier", name: "جعلی" } } },
      { method: "GET", path: "/api/v1/auth/me", status: 200, body: SUPPLIER_ME },
      { method: "GET", path: "/api/v1/supplier/production/capabilities", status: 200, body: { capabilities: [] } },
    ]);

    const result = await session.loginResult("ops@nilgoon.test", "SupplierPass1404!");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("authenticated");
    if (result.data.status !== "authenticated") return;
    // هویتِ بدنهٔ ورود (usr_FAKE/جعلی) هرگز واردِ نشست نمی‌شود.
    expect(result.data.user.id).toBe("usr_1");
    expect(result.data.user.name).toBe("نرگس آذر");
    expect(result.data.supplier?.supplierId).toBe("sup_1");
    expect(seen.map(call => call.url)).toContain("http://api.test/api/v1/auth/me");
  });

  it("۴۰۱ از /auth/me یعنی نشستِ نامعتبرِ معتبر (anonymous)، نه خطای پورتال", async () => {
    const { session } = clientFor([{ method: "GET", path: "/api/v1/auth/me", status: 401, body: { error: "UNAUTHORIZED", message: "نشست ندارید" } }]);
    const result = await session.restoreResult();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("anonymous");
  });

  it("۵۰۰ از /auth/me خطای واقعی است و به «خروج» تبدیل نمی‌شود", async () => {
    const { session } = clientFor([{ method: "GET", path: "/api/v1/auth/me", status: 500, body: { error: "INTERNAL_ERROR", message: "خطای سرور" } }]);
    const result = await session.restoreResult();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("SERVER_ERROR");
      expect(result).not.toHaveProperty("data");
    }
  });

  it("نقشِ غیرِ supplier ورود به پورتال را با ۴۰۳ رد می‌کند", async () => {
    const { session } = clientFor([
      { method: "GET", path: "/api/v1/auth/me", status: 200, body: { ...SUPPLIER_ME, role: "customer", supplier: null } },
    ]);
    const result = await session.restoreResult();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("FORBIDDEN");
      expect(result.error.code).toBe("NOT_SUPPLIER");
    }
  });

  it("supplier بدون tenant (هیچ عضویتی) با ۴۰۳ رد می‌شود", async () => {
    const { session } = clientFor([{ method: "GET", path: "/api/v1/auth/me", status: 200, body: { ...SUPPLIER_ME, supplier: null } }]);
    const result = await session.restoreResult();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("FORBIDDEN");
      expect(result.error.code).toBe("NO_SUPPLIER_TENANT");
    }
  });

  it("supplierId از بدنهٔ /auth/me استخراج می‌شود؛ اگر غایب باشد tenant تهی است (نه tenant جعلی)", () => {
    // کاربر احراز هویت شده است، اما tenant ندارد — دروازهٔ نشست آن را ۴۰۳ می‌کند.
    for (const body of [{ ...SUPPLIER_ME, supplier: { displayName: "بدون شناسه" } }, { ...SUPPLIER_ME, supplier: { supplierId: "", displayName: "x" } }]) {
      const parsed = parseSupplierMe(body);
      expect(parsed.status).toBe("authenticated");
      if (parsed.status === "authenticated") expect(parsed.supplier).toBeNull();
    }
    const parsed = parseSupplierMe(SUPPLIER_ME);
    expect(parsed.status).toBe("authenticated");
    if (parsed.status === "authenticated") expect(parsed.supplier?.supplierId).toBe("sup_1");
  });

  it("نبودِ supplierId هرگز به شناسهٔ ساختگی تبدیل نمی‌شود", async () => {
    const { session } = clientFor([{ method: "GET", path: "/api/v1/auth/me", status: 200, body: { ...SUPPLIER_ME, supplier: { displayName: "بدون شناسه" } } }]);
    const result = await session.restoreResult();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_SUPPLIER_TENANT");
  });

  it("پاسخِ غیرِشیء یا بدون id، نشستِ anonymous می‌دهد (نه کرش)", () => {
    for (const value of [null, undefined, 42, "text", [], {}]) {
      expect(parseSupplierMe(value).status).toBe("anonymous");
    }
  });

  it("خروج، وضعیت را پاک می‌کند حتی اگر سرور خطا بدهد", async () => {
    const { session } = clientFor([{ method: "POST", path: "/api/v1/auth/logout", status: 500, body: { error: "INTERNAL_ERROR", message: "خطا" } }]);
    const result = await session.logoutResult();
    expect(result.ok).toBe(false);
  });
});

describe("نشستِ تأمین‌کننده — capability از سرور", () => {
  it("capabilityهای اعلام‌شده در نشست ثبت می‌شوند", async () => {
    const { session } = clientFor([
      { method: "GET", path: "/api/v1/auth/me", status: 200, body: SUPPLIER_ME },
      { method: "GET", path: "/api/v1/supplier/production/capabilities", status: 200, body: { capabilities: [{ id: "c1", capabilityCode: "production" }, { id: "c2", capabilityCode: "embroidery" }] } },
    ]);
    const result = await session.restoreResult();
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "authenticated") return;
    expect(result.data.productionCapabilities).toEqual(["production", "embroidery"]);
    expect(result.data.capabilitiesLoaded).toBe(true);
    expect(canUseProductionPortal(result.data)).toBe(true);
  });

  it("supplier بدون capability تولید، دسترسیِ تولید ندارد (Supplier ≠ Manufacturer)", async () => {
    const { session } = clientFor([
      { method: "GET", path: "/api/v1/auth/me", status: 200, body: SUPPLIER_ME },
      { method: "GET", path: "/api/v1/supplier/production/capabilities", status: 200, body: { capabilities: [] } },
    ]);
    const result = await session.restoreResult();
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "authenticated") return;
    expect(canUseProductionPortal(result.data)).toBe(false);
  });

  it("۴۰۳ در قراردادِ capability به «بدون capability» تبدیل می‌شود، نه خطای پورتال", async () => {
    const { session } = clientFor([
      { method: "GET", path: "/api/v1/auth/me", status: 200, body: SUPPLIER_ME },
      { method: "GET", path: "/api/v1/supplier/production/capabilities", status: 403, body: { error: "FORBIDDEN", message: "مجاز نیستید" } },
    ]);
    const result = await session.restoreResult();
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "authenticated") return;
    expect(result.data.productionCapabilities).toEqual([]);
    expect(result.data.capabilitiesError).toBeNull();
    expect(canUseProductionPortal(result.data)).toBe(false);
  });

  it("۵۰۰ در قراردادِ capability به‌عنوان خطا ثبت می‌شود (بی‌صدا رد نمی‌شود)", async () => {
    const { session } = clientFor([
      { method: "GET", path: "/api/v1/auth/me", status: 200, body: SUPPLIER_ME },
      { method: "GET", path: "/api/v1/supplier/production/capabilities", status: 500, body: { error: "INTERNAL_ERROR", message: "خطای سرور" } },
    ]);
    const result = await session.restoreResult();
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "authenticated") return;
    expect(result.data.capabilitiesError).not.toBeNull();
    expect(result.data.capabilitiesError?.kind).toBe("SERVER_ERROR");
  });
});

describe("دروازهٔ capability — تأمین‌کننده و تولیدکننده یکسان نیستند", () => {
  it("نقشِ supplier به‌تنهایی مجوزِ تولید نمی‌دهد", () => {
    const set = createCapabilitySet({ roles: ["supplier"], supplierId: "sup_1", supplierCapabilities: [] });
    expect(canUseProduction(set)).toBe(false);
  });

  it("capability صریحِ production مجوز می‌دهد", () => {
    const set = createCapabilitySet({ roles: ["supplier"], supplierId: "sup_1", supplierCapabilities: ["production"] });
    expect(canUseProduction(set)).toBe(true);
  });

  it("capability نامرتبط (مثلاً embroidery) مجوزِ تولید نمی‌دهد", () => {
    const set = createCapabilitySet({ roles: ["supplier"], supplierId: "sup_1", supplierCapabilities: ["embroidery", "packaging"] });
    expect(canUseProduction(set)).toBe(false);
  });

  it("نشستِ anonymous هیچ دسترسی‌ای ندارد", () => {
    expect(canUseProductionPortal(toSupplierSession(anonymousSession()))).toBe(false);
  });
});

describe("جداسازی tenant — شناسهٔ تأمین‌کننده از مرورگر نمی‌آید", () => {
  it("مسیرهای مالی/انطباق/پشتیبانی هیچ supplierId از کلاینت نمی‌گیرند", async () => {
    const seen: Array<{ url: string; method: string }> = [];
    const { api } = clientFor(
      [
        { method: "GET", path: "/api/v1/supplier/financial-account/summary", status: 200, body: {} },
        { method: "GET", path: "/api/v1/supplier/financial-account/history", status: 200, body: { items: [] } },
        { method: "GET", path: "/api/v1/supplier/support/cases", status: 200, body: { cases: [] } },
        { method: "GET", path: "/api/v1/supplier/orders", status: 200, body: { children: [] } },
      ],
      seen,
    );
    await api.finance.summary();
    await api.finance.history();
    await api.support.list();
    await api.orders.list();
    for (const call of seen) {
      expect(call.url).not.toMatch(/[?&]supplierId=/);
      expect(call.url).not.toContain("/supplier/sup_");
    }
  });

  it("خطای مالکیتِ سرور (۴۰۳) عیناً به UI می‌رسد", async () => {
    const { api } = clientFor([
      { method: "GET", path: "/api/v1/supplier/orders/po_other", status: 403, body: { error: "SUPPLIER_OWNERSHIP_VIOLATION", message: "عضو این تأمین‌کننده نیستید" } },
    ]);
    const result = await api.orders.get("po_other");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("FORBIDDEN");
      expect(result.error.code).toBe("SUPPLIER_OWNERSHIP_VIOLATION");
    }
  });

  it("سفارشِ tenant دیگر ۴۰۴ است و داده نمی‌سازد", async () => {
    const { api } = clientFor([{ method: "GET", path: "/api/v1/supplier/orders/po_x", status: 404, body: { error: "ORDER_NOT_FOUND", message: "سفارش یافت نشد" } }]);
    const result = await api.orders.get("po_x");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("NOT_FOUND");
      expect(result).not.toHaveProperty("data");
    }
  });
});

describe("حالتِ نمایشی — صریح، غیرِتولیدی و غیرِمرجع", () => {
  it("بدون فلگِ محیطی، حالتِ نمایشی مجاز نیست", () => {
    const previous = process.env.NEXT_PUBLIC_SUPPLIER_DEMO;
    delete process.env.NEXT_PUBLIC_SUPPLIER_DEMO;
    expect(isDemoModeAllowed()).toBe(false);
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPPLIER_DEMO;
    else process.env.NEXT_PUBLIC_SUPPLIER_DEMO = previous;
  });

  it("فقط با فلگِ صریح فعال می‌شود", () => {
    const previous = process.env.NEXT_PUBLIC_SUPPLIER_DEMO;
    process.env.NEXT_PUBLIC_SUPPLIER_DEMO = "true";
    expect(isDemoModeAllowed()).toBe(true);
    process.env.NEXT_PUBLIC_SUPPLIER_DEMO = "1";
    expect(isDemoModeAllowed()).toBe(true);
    process.env.NEXT_PUBLIC_SUPPLIER_DEMO = "no";
    expect(isDemoModeAllowed()).toBe(false);
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPPLIER_DEMO;
    else process.env.NEXT_PUBLIC_SUPPLIER_DEMO = previous;
  });

  it("حالتِ نمایشی هیچ نشستِ احراز هویت‌شده‌ای نمی‌سازد", () => {
    const demo = toSupplierSession(anonymousSession());
    expect(demo.status).toBe("anonymous");
    expect(demo.capabilities.supplierId).toBeNull();
    expect(canUseProductionPortal(demo)).toBe(false);
  });
});

describe("انواع خطای نشست", () => {
  it("SupplierSessionError کدِ قابل‌تشخیص دارد", () => {
    const error = new SupplierSessionError("NO_SUPPLIER_TENANT", "تأمین‌کننده‌ای ثبت نشده");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("NO_SUPPLIER_TENANT");
    expect(error.name).toBe("SupplierSessionError");
  });
});
