import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, cleanupRetailOrders, dbQuery, ensureInitialized, unique } from "./helpers";

/**
 * Regression suite for the audit's P0 findings D1 (500 on every checkout) and
 * D3 (client-trusted money). The server must recompute line prices, shipping
 * and totals from the canonical retail price list, and enforce idempotency.
 */
let createdOrderCodes: string[] = [];
const customer = { name: "خریدار تست", phone: "09120000001" };

beforeAll(async () => {
  await ensureInitialized();
  createdOrderCodes = [];
});
afterAll(async () => cleanupRetailOrders(createdOrderCodes));

const post = (body: unknown, idem?: string) => call("POST", "retail/orders", { body, idem });
const track = (code: string) => (createdOrderCodes.push(code), code);

async function fetchOrder(orderCode: string) {
  const [row] = await dbQuery<any>("SELECT * FROM retail_order WHERE order_code=$1", [orderCode]);
  return row;
}

/** pg returns jsonb columns already parsed; tolerate both shapes. */
function jsonb<T = any>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

describe("retail checkout (server-authoritative)", () => {
  it("accepts a well-formed order (the D1 jsonb crash is gone)", async () => {
    const r = await post({
      customer,
      lines: [
        { id: "blazer-oxford", name: "بلیزر آکسفورد", colour: "مشکی", size: "L", price: 4_850_000, qty: 1, img: "/images/flat.jpg" },
        { id: "belt-leather", name: "کمربند چرم دست‌دوز", colour: "قهوه‌ای", size: "تک‌سایز", price: 980_000, qty: 2, img: "/images/detail-hem.jpg" },
      ],
      address: { province: "تهران", city: "تهران", address: "خیابان تست ۱۲", plaque: "۴", postal: "1234567890" },
      shipping: { id: "post" },
      payMethod: "gateway",
      totals: { items: 5_850_000, shipping: 0, total: 1 },
    });
    expect(r.status).toBe(201);
    const code = track(r.data.orderCode);
    const order = await fetchOrder(code);
    // Server recomputed: 4,850,000 + 2×980,000 = 6,810,000 subtotal ≥ 3M ⇒ free shipping.
    expect(Number(order.total_amount)).toBe(6_810_000);
    expect(Number(order.shipping_price)).toBe(0);
    expect(order.amount_source).toBe("server");
    expect(order.payment_status).toBe("pending_gateway");
  });

  it("ignores tampered client line prices and uses the canonical price list", async () => {
    const r = await post({
      customer,
      lines: [{ id: "blazer-oxford", price: 1, qty: 1 }],
      totals: { items: 1, shipping: 0, total: 1 },
    });
    expect(r.status).toBe(201);
    const order = await fetchOrder(track(r.data.orderCode));
    expect(Number(order.total_amount)).toBe(4_850_000); // not 1
    const lines = jsonb(order.lines);
    expect(lines[0].price).toBe(4_850_000);
  });

  it("applies the shipping rate card and free-shipping threshold", async () => {
    const small = await post({
      customer,
      lines: [{ id: "belt-leather", qty: 1 }], // 980,000 < 3M ⇒ post 59,000
      shipping: { id: "post" },
    });
    const smallOrder = await fetchOrder(track(small.data.orderCode));
    expect(Number(smallOrder.total_amount)).toBe(980_000 + 59_000);

    const express = await post({
      customer,
      lines: [{ id: "belt-leather", qty: 1 }],
      shipping: { id: "tipax" }, // 145,000
    });
    const expressOrder = await fetchOrder(track(express.data.orderCode));
    expect(Number(expressOrder.shipping_price)).toBe(145_000);

    const cod = await post({
      customer,
      lines: [{ id: "belt-leather", qty: 1 }],
      shipping: { id: "pishtaz" },
      payMethod: "cod", // COD ⇒ free shipping (mirrors storefront rule)
    });
    const codOrder = await fetchOrder(track(cod.data.orderCode));
    expect(Number(codOrder.shipping_price)).toBe(0);
    expect(codOrder.payment_status).toBe("pending_cod");
  });

  it("rejects unknown products and invalid quantities with 422, never 500", async () => {
    expect((await post({ customer, lines: [{ id: "not-a-product", qty: 1 }] })).data.error).toBe("UNKNOWN_PRODUCT");
    expect((await post({ customer, lines: [{ id: "not-a-product", qty: 1 }] })).status).toBe(422);
    expect((await post({ customer, lines: [{ id: "belt-leather", qty: 0 }] })).status).toBe(422);
    expect((await post({ customer, lines: [{ id: "belt-leather", qty: 100 }] })).status).toBe(422);
    expect((await post({ customer, lines: [{ id: "belt-leather", qty: -5 }] })).status).toBe(422);
    expect((await post({ customer, lines: [{ id: "belt-leather", qty: 1.5 }] })).status).toBe(422);
  });

  it("rejects empty carts and missing contact info", async () => {
    expect((await post({ customer, lines: [] })).status).toBe(422);
    expect((await post({ customer: { name: " ", phone: "0912" }, lines: [{ id: "belt-leather", qty: 1 }] })).status).toBe(422);
  });

  it("sanitizes the address snapshot and strips base64 image blobs from order data", async () => {
    const r = await post({
      customer,
      lines: [{ id: "belt-leather", qty: 1, img: `data:image/png;base64,${"A".repeat(500_000)}` }],
      address: { note: "x".repeat(10_000), evil: "<script>alert(1)</script>", city: "شیراز" },
    });
    expect(r.status).toBe(201);
    const order = await fetchOrder(track(r.data.orderCode));
    const address = order.address;
    expect(address.city).toBe("شیراز");
    expect("evil" in address).toBe(false);
    expect(String(address.note ?? "").length).toBeLessThanOrEqual(300);
    const lines = jsonb(order.lines);
    expect(lines[0].img).toBeNull();
  });

  it("replays the same Idempotency-Key without creating a second order", async () => {
    const key = unique("idem");
    const first = await post({ customer, lines: [{ id: "shirt-linen", qty: 1 }] }, key);
    expect(first.status).toBe(201);
    const replay = await post({ customer, lines: [{ id: "shirt-linen", qty: 1 }] }, key);
    expect(replay.status).toBe(200);
    expect(replay.data.replay).toBe(true);
    expect(replay.data.orderCode).toBe(first.data.orderCode);
    track(first.data.orderCode);
    const rows = await dbQuery("SELECT id FROM retail_order WHERE idempotency_key=$1", [key]);
    expect(rows.length).toBe(1);
  });

  it("a fresh order code is unique per request without an idempotency key", async () => {
    const a = await post({ customer, lines: [{ id: "polo-pique", qty: 1 }] });
    const b = await post({ customer, lines: [{ id: "polo-pique", qty: 1 }] });
    expect(a.data.orderCode).not.toBe(b.data.orderCode);
    track(a.data.orderCode);
    track(b.data.orderCode);
  });
});
