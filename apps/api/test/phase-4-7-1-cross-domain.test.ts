/**
 * Phase 4.7.1 — Stage D: cross-domain regression.
 *
 * One order travels the whole way over the real HTTP surface (session cookies,
 * Idempotency-Key headers, public provider webhooks): confirm → online payment
 * (webhook-verified) → supplier accept/prepare → carrier quote → admin selects the
 * quote after payment (late fee, D2) → buyer pays the delta → shipment → handoff
 * → carrier in_transit/delivered → order completed. Then the cross-domain
 * invariants are checked against the database.
 */
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ROOT,
  bootHarness,
  count,
  createOrder,
  fakeWebhookBody,
  inventoryFor,
  makeId,
  one,
  orderItemsForChild,
  q,
  seedTwoSuppliers,
  signedFakeHeaders,
  signedFakeShippingHeaders,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_4_7_1_cross_domain_test";

let h: Harness;
let ctx: SupplierContext;

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
}, 180_000);

afterAll(async () => {
  await h?.close();
});

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

describe("Phase 4.7.1 — D: end-to-end over HTTP", () => {
  it("order → webhook-verified payment → late shipping fee (delta) → shipment → handoff → carrier delivered → completed; invariants hold", async () => {
    const { order, childA } = await createOrder(h, ctx, { qtyA: 3 });
    const buyer = cookie(ctx.userBuyer, "vip");
    const supplier = cookie(ctx.userAOwner, "supplier");
    const admin = cookie(ctx.userAdmin, "admin");
    const inv0 = await inventoryFor(h, ctx.varId, ctx.sellerA);

    // 1. buyer confirms → proformas issued → awaiting_payment
    await api().post(`/api/v1/wholesale/orders/${order.id}/confirm`).set("Cookie", buyer).set("Idempotency-Key", makeId("k")).send({}).expect((r) => expect([200, 201]).toContain(r.status));
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("awaiting_payment");

    // 2. buyer opens an online intent; the gateway webhook (public, signed) verifies through the canonical path
    const intent = await api().post(`/api/v1/wholesale/orders/${order.id}/payments/online`).set("Cookie", buyer).set("Idempotency-Key", makeId("k")).send({ provider: "fake" }).expect((r) => expect([200, 201]).toContain(r.status));
    const paymentId = intent.body.payment?.id;
    expect(paymentId).toBeTruthy();
    const payRow = await one(h.pool, `SELECT provider_reference FROM payment WHERE id = $1`, [paymentId]);
    // the buyer legitimately receives the gateway reference/redirect, never a provider secret
    expect(JSON.stringify(intent.body)).not.toMatch(/secret|signature/i);
    const wh = await api().post(`/api/v1/payments/providers/fake/webhook`).set(signedFakeHeaders()).send(fakeWebhookBody(payRow.provider_reference, { eventId: "evt-d-" + paymentId })).expect(200);
    expect(wh.body.status).toBe("processed");
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("processing");

    // 3. supplier accepts + starts preparation over HTTP
    await api().post(`/api/v1/supplier/orders/${childA.id}/confirm`).set("Cookie", supplier).set("Idempotency-Key", makeId("k")).send({}).expect((r) => expect([200, 201]).toContain(r.status));
    await api().post(`/api/v1/supplier/orders/${childA.id}/start-preparation`).set("Cookie", supplier).set("Idempotency-Key", makeId("k")).send({}).expect((r) => expect([200, 201]).toContain(r.status));
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("preparing");

    // 4. carrier quote (supplier) — TxA → provider → TxB; admin selects it AFTER payment ⇒ delta obligation only (D2)
    const quote = await api().post(`/api/v1/supplier/shipments/quote`).set("Cookie", supplier).set("Idempotency-Key", makeId("k")).send({ childOrderId: childA.id, provider: "fake" }).expect((r) => expect([200, 201]).toContain(r.status));
    const quoteId = quote.body.quote.id;
    const fee = BigInt(quote.body.quote.amount);
    expect(fee).toBeGreaterThan(0n);
    const sel = await api().post(`/api/v1/admin/shipping/quotes/${quoteId}/select`).set("Cookie", admin).set("Idempotency-Key", makeId("k")).send({}).expect((r) => expect([200, 201]).toContain(r.status));
    expect(sel.body.fee.superseded).toBe(true);
    expect(sel.body.fee.shippingDelta).toBe(fee.toString());
    const summaryAfterFee = await api().get(`/api/v1/wholesale/orders/${order.id}/financial-summary`).set("Cookie", buyer).expect(200);
    expect(summaryAfterFee.body.summary?.currentPayable ?? summaryAfterFee.body.currentPayable).toBe(fee.toString());
    // the released order stays released; nothing is re-gated
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("processing");

    // 5. buyer pays exactly the delta by transfer; admin verifies; no second release
    const delta = await api().post(`/api/v1/wholesale/orders/${order.id}/payments/transfer`).set("Cookie", buyer).set("Idempotency-Key", makeId("k")).send({ amount: fee.toString(), bankReference: "BANK-D-" + order.id }).expect((r) => expect([200, 201]).toContain(r.status));
    await api().post(`/api/v1/admin/payments/${delta.body.payment.id}/verify`).set("Cookie", admin).set("Idempotency-Key", makeId("k")).send({ externalReference: "BANK-D-" + order.id }).expect((r) => expect([200, 201]).toContain(r.status));
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBe(1);

    // 6. shipment over HTTP — server-derived parent/address/responsibility, quantities checked
    const items = await orderItemsForChild(h, childA.id);
    const shipKey = makeId("k");
    const created = await api()
      .post(`/api/v1/supplier/shipments`)
      .set("Cookie", supplier)
      .set("Idempotency-Key", shipKey)
      .send({ childOrderId: childA.id, provider: "fake", quoteId, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 3 }] })
      .expect((r) => expect([200, 201]).toContain(r.status));
    const shipmentId = created.body.shipment.id;
    expect(created.body.shipment.status).toBe("ready");
    const replay = await api()
      .post(`/api/v1/supplier/shipments`)
      .set("Cookie", supplier)
      .set("Idempotency-Key", shipKey)
      .send({ childOrderId: childA.id, provider: "fake", quoteId, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 3 }] })
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.shipment.id).toBe(shipmentId);
    // the other supplier cannot even read it
    const denied = await api().get(`/api/v1/supplier/shipments/${shipmentId}`).set("Cookie", cookie(ctx.userBOwner, "supplier")).expect(403);
    expect(denied.body.error).toBe("SHIPMENT_ACCESS_DENIED");

    // 7. handoff over HTTP ⇒ inventory consumed once, child shipped (all pieces in this shipment)
    const handoff = await api().post(`/api/v1/supplier/shipments/${shipmentId}/handoff`).set("Cookie", supplier).set("Idempotency-Key", makeId("k")).send({}).expect((r) => expect([200, 201]).toContain(r.status));
    expect(handoff.body.shipment.status).toBe("handed_over");
    expect(handoff.body.fullyShipped).toBe(true);
    const inv1 = await inventoryFor(h, ctx.varId, ctx.sellerA);
    expect(inv1.on_hand).toBe(inv0.on_hand - 3);
    expect(inv1.reserved).toBe(inv0.reserved - 3);
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("shipped");
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("shipped");

    // 8. buyer tracking over HTTP: real code, no internals
    const shipRow = await one(h.pool, `SELECT tracking_code, external_reference FROM shipment WHERE id = $1`, [shipmentId]);
    const buyerView = await api().get(`/api/v1/wholesale/orders/${order.id}/shipments`).set("Cookie", buyer).expect(200);
    expect(buyerView.body.shipments[0].trackingCode).toBe(shipRow.tracking_code);
    expect(JSON.stringify(buyerView.body)).not.toContain(shipRow.external_reference);
    expect(JSON.stringify(buyerView.body)).not.toContain("***present***");

    // 9. carrier events: in_transit then delivered through the public webhook
    h.fakeShipping.setCarrierState(shipRow.external_reference, "in_transit");
    const t1 = await api().post(`/api/v1/shipping/providers/fake/webhook`).set(signedFakeShippingHeaders()).send({ externalReference: shipRow.external_reference, state: "in_transit", eventId: "ev-d1-" + shipmentId }).expect(200);
    expect(t1.body.status).toBe("processed");
    h.fakeShipping.setCarrierState(shipRow.external_reference, "delivered");
    const t2 = await api().post(`/api/v1/shipping/providers/fake/webhook`).set(signedFakeShippingHeaders()).send({ externalReference: shipRow.external_reference, state: "delivered", eventId: "ev-d2-" + shipmentId }).expect(200);
    expect(t2.body.status).toBe("processed");
    expect((await one(h.pool, `SELECT status FROM shipment WHERE id = $1`, [shipmentId])).status).toBe("delivered");
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("delivered");
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("completed");
    expect(await inventoryFor(h, ctx.varId, ctx.sellerA)).toEqual(inv1); // C7

    // ── cross-domain invariants ────────────────────────────────────────
    const verified = await one(h.pool, `SELECT COALESCE(SUM(amount),0)::text AS s FROM payment WHERE wholesale_order_id = $1 AND status = 'verified'`, [order.id]);
    const allocated = await one(h.pool, `SELECT COALESCE(SUM(pa.amount),0)::text AS s FROM payment_allocation pa JOIN payment p ON p.id = pa.payment_id WHERE p.wholesale_order_id = $1`, [order.id]);
    const ledgerIn = await one(h.pool, `SELECT COALESCE(SUM(amount),0)::text AS s FROM financial_ledger_entry WHERE order_id = $1 AND direction = 'IN'`, [order.id]);
    expect(verified.s).toBe((3_000_000n + fee).toString());
    expect(allocated.s).toBe(verified.s);
    expect(ledgerIn.s).toBe(verified.s);
    const active = await q(h.pool, `SELECT id, total_amount FROM wholesale_proforma WHERE wholesale_order_id = $1 AND status = 'issued'`, [order.id]);
    expect(active).toHaveLength(1);
    expect(String(active[0].total_amount)).toBe((3_000_000n + fee).toString());
    const superseded = await q(h.pool, `SELECT total_amount FROM wholesale_proforma WHERE wholesale_order_id = $1 AND status = 'superseded'`, [order.id]);
    expect(superseded).toHaveLength(1);
    expect(String(superseded[0].total_amount)).toBe("3000000"); // historical amount preserved (D2)
    const finalSummary = await h.paymentsService.getOrderFinancialSummary(order.id);
    expect(finalSummary.currentPayable).toBe("0");
    expect(finalSummary.unallocatedPaid).toBe("0");
    expect(finalSummary.refundObligation).toBe("0");
    const parent = await one(h.pool, `SELECT shipping_total, grand_total, items_total FROM wholesale_order WHERE id = $1`, [order.id]);
    expect(String(parent.shipping_total)).toBe(fee.toString());
    expect(BigInt(parent.grand_total)).toBe(BigInt(parent.items_total) + fee);
    // no swallowed order events: the whole story is in order_event, in order
    const childEvents = (await q(h.pool, `SELECT event_type FROM order_event WHERE aggregate_id = $1 ORDER BY created_at, id`, [childA.id])).map((r) => r.event_type);
    for (const t of ["shipping.quote_created", "shipping.quote_selected", "shipping.shipment_created", "shipping.shipment_ready", "shipping.shipment_handed_over", "child.shipped", "shipping.shipment_in_transit", "shipping.shipment_delivered", "child.delivered"]) {
      expect(childEvents).toContain(t);
    }
    expect(childEvents.indexOf("shipping.shipment_created")).toBeLessThan(childEvents.indexOf("shipping.shipment_ready"));
    expect(childEvents.indexOf("shipping.shipment_handed_over")).toBeLessThan(childEvents.indexOf("shipping.shipment_delivered"));
    const parentEvents = (await q(h.pool, `SELECT event_type FROM order_event WHERE aggregate_id = $1 ORDER BY created_at, id`, [order.id])).map((r) => r.event_type);
    expect(parentEvents).toContain("payment.verified");
    expect(parentEvents).toContain("order.processing_started");
    expect(parentEvents).toContain("order.completed");
    // idempotency identities are deterministic — no wall-clock keys anywhere in this order's commands
    const keys = await q(h.pool, `SELECT idempotency_key FROM command_idempotency WHERE scope_id IN ($1, $2, $3)`, [order.id, childA.id, shipmentId]);
    for (const k of keys) expect(k.idempotency_key).not.toMatch(/\d{13}/);
    // events carry no PII/secrets
    const allPayloads = await q(h.pool, `SELECT payload::text AS p FROM order_event WHERE aggregate_id IN ($1, $2)`, [order.id, childA.id]);
    for (const p of allPayloads) {
      expect(p.p).not.toContain("Valiasr");
      expect(p.p).not.toContain(shipRow.external_reference);
      expect(p.p).not.toContain(payRow.provider_reference);
    }
    const shipmentEvents = await q(h.pool, `SELECT safe_metadata::text AS m FROM shipment_event WHERE shipment_id = $1`, [shipmentId]);
    for (const e of shipmentEvents) expect(e.m).not.toMatch(/signature|secret|cookie/i);
  });

  it("B12 over HTTP — shipping mutations without Idempotency-Key are 400 IDEMPOTENCY_KEY_REQUIRED before any side effect", async () => {
    const supplier = cookie(ctx.userAOwner, "supplier");
    const admin = cookie(ctx.userAdmin, "admin");
    const before = await count(h.pool, `SELECT 1 FROM command_idempotency WHERE command_type LIKE 'shipping.%'`);
    for (const [method, url, who] of [
      ["post", "/api/v1/supplier/shipments/quote", supplier],
      ["post", "/api/v1/supplier/shipments", supplier],
      ["post", "/api/v1/supplier/shipments/shp_x/handoff", supplier],
      ["post", "/api/v1/supplier/shipments/shp_x/cancel", supplier],
      ["post", "/api/v1/admin/shipping/quotes/sq_x/select", admin],
      ["post", "/api/v1/admin/shipping/shipments/shp_x/delivered", admin],
      ["post", "/api/v1/admin/shipping/shipments/shp_x/cancel", admin],
    ] as const) {
      const res = await (api() as any)[method](url).set("Cookie", who).send({ childOrderId: "po_x", items: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("IDEMPOTENCY_KEY_REQUIRED");
    }
    expect(await count(h.pool, `SELECT 1 FROM command_idempotency WHERE command_type LIKE 'shipping.%'`)).toBe(before);
  });
});

describe("Phase 4.7.1 — D: scope guards (supplementary static checks)", () => {
  const modules = ["payments", "finance", "shipping", "inventory", "orders"];
  const sources = () =>
    modules.flatMap((m) => {
      const dir = path.join(ROOT, "apps/api/src/modules", m);
      const walk = (d: string): string[] => fs.readdirSync(d).flatMap((f) => (fs.statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
      return walk(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
    });
  const codeLines = (file: string) =>
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));

  it("D7 — no wallet / settlement / payout / IBAN logic entered with 4.7.1", () => {
    for (const file of sources()) {
      const joined = codeLines(file).join("\n");
      expect(joined, file).not.toMatch(/\bwallet\b|\bpayout\b|\bsettlement\b|\biban\b|\bsheba\b/i);
    }
  });

  it("D8 — no legal/KYC/tax-invoice scope entered with 4.7.1", () => {
    for (const file of sources()) {
      const joined = codeLines(file).join("\n");
      expect(joined, file).not.toMatch(/\bKYC\b|eNAMAD|Samaneh|Modian|\bAML\b|tax_invoice|taxInvoice/i);
    }
  });

  it("A10/B — no speculative real-carrier or real-gateway integration (no external HTTP calls from provider adapters)", () => {
    for (const dir of ["apps/api/src/modules/payments/providers", "apps/api/src/modules/shipping/providers"]) {
      for (const f of fs.readdirSync(path.join(ROOT, dir))) {
        const src = fs.readFileSync(path.join(ROOT, dir, f), "utf8");
        expect(src, f).not.toMatch(/\bfetch\(|axios|https?:\/\/(api|sandbox)\./);
      }
    }
  });

  it("migration hygiene — 0021 is forward-only, 0020 untouched in the journal, snapshot chained", () => {
    const journal = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/database/migrations/meta/_journal.json"), "utf8"));
    const entries = journal.entries as Array<{ idx: number; tag: string }>;
    expect(entries.at(-1)?.idx).toBe(21);
    expect(entries.at(-1)?.tag).toBe("0021_phase_4_7_1_provider_shipping_hardening");
    expect(entries.find((e) => e.idx === 20)?.tag).toMatch(/^0020_/);
    const sql = fs.readFileSync(path.join(ROOT, "packages/database/migrations/0021_phase_4_7_1_provider_shipping_hardening.sql"), "utf8");
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN/i);
    expect(sql).toMatch(/payment_provider_reference_unique/);
    expect(sql).toMatch(/consumed_quantity/);
    const snap21 = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/database/migrations/meta/0021_snapshot.json"), "utf8"));
    const snap20 = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/database/migrations/meta/0020_snapshot.json"), "utf8"));
    expect(snap21.prevId).toBe(snap20.id);
  });
});
