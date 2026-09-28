import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products } from "../storefront/data/catalog";
import { rows } from "../server/database";
import { call, uniqueSuffix } from "./helpers";

/**
 * Phase 5.8 — retail legal binding gate through the compat proxy.
 *
 * The browser never decides acceptance: the proxy forwards the claimed
 * document ids to Nest, and Nest Compliance binds evidence in-process
 * inside the checkout transaction. Enforcement failures fail closed with
 * no local writes (evidence assertions live in the canonical Nest suites).
 */
const product = products.find((p) => p.price >= 3_000_000)!;
const size = (product.sizes.find((s) => s.inStock) ?? product.sizes[0]).label;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "مشتری آزمون", phone: `0912${uniqueSuffix().replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}`, email: "legal@example.test" },
    lines: [{ id: product.id, name: product.name, colour: product.colours[0].name, size, price: 1, qty: 1, img: product.images[0] }],
    address: { province: "تهران", city: "تهران", address: "خیابان آزمون", plaque: "۱", unit: "۲", postal: "1234567890", note: "" },
    shipping: { id: "pishtaz", label: "پست پیشتاز", price: 89_000 },
    payMethod: "gateway",
    acceptedPolicyDocumentIds: ["lpd_terms_v3", "lpd_privacy_v1"],
    ...overrides,
  };
}

function nestOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderCode: `RT-2026-${uniqueSuffix().slice(0, 6).toUpperCase()}`,
    status: "placed",
    replayed: false,
    currency: "IRR",
    totals: { itemsTotal: String(product.price), promotionDiscountTotal: "0", shippingTotal: "0", grandTotal: String(product.price) },
    lines: [{ productId: product.id, unitPrice: String(product.price), colour: product.colours[0].name, size }],
    payment: { method: "gateway", status: "unpaid", collected: false, requiresManualSettlement: true },
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.KOLBE_INTERNAL_API_TOKEN = "legal-test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KOLBE_INTERNAL_API_TOKEN;
});

describe("POST retail/orders — Phase 4.7.5 legal gate", () => {
  it("delegates every checkout to Nest with the claimed policy ids (gate lives in-process now)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(nestOrder()), { status: 201, headers: { "content-type": "application/json" } }));
    const result = await call("retail/orders", { method: "POST", body: payload() });
    expect(result.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/retail\/orders$/);
    expect(init.headers["x-kolbe-internal-token"]).toBe("legal-test-token");
    const sent = JSON.parse(init.body);
    expect(sent.acceptedPolicyDocumentIds).toEqual(["lpd_terms_v3", "lpd_privacy_v1"]);
    // The tampered `price: 1` travels as a display hint only.
    expect(sent.lines[0].presentedUnitPrice).toBe(1);
    expect("price" in sent.lines[0]).toBe(false);
  });

  it("Nest legal rejection (409): no local order is created and the code is surfaced", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "LEGAL_POLICY_ACCEPTANCE_REQUIRED", message: "پذیرش لازم است" }), { status: 409, headers: { "content-type": "application/json" } }));
    const body = payload();
    const result = await call("retail/orders", { method: "POST", body, headers: { "idempotency-key": `legal-${uniqueSuffix()}` } });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("LEGAL_POLICY_ACCEPTANCE_REQUIRED");
    const stored = await rows<{ id: string }>("SELECT id FROM retail_order WHERE phone=$1", [(body.customer as any).phone]);
    expect(stored).toHaveLength(0);
  });

  it("Nest accepts: the translated order is returned with no local writes", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(nestOrder()), { status: 201, headers: { "content-type": "application/json" } }));
    const body = payload();
    const before = await rows<{ count: string }>("SELECT count(*) AS count FROM retail_order");
    const result = await call("retail/orders", { method: "POST", body });
    expect(result.status).toBe(201);
    expect(result.body.orderCode).toMatch(/^RT-\d{4}-[A-Z0-9]{6}$/);
    const after = await rows<{ count: string }>("SELECT count(*) AS count FROM retail_order");
    expect(after[0].count).toBe(before[0].count);
    expect((body.customer as any).phone).toBeTruthy();
  });

  it("Nest unreachable: fails closed with 503 RETAIL_UPSTREAM_UNAVAILABLE and no order", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const body = payload();
    const result = await call("retail/orders", { method: "POST", body });
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("RETAIL_UPSTREAM_UNAVAILABLE");
    expect(await rows("SELECT id FROM retail_order WHERE phone=$1", [(body.customer as any).phone])).toHaveLength(0);
  });

  it("malformed Nest success (no order code): 502 and no order", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const body = payload();
    const result = await call("retail/orders", { method: "POST", body });
    expect(result.status).toBe(502);
    expect(result.body.error).toBe("RETAIL_UPSTREAM_INVALID");
    expect(await rows("SELECT id FROM retail_order WHERE phone=$1", [(body.customer as any).phone])).toHaveLength(0);
  });
});
