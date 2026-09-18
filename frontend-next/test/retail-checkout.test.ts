import { describe, expect, it } from "vitest";
import { products } from "../storefront/data/catalog";
import { rows } from "../server/database";
import { call, uniqueSuffix } from "./helpers";

/**
 * آزمون‌های چک‌اوت خرده‌فروشی.
 *
 * این فایل رگرسیون دو ایراد P0 ممیزی است:
 *  - D1: هر `POST retail/orders` با HTTP 500 شکست می‌خورد
 *        (`invalid input syntax for type json` چون آرایهٔ JS خام به jsonb پاس می‌شد).
 *  - D3: قیمت و جمع کل از مرورگر پذیرفته و ذخیره می‌شد (Price Tampering).
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

describe("POST retail/orders — ثبت سفارش خرده‌فروشی", () => {
  it("سفارش معتبر را می‌پذیرد و کد سفارش برمی‌گرداند (رگرسیون D1)", async () => {
    const result = await call("retail/orders", { method: "POST", body: orderPayload() });

    expect(result.status).toBe(201);
    expect(result.body.orderCode).toMatch(/^RT-\d{4}-[A-Z0-9]{6}$/);
    expect(result.body.replayed).toBe(false);
    expect(result.body.currency).toBe("IRR");

    // اطمینان از اینکه واقعاً در دیتابیس نشسته است (نه فقط پاسخ ۲۰۱).
    const stored = await rows<{ id: string; lines: unknown[] }>(
      "SELECT id, lines FROM retail_order WHERE order_code=$1",
      [result.body.orderCode],
    );
    expect(stored).toHaveLength(1);
    expect(Array.isArray(stored[0].lines)).toBe(true);
    expect(stored[0].lines).toHaveLength(1);
  });

  it("جمع کل را سمت سرور محاسبه می‌کند و قیمت دستکاری‌شدهٔ مرورگر را نادیده می‌گیرد (D3)", async () => {
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

  it("مبلغ ذخیره‌شده در دیتابیس با محاسبهٔ سرور یکی است", async () => {
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload({ payMethod: "cod" }),
    });
    expect(result.status).toBe(201);

    const stored = await rows<{ items_total: string; shipping_price: string; total_amount: string; payment_status: string; pay_method: string }>(
      "SELECT items_total, shipping_price, total_amount, payment_status, pay_method FROM retail_order WHERE order_code=$1",
      [result.body.orderCode],
    );
    expect(Number(stored[0].items_total)).toBe(expensive.price);
    expect(Number(stored[0].total_amount)).toBe(expensive.price);
    // پرداخت در محل: هزینهٔ ارسال صفر و وضعیت پرداخت متفاوت.
    expect(Number(stored[0].shipping_price)).toBe(0);
    expect(stored[0].pay_method).toBe("cod");
    expect(stored[0].payment_status).toBe("pending_cod");
  });

  it(" برای اقلام ارزان، هزینهٔ ارسال انتخاب‌شده را اضافه می‌کند", async () => {
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

  it("اقلام ساخت‌یافته را با Snapshot نام/کد/قیمت ذخیره می‌کند", async () => {
    const result = await call("retail/orders", { method: "POST", body: orderPayload() });
    const items = await rows<{ product_name: string; unit_price: string; quantity: number; product_id: string }>(
      `SELECT i.product_name, i.unit_price, i.quantity, i.product_id
       FROM retail_order_item i JOIN retail_order o ON o.id=i.order_id WHERE o.order_code=$1`,
      [result.body.orderCode],
    );
    expect(items).toHaveLength(1);
    expect(items[0].product_id).toBe(expensive.id);
    expect(items[0].product_name).toBe(expensive.name);
    expect(Number(items[0].unit_price)).toBe(expensive.price);
  });

  it("محصول ناشناخته را رد می‌کند", async () => {
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
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload({ customer: { name: "آزمون", phone: "12345" } }),
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("CUSTOMER_PHONE_INVALID");
  });

  it("نبود استان/شهر/نشانی را رد می‌کند", async () => {
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload({ address: { province: "تهران" } }),
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("ADDRESS_INCOMPLETE");
  });

  it("سبد خالی را رد می‌کند", async () => {
    const result = await call("retail/orders", { method: "POST", body: orderPayload({ lines: [] }) });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("EMPTY_CART");
  });

  it("روش پرداخت ناشناخته را رد می‌کند", async () => {
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload({ payMethod: "installment-wholesale" }),
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("PAYMENT_METHOD_NOT_ALLOWED");
  });

  it("با Idempotency-Key یکسان، تنها یک سفارش می‌سازد", async () => {
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
    expect(Number(count[0].count)).toBe(1);
  });

  it("کلید Idempotency نامعتبر را رد می‌کند", async () => {
    const result = await call("retail/orders", {
      method: "POST",
      body: orderPayload(),
      headers: { "idempotency-key": "short" },
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  it("BNPL (پرداخت اقساطی) فقط در خرده‌فروشی مجاز است", async () => {
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
