/**
 * فاز ۶.۲ — آداپتورهای دامنهٔ تأمین‌کننده روی مرز مشترکِ فاز ۶.۱.
 *
 * این تست‌ها بدون دیتابیس و بدون Nest اجرا می‌شوند: یک `fetch` جعلی، مسیر و
 * هدرها و بدنهٔ هر فراخوانی را ثبت می‌کند و ما قراردادِ آداپتور را بررسی
 * می‌کنیم. هدف، اثباتِ چهار چیز است:
 *
 *   ۱) مسیرها دقیقاً همان کنترلرهای واقعی Nest هستند (نه مسیرِ حدسی).
 *   ۲) هیچ فراخوانی شکست را به آرایهٔ خالی/صفر تبدیل نمی‌کند.
 *   ۳) عملیاتِ تغییردهنده `Idempotency-Key` می‌برد.
 *   ۴) پول همیشه رشتهٔ ده‌دهی است؛ هیچ float‌ای به سرور نمی‌رود.
 */

import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../shared/http/client";
import { ApiError } from "../shared/http/errors";
import { createSupplierApi, newIdempotencyKey } from "../shared/supplier/client";
import type { FetchLike } from "../shared/http/types";

type RecordedCall = { url: string; method: string; body: unknown; headers: Record<string, string> };

function harness(response: { status?: number; body?: unknown } = {}) {
  const calls: RecordedCall[] = [];
  const status = response.status ?? 200;
  const fetchImpl: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit | undefined).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({
      url: String(input),
      method: (init?.method ?? "GET").toUpperCase(),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      headers,
    });
    const payload = response.body ?? {};
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createApiClient({ baseUrl: "/api/v1", fetch: fetchImpl });
  return { api: createSupplierApi(client), calls };
}

describe("آداپتور تأمین‌کننده — مسیرها همان قراردادهای واقعیِ بک‌اند هستند", () => {
  it("ورود به مسیر canonical ورودِ تأمین‌کننده می‌رود", async () => {
    const { api, calls } = harness();
    await api.auth.login({ email: "factory@example.test", password: "SupplierPass1404!" });
    expect(calls[0]?.url).toBe("/api/v1/auth/supplier/login");
    expect(calls[0]?.method).toBe("POST");
  });

  it("هویت فقط از /auth/me خوانده می‌شود", async () => {
    const { api, calls } = harness();
    await api.auth.me();
    expect(calls[0]?.url).toBe("/api/v1/auth/me");
  });

  it("درخواست عضویت عمومی است و به suppliers/applications می‌رود", async () => {
    const { api, calls } = harness();
    await api.auth.apply({
      companyName: "پوشاک نیلگون",
      representativeName: "نرگس آذر",
      phone: "09120000000",
      category: "پوشاک مردانه",
      monthlyCapacity: 5000,
    });
    expect(calls[0]?.url).toBe("/api/v1/suppliers/applications");
    expect(calls[0]?.method).toBe("POST");
  });

  it("فهرست محصولات از seam ثبت‌شدهٔ compat می‌آید، نه مسیرِ اختراعی", async () => {
    const { api, calls } = harness({ body: { products: [] } });
    await api.products.list({ limit: 20, offset: 40 });
    expect(calls[0]?.url).toBe("/api/v1/compat/supplier/products?limit=20&offset=40");
  });

  it("سفارش‌ها از کنترلر canonical supplier/orders می‌آیند", async () => {
    const { api, calls } = harness({ body: { children: [] } });
    await api.orders.list();
    expect(calls[0]?.url).toBe("/api/v1/supplier/orders");
  });

  it("عملیاتِ چرخهٔ عمر به مسیرِ واقعیِ هر انتقال می‌رود", async () => {
    const { api, calls } = harness({ body: { child: { id: "po_1" } } });
    for (const transition of ["confirm", "start-preparation", "ready", "dispatch", "deliver", "cancel"] as const) {
      await api.orders.action(transition, { id: "po_1", idempotencyKey: newIdempotencyKey() });
    }
    expect(calls.map(call => call.url)).toEqual([
      "/api/v1/supplier/orders/po_1/confirm",
      "/api/v1/supplier/orders/po_1/start-preparation",
      "/api/v1/supplier/orders/po_1/ready",
      "/api/v1/supplier/orders/po_1/dispatch",
      "/api/v1/supplier/orders/po_1/deliver",
      "/api/v1/supplier/orders/po_1/cancel",
    ]);
  });

  it("مالی و برداشت به کنترلر supplier/financial-account می‌روند", async () => {
    const { api, calls } = harness();
    await api.finance.summary();
    await api.finance.history({ limit: 10, offset: 0 });
    await api.finance.withdrawals({ limit: 10 });
    await api.finance.withdrawal("w_1");
    expect(calls.map(call => call.url)).toEqual([
      "/api/v1/supplier/financial-account/summary",
      "/api/v1/supplier/financial-account/history?limit=10&offset=0",
      "/api/v1/supplier/financial-account/withdrawals?limit=10",
      "/api/v1/supplier/financial-account/withdrawals/w_1",
    ]);
  });

  it("انطباق از کنترلر supplier/compliance می‌آید و اسناد با :supplierId خوانده می‌شوند", async () => {
    const { api, calls } = harness();
    await api.compliance.documents("sup_1");
    await api.compliance.documentAccess("doc_1");
    await api.compliance.eligibility("sup_1");
    expect(calls.map(call => call.url)).toEqual([
      "/api/v1/supplier/compliance/sup_1/documents",
      "/api/v1/supplier/compliance/documents/doc_1/access",
      "/api/v1/supplier/compliance/sup_1/settlement-eligibility",
    ]);
  });

  it("پشتیبانی از کنترلر supplier/support/cases می‌آید", async () => {
    const { api, calls } = harness();
    await api.support.list({ limit: 20 });
    await api.support.get("case_1");
    expect(calls.map(call => call.url)).toEqual([
      "/api/v1/supplier/support/cases?limit=20",
      "/api/v1/supplier/support/cases/case_1",
    ]);
  });

  it("تولید از کنترلر supplier/production می‌آید", async () => {
    const { api, calls } = harness();
    await api.production.jobs({ page: 2, limit: 20, status: "in_progress" });
    await api.production.capabilities();
    await api.production.capacityPeriods({ limit: 10 });
    expect(calls.map(call => call.url)).toEqual([
      "/api/v1/supplier/production/jobs?page=2&limit=20&status=in_progress",
      "/api/v1/supplier/production/capabilities",
      "/api/v1/supplier/production/capacity-periods?limit=10",
    ]);
  });
});

describe("آداپتور تأمین‌کننده — هیچ شکستی به «خالی» تبدیل نمی‌شود", () => {
  const failureStatuses = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503];

  for (const status of failureStatuses) {
    it(`خطای ${status} در فهرست محصولات، نتیجهٔ شکست است (نه آرایهٔ خالی)`, async () => {
      const { api } = harness({ status, body: { error: "SOMETHING", message: "خطا", requestId: "req_1" } });
      const result = await api.products.list();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // کلیدِ داده اصلاً وجود ندارد: مصرف‌کننده نمی‌تواند اشتباهاً `[]` بخواند.
        expect(result).not.toHaveProperty("data");
        expect(result.error.status).toBe(status);
        expect(result.error.requestId).toBe("req_1");
      }
    });
  }

  it("شکستِ شبکه هم نتیجهٔ شکست است، نه فهرستِ خالی", async () => {
    const client = createApiClient({
      baseUrl: "/api/v1",
      fetch: async () => {
        throw new TypeError("network down");
      },
    });
    const api = createSupplierApi(client);
    for (const load of [api.orders.list(), api.rfqs.list(), api.finance.history(), api.support.list()]) {
      const result = await load;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("NETWORK_ERROR");
        expect(result).not.toHaveProperty("data");
      }
    }
  });

  it("۵۰۲/۵۰۴ همیشه PROVIDER_UNAVAILABLE است و ۵۰۳ فقط با کدِ مناسب", async () => {
    for (const [status, expected] of [
      [502, "PROVIDER_UNAVAILABLE"],
      [504, "PROVIDER_UNAVAILABLE"],
      [503, "PROVIDER_UNAVAILABLE"],
    ] as const) {
      const { api } = harness({ status, body: { error: "SMS_PROVIDER_UNAVAILABLE", message: "سرویس پیامک در دسترس نیست" } });
      const result = await api.support.list();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(expected);
    }

    const { api } = harness({ status: 503, body: { error: "MAINTENANCE", message: "در حال نگهداری" } });
    const result = await api.support.list();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SERVER_ERROR");
  });

  it("خطای اعتبارسنجی، پیام و فیلدهای سرور را حفظ می‌کند", async () => {
    const { api } = harness({ status: 422, body: { error: "VALIDATION_FAILED", message: "email: must be an email | phone: invalid", requestId: "req_2" } });
    const result = await api.auth.apply({ companyName: "", representativeName: "", phone: "", category: "", monthlyCapacity: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("VALIDATION_ERROR");
      expect(result.error.issues).toEqual([
        { field: "email", message: "must be an email" },
        { field: "phone", message: "invalid" },
      ]);
    }
  });

  it("۴۲۹ زمانِ تلاشِ دوباره را از Retry-After می‌گیرد", async () => {
    const client = createApiClient({
      baseUrl: "/api/v1",
      fetch: async () => new Response(JSON.stringify({ error: "RATE_LIMITED", message: "کمی صبر کنید" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "30" },
      }),
    });
    const api = createSupplierApi(client);
    const result = await api.finance.requestWithdrawal("1000", newIdempotencyKey());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("RATE_LIMITED");
      expect(result.error.retryAfterSeconds).toBe(30);
    }
  });
});

describe("آداپتور تأمین‌کننده — Idempotency و امنیتِ ورودی", () => {
  it("هر عملیاتِ تغییردهنده هدر Idempotency-Key می‌برد", async () => {
    const { api, calls } = harness({ body: { child: { id: "po_1" } } });
    await api.orders.action("confirm", { id: "po_1", idempotencyKey: newIdempotencyKey() });
    expect(calls[0]?.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{16,}$/i);
  });

  it("کلیدِ یکتا در دو فراخوانی متفاوت، متفاوت است", () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });

  it("کدِ رهگیری فقط برای dispatch و فقط وقتی فرستاده می‌شود که اپراتور آن را داده باشد", async () => {
    const { api, calls } = harness({ body: { child: { id: "po_1" } } });
    // بدون ورودیِ اپراتور: هیچ کدی ساخته نمی‌شود.
    await api.orders.action("dispatch", { id: "po_1", idempotencyKey: newIdempotencyKey() });
    expect(calls[0]?.body).toEqual({});

    await api.orders.action("dispatch", { id: "po_1", idempotencyKey: newIdempotencyKey(), trackingCode: "TRK-9931", carrier: "پست پیشتاز" });
    expect(calls[1]?.body).toEqual({ trackingCode: "TRK-9931", carrier: "پست پیشتاز" });

    // برای انتقال‌های دیگر، کدِ رهگیری هرگز ارسال نمی‌شود.
    await api.orders.action("confirm", { id: "po_1", idempotencyKey: newIdempotencyKey(), trackingCode: "TRK-9931" });
    expect(calls[2]?.body).toEqual({});
  });

  it("expectedVersion فقط وقتی فرستاده می‌شود که سرور آن را اعلام کرده باشد", async () => {
    const { api, calls } = harness({ body: { child: { id: "po_1" } } });
    await api.orders.action("confirm", { id: "po_1", idempotencyKey: newIdempotencyKey(), expectedVersion: 7 });
    expect(calls[0]?.body).toEqual({ expectedVersion: 7 });
  });

  it("شناسه‌های مسیر URL-encode می‌شوند تا تزریقِ مسیر ممکن نباشد", async () => {
    const { api, calls } = harness();
    await api.orders.get("../admin/wholesale/orders/x");
    expect(calls[0]?.url).toBe("/api/v1/supplier/orders/..%2Fadmin%2Fwholesale%2Forders%2Fx");
  });

  it("شناسهٔ تأمین‌کننده از بدنهٔ درخواست نمی‌آید: مسیرهای مالی بدون supplierId ارسال می‌شوند", async () => {
    const { api, calls } = harness();
    await api.finance.summary();
    await api.finance.history();
    await api.finance.withdrawals();
    for (const call of calls) {
      expect(call.url).not.toContain("supplierId=");
    }
  });
});

describe("آداپتور تأمین‌کننده — پول همیشه رشتهٔ ده‌دهی است", () => {
  it("درخواست برداشت مبلغ را رشته می‌فرستد، نه عدد", async () => {
    const { api, calls } = harness({ body: { withdrawal: { id: "w_1", amount: "1250000", status: "requested" } } });
    await api.finance.requestWithdrawal("1250000", newIdempotencyKey());
    const body = calls[0]?.body as { amount: unknown };
    expect(typeof body.amount).toBe("string");
    expect(body.amount).toBe("1250000");
  });

  it("پیشنهاد RFQ قیمت واحد را رشته می‌فرستد", async () => {
    const { api, calls } = harness({ body: { offer: { id: "of_1" } } });
    await api.rfqs.quote("rfq_1", { unitPrice: "1890000", leadTimeDays: 21 });
    const body = calls[0]?.body as { unitPrice: unknown; leadTimeDays: unknown };
    expect(typeof body.unitPrice).toBe("string");
    expect(body.unitPrice).toBe("1890000");
    expect(body.leadTimeDays).toBe(21);
    expect(calls[0]?.url).toBe("/api/v1/offers/compat/rfqs/rfq_1/quote");
  });

  it("ثبت محصول قیمت عمده را رشتهٔ ده‌دهی می‌فرستد", async () => {
    const { api, calls } = harness({ body: { product: { id: "p_1", name: "x", sku: "X", status: "submitted" } } });
    await api.products.submit({ name: "پیراهن", sku: "KH-1", category: "پوشاک مردانه", wholesalePrice: "1890000", stock: 12 });
    const body = calls[0]?.body as { wholesalePrice: unknown };
    expect(typeof body.wholesalePrice).toBe("string");
    expect(calls[0]?.url).toBe("/api/v1/catalog/compat/supplier-submissions");
  });

  it("درخواست‌های پولی content-type صریح می‌برند تا سرور بدنه را درست بخواند", async () => {
    const { api, calls } = harness({ body: { withdrawal: { id: "w_1", amount: "1", status: "requested" } } });
    await api.finance.requestWithdrawal("1", newIdempotencyKey());
    expect(calls[0]?.headers["content-type"]).toContain("application/json");
  });
});

describe("آداپتور تأمین‌کننده — لغو و تایم‌اوت", () => {
  it("لغوِ درخواست، وضعیت ABORTED می‌دهد و داده نمی‌سازد", async () => {
    const controller = new AbortController();
    const client = createApiClient({
      baseUrl: "/api/v1",
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    });
    const api = createSupplierApi(client);
    const promise = client.requestResult<{ children: unknown[] }>("/supplier/orders", { signal: controller.signal });
    controller.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ABORTED");
      expect(result).not.toHaveProperty("data");
    }
    void api;
  });
});

describe("آداپتور تأمین‌کننده — ApiError یک نوعِ واحد است", () => {
  it("خطای بازگشتی نمونهٔ ApiError است تا UI بتواند kind را بخواند", async () => {
    const { api } = harness({ status: 403, body: { error: "SUPPLIER_OWNERSHIP_VIOLATION", message: "عضو این تأمین‌کننده نیستید" } });
    const result = await api.orders.get("po_9");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ApiError);
      expect(result.error.kind).toBe("FORBIDDEN");
      expect(result.error.code).toBe("SUPPLIER_OWNERSHIP_VIOLATION");
      expect(result.error.message).toBe("عضو این تأمین‌کننده نیستید");
    }
  });

  it("پاسخِ بدشکل (non-JSON) خطای SERVER_ERROR می‌دهد، نه دادهٔ خالی", async () => {
    const client = createApiClient({
      baseUrl: "/api/v1",
      fetch: async () => new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }),
    });
    const api = createSupplierApi(client);
    const result = await api.orders.list();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("MALFORMED_RESPONSE");
      expect(result).not.toHaveProperty("data");
    }
  });
});

describe("آداپتور تأمین‌کننده — هیچ fetch مستقیمی در supplier-src نیست", () => {
  it("فقط shared/http/client.ts به globalThis.fetch دست می‌زند", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(import.meta.dirname, "..", "supplier-src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, `${file} نباید fetch مستقیم داشته باشد`).not.toMatch(/\bfetch\s*\(/);
      expect(source, `${file} نباید XMLHttpRequest داشته باشد`).not.toContain("XMLHttpRequest");
    }
  });

  it("supplier-src هیچ کلید localStorage کسب‌وکاری نمی‌سازد", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(import.meta.dirname, "..", "supplier-src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(root);
    const forbidden = ["kv_supplier_holidays", "kv_supplier_roles", "kv_supplier_team", "kv_supplier_capacity", "kv_supplier_finance"];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const key of forbidden) expect(source, `${file} نباید ${key} داشته باشد`).not.toContain(key);
    }
  });
});

describe("آداپتور تأمین‌کننده — vi.spyOn روی fetch اثر ندارد (مرز واحد)", () => {
  it("کلاینتِ ساخته‌شده فقط از fetch تزریق‌شده استفاده می‌کند", async () => {
    const spy = vi.fn();
    const client = createApiClient({ baseUrl: "/api/v1", fetch: spy as unknown as FetchLike });
    const api = createSupplierApi(client);
    spy.mockResolvedValue(new Response(JSON.stringify({ children: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    await api.orders.list();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
