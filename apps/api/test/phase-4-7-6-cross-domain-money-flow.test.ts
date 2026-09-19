/**
 * Phase 4.7.6 — Cross-domain money flow (real PostgreSQL, HTTP where the surface exists).
 *
 * One parent order of 100,000,000 IRR = Kolbe 40M + Supplier A 35M + Supplier B 25M travels through
 * Orders → Finance/Payments (webhook-verified payment) → Shipping (quantity-evidenced delivery) →
 * Fulfillment (exception) → Payments (exact-slice refund) → Invoicing (invoice) while the settlement-
 * readiness projection is checked after every step for money conservation (FI-23) and for the
 * frozen Phase 4.8 rules. Nothing here implements settlement; it proves the facts a settlement
 * engine will consume are exact, attributable and replay-safe.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminActor,
  bootHarness,
  count,
  createReadyShipment,
  makeId,
  one,
  orderItemsForChild,
  q,
  seedTwoSuppliers,
  supplierA,
  supplierB,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";
import { KOLBE_SELLER_ID, blockerCodes, createMixedOrder, kolbeRef, payByWebhook, prepareChild, readinessService, seedKolbeOffer, sellerARef, sellerBRef, stripVolatile, type KolbeContext } from "./helpers/phase-4-7-6.harness";

const TEST_DB = "kolbe_phase_4_7_6_cross_domain_test";

let h: Harness;
let ctx: SupplierContext;
let kolbe: KolbeContext;
let readiness: any;
let fulfillment: any;
let invoicing: any;

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 7_000_000n, priceB: 5_000_000n, onHand: 500 });
  kolbe = await seedKolbeOffer(h, ctx, 10_000_000n);
  readiness = await readinessService(h);
  const { FulfillmentService } = await import("../src/modules/fulfillment/fulfillment.service");
  fulfillment = h.app.get(FulfillmentService);
  const { InvoicingService } = await import("../src/modules/invoicing/invoicing.service");
  invoicing = h.app.get(InvoicingService);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());
const sum = (xs: Array<string | bigint>) => xs.reduce<bigint>((s, x) => s + BigInt(x), 0n);

/** FI-23 — money conservation across the whole order, computed from the readiness projection + DB. */
async function assertConservation(orderId: string) {
  const view = await readiness.computeForOrder(orderId);
  const verified = BigInt(view.order.verifiedPaid);
  const allocatedByChildren = sum(view.children.map((c: any) => c.cashCoverage.allocatedVerified));
  expect(allocatedByChildren + BigInt(view.order.unallocatedPaid)).toBe(verified);
  expect(BigInt(view.order.allocatedVerified)).toBe(allocatedByChildren);
  const ledger = await one(h.pool, `SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN amount END),0)::text AS inn, COALESCE(SUM(CASE WHEN direction='OUT' THEN amount END),0)::text AS outt FROM financial_ledger_entry WHERE order_id = $1`, [orderId]);
  expect(view.order.ledgerIn).toBe(ledger.inn);
  expect(view.order.ledgerOut).toBe(ledger.outt);
  const completedChildRefunds = sum(view.children.map((c: any) => c.economicBasis.merchandiseRefundedCompleted));
  const completedOrderScoped = await one(h.pool, `SELECT COALESCE(SUM(amount),0)::text AS s FROM refund WHERE wholesale_order_id = $1 AND child_order_id IS NULL AND status = 'completed'`, [orderId]);
  expect(BigInt(ledger.outt)).toBe(completedChildRefunds + BigInt(completedOrderScoped.s));
  for (const c of view.children) {
    // a child's basis never exceeds its own terms and never includes another child's money
    expect(BigInt(c.economicBasis.merchandiseDelivered)).toBeLessThanOrEqual(BigInt(c.economicBasis.merchandiseOrdered) || 0n);
    expect(BigInt(c.economicBasis.merchandiseEntitledPreview)).toBeLessThanOrEqual(BigInt(c.economicBasis.merchandiseDelivered));
    if (c.participant.sellerType === "KOLBE") expect(c.economicBasis.merchandiseEntitledPreview).toBe("0");
    expect(JSON.stringify(c)).not.toMatch(/"(supplierBalance|walletBalance|withdrawableBalance)"/);
  }
  return view;
}

describe("Phase 4.7.6 — cross-domain money flow: Parent 100M = Kolbe 40M + A 35M + B 25M", () => {
  it("every domain step keeps the money attributable, conserved and replay-safe", async () => {
    // ── Orders: one buyer transaction, three seller transactions ──
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: kolbeRef(kolbe), quantity: 4 },
      { seller: sellerARef(ctx), quantity: 5 },
      { seller: sellerBRef(ctx), quantity: 5 },
    ]);
    const childK = childFor(KOLBE_SELLER_ID);
    const childA = childFor(ctx.sellerA);
    const childB = childFor(ctx.sellerB);
    expect((await one(h.pool, `SELECT grand_total::text AS g FROM wholesale_order WHERE id = $1`, [order.id])).g).toBe("100000000");
    expect((await one(h.pool, `SELECT supplier_id FROM purchase_order WHERE id = $1`, [childK.id])).supplier_id).toBeNull();

    // draft: nothing snapshotted, nothing paid — readiness says so instead of guessing
    const draftA = await readiness.computeForChild(childA.id);
    expect(draftA.commercialTerms.snapshotted).toBe(false);
    expect(blockerCodes(draftA)).toEqual(expect.arrayContaining(["COMMERCIAL_TERMS_NOT_SNAPSHOTTED", "PAYMENT_NOT_COLLECTED", "CHILD_NOT_DELIVERED"]));

    // ── Finance/Payments over HTTP: confirm → online intent → signed provider webhook ──
    const buyer = cookie(ctx.userBuyer, "vip");
    await api().post(`/api/v1/wholesale/orders/${order.id}/confirm`).set("Cookie", buyer).set("Idempotency-Key", makeId("k")).send({}).expect((r) => expect([200, 201]).toContain(r.status));
    const proformas = await q(h.pool, `SELECT child_order_id, total_amount::text AS total FROM wholesale_proforma WHERE wholesale_order_id = $1 AND status = 'issued'`, [order.id]);
    expect(new Map(proformas.map((p) => [p.child_order_id, p.total]))).toEqual(new Map([[childK.id, "40000000"], [childA.id, "35000000"], [childB.id, "25000000"]]));
    await payByWebhook(h, ctx, order.id);
    const paid = await assertConservation(order.id);
    expect(paid.order.verifiedPaid).toBe("100000000");
    expect(paid.order.unallocatedPaid).toBe("0");
    const byChild = new Map(paid.children.map((c: any) => [c.childOrderId, c]));
    expect((byChild.get(childK.id) as any).cashCoverage.allocatedVerified).toBe("40000000");
    expect((byChild.get(childA.id) as any).cashCoverage.allocatedVerified).toBe("35000000");
    expect((byChild.get(childB.id) as any).cashCoverage.allocatedVerified).toBe("25000000");
    expect((byChild.get(childK.id) as any).participant.settlementCandidate).toBe(false);
    // paid but not delivered ⇒ no entitlement anywhere (payment ≠ entitlement)
    expect(paid.children.every((c: any) => c.economicBasis.merchandiseEntitledPreview === "0")).toBe(true);

    // ── Shipping: A delivers everything, B delivers 3 of 5 (quantity evidence) ──
    await prepareChild(h, childA.id, ctx.userAOwner);
    await prepareChild(h, childB.id, ctx.userBOwner);
    const itemsA = await orderItemsForChild(h, childA.id);
    const itemsB = await orderItemsForChild(h, childB.id);
    const shipA = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: itemsA[0].id, pieceQuantity: 5 }] });
    await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: shipA.shipment.id, idempotencyKey: makeId("h") });
    const shipB = await createReadyShipment(h, ctx, { childOrderId: childB.id, actor: supplierB(ctx), items: [{ wholesaleOrderItemId: itemsB[0].id, pieceQuantity: 3 }] });
    await h.shippingOrchestrator.handoff({ actor: supplierB(ctx), shipmentId: shipB.shipment.id, idempotencyKey: makeId("h") });
    // carrier delivered through the public signed webhook for A; admin mark for B; both replayed later
    const rowA = await one(h.pool, `SELECT external_reference FROM shipment WHERE id = $1`, [shipA.shipment.id]);
    h.fakeShipping.setCarrierState(rowA.external_reference, "delivered");
    const { signedFakeShippingHeaders } = await import("./helpers/phase-4-7-1.harness");
    const whA = await api().post(`/api/v1/shipping/providers/fake/webhook`).set(signedFakeShippingHeaders()).send({ externalReference: rowA.external_reference, state: "delivered", eventId: "ev-476-" + shipA.shipment.id }).expect(200);
    expect(whA.body.status).toBe("processed");
    await h.shippingOrchestrator.markDelivered({ actor: adminActor(ctx), shipmentId: shipB.shipment.id, idempotencyKey: makeId("d") });
    // replays: same carrier event again + admin replays in parallel ⇒ no duplicate evidence
    const whReplay = await api().post(`/api/v1/shipping/providers/fake/webhook`).set(signedFakeShippingHeaders()).send({ externalReference: rowA.external_reference, state: "delivered", eventId: "ev-476-" + shipA.shipment.id }).expect(200);
    expect(whReplay.body.duplicate).toBe(true);
    await Promise.all([1, 2, 3].map(() => h.shippingOrchestrator.markDelivered({ actor: adminActor(ctx), shipmentId: shipB.shipment.id, idempotencyKey: makeId("dc") })));

    const delivered = await assertConservation(order.id);
    const a1 = delivered.children.find((c: any) => c.childOrderId === childA.id);
    const b1 = delivered.children.find((c: any) => c.childOrderId === childB.id);
    const k1 = delivered.children.find((c: any) => c.childOrderId === childK.id);
    expect(a1.fulfillment).toMatchObject({ deliveredPieces: 5, deliveryEvidence: "QUANTITY_EVIDENCED" });
    expect(a1.economicBasis.merchandiseEntitledPreview).toBe("35000000");
    expect(blockerCodes(a1)).not.toContain("PARTIAL_FULFILLMENT");
    expect(b1.fulfillment).toMatchObject({ deliveredPieces: 3, deliveryEvidence: "PARTIAL_QUANTITY_EVIDENCED" });
    expect(b1.economicBasis.merchandiseEntitledPreview).toBe("15000000");
    expect(blockerCodes(b1)).toContain("PARTIAL_FULFILLMENT");
    expect(k1.economicBasis.merchandiseEntitledPreview).toBe("0");
    expect(blockerCodes(k1)).toEqual(["KOLBE_FIRST_PARTY"]);
    // the only blockers left for A are configuration/compliance — never economic
    expect(a1.blockers.filter((b: any) => b.class === "economic")).toEqual([]);
    expect(a1.sourceDataSufficient).toBe(true);
    expect(a1.readyForSettlementEngine).toBe(false); // no commission/hold policy exists yet
    expect(blockerCodes(a1)).toEqual(expect.arrayContaining(["COMMISSION_POLICY_UNDEFINED", "HOLD_POLICY_UNDEFINED"]));

    // ── Fulfillment + Payments: B cannot deliver the last 2 (exception) ⇒ exact-slice refund of 2 units ──
    const exc = await fulfillment.reportException({ childOrderId: childB.id, sellerId: ctx.sellerB, type: "partial_shortage", reason: "2 pieces unavailable", affectedOrderItemIds: [itemsB[0].id], reportedByUserId: ctx.userBOwner, idempotencyKey: makeId("exc") });
    const admin = cookie(ctx.userAdmin, "admin");
    const refundRes = await api()
      .post(`/api/v1/admin/refunds`)
      .set("Cookie", admin)
      .set("Idempotency-Key", makeId("k"))
      .send({ orderId: order.id, childOrderId: childB.id, exceptionId: exc.exception.id, lines: [{ wholesaleOrderItemId: itemsB[0].id, quantity: 2 }], reasonCode: "shortage" })
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect(refundRes.body.refund.amount).toBe("10000000");
    expect(refundRes.body.lines).toEqual([{ wholesaleOrderItemId: itemsB[0].id, quantity: 2, lineTotal: "10000000" }]);
    const refundId = refundRes.body.refund.id;
    // a refund citing B's exception against child A is refused over HTTP too
    const cross = await api()
      .post(`/api/v1/admin/refunds`)
      .set("Cookie", admin)
      .set("Idempotency-Key", makeId("k"))
      .send({ orderId: order.id, childOrderId: childA.id, exceptionId: exc.exception.id, lines: [{ wholesaleOrderItemId: itemsA[0].id, quantity: 1 }], reasonCode: "shortage" });
    expect(cross.status).toBe(409);
    expect(cross.body.error ?? cross.body.code).toBe("REFUND_EXCEPTION_CHILD_MISMATCH");
    // an order-scoped refund is refused: all 100M is allocated (seller-attributable)
    const scoped = await api().post(`/api/v1/admin/refunds`).set("Cookie", admin).set("Idempotency-Key", makeId("k")).send({ orderId: order.id, amount: "1", reasonCode: "goodwill" });
    expect(scoped.status).toBe(409);
    expect(scoped.body.error ?? scoped.body.code).toBe("REFUND_SCOPE_REQUIRED");

    const pendingView = await assertConservation(order.id);
    const b2 = pendingView.children.find((c: any) => c.childOrderId === childB.id);
    expect(b2.economicBasis.merchandiseRefundedPending).toBe("10000000");
    expect(b2.commercialTerms.items[0]).toMatchObject({ deliveredUnits: 3, refundedUnitsUndelivered: 2, refundedUnitsDelivered: 0, entitledUnitsPreview: 3 });
    expect(b2.economicBasis.merchandiseEntitledPreview).toBe("15000000");
    expect(blockerCodes(b2)).toContain("REFUND_PENDING");
    const aUnchanged = pendingView.children.find((c: any) => c.childOrderId === childA.id);
    expect(stripVolatile({ ...aUnchanged, parentStatus: null })).toEqual(stripVolatile({ ...a1, parentStatus: null }));

    await api().post(`/api/v1/admin/refunds/${refundId}/approve`).set("Cookie", admin).set("Idempotency-Key", makeId("k")).send({}).expect((r) => expect([200, 201]).toContain(r.status));
    await api().post(`/api/v1/admin/refunds/${refundId}/complete`).set("Cookie", admin).set("Idempotency-Key", makeId("k")).send({ externalReference: "BANK-RF-476-CROSS-" + refundId }).expect((r) => expect([200, 201]).toContain(r.status));
    const completedView = await assertConservation(order.id);
    expect(completedView.order.ledgerIn).toBe("100000000");
    expect(completedView.order.ledgerOut).toBe("10000000");
    const b3 = completedView.children.find((c: any) => c.childOrderId === childB.id);
    expect(b3.economicBasis.merchandiseRefundedCompleted).toBe("10000000");
    expect(b3.economicBasis.merchandiseEntitledPreview).toBe("15000000");
    expect(blockerCodes(b3)).not.toContain("REFUND_PENDING");
    expect(blockerCodes(b3)).toContain("PARTIAL_FULFILLMENT"); // 3 of 5 delivered; the 2 refunded units are gone, not delivered
    const out = await one(h.pool, `SELECT child_order_id FROM financial_ledger_entry WHERE order_id = $1 AND direction = 'OUT'`, [order.id]);
    expect(out.child_order_id).toBe(childB.id);

    // ── Invoicing: the invoice is evidence, never the payout basis ──
    const inv = await invoicing.issueWholesaleChildInvoice({ userId: ctx.userAdmin, role: "admin" }, { wholesaleOrderId: order.id, childOrderId: childB.id });
    expect(BigInt(inv.invoice.subtotal)).toBe(25_000_000n); // full ordered value (document), while the entitlement preview is 15M
    expect(BigInt(inv.invoice.taxTotal)).toBe(0n);
    const afterInvoice = await readiness.computeForChild(childB.id);
    expect(afterInvoice.economicBasis.merchandiseEntitledPreview).toBe("15000000");
    expect(afterInvoice.economicBasis.taxTreatment).toBe("NOT_ASSESSED");

    // ── Sum-up (what a Phase 4.8 engine would consume; nothing is posted today) ──
    const finalView = await assertConservation(order.id);
    const candidates = finalView.children.filter((c: any) => c.participant.settlementCandidate);
    expect(candidates.map((c: any) => c.participant.supplierId).sort()).toEqual([ctx.supA, ctx.supB].sort());
    expect(sum(candidates.map((c: any) => c.economicBasis.merchandiseEntitledPreview))).toBe(50_000_000n); // 35M + 15M
    expect(sum(finalView.children.map((c: any) => c.cashCoverage.allocatedVerified))).toBe(100_000_000n);
    expect(finalView.children.every((c: any) => c.commission.amount === null && c.commission.defaultBeforeConfiguration === "0")).toBe(true);
    // nothing in the whole flow created a customer wallet artefact — wallet is strictly forbidden
    const tables = await q(h.pool, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name ILIKE '%wallet%'`);
    expect(tables).toEqual([]);
    expect(await count(h.pool, `SELECT 1 FROM payment WHERE wholesale_order_id = $1`, [order.id])).toBe(1);
  });

  it("supplier surfaces never see readiness or other sellers' money; admin readiness exposes no balance", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: sellerARef(ctx), quantity: 1 },
      { seller: sellerBRef(ctx), quantity: 1 },
    ]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    const childB = childFor(ctx.sellerB);
    await api().get(`/api/v1/admin/settlement-readiness/children/${childB.id}`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(403);
    await api().get(`/api/v1/admin/settlement-readiness/orders/${order.id}`).set("Cookie", cookie(ctx.userBOwner, "supplier")).expect(403);
    const adminView = await api().get(`/api/v1/admin/settlement-readiness/orders/${order.id}`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(200);
    expect(adminView.body.children.map((c: any) => c.childOrderId).sort()).toEqual([childA.id, childB.id].sort());
    expect(JSON.stringify(adminView.body)).not.toMatch(/"(supplierBalance|walletBalance|withdrawableBalance|availableBalance|pendingBalance|payoutAmount)"/);
    expect(adminView.body.disclaimer).toBe("NOT A SETTLEMENT BALANCE");
    // supplier A's own child view (existing surface) serialises money as strings and never mentions child B
    const supplierView = await api().get(`/api/v1/supplier/orders/${childA.id}`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(200);
    expect(supplierView.body.child.id).toBe(childA.id);
    expect(supplierView.body.child.grandTotal).toBe(ctx.priceA.toString());
    expect(JSON.stringify(supplierView.body)).not.toContain(childB.id);
    // another supplier's child is a 403 boundary, not a 500
    const denied = await api().get(`/api/v1/supplier/orders/${childB.id}`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(403);
    expect(denied.body.error).toBe("SUPPLIER_OWNERSHIP_VIOLATION");
    await api().get(`/api/v1/supplier/orders/po_missing`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(404);
  });
});
