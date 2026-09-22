import path from "node:path";
import { execFileSync } from "node:child_process";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../packages/database/src/schema/tables";
import { OffersService } from "../src/modules/offers/offers.service";
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";
import { PaymentsService } from "../src/modules/payments/payments.service";
import { PromotionService } from "../src/modules/promotions/promotion.service";

/**
 * Phase 5.9-C — retail refunds on the generic engine (Nest e2e).
 *
 * The full cancel → whole-refund → completed cycle (flag resolves, ledger
 * OUT, FIFO allocations, both facts), line refunds against delivered orders
 * with the promotion dust window, the fail-closed gates (unpaid, COD
 * uncollected, over-ceiling, over-units, wrong order state), idempotency +
 * key-reuse, the evidence rule, the retail-side gate, and the wholesale
 * writer running untouched through the evolved schema. Real PostgreSQL,
 * full Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_9_c_retail_refunds_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let payments: PaymentsService;
let promotions: PromotionService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r59c_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "custB" | "admin", string>;
const tokens = {} as Record<"custA" | "custB" | "admin", string>;
const ids = {} as Record<string, string>;
const totals = {} as Record<string, string>;
let kolbeSellerId = "";

const buyerA = () => ({ actorId: users.custA, actorRole: "customer" });
const admin = () => ({ actorId: users.admin, actorRole: "admin" });

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "سارا آزمون", phone: "09121234567", email: "sara@example.test" },
    lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 2 }],
    address: {
      province: "تهران",
      city: "تهران",
      address: "خیابان آزمون، پلاک ۱",
      plaque: "۱",
      unit: "۲",
      postal: "1234567890",
      note: "",
    },
    shippingMethodId: "pishtaz",
    payMethod: "gateway",
    ...overrides,
  };
}

async function checkoutAs(tag: string, overrides: Record<string, unknown> = {}) {
  const created = await retailOrders.createRetailOrder(
    { kind: "customer", userId: users.custA },
    { ...(orderBody(overrides) as any), idempotencyKey: makeId("key") },
  );
  ids[tag] = created.id;
  totals[tag] = created.totals.grandTotal;
  return created;
}

async function driveToDelivered(tag: string) {
  await retailOrders.confirmRetailOrder(ids[tag], admin());
  await retailOrders.packRetailOrder(ids[tag], admin());
  const created = await retailOrders.createRetailShipment(ids[tag], admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
  await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
  return retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
}

async function driveToHandoff(tag: string) {
  await retailOrders.confirmRetailOrder(ids[tag], admin());
  await retailOrders.packRetailOrder(ids[tag], admin());
  const created = await retailOrders.createRetailShipment(ids[tag], admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
  await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
}

async function payOrderGateway(tag: string) {
  const { payment } = await retailOrders.submitPaymentEvidence(ids[tag], buyerA(), {
    rail: "manual_transfer",
    amount: totals[tag],
    evidenceReference: `BANK-${tag}`,
    idempotencyKey: makeId("ev"),
  });
  const { view } = await retailOrders.verifyPayment(payment.id, admin(), {
    externalReference: `BANK-${tag}-VERIFY`,
    idempotencyKey: makeId("verify"),
  });
  expect(view.payment.status).toBe("paid");
  return view;
}

async function orderItemIds(tag: string): Promise<string[]> {
  const rows = await db.select({ id: schema.retailOrderItem.id }).from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, ids[tag]));
  return rows.map((row) => row.id);
}

async function factRows(orderId: string, eventType: string) {
  return db
    .select()
    .from(schema.orderEvent)
    .where(and(eq(schema.orderEvent.aggregateType, "retail_order"), eq(schema.orderEvent.aggregateId, orderId), eq(schema.orderEvent.eventType, eventType)));
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error: any) {
    expect(error?.code ?? error?.response?.code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

describe("Phase 5.9-C retail refunds", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
      await adminClient.query(`CREATE DATABASE "${TEST_DB}"`);
    } finally {
      await adminClient.end();
    }
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-p59c-refunds";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_URL });
    db = drizzle(pool, { schema: schema as any });
    retailOrders = app.get(RetailOrdersService);
    payments = app.get(PaymentsService);
    promotions = app.get(PromotionService);

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["admin", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    for (const name of ["custA", "custB", "admin"] as const) {
      tokens[name] = verifier.issue(users[name], name === "admin" ? "admin" : "customer", 0);
    }

    const offers = app.get(OffersService);
    kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Refund Product", slug: `ref-${ids.p1}`, ownerType: "KOLBE", status: "published" });
    ids.v1 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v1, productId: ids.p1, sku: `SKU-${ids.v1}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.v1, sku: `OFFER-${ids.v1}`, status: "published", retailPrice: 250000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v1, sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    } finally {
      await adminClient.end();
    }
  });

  it("settles a paid cancel whole-order: flag resolves, ledger OUT, FIFO allocations, both facts", async () => {
    await checkoutAs("W1");
    await payOrderGateway("W1");
    const cancelled = await retailOrders.cancelRetailOrder(ids.W1, admin());
    expect(cancelled.payment).toMatchObject({ status: "paid", refundPending: true });

    const filed = await retailOrders.requestRetailRefund(ids.W1, admin(), { amount: totals.W1, idempotencyKey: makeId("req") });
    expect(filed.replayed).toBe(false);
    expect(filed.refund).toMatchObject({ retailOrderId: ids.W1, wholesaleOrderId: null, status: "requested" });
    expect(BigInt(filed.refund.amount).toString()).toBe(totals.W1);
    // Still pending: a requested refund has not moved money.
    expect(filed.view.payment.refundPending).toBe(true);

    const approved = await retailOrders.approveRetailRefund(filed.refund.id, admin(), { idempotencyKey: makeId("appr") });
    expect(approved.refund.status).toBe("approved");

    const completed = await retailOrders.completeRetailRefund(filed.refund.id, admin(), {
      externalReference: `BANK-R59C-W1-${filed.refund.id.slice(-8)}`,
      idempotencyKey: makeId("comp"),
    });
    expect(completed.refund.status).toBe("completed");
    expect(completed.view.payment.refundPending).toBe(false);

    // Ledger: exactly one retail-sided OUT citing this order and refund.
    const ledger = await db.select().from(schema.financialLedgerEntry).where(eq(schema.financialLedgerEntry.refundId, filed.refund.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ retailOrderId: ids.W1, orderId: null, entryType: "refund_completed", direction: "OUT" });
    expect(BigInt((ledger[0] as any).amount).toString()).toBe(totals.W1);

    // Allocations: the whole refund maps onto the single verified payment.
    const allocs = await db.select().from(schema.refundAllocation).where(eq(schema.refundAllocation.refundId, filed.refund.id));
    expect(allocs).toHaveLength(1);
    expect(BigInt((allocs[0] as any).amount).toString()).toBe(totals.W1);
    const [payment] = await db.select().from(schema.payment).where(eq(schema.payment.id, (allocs[0] as any).paymentId));
    expect(payment).toMatchObject({ retailOrderId: ids.W1, status: "verified" });

    // Facts: one requested, one completed — the relay-visible truth.
    expect(await factRows(ids.W1, "retail_order.refund_requested")).toHaveLength(1);
    const done = await factRows(ids.W1, "retail_order.refund_completed");
    expect(done).toHaveLength(1);
    expect((done[0] as any).payload).toMatchObject({ refund_id: filed.refund.id, reference_present: true });
  });

  it("replays refund filing on the same key and refuses key reuse with a different payload", async () => {
    await checkoutAs("W2");
    await payOrderGateway("W2");
    await retailOrders.cancelRetailOrder(ids.W2, admin());
    const key = makeId("req");
    const first = await retailOrders.requestRetailRefund(ids.W2, admin(), { amount: totals.W2, idempotencyKey: key });
    const replayed = await retailOrders.requestRetailRefund(ids.W2, admin(), { amount: totals.W2, idempotencyKey: key });
    expect(replayed.replayed).toBe(true);
    expect(replayed.refund.id).toBe(first.refund.id);
    const rows = await db.select().from(schema.refund).where(eq(schema.refund.retailOrderId, ids.W2));
    expect(rows).toHaveLength(1);
    expect(await factRows(ids.W2, "retail_order.refund_requested")).toHaveLength(1);
    // Same key, different amount: the journal refuses to fork the refund.
    await expectCode(retailOrders.requestRetailRefund(ids.W2, admin(), { amount: "1", idempotencyKey: key }), "IDEMPOTENCY_KEY_REUSED");
    // Approving the live refund keeps working after the refused reuse.
    const approved = await retailOrders.approveRetailRefund(first.refund.id, admin(), { idempotencyKey: makeId("appr") });
    expect(approved.refund.status).toBe("approved");
  });

  it("refunds delivered lines inside the honesty window and rejects outside it", async () => {
    // A fixed 3 IRR ORDER discount stays at order level (the engine never
    // attributes order discounts to lines): lineTotal keeps the gross
    // 500000 over 2 units while promotion_discount_total holds the 3.
    const promo = await promotions.createPromotion(users.admin, { code: "R59C-DUST", title: "dust", channel: "RETAIL" });
    const revision = await promotions.createRevision(promo.id, users.admin, {
      benefitType: "FIXED_AMOUNT_DISCOUNT", benefitScope: "ORDER", amount: "3", stackingPolicy: "STACKABLE",
    } as any);
    await promotions.publishRevision(revision.id, users.admin);
    await promotions.submitForReview(promo.id, users.admin);
    await promotions.activate(promo.id, users.admin);
    try {
      await checkoutAs("D1");
      await payOrderGateway("D1");
      await driveToDelivered("D1");
      const [lineId] = await orderItemIds("D1");
      const [stored] = await db.select().from(schema.retailOrderItem).where(eq(schema.retailOrderItem.id, lineId));
      const [order] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, ids.D1));
      expect(BigInt((stored as any).lineTotal)).toBe(500000n);
      expect(BigInt((stored as any).promotionDiscount)).toBe(0n);
      expect(BigInt((order as any).promotionDiscountTotal)).toBe(3n);
      // One of two units: line-exact 250000, attribution open — [249997, 250000].

      // Below the window: rejected before any row exists.
      await expectCode(
        retailOrders.requestRetailRefund(ids.D1, admin(), { amount: "249996", lines: [{ retailOrderItemId: lineId, quantity: 1 }], idempotencyKey: makeId("req") }),
        "REFUND_LINE_BASIS_MISMATCH",
      );
      // Two filings inside the window (one unit each of the two ordered).
      const first = await retailOrders.requestRetailRefund(ids.D1, admin(), { amount: "249998", lines: [{ retailOrderItemId: lineId, quantity: 1 }], idempotencyKey: makeId("req") });
      expect(BigInt(first.refund.amount).toString()).toBe("249998");
      // Stored lines keep the CHECK-integral gross basis, not the asserted net.
      const storedLines = await db.select().from(schema.refundLine).where(eq(schema.refundLine.refundId, first.refund.id));
      expect(storedLines).toHaveLength(1);
      expect(storedLines[0]).toMatchObject({ retailOrderItemId: lineId, wholesaleOrderItemId: null, quantity: 1 });
      expect(BigInt((storedLines[0] as any).unitPrice).toString()).toBe("250000");
      expect(BigInt((storedLines[0] as any).lineTotal).toString()).toBe("250000");
      const second = await retailOrders.requestRetailRefund(ids.D1, admin(), { amount: "249999", lines: [{ retailOrderItemId: lineId, quantity: 1 }], idempotencyKey: makeId("req") });
      expect(BigInt(second.refund.amount).toString()).toBe("249999");
      // Both units refunded: a third unit exceeds the ordered quantity.
      await expectCode(
        retailOrders.requestRetailRefund(ids.D1, admin(), { amount: "249999", lines: [{ retailOrderItemId: lineId, quantity: 1 }], idempotencyKey: makeId("req") }),
        "REFUND_LINE_QUANTITY_EXCEEDED",
      );
      // Above the window on a fresh sibling line-set: still rejected (amount rule, not units rule).
      await checkoutAs("D1b");
      await payOrderGateway("D1b");
      await driveToDelivered("D1b");
      const [lineIdB] = await orderItemIds("D1b");
      await expectCode(
        retailOrders.requestRetailRefund(ids.D1b, admin(), { amount: "250001", lines: [{ retailOrderItemId: lineIdB, quantity: 1 }], idempotencyKey: makeId("req") }),
        "REFUND_LINE_BASIS_MISMATCH",
      );
      // Refunding EVERY unit pins the attribution exactly: [499997, 499997].
      await checkoutAs("D1c");
      await payOrderGateway("D1c");
      await driveToDelivered("D1c");
      const [lineIdC] = await orderItemIds("D1c");
      await expectCode(
        retailOrders.requestRetailRefund(ids.D1c, admin(), { amount: "499998", lines: [{ retailOrderItemId: lineIdC, quantity: 2 }], idempotencyKey: makeId("req") }),
        "REFUND_LINE_BASIS_MISMATCH",
      );
      await expectCode(
        retailOrders.requestRetailRefund(ids.D1c, admin(), { amount: "499996", lines: [{ retailOrderItemId: lineIdC, quantity: 2 }], idempotencyKey: makeId("req") }),
        "REFUND_LINE_BASIS_MISMATCH",
      );
      const whole = await retailOrders.requestRetailRefund(ids.D1c, admin(), { amount: "499997", lines: [{ retailOrderItemId: lineIdC, quantity: 2 }], idempotencyKey: makeId("req") });
      expect(BigInt(whole.refund.amount).toString()).toBe("499997");
    } finally {
      await promotions.end(promo.id, users.admin);
    }
  });

  it("rejects whole-order amounts that miss the ceiling and refunds nothing unpaid", async () => {
    await checkoutAs("W3");
    await payOrderGateway("W3");
    await retailOrders.cancelRetailOrder(ids.W3, admin());
    // Over the ceiling: only collected money leaves.
    await expectCode(
      retailOrders.requestRetailRefund(ids.W3, admin(), { amount: (BigInt(totals.W3) + 1n).toString(), idempotencyKey: makeId("req") }),
      "REFUND_EXCEEDS_ALLOCATED",
    );
    // Under the ceiling without lines: whole-order means the whole ceiling.
    await expectCode(
      retailOrders.requestRetailRefund(ids.W3, admin(), { amount: (BigInt(totals.W3) - 1n).toString(), idempotencyKey: makeId("req") }),
      "REFUND_LINE_BASIS_MISMATCH",
    );
    // The exact ceiling files.
    const filed = await retailOrders.requestRetailRefund(ids.W3, admin(), { amount: totals.W3, idempotencyKey: makeId("req") });
    expect(filed.refund.status).toBe("requested");

    // Unpaid cancels hold no money: nothing to refund.
    await checkoutAs("U1");
    await retailOrders.cancelRetailOrder(ids.U1, admin());
    await expectCode(retailOrders.requestRetailRefund(ids.U1, admin(), { amount: "1", idempotencyKey: makeId("req") }), "RETAIL_REFUND_UNPAID");
  });

  it("refuses COD refunds before collection verifies, then settles them like any paid order", async () => {
    await checkoutAs("C1", { payMethod: "cod" });
    const { payment } = await retailOrders.submitPaymentEvidence(ids.C1, buyerA(), {
      rail: "cod",
      amount: totals.C1,
      evidenceReference: "COD-COLLECT-C1",
      idempotencyKey: makeId("ev"),
    });
    // A submitted-but-unverified collection is not collected money.
    await expectCode(retailOrders.requestRetailRefund(ids.C1, admin(), { amount: totals.C1, idempotencyKey: makeId("req") }), "RETAIL_REFUND_UNPAID");
    const { view } = await retailOrders.verifyPayment(payment.id, admin(), {
      externalReference: "COD-COLLECT-C1-VERIFY",
      idempotencyKey: makeId("verify"),
    });
    expect(view.payment.status).toBe("paid");
    await retailOrders.cancelRetailOrder(ids.C1, admin());
    const filed = await retailOrders.requestRetailRefund(ids.C1, admin(), { amount: totals.C1, idempotencyKey: makeId("req") });
    await retailOrders.approveRetailRefund(filed.refund.id, admin(), { idempotencyKey: makeId("appr") });
    const completed = await retailOrders.completeRetailRefund(filed.refund.id, admin(), {
      externalReference: `BANK-R59C-C1-${filed.refund.id.slice(-8)}`,
      idempotencyKey: makeId("comp"),
    });
    expect(completed.view.payment.refundPending).toBe(false);
  });

  it("gates refunds by order state: pre-ship cancels first, in-transit waits, delivered needs lines, cancelled forbids them", async () => {
    // Placed + paid: refund routes to cancel.
    await checkoutAs("S1");
    await payOrderGateway("S1");
    const [lineS1] = await orderItemIds("S1");
    await expectCode(
      retailOrders.requestRetailRefund(ids.S1, admin(), { amount: "1", lines: [{ retailOrderItemId: lineS1, quantity: 1 }], idempotencyKey: makeId("req") }),
      "RETAIL_REFUND_ROUTES_TO_CANCEL",
    );
    // In transit + paid: money never leaves while goods move.
    await checkoutAs("S2");
    await payOrderGateway("S2");
    await driveToHandoff("S2");
    const [lineS2] = await orderItemIds("S2");
    await expectCode(
      retailOrders.requestRetailRefund(ids.S2, admin(), { amount: "1", lines: [{ retailOrderItemId: lineS2, quantity: 1 }], idempotencyKey: makeId("req") }),
      "RETAIL_REFUND_NOT_READY",
    );
    // Delivered without lines: partial refunds need their basis.
    await checkoutAs("S3");
    await payOrderGateway("S3");
    await driveToDelivered("S3");
    await expectCode(retailOrders.requestRetailRefund(ids.S3, admin(), { amount: totals.S3, idempotencyKey: makeId("req") }), "RETAIL_REFUND_LINES_REQUIRED");
    // Cancelled with lines: whole-or-nothing.
    await checkoutAs("S4");
    await payOrderGateway("S4");
    await retailOrders.cancelRetailOrder(ids.S4, admin());
    const [lineS4] = await orderItemIds("S4");
    await expectCode(
      retailOrders.requestRetailRefund(ids.S4, admin(), { amount: "1", lines: [{ retailOrderItemId: lineS4, quantity: 1 }], idempotencyKey: makeId("req") }),
      "RETAIL_REFUND_LINES_FORBIDDEN",
    );
    // Unknown line id: fail closed before money moves.
    await expectCode(
      retailOrders.requestRetailRefund(ids.S3, admin(), { amount: "1", lines: [{ retailOrderItemId: "ghost-line", quantity: 1 }], idempotencyKey: makeId("req") }),
      "RETAIL_REFUND_LINE_UNKNOWN",
    );
  });

  it("completes only on real evidence, in machine order, exactly once", async () => {
    await checkoutAs("E1");
    await payOrderGateway("E1");
    await retailOrders.cancelRetailOrder(ids.E1, admin());
    const filed = await retailOrders.requestRetailRefund(ids.E1, admin(), { amount: totals.E1, idempotencyKey: makeId("req") });
    // Fabricated references are not evidence.
    await expectCode(
      retailOrders.completeRetailRefund(filed.refund.id, admin(), { externalReference: "generated-1", idempotencyKey: makeId("comp") }),
      "REFUND_EVIDENCE_INVALID",
    );
    // Requested -> completed skips the machine.
    await expectCode(
      retailOrders.completeRetailRefund(filed.refund.id, admin(), { externalReference: `BANK-R59C-E1-${filed.refund.id.slice(-8)}`, idempotencyKey: makeId("comp") }),
      "INVALID_STATUS_TRANSITION",
    );
    await retailOrders.approveRetailRefund(filed.refund.id, admin(), { idempotencyKey: makeId("appr") });
    const done = await retailOrders.completeRetailRefund(filed.refund.id, admin(), {
      externalReference: `BANK-R59C-E1-${filed.refund.id.slice(-8)}`,
      idempotencyKey: makeId("comp"),
    });
    expect(done.refund.status).toBe("completed");
    // Second completion with a fresh key: replay, no second ledger OUT, no second fact.
    const replayed = await retailOrders.completeRetailRefund(filed.refund.id, admin(), {
      externalReference: `BANK-R59C-E1-${filed.refund.id.slice(-8)}`,
      idempotencyKey: makeId("comp"),
    });
    expect(replayed.replayed).toBe(true);
    const ledger = await db.select().from(schema.financialLedgerEntry).where(eq(schema.financialLedgerEntry.refundId, filed.refund.id));
    expect(ledger).toHaveLength(1);
    expect(await factRows(ids.E1, "retail_order.refund_completed")).toHaveLength(1);
  });

  it("keeps refunds staff-only and refuses wholesale ids on the retail path", async () => {
    await checkoutAs("F1");
    await payOrderGateway("F1");
    await retailOrders.cancelRetailOrder(ids.F1, admin());
    await expectCode(retailOrders.requestRetailRefund(ids.F1, buyerA() as any, { amount: totals.F1, idempotencyKey: makeId("req") }), "RETAIL_ORDER_FORBIDDEN");
    const filed = await retailOrders.requestRetailRefund(ids.F1, admin(), { amount: totals.F1, idempotencyKey: makeId("req") });
    await expectCode(retailOrders.approveRetailRefund(filed.refund.id, buyerA() as any, { idempotencyKey: makeId("appr") }), "RETAIL_ORDER_FORBIDDEN");

    // A wholesale-side refund id is rejected by every retail transition.
    const wAccount = makeId("wacc");
    await db.insert(schema.wholesaleAccount).values({ id: wAccount, userId: users.admin, memberName: "W", storeName: "W", phone: "0912", city: "Tehran" });
    const wOrder = makeId("worder");
    await db.insert(schema.wholesaleOrder).values({ id: wOrder, orderCode: `W-${wOrder}`, accountId: wAccount, buyerUserId: users.admin, status: "draft" });
    await db.insert(schema.payment).values({
      id: makeId("wpay"), paymentReference: `PAY-${makeId("wpay")}`, wholesaleOrderId: wOrder,
      method: "manual_transfer", status: "verified", amount: 100000n as any, currency: "IRR", externalReference: "BANK-W-R59C",
    });
    const wholesale = await payments.createRefund({ orderId: wOrder, amount: "100000", actorUserId: users.admin, actorRole: "admin", idempotencyKey: makeId("wreq") });
    await expectCode(retailOrders.approveRetailRefund(wholesale.refund.id, admin(), { idempotencyKey: makeId("appr") }), "RETAIL_REFUND_EXPECTED");
    await expectCode(
      retailOrders.completeRetailRefund(wholesale.refund.id, admin(), { externalReference: "BANK-W-R59C-DONE", idempotencyKey: makeId("comp") }),
      "RETAIL_REFUND_EXPECTED",
    );
    await expectCode(retailOrders.failRetailRefund(wholesale.refund.id, admin(), { reason: "x", idempotencyKey: makeId("fail") }), "RETAIL_REFUND_EXPECTED");
  });

  it("runs the wholesale writer untouched through the evolved schema", async () => {
    const wAccount = makeId("wacc2");
    await db.insert(schema.wholesaleAccount).values({ id: wAccount, userId: users.admin, memberName: "W", storeName: "W", phone: "0912", city: "Tehran" });
    const wOrder = makeId("worder2");
    await db.insert(schema.wholesaleOrder).values({ id: wOrder, orderCode: `W-${wOrder}`, accountId: wAccount, buyerUserId: users.admin, status: "draft" });
    const wPay = makeId("wpay2");
    await db.insert(schema.payment).values({
      id: wPay, paymentReference: `PAY-${wPay}`, wholesaleOrderId: wOrder,
      method: "manual_transfer", status: "verified", amount: 100000n as any, currency: "IRR", externalReference: "BANK-W2-R59C",
    });
    // Same call shape as before C: order-scoped, no child, no lines.
    const created = await payments.createRefund({ orderId: wOrder, amount: "100000", actorUserId: users.admin, actorRole: "admin", idempotencyKey: makeId("wreq") });
    expect(created.refund).toMatchObject({ wholesaleOrderId: wOrder, retailOrderId: null, childOrderId: null, status: "requested" });
    await payments.approveRefund({ refundId: created.refund.id, adminUserId: users.admin, idempotencyKey: makeId("wappr"), actorRole: "admin" });
    const completed = await payments.completeRefund({
      refundId: created.refund.id, adminUserId: users.admin, externalReference: `BANK-W2-R59C-DONE`, idempotencyKey: makeId("wcomp"), actorRole: "admin",
    });
    expect(completed.refund.status).toBe("completed");
    const ledger = await db.select().from(schema.financialLedgerEntry).where(eq(schema.financialLedgerEntry.refundId, created.refund.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ orderId: wOrder, retailOrderId: null, entryType: "refund_completed", direction: "OUT" });
    // The old wholesale partial unique still guards its side (the 0039
    // ALTERs left it untouched; a raw second row on the same key collides).
    // (No service-level replay assert here: the wholesale writer checks the
    // ceiling before its idempotency journal — pre-existing behavior, kept
    // byte-identical — so a consumed ceiling throws instead of replaying.
    // The retail writer deliberately journals first; see the test above.)
    const dupId = makeId("wdup");
    try {
      await db.insert(schema.refund).values({
        id: dupId, refundReference: `REF-${dupId}`, wholesaleOrderId: wOrder, amount: 1n as any, idempotencyKey: created.refund.idempotencyKey,
      });
      throw new Error("expected the wholesale partial unique to fire");
    } catch (error: any) {
      expect(String(error?.cause?.constraint ?? error?.constraint ?? error?.message)).toContain("refund_order_idempotency_unique");
    }
  });
});
