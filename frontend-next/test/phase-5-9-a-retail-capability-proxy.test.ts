import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./helpers";

/**
 * Phase 5.9-A — guest capability echo on the retail compat proxy.
 *
 * Nest emits `guestCapability` (fresh guest creations only). The proxy
 * strips the secret from the frozen legacy body (byte-identical for legacy
 * browsers) and echoes it ONLY as the `X-Retail-Order-Token` response
 * header. Nest (`fetch`-mocked here) is the only writer.
 */

function legacyPayload(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "مهمان آزمون", phone: "09120000000", email: null },
    lines: [
      {
        id: "prod_1",
        name: "نام نمایشی",
        colour: "مشکی",
        size: "M",
        price: 250000,
        qty: 1,
        img: "https://cdn.example.test/p1.jpg",
      },
    ],
    address: {
      province: "تهران",
      city: "تهران",
      address: "خیابان آزمون",
      plaque: "۱",
      unit: "۲",
      postal: "1234567890",
      note: "",
    },
    shipping: { id: "pishtaz", label: "پست پیشتاز", price: 89000 },
    payMethod: "cod",
    totals: { items: 1, shipping: 1, total: 2 },
    ...overrides,
  };
}

function nestCreated(overrides: Record<string, unknown> = {}) {
  return {
    orderCode: "RT-2026-GUEST1",
    status: "placed",
    replayed: false,
    currency: "IRR",
    totals: { itemsTotal: "250000", promotionDiscountTotal: "0", shippingTotal: "89000", grandTotal: "339000" },
    lines: [{ productId: "prod_1", unitPrice: "250000", colour: "مشکی", size: "M" }],
    payment: { method: "cod", status: "pending_cod", collected: false, requiresManualSettlement: false },
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
  process.env.KOLBE_INTERNAL_API_TOKEN = "proxy-test-token-59a";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KOLBE_INTERNAL_API_TOKEN;
});

describe("Phase 5.9-A retail capability proxy", () => {
  it("echoes a fresh guest capability as a header while the legacy body stays byte-identical", async () => {
    fetchMock.mockResolvedValue(jsonResponse(nestCreated({ guestCapability: "rgc_testsecret000000000001" }), 201));
    const result = await call("retail/orders", { method: "POST", body: legacyPayload() });
    expect(result.status).toBe(201);
    expect(result.body).toEqual({
      orderCode: "RT-2026-GUEST1",
      status: "placed",
      replayed: false,
      currency: "IRR",
      totals: { items: 250000, shipping: 89000, total: 339000 },
      adjusted: false,
      payment: { method: "cod", status: "pending_cod", collected: false, requiresManualSettlement: false },
    });
    expect(JSON.stringify(result.body)).not.toContain("rgc_");
    expect(result.headers.get("x-retail-order-token")).toBe("rgc_testsecret000000000001");
  });

  it("sets no capability header when Nest emits none (customer orders, replays)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(nestCreated(), 201));
    const created = await call("retail/orders", { method: "POST", body: legacyPayload() });
    expect(created.status).toBe(201);
    expect(created.headers.get("x-retail-order-token")).toBeNull();

    fetchMock.mockResolvedValue(jsonResponse(nestCreated({ replayed: true }), 201));
    const replayed = await call("retail/orders", { method: "POST", body: legacyPayload() });
    expect(replayed.status).toBe(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.headers.get("x-retail-order-token")).toBeNull();
  });
});
