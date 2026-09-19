import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products } from "../storefront/data/catalog";
import { rows } from "../server/database";
import { call, uniqueSuffix } from "./helpers";

/**
 * Phase 4.7.5 — retail legal binding gate (legacy Next checkout → Nest Compliance).
 *
 * The browser never decides acceptance: the handler forwards the server-priced
 * facts plus the document ids the client *claims* to have accepted, and Nest
 * Compliance is authoritative. When enforcement is on, any rejection or outage
 * rolls the order back (fail closed).
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

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KOLBE_RETAIL_LEGAL_GATE;
  delete process.env.KOLBE_INTERNAL_API_TOKEN;
});

describe("POST retail/orders — Phase 4.7.5 legal gate", () => {
  it("off (default): legacy behaviour, Nest is never called", async () => {
    const result = await call("retail/orders", { method: "POST", body: payload() });
    expect(result.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforce + Nest rejects (409 LEGAL_POLICY_ACCEPTANCE_REQUIRED): no order is created and the code is surfaced", async () => {
    process.env.KOLBE_RETAIL_LEGAL_GATE = "enforce";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "LEGAL_POLICY_ACCEPTANCE_REQUIRED", message: "پذیرش لازم است" }), { status: 409, headers: { "content-type": "application/json" } }));
    const body = payload();
    const result = await call("retail/orders", { method: "POST", body, headers: { "idempotency-key": `legal-${uniqueSuffix()}` } });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("LEGAL_POLICY_ACCEPTANCE_REQUIRED");
    const stored = await rows<{ id: string }>("SELECT id FROM retail_order WHERE phone=$1", [(body.customer as any).phone]);
    expect(stored).toHaveLength(0);
  });

  it("enforce + Nest accepts: the order is created; Nest received the order code, server-priced facts and the claimed ids; the audit row records the snapshot", async () => {
    process.env.KOLBE_RETAIL_LEGAL_GATE = "enforce";
    process.env.KOLBE_INTERNAL_API_TOKEN = "internal-test-token";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ snapshotId: "tcs_test", policyBundleHash: "a".repeat(64), disclosureHash: "b".repeat(64), acceptanceIds: ["lpa_1", "lpa_2"], disclosureGaps: ["TAX_NOT_ASSESSED"] }), { status: 201, headers: { "content-type": "application/json" } }));
    const body = payload();
    const result = await call("retail/orders", { method: "POST", body });
    expect(result.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/legal\/retail\/checkout-binding$/);
    expect(init.headers["x-kolbe-internal-token"]).toBe("internal-test-token");
    const sent = JSON.parse(init.body);
    expect(sent.facts.orderRef).toBe(result.body.orderCode);
    expect(sent.acceptedPolicyDocumentIds).toEqual(["lpd_terms_v3", "lpd_privacy_v1"]);
    expect(sent.subject.phone).toBe((body.customer as any).phone);
    // server-priced, not the tampered `price: 1`
    expect(sent.facts.lines[0].unitPrice).toBe(String(product.price));
    expect(sent.facts.totals.grand).toBe(String(result.body.totals.total));
    const audit = await rows<{ after: any }>("SELECT after FROM audit_log WHERE action='retail_order.created' AND after->>'order_code'=$1", [result.body.orderCode]);
    expect(audit[0].after.legal_gate).toBe("enforce");
    expect(audit[0].after.legal_snapshot_id).toBe("tcs_test");
  });

  it("enforce + Nest unreachable: fails closed with 503 LEGAL_GATE_UNAVAILABLE and no order", async () => {
    process.env.KOLBE_RETAIL_LEGAL_GATE = "enforce";
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const body = payload();
    const result = await call("retail/orders", { method: "POST", body });
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("LEGAL_GATE_UNAVAILABLE");
    expect(await rows("SELECT id FROM retail_order WHERE phone=$1", [(body.customer as any).phone])).toHaveLength(0);
  });

  it("enforce + malformed Nest success (no snapshot id): 502 and no order", async () => {
    process.env.KOLBE_RETAIL_LEGAL_GATE = "enforce";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const body = payload();
    const result = await call("retail/orders", { method: "POST", body });
    expect(result.status).toBe(502);
    expect(result.body.error).toBe("LEGAL_GATE_INVALID_RESPONSE");
    expect(await rows("SELECT id FROM retail_order WHERE phone=$1", [(body.customer as any).phone])).toHaveLength(0);
  });
});
