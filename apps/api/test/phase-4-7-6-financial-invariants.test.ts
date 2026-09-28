/**
 * Phase 4.7.6 — Financial invariants (real PostgreSQL, canonical service flows).
 *
 * Each `it` maps to an invariant in docs/architecture/financial-invariants.md (FI-n). These are
 * behaviour tests: orders are created, confirmed, paid, shipped, delivered and refunded through the
 * real services, and the invariant is then asserted against the database rows.
 *
 * Nothing here implements wallets, settlement, withdrawals or payouts (Phase 4.8 has NOT started).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminActor,
  bootHarness,
  confirmToAwaitingPayment,
  count,
  createOrder,
  createReadyShipment,
  expectDomainError,
  makeId,
  one,
  orderItemsForChild,
  paidOrder,
  preparingOrder,
  q,
  seedTwoSuppliers,
  supplierA,
  supplierB,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_4_7_6_invariants_test";

let h: Harness;
let ctx: SupplierContext;
let fulfillment: any;

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 200 });
  const { FulfillmentService } = await import("../src/modules/fulfillment/fulfillment.service");
  fulfillment = h.app.get(FulfillmentService);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

const admin = () => adminActor(ctx);

async function deliverAll(childOrderId: string, actor = supplierA(ctx)) {
  const items = await orderItemsForChild(h, childOrderId);
  const s = await createReadyShipment(h, ctx, { childOrderId, actor, items: items.map((i: any) => ({ wholesaleOrderItemId: i.id, pieceQuantity: Number(i.piece_quantity) })) });
  await h.shippingOrchestrator.handoff({ actor, shipmentId: s.shipment.id, idempotencyKey: makeId("h") });
  await h.shippingOrchestrator.markDelivered({ actor: admin(), shipmentId: s.shipment.id, idempotencyKey: makeId("d") });
  return s.shipment.id;
}

describe("Phase 4.7.6 — FI-1 seller identity is server-side and DB-enforced", () => {
  it("Kolbe first-party is a DB-enforced singleton with NULL supplier_id; supplier sellers must carry a supplier_id", async () => {
    const kolbeWithSupplier = await expectDomainError(h.pool.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ($1, 'KOLBE', $2, 'Bad Kolbe', 'active')`, [makeId("kolbe_bad"), ctx.supA]));
    expect(String(kolbeWithSupplier.code)).toBe("23514");
    const supplierWithoutSupplier = await expectDomainError(h.pool.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ($1, 'SUPPLIER', NULL, 'Bad Supplier', 'active')`, [makeId("sup_bad")]));
    expect(String(supplierWithoutSupplier.code)).toBe("23514");
    // the migrations seed exactly one Kolbe seller (`seller_kolbe`, 0005); a second one is impossible
    const kolbe = await q(h.pool, `SELECT id, supplier_id FROM seller WHERE type = 'KOLBE'`);
    expect(kolbe).toEqual([{ id: "seller_kolbe", supplier_id: null }]);
    const secondKolbe = await expectDomainError(h.pool.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ($1, 'KOLBE', NULL, 'Kolbe 2', 'active')`, [makeId("kolbe2")]));
    expect(String(secondKolbe.code)).toBe("23505");
  });

  it("a child order carries the seller identity of its items; purchase_order.supplier_id is the external-supplier signal", async () => {
    const { childA, childB } = await createOrder(h, ctx, { qtyA: 2, qtyB: 3 });
    const a = await one(h.pool, `SELECT seller_id, supplier_id FROM purchase_order WHERE id = $1`, [childA.id]);
    const b = await one(h.pool, `SELECT seller_id, supplier_id FROM purchase_order WHERE id = $1`, [childB.id]);
    expect(a).toEqual({ seller_id: ctx.sellerA, supplier_id: ctx.supA });
    expect(b).toEqual({ seller_id: ctx.sellerB, supplier_id: ctx.supB });
    // every wholesale_order_item of a child agrees with the child's seller (attribution chain intact)
    expect(await count(h.pool, `SELECT 1 FROM wholesale_order_item woi JOIN purchase_order_item poi ON poi.wholesale_order_item_id = woi.id JOIN purchase_order po ON po.id = poi.purchase_order_id WHERE po.id IN ($1,$2) AND woi.seller_id <> po.seller_id`, [childA.id, childB.id])).toBe(0);
  });
});

describe("Phase 4.7.6 — FI-3 proforma line basis (unit_price × quantity = line_total, in the pricing unit)", () => {
  it("issued proforma lines are exact for piece-priced lines and quantity is expressed in pieces", async () => {
    const { order, childA } = await createOrder(h, ctx, { qtyA: 7 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const lines = await q(h.pool, `SELECT pl.quantity, pl.pricing_unit, pl.unit_price::text AS unit_price, pl.line_total::text AS line_total, woi.piece_quantity FROM wholesale_proforma_line pl JOIN wholesale_proforma wp ON wp.id = pl.proforma_id JOIN wholesale_order_item woi ON woi.id = pl.wholesale_order_item_id WHERE wp.child_order_id = $1 AND wp.status = 'issued'`, [childA.id]);
    expect(lines).toHaveLength(1);
    expect(lines[0].pricing_unit).toBe("PIECE");
    expect(lines[0].quantity).toBe(7);
    expect(lines[0].quantity).toBe(lines[0].piece_quantity);
    expect(BigInt(lines[0].unit_price) * BigInt(lines[0].quantity)).toBe(BigInt(lines[0].line_total));
  });

  it("a package-sold but piece-priced line snapshots its proforma quantity in PIECES (regression: refund basis would otherwise be one piece per package)", async () => {
    const { order, childA } = await createOrder(h, ctx, { qtyA: 5 });
    // Simulate the accepted-terms shape that `resolvePrice` can produce: selector = 1 package of 5 pieces,
    // pricing tier is per piece ⇒ quantity 1 (package), piece_quantity 5, unit_price per piece, line_total 5 × price.
    await h.pool.query(`UPDATE wholesale_order_item SET quantity = 1, package_quantity = 1, piece_quantity = 5 WHERE order_id = $1`, [order.id]);
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const line = await one(h.pool, `SELECT pl.quantity, pl.unit_price::text AS unit_price, pl.line_total::text AS line_total FROM wholesale_proforma_line pl JOIN wholesale_proforma wp ON wp.id = pl.proforma_id WHERE wp.child_order_id = $1 AND wp.status = 'issued'`, [childA.id]);
    expect(line.quantity).toBe(5);
    expect(BigInt(line.unit_price) * 5n).toBe(BigInt(line.line_total));
    expect(BigInt(line.line_total)).toBe(ctx.priceA * 5n);
  });

  it("issuance fails closed when a snapshot line is internally inconsistent (PROFORMA_LINE_BASIS_INCONSISTENT, 422)", async () => {
    const { order, childA } = await createOrder(h, ctx, { qtyA: 3 });
    const items = await orderItemsForChild(h, childA.id);
    const inconsistentSnapshot = {
      orderId: order.id,
      orderCode: order.orderCode || order.order_code,
      currency: "IRR",
      paymentMode: "transfer",
      buyerUserId: ctx.userBuyer,
      version: 1,
      status: "confirmed",
      grandTotal: (ctx.priceA * 3n).toString(),
      children: [
        {
          childOrderId: childA.id,
          childOrderCode: childA.orderCode || childA.order_code,
          sellerId: ctx.sellerA,
          supplierId: ctx.supA,
          currency: "IRR",
          items: [{ wholesaleOrderItemId: items[0].id, purchaseOrderItemId: "poi_x", descriptionSnapshot: "x", skuSnapshot: "x", quantity: 1, pricingUnit: "PIECE", unitPrice: ctx.priceA.toString(), lineTotal: (ctx.priceA * 3n).toString() }],
        },
      ],
    };
    const err = await expectDomainError(h.db.transaction(async (tx: any) => h.paymentsService.issueProformasFromSnapshot(inconsistentSnapshot, tx)));
    expect(err.code).toBe("PROFORMA_LINE_BASIS_INCONSISTENT");
    expect(err.status ?? err.statusCode).toBe(422);
    expect(await count(h.pool, `SELECT 1 FROM wholesale_proforma WHERE child_order_id = $1`, [childA.id])).toBe(0);
  });
});

describe("Phase 4.7.6 — FI-4/FI-5 cash is order-level; seller attribution only through allocations; ledger has no seller dimension", () => {
  it("Σ verified allocations per child ≤ child payable; ledger IN is order-level (child NULL); IN − OUT = verified − completed refunds", async () => {
    const { order, childA, childB, paymentId } = await paidOrder(h, ctx, { qtyA: 2, qtyB: 1 });
    const payable = await q(h.pool, `SELECT child_order_id, total_amount::text AS total FROM wholesale_proforma WHERE wholesale_order_id = $1 AND status = 'issued'`, [order.id]);
    const allocated = await q(h.pool, `SELECT wp.child_order_id, SUM(pa.amount)::text AS sum FROM payment_allocation pa JOIN wholesale_proforma wp ON wp.id = pa.proforma_id JOIN payment p ON p.id = pa.payment_id WHERE p.wholesale_order_id = $1 AND p.status = 'verified' AND pa.status = 'active' GROUP BY wp.child_order_id`, [order.id]);
    for (const child of [childA, childB]) {
      const pay = BigInt(payable.find((r) => r.child_order_id === child.id)!.total);
      const alloc = BigInt(allocated.find((r) => r.child_order_id === child.id)!.sum);
      expect(alloc).toBe(pay);
    }
    expect(BigInt(allocated.find((r) => r.child_order_id === childA.id)!.sum)).toBe(ctx.priceA * 2n);
    expect(BigInt(allocated.find((r) => r.child_order_id === childB.id)!.sum)).toBe(ctx.priceB);
    const ledger = await q(h.pool, `SELECT direction, child_order_id, amount::text AS amount, entry_type FROM financial_ledger_entry WHERE order_id = $1`, [order.id]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ direction: "IN", child_order_id: null, entry_type: "payment_verified", amount: (ctx.priceA * 2n + ctx.priceB).toString() });
    const pay = await one(h.pool, `SELECT amount::text AS amount FROM payment WHERE id = $1`, [paymentId]);
    expect(pay.amount).toBe(ledger[0].amount);
  });
});

describe("Phase 4.7.6 — FI-9 refunds leave through the exact slice; order-scoped refunds only return unallocated money", () => {
  it("an order-scoped refund on fully-allocated money is rejected (REFUND_SCOPE_REQUIRED, 409) — allocated money is seller-attributable", async () => {
    const { order } = await paidOrder(h, ctx, { qtyA: 1, qtyB: 1 });
    const err = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, amount: "1", reasonCode: "goodwill", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(err.code).toBe("REFUND_SCOPE_REQUIRED");
    expect(err.status ?? err.statusCode).toBe(409);
    expect(await count(h.pool, `SELECT 1 FROM refund WHERE wholesale_order_id = $1`, [order.id])).toBe(0);
  });

  it("an overpayment stays unallocated (never seller money) and is the ONLY thing an order-scoped refund may return", async () => {
    const { order, childA } = await createOrder(h, ctx, { qtyA: 2 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const payable = ctx.priceA * 2n;
    const extra = 150_000n;
    const submit = await h.financeOrchestrator.submitTransfer({ orderId: order.id, buyerUserId: ctx.userBuyer, amount: (payable + extra).toString(), bankReference: "BANK-476-OVER-" + order.id, idempotencyKey: makeId("t"), actorRole: "buyer" });
    await h.financeOrchestrator.verifyPayment({ paymentId: submit.payment.id, adminUserId: ctx.userAdmin, externalReference: "BANK-476-OVER-" + order.id, idempotencyKey: makeId("v"), actorRole: "admin" });
    const allocated = await one(h.pool, `SELECT COALESCE(SUM(amount),0)::text AS sum FROM payment_allocation WHERE payment_id = $1 AND status = 'active'`, [submit.payment.id]);
    expect(BigInt(allocated.sum)).toBe(payable);
    const summary = await h.paymentsService.getOrderFinancialSummary(order.id);
    expect(summary.unallocatedPaid).toBe(extra.toString());
    // too much ⇒ rejected; exactly the unallocated part ⇒ accepted; child A's allocation is untouched
    const tooMuch = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, amount: (extra + 1n).toString(), reasonCode: "overpayment", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(tooMuch.code).toBe("REFUND_SCOPE_REQUIRED");
    const ok = await h.financeOrchestrator.createRefund({ orderId: order.id, amount: extra.toString(), reasonCode: "overpayment", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") });
    expect(ok.refund.childOrderId ?? ok.refund.child_order_id ?? null).toBeNull();
    expect(BigInt(ok.refund.amount)).toBe(extra);
    const again = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, amount: "1", reasonCode: "overpayment", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(again.code).toBe("REFUND_SCOPE_REQUIRED");
    const childAlloc = await one(h.pool, `SELECT COALESCE(SUM(pa.amount),0)::text AS sum FROM payment_allocation pa JOIN wholesale_proforma wp ON wp.id = pa.proforma_id WHERE wp.child_order_id = $1 AND pa.status = 'active'`, [childA.id]);
    expect(BigInt(childAlloc.sum)).toBe(payable);
    // the child-scoped ceiling is still the full allocation: the overpayment refund did not consume it
    const childRefund = await h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, amount: payable.toString(), reasonCode: "cancel", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") });
    expect(BigInt(childRefund.refund.amount)).toBe(payable);
  });

  it("a refund line is capped by the ordered quantity of the exact item and priced from the immutable proforma line", async () => {
    const { order, childA } = await paidOrder(h, ctx, { qtyA: 4 });
    const items = await orderItemsForChild(h, childA.id);
    const over = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, lines: [{ wholesaleOrderItemId: items[0].id, quantity: 5 }], reasonCode: "x", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(over.code).toBe("REFUND_LINE_QUANTITY_EXCEEDED");
    const partial = await h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, lines: [{ wholesaleOrderItemId: items[0].id, quantity: 3 }], reasonCode: "x", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") });
    expect(BigInt(partial.refund.amount)).toBe(ctx.priceA * 3n);
    const rest = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, lines: [{ wholesaleOrderItemId: items[0].id, quantity: 2 }], reasonCode: "x", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(rest.code).toBe("REFUND_LINE_QUANTITY_EXCEEDED");
    const wrongAmount = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, amount: "1", lines: [{ wholesaleOrderItemId: items[0].id, quantity: 1 }], reasonCode: "x", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(wrongAmount.code).toBe("REFUND_LINE_BASIS_MISMATCH");
  });

  it("a refund may not cite a fulfillment exception of another child (REFUND_EXCEPTION_CHILD_MISMATCH, 409)", async () => {
    const { order, childA, childB } = await paidOrder(h, ctx, { qtyA: 2, qtyB: 2 });
    const itemsB = await orderItemsForChild(h, childB.id);
    const exc = await fulfillment.reportException({ childOrderId: childB.id, sellerId: ctx.sellerB, type: "partial_shortage", reason: "stock damaged", affectedOrderItemIds: [itemsB[0].id], reportedByUserId: ctx.userBOwner, idempotencyKey: makeId("exc") });
    const exceptionId = exc.exception?.id ?? exc.id;
    expect(exceptionId).toBeTruthy();
    const itemsA = await orderItemsForChild(h, childA.id);
    const crossChild = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, exceptionId, lines: [{ wholesaleOrderItemId: itemsA[0].id, quantity: 1 }], reasonCode: "shortage", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(crossChild.code).toBe("REFUND_EXCEPTION_CHILD_MISMATCH");
    expect(crossChild.status ?? crossChild.statusCode).toBe(409);
    const orderScoped = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, exceptionId, amount: "1", reasonCode: "shortage", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(orderScoped.code).toBe("REFUND_EXCEPTION_CHILD_MISMATCH");
    const missing = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childB.id, exceptionId: "fexc_missing", lines: [{ wholesaleOrderItemId: itemsB[0].id, quantity: 1 }], reasonCode: "shortage", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(missing.code).toBe("EXCEPTION_NOT_FOUND");
    const sameChild = await h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childB.id, exceptionId, lines: [{ wholesaleOrderItemId: itemsB[0].id, quantity: 1 }], reasonCode: "shortage", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") });
    expect(BigInt(sameChild.refund.amount)).toBe(ctx.priceB);
    expect(await count(h.pool, `SELECT 1 FROM refund WHERE wholesale_order_id = $1`, [order.id])).toBe(1);
  });

  it("currency is DB-constrained to IRR on every money table and a foreign-currency refund is rejected", async () => {
    const { order, childA, paymentId } = await paidOrder(h, ctx, { qtyA: 1 });
    for (const table of ["payment", "wholesale_proforma", "refund", "financial_ledger_entry", "payment_allocation", "refund_line", "wholesale_order", "purchase_order"]) {
      const err = await expectDomainError(h.pool.query(`UPDATE ${table} SET currency = 'USD' WHERE id IN (SELECT id FROM ${table} LIMIT 1)`));
      // 23514 = CHECK (currency IN ('IRR')); P0001 = the row is additionally immutable by trigger
      // (issued proforma financial fields, append-only ledger) — either way the mutation is impossible.
      expect(["23514", "P0001"], table).toContain(String(err.code));
    }
    const inserted = await expectDomainError(h.pool.query(`INSERT INTO refund_line (id, refund_id, wholesale_order_item_id, quantity, unit_price, line_total, currency) SELECT 'rl_usd', id, 'woi_x', 1, 1, 1, 'USD' FROM refund LIMIT 1`));
    expect(["23514", "23503"]).toContain(String(inserted.code));
    const items = await orderItemsForChild(h, childA.id);
    const usd = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, currency: "USD", lines: [{ wholesaleOrderItemId: items[0].id, quantity: 1 }], reasonCode: "x", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(usd.code).toBe("CURRENCY_MISMATCH");
    expect((await one(h.pool, `SELECT currency FROM payment WHERE id = $1`, [paymentId])).currency).toBe("IRR");
  });
});

describe("Phase 4.7.6 — FI-6/FI-7 delivery is quantity-evidenced, idempotent and per item", () => {
  it("delivered pieces are reconstructible per wholesale_order_item from shipment_item; replaying delivery never duplicates", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 10 });
    const items = await orderItemsForChild(h, childA.id);
    const s1 = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 4 }] });
    await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s1.shipment.id, idempotencyKey: makeId("h") });
    const first = await h.shippingOrchestrator.markDelivered({ actor: admin(), shipmentId: s1.shipment.id, idempotencyKey: makeId("d") });
    expect(first.fullyDelivered).toBe(false);
    const replay = await h.shippingOrchestrator.markDelivered({ actor: admin(), shipmentId: s1.shipment.id, idempotencyKey: makeId("d2") });
    expect(replay.replayed).toBe(true);
    const concurrent = await Promise.all([1, 2, 3, 4, 5].map(() => h.shippingOrchestrator.markDelivered({ actor: admin(), shipmentId: s1.shipment.id, idempotencyKey: makeId("dc") })));
    expect(concurrent.every((r) => r.replayed === true)).toBe(true);
    const delivered = await h.shippingService.getAllocatedQuantitiesForChild(childA.id, h.db, ["delivered"]);
    expect(delivered.get(items[0].id)).toBe(4);
    expect(await count(h.pool, `SELECT 1 FROM shipment_item si JOIN shipment s ON s.id = si.shipment_id WHERE s.child_order_id = $1 AND s.status = 'delivered'`, [childA.id])).toBe(1);
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).not.toBe("delivered");
    // the remaining 6 pieces complete the child; total evidence = 10, exactly once per shipment
    const s2 = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 6 }] });
    await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s2.shipment.id, idempotencyKey: makeId("h") });
    const second = await h.shippingOrchestrator.markDelivered({ actor: admin(), shipmentId: s2.shipment.id, idempotencyKey: makeId("d") });
    expect(second.fullyDelivered).toBe(true);
    expect((await h.shippingService.getAllocatedQuantitiesForChild(childA.id, h.db, ["delivered"])).get(items[0].id)).toBe(10);
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("delivered");
    expect(await count(h.pool, `SELECT 1 FROM order_status_history WHERE child_order_id = $1 AND to_status = 'delivered'`, [childA.id])).toBe(1);
  });

  it("a shipment cannot allocate more pieces than ordered (attribution can never exceed the line)", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 3 });
    const items = await orderItemsForChild(h, childA.id);
    const over = await expectDomainError(createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 4 }] }));
    expect(over.code).toBe("SHIPMENT_QUANTITY_EXCEEDED");
    expect(await count(h.pool, `SELECT 1 FROM shipment WHERE child_order_id = $1`, [childA.id])).toBe(0);
  });

  it("status-only delivery (supplier self-mark) leaves NO shipment quantity evidence — it is distinguishable in history", async () => {
    const { childA } = await preparingOrder(h, ctx, { qtyA: 2 });
    const items = await orderItemsForChild(h, childA.id);
    const s = await createReadyShipment(h, ctx, { childOrderId: childA.id, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: 2 }] });
    await h.shippingOrchestrator.handoff({ actor: supplierA(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("h") });
    await h.ordersService.deliverChildOrder({ childOrderId: childA.id, actorUserId: ctx.userAOwner, actorRole: "supplier", idempotencyKey: makeId("deliver") });
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status).toBe("delivered");
    expect((await h.shippingService.getAllocatedQuantitiesForChild(childA.id, h.db, ["delivered"])).get(items[0].id) ?? 0).toBe(0);
    const history = await one(h.pool, `SELECT actor_role, metadata FROM order_status_history WHERE child_order_id = $1 AND to_status = 'delivered'`, [childA.id]);
    expect(history.actor_role).toBe("supplier");
    expect(history.metadata.trigger).toBe("orders.child_deliver");
    expect(history.metadata.shipmentId).toBeNull();
  });
});

describe("Phase 4.7.6 — FI-8 financial release ≠ cash", () => {
  it("credit / cod releases create no payment, no allocation and no ledger entry", async () => {
    const { order } = await createOrder(h, ctx, { qtyA: 1 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    await h.financeOrchestrator.creditApprove({ orderId: order.id, adminUserId: ctx.userAdmin, evidenceReference: "CREDIT-CONTRACT-476", reason: "credit line", idempotencyKey: makeId("c"), actorRole: "admin" });
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("processing");
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1 AND release_type = 'credit_approved'`, [order.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM payment WHERE wholesale_order_id = $1`, [order.id])).toBe(0);
    expect(await count(h.pool, `SELECT 1 FROM payment_allocation pa JOIN wholesale_proforma wp ON wp.id = pa.proforma_id WHERE wp.wholesale_order_id = $1`, [order.id])).toBe(0);
    expect(await count(h.pool, `SELECT 1 FROM financial_ledger_entry WHERE order_id = $1`, [order.id])).toBe(0);
    const summary = await h.paymentsService.getOrderFinancialSummary(order.id);
    expect(summary.verifiedPaid ?? summary.totalVerified ?? "0").toBe("0");
    // a refund against a credit-released order is impossible: nothing was collected
    const err = await expectDomainError(h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: (await one(h.pool, `SELECT id FROM purchase_order WHERE wholesale_order_id = $1`, [order.id])).id, amount: "1", reasonCode: "x", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") }));
    expect(err.code).toBe("REFUND_EXCEEDS_ALLOCATED");
  });
});

describe("Phase 4.7.6 — FI-11 sibling isolation", () => {
  it("delivering and refunding child B changes nothing in child A's allocations, refunds or delivery evidence", async () => {
    const { order, childA, childB } = await preparingOrder(h, ctx, { qtyA: 3, qtyB: 2 });
    const snapshotA = async () => ({
      alloc: (await one(h.pool, `SELECT COALESCE(SUM(pa.amount),0)::text AS sum FROM payment_allocation pa JOIN wholesale_proforma wp ON wp.id = pa.proforma_id WHERE wp.child_order_id = $1 AND pa.status = 'active'`, [childA.id])).sum,
      refunds: await count(h.pool, `SELECT 1 FROM refund WHERE child_order_id = $1`, [childA.id]),
      delivered: [...(await h.shippingService.getAllocatedQuantitiesForChild(childA.id, h.db, ["delivered"])).entries()],
      status: (await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childA.id])).status,
    });
    const before = await snapshotA();
    await deliverAll(childB.id, supplierB(ctx));
    const itemsB = await orderItemsForChild(h, childB.id);
    const refund = await h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childB.id, lines: [{ wholesaleOrderItemId: itemsB[0].id, quantity: 1 }], reasonCode: "damaged", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("r") });
    await h.financeOrchestrator.approveRefund({ refundId: refund.refund.id, adminUserId: ctx.userAdmin, idempotencyKey: makeId("a"), actorRole: "admin" });
    await h.financeOrchestrator.completeRefund({ refundId: refund.refund.id, adminUserId: ctx.userAdmin, externalReference: "BANK-RF-476-" + refund.refund.id, idempotencyKey: makeId("c"), actorRole: "admin" });
    expect(await snapshotA()).toEqual(before);
    const out = await one(h.pool, `SELECT child_order_id, amount::text AS amount FROM financial_ledger_entry WHERE order_id = $1 AND direction = 'OUT'`, [order.id]);
    expect(out.child_order_id).toBe(childB.id);
    expect(BigInt(out.amount)).toBe(ctx.priceB);
    expect((await one(h.pool, `SELECT status FROM purchase_order WHERE id = $1`, [childB.id])).status).toBe("delivered");
    expect(before.status).toBe("preparing");
  });
});
