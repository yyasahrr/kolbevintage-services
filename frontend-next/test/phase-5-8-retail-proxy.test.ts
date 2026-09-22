import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rows } from "../server/database";
import { assertPaymentMethodAllowed } from "../server/retail-pricing";
import { call, uniqueSuffix } from "./helpers";

/**
 * Phase 5.8-A — Retail compat proxy (`POST /store/kolbe/retail/orders`).
 *
 * The Next handler is proxy-only: it translates the frozen legacy body to
 * the canonical Nest DTO, forwards cookie + idempotency key + internal
 * token, and translates the Nest response/error back to the frozen legacy
 * shape. Nest (`fetch`-mocked here) is the only writer; the real database
 * asserts the proxy performs NO local retail writes. Row-level checkout
 * assertions live in the canonical Nest suites (relocation, not weakening).
 */

function legacyPayload(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "سارا آزمون", phone: "09121234567", email: "sara@example.test" },
    lines: [
      {
        id: "prod_1",
        name: "نام نمایشی",
        colour: "مشکی",
        size: "M",
        price: 250000,
        qty: 2,
        img: "https://cdn.example.test/p1.jpg",
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
    shipping: { id: "pishtaz", label: "پست پیشتاز", price: 89000 },
    payMethod: "gateway",
    totals: { items: 1, shipping: 1, total: 2 }, // browser money: always dropped
    ...overrides,
  };
}

function nestCreated(overrides: Record<string, unknown> = {}) {
  return {
    orderCode: "RT-2026-ABC123",
    status: "placed",
    replayed: false,
    currency: "IRR",
    totals: { itemsTotal: "500000", promotionDiscountTotal: "0", shippingTotal: "89000", grandTotal: "589000" },
    lines: [{ productId: "prod_1", unitPrice: "250000", colour: "مشکی", size: "M" }],
    payment: { method: "gateway", status: "unpaid", collected: false, requiresManualSettlement: true },
    ...overrides,
  };
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn();

async function retailRowCounts() {
  const tables = ["retail_order", "retail_order_item", "audit_log"] as const;
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const found = await rows<{ count: string }>(`SELECT count(*) AS count FROM ${table}`);
    counts[table] = Number(found[0].count);
  }
  return counts;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.KOLBE_INTERNAL_API_TOKEN = "proxy-test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KOLBE_INTERNAL_API_TOKEN;
});

describe("Phase 5.8-A retail compat proxy", () => {
  it("forwards identifiers + quantity to Nest (browser money never forwarded) with cookie, key and internal token", async () => {
    fetchMock.mockResolvedValue(jsonResponse(nestCreated(), 201));
    const key = `proxy-${uniqueSuffix()}`;
    const result = await call("retail/orders", {
      method: "POST",
      body: legacyPayload(),
      headers: { "idempotency-key": key, cookie: "kolbe_session=sess_1" },
    });
    expect(result.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/retail\/orders$/);
    expect(init.method).toBe("POST");
    expect(init.headers["cookie"]).toContain("kolbe_session=sess_1");
    expect(init.headers["idempotency-key"]).toBe(key);
    expect(init.headers["x-kolbe-internal-token"]).toBe("proxy-test-token");
    const sent = JSON.parse(init.body);
    expect(sent.idempotencyKey).toBe(key);
    // Identifiers + quantity only; the tampered totals/shipping price are dropped.
    expect(sent.lines).toEqual([
      {
        productId: "prod_1",
        quantity: 2,
        colour: "مشکی",
        size: "M",
        presentedName: "نام نمایشی",
        presentedUnitPrice: 250000,
      },
    ]);
    expect(sent.totals).toBeUndefined();
    expect(sent.shipping).toBeUndefined();
    expect(sent.shippingMethodId).toBe("pishtaz");
    expect(sent.payMethod).toBe("gateway");
    expect(sent.customer).toEqual({ name: "سارا آزمون", phone: "09121234567", email: "sara@example.test" });
  });

  it("translates the Nest 201 to the exact frozen legacy shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse(nestCreated(), 201));
    const result = await call("retail/orders", { method: "POST", body: legacyPayload() });
    expect(result.status).toBe(201);
    expect(result.body).toEqual({
      orderCode: "RT-2026-ABC123",
      status: "placed",
      replayed: false,
      currency: "IRR",
      totals: { items: 500000, shipping: 89000, total: 589000 },
      adjusted: false,
      payment: { method: "gateway", status: "unpaid", collected: false, requiresManualSettlement: true },
    });
  });

  it("maps a Nest replay to HTTP 200 with replayed=true", async () => {
    fetchMock.mockResolvedValue(jsonResponse(nestCreated({ replayed: true }), 201));
    const result = await call("retail/orders", { method: "POST", body: legacyPayload() });
    expect(result.status).toBe(200);
    expect(result.body.replayed).toBe(true);
    expect(result.body.orderCode).toBe("RT-2026-ABC123");
  });

  it("derives adjusted=true when the browser price hint differs from the server truth", async () => {
    fetchMock.mockResolvedValue(jsonResponse(nestCreated(), 201));
    const tampered = legacyPayload({
      lines: [
        { id: "prod_1", name: "نام نمایشی", colour: "مشکی", size: "M", price: 1, qty: 2, img: "https://cdn.example.test/p1.jpg" },
      ],
    });
    const result = await call("retail/orders", { method: "POST", body: tampered });
    expect(result.status).toBe(201);
    expect(result.body.adjusted).toBe(true);
    // ...while the totals still come from Nest, never from the tampered hint.
    expect(result.body.totals).toEqual({ items: 500000, shipping: 89000, total: 589000 });
  });

  it("generates a server idempotency key when the client omits it", async () => {
    fetchMock.mockResolvedValue(jsonResponse(nestCreated(), 201));
    const result = await call("retail/orders", { method: "POST", body: legacyPayload() });
    expect(result.status).toBe(201);
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body);
    expect(sent.idempotencyKey).toMatch(/^rt-[a-z0-9]+-[a-f0-9]{8}$/);
  });

  it("rejects a malformed client key locally (422) without calling Nest", async () => {
    const before = await retailRowCounts();
    const result = await call("retail/orders", {
      method: "POST",
      body: legacyPayload(),
      headers: { "idempotency-key": "short" },
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await retailRowCounts()).toEqual(before);
  });

  it("translates Nest retail validation codes back to the frozen legacy codes (422)", async () => {
    const cases: Array<[string, string]> = [
      ["RETAIL_PRODUCT_NOT_FOUND", "PRODUCT_UNAVAILABLE"],
      ["RETAIL_PRODUCT_NOT_KOLBE", "PRODUCT_UNAVAILABLE"],
      ["RETAIL_PRODUCT_NOT_PUBLISHED", "PRODUCT_UNAVAILABLE"],
      ["RETAIL_VARIANT_NOT_FOUND", "SIZE_UNAVAILABLE"],
      ["RETAIL_VARIANT_UNRESOLVED", "SIZE_UNAVAILABLE"],
      ["RETAIL_VARIANT_AMBIGUOUS", "SIZE_UNAVAILABLE"],
      ["RETAIL_OFFER_MISSING", "PRODUCT_UNAVAILABLE"],
      ["RETAIL_CUSTOMER_NAME_REQUIRED", "CUSTOMER_NAME_REQUIRED"],
      ["RETAIL_CUSTOMER_PHONE_INVALID", "CUSTOMER_PHONE_INVALID"],
      ["RETAIL_ADDRESS_INCOMPLETE", "ADDRESS_INCOMPLETE"],
      ["RETAIL_LINES_REQUIRED", "EMPTY_CART"],
      ["RETAIL_TOO_MANY_LINES", "TOO_MANY_LINES"],
      ["RETAIL_LINE_PRODUCT_REQUIRED", "LINE_PRODUCT_REQUIRED"],
      ["RETAIL_QUANTITY_INVALID", "INVALID_QUANTITY"],
      ["RETAIL_PAYMENT_METHOD_INVALID", "PAYMENT_METHOD_NOT_ALLOWED"],
      ["RETAIL_SHIPPING_METHOD_INVALID", "INVALID_SHIPPING_METHOD"],
      ["RETAIL_IDEMPOTENCY_KEY_INVALID", "INVALID_IDEMPOTENCY_KEY"],
    ];
    for (const [nestCode, legacyCode] of cases) {
      fetchMock.mockResolvedValue(jsonResponse({ error: nestCode, message: nestCode }, 400));
      const result = await call("retail/orders", { method: "POST", body: legacyPayload() });
      expect(result.status, nestCode).toBe(422);
      expect(result.body.error, nestCode).toBe(legacyCode);
    }
  });

  it("surfaces new-surface Nest failures (409 conflict, legal, stock) with their own status and code", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "RETAIL_IDEMPOTENCY_CONFLICT", message: "conflict" }, 409));
    const conflict = await call("retail/orders", { method: "POST", body: legacyPayload() });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("RETAIL_IDEMPOTENCY_CONFLICT");

    fetchMock.mockResolvedValue(jsonResponse({ error: "LEGAL_POLICY_ACCEPTANCE_REQUIRED", message: "legal" }, 409));
    const legal = await call("retail/orders", { method: "POST", body: legacyPayload() });
    expect(legal.status).toBe(409);
    expect(legal.body.error).toBe("LEGAL_POLICY_ACCEPTANCE_REQUIRED");

    fetchMock.mockResolvedValue(jsonResponse({ error: "RETAIL_INSUFFICIENT_STOCK", message: "stock" }, 409));
    const stock = await call("retail/orders", { method: "POST", body: legacyPayload() });
    expect(stock.status).toBe(409);
    expect(stock.body.error).toBe("RETAIL_INSUFFICIENT_STOCK");
  });

  it("forwards coupon codes and accepted policy ids; Nest outage fails closed (503) with no local writes", async () => {
    const before = await retailRowCounts();
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const result = await call("retail/orders", {
      method: "POST",
      body: legacyPayload({ couponCodes: ["WELCOME10"], acceptedPolicyDocumentIds: ["lpd_terms_v3"] }),
    });
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("RETAIL_UPSTREAM_UNAVAILABLE");
    expect(await retailRowCounts()).toEqual(before);

    // The same body forwards the new-surface fields when Nest is reachable.
    fetchMock.mockResolvedValue(jsonResponse(nestCreated(), 201));
    const ok = await call("retail/orders", {
      method: "POST",
      body: legacyPayload({ couponCodes: ["WELCOME10"], acceptedPolicyDocumentIds: ["lpd_terms_v3"] }),
    });
    expect(ok.status).toBe(201);
    const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const sent = JSON.parse(init.body);
    expect(sent.couponCodes).toEqual(["WELCOME10"]);
    expect(sent.acceptedPolicyDocumentIds).toEqual(["lpd_terms_v3"]);
    // Still no local writes on the success path either.
    expect(await retailRowCounts()).toEqual(before);
  });

  it("BNPL (installment) stays retail-only at the channel-policy helper", () => {
    expect(() => assertPaymentMethodAllowed("retail", "installment")).not.toThrow();
    expect(() => assertPaymentMethodAllowed("wholesale", "installment")).toThrowError(/PAYMENT_METHOD_NOT_ALLOWED/);
  });

  it("statically: the compat server never touches retail_order/retail_order_item (proxy-only, A18)", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const source = await readFile(join(here, "../server/kolbe-api.ts"), "utf8");
    // Raw-source write pins (no stripping involved, so no false pass).
    expect(source).not.toMatch(/INSERT\s+INTO\s+retail_order/i);
    expect(source).not.toMatch(/UPDATE\s+retail_order/i);
    expect(source).not.toMatch(/DELETE\s+FROM\s+retail_order/i);
    // Stronger: outside comments the handler has zero retail-table references
    // at all (no reads either — Nest owns the rows, the edge only proxies).
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");
    const hits = [...code.matchAll(/.*retail_order.*/g)].map((m) => m[0].trim());
    expect(hits).toEqual([]);
  });
});
