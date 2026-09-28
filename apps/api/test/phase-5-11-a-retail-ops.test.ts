import path from "node:path";
import { execFileSync } from "node:child_process";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client, Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../packages/database/src/schema/tables";
import { OffersService } from "../src/modules/offers/offers.service";
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";

/**
 * Phase 5.11-A — retail fulfillment ops over staff HTTP (Nest e2e).
 *
 * The A routes are a thin forwarding shell: each test drives the HTTP
 * route and pins the seam behavior behind it (status advance, replay
 * codes, honesty errors). Admins act; customers are refused at the
 * guard; finance stays seam-only by construction. Real PostgreSQL,
 * full Nest application, real domain service.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_11_a_ops_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r511a_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "admin", string>;
const tokens = {} as Record<"custA" | "admin" | "financeHat", string>;
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

const stable = (rows: unknown) =>
  JSON.stringify(rows, (_key, value) => (typeof value === "bigint" ? `bigint:${value.toString()}` : value instanceof Date ? `date:${value.toISOString()}` : value));

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

async function checkoutAs(tag: string, overrides: Record<string, unknown> = {}) {
  const created = await retailOrders.createRetailOrder(
    { kind: "customer", userId: users.custA },
    { ...(orderBody(overrides) as any), idempotencyKey: makeId("key") },
  );
  ids[tag] = created.id;
  totals[tag] = created.totals.grandTotal;
  return created;
}

describe("Phase 5.11-A retail ops", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p511a-ops";
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

    for (const [name, role] of [["custA", "customer"], ["admin", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    // Phase 5.11-C (setup-only): this suite's staff actor is TOTP-enrolled;
    // the C-tranche gate refuses paid cancels and refund terminal
    // transitions for unenrolled staff. Assertions unchanged.
    await db.update(schema.accountUser).set({ totpSecret: "JBSWY3DPEHPK3PXP", totpEnabled: true, totpEnrolledAt: new Date() }).where(eq(schema.accountUser.id, users.admin));
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    tokens.custA = verifier.issue(users.custA, "customer", 0);
    tokens.admin = verifier.issue(users.admin, "admin", 0);
    // A finance hat over an admin row: the guard compares against the live
    // row and must refuse (finance has no login; seam-only by construction).
    tokens.financeHat = verifier.issue(users.admin, "finance", 0);

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Ops Product", slug: `ops-${ids.p1}`, ownerType: "KOLBE", status: "published" });
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

  it("confirms over HTTP: admin advances, customer refused, anonymous refused", async () => {
    await checkoutAs("A1");
    await payOrderGateway("A1");
    await checkoutAs("A1b");
    const unpaid = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A1b}/confirm`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(422);
    expect(unpaid.body.error).toBe("RETAIL_FULFILLMENT_NOT_READY");
    await request(app.getHttpServer()).post(`/api/v1/admin/retail/orders/${ids.A1}/confirm`).send({}).expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A1}/confirm`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({})
      .expect(403);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A1}/confirm`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    expect(res.body.status).toBe("confirmed");
  });

  it("packs in sequence: pack-before-confirm is refused, confirm-then-pack advances", async () => {
    await checkoutAs("A2");
    await payOrderGateway("A2");
    const refused = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A2}/pack`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(400);
    expect(refused.body.error).toBe("RETAIL_TRANSITION_INVALID");
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A2}/confirm`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    const packed = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A2}/pack`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    expect(packed.body.status).toBe("packed");
  });

  it("cancels a paid order over HTTP into refund-pending with money untouched", async () => {
    await checkoutAs("A3");
    const { payment } = await retailOrders.submitPaymentEvidence(ids.A3, buyerA(), {
      rail: "manual_transfer",
      amount: totals.A3,
      evidenceReference: "BANK-A3",
      idempotencyKey: makeId("ev"),
    });
    await retailOrders.verifyPayment(payment.id, admin(), { externalReference: "BANK-A3-VERIFY", idempotencyKey: makeId("verify") });
    const before = await db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, ids.A3));
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A3}/cancel`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ reason: "customer asked on the phone" })
      .expect(200);
    expect(res.body.status).toBe("cancelled");
    expect(res.body.payment.refundPending).toBe(true);
    const after = await db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, ids.A3));
    expect(stable(after)).toBe(stable(before));
  });

  it("verifies payment over HTTP: 201 first, 200 on same-key replay", async () => {
    await checkoutAs("A4");
    const { payment } = await retailOrders.submitPaymentEvidence(ids.A4, buyerA(), {
      rail: "manual_transfer",
      amount: totals.A4,
      evidenceReference: "BANK-A4",
      idempotencyKey: makeId("ev"),
    });
    const key = makeId("verify");
    const first = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/payments/${payment.id}/verify`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", key)
      .send({ externalReference: "BANK-A4-VERIFY" })
      .expect(201);
    expect(first.body.replayed).toBe(false);
    expect(first.body.view.payment.status).toBe("paid");
    const replayed = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/payments/${payment.id}/verify`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", key)
      .send({ externalReference: "BANK-A4-VERIFY" })
      .expect(200);
    expect(replayed.body.replayed).toBe(true);
  });

  it("creates shipments over HTTP: 201 new, 200 replay, customer refused, key required", async () => {
    await checkoutAs("A5");
    await payOrderGateway("A5");
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A5}/confirm`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A5}/pack`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A5}/shipments`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .set("idempotency-key", makeId("ship"))
      .send({ providerName: "manual" })
      .expect(403);
    const missing = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A5}/shipments`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ providerName: "manual" })
      .expect(400);
    expect(missing.body.error).toBe("RETAIL_IDEMPOTENCY_KEY_REQUIRED");
    const key = makeId("ship");
    const created = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A5}/shipments`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", key)
      .send({ providerName: "manual" })
      .expect(201);
    expect(created.body.replayed).toBe(false);
    expect(created.body.shipment.id).toBeTruthy();
    const replayed = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A5}/shipments`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ providerName: "manual", idempotencyKey: key })
      .expect(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.shipment.id).toBe(created.body.shipment.id);
  });

  it("hands off over HTTP: fenced until packed, then 201 and replay 200", async () => {
    await checkoutAs("A6");
    await payOrderGateway("A6");
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A6}/confirm`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    // Confirmed-order parcel creation is legal; the handoff stays fenced.
    const created = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A6}/shipments`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("ship"))
      .send({ providerName: "manual" })
      .expect(201);
    const fenced = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/shipments/${created.body.shipment.id}/handoff`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("hand"))
      .send({})
      .expect(422);
    expect(fenced.body.error).toBe("RETAIL_SHIPMENT_NOT_READY");
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A6}/pack`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    const key = makeId("hand");
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/shipments/${created.body.shipment.id}/handoff`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", key)
      .send({})
      .expect(201);
    const replayed = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/shipments/${created.body.shipment.id}/handoff`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", key)
      .send({})
      .expect(200);
    expect(replayed.body.replayed).toBe(true);
  });

  it("attests manual tracking over HTTP to delivered with order fan-out", async () => {
    await checkoutAs("A7");
    await payOrderGateway("A7");
    for (const action of ["confirm", "pack"]) {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/retail/orders/${ids.A7}/${action}`)
        .set("authorization", `Bearer ${tokens.admin}`)
        .send({})
        .expect(200);
    }
    const created = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A7}/shipments`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("ship"))
      .send({ providerName: "manual" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/shipments/${created.body.shipment.id}/handoff`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("hand"))
      .send({})
      .expect(201);
    const delivered = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/shipments/${created.body.shipment.id}/manual-tracking`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ state: "delivered" })
      .expect(200);
    expect(delivered.body.status).toBe("processed");
    expect(delivered.body.shipmentStatus).toBe("delivered");
    const order = await request(app.getHttpServer())
      .get(`/api/v1/retail/orders/${ids.A7}`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .expect(200);
    expect(order.body.status).toBe("delivered");
  });

  it("keeps finance seam-only: finance-hat tokens 401 at HTTP while the seam accepts finance", async () => {
    await checkoutAs("A8");
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A8}/confirm`)
      .set("authorization", `Bearer ${tokens.financeHat}`)
      .send({})
      .expect(401);
    // The seam itself still honors finance (payments-owned gate): prove it
    // with a verify, which delegates role checks to payments.
    const { payment } = await retailOrders.submitPaymentEvidence(ids.A8, buyerA(), {
      rail: "manual_transfer",
      amount: totals.A8,
      evidenceReference: "BANK-A8",
      idempotencyKey: makeId("ev"),
    });
    const { view } = await retailOrders.verifyPayment(payment.id, { actorId: users.admin, actorRole: "finance" }, {
      externalReference: "BANK-A8-VERIFY",
      idempotencyKey: makeId("verify"),
    });
    expect(view.payment.status).toBe("paid");
  });

  it("returns seam views verbatim over HTTP on a full drive", async () => {
    await checkoutAs("A9");
    const { payment } = await retailOrders.submitPaymentEvidence(ids.A9, buyerA(), {
      rail: "manual_transfer",
      amount: totals.A9,
      evidenceReference: "BANK-A9",
      idempotencyKey: makeId("ev"),
    });
    const verified = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/payments/${payment.id}/verify`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("verify"))
      .send({ externalReference: "BANK-A9-VERIFY" })
      .expect(201);
    expect(verified.body.view.payment.status).toBe("paid");
    expect(verified.body.view.totals.grandTotal).toBe(totals.A9);
    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.A9}/confirm`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    expect(confirmed.body.totals.grandTotal).toBe(totals.A9);
    // The seam view for the same order matches the HTTP body exactly.
    const seam = await retailOrders.getRetailOrder({ userId: users.admin, role: "admin" }, ids.A9);
    expect(confirmed.body).toEqual(JSON.parse(JSON.stringify(seam)));
  });
});
