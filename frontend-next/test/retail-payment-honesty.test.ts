import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products } from "../storefront/data/catalog";
import { rows } from "../server/database";
import {
  PROVIDER_BACKED_PAYMENT_METHODS,
  RETAIL_PAYMENT_METHODS,
  translateRetailOrderFromNest,
  type RetailPaymentMethod,
} from "../server/retail-pricing";
import { call, uniqueSuffix } from "./helpers";

/**
 * رگرسیون D19a — ادعای وصول پول بدون وجود ارائه‌دهندهٔ پرداخت.
 *
 * ── چه چیزی خراب بود ────────────────────────────────────────────────────────
 * هر سفارش خرده‌فروشی غیرِ COD وضعیت `pending_gateway` («منتظر درگاه بانکی»)
 * می‌گرفت، در حالی که **هیچ ارائه‌دهندهٔ پرداختی وجود ندارد** (نه درگاه، نه
 * SnappPay/DigiPay، نه کیف پول — دامنهٔ `payments` فاز ۵ است). یعنی سامانه ادعای
 * وصول پول می‌کرد که هیچ‌وقت وصول نمی‌شد و هیچ ردی برای تطبیق مالی نمی‌گذاشت
 * (یافتهٔ BLOCKER ممیزی: D19).
 *
 * ── اصلاح ───────────────────────────────────────────────────────────────────
 * وضعیت، واقعیت را می‌گوید: `cod` → `pending_cod` («پرداخت هنگام تحویل»، روشی که
 * واقعاً کار می‌کند) و بقیه → `unpaid` («پرداخت‌نشده»)، همراه با فیلد صریح
 * `payment.collected=false` در پاسخ API.
 *
 * ── فاز 5.8 ─────────────────────────────────────────────────────────────────
 * نگاشت صادق حالا در Nest زندگی می‌کند (`RetailOrdersService`؛ پین canonical در
 * سوئیت `phase-5-8-retail-order` نست) و این لبه فقط پروکسی است: بلاک پرداخت Nest
 * را کلمه‌به‌کلمه منتقل می‌کند، هیچ‌وقت `collected:true` یا `pending_gateway`
 * از خودش اختراع نمی‌کند، و هیچ ردیفی محلی نمی‌نویسد.
 */

const product = products.find((item) => item.price < 3_000_000)!;
const colour = product.colours[0].name;
const size = (product.sizes.find((s) => s.inStock) ?? product.sizes[0]).label;

function payload(payMethod: string, phone: string) {
  return {
    customer: { name: "مشتری آزمون", phone, email: "honesty@example.test" },
    lines: [{ id: product.id, name: product.name, colour, size, price: product.price, qty: 1 }],
    address: { province: "تهران", city: "تهران", address: "خیابان آزمون", plaque: "۱", unit: "۲", postal: "1234567890", note: "" },
    shipping: { id: "pishtaz", label: "پست پیشتاز", price: 89_000 },
    payMethod,
  };
}

function nestOrder(payment: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    orderCode: `RT-2026-${uniqueSuffix().slice(0, 6).toUpperCase()}`,
    status: "placed",
    replayed: false,
    currency: "IRR",
    totals: { itemsTotal: String(product.price), promotionDiscountTotal: "0", shippingTotal: "0", grandTotal: String(product.price) },
    lines: [{ productId: product.id, unitPrice: String(product.price), colour, size }],
    payment,
    ...overrides,
  };
}

const GATEWAY_PAYMENT = { method: "gateway", status: "unpaid", collected: false, requiresManualSettlement: true };
const COD_PAYMENT = { method: "cod", status: "pending_cod", collected: false, requiresManualSettlement: false };

describe("translateRetailOrderFromNest — انتقال صادق بلاک پرداخت (D19a)", () => {
  it("بلاک پرداخت Nest را کلمه‌به‌کلمه منتقل می‌کند؛ `pending_gateway` هرگز ساخته نمی‌شود", () => {
    const submitted = [{ id: product.id, price: product.price, qty: 1 }];
    for (const payment of [
      GATEWAY_PAYMENT,
      COD_PAYMENT,
      { method: "installment", status: "unpaid", collected: false, requiresManualSettlement: true },
      { method: "wallet", status: "unpaid", collected: false, requiresManualSettlement: true },
    ]) {
      const { body } = translateRetailOrderFromNest(nestOrder(payment), submitted);
      expect(body.payment).toEqual(payment);
      expect(body.payment.collected).toBe(false);
      expect(JSON.stringify(body)).not.toContain("pending_gateway");
    }
  });

  it("روش‌های نیازمند ارائه‌دهنده درست علامت‌گذاری می‌شوند", () => {
    const requiresProvider = (method: RetailPaymentMethod) =>
      (PROVIDER_BACKED_PAYMENT_METHODS as readonly string[]).includes(method);
    expect(requiresProvider("cod")).toBe(false);
    for (const method of PROVIDER_BACKED_PAYMENT_METHODS) {
      expect(requiresProvider(method)).toBe(true);
    }
    // هیچ روشی نباید از فهرست مجاز جا بماند.
    for (const method of RETAIL_PAYMENT_METHODS) {
      expect(typeof requiresProvider(method)).toBe("boolean");
    }
  });
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.KOLBE_INTERNAL_API_TOKEN = "honesty-test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KOLBE_INTERNAL_API_TOKEN;
});

describe("POST retail/orders — وضعیت واقعی پرداخت (D19a)", () => {
  it("برای درگاه، سفارش «پرداخت‌نشده» برمی‌گردد نه «منتظر درگاه»، و ردیف محلی ساخته نمی‌شود", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(nestOrder(GATEWAY_PAYMENT)), { status: 201, headers: { "content-type": "application/json" } }));
    const phone = `0912${uniqueSuffix().replace(/\D/g, "").padEnd(7, "3").slice(0, 7)}`;
    const key = `honesty-gateway-${uniqueSuffix()}`;
    const result = await call("retail/orders", {
      method: "POST",
      body: payload("gateway", phone),
      headers: { "idempotency-key": key },
    });

    expect(result.status).toBe(201);
    expect(result.body.payment).toEqual(GATEWAY_PAYMENT);
    expect(JSON.stringify(result.body)).not.toContain("pending_gateway");
    expect(await rows("SELECT id FROM retail_order WHERE phone=$1", [phone])).toHaveLength(0);
  });

  it("برای پرداخت در محل، وضعیت «در انتظار پرداخت هنگام تحویل» برمی‌گردد", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(nestOrder(COD_PAYMENT)), { status: 201, headers: { "content-type": "application/json" } }));
    const phone = `0912${uniqueSuffix().replace(/\D/g, "").padEnd(7, "4").slice(0, 7)}`;
    const key = `honesty-cod-${uniqueSuffix()}`;
    const result = await call("retail/orders", {
      method: "POST",
      body: payload("cod", phone),
      headers: { "idempotency-key": key },
    });

    expect(result.status).toBe(201);
    expect(result.body.payment).toEqual(COD_PAYMENT);
    expect(await rows("SELECT id FROM retail_order WHERE phone=$1", [phone])).toHaveLength(0);
  });

  it("هیچ پاسخ تازه‌ای ادعای وصول پول یا «منتظر درگاه» ندارد", async () => {
    const phones: string[] = [];
    const responses: unknown[] = [];
    for (const method of ["gateway", "installment", "cod", "wallet"]) {
      const payment = method === "cod" ? COD_PAYMENT : { ...GATEWAY_PAYMENT, method };
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(nestOrder(payment)), { status: 201, headers: { "content-type": "application/json" } }));
      const phone = `0912${uniqueSuffix().replace(/\D/g, "").padEnd(7, "5").slice(0, 7)}`;
      phones.push(phone);
      const result = await call("retail/orders", {
        method: "POST",
        body: payload(method, phone),
        headers: { "idempotency-key": `honesty-all-${method}-${uniqueSuffix()}` },
      });
      expect(result.status).toBe(201);
      expect(result.body.payment.method).toBe(method);
      expect(result.body.payment.collected).toBe(false);
      responses.push(result.body);
    }
    for (const body of responses) {
      // رگرسیون دقیق: مقدار قدیمی هرگز نباید برگردد.
      expect(JSON.stringify(body)).not.toContain("pending_gateway");
    }
    const stored = await rows("SELECT id FROM retail_order WHERE phone = ANY($1)", [phones]);
    expect(stored).toHaveLength(0);
  });

  it("پاسخ تکرارشده (idempotent) هم بلاک پرداخت Nest را برمی‌گرداند", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(nestOrder(GATEWAY_PAYMENT)), { status: 201, headers: { "content-type": "application/json" } }));
    const replayedCode = `RT-2026-${uniqueSuffix().slice(0, 6).toUpperCase()}`;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(nestOrder(GATEWAY_PAYMENT, { orderCode: replayedCode, replayed: true })), { status: 200, headers: { "content-type": "application/json" } }));
    const phone = `0912${uniqueSuffix().replace(/\D/g, "").padEnd(7, "6").slice(0, 7)}`;
    const key = `honesty-replay-${uniqueSuffix()}`;
    const first = await call("retail/orders", {
      method: "POST",
      body: payload("gateway", phone),
      headers: { "idempotency-key": key },
    });
    const replayed = await call("retail/orders", {
      method: "POST",
      body: payload("gateway", phone),
      headers: { "idempotency-key": key },
    });

    expect(first.status).toBe(201);
    expect(replayed.status).toBe(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.payment).toEqual(first.body.payment);
    expect(replayed.body.payment.collected).toBe(false);
  });

  it("روش پرداخت نامعتبر خرده‌فروشی هنوز رد می‌شود", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "RETAIL_PAYMENT_METHOD_INVALID", message: "invalid" }), { status: 422, headers: { "content-type": "application/json" } }));
    const phone = `0912${uniqueSuffix().replace(/\D/g, "").padEnd(7, "7").slice(0, 7)}`;
    const result = await call("retail/orders", {
      method: "POST",
      body: payload("crypto", phone),
      headers: { "idempotency-key": `honesty-bad-${uniqueSuffix()}` },
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("PAYMENT_METHOD_NOT_ALLOWED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await rows("SELECT id FROM retail_order WHERE phone=$1", [phone])).toHaveLength(0);
  });
});
