/**
 * فاز ۶.۲ — وضعیت‌های راستینِ UI برای دامنهٔ تأمین‌کننده.
 *
 * این فایل همان ۱۲ وضعیتِ `truth-registry` را روی داده‌های واقعیِ پورتال
 * تأمین‌کننده بررسی می‌کند و مهم‌ترین ادعا را اثبات می‌کند:
 *
 *      EMPTY ≠ ERROR
 *
 * یعنی وقتی سرور «صفر رکورد» می‌گوید، READY_EMPTY درست است؛ اما وقتی سرور
 * ۵۰۰/۵۰۲ می‌دهد یا شبکه قطع است، هرگز READY_EMPTY تولید نمی‌شود.
 */

import { describe, expect, it } from "vitest";
import { createApiClient } from "../shared/http/client";
import { createSupplierApi } from "../shared/supplier/client";
import { stateFromResult, isErrorState, isLoading, dataOrNull } from "../shared/ui/async-state";
import type { ApiResult } from "../shared/http/types";
import type { FetchLike } from "../shared/http/types";

function clientWith(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchImpl: FetchLike = async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  return createApiClient({ baseUrl: "/api/v1", fetch: fetchImpl });
}

function failingClient(error: unknown) {
  const fetchImpl: FetchLike = async () => {
    throw error;
  };
  return createApiClient({ baseUrl: "/api/v1", fetch: fetchImpl });
}

const ok = <T,>(data: T): ApiResult<T> => ({
  ok: true,
  data,
  meta: { status: 200, url: "/api/v1/x", method: "GET", requestId: null, headers: new Headers() },
});

describe("فاز ۶.۲ — EMPTY ≠ ERROR در فهرست‌های تأمین‌کننده", () => {
  const lists: Array<{ name: string; load: (api: ReturnType<typeof createSupplierApi>) => Promise<ApiResult<unknown>> }> = [
    { name: "محصولات", load: api => api.products.list() },
    { name: "RFQها", load: api => api.rfqs.list() },
    { name: "سفارش‌ها", load: api => api.orders.list() },
    { name: "گردش مالی", load: api => api.finance.history() },
    { name: "برداشت‌ها", load: api => api.finance.withdrawals() },
    { name: "پشتیبانی", load: api => api.support.list() },
    { name: "شغل‌های تولید", load: api => api.production.jobs() },
    { name: "موجودی", load: api => api.inventory.mine() },
  ];

  for (const list of lists) {
    it(`${list.name}: پاسخِ موفقِ خالی → READY_EMPTY`, async () => {
      const api = createSupplierApi(clientWith(200, {}));
      const result = await list.load(api);
      const state = stateFromResult(result, () => true);
      expect(state.status).toBe("READY_EMPTY");
      expect(isErrorState(state)).toBe(false);
    });

    it(`${list.name}: خطای ۵۰۰ → SERVER_ERROR (نه خالی)`, async () => {
      const api = createSupplierApi(clientWith(500, { error: "INTERNAL_ERROR", message: "خطای سرور" }));
      const result = await list.load(api);
      const state = stateFromResult(result, () => true);
      expect(state.status).toBe("SERVER_ERROR");
      expect(isErrorState(state)).toBe(true);
      expect(dataOrNull(state)).toBeNull();
    });

    it(`${list.name}: قطعی شبکه → NETWORK_ERROR (نه خالی)`, async () => {
      const api = createSupplierApi(failingClient(new TypeError("network down")));
      const result = await list.load(api);
      const state = stateFromResult(result, () => true);
      expect(state.status).toBe("NETWORK_ERROR");
      expect(isErrorState(state)).toBe(true);
    });

    it(`${list.name}: ۵۰۲ → PROVIDER_UNAVAILABLE`, async () => {
      const api = createSupplierApi(clientWith(502, { error: "UPSTREAM_UNAVAILABLE", message: "سرویس بالادستی" }));
      const result = await list.load(api);
      const state = stateFromResult(result, () => true);
      expect(state.status).toBe("PROVIDER_UNAVAILABLE");
    });
  }
});

describe("فاز ۶.۲ — وضعیت‌های دسترسی و اعتبارسنجی", () => {
  it("۴۰۱ → UNAUTHORIZED (نشست منقضی)", async () => {
    const api = createSupplierApi(clientWith(401, { error: "UNAUTHORIZED", message: "نشست منقضی شده است" }));
    const state = stateFromResult(await api.orders.list());
    expect(state.status).toBe("UNAUTHORIZED");
    if (isErrorState(state)) expect(state.error.message).toBe("نشست منقضی شده است");
  });

  it("۴۰۳ → FORBIDDEN (نقش/tenant ناکافی)", async () => {
    const api = createSupplierApi(clientWith(403, { error: "SUPPLIER_ROLE_NOT_AUTHORIZED", message: "نقش شما مجاز نیست" }));
    const state = stateFromResult(await api.finance.summary());
    expect(state.status).toBe("FORBIDDEN");
  });

  it("۴۰۴ → NOT_FOUND", async () => {
    const api = createSupplierApi(clientWith(404, { error: "ORDER_NOT_FOUND", message: "سفارش یافت نشد" }));
    const state = stateFromResult(await api.orders.get("po_x"));
    expect(state.status).toBe("NOT_FOUND");
  });

  it("۴۰۹ → CONFLICT (انتقالِ نامعتبرِ وضعیت)", async () => {
    const api = createSupplierApi(clientWith(409, { error: "INVALID_STATUS_TRANSITION", message: "این انتقال مجاز نیست" }));
    const state = stateFromResult(await api.orders.action("confirm", { id: "po_1", idempotencyKey: "k" }));
    expect(state.status).toBe("CONFLICT");
  });

  it("۴۲۲ → VALIDATION_ERROR با فیلدهای سرور", async () => {
    const api = createSupplierApi(clientWith(422, { error: "VALIDATION_FAILED", message: "amount: must be positive" }));
    const state = stateFromResult(await api.finance.requestWithdrawal("0", "k"));
    expect(state.status).toBe("VALIDATION_ERROR");
    if (isErrorState(state)) expect(state.error.issues).toEqual([{ field: "amount", message: "must be positive" }]);
  });

  it("۴۲۹ → RATE_LIMITED با Retry-After", async () => {
    const api = createSupplierApi(clientWith(429, { error: "RATE_LIMITED", message: "کمی صبر کنید" }, { "retry-after": "45" }));
    const state = stateFromResult(await api.finance.requestWithdrawal("100", "k"));
    expect(state.status).toBe("RATE_LIMITED");
    if (isErrorState(state)) expect(state.error.retryAfterSeconds).toBe(45);
  });
});

describe("فاز ۶.۲ — دادهٔ موفق همیشه قابل‌خواندن است", () => {
  it("سفارش‌های موفق به UI می‌رسند و مبلغ رشته می‌ماند", async () => {
    const api = createSupplierApi(
      clientWith(200, {
        children: [
          { id: "po_1", order_code: "KV-82941", status: "pending", total_amount: "9450000", items: [{ product_name: "پیراهن", quantity: 30 }] },
        ],
      }),
    );
    const result = await api.orders.list();
    const state = stateFromResult(result);
    expect(state.status).toBe("READY_WITH_DATA");
    const data = dataOrNull(state);
    expect(data?.children?.[0]?.totalAmount ?? (data?.children?.[0] as Record<string, unknown>)?.total_amount).toBe("9450000");
  });

  it("خلاصهٔ مالی موفق، مبالغ را رشته نگه می‌دارد", async () => {
    const api = createSupplierApi(
      clientWith(200, { availableAmount: "32400000", pendingAmount: "4860000", heldAmount: "0" }),
    );
    const result = await api.finance.summary();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.data.availableAmount).toBe("string");
      expect(result.data.availableAmount).toBe("32400000");
    }
  });

  it("شاخص‌های تحلیل موفق با واحدِ سرور می‌آیند", async () => {
    const api = createSupplierApi(
      clientWith(200, {
        metrics: [
          { key: "supplier.child_orders_count", label: "سفارش‌ها", unit: "COUNT", value: { raw: "12" }, comparison: { value: { raw: "9" } } },
          { key: "settlement.pending_amount", label: "در انتظار", unit: "IRR", value: { raw: "48600000" }, comparison: { value: null } },
        ],
      }),
    );
    const result = await api.analytics.overview();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metrics).toHaveLength(2);
      expect(result.data.metrics[1]?.value.raw).toBe("48600000");
    }
  });
});

describe("فاز ۶.۲ — LOADING هرگز دادهٔ قبلی را پنهان نمی‌کند", () => {
  it("حالتِ بارگذاری، داده ندارد و خطا هم نیست", () => {
    const state = { status: "LOADING" } as const;
    expect(isLoading(state)).toBe(true);
    expect(isErrorState(state)).toBe(false);
    expect(dataOrNull(state)).toBeNull();
  });

  it("لغوِ درخواست، وضعیتِ خطای پایانی نمی‌سازد", async () => {
    const api = createSupplierApi(
      createApiClient({
        baseUrl: "/api/v1",
        fetch: async () =>
          new Promise<Response>((_resolve, reject) => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))),
      }),
    );
    const result = await api.orders.list();
    const state = stateFromResult(result);
    // ABORTED به LOADING نگاشت می‌شود: «هنوز تصمیمی نداریم».
    expect(state.status).toBe("LOADING");
  });
});

describe("فاز ۶.۲ — پول در مرزِ تأمین‌کننده", () => {
  it("هیچ مبلغی در آداپتور به عدد تبدیل نمی‌شود", async () => {
    const api = createSupplierApi(
      clientWith(200, {
        withdrawals: [{ id: "w_1", amount: "1250000", status: "requested" }],
      }),
    );
    const result = await api.finance.withdrawals();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const amount = result.data.withdrawals[0]?.amount;
      expect(typeof amount).toBe("string");
      expect(amount).toBe("1250000");
    }
  });

  it("مبلغِ صفر با «نامشخص» اشتباه گرفته نمی‌شود", async () => {
    const api = createSupplierApi(clientWith(200, { heldAmount: "0" }));
    const result = await api.finance.summary();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.heldAmount).toBe("0");
  });
});
