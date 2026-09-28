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
import { RetailReturnsService } from "../src/modules/orders/retail/retail-returns.service";
import { RetailNotificationRelayService } from "../src/modules/orders/retail/retail-notification-relay.service";
import { PaymentsService } from "../src/modules/payments/payments.service";
import { PromotionService } from "../src/modules/promotions/promotion.service";

/**
 * Phase 5.9-D6 — failure injection over the after-sales surface (Nest e2e).
 *
 * Refunds price from stored immutable basis (promos may die mid-flight),
 * failed refunds are terminal yet refileable, completions converge on
 * first-evidence-wins, the relay skips refund facts without touching
 * commerce, invalid filings persist nothing, and a broken restock fails
 * closed without wedging the return. Real PostgreSQL, full Nest
 * application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_9_d_failure_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let returns: RetailReturnsService;
let relay: RetailNotificationRelayService;
let payments: PaymentsService;
let promotions: PromotionService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r59d_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "admin", string>;
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

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error: any) {
    expect(error?.code ?? error?.response?.code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

describe("Phase 5.9-D6 failure injection", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p59d-failure";
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
    returns = app.get(RetailReturnsService);
    relay = app.get(RetailNotificationRelayService);
    payments = app.get(PaymentsService);
    promotions = app.get(PromotionService);

    for (const [name, role] of [["custA", "customer"], ["admin", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    // Phase 5.11-C (setup-only): this suite's staff actor is TOTP-enrolled;
    // the C-tranche gate refuses paid cancels for unenrolled staff.
    // Assertions unchanged.
    await db.update(schema.accountUser).set({ totpSecret: "JBSWY3DPEHPK3PXP", totpEnabled: true, totpEnrolledAt: new Date() }).where(eq(schema.accountUser.id, users.admin));

    const offers = app.get(OffersService);
    kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Failure Product", slug: `fail-${ids.p1}`, ownerType: "KOLBE", status: "published" });
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

  it("files line refunds from stored basis after the promo dies mid-flight", async () => {
    const promo = await promotions.createPromotion(users.admin, { code: "R59D-DYING", title: "dying", channel: "RETAIL" });
    const revision = await promotions.createRevision(promo.id, users.admin, {
      benefitType: "FIXED_AMOUNT_DISCOUNT", benefitScope: "ORDER", amount: "3", stackingPolicy: "STACKABLE",
    } as any);
    await promotions.publishRevision(revision.id, users.admin);
    await promotions.submitForReview(promo.id, users.admin);
    await promotions.activate(promo.id, users.admin);
    await checkoutAs("F1");
    await payOrderGateway("F1");
    await driveToDelivered("F1");
    // The campaign ends before anyone files: the stored rows are the basis.
    await promotions.end(promo.id, users.admin);
    const [lineId] = await orderItemIds("F1");
    const filed = await retailOrders.requestRetailRefund(ids.F1, admin(), {
      amount: "249998",
      lines: [{ retailOrderItemId: lineId, quantity: 1 }],
      idempotencyKey: makeId("req"),
    });
    expect(BigInt(filed.refund.amount).toString()).toBe("249998");
  });

  it("treats failed refunds as terminal for completion yet refileable with a fresh key", async () => {
    await checkoutAs("F2");
    await payOrderGateway("F2");
    await retailOrders.cancelRetailOrder(ids.F2, admin());
    const filed = await retailOrders.requestRetailRefund(ids.F2, admin(), { amount: totals.F2, idempotencyKey: makeId("req") });
    await retailOrders.approveRetailRefund(filed.refund.id, admin(), { idempotencyKey: makeId("appr") });
    const failed = await retailOrders.failRetailRefund(filed.refund.id, admin(), { reason: "bank rejected the payout", idempotencyKey: makeId("fail") });
    expect(failed.refund.status).toBe("failed");
    // A failed refund never completes, however real the evidence.
    await expectCode(
      retailOrders.completeRetailRefund(filed.refund.id, admin(), { externalReference: `BANK-R59D-F2-${filed.refund.id.slice(-8)}`, idempotencyKey: makeId("comp") }),
      "INVALID_STATUS_TRANSITION",
    );
    // Failed rows leave the live guards, so a fresh filing for the same money proceeds.
    const refiled = await retailOrders.requestRetailRefund(ids.F2, admin(), { amount: totals.F2, idempotencyKey: makeId("req") });
    expect(refiled.replayed).toBe(false);
    expect(refiled.refund.status).toBe("requested");
    await retailOrders.approveRetailRefund(refiled.refund.id, admin(), { idempotencyKey: makeId("appr") });
    const completed = await retailOrders.completeRetailRefund(refiled.refund.id, admin(), {
      externalReference: `BANK-R59D-F2B-${refiled.refund.id.slice(-8)}`,
      idempotencyKey: makeId("comp"),
    });
    expect(completed.view.payment.refundPending).toBe(false);
  });

  it("returns the failed refund on same-key refile: the journal wins over re-execution", async () => {
    await checkoutAs("F3");
    await payOrderGateway("F3");
    await retailOrders.cancelRetailOrder(ids.F3, admin());
    const key = makeId("req");
    const filed = await retailOrders.requestRetailRefund(ids.F3, admin(), { amount: totals.F3, idempotencyKey: key });
    await retailOrders.failRetailRefund(filed.refund.id, admin(), { reason: "duplicate payout attempt", idempotencyKey: makeId("fail") });
    const replayed = await retailOrders.requestRetailRefund(ids.F3, admin(), { amount: totals.F3, idempotencyKey: key });
    expect(replayed.replayed).toBe(true);
    expect(replayed.refund.id).toBe(filed.refund.id);
    expect(replayed.refund.status).toBe("failed");
    const rows = await db.select().from(schema.refund).where(eq(schema.refund.retailOrderId, ids.F3));
    expect(rows).toHaveLength(1);
  });

  it("converges double completion on first-evidence-wins with a single ledger OUT", async () => {
    await checkoutAs("F4");
    await payOrderGateway("F4");
    await retailOrders.cancelRetailOrder(ids.F4, admin());
    const filed = await retailOrders.requestRetailRefund(ids.F4, admin(), { amount: totals.F4, idempotencyKey: makeId("req") });
    await retailOrders.approveRetailRefund(filed.refund.id, admin(), { idempotencyKey: makeId("appr") });
    const firstRef = `BANK-R59D-F4-FIRST-${filed.refund.id.slice(-8)}`;
    await retailOrders.completeRetailRefund(filed.refund.id, admin(), { externalReference: firstRef, idempotencyKey: makeId("comp") });
    const replayed = await retailOrders.completeRetailRefund(filed.refund.id, admin(), {
      externalReference: `BANK-R59D-F4-SECOND-${filed.refund.id.slice(-8)}`,
      idempotencyKey: makeId("comp"),
    });
    expect(replayed.replayed).toBe(true);
    const [row] = await db.select().from(schema.refund).where(eq(schema.refund.id, filed.refund.id));
    expect((row as any).externalReference).toBe(firstRef);
    const ledger = await db.select().from(schema.financialLedgerEntry).where(eq(schema.financialLedgerEntry.refundId, filed.refund.id));
    expect(ledger).toHaveLength(1);
    expect((ledger[0] as any).externalReference).toBe(firstRef);
  });

  it("enforces the evidence boundary: 3 chars rejected, 4 chars accepted", async () => {
    await checkoutAs("F5");
    await payOrderGateway("F5");
    await retailOrders.cancelRetailOrder(ids.F5, admin());
    const filed = await retailOrders.requestRetailRefund(ids.F5, admin(), { amount: totals.F5, idempotencyKey: makeId("req") });
    await retailOrders.approveRetailRefund(filed.refund.id, admin(), { idempotencyKey: makeId("appr") });
    await expectCode(
      retailOrders.completeRetailRefund(filed.refund.id, admin(), { externalReference: "ABC", idempotencyKey: makeId("comp") }),
      "REFUND_EVIDENCE_INVALID",
    );
    const completed = await retailOrders.completeRetailRefund(filed.refund.id, admin(), { externalReference: "AB12", idempotencyKey: makeId("comp") });
    expect(completed.refund.status).toBe("completed");
  });

  it("skips refund facts in the relay without touching commerce", async () => {
    await checkoutAs("F6");
    await payOrderGateway("F6");
    await retailOrders.cancelRetailOrder(ids.F6, admin());
    const filed = await retailOrders.requestRetailRefund(ids.F6, admin(), { amount: totals.F6, idempotencyKey: makeId("req") });
    await retailOrders.approveRetailRefund(filed.refund.id, admin(), { idempotencyKey: makeId("appr") });
    await retailOrders.completeRetailRefund(filed.refund.id, admin(), {
      externalReference: `BANK-R59D-F6-${filed.refund.id.slice(-8)}`,
      idempotencyKey: makeId("comp"),
    });
    for (const eventType of ["retail_order.refund_requested", "retail_order.refund_completed"]) {
      const facts = await db
        .select()
        .from(schema.orderEvent)
        .where(and(eq(schema.orderEvent.aggregateId, ids.F6), eq(schema.orderEvent.eventType, eventType)));
      expect(facts).toHaveLength(1);
      const result = await relay.relayEvent((facts[0] as any).id);
      expect(result).toEqual({ deliveries: 0, failures: 0, skipped: 1 });
    }
    // Commerce untouched by the relay pass: one completed refund, one OUT, flag resolved.
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.F6);
    expect(view.payment.refundPending).toBe(false);
    const ledger = await db.select().from(schema.financialLedgerEntry).where(eq(schema.financialLedgerEntry.refundId, filed.refund.id));
    expect(ledger).toHaveLength(1);
  });

  it("persists nothing when return filing is rejected (no case, no rows)", async () => {
    await checkoutAs("F7");
    await payOrderGateway("F7");
    await driveToDelivered("F7");
    const [lineId] = await orderItemIds("F7");
    const casesBefore = await db.select({ id: schema.supportCase.id }).from(schema.supportCase);
    await expectCode(
      returns.fileRetailReturn(buyerA(), ids.F7, { lines: [{ orderItemId: lineId, quantity: 1 }], reason: "BOGUS_REASON" }),
      "RETAIL_RETURN_REASON_INVALID",
    );
    const casesAfter = await db.select({ id: schema.supportCase.id }).from(schema.supportCase);
    expect(casesAfter.map((row) => row.id)).toEqual(casesBefore.map((row) => row.id));
    const requests = await db.select().from(schema.retailReturnRequest).where(eq(schema.retailReturnRequest.orderId, ids.F7));
    expect(requests).toHaveLength(0);
  });

  it("fails a broken restock closed: INSPECTED kept, stock untouched, no wedge", async () => {
    await checkoutAs("F8");
    await payOrderGateway("F8");
    await driveToDelivered("F8");
    const [lineId] = await orderItemIds("F8");
    const filed = await returns.fileRetailReturn(buyerA(), ids.F8, { lines: [{ orderItemId: lineId, quantity: 1 }], reason: "QUALITY_ISSUE" });
    await returns.transitionRetailReturn(filed.id, "APPROVED", admin());
    await returns.transitionRetailReturn(filed.id, "RECEIVED", admin());
    await returns.transitionRetailReturn(filed.id, "INSPECTED", { ...admin(), inspectionDecision: "RESTOCKABLE" });
    const stockBefore = await db
      .select({ onHand: schema.productVariantInventory.onHand })
      .from(schema.productVariantInventory)
      .where(and(eq(schema.productVariantInventory.variantId, ids.v1), eq(schema.productVariantInventory.sellerId, kolbeSellerId)));
    // Simulate a data-integrity break: the line loses its variant.
    await db.update(schema.retailOrderItem).set({ variantId: null }).where(eq(schema.retailOrderItem.id, lineId));
    await expectCode(returns.transitionRetailReturn(filed.id, "RESTOCKED", admin()), "RETAIL_VARIANT_MISMATCH");
    const [kept] = await db.select().from(schema.retailReturnRequest).where(eq(schema.retailReturnRequest.id, filed.id));
    expect((kept as any).status).toBe("INSPECTED");
    const stockAfter = await db
      .select({ onHand: schema.productVariantInventory.onHand })
      .from(schema.productVariantInventory)
      .where(and(eq(schema.productVariantInventory.variantId, ids.v1), eq(schema.productVariantInventory.sellerId, kolbeSellerId)));
    expect(stockAfter).toEqual(stockBefore);
    // Repair the line: restock proceeds, the return was never wedged.
    await db.update(schema.retailOrderItem).set({ variantId: ids.v1 }).where(eq(schema.retailOrderItem.id, lineId));
    const restocked = await returns.transitionRetailReturn(filed.id, "RESTOCKED", admin());
    expect(restocked.status).toBe("RESTOCKED");
  });
});
