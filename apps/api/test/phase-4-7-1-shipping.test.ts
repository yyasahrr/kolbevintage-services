/**
 * Phase 4.7.1 — Stage B: shipping correctness (real PostgreSQL, real Nest app, fake carrier).
 *
 * Assertions inspect DB state: shipping_quote, shipment, shipment_item, shipment_event,
 * command_idempotency, purchase_order, wholesale_order, order_event, wholesale_proforma,
 * inventory_reservation, product_variant_inventory. Provider call counters are only a
 * secondary signal.
 */
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ROOT,
  adminActor,
  bootHarness,
  count,
  createOrder,
  createReadyShipment,
  confirmToAwaitingPayment,
  expectDomainError,
  inventoryFor,
  makeId,
  one,
  orderItemsForChild,
  paidOrder,
  preparingOrder,
  q,
  reservationsFor,
  signedFakeShippingHeaders,
  supplierA,
  supplierB,
  toPreparing,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_4_7_1_shipping_test";

let h: Harness;
let ctx: SupplierContext;

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedCtx();
}, 180_000);

afterAll(async () => {
  await h?.close();
});

async function seedCtx() {
  const { seedTwoSuppliers } = await import("./helpers/phase-4-7-1.harness");
  return seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 100 });
}

async function shipmentRow(id: string) {
  return one(h.pool, `SELECT * FROM shipment WHERE id = $1`, [id]);
}

async function orderEventTypes(aggregateId: string) {
  const rows = await q(h.pool, `SELECT event_type FROM order_event WHERE aggregate_id = $1 ORDER BY created_at, id`, [aggregateId]);
  return rows.map((r) => r.event_type);
}

async function webhook(body: Record<string, unknown>, signed = true) {
  return h.shippingOrchestrator.ingestWebhook({ provider: "fake", request: { headers: signed ? signedFakeShippingHeaders() : {}, body } });
}

describe("Phase 4.7.1 — B: shipping quotes", () => {
  it("B12 — every shipping mutation requires Idempotency-Key ⇒ 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 2 });
    const items = await orderItemsForChild(h, childA.id);
    for (const attempt of [
      () => h.shippingOrchestrator.createQuote({ actor: supplierA(ctx), childOrderId: childA.id, idempotencyKey: undefined }),
      () => h.shippingOrchestrator.createShipment({ actor: supplierA(ctx), childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 1 }], idempotencyKey: "   " }),
      () => h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: "shp_none", idempotencyKey: undefined }),
      () => h.shippingOrchestrator.cancelShipment({ actor: supplierA(ctx), shipmentId: "shp_none", idempotencyKey: undefined }),
      () => h.shippingOrchestrator.selectQuote({ actor: adminActor(ctx), quoteId: "sq_none", idempotencyKey: undefined }),
      () => h.shippingOrchestrator.markDelivered({ actor: adminActor(ctx), shipmentId: "shp_none", idempotencyKey: undefined }),
    ]) {
      const err = await expectDomainError(attempt());
      expect(err.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
      expect(err.status ?? err.statusCode).toBe(400);
    }
    expect(await count(h.pool, `SELECT 1 FROM shipment WHERE child_order_id = $1`, [childA.id])).toBe(0);
    expect(await count(h.pool, `SELECT 1 FROM shipping_quote WHERE child_order_id = $1`, [childA.id])).toBe(0);
  });

  it("B1/B2 — quote = TxA → provider → TxB; replay with the same key returns the same immutable quote (one row, one event, one provider call)", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 2 });
    const key = makeId("idem_quote");
    const first = await h.shippingOrchestrator.createQuote({ actor: supplierA(ctx), childOrderId: childA.id, idempotencyKey: key, providerName: "fake" });
    expect(first.replayed).toBe(false);
    expect(first.quote.status).toBe("active");
    const second = await h.shippingOrchestrator.createQuote({ actor: supplierA(ctx), childOrderId: childA.id, idempotencyKey: key, providerName: "fake" });
    expect(second.replayed).toBe(true);
    expect(second.quote.id).toBe(first.quote.id);
    expect(await count(h.pool, `SELECT 1 FROM shipping_quote WHERE child_order_id = $1`, [childA.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_event WHERE aggregate_id = $1 AND event_type = 'shipping.quote_created'`, [childA.id])).toBe(1);
    const cmd = await one(h.pool, `SELECT state, result_resource_id FROM command_idempotency WHERE scope_id = $1 AND command_type = 'shipping.quote_create' AND idempotency_key = $2`, [childA.id, key]);
    expect(cmd.state).toBe("completed");
    expect(cmd.result_resource_id).toBe(first.quote.id);
    expect(h.fakeShipping.quoteCallsFor(`quote:${childA.id}:${key}`)).toBe(1);
  });

  it("B2 — provider outage during quoting ⇒ no quote row, command retryable; the retry with the same key succeeds with a single row", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 2 });
    const key = makeId("idem_quote_fail");
    h.fakeShipping.failNextQuote(1);
    const err = await expectDomainError(h.shippingOrchestrator.createQuote({ actor: supplierA(ctx), childOrderId: childA.id, idempotencyKey: key, providerName: "fake" }));
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(await count(h.pool, `SELECT 1 FROM shipping_quote WHERE child_order_id = $1`, [childA.id])).toBe(0);
    const cmd = await one(h.pool, `SELECT state FROM command_idempotency WHERE scope_id = $1 AND command_type = 'shipping.quote_create' AND idempotency_key = $2`, [childA.id, key]);
    expect(cmd.state).toBe("failed");
    const retry = await h.shippingOrchestrator.createQuote({ actor: supplierA(ctx), childOrderId: childA.id, idempotencyKey: key, providerName: "fake" });
    expect(retry.replayed).toBe(false);
    expect(await count(h.pool, `SELECT 1 FROM shipping_quote WHERE child_order_id = $1`, [childA.id])).toBe(1);
  });

  it("D1/D2/D3 — shipping_total 0 = NOT QUOTED; selecting a quote supersedes the issued proforma by the explicit delta, allocations stay immutable; replacement is delta-only", async () => {
    const { order, childA } = await preparingOrder(h, ctx, { qtyA: 2 });
    const before = await one(h.pool, `SELECT shipping_total, grand_total, items_total FROM wholesale_order WHERE id = $1`, [order.id]);
    expect(String(before.shipping_total)).toBe("0");
    expect(String(before.grand_total)).toBe(String(before.items_total));
    h.fakeShipping.setNextQuoteAmount(0n);
    const zero = await h.shippingOrchestrator.createQuote({ actor: supplierA(ctx), childOrderId: childA.id, idempotencyKey: makeId("q0"), providerName: "fake", serviceLevel: "pickup" });
    expect(zero.notQuoted).toBe(true);
    const zeroSel = await h.shippingOrchestrator.selectQuote({ actor: adminActor(ctx), quoteId: zero.quote.id, idempotencyKey: makeId("sel0") });
    expect(zeroSel.fee.superseded).toBe(false);
    expect(zeroSel.fee.reason).toBe("not_quoted");

    const issuedBefore = await one(h.pool, `SELECT id, total_amount FROM wholesale_proforma WHERE child_order_id = $1 AND status = 'issued'`, [childA.id]);
    const allocBefore = await q(h.pool, `SELECT id, proforma_id, amount FROM payment_allocation WHERE proforma_id = $1 ORDER BY id`, [issuedBefore.id]);
    expect(allocBefore.length).toBeGreaterThan(0);

    const quoted = await h.shippingOrchestrator.createQuote({ actor: supplierA(ctx), childOrderId: childA.id, idempotencyKey: makeId("q1"), providerName: "fake", serviceLevel: "standard" });
    expect(quoted.notQuoted).toBe(false);
    const sel = await h.shippingOrchestrator.selectQuote({ actor: adminActor(ctx), quoteId: quoted.quote.id, idempotencyKey: makeId("sel1") });
    expect(sel.fee.superseded).toBe(true);
    expect(sel.fee.shippingDelta).toBe(quoted.quote.amount.toString());
    expect(sel.fee.currentPayable).toBe(quoted.quote.amount.toString());

    const issuedAfter = await one(h.pool, `SELECT id, total_amount, shipping_total FROM wholesale_proforma WHERE child_order_id = $1 AND status = 'issued'`, [childA.id]);
    expect(issuedAfter.id).not.toBe(issuedBefore.id);
    expect(BigInt(issuedAfter.total_amount)).toBe(BigInt(issuedBefore.total_amount) + quoted.quote.amount);
    expect(String(issuedAfter.shipping_total)).toBe(quoted.quote.amount.toString());
    const old = await one(h.pool, `SELECT status, total_amount, superseded_by FROM wholesale_proforma WHERE id = $1`, [issuedBefore.id]);
    expect(old.status).toBe("superseded");
    expect(String(old.total_amount)).toBe(String(issuedBefore.total_amount));
    expect(old.superseded_by).toBe(issuedAfter.id);
    const allocAfter = await q(h.pool, `SELECT id, proforma_id, amount FROM payment_allocation WHERE proforma_id = $1 ORDER BY id`, [issuedBefore.id]);
    expect(allocAfter).toEqual(allocBefore);
    const parentAfter = await one(h.pool, `SELECT status, shipping_total, grand_total, items_total FROM wholesale_order WHERE id = $1`, [order.id]);
    expect(String(parentAfter.shipping_total)).toBe(quoted.quote.amount.toString());
    expect(BigInt(parentAfter.grand_total)).toBe(BigInt(parentAfter.items_total) + quoted.quote.amount);
    expect(parentAfter.status).toBe("processing");
    const childAfter = await one(h.pool, `SELECT items_total, grand_total FROM purchase_order WHERE id = $1`, [childA.id]);
    expect(BigInt(childAfter.grand_total)).toBe(BigInt(childAfter.items_total) + quoted.quote.amount);
    expect(await orderEventTypes(childA.id)).toContain("shipping.quote_selected");
    expect((await one(h.pool, `SELECT status FROM shipping_quote WHERE id = $1`, [quoted.quote.id])).status).toBe("selected");

    // D3 — replacement: explicit delta relative to the previously selected quote.
    h.fakeShipping.setNextQuoteAmount(quoted.quote.amount + 50_000n);
    const replacement = await h.shippingOrchestrator.createQuote({ actor: supplierA(ctx), childOrderId: childA.id, idempotencyKey: makeId("q2"), providerName: "fake", serviceLevel: "express" });
    const sel2 = await h.shippingOrchestrator.selectQuote({ actor: adminActor(ctx), quoteId: replacement.quote.id, idempotencyKey: makeId("sel2") });
    expect(sel2.fee.superseded).toBe(true);
    expect(sel2.fee.shippingDelta).toBe("50000");
    expect((await one(h.pool, `SELECT status FROM shipping_quote WHERE id = $1`, [quoted.quote.id])).status).toBe("voided");
    expect((await one(h.pool, `SELECT status FROM shipping_quote WHERE id = $1`, [replacement.quote.id])).status).toBe("selected");
    const ev = await one(h.pool, `SELECT payload FROM order_event WHERE aggregate_id = $1 AND event_type = 'shipping.quote_selected' ORDER BY created_at DESC, id DESC LIMIT 1`, [childA.id]);
    expect(ev.payload.previousShippingAmount).toBe(quoted.quote.amount.toString());
    expect(ev.payload.shippingDelta).toBe("50000");
    // absolute projection: replacement is not accumulated
    const parentFinal = await one(h.pool, `SELECT shipping_total FROM wholesale_order WHERE id = $1`, [order.id]);
    expect(String(parentFinal.shipping_total)).toBe((quoted.quote.amount + 50_000n).toString());
    // Exactly one active (issued) proforma; each superseded one keeps its original grand_total.
    expect(await count(h.pool, `SELECT 1 FROM wholesale_proforma WHERE child_order_id = $1 AND status = 'issued'`, [childA.id])).toBe(1);
  });

  it("dup quote selection — the same quote selected twice with different keys ⇒ second is 409 QUOTE_ALREADY_SELECTED, one supersede", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 1 });
    const quoted = await h.shippingOrchestrator.createQuote({ actor: supplierA(ctx), childOrderId: childA.id, idempotencyKey: makeId("q"), providerName: "fake" });
    await h.shippingOrchestrator.selectQuote({ actor: adminActor(ctx), quoteId: quoted.quote.id, idempotencyKey: makeId("sel") });
    const err = await expectDomainError(h.shippingOrchestrator.selectQuote({ actor: adminActor(ctx), quoteId: quoted.quote.id, idempotencyKey: makeId("sel") }));
    expect(err.code).toBe("QUOTE_ALREADY_SELECTED");
    expect(await count(h.pool, `SELECT 1 FROM wholesale_proforma WHERE child_order_id = $1 AND status = 'superseded'`, [childA.id])).toBe(1);
  });
});

describe("Phase 4.7.1 — B: shipment creation", () => {
  it("B6 — resource-based supplier authorization: other supplier ⇒ 403 SHIPMENT_ACCESS_DENIED; no membership ⇒ 403 SUPPLIER_MEMBERSHIP_REQUIRED; finance member ⇒ 403 ROLE_NOT_ALLOWED", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 2 });
    const items = await orderItemsForChild(h, childA.id);
    const line = [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 1 }];
    const other = await expectDomainError(createReadyShipment(h, ctx, { childOrderId: childA.id, items: line, actor: supplierB(ctx) }));
    expect(other.code).toBe("SHIPMENT_ACCESS_DENIED");
    expect(other.status ?? other.statusCode).toBe(403);
    const nobody = await expectDomainError(createReadyShipment(h, ctx, { childOrderId: childA.id, items: line, actor: { userId: ctx.userBuyer, role: "supplier" } }));
    expect(nobody.code).toBe("SUPPLIER_MEMBERSHIP_REQUIRED");
    const finance = await expectDomainError(createReadyShipment(h, ctx, { childOrderId: childA.id, items: line, actor: { userId: ctx.userAFinance, role: "supplier" } }));
    expect(finance.code).toBe("ROLE_NOT_ALLOWED");
    expect(await count(h.pool, `SELECT 1 FROM shipment WHERE child_order_id = $1`, [childA.id])).toBe(0);
  });

  it("B7/B8/B9 — client claims are verified against server truth: order mismatch ⇒ 409, address ⇒ 400, responsibility ⇒ 409", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 2 });
    const items = await orderItemsForChild(h, childA.id);
    const base = { actor: supplierA(ctx), childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 1 }], providerName: "fake" };
    const mismatch = await expectDomainError(h.shippingOrchestrator.createShipment({ ...base, idempotencyKey: makeId("k"), claimedWholesaleOrderId: "wo_other" }));
    expect(mismatch.code).toBe("SHIPMENT_ORDER_MISMATCH");
    expect(mismatch.status ?? mismatch.statusCode).toBe(409);
    const address = await expectDomainError(h.shippingOrchestrator.createShipment({ ...base, idempotencyKey: makeId("k"), claimedAddressSnapshot: { city: "Elsewhere" } }));
    expect(address.code).toBe("SHIPMENT_ADDRESS_NOT_ALLOWED");
    expect(address.status ?? address.statusCode).toBe(400);
    const resp = await expectDomainError(h.shippingOrchestrator.createShipment({ ...base, idempotencyKey: makeId("k"), claimedShippingResponsibility: "KOLBE" }));
    expect(resp.code).toBe("SHIPMENT_RESPONSIBILITY_MISMATCH");
    expect(await count(h.pool, `SELECT 1 FROM shipment WHERE child_order_id = $1`, [childA.id])).toBe(0);

    const ok = await h.shippingOrchestrator.createShipment({ ...base, idempotencyKey: makeId("k") });
    const row = await shipmentRow(ok.shipment.id);
    const parent = await one(h.pool, `SELECT shipping_address_snapshot FROM wholesale_order WHERE id = $1`, [row.wholesale_order_id]);
    expect(row.address_snapshot).toEqual(parent.shipping_address_snapshot);
    expect(row.shipping_responsibility).toBe("SUPPLIER");
  });

  it("B10 — financial gate: an unpaid (awaiting_payment) order can never ship ⇒ 409 FINANCIAL_GATE_BLOCKED", async () => {
    const { order, childA } = await createOrder(h, ctx, { qtyA: 2 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const items = await orderItemsForChild(h, childA.id);
    const err = await expectDomainError(createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 1 }] }));
    expect(err.code).toBe("FINANCIAL_GATE_BLOCKED");
    expect(err.status ?? err.statusCode).toBe(409);
    expect(await count(h.pool, `SELECT 1 FROM shipment WHERE child_order_id = $1`, [childA.id])).toBe(0);
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("awaiting_payment");
  });

  it("B10 — paid but not yet in preparation ⇒ 409 CHILD_ORDER_NOT_SHIPPABLE", async () => {
    const { childA } = await paidOrder(h, ctx, { qtyA: 2 });
    const items = await orderItemsForChild(h, childA.id);
    const err = await expectDomainError(createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 1 }] }));
    expect(err.code).toBe("CHILD_ORDER_NOT_SHIPPABLE");
  });

  it("B11 — SUM(active shipment allocations) ≤ ordered: 3 + 2 of 5 ok, one more ⇒ 409 SHIPMENT_QUANTITY_EXCEEDED; unknown item ⇒ 400", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 5 });
    const items = await orderItemsForChild(h, childA.id);
    const itemId = items[0].id;
    await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: itemId, pieceQuantity: 3 }] });
    await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: itemId, pieceQuantity: 2 }] });
    const over = await expectDomainError(createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: itemId, pieceQuantity: 1 }] }));
    expect(over.code).toBe("SHIPMENT_QUANTITY_EXCEEDED");
    expect(over.status ?? over.statusCode).toBe(409);
    const alien = await expectDomainError(createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: "woi_alien", pieceQuantity: 1 }] }));
    expect(alien.code).toBe("SHIPMENT_ITEM_NOT_IN_ORDER");
    const sum = await one(h.pool, `SELECT COALESCE(SUM(si.piece_quantity),0)::int AS total FROM shipment_item si JOIN shipment s ON s.id = si.shipment_id WHERE s.child_order_id = $1 AND s.status NOT IN ('cancelled','failed')`, [childA.id]);
    expect(sum.total).toBe(5);
  });

  it("B1/B2/B15 — shipment = TxA (pending, command attached) → provider → TxB (ready); order events written in-tx; replay returns the same shipment; one external shipment", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 2 });
    const items = await orderItemsForChild(h, childA.id);
    const key = makeId("idem_shp");
    const first = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }], idempotencyKey: key });
    expect(first.replayed).toBe(false);
    const row = await shipmentRow(first.shipment.id);
    expect(row.status).toBe("ready");
    expect(row.external_reference).toBeTruthy();
    expect(row.tracking_code).toBeTruthy();
    const second = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }], idempotencyKey: key });
    expect(second.replayed).toBe(true);
    expect(second.shipment.id).toBe(first.shipment.id);
    expect(await count(h.pool, `SELECT 1 FROM shipment WHERE child_order_id = $1`, [childA.id])).toBe(1);
    expect(h.fakeShipping.createCallsFor(first.shipment.id)).toBe(1);
    const types = await orderEventTypes(childA.id);
    expect(types.filter((t) => t === "shipping.shipment_created")).toHaveLength(1);
    expect(types.filter((t) => t === "shipping.shipment_ready")).toHaveLength(1);
    const cmd = await one(h.pool, `SELECT state, result_resource_id FROM command_idempotency WHERE scope_id = $1 AND command_type = 'shipping.shipment_create' AND idempotency_key = $2`, [childA.id, key]);
    expect(cmd.state).toBe("completed");
    expect(cmd.result_resource_id).toBe(first.shipment.id);
    // No PII in order events.
    const payloads = await q(h.pool, `SELECT payload::text AS p FROM order_event WHERE aggregate_id = $1`, [childA.id]);
    for (const p of payloads) {
      expect(p.p).not.toContain("Valiasr");
      expect(p.p).not.toContain("address");
    }
  });

  it("B2/B14/B18 — provider outage after TxA: shipment stays pending (no transition), no duplicate external shipment; retry with same key or reconciliation finishes it", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 4 });
    const items = await orderItemsForChild(h, childA.id);
    const key = makeId("idem_shp_fail");
    h.fakeShipping.failNextCreateShipment(1);
    const err = await expectDomainError(createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }], idempotencyKey: key }));
    expect(err.code).toBe("PROVIDER_ERROR");
    const pending = await one(h.pool, `SELECT * FROM shipment WHERE child_order_id = $1`, [childA.id]);
    expect(pending.status).toBe("pending");
    expect(pending.external_reference).toBeNull();
    const cmd = await one(h.pool, `SELECT state, result_resource_id FROM command_idempotency WHERE scope_id = $1 AND command_type = 'shipping.shipment_create' AND idempotency_key = $2`, [childA.id, key]);
    expect(cmd.state).toBe("failed");
    expect(cmd.result_resource_id).toBe(pending.id);

    // retry with the same key resumes the SAME shipment
    const retry = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }], idempotencyKey: key });
    expect(retry.shipment.id).toBe(pending.id);
    expect((await shipmentRow(pending.id)).status).toBe("ready");
    expect(await count(h.pool, `SELECT 1 FROM shipment WHERE child_order_id = $1`, [childA.id])).toBe(1);

    // reconciliation path: second shipment, provider dies, nobody retries — reconcile finalizes it
    const key2 = makeId("idem_shp_fail2");
    h.fakeShipping.failNextCreateShipment(1);
    await expectDomainError(createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }], idempotencyKey: key2 }));
    const externalBefore = h.fakeShipping.externalShipmentCount();
    const summary = await h.shippingOrchestrator.reconcile({ provider: "fake", pendingOlderThanSeconds: 0 });
    const finalized = summary.shipments.filter((s: any) => s.action === "finalized");
    expect(finalized.length).toBe(1);
    expect(h.fakeShipping.externalShipmentCount()).toBe(externalBefore + 1);
    const statuses = await q(h.pool, `SELECT status FROM shipment WHERE child_order_id = $1`, [childA.id]);
    expect(statuses.map((s) => s.status).sort()).toEqual(["ready", "ready"]);
  });

  it("manual provider — no external carrier: shipment ready without reference; handoff requires a tracking code (400 TRACKING_CODE_REQUIRED); manual has no webhook channel", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 1 });
    const items = await orderItemsForChild(h, childA.id);
    const created = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 1 }], provider: "manual" });
    expect(created.shipment.status).toBe("ready");
    expect(created.shipment.externalReference).toBeNull();
    const noCode = await expectDomainError(h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: created.shipment.id, idempotencyKey: makeId("h") }));
    expect(noCode.code).toBe("TRACKING_CODE_REQUIRED");
    const ok = await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: created.shipment.id, trackingCode: "POST-123456", idempotencyKey: makeId("h") });
    expect(ok.shipment.status).toBe("handed_over");
    const err = await expectDomainError(h.shippingOrchestrator.ingestWebhook({ provider: "manual", request: { headers: {}, body: {} } }));
    expect(err.code).toBe("PROVIDER_NOT_ALLOWED");
  });
});

describe("Phase 4.7.1 — B: shipment lifecycle", () => {
  it("B13 — state machine: pending/ready → cancelled; handoff of cancelled ⇒ 409; cancel after handoff ⇒ 409; deliver from ready ⇒ 409", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 4 });
    const items = await orderItemsForChild(h, childA.id);
    const s1 = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }] });
    const deliverEarly = await expectDomainError(h.shippingOrchestrator.markDelivered({ actor: adminActor(ctx), shipmentId: s1.shipment.id, idempotencyKey: makeId("d") }));
    expect(deliverEarly.code).toBe("INVALID_SHIPMENT_TRANSITION");
    expect(deliverEarly.status ?? deliverEarly.statusCode).toBe(409);
    const cancelled = await h.shippingOrchestrator.cancelShipment({ actor: supplierA(ctx), shipmentId: s1.shipment.id, reason: "repack", idempotencyKey: makeId("c") });
    expect(cancelled.shipment.status).toBe("cancelled");
    const handoffCancelled = await expectDomainError(h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s1.shipment.id, trackingCode: "X", idempotencyKey: makeId("h") }));
    expect(handoffCancelled.code).toBe("INVALID_SHIPMENT_TRANSITION");

    const s2 = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }] });
    await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s2.shipment.id, idempotencyKey: makeId("h") });
    const cancelAfter = await expectDomainError(h.shippingOrchestrator.cancelShipment({ actor: supplierA(ctx), shipmentId: s2.shipment.id, idempotencyKey: makeId("c") }));
    expect(cancelAfter.code).toBe("INVALID_SHIPMENT_TRANSITION");
    expect((await shipmentRow(s2.shipment.id)).status).toBe("handed_over");
    expect(await orderEventTypes(childA.id)).toContain("shipping.shipment_cancelled");
  });

  it("C4/C5/C6 — handoff consumes exactly this shipment's portion of the ORDER reservation, once; partial shipments keep the child preparing until the last handoff", async () => {
    const { order, childA } = await preparingOrder(h, ctx, { qtyA: 5 });
    const items = await orderItemsForChild(h, childA.id);
    const inv0 = await inventoryFor(h, ctx.varId, ctx.sellerA);
    const res0 = await reservationsFor(h, childA.id);
    expect(res0).toHaveLength(1);
    expect(res0[0].consumed_quantity).toBe(0);

    const s1 = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 3 }] });
    const key = makeId("idem_handoff");
    const h1 = await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s1.shipment.id, idempotencyKey: key });
    expect(h1.replayed).toBe(false);
    expect(h1.fullyShipped).toBe(false);
    const inv1 = await inventoryFor(h, ctx.varId, ctx.sellerA);
    expect(inv1.on_hand).toBe(inv0.on_hand - 3);
    expect(inv1.reserved).toBe(inv0.reserved - 3);
    const res1 = await reservationsFor(h, childA.id);
    expect(res1[0].consumed_quantity).toBe(3);
    expect(res1[0].status).toBe("active");
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("preparing");
    // C1 — no second reservation was created for the shipment
    expect(await count(h.pool, `SELECT 1 FROM inventory_reservation WHERE order_id = $1`, [order.id])).toBe(1);
    // exactly-once: replay with the same key
    const replay = await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s1.shipment.id, idempotencyKey: key });
    expect(replay.replayed).toBe(true);
    expect((await inventoryFor(h, ctx.varId, ctx.sellerA)).on_hand).toBe(inv0.on_hand - 3);
    // a second operator with a different key ⇒ state machine refuses
    const again = await expectDomainError(h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s1.shipment.id, idempotencyKey: makeId("other") }));
    expect(again.code).toBe("INVALID_SHIPMENT_TRANSITION");
    expect(await count(h.pool, `SELECT 1 FROM inventory_ledger WHERE reason LIKE $1`, [`consume shipment ${s1.shipment.id} %`])).toBe(1);

    const s2 = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }] });
    const h2 = await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s2.shipment.id, idempotencyKey: makeId("idem_handoff") });
    expect(h2.fullyShipped).toBe(true);
    expect(h2.childTransitioned).toBe(true);
    const inv2 = await inventoryFor(h, ctx.varId, ctx.sellerA);
    expect(inv2.on_hand).toBe(inv0.on_hand - 5);
    expect(inv2.reserved).toBe(inv0.reserved - 5);
    const res2 = await reservationsFor(h, childA.id);
    expect(res2[0].consumed_quantity).toBe(5);
    expect(res2[0].status).toBe("confirmed");
    const child = await one(h.pool, `SELECT status, tracking_code FROM purchase_order WHERE id = $1`, [childA.id]);
    expect(child.status).toBe("shipped");
    expect(child.tracking_code).toBeTruthy();
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("shipped");
    const types = await orderEventTypes(childA.id);
    expect(types.filter((t) => t === "shipping.shipment_handed_over")).toHaveLength(2);
    expect(types).toContain("child.shipped");
  });

  it("C7/C8 — delivery is an inventory no-op; cancelling a ready shipment frees only its allocation and never touches the reservation", async () => {
    const { order, childA } = await preparingOrder(h, ctx, { qtyA: 3 });
    const items = await orderItemsForChild(h, childA.id);
    const inv0 = await inventoryFor(h, ctx.varId, ctx.sellerA);
    const s1 = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 3 }] });
    await h.shippingOrchestrator.cancelShipment({ actor: supplierA(ctx), shipmentId: s1.shipment.id, idempotencyKey: makeId("c") });
    const res = await reservationsFor(h, childA.id);
    expect(res[0].consumed_quantity).toBe(0);
    expect(res[0].status).toBe("active");
    expect(await inventoryFor(h, ctx.varId, ctx.sellerA)).toEqual(inv0);
    // allocation freed ⇒ full quantity can be shipped again
    const s2 = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 3 }] });
    await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s2.shipment.id, idempotencyKey: makeId("h") });
    const invAfterHandoff = await inventoryFor(h, ctx.varId, ctx.sellerA);
    const delivered = await h.shippingOrchestrator.markDelivered({ actor: adminActor(ctx), shipmentId: s2.shipment.id, idempotencyKey: makeId("d") });
    expect(delivered.fullyDelivered).toBe(true);
    expect(await inventoryFor(h, ctx.varId, ctx.sellerA)).toEqual(invAfterHandoff);
    expect(await count(h.pool, `SELECT 1 FROM inventory_ledger WHERE reason LIKE $1`, [`consume shipment ${s2.shipment.id} %`])).toBe(1);
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("delivered");
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("completed");
    expect(await orderEventTypes(childA.id)).toContain("shipping.shipment_delivered");
  });

  it("B19 — buyer sees the real tracking code and url, never placeholders, never address/provider internals", async () => {
    const { order, childA } = await preparingOrder(h, ctx, { qtyA: 1 });
    const items = await orderItemsForChild(h, childA.id);
    const s1 = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 1 }] });
    const row = await shipmentRow(s1.shipment.id);
    const view = await h.shippingOrchestrator.getBuyerShipments({ orderId: order.id, buyerUserId: ctx.userBuyer });
    expect(view.shipments).toHaveLength(1);
    expect(view.shipments[0].trackingCode).toBe(row.tracking_code);
    expect(view.shipments[0].trackingUrl).toBe(row.tracking_url);
    const text = JSON.stringify(view);
    expect(text).not.toContain("***present***");
    expect(text).not.toContain("addressSnapshot");
    expect(text).not.toContain("externalReference");
    expect(text).not.toContain("Valiasr");
    const stranger = await expectDomainError(h.shippingOrchestrator.getBuyerShipments({ orderId: order.id, buyerUserId: ctx.userBOwner }));
    expect(stranger).toBeTruthy();
  });
});

describe("Phase 4.7.1 — B: carrier events (webhook inbox + reconciliation)", () => {
  async function handedOverShipment(qty = 1) {
    const { order, childA } = await preparingOrder(h, ctx, { qtyA: qty });
    const items = await orderItemsForChild(h, childA.id);
    const s = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: qty }] });
    await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("h") });
    const row = await shipmentRow(s.shipment.id);
    return { order, childA, shipmentId: s.shipment.id, externalReference: row.external_reference as string, trackingCode: row.tracking_code as string };
  }

  it("B16/B17 — deterministic identity, atomic claim, provider-authoritative state; unsigned ⇒ 403 and nothing persisted; duplicates collapse", async () => {
    const { childA, shipmentId, externalReference } = await handedOverShipment();
    const unsigned = await expectDomainError(webhook({ externalReference, state: "delivered", eventId: "ev-unsigned-" + shipmentId }, false));
    expect(unsigned.code).toBe("WEBHOOK_SIGNATURE_INVALID");
    expect(unsigned.status ?? unsigned.statusCode).toBe(403);
    expect(await count(h.pool, `SELECT 1 FROM shipment_event WHERE external_event_id = $1`, ["ev-unsigned-" + shipmentId])).toBe(0);

    // The webhook CLAIMS in_transit but the carrier API says the parcel is only "created" ⇒ nothing moves, event ignored.
    const lying = await webhook({ externalReference, state: "in_transit", eventId: "ev-lie-" + shipmentId });
    expect(lying.outcome.status).toBe("ignored");
    expect((await shipmentRow(shipmentId)).status).toBe("handed_over");

    h.fakeShipping.setCarrierState(externalReference, "in_transit");
    const first = await webhook({ externalReference, state: "in_transit", eventId: "ev-1-" + shipmentId });
    expect(first.outcome.status).toBe("processed");
    expect((await shipmentRow(shipmentId)).status).toBe("in_transit");
    const dup = await webhook({ externalReference, state: "in_transit", eventId: "ev-1-" + shipmentId });
    expect(dup.duplicate).toBe(true);
    expect(await count(h.pool, `SELECT 1 FROM shipment_event WHERE external_event_id = $1`, ["ev-1-" + shipmentId])).toBe(1);
    const ev = await one(h.pool, `SELECT status, shipment_id, safe_metadata::text AS meta, processed_at FROM shipment_event WHERE external_event_id = $1`, ["ev-1-" + shipmentId]);
    expect(ev.status).toBe("processed");
    expect(ev.shipment_id).toBe(shipmentId);
    expect(ev.processed_at).toBeTruthy();
    expect(ev.meta).not.toContain("Valiasr");
    expect(await orderEventTypes(childA.id)).toContain("shipping.shipment_in_transit");

    // no eventId ⇒ fingerprint identity, still deduplicated
    h.fakeShipping.setCarrierState(externalReference, "delivered");
    const a = await webhook({ externalReference, state: "delivered" });
    const b = await webhook({ externalReference, state: "delivered" });
    expect(a.outcome.status).toBe("processed");
    expect(b.duplicate).toBe(true);
    expect((await shipmentRow(shipmentId)).status).toBe("delivered");
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("delivered");
    expect(await count(h.pool, `SELECT 1 FROM order_status_history WHERE child_order_id = $1 AND to_status = 'delivered'`, [childA.id])).toBe(1);
  });

  it("B17 — unknown reference ⇒ persisted as ignored (unmapped) with NULL shipment; provider outage ⇒ failed and re-driven by reconciliation", async () => {
    const unknown = await webhook({ externalReference: "ext_does_not_exist", state: "delivered", eventId: makeId("ev-unk") });
    expect(unknown.outcome.status).toBe("ignored");
    expect(unknown.outcome.reason).toBe("unmapped_reference");
    const row = await one(h.pool, `SELECT shipment_id, status FROM shipment_event WHERE id = $1`, [unknown.outcome.eventId]);
    expect(row.shipment_id).toBeNull();

    const { childA, shipmentId, externalReference } = await handedOverShipment();
    h.fakeShipping.setCarrierState(externalReference, "delivered");
    h.fakeShipping.failNextTracking(1);
    const failed = await webhook({ externalReference, state: "delivered", eventId: "ev-fail-" + shipmentId });
    expect(failed.outcome.status).toBe("failed");
    expect((await shipmentRow(shipmentId)).status).toBe("handed_over");
    const summary = await h.shippingOrchestrator.reconcile({ provider: "fake" });
    const redriven = summary.events.find((e: any) => e.eventId === failed.outcome.eventId);
    expect(redriven.status).toBe("processed");
    expect((await shipmentRow(shipmentId)).status).toBe("delivered");
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("delivered");
  });

  it("B18 — missed webhook: reconciliation pulls the carrier state of in-flight shipments (idempotent on rerun)", async () => {
    const { childA, shipmentId, externalReference } = await handedOverShipment();
    h.fakeShipping.setCarrierState(externalReference, "delivered");
    const s1 = await h.shippingOrchestrator.reconcile({ provider: "fake" });
    expect(s1.shipments.find((s: any) => s.shipmentId === shipmentId)?.status).toBe("processed");
    expect((await shipmentRow(shipmentId)).status).toBe("delivered");
    const s2 = await h.shippingOrchestrator.reconcile({ provider: "fake" });
    expect(s2.shipments.find((s: any) => s.shipmentId === shipmentId)).toBeUndefined();
    expect(await count(h.pool, `SELECT 1 FROM order_status_history WHERE child_order_id = $1 AND to_status = 'delivered'`, [childA.id])).toBe(1);
  });

  it("B14 — post-handoff carrier failure is an explicit recoverable exception (shipment failed + order event), never a silent success; inventory is not resurrected", async () => {
    const { childA, shipmentId, externalReference } = await handedOverShipment(2);
    const invBefore = await inventoryFor(h, ctx.varId, ctx.sellerA);
    h.fakeShipping.setCarrierState(externalReference, "failed");
    const res = await webhook({ externalReference, state: "failed", eventId: "ev-lost-" + shipmentId });
    expect(res.outcome.status).toBe("processed");
    const row = await shipmentRow(shipmentId);
    expect(row.status).toBe("failed");
    expect(row.failure_reason).toBe("carrier_failed");
    expect(await orderEventTypes(childA.id)).toContain("shipping.shipment_failed");
    expect(await inventoryFor(h, ctx.varId, ctx.sellerA)).toEqual(invBefore);
    const deliverFailed = await expectDomainError(h.shippingOrchestrator.markDelivered({ actor: adminActor(ctx), shipmentId, idempotencyKey: makeId("d") }));
    expect(deliverFailed.code).toBe("INVALID_SHIPMENT_TRANSITION");
  });

  it("HTTP — POST /api/v1/shipping/providers/:provider/webhook is public but adapter-authenticated; unknown provider ⇒ 404; supplier mutation without Idempotency-Key ⇒ 400", async () => {
    const { shipmentId, externalReference } = await handedOverShipment();
    const bad = await request(h.app.getHttpServer())
      .post(`/api/v1/shipping/providers/fake/webhook`)
      .set("x-fake-shipping-signature", "wrong")
      .send({ externalReference, state: "delivered", eventId: "ev-http-bad-" + shipmentId })
      .expect(403);
    expect(bad.body.error).toBe("WEBHOOK_SIGNATURE_INVALID");
    await request(h.app.getHttpServer()).post(`/api/v1/shipping/providers/nope/webhook`).send({}).expect(404);
    h.fakeShipping.setCarrierState(externalReference, "delivered");
    const good = await request(h.app.getHttpServer())
      .post(`/api/v1/shipping/providers/fake/webhook`)
      .set(signedFakeShippingHeaders())
      .send({ externalReference, state: "delivered", eventId: "ev-http-good-" + shipmentId })
      .expect(200);
    expect(good.body.status).toBe("processed");
    expect(JSON.stringify(good.body)).not.toContain(externalReference);
    expect((await shipmentRow(shipmentId)).status).toBe("delivered");

    const token = h.issueToken(ctx.userAOwner, "supplier");
    const noKey = await request(h.app.getHttpServer())
      .post(`/api/v1/supplier/shipments`)
      .set("Cookie", `kolbe_session=${token}`)
      .send({ childOrderId: "x", items: [] })
      .expect(400);
    expect(noKey.body.error).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
});

describe("Phase 4.7.1 — B: architecture guards (supplementary static checks)", () => {
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

  it("B4 — ShippingOrchestrator owns no tables; Finance no longer orchestrates shipments; no forwardRef between Finance and Shipping", () => {
    const orch = read("apps/api/src/modules/shipping/shipping.orchestrator.ts");
    expect(orch).not.toMatch(/\.insert\(|\.update\(|\.delete\(|INSERT INTO|UPDATE \w+ SET/);
    const finance = read("apps/api/src/modules/finance/wholesale-finance.orchestrator.ts");
    expect(finance).not.toMatch(/import[^;]*ShippingService/);
    expect(finance).not.toMatch(/shippingService\./);
    expect(finance).not.toMatch(/async createShipment|createShipmentWithInventory|selectShippingQuote/);
    expect(read("apps/api/src/modules/finance/finance.module.ts")).not.toContain("forwardRef");
    expect(read("apps/api/src/modules/shipping/shipping.module.ts")).not.toContain("forwardRef");
  });

  it("B5 — Shipping reads canonical order facts only through OrdersService contracts", () => {
    for (const file of ["apps/api/src/modules/shipping/shipping.service.ts", "apps/api/src/modules/shipping/shipping.orchestrator.ts"]) {
      const src = read(file);
      expect(src).not.toMatch(/FROM purchase_order\b/);
      expect(src).not.toMatch(/FROM wholesale_order_item\b/);
      expect(src).not.toMatch(/FROM wholesale_order\b/);
      expect(src).not.toMatch(/from\(purchaseOrder\)|from\(wholesaleOrderItem\)|from\(wholesaleOrder\)/);
    }
    expect(read("apps/api/src/modules/shipping/shipping.orchestrator.ts")).toContain("getChildOrderShippingContext");
  });

  it("B6/B19/A2 — no memberships[0], no tracking placeholders, no wall-clock identities in the shipping surface", () => {
    for (const file of fs.readdirSync(path.join(ROOT, "apps/api/src/modules/shipping")).filter((f) => f.endsWith(".ts"))) {
      const src = read(`apps/api/src/modules/shipping/${file}`);
      expect(src).not.toContain("memberships[0]");
      expect(src).not.toContain("***present***");
      expect(src).not.toMatch(/Date\.now\(\)/);
      expect(src).not.toMatch(/new Date\(\)/);
    }
  });

  it("A10 — the fake shipping provider is refused at the resolve boundary when NODE_ENV=production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => h.shippingRegistry.resolve("fake")).toThrowError(/prohibited in production/);
      try {
        h.shippingRegistry.resolve("fake");
      } catch (e: any) {
        expect(e.code).toBe("PROVIDER_NOT_ALLOWED");
        expect(e.status ?? e.statusCode).toBe(403);
      }
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
