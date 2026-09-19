/**
 * Phase 4.7.1 — Stage C: inventory exactness + the 12 mandatory real-PostgreSQL
 * concurrency races. Every race is executed with true parallel transactions
 * (Promise.all against the real Nest services / pg pool) and judged by DB state.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminActor,
  bootHarness,
  confirmToAwaitingPayment,
  count,
  createFakeIntent,
  createOrder,
  createReadyShipment,
  fakeWebhookBody,
  inventoryFor,
  makeId,
  one,
  orderItemsForChild,
  preparingOrder,
  q,
  reservationsFor,
  seedTwoSuppliers,
  signedFakeHeaders,
  signedFakeShippingHeaders,
  supplierA,
  supplierB,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_4_7_1_concurrency_test";

let h: Harness;
let ctx: SupplierContext;

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 500 });
}, 180_000);

afterAll(async () => {
  await h?.close();
});

/** Runs all thunks truly concurrently; returns settled results (never throws). */
async function race<T>(thunks: Array<() => Promise<T>>) {
  const settled = await Promise.allSettled(thunks.map((t) => t()));
  return {
    ok: settled.filter((s): s is PromiseFulfilledResult<T> => s.status === "fulfilled").map((s) => s.value),
    failed: settled.filter((s): s is PromiseRejectedResult => s.status === "rejected").map((s) => s.reason),
  };
}

async function shipmentRow(id: string) {
  return one(h.pool, `SELECT * FROM shipment WHERE id = $1`, [id]);
}

async function handedOverShipment(opts: { qty?: number; which?: "A" | "B" } = {}) {
  const qty = opts.qty ?? 1;
  const { order, childA } = await preparingOrder(h, ctx, { qtyA: qty });
  const items = await orderItemsForChild(h, childA.id);
  const s = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: qty }] });
  await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("h") });
  const row = await shipmentRow(s.shipment.id);
  return { order, childA, shipmentId: s.shipment.id, externalReference: row.external_reference as string };
}

const shippingWebhook = (body: Record<string, unknown>) =>
  h.shippingOrchestrator.ingestWebhook({ provider: "fake", request: { headers: signedFakeShippingHeaders(), body } });
const paymentWebhook = (body: Record<string, unknown>) =>
  h.paymentProviderOrchestrator.ingestWebhook({ provider: "fake", request: { headers: signedFakeHeaders(), body } });

describe("Phase 4.7.1 — C: inventory exactness", () => {
  it("C2 — exact reservation identity: shipping order #1 never touches the same seller/variant reservation of order #2", async () => {
    const o1 = await preparingOrder(h, ctx, { qtyA: 2 });
    const o2 = await preparingOrder(h, ctx, { qtyA: 3 });
    const items = await orderItemsForChild(h, o1.childA.id);
    const s = await createReadyShipment(h, ctx, { childOrderId: o1.childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }] });
    await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("h") });
    const r1 = await reservationsFor(h, o1.childA.id);
    const r2 = await reservationsFor(h, o2.childA.id);
    expect(r1[0].consumed_quantity).toBe(2);
    expect(r1[0].status).toBe("confirmed");
    expect(r2[0].consumed_quantity).toBe(0);
    expect(r2[0].status).toBe("active");
  });

  it("C3/C4 — no clamping: a reservation that cannot back the handoff throws RESERVATION_INSUFFICIENT and the WHOLE handoff rolls back (shipment stays ready, no ledger, no order event)", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 4 });
    const items = await orderItemsForChild(h, childA.id);
    const s = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 4 }] });
    // simulate drift: 3 of 4 already consumed by something else
    await h.pool.query(`UPDATE inventory_reservation SET consumed_quantity = 3 WHERE child_order_id = $1`, [childA.id]);
    const inv0 = await inventoryFor(h, ctx.varId, ctx.sellerA);
    let err: any = null;
    try {
      await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("h") });
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("RESERVATION_INSUFFICIENT");
    expect((await shipmentRow(s.shipment.id)).status).toBe("ready");
    expect(await inventoryFor(h, ctx.varId, ctx.sellerA)).toEqual(inv0);
    expect(await count(h.pool, `SELECT 1 FROM inventory_ledger WHERE reason LIKE $1`, [`consume shipment ${s.shipment.id} %`])).toBe(0);
    expect(await count(h.pool, `SELECT 1 FROM order_event WHERE aggregate_id = $1 AND event_type = 'shipping.shipment_handed_over'`, [childA.id])).toBe(0);
    expect(await count(h.pool, `SELECT 1 FROM command_idempotency WHERE scope_id = $1 AND command_type = 'shipping.shipment_handoff' AND state = 'completed'`, [s.shipment.id])).toBe(0);
    expect((await one(h.pool, `SELECT consumed_quantity FROM inventory_reservation WHERE child_order_id = $1`, [childA.id])).consumed_quantity).toBe(3);
  });

  it("C6 — legacy child dispatch after a partial shipment consumes only the remainder (5 = 3 via shipment + 2 via dispatch), never twice", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 5 });
    const items = await orderItemsForChild(h, childA.id);
    const inv0 = await inventoryFor(h, ctx.varId, ctx.sellerA);
    const s = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 3 }] });
    await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("h") });
    await h.ordersService.dispatchChildOrder({ childOrderId: childA.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", trackingCode: "LEGACY-1", idempotencyKey: makeId("d") });
    const inv = await inventoryFor(h, ctx.varId, ctx.sellerA);
    expect(inv.on_hand).toBe(inv0.on_hand - 5);
    expect(inv.reserved).toBe(inv0.reserved - 5);
    const r = await reservationsFor(h, childA.id);
    expect(r[0].consumed_quantity).toBe(5);
    expect(r[0].status).toBe("confirmed");
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("shipped");
  });
});

describe("Phase 4.7.1 — C: 12 mandatory concurrency races (real PostgreSQL)", () => {
  it("1. duplicate payment webhook ×8 concurrently ⇒ one inbox row, one verification, one ledger IN, one release, one processing transition", async () => {
    const { order } = await createOrder(h, ctx, { qtyA: 1 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const { paymentId, providerReference } = await createFakeIntent(h, order.id, ctx.userBuyer);
    const body = fakeWebhookBody(providerReference, { eventId: "evt-c1-" + paymentId });
    const { ok, failed } = await race(Array.from({ length: 8 }, () => () => paymentWebhook(body)));
    expect(failed).toEqual([]);
    // one worker processes; the others observe the in-flight claim or the final state — never a second processing
    expect(ok.filter((r: any) => r.outcome.status === "processed").length).toBeGreaterThanOrEqual(1);
    expect(ok.every((r: any) => ["processed", "processing"].includes(r.outcome.status))).toBe(true);
    expect(ok.filter((r: any) => r.duplicate).length).toBe(7);
    expect(await count(h.pool, `SELECT 1 FROM payment_provider_event WHERE external_event_id = $1`, ["evt-c1-" + paymentId])).toBe(1);
    expect((await one(h.pool, `SELECT status FROM payment_provider_event WHERE external_event_id = $1`, ["evt-c1-" + paymentId])).status).toBe("processed");
    expect(await count(h.pool, `SELECT 1 FROM financial_ledger_entry WHERE payment_id = $1 AND direction = 'IN'`, [paymentId])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_status_history WHERE order_id = $1 AND to_status = 'processing'`, [order.id])).toBe(1);
    expect((await one(h.pool, `SELECT status FROM payment WHERE id = $1`, [paymentId])).status).toBe("verified");
  });

  it("2. payment webhook vs reconciliation on the same payment ⇒ exactly one verification and one release", async () => {
    const { order } = await createOrder(h, ctx, { qtyA: 1 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const { paymentId, providerReference } = await createFakeIntent(h, order.id, ctx.userBuyer);
    const { failed } = await race([
      () => paymentWebhook(fakeWebhookBody(providerReference, { eventId: "evt-c2-" + paymentId })),
      () => h.paymentProviderOrchestrator.reconcile({ limit: 50 }),
      () => paymentWebhook(fakeWebhookBody(providerReference, { eventId: "evt-c2b-" + paymentId })),
    ]);
    expect(failed).toEqual([]);
    expect((await one(h.pool, `SELECT status FROM payment WHERE id = $1`, [paymentId])).status).toBe("verified");
    expect(await count(h.pool, `SELECT 1 FROM financial_ledger_entry WHERE payment_id = $1 AND direction = 'IN'`, [paymentId])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM payment_allocation WHERE payment_id = $1`, [paymentId])).toBe(1);
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("processing");
  });

  it("3. duplicate provider success for the same provider reference (distinct event ids, in parallel) ⇒ one verification", async () => {
    const { order } = await createOrder(h, ctx, { qtyA: 1 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const { paymentId, providerReference } = await createFakeIntent(h, order.id, ctx.userBuyer);
    const { ok, failed } = await race(Array.from({ length: 5 }, (_, i) => () => paymentWebhook(fakeWebhookBody(providerReference, { eventId: `evt-c3-${i}-${paymentId}` }))));
    expect(failed).toEqual([]);
    expect(ok.every((r: any) => r.outcome.status === "processed")).toBe(true);
    expect(await count(h.pool, `SELECT 1 FROM payment_provider_event WHERE external_payment_reference = $1`, [providerReference])).toBe(5);
    expect(await count(h.pool, `SELECT 1 FROM financial_ledger_entry WHERE payment_id = $1 AND direction = 'IN'`, [paymentId])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_status_history WHERE order_id = $1 AND to_status = 'processing'`, [order.id])).toBe(1);
    expect((await one(h.pool, `SELECT version FROM payment WHERE id = $1`, [paymentId])).version).toBe(1);
  });

  it("4. duplicate refund completion ×6 concurrently ⇒ exactly one OUT ledger entry, one refund.completed event", async () => {
    const { order, childA } = await createOrder(h, ctx, { qtyA: 3 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const { paymentId, providerReference } = await createFakeIntent(h, order.id, ctx.userBuyer);
    await paymentWebhook(fakeWebhookBody(providerReference, { eventId: "evt-c4-" + paymentId }));
    const r = await h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, amount: "1000000", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_ref") });
    await h.financeOrchestrator.approveRefund({ refundId: r.refund.id, adminUserId: ctx.userAdmin, idempotencyKey: makeId("idem_apr"), actorRole: "admin" });
    const { ok, failed } = await race(
      Array.from({ length: 6 }, (_, i) => () =>
        h.financeOrchestrator.completeRefund({ refundId: r.refund.id, adminUserId: ctx.userAdmin, externalReference: "BANK-OUT-C4-" + r.refund.id, idempotencyKey: `idem_c4_${i % 2}_${r.refund.id}`, actorRole: "admin" }),
      ),
    );
    // completions are replays once the first commit landed; a loser may also observe the in-flight state
    expect(failed.filter((e: any) => e?.code !== "INVALID_STATUS_TRANSITION")).toEqual([]);
    expect(ok.filter((r: any) => !r.replayed).length).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM financial_ledger_entry WHERE refund_id = $1 AND direction = 'OUT'`, [r.refund.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_event WHERE aggregate_id = $1 AND event_type = 'refund.completed'`, [order.id])).toBe(1);
    expect((await one(h.pool, `SELECT status FROM refund WHERE id = $1`, [r.refund.id])).status).toBe("completed");
  });

  it("5. two shipments racing for the final quantity ⇒ exactly one wins, the other 409 SHIPMENT_QUANTITY_EXCEEDED; SUM(active) == ordered", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 3 });
    const items = await orderItemsForChild(h, childA.id);
    await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }] });
    const { ok, failed } = await race([
      () => createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 1 }] }),
      () => createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 1 }] }),
      () => createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 1 }] }),
    ]);
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(2);
    expect(failed.every((e: any) => e.code === "SHIPMENT_QUANTITY_EXCEEDED")).toBe(true);
    const sum = await one(h.pool, `SELECT COALESCE(SUM(si.piece_quantity),0)::int AS total FROM shipment_item si JOIN shipment s ON s.id = si.shipment_id WHERE s.child_order_id = $1 AND s.status NOT IN ('cancelled','failed')`, [childA.id]);
    expect(sum.total).toBe(3);
    expect(await count(h.pool, `SELECT 1 FROM shipment WHERE child_order_id = $1`, [childA.id])).toBe(2);
  });

  it("6. duplicate handoff (same key ×3 and different keys ×3, all in parallel) ⇒ inventory consumed exactly once", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 4 });
    const items = await orderItemsForChild(h, childA.id);
    const inv0 = await inventoryFor(h, ctx.varId, ctx.sellerA);
    const s = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 4 }] });
    const sameKey = makeId("idem_h");
    const { ok, failed } = await race([
      () => h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: sameKey }),
      () => h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: sameKey }),
      () => h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: sameKey }),
      () => h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("idem_h") }),
      () => h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("idem_h") }),
      () => h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("idem_h") }),
    ]);
    expect(ok.filter((r: any) => !r.replayed).length).toBe(1);
    expect(failed.every((e: any) => e.code === "INVALID_SHIPMENT_TRANSITION")).toBe(true);
    const inv = await inventoryFor(h, ctx.varId, ctx.sellerA);
    expect(inv.on_hand).toBe(inv0.on_hand - 4);
    expect(inv.reserved).toBe(inv0.reserved - 4);
    expect((await reservationsFor(h, childA.id))[0].consumed_quantity).toBe(4);
    expect(await count(h.pool, `SELECT 1 FROM inventory_ledger WHERE reason LIKE $1`, [`consume shipment ${s.shipment.id} %`])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_status_history WHERE child_order_id = $1 AND to_status = 'shipped'`, [childA.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_event WHERE aggregate_id = $1 AND event_type = 'shipping.shipment_handed_over'`, [childA.id])).toBe(1);
  });

  it("7. handoff vs cancel on the same ready shipment ⇒ exactly one wins; inventory consistent with the winner", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 2 });
    const items = await orderItemsForChild(h, childA.id);
    const inv0 = await inventoryFor(h, ctx.varId, ctx.sellerA);
    const s = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }] });
    const { ok, failed } = await race([
      () => h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("h") }),
      () => h.shippingOrchestrator.cancelShipment({ actor: supplierA(ctx), shipmentId: s.shipment.id, reason: "race", idempotencyKey: makeId("c") }),
    ]);
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0].code).toBe("INVALID_SHIPMENT_TRANSITION");
    const row = await shipmentRow(s.shipment.id);
    const inv = await inventoryFor(h, ctx.varId, ctx.sellerA);
    const res = (await reservationsFor(h, childA.id))[0];
    if (row.status === "handed_over") {
      expect(inv.on_hand).toBe(inv0.on_hand - 2);
      expect(res.consumed_quantity).toBe(2);
      expect(await count(h.pool, `SELECT 1 FROM order_event WHERE aggregate_id = $1 AND event_type = 'shipping.shipment_cancelled'`, [childA.id])).toBe(0);
    } else {
      expect(row.status).toBe("cancelled");
      expect(inv).toEqual(inv0);
      expect(res.consumed_quantity).toBe(0);
      expect(await count(h.pool, `SELECT 1 FROM order_event WHERE aggregate_id = $1 AND event_type = 'shipping.shipment_handed_over'`, [childA.id])).toBe(0);
    }
    expect(await count(h.pool, `SELECT 1 FROM inventory_ledger WHERE reason LIKE $1`, [`consume shipment ${s.shipment.id} %`])).toBe(row.status === "handed_over" ? 1 : 0);
  });

  it("8. duplicate carrier delivered events ×5 (distinct ids, parallel) ⇒ one delivered transition, one child delivered history row", async () => {
    const { childA, shipmentId, externalReference } = await handedOverShipment();
    h.fakeShipping.setCarrierState(externalReference, "delivered");
    const { ok, failed } = await race(Array.from({ length: 5 }, (_, i) => () => shippingWebhook({ externalReference, state: "delivered", eventId: `ev-c8-${i}-${shipmentId}` })));
    expect(failed).toEqual([]);
    expect(ok.every((r: any) => r.outcome.status === "processed")).toBe(true);
    expect((await shipmentRow(shipmentId)).status).toBe("delivered");
    expect(await count(h.pool, `SELECT 1 FROM shipment_event WHERE shipment_id = $1 AND status = 'processed'`, [shipmentId])).toBe(5);
    expect(await count(h.pool, `SELECT 1 FROM order_status_history WHERE child_order_id = $1 AND to_status = 'delivered'`, [childA.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_event WHERE aggregate_id = $1 AND event_type = 'shipping.shipment_delivered'`, [childA.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'shipping.shipment_delivered'`, [shipmentId])).toBe(1);
  });

  it("9. carrier webhook vs shipping reconciliation (parallel) ⇒ one delivered transition", async () => {
    const { childA, shipmentId, externalReference } = await handedOverShipment();
    h.fakeShipping.setCarrierState(externalReference, "delivered");
    const { failed } = await race([
      () => shippingWebhook({ externalReference, state: "delivered", eventId: `ev-c9-${shipmentId}` }),
      () => h.shippingOrchestrator.reconcile({ provider: "fake" }),
      () => shippingWebhook({ externalReference, state: "delivered", eventId: `ev-c9b-${shipmentId}` }),
    ]);
    expect(failed).toEqual([]);
    expect((await shipmentRow(shipmentId)).status).toBe("delivered");
    expect(await count(h.pool, `SELECT 1 FROM order_status_history WHERE child_order_id = $1 AND to_status = 'delivered'`, [childA.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'shipping.shipment_delivered'`, [shipmentId])).toBe(1);
  });

  it("10. two sellers ship the same order in parallel ⇒ fully independent reservations, inventories and child states", async () => {
    const { order, childA, childB } = await preparingOrder(h, ctx, { qtyA: 2, qtyB: 3 });
    const itemsA = await orderItemsForChild(h, childA.id);
    const itemsB = await orderItemsForChild(h, childB!.id);
    const invA0 = await inventoryFor(h, ctx.varId, ctx.sellerA);
    const invB0 = await inventoryFor(h, ctx.varId, ctx.sellerB);
    const { ok, failed } = await race([
      async () => {
        const s = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: itemsA[0].id, pieceQuantity: 2 }], actor: supplierA(ctx) });
        return h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("hA") });
      },
      async () => {
        const s = await createReadyShipment(h, ctx, { childOrderId: childB!.id, items: [{ wholesaleOrderItemId: itemsB[0].id, pieceQuantity: 3 }], actor: supplierB(ctx) });
        return h.shippingOrchestrator.handoff({ actor: supplierB(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("hB") });
      },
    ]);
    expect(failed).toEqual([]);
    expect(ok.length).toBe(2);
    const invA = await inventoryFor(h, ctx.varId, ctx.sellerA);
    const invB = await inventoryFor(h, ctx.varId, ctx.sellerB);
    expect(invA.on_hand).toBe(invA0.on_hand - 2);
    expect(invB.on_hand).toBe(invB0.on_hand - 3);
    expect((await reservationsFor(h, childA.id))[0].consumed_quantity).toBe(2);
    expect((await reservationsFor(h, childB!.id))[0].consumed_quantity).toBe(3);
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("shipped");
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childB!.id])).status).toBe("shipped");
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("shipped");
    // cross-seller access still denied after the fact
    let err: any = null;
    try {
      await h.shippingOrchestrator.getShipmentForActor({ actor: supplierB(ctx), shipmentId: ok.find((r: any) => r.shipment.sellerId === ctx.sellerA)!.shipment.id });
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("SHIPMENT_ACCESS_DENIED");
  });

  it("11. duplicate quote selection ×4 in parallel (two keys) ⇒ one supersede, one selected quote, shipping_total applied once", async () => {
    const { order, childA } = await preparingOrder(h, ctx, { qtyA: 1 });
    const quoted = await h.shippingOrchestrator.createQuote({ actor: supplierA(ctx), childOrderId: childA.id, idempotencyKey: makeId("q"), providerName: "fake" });
    const k1 = makeId("sel");
    const k2 = makeId("sel");
    const { ok, failed } = await race([
      () => h.shippingOrchestrator.selectQuote({ actor: adminActor(ctx), quoteId: quoted.quote.id, idempotencyKey: k1 }),
      () => h.shippingOrchestrator.selectQuote({ actor: adminActor(ctx), quoteId: quoted.quote.id, idempotencyKey: k1 }),
      () => h.shippingOrchestrator.selectQuote({ actor: adminActor(ctx), quoteId: quoted.quote.id, idempotencyKey: k2 }),
      () => h.shippingOrchestrator.selectQuote({ actor: adminActor(ctx), quoteId: quoted.quote.id, idempotencyKey: k2 }),
    ]);
    expect(ok.filter((r: any) => !r.replayed).length).toBe(1);
    expect(failed.every((e: any) => ["QUOTE_ALREADY_SELECTED", "IDEMPOTENCY_CLAIM_RACE"].includes(e.code))).toBe(true);
    expect(await count(h.pool, `SELECT 1 FROM wholesale_proforma WHERE child_order_id = $1 AND status = 'superseded'`, [childA.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM wholesale_proforma WHERE child_order_id = $1 AND status = 'issued'`, [childA.id])).toBe(1);
    expect(String((await one(h.pool, `SELECT shipping_total FROM wholesale_order WHERE id = $1`, [order.id])).shipping_total)).toBe(quoted.quote.amount.toString());
    expect(await count(h.pool, `SELECT 1 FROM order_event WHERE aggregate_id = $1 AND event_type = 'shipping.quote_selected'`, [childA.id])).toBe(1);
  });

  it("12. late shipping fee vs payment verification in parallel ⇒ allocations never exceed the payment, old allocation immutable, exactly the delta stays payable", async () => {
    const { order, childA } = await createOrder(h, ctx, { qtyA: 2 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const quoted = await h.shippingOrchestrator.createQuote({ actor: supplierA(ctx), childOrderId: childA.id, idempotencyKey: makeId("q"), providerName: "fake" });
    const itemsTotal = 2_000_000n;
    const submit = await h.financeOrchestrator.submitTransfer({ orderId: order.id, buyerUserId: ctx.userBuyer, amount: itemsTotal.toString(), bankReference: "BANK-C12-" + order.id, idempotencyKey: makeId("t"), actorRole: "buyer" });
    const { failed } = await race([
      () => h.financeOrchestrator.verifyPayment({ paymentId: submit.payment.id, adminUserId: ctx.userAdmin, externalReference: "BANK-C12-" + order.id, idempotencyKey: makeId("v"), actorRole: "admin" }),
      () => h.shippingOrchestrator.selectQuote({ actor: adminActor(ctx), quoteId: quoted.quote.id, idempotencyKey: makeId("sel") }),
    ]);
    expect(failed).toEqual([]);
    const allocs = await q(h.pool, `SELECT pa.amount::text AS amount, wp.status AS proforma_status FROM payment_allocation pa JOIN wholesale_proforma wp ON wp.id = pa.proforma_id WHERE pa.payment_id = $1`, [submit.payment.id]);
    const allocated = allocs.reduce((s, a) => s + BigInt(a.amount), 0n);
    expect(allocated).toBe(itemsTotal);
    const summary = await h.paymentsService.getOrderFinancialSummary(order.id);
    expect(summary.currentPayable).toBe(quoted.quote.amount.toString());
    expect(summary.unallocatedPaid).toBe("0");
    const issued = await one(h.pool, `SELECT total_amount, shipping_total FROM wholesale_proforma WHERE child_order_id = $1 AND status = 'issued'`, [childA.id]);
    expect(BigInt(issued.total_amount)).toBe(itemsTotal + quoted.quote.amount);
    expect(await count(h.pool, `SELECT 1 FROM wholesale_proforma WHERE child_order_id = $1 AND status = 'superseded'`, [childA.id])).toBe(1);
    expect(String((await one(h.pool, `SELECT total_amount FROM wholesale_proforma WHERE child_order_id = $1 AND status = 'superseded'`, [childA.id])).total_amount)).toBe(itemsTotal.toString());
    // the gate: released only if the payable was fully covered at verification time; either way no double release
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBeLessThanOrEqual(1);
    // paying the delta settles the order
    const submit2 = await h.financeOrchestrator.submitTransfer({ orderId: order.id, buyerUserId: ctx.userBuyer, amount: quoted.quote.amount.toString(), bankReference: "BANK-C12b-" + order.id, idempotencyKey: makeId("t"), actorRole: "buyer" });
    await h.financeOrchestrator.verifyPayment({ paymentId: submit2.payment.id, adminUserId: ctx.userAdmin, externalReference: "BANK-C12b-" + order.id, idempotencyKey: makeId("v"), actorRole: "admin" });
    const final = await h.paymentsService.getOrderFinancialSummary(order.id);
    expect(final.currentPayable).toBe("0");
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("processing");
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBe(1);
  });
});
