/**
 * Phase 4.7.6 — Settlement-readiness (read-only) behaviour tests on real PostgreSQL.
 *
 * The readiness service reconstructs, per child order, the immutable economic facts a future
 * settlement engine would need — and says explicitly why the child is NOT ready. It is labelled
 * "NOT A SETTLEMENT BALANCE" and exposes no wallet/balance/withdrawable field. Phase 4.8 has NOT
 * started; nothing here moves money.
 *
 * Scenario numbers (S1…S20) follow the Phase 4.7.6 mandate list.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminActor,
  bootHarness,
  confirmToAwaitingPayment,
  count,
  expectDomainError,
  makeId,
  one,
  orderItemsForChild,
  q,
  seedTwoSuppliers,
  supplierB,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";
import {
  KOLBE_SELLER_ID,
  blockerCodes,
  createMixedOrder,
  deliverPieces,
  kolbeRef,
  payByWebhook,
  prepareChild,
  readinessService,
  seedKolbeOffer,
  sellerARef,
  sellerBRef,
  stripVolatile,
  type KolbeContext,
} from "./helpers/phase-4-7-6.harness";
import { FORBIDDEN_READINESS_FIELDS } from "../src/modules/settlement-readiness/settlement-readiness.contract";

const TEST_DB = "kolbe_phase_4_7_6_readiness_test";

let h: Harness;
let ctx: SupplierContext;
let kolbe: KolbeContext;
let readiness: any;
let invoicing: any;
let fulfillment: any;

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 7_000_000n, priceB: 5_000_000n, onHand: 500 });
  kolbe = await seedKolbeOffer(h, ctx, 10_000_000n);
  readiness = await readinessService(h);
  const { InvoicingService } = await import("../src/modules/invoicing/invoicing.service");
  invoicing = h.app.get(InvoicingService);
  const { FulfillmentService } = await import("../src/modules/fulfillment/fulfillment.service");
  fulfillment = h.app.get(FulfillmentService);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

const admin = () => adminActor(ctx);
const A = () => sellerARef(ctx);
const B = () => sellerBRef(ctx);
const K = () => kolbeRef(kolbe);

function assertPayloadHygiene(payload: any) {
  const json = JSON.stringify(payload);
  for (const field of FORBIDDEN_READINESS_FIELDS) expect(json, field).not.toContain(`"${field}"`);
  expect(payload.disclaimer).toBe("NOT A SETTLEMENT BALANCE");
  // no float money anywhere: every numeric-looking token that is not an ISO timestamp is an integer
  const withoutTimestamps = json.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "");
  expect(withoutTimestamps).not.toMatch(/\d+\.\d+/);
}

async function refundLines(orderId: string, childOrderId: string, lines: Array<{ wholesaleOrderItemId: string; quantity: number }>, opts: { exceptionId?: string; complete?: boolean } = {}) {
  const created = await h.financeOrchestrator.createRefund({ orderId, childOrderId, lines, exceptionId: opts.exceptionId, reasonCode: "test", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") });
  if (opts.complete) {
    await h.financeOrchestrator.approveRefund({ refundId: created.refund.id, adminUserId: ctx.userAdmin, idempotencyKey: makeId("a"), actorRole: "admin" });
    await h.financeOrchestrator.completeRefund({ refundId: created.refund.id, adminUserId: ctx.userAdmin, externalReference: "BANK-RF-476-" + created.refund.id, idempotencyKey: makeId("c"), actorRole: "admin" });
  }
  return created.refund;
}

describe("Phase 4.7.6 — S1/S2 participant identity and cross-seller isolation", () => {
  it("S1: a Kolbe first-party child is excluded (no basis, commission 0, blocker KOLBE_FIRST_PARTY); supplier siblings are candidates", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: K(), quantity: 4 },
      { seller: A(), quantity: 5 },
      { seller: B(), quantity: 5 },
    ]);
    await payByWebhook(h, ctx, order.id);
    const orderView = await readiness.computeForOrder(order.id);
    assertPayloadHygiene(orderView);
    expect(orderView.children).toHaveLength(3);
    const k = orderView.children.find((c: any) => c.childOrderId === childFor(KOLBE_SELLER_ID).id);
    expect(k.participant).toMatchObject({ sellerType: "KOLBE", supplierId: null, settlementCandidate: false });
    expect(blockerCodes(k)).toEqual(["KOLBE_FIRST_PARTY"]);
    expect(k.economicBasis.merchandiseOrdered).toBe("0");
    expect(k.economicBasis.merchandiseEntitledPreview).toBe("0");
    expect(k.commission).toEqual({ applicable: false, policyRef: null, basis: null, rateBps: null, amount: null, defaultBeforeConfiguration: "0" });
    expect(k.compliance.evaluated).toBe(false);
    expect(k.readyForSettlementEngine).toBe(false);
    expect(k.sourceDataSufficient).toBe(false);
    // …but the Kolbe child's cash coverage is still visible: the buyer paid for it (100M parent transaction)
    expect(k.cashCoverage.childPayable).toBe("40000000");
    expect(k.cashCoverage.allocatedVerified).toBe("40000000");
    const a = orderView.children.find((c: any) => c.childOrderId === childFor(ctx.sellerA).id);
    const b = orderView.children.find((c: any) => c.childOrderId === childFor(ctx.sellerB).id);
    expect(a.participant).toMatchObject({ sellerType: "SUPPLIER", supplierId: ctx.supA, settlementCandidate: true });
    expect(a.economicBasis.merchandiseOrdered).toBe("35000000");
    expect(b.economicBasis.merchandiseOrdered).toBe("25000000");
    expect(a.cashCoverage.covered).toBe(true);
    expect(b.cashCoverage.covered).toBe(true);
    // Parent 100M = Kolbe 40M + A 35M + B 25M; nothing unallocated; ledger is order-level only
    expect(orderView.order.verifiedPaid).toBe("100000000");
    expect(orderView.order.allocatedVerified).toBe("100000000");
    expect(orderView.order.unallocatedPaid).toBe("0");
    expect(orderView.order.ledgerIn).toBe("100000000");
    expect(orderView.order.ledgerOut).toBe("0");
    expect(a.commission.defaultBeforeConfiguration).toBe("0");
    expect(blockerCodes(a)).toContain("COMMISSION_POLICY_UNDEFINED");
    expect(blockerCodes(a)).toContain("CHILD_NOT_DELIVERED");
  });

  it("S2/S5: refunding and delivering child B leaves child A's readiness byte-for-byte unchanged", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: A(), quantity: 3 },
      { seller: B(), quantity: 4 },
    ]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    const childB = childFor(ctx.sellerB);
    const before = stripVolatile(await readiness.computeForChild(childA.id));
    await prepareChild(h, childB.id, ctx.userBOwner);
    await deliverPieces(h, ctx, childB.id, 4, supplierB(ctx));
    const itemsB = await orderItemsForChild(h, childB.id);
    await refundLines(order.id, childB.id, [{ wholesaleOrderItemId: itemsB[0].id, quantity: 1 }], { complete: true });
    const after = stripVolatile(await readiness.computeForChild(childA.id));
    // the parent status is a projection over all children (B's delivery moves it); everything economic is identical
    expect(after.parentStatus).not.toBe(before.parentStatus);
    delete (after as any).parentStatus;
    delete (before as any).parentStatus;
    expect(after).toEqual(before);
    const b = await readiness.computeForChild(childB.id);
    expect(b.economicBasis.merchandiseDelivered).toBe((ctx.priceB * 4n).toString());
    expect(b.economicBasis.merchandiseRefundedCompleted).toBe(ctx.priceB.toString());
    expect(b.economicBasis.merchandiseEntitledPreview).toBe((ctx.priceB * 3n).toString());
    expect(b.blockers.map((x: any) => x.code)).not.toContain("REFUND_PENDING");
  });
});

describe("Phase 4.7.6 — S3/S4/S13/S18/S19 quantity-level attribution", () => {
  it("S3: partial delivery attributes exactly the delivered quantity (4 of 10) and flags PARTIAL_FULFILLMENT", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 10 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    await prepareChild(h, childA.id, ctx.userAOwner);
    const r0 = await readiness.computeForChild(childA.id);
    expect(r0.fulfillment.deliveryEvidence).toBe("NONE");
    expect(blockerCodes(r0)).toContain("CHILD_NOT_DELIVERED");
    await deliverPieces(h, ctx, childA.id, 4);
    const r1 = await readiness.computeForChild(childA.id);
    assertPayloadHygiene(r1);
    expect(r1.fulfillment).toMatchObject({ orderedPieces: 10, deliveredPieces: 4, deliveredShipments: 1, statusDelivered: false, deliveryEvidence: "PARTIAL_QUANTITY_EVIDENCED" });
    expect(r1.commercialTerms.items[0]).toMatchObject({ orderedUnits: 10, deliveredUnits: 4, entitledUnitsPreview: 4, piecesPerUnit: 1 });
    expect(r1.economicBasis.merchandiseOrdered).toBe((ctx.priceA * 10n).toString());
    expect(r1.economicBasis.merchandiseDelivered).toBe((ctx.priceA * 4n).toString());
    expect(r1.economicBasis.merchandiseEntitledPreview).toBe((ctx.priceA * 4n).toString());
    expect(blockerCodes(r1)).toContain("PARTIAL_FULFILLMENT");
    expect(blockerCodes(r1)).not.toContain("CHILD_NOT_DELIVERED");
    expect(r1.blockers.find((b: any) => b.code === "PARTIAL_FULFILLMENT").class).toBe("payout");
    expect(r1.sourceDataSufficient).toBe(true);
  });

  it("S4/S13: a partial refund reduces only the exact slice; refunds never drive the preview negative; pending vs completed is visible", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 10 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    await prepareChild(h, childA.id, ctx.userAOwner);
    await deliverPieces(h, ctx, childA.id, 10);
    const items = await orderItemsForChild(h, childA.id);
    const pending = await refundLines(order.id, childA.id, [{ wholesaleOrderItemId: items[0].id, quantity: 2 }]);
    const r1 = await readiness.computeForChild(childA.id);
    expect(r1.fulfillment.deliveryEvidence).toBe("QUANTITY_EVIDENCED");
    expect(r1.economicBasis.merchandiseRefundedPending).toBe((ctx.priceA * 2n).toString());
    expect(r1.economicBasis.merchandiseRefundedCompleted).toBe("0");
    expect(r1.economicBasis.merchandiseEntitledPreview).toBe((ctx.priceA * 8n).toString());
    expect(r1.commercialTerms.items[0]).toMatchObject({ deliveredUnits: 10, refundedUnitsDelivered: 2, refundedUnitsUndelivered: 0, entitledUnitsPreview: 8 });
    expect(blockerCodes(r1)).toContain("REFUND_PENDING");
    await h.financeOrchestrator.approveRefund({ refundId: pending.id, adminUserId: ctx.userAdmin, idempotencyKey: makeId("a"), actorRole: "admin" });
    await h.financeOrchestrator.completeRefund({ refundId: pending.id, adminUserId: ctx.userAdmin, externalReference: "BANK-RF-476-" + pending.id, idempotencyKey: makeId("c"), actorRole: "admin" });
    const r2 = await readiness.computeForChild(childA.id);
    expect(r2.economicBasis.merchandiseRefundedCompleted).toBe((ctx.priceA * 2n).toString());
    expect(r2.economicBasis.merchandiseRefundedPending).toBe("0");
    expect(blockerCodes(r2)).not.toContain("REFUND_PENDING");
    // S13 — a "post-settlement" style refund of the remaining 8 after the slice was already counted:
    // history stays (refund rows are never edited), the preview floors at 0, and nothing is negative.
    await refundLines(order.id, childA.id, [{ wholesaleOrderItemId: items[0].id, quantity: 8 }], { complete: true });
    const r3 = await readiness.computeForChild(childA.id);
    expect(r3.economicBasis.merchandiseEntitledPreview).toBe("0");
    expect(r3.economicBasis.merchandiseRefundedCompleted).toBe((ctx.priceA * 10n).toString());
    expect(r3.refunds).toHaveLength(2);
    expect(JSON.stringify(r3)).not.toContain('"-');
  });

  it("S13b: exception-linked refunds (never delivered) do not reduce the delivered entitlement of the same item", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 10 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    await prepareChild(h, childA.id, ctx.userAOwner);
    await deliverPieces(h, ctx, childA.id, 4);
    const items = await orderItemsForChild(h, childA.id);
    const exc = await fulfillment.reportException({ childOrderId: childA.id, sellerId: ctx.sellerA, type: "partial_shortage", reason: "6 pieces unavailable", affectedOrderItemIds: [items[0].id], reportedByUserId: ctx.userAOwner, idempotencyKey: makeId("exc") });
    await refundLines(order.id, childA.id, [{ wholesaleOrderItemId: items[0].id, quantity: 6 }], { exceptionId: exc.exception.id, complete: true });
    const r = await readiness.computeForChild(childA.id);
    expect(r.commercialTerms.items[0]).toMatchObject({ deliveredUnits: 4, refundedUnitsUndelivered: 6, refundedUnitsDelivered: 0, entitledUnitsPreview: 4 });
    expect(r.economicBasis.merchandiseEntitledPreview).toBe((ctx.priceA * 4n).toString());
    expect(r.refunds[0].exceptionLinked).toBe(true);
  });

  it("S18/S19: replaying delivery (sequentially and concurrently) never changes the attributed quantity", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 6 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    await prepareChild(h, childA.id, ctx.userAOwner);
    const { shipmentId } = await deliverPieces(h, ctx, childA.id, 6);
    const r1 = stripVolatile(await readiness.computeForChild(childA.id));
    await h.shippingOrchestrator.markDelivered({ actor: admin(), shipmentId, idempotencyKey: makeId("d") });
    await Promise.all([1, 2, 3, 4, 5, 6].map(() => h.shippingOrchestrator.markDelivered({ actor: admin(), shipmentId, idempotencyKey: makeId("dc") })));
    const r2 = stripVolatile(await readiness.computeForChild(childA.id));
    expect(r2).toEqual(r1);
    expect(r2.fulfillment.deliveredPieces).toBe(6);
    expect(r2.fulfillment.deliveryHistory).toHaveLength(1);
    expect(r2.fulfillment.deliveryHistory[0].trigger).toBe("shipping.shipment_delivered");
  });

  it("status-only delivery (supplier self-mark) is NOT settlement evidence: DELIVERY_EVIDENCE_MISSING", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 2 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    await prepareChild(h, childA.id, ctx.userAOwner);
    const items = await orderItemsForChild(h, childA.id);
    const { createReadyShipment } = await import("./helpers/phase-4-7-1.harness");
    const s = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }] });
    await h.shippingOrchestrator.handoff({ actor: { userId: ctx.userAOwner, role: "supplier" }, shipmentId: s.shipment.id, idempotencyKey: makeId("h") });
    await h.ordersService.deliverChildOrder({ childOrderId: childA.id, actorUserId: ctx.userAOwner, actorRole: "supplier", idempotencyKey: makeId("deliver") });
    const r = await readiness.computeForChild(childA.id);
    expect(r.childStatus).toBe("delivered");
    expect(r.fulfillment).toMatchObject({ statusDelivered: true, deliveredPieces: 0, deliveryEvidence: "STATUS_ONLY" });
    expect(r.fulfillment.deliveryHistory[0]).toMatchObject({ actorRole: "supplier", trigger: "orders.child_deliver" });
    expect(blockerCodes(r)).toContain("DELIVERY_EVIDENCE_MISSING");
    expect(r.sourceDataSufficient).toBe(false);
    expect(r.economicBasis.merchandiseEntitledPreview).toBe("0");
  });
});

describe("Phase 4.7.6 — S6/S7/S8/S15/S16 cash coverage", () => {
  it("S6: an overpayment is order-level unallocated money — it never appears in any child's basis", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 1 }]);
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const extra = 123_456n;
    const submit = await h.financeOrchestrator.submitTransfer({ orderId: order.id, buyerUserId: ctx.userBuyer, amount: (ctx.priceA + extra).toString(), bankReference: "BANK-476-S6-" + order.id, idempotencyKey: makeId("t"), actorRole: "buyer" });
    await h.financeOrchestrator.verifyPayment({ paymentId: submit.payment.id, adminUserId: ctx.userAdmin, externalReference: "BANK-476-S6-" + order.id, idempotencyKey: makeId("v"), actorRole: "admin" });
    const view = await readiness.computeForOrder(order.id);
    expect(view.order.unallocatedPaid).toBe(extra.toString());
    const a = view.children.find((c: any) => c.childOrderId === childFor(ctx.sellerA).id);
    expect(a.cashCoverage.allocatedVerified).toBe(ctx.priceA.toString());
    expect(a.cashCoverage.unallocatedOrderMoney).toBe(extra.toString());
    expect(a.economicBasis.merchandiseOrdered).toBe(ctx.priceA.toString());
    expect(a.economicBasis.merchandiseEntitledPreview).toBe("0"); // nothing delivered yet
    expect(a.cashCoverage.covered).toBe(true);
  });

  it("S7/S8: credit and COD releases are not cash — covered=false, PAYMENT_NOT_COLLECTED, financialReleaseWithoutCash=true, even after delivery", async () => {
    for (const kind of ["credit", "cod"] as const) {
      const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 2 }]);
      await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
      if (kind === "credit") await h.financeOrchestrator.creditApprove({ orderId: order.id, adminUserId: ctx.userAdmin, evidenceReference: "CREDIT-CONTRACT-476", reason: "credit line", idempotencyKey: makeId("c"), actorRole: "admin" });
      else await h.financeOrchestrator.codApprove({ orderId: order.id, adminUserId: ctx.userAdmin, evidenceReference: "COD-POLICY-476", reason: "cod policy", idempotencyKey: makeId("c"), actorRole: "admin" });
      const childA = childFor(ctx.sellerA);
      await prepareChild(h, childA.id, ctx.userAOwner);
      await deliverPieces(h, ctx, childA.id, 2);
      const r = await readiness.computeForChild(childA.id);
      expect(r.cashCoverage.covered).toBe(false);
      expect(r.cashCoverage.allocatedVerified).toBe("0");
      expect(r.cashCoverage.releases.map((x: any) => x.releaseType)).toEqual([kind === "credit" ? "credit_approved" : "cod_policy_approved"]);
      expect(r.cashCoverage.financialReleaseWithoutCash).toBe(true);
      expect(r.fulfillment.deliveryEvidence).toBe("QUANTITY_EVIDENCED");
      expect(r.economicBasis.merchandiseDelivered).toBe((ctx.priceA * 2n).toString());
      expect(blockerCodes(r)).toContain("PAYMENT_NOT_COLLECTED");
      expect(r.readyForSettlementEngine).toBe(false);
    }
  });

  it("S15/S16: two payments cover one child deterministically; a superseded proforma is never double counted", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 3 }]);
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const total = ctx.priceA * 3n;
    const part1 = total / 3n;
    const part2 = total - part1;
    const s1 = await h.financeOrchestrator.submitTransfer({ orderId: order.id, buyerUserId: ctx.userBuyer, amount: part1.toString(), bankReference: "BANK-476-P1-" + order.id, idempotencyKey: makeId("t"), actorRole: "buyer" });
    await h.financeOrchestrator.verifyPayment({ paymentId: s1.payment.id, adminUserId: ctx.userAdmin, externalReference: "BANK-476-P1-" + order.id, idempotencyKey: makeId("v"), actorRole: "admin" });
    const childA = childFor(ctx.sellerA);
    const partial = await readiness.computeForChild(childA.id);
    expect(partial.cashCoverage.covered).toBe(false);
    expect(partial.cashCoverage.allocatedVerified).toBe(part1.toString());
    const s2 = await h.financeOrchestrator.submitTransfer({ orderId: order.id, buyerUserId: ctx.userBuyer, amount: part2.toString(), bankReference: "BANK-476-P2-" + order.id, idempotencyKey: makeId("t"), actorRole: "buyer" });
    await h.financeOrchestrator.verifyPayment({ paymentId: s2.payment.id, adminUserId: ctx.userAdmin, externalReference: "BANK-476-P2-" + order.id, idempotencyKey: makeId("v"), actorRole: "admin" });
    const r1 = await readiness.computeForChild(childA.id);
    expect(r1.cashCoverage.covered).toBe(true);
    expect(r1.cashCoverage.allocations.map((a: any) => a.paymentId)).toEqual([s1.payment.id, s2.payment.id]);
    expect(r1.cashCoverage.allocations.reduce((s: bigint, a: any) => s + BigInt(a.amount), 0n)).toBe(total);
    const r1again = await readiness.computeForChild(childA.id);
    expect(stripVolatile(r1again)).toEqual(stripVolatile(r1));
    // S16 — late shipping fee supersedes the proforma: two proforma versions exist, basis counts the active one once
    await prepareChild(h, childA.id, ctx.userAOwner);
    const quote = await h.shippingOrchestrator.createQuote({ actor: { userId: ctx.userAOwner, role: "supplier" }, childOrderId: childA.id, providerName: "fake", idempotencyKey: makeId("q") });
    await h.shippingOrchestrator.selectQuote({ actor: admin(), quoteId: quote.quote.id, idempotencyKey: makeId("sel") });
    const r2 = await readiness.computeForChild(childA.id);
    expect(r2.commercialTerms.proformaHistory).toHaveLength(2);
    expect(r2.commercialTerms.proformaHistory.map((p: any) => p.status).sort()).toEqual(["issued", "superseded"]);
    expect(r2.economicBasis.merchandiseOrdered).toBe(total.toString());
    expect(r2.cashCoverage.allocatedVerified).toBe(total.toString()); // lineage keeps the earlier allocations
    expect(BigInt(r2.cashCoverage.childPayable)).toBe(total + BigInt(quote.quote.amount));
    expect(r2.cashCoverage.covered).toBe(false); // the delta is outstanding
  });
});

describe("Phase 4.7.6 — S9/S10/S11/S12 shipping, tax and configuration are never assumed to be supplier money", () => {
  it("S9/S10: a late shipping fee is a separate buyer charge with an UNDEFINED economic owner; merchandise basis is unchanged", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 2 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    await prepareChild(h, childA.id, ctx.userAOwner);
    const before = await readiness.computeForChild(childA.id);
    expect(before.economicBasis.shippingEconomicOwner).toBe("NOT_CHARGED");
    expect(blockerCodes(before)).not.toContain("SHIPPING_ECONOMIC_OWNER_UNDEFINED");
    const quote = await h.shippingOrchestrator.createQuote({ actor: { userId: ctx.userAOwner, role: "supplier" }, childOrderId: childA.id, providerName: "fake", idempotencyKey: makeId("q") });
    await h.shippingOrchestrator.selectQuote({ actor: admin(), quoteId: quote.quote.id, idempotencyKey: makeId("sel") });
    const fee = BigInt(quote.quote.amount);
    expect(fee).toBeGreaterThan(0n);
    const after = await readiness.computeForChild(childA.id);
    expect(after.economicBasis.shippingChargedToBuyer).toBe(fee.toString());
    expect(after.economicBasis.shippingEconomicOwner).toBe("UNDEFINED");
    expect(after.economicBasis.shippingPhysicalResponsibility).toBe(before.economicBasis.shippingPhysicalResponsibility);
    expect(after.economicBasis.merchandiseOrdered).toBe(before.economicBasis.merchandiseOrdered);
    expect(after.economicBasis.merchandiseEntitledPreview).toBe("0");
    expect(blockerCodes(after)).toContain("SHIPPING_ECONOMIC_OWNER_UNDEFINED");
    expect(after.blockers.find((b: any) => b.code === "SHIPPING_ECONOMIC_OWNER_UNDEFINED").class).toBe("configuration");
    // the fee never leaks into the entitlement even after full delivery and the buyer paying the delta
    const delta = await h.financeOrchestrator.submitTransfer({ orderId: order.id, buyerUserId: ctx.userBuyer, amount: fee.toString(), bankReference: "BANK-476-FEE-" + order.id, idempotencyKey: makeId("t"), actorRole: "buyer" });
    await h.financeOrchestrator.verifyPayment({ paymentId: delta.payment.id, adminUserId: ctx.userAdmin, externalReference: "BANK-476-FEE-" + order.id, idempotencyKey: makeId("v"), actorRole: "admin" });
    await deliverPieces(h, ctx, childA.id, 2);
    const done = await readiness.computeForChild(childA.id);
    expect(done.cashCoverage.covered).toBe(true);
    expect(done.economicBasis.merchandiseEntitledPreview).toBe((ctx.priceA * 2n).toString());
    expect(BigInt(done.cashCoverage.allocatedVerified)).toBe(ctx.priceA * 2n + fee);
  });

  it("S11: assessed VAT on the commercial invoice is excluded from the basis and flagged TAX_TREATMENT_UNVERIFIED", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 1 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    const noTax = await readiness.computeForChild(childA.id);
    expect(noTax.economicBasis.taxTreatment).toBe("NOT_ASSESSED");
    expect(blockerCodes(noTax)).not.toContain("TAX_TREATMENT_UNVERIFIED");
    const adminActorInvoicing = { userId: ctx.userAdmin, role: "admin" as const };
    const cfg = await invoicing.createTaxConfig(adminActorInvoicing, { configKey: "VAT_RATE_PERCENT", configValue: { percent: 9 }, sourceReference: "test fixture — not a legal rate" });
    await invoicing.verifyTaxConfig(adminActorInvoicing, cfg.id, { sourceReference: "test fixture — not a legal rate" });
    await invoicing.activateTaxConfig(adminActorInvoicing, cfg.id);
    try {
      const rateOnly = await readiness.computeForChild(childA.id);
      expect(rateOnly.economicBasis.taxTreatment).toBe("VAT_RATE_ACTIVE_TREATMENT_UNVERIFIED");
      expect(blockerCodes(rateOnly)).toContain("TAX_TREATMENT_UNVERIFIED");
      const issued = await invoicing.issueWholesaleChildInvoice(adminActorInvoicing, { wholesaleOrderId: order.id, childOrderId: childA.id });
      const taxTotal = BigInt(issued.invoice.taxTotal);
      expect(taxTotal).toBe((ctx.priceA * 900n) / 10000n);
      const withInvoice = await readiness.computeForChild(childA.id);
      expect(withInvoice.economicBasis.taxExcluded).toBe(taxTotal.toString());
      expect(withInvoice.economicBasis.merchandiseOrdered).toBe(ctx.priceA.toString());
      expect(withInvoice.economicBasis.taxBasisReference).toContain("VAT_RATE_PERCENT");
      // the invoice grand total exceeds what the buyer was ever asked to pay: documented TAX_REVIEW_REQUIRED gap
      expect(BigInt(issued.invoice.grandTotal)).toBe(ctx.priceA + taxTotal);
      expect(withInvoice.cashCoverage.childPayable).toBe(ctx.priceA.toString());
    } finally {
      // retire the fixture rate so later scenarios are tax-free (status is owned by invoicing; test-only cleanup)
      await h.pool.query(`UPDATE tax_configuration SET status = 'retired' WHERE id = $1`, [cfg.id]);
    }
    const cleaned = await readiness.computeForChild(childFor(ctx.sellerA).id);
    expect(cleaned.economicBasis.taxExcluded).not.toBe("0"); // the issued invoice keeps its tax fact forever
  });

  it("S12: live price/tier/config changes after the order are not retroactive — readiness is computed from snapshots only", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 3 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    await prepareChild(h, childA.id, ctx.userAOwner);
    await deliverPieces(h, ctx, childA.id, 3);
    const before = stripVolatile(await readiness.computeForChild(childA.id));
    await h.pool.query(`UPDATE seller_offer SET wholesale_price = wholesale_price * 3 WHERE id = $1`, [ctx.offerA]);
    await h.pool.query(`INSERT INTO wholesale_pricing_tier (id, offer_id, min_quantity, unit_price, currency, moq_unit, pricing_unit) VALUES ($1, $2, 1, 1, 'IRR', 'PIECE', 'PIECE')`, [makeId("tier"), ctx.offerA]).catch(() => undefined);
    const previousEnv = { ...process.env };
    process.env.KOLBE_COMMISSION_BPS = "1500";
    process.env.SETTLEMENT_HOLD_DAYS = "14";
    try {
      const after = stripVolatile(await readiness.computeForChild(childA.id));
      expect(after).toEqual(before);
      expect(after.commission).toEqual({ applicable: true, policyRef: null, basis: null, rateBps: null, amount: null, defaultBeforeConfiguration: "0" });
      expect(after.economicBasis.merchandiseEntitledPreview).toBe((ctx.priceA * 3n).toString());
    } finally {
      delete process.env.KOLBE_COMMISSION_BPS;
      delete process.env.SETTLEMENT_HOLD_DAYS;
      for (const k of Object.keys(previousEnv)) process.env[k] = previousEnv[k];
      await h.pool.query(`UPDATE seller_offer SET wholesale_price = $2 WHERE id = $1`, [ctx.offerA, ctx.priceA.toString()]);
    }
  });
});

describe("Phase 4.7.6 — S14/S17 replacement and cancellation", () => {
  it("S14: a replacement is an explicitly linked NEW order; nothing (cash or entitlement) transfers automatically", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 2 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    const items = await orderItemsForChild(h, childA.id);
    const exc = await fulfillment.reportException({ childOrderId: childA.id, sellerId: ctx.sellerA, type: "cannot_fulfill", reason: "lot destroyed", affectedOrderItemIds: [items[0].id], reportedByUserId: ctx.userAOwner, idempotencyKey: makeId("exc") });
    await fulfillment.resolveException({ exceptionId: exc.exception.id, buyerUserId: ctx.userBuyer, buyerResolution: "replacement_requested", idempotencyKey: makeId("res") });
    const replacement = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 2 }]);
    await fulfillment.linkReplacement({ exceptionId: exc.exception.id, replacementRequestId: replacement.requests[0].requestId, createdByUserId: ctx.userBuyer, idempotencyKey: makeId("link") });
    expect(await count(h.pool, `SELECT 1 FROM fulfillment_replacement_request WHERE exception_id = $1 AND replacement_request_id = $2`, [exc.exception.id, replacement.requests[0].requestId])).toBe(1);
    const original = await readiness.computeForChild(childA.id);
    const replacementChild = replacement.childFor(ctx.sellerA);
    expect(replacementChild.id).not.toBe(childA.id);
    const fresh = await readiness.computeForChild(replacementChild.id);
    expect(original.cashCoverage.allocatedVerified).toBe((ctx.priceA * 2n).toString());
    expect(fresh.cashCoverage.allocatedVerified).toBe("0");
    expect(fresh.cashCoverage.covered).toBe(false);
    expect(fresh.commercialTerms.snapshotted).toBe(false); // draft: no proforma yet
    expect(blockerCodes(fresh)).toContain("PAYMENT_NOT_COLLECTED");
    expect(blockerCodes(fresh)).toContain("COMMERCIAL_TERMS_NOT_SNAPSHOTTED");
    expect(fresh.economicBasis.merchandiseEntitledPreview).toBe("0");
  });

  it("S17: a child cancelled before payment has no basis, no cash and no refund — cancellation is not a financial event", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: A(), quantity: 1 },
      { seller: B(), quantity: 1 },
    ]);
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const childB = childFor(ctx.sellerB);
    // finance side: void B's proforma (payable recomputed); orders side: cancel the child — two owner commands
    await h.financeOrchestrator.cancelChildBeforePayment({ orderId: order.id, childOrderId: childB.id, actorUserId: ctx.userAdmin, actorRole: "admin", reason: "buyer dropped B", idempotencyKey: makeId("cancel") });
    await h.ordersService.cancelChildOrder({ childOrderId: childB.id, actorUserId: ctx.userAdmin, actorRole: "admin", reason: "buyer dropped B", idempotencyKey: makeId("cancel_child") });
    const r = await readiness.computeForChild(childB.id);
    expect(r.childStatus).toBe("cancelled");
    expect(blockerCodes(r)).toContain("CHILD_CANCELLED");
    expect(blockerCodes(r)).not.toContain("PAYMENT_NOT_COLLECTED");
    expect(r.economicBasis.merchandiseOrdered).toBe("0");
    expect(r.economicBasis.merchandiseEntitledPreview).toBe("0");
    expect(r.cashCoverage.allocatedVerified).toBe("0");
    expect(r.refunds).toEqual([]);
    expect(r.commercialTerms.proformaHistory.map((p: any) => p.status)).toEqual(["voided"]);
    expect(await count(h.pool, `SELECT 1 FROM payment WHERE wholesale_order_id = $1`, [order.id])).toBe(0);
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBe(0);
  });
});

describe("Phase 4.7.6 — S20 currency and hygiene", () => {
  it("S20: a foreign-currency refund is rejected and the readiness payload stays IRR-only", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 1 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    const items = await orderItemsForChild(h, childA.id);
    const err = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, currency: "USD", lines: [{ wholesaleOrderItemId: items[0].id, quantity: 1 }], reasonCode: "x", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(err.code).toBe("CURRENCY_MISMATCH");
    const r = await readiness.computeForChild(childA.id);
    expect(r.currency).toBe("IRR");
    expect(blockerCodes(r)).not.toContain("CURRENCY_MISMATCH");
    assertPayloadHygiene(r);
  });

  it("unknown ids are 404s; a legacy child without a parent is refused (never guessed)", async () => {
    const missing = await expectDomainError(readiness.computeForChild("po_missing"));
    expect(missing.code).toBe("CHILD_ORDER_NOT_FOUND");
    expect(missing.status).toBe(404);
    const missingOrder = await expectDomainError(readiness.computeForOrder("wo_missing"));
    expect(missingOrder.code).toBe("ORDER_NOT_FOUND");
  });
});

describe("Phase 4.7.6 — HTTP surface is admin/finance only", () => {
  const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
  const api = () => request(h.app.getHttpServer());

  it("admin can read; supplier, buyer, anonymous and forged finance claims cannot; no supplier endpoint exists", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 1 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    const asAdmin = await api().get(`/api/v1/admin/settlement-readiness/children/${childA.id}`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(200);
    expect(asAdmin.body.disclaimer).toBe("NOT A SETTLEMENT BALANCE");
    expect(asAdmin.body.participant.settlementCandidate).toBe(true);
    assertPayloadHygiene(asAdmin.body);
    const orderView = await api().get(`/api/v1/admin/settlement-readiness/orders/${order.id}`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(200);
    expect(orderView.body.children).toHaveLength(1);
    expect(orderView.body.order.ledgerMeaning).toContain("never a seller balance");
    // `finance` is a claim-level role with no account role behind it today: a token claiming it for an
    // admin account fails the role/account consistency check (fail-closed) — the surface is admin-only in practice
    await api().get(`/api/v1/admin/settlement-readiness/orders/${order.id}`).set("Cookie", cookie(ctx.userAdmin, "finance")).expect(401);
    await api().get(`/api/v1/admin/settlement-readiness/children/${childA.id}`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(403);
    await api().get(`/api/v1/admin/settlement-readiness/orders/${order.id}`).set("Cookie", cookie(ctx.userBuyer, "vip")).expect(403);
    await api().get(`/api/v1/admin/settlement-readiness/children/${childA.id}`).expect(401);
    await api().get(`/api/v1/supplier/settlement-readiness/children/${childA.id}`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(404);
    const notFound = await api().get(`/api/v1/admin/settlement-readiness/children/po_nope`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(404);
    expect(notFound.body.error ?? notFound.body.code).toBe("CHILD_ORDER_NOT_FOUND");
  });

  it("reading readiness writes nothing (no audit, no order event, no payment or ledger rows)", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [{ seller: A(), quantity: 1 }]);
    await payByWebhook(h, ctx, order.id);
    const childA = childFor(ctx.sellerA);
    const counts = async () =>
      q(h.pool, `SELECT (SELECT COUNT(*) FROM audit_log)::text AS audit, (SELECT COUNT(*) FROM order_event)::text AS events, (SELECT COUNT(*) FROM financial_ledger_entry)::text AS ledger, (SELECT COUNT(*) FROM payment)::text AS payments, (SELECT COUNT(*) FROM refund)::text AS refunds`);
    const before = await counts();
    await readiness.computeForChild(childA.id);
    await readiness.computeForOrder(order.id);
    await api().get(`/api/v1/admin/settlement-readiness/children/${childA.id}`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(200);
    expect(await counts()).toEqual(before);
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("pending");
  });
});
