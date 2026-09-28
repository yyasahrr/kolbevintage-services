import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products } from "../storefront/data/catalog";
import { rows } from "../server/database";
import { call, uniqueSuffix } from "./helpers";

/**
 * آزمون‌های چک‌اوت خرده‌فروشی (Phase 5.8: سازگاری پروکسی).
 *
 * رگرسیون دو ایراد P0 ممیزی همچنان پابرجاست:
 *  - D1: هر `POST retail/orders` با HTTP 500 شکست می‌خورد.
 *  - D3: قیمت و جمع کل از مرورگر پذیرفته و ذخیره می‌شد (Price Tampering).
 *
 * از 5.8-A به بعد نویسندهٔ canonical نست است و این هندلر فقط پروکسی است؛
 * پس Nest این‌جا `fetch`-mock است و آزمون‌های سطح ردیف به سوئیت‌های
 * canonical نست منتقل شده‌اند (جابه‌جایی، نه تضعیف). این فایل قرارداد لبه را پین می‌کند:
 * شکل قدیمی منجمد + ترجمهٔ خطا + عدم نوشتن محلی.
 */

const expensive = products.find((product) => product.price >= 3_000_000)!;
const cheap = products.find((product) => product.price < 3_000_000)!;

function inStockSize(product: typeof products[number]) {
  return (product.sizes.find((size) => size.inStock) ?? product.sizes[0]).label;
}

function orderPayload(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "سارا آزمون", phone: "09121234567", email: "sara@example.test" },
    lines: [
      {
        id: expensive.id,
        name: expensive.name,
        colour: expensive.colours[0].name,
        size: inStockSize(expensive),
        price: expensive.price,
        qty: 1,
        img: expensive.images[0],
      },
    ],
    address: {
      province: "تهران",
      city: "تهران",
      address: "خیابان آزمون، پلاک ۱",
      plaque: "۱",
      unit: "۲",
      postal: "1234567890",
      note: "",
    },
    shipping: { id: "pishtaz", label: "پست پیشتاز", price: 89_000 },
    payMethod: "gateway",
    ...overrides,
  };
}

function nestOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderCode: `RT-2026-${uniqueSuffix().slice(0, 6).toUpperCase()}`,
    status: "placed",
    replayed: false,
    currency: "IRR",
    totals: { itemsTotal: String(expensive.price), promotionDiscountTotal: "0", shippingTotal: "0", grandTotal: String(expensive.price) },
    lines: [{ productId: expensive.id, unitPrice: String(expensive.price), colour: expensive.colours[0].name, size: inStockSize(expensive) }],
    payment: { method: "gateway", status: "unpaid", collected: false, requiresManualSettlement: true },
    ...overrides,
  };
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.KOLBE_INTERNAL_API_TOKEN = "checkout-test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KOLBE_INTERNAL_API_TOKEN;
});

describe("POST retail/orders — ثبت سفارش خرده‌فروشی", () => {
  it("سفارش معتبر را می‌پذیرد و کد سفارش برمی‌گرداند (رگرسیون D1)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(nestOrder(), 201));
    const result = await call("retail/orders", { method: "POST", body: orderPayload() });

    expect(result.status).toBe(201);
    expect(result.body.orderCode).toMatch(/^RT-\d{4}-[A-Z0-9]{6}$/);
    expect(result.body.replayed).toBe(false);
    expect(result.body.currency).toBe("IRR");

    // پروکسی شناسه‌ها را به نست داده و خودش چیزی ننوشته است.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).lines[0].productId).toBe(expensive.id);
    const stored = await rows<{ count: string }>(
      "SELECT count(*) AS count FROM retail_order WHERE order_code=$1",
      [result.body.orderCode],
    );
    expect(Number(stored[0].count)).toBe(0);
  });

  it("جمع کل را سمت سرور محاسبه می‌کند و قیمت دستکاری‌شدهٔ مرورگر را نادیده می‌گیرد (D3)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        nestOrder({
          totals: { itemsTotal: String(expensive.price * 2), promotionDiscountTotal: "0", shippingTotal: "0", grandTotal: String(expensive.price * 2) },
        }),
        201,
      ),
    );
    const tampered = orderPayload({
      lines: [
        {
          id: expensive.id,
          name: expensive.name,
          colour: expensive.colours[0].name,
          size: inStockSize(expensive),
          price: 1, // تلاش برای دستکاری قیمت
          qty: 2,
          img: expensive.images[0],
        },
      ],
    });

    const result = await call("retail/orders", { method: "POST", body: tampered });

    expect(result.status).toBe(201);
    const expectedItems = expensive.price * 2;
    expect(result.body.totals.items).toBe(expectedItems);
    // قیمت کاتالوگ بالای آستانهٔ ارسال رایگان است.
    expect(result.body.totals.total).toBe(expectedItems);
    // سرور باید اختلاف قیمت را علامت‌گذاری کند تا UI به کاربر اطلاع دهد.
    expect(result.body.adjusted).toBe(true);
  });

  it("مبلغ پاسخ با محاسبهٔ سرور یکی است", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        nestOrder({
          totals: { itemsTotal: String(expensive.price), promotionDiscountTotal: "0", shippingTotal: "0", grandTotal: String(expensive.price) },
          payment: { method: "cod", status: "pending_cod", collected: false, requiresManualSettlement: false },
        }),
        201,
      ),
    );
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload({ payMethod: "cod" }),
    });
    expect(result.status).toBe(201);
    expect(result.body.totals.items).toBe(expensive.price);
    expect(result.body.totals.total).toBe(expensive.price);
    // پرداخت در محل: هزینهٔ ارسال صفر و وضعیت پرداخت متفاوت.
    expect(result.body.totals.shipping).toBe(0);
    expect(result.body.payment.method).toBe("cod");
    expect(result.body.payment.status).toBe("pending_cod");
  });

  it(" برای اقلام ارزان، هزینهٔ ارسال انتخاب‌شده را اضافه می‌کند", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        nestOrder({
          totals: { itemsTotal: String(cheap.price), promotionDiscountTotal: "0", shippingTotal: "89000", grandTotal: String(cheap.price + 89_000) },
          lines: [{ productId: cheap.id, unitPrice: String(cheap.price), colour: cheap.colours[0].name, size: inStockSize(cheap) }],
        }),
        201,
      ),
    );
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload({
        lines: [
          {
            id: cheap.id,
            name: cheap.name,
            colour: cheap.colours[0].name,
            size: inStockSize(cheap),
            price: cheap.price,
            qty: 1,
            img: cheap.images[0],
          },
        ],
      }),
    });

    expect(result.status).toBe(201);
    expect(result.body.totals.items).toBe(cheap.price);
    expect(result.body.totals.shipping).toBe(89_000);
    expect(result.body.totals.total).toBe(cheap.price + 89_000);
  });

  it("اقلام را با Snapshot نام/کد/قیمت سرور به نست می‌فرستد", async () => {
    fetchMock.mockResolvedValue(jsonResponse(nestOrder(), 201));
    const result = await call("retail/orders", { method: "POST", body: orderPayload() });
    expect(result.status).toBe(201);
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body);
    // فقط شناسه + تعداد به مرجع می‌رود؛ نام/قیمت/عکس hint نمایشی‌اند.
    expect(sent.lines[0].productId).toBe(expensive.id);
    expect(sent.lines[0].quantity).toBe(1);
    expect(sent.lines[0].presentedName).toBe(expensive.name);
    expect(sent.lines[0].presentedUnitPrice).toBe(expensive.price);
    expect("price" in sent.lines[0]).toBe(false);
    expect("totals" in sent).toBe(false);
  });

  it("محصول ناشناخته را رد می‌کند", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "RETAIL_PRODUCT_NOT_FOUND", message: "not found" }, 404));
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload({
        lines: [{ id: "product-does-not-exist", name: "جعلی", price: 1, qty: 1, size: "M" }],
      }),
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("PRODUCT_UNAVAILABLE");
  });

  it("سایز نامعتبر را رد می‌کند", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "RETAIL_VARIANT_UNRESOLVED", message: "no match" }, 422));
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload({
        lines: [
          {
            id: expensive.id,
            name: expensive.name,
            colour: expensive.colours[0].name,
            size: "XXXXL",
            price: expensive.price,
            qty: 1,
          },
        ],
      }),
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("SIZE_UNAVAILABLE");
  });

  it("شمارهٔ موبایل نامعتبر را رد می‌کند", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "RETAIL_CUSTOMER_PHONE_INVALID", message: "bad phone" }, 400));
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload({ customer: { name: "آزمون", phone: "12345" } }),
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("CUSTOMER_PHONE_INVALID");
  });

  it("نبود استان/شهر/نشانی را رد می‌کند", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "RETAIL_ADDRESS_INCOMPLETE", message: "bad address" }, 400));
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload({ address: { province: "تهران" } }),
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("ADDRESS_INCOMPLETE");
  });

  it("سبد خالی را رد می‌کند", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "RETAIL_LINES_REQUIRED", message: "empty" }, 400));
    const result = await call("retail/orders", { method: "POST", body: orderPayload({ lines: [] }) });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("EMPTY_CART");
  });

  it("روش پرداخت ناشناخته را رد می‌کند", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "RETAIL_PAYMENT_METHOD_INVALID", message: "bad method" }, 400));
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload({ payMethod: "installment-wholesale" }),
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("PAYMENT_METHOD_NOT_ALLOWED");
  });

  it("با Idempotency-Key یکسان، تنها یک سفارش می‌سازد", async () => {
    const created = nestOrder();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(created, 201))
      .mockResolvedValueOnce(jsonResponse({ ...created, replayed: true }, 201));
    const key = `test-${uniqueSuffix()}-idem`;
    const first = await call("retail/orders", {
      method: "POST",
      body: orderPayload(),
      headers: { "idempotency-key": key },
    });
    const second = await call("retail/orders", {
      method: "POST",
      body: orderPayload(),
      headers: { "idempotency-key": key },
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.orderCode).toBe(first.body.orderCode);

    const count = await rows<{ count: string }>(
      "SELECT count(*) AS count FROM retail_order WHERE idempotency_key=$1",
      [key],
    );
    expect(Number(count[0].count)).toBe(0);
  });

  it("کلید Idempotency نامعتبر را رد می‌کند", async () => {
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload(),
      headers: { "idempotency-key": "short" },
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("BNPL (پرداخت اقساطی) فقط در خرده‌فروشی مجاز است", async () => {
    fetchMock.mockResolvedValue(jsonResponse(nestOrder(), 201));
    const retail = await call("retail/orders", {
      method: "POST",
      body: orderPayload({ payMethod: "installment" }),
    });
    // در خرده‌فروشی مجاز است…
    expect(retail.status).toBe(201);

    // …و در عمده‌فروشی باید رد شود (قاعدهٔ «BNPL is currently RETAIL ONLY»).
    const { assertPaymentMethodAllowed } = await import("../server/retail-pricing");
    expect(() => assertPaymentMethodAllowed("wholesale", "installment")).toThrowError(
      /PAYMENT_METHOD_NOT_ALLOWED/,
    );
  });
});
