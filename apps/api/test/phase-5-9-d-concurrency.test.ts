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

/**
 * Phase 5.9-D7 — after-sales concurrency (Nest e2e).
 *
 * Same-key filings collapse to one row + one replay; racing filings
 * converge (one winner, honest loser code, ceiling and units never
 * over-drawn); racing completions converge on a single OUT; racing
 * return filings never over-encumber a line. Real PostgreSQL, full
 * Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_9_d_concurrency_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let returns: RetailReturnsService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r59d_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "admin", string>;
const ids = {} as Record<string, string>;
const totals = {} as Record<string, string>;

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

const codeOf = (error: any): string => error?.code ?? error?.response?.code ?? "NO_CODE";

describe("Phase 5.9-D7 concurrency", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p59d-concurrency";
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
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Race Product", slug: `race-${ids.p1}`, ownerType: "KOLBE", status: "published" });
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

  it("collapses same-key double filing to one row, one replay, one fact", async () => {
    await checkoutAs("R1");
    await payOrderGateway("R1");
    await retailOrders.cancelRetailOrder(ids.R1, admin());
    const key = makeId("req");
    const [a, b] = await Promise.allSettled([
      retailOrders.requestRetailRefund(ids.R1, admin(), { amount: totals.R1, idempotencyKey: key }),
      retailOrders.requestRetailRefund(ids.R1, admin(), { amount: totals.R1, idempotencyKey: key }),
    ]);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    const flags = [a, b].map((r) => (r as PromiseFulfilledResult<any>).value.replayed).sort();
    expect(flags).toEqual([false, true]);
    const rows = await db.select().from(schema.refund).where(eq(schema.refund.retailOrderId, ids.R1));
    expect(rows).toHaveLength(1);
    const facts = await db
      .select()
      .from(schema.orderEvent)
      .where(and(eq(schema.orderEvent.aggregateId, ids.R1), eq(schema.orderEvent.eventType, "retail_order.refund_requested")));
    expect(facts).toHaveLength(1);
  });

  it("converges racing whole-filings: one requested, the loser exceeds the consumed ceiling", async () => {
    await checkoutAs("R2");
    await payOrderGateway("R2");
    await retailOrders.cancelRetailOrder(ids.R2, admin());
    const [a, b] = await Promise.allSettled([
      retailOrders.requestRetailRefund(ids.R2, admin(), { amount: totals.R2, idempotencyKey: makeId("req") }),
      retailOrders.requestRetailRefund(ids.R2, admin(), { amount: totals.R2, idempotencyKey: makeId("req") }),
    ]);
    const won = [a, b].filter((r) => r.status === "fulfilled");
    const lost = [a, b].filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(codeOf((lost[0] as PromiseRejectedResult).reason)).toBe("REFUND_EXCEEDS_ALLOCATED");
    const rows = await db.select().from(schema.refund).where(eq(schema.refund.retailOrderId, ids.R2));
    expect(rows).toHaveLength(1);
  });

  it("converges racing line-filings on the same units: winner files, loser exceeds quantity", async () => {
    await checkoutAs("R3");
    await payOrderGateway("R3");
    await driveToDelivered("R3");
    const [lineId] = await orderItemIds("R3");
    // No promos: the per-unit net is exact (250000).
    const file = () =>
      retailOrders.requestRetailRefund(ids.R3, admin(), {
        amount: "500000",
        lines: [{ retailOrderItemId: lineId, quantity: 2 }],
        idempotencyKey: makeId("req"),
      });
    const [a, b] = await Promise.allSettled([file(), file()]);
    const won = [a, b].filter((r) => r.status === "fulfilled");
    const lost = [a, b].filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(codeOf((lost[0] as PromiseRejectedResult).reason)).toBe("REFUND_LINE_QUANTITY_EXCEEDED");
    const units = await db
      .select({ quantity: schema.refundLine.quantity })
      .from(schema.refundLine)
      .where(eq(schema.refundLine.retailOrderItemId, lineId));
    expect(units.reduce((sum, row) => sum + row.quantity, 0)).toBe(2);
  });

  it("converges racing completions on a single OUT with first evidence kept", async () => {
    await checkoutAs("R4");
    await payOrderGateway("R4");
    await retailOrders.cancelRetailOrder(ids.R4, admin());
    const filed = await retailOrders.requestRetailRefund(ids.R4, admin(), { amount: totals.R4, idempotencyKey: makeId("req") });
    await retailOrders.approveRetailRefund(filed.refund.id, admin(), { idempotencyKey: makeId("appr") });
    const refA = `BANK-R59D-R4A-${filed.refund.id.slice(-8)}`;
    const refB = `BANK-R59D-R4B-${filed.refund.id.slice(-8)}`;
    const [a, b] = await Promise.allSettled([
      retailOrders.completeRetailRefund(filed.refund.id, admin(), { externalReference: refA, idempotencyKey: makeId("comp") }),
      retailOrders.completeRetailRefund(filed.refund.id, admin(), { externalReference: refB, idempotencyKey: makeId("comp") }),
    ]);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    const flags = [a, b].map((r) => (r as PromiseFulfilledResult<any>).value.replayed).sort();
    expect(flags).toEqual([false, true]);
    const ledger = await db.select().from(schema.financialLedgerEntry).where(eq(schema.financialLedgerEntry.refundId, filed.refund.id));
    expect(ledger).toHaveLength(1);
    expect([refA, refB]).toContain((ledger[0] as any).externalReference);
  });

  it("converges racing approve + fail: one transition wins, the loser is refused", async () => {
    await checkoutAs("R5");
    await payOrderGateway("R5");
    await retailOrders.cancelRetailOrder(ids.R5, admin());
    const filed = await retailOrders.requestRetailRefund(ids.R5, admin(), { amount: totals.R5, idempotencyKey: makeId("req") });
    const [a, b] = await Promise.allSettled([
      retailOrders.approveRetailRefund(filed.refund.id, admin(), { idempotencyKey: makeId("appr") }),
      retailOrders.failRetailRefund(filed.refund.id, admin(), { reason: "race loser", idempotencyKey: makeId("fail") }),
    ]);
    // approve-then-fail is legal (failed from approved), so both MAY win;
    // fail-then-approve is not (INVALID_STATUS_TRANSITION). Either way the
    // row ends in exactly one honest terminal-or-approved state.
    const [row] = await db.select().from(schema.refund).where(eq(schema.refund.id, filed.refund.id));
    if (a.status === "fulfilled" && b.status === "fulfilled") {
      // Approve won the race, fail followed it: failed.
      expect((row as any).status).toBe("failed");
    } else {
      // Fail won the race: approve is refused on a failed row.
      const loser = (a.status === "rejected" ? a : b) as PromiseRejectedResult;
      expect(codeOf(loser.reason)).toBe("INVALID_STATUS_TRANSITION");
      expect((row as any).status).toBe("failed");
    }
  });

  it("never over-encumbers a line under racing return filings", async () => {
    await checkoutAs("R6", { lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 1 }] });
    await payOrderGateway("R6");
    await driveToDelivered("R6");
    const [lineId] = await orderItemIds("R6");
    const file = () => returns.fileRetailReturn(buyerA(), ids.R6, { lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" });
    const [a, b] = await Promise.allSettled([file(), file()]);
    const won = [a, b].filter((r) => r.status === "fulfilled");
    const lost = [a, b].filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(codeOf((lost[0] as PromiseRejectedResult).reason)).toBe("RETAIL_RETURN_QUANTITY_EXCEEDED");
    const requests = await db.select().from(schema.retailReturnRequest).where(eq(schema.retailReturnRequest.orderId, ids.R6));
    expect(requests).toHaveLength(1);
  });

  it("converges racing customer withdraw + staff approve on a return", async () => {
    await checkoutAs("R7");
    await payOrderGateway("R7");
    await driveToDelivered("R7");
    const [lineId] = await orderItemIds("R7");
    const filed = await returns.fileRetailReturn(buyerA(), ids.R7, { lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" });
    const [a, b] = await Promise.allSettled([
      returns.withdrawRetailReturn(buyerA(), filed.id),
      returns.transitionRetailReturn(filed.id, "APPROVED", admin()),
    ]);
    // Withdraw is customer-only from REQUESTED *and* APPROVED, so the race
    // is order-dependent by design: withdraw-first refuses the approve
    // (1 fulfilled), approve-first lets the withdraw follow (2 fulfilled).
    // Both orders end WITHDRAWN — the customer always gets the last word.
    const won = [a, b].filter((r) => r.status === "fulfilled");
    expect([1, 2]).toContain(won.length);
    if (won.length === 1) {
      expect(a.status).toBe("fulfilled");
      expect(codeOf((b as PromiseRejectedResult).reason)).toBe("RETAIL_RETURN_TRANSITION_INVALID");
    }
    const [row] = await db.select().from(schema.retailReturnRequest).where(eq(schema.retailReturnRequest.id, filed.id));
    expect((row as any).status).toBe("WITHDRAWN");
  });
});
