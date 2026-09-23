import path from "node:path";
import { execFileSync } from "node:child_process";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client, Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../packages/database/src/schema/tables";
import { OffersService } from "../src/modules/offers/offers.service";
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";
import { TotpService } from "../src/modules/auth/totp.service";
import { SessionVerifier } from "../src/common/session";

/**
 * Phase 5.11-C — admin security tranche: TOTP high-risk gate, suspicious
 * flags, retail notes.
 *
 * Gate design under test:
 * - Refund approve/complete/fail (HTTP) require TOTP enrollment via
 *   AdminTotpGuard (stateless condition; service seams stay policy-free).
 * - Paid cancel requires TOTP enrollment inside the seam (stateful
 *   condition, read from the live account row in-transaction).
 * - Unpaid cancels, refund filing, flagging, and notes stay RBAC-only.
 * - Customers are exempt everywhere (they act on their own orders).
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_11_admin_c_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

type UserKey = "custA" | "custB" | "adminFull" | "adminBare" | "adminOpen" | "adminOrderView" | "adminOrderManage";

let app: INestApplication;
let pool: Pool;
let db: any;
let retailOrders: RetailOrdersService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r511ac_${Date.now()}_${seq++}`;
const users = {} as Record<UserKey, string>;
const tokens = {} as Record<UserKey, string>;
const ids = {} as Record<string, string>;
const totals = {} as Record<string, string>;

const admin = () => ({ actorId: users.adminFull, actorRole: "admin" });

function orderBody(productId: string, variantId: string, quantity = 2, extra: Record<string, unknown> = {}) {
  return {
    customer: { name: "سارا آزمون", phone: "09121234567", email: "sara@example.test" },
    lines: [{ productId, variantId, quantity }],
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
    idempotencyKey: makeId("key"),
    ...extra,
  };
}

async function checkoutAs(orderTag: string, productTag = "p1", variantTag = "p1v", quantity = 2, extra: Record<string, unknown> = {}) {
  const created = await retailOrders.createRetailOrder(
    { kind: "customer", userId: users.custA },
    orderBody(ids[productTag], ids[variantTag], quantity, extra) as any,
  );
  ids[orderTag] = created.id;
  totals[orderTag] = created.totals.grandTotal;
  return created;
}

async function payOrderGateway(orderTag: string) {
  const { payment } = await retailOrders.submitPaymentEvidence(
    ids[orderTag],
    { actorId: users.custA, actorRole: "customer" },
    { rail: "manual_transfer", amount: totals[orderTag], evidenceReference: `BANK-${orderTag}`, idempotencyKey: makeId("ev") },
  );
  const { view } = await retailOrders.verifyPayment(payment.id, admin(), {
    externalReference: `BANK-${orderTag}-VERIFY`,
    idempotencyKey: makeId("verify"),
  });
  expect(view.payment.status).toBe("paid");
  return view;
}

const get = (url: string, token?: string) => {
  const req = request(app.getHttpServer()).get(url);
  return token ? req.set("authorization", `Bearer ${token}`) : req;
};
const post = (url: string, token?: string, body: unknown = {}) => {
  const req = request(app.getHttpServer()).post(url);
  return (token ? req.set("authorization", `Bearer ${token}`) : req).send(body as any);
};

async function auditRows(action: string, entityId: string) {
  return db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.entityId, entityId)));
}

describe("Phase 5.11-C admin security", () => {
  beforeAll(async () => {
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
      await adminClient.query(`CREATE DATABASE "${TEST_DB}" TEMPLATE template0 LC_COLLATE 'C.utf8' LC_CTYPE 'C.utf8'`);
    } finally {
      await adminClient.end();
    }
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-p511c-sec";
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

    const roles: Array<[UserKey, "customer" | "admin"]> = [
      ["custA", "customer"],
      ["custB", "customer"],
      ["adminFull", "admin"],
      ["adminBare", "admin"],
      ["adminOpen", "admin"],
      ["adminOrderView", "admin"],
      ["adminOrderManage", "admin"],
    ];
    for (const [name, role] of roles) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    // adminFull is the setup workhorse (setup-time paid cancels) and is
    // enrolled directly; T1 performs the only HTTP enroll-verify ceremony
    // (adminBare). Every other actor stays unenrolled and proves it.
    const grants: Array<[UserKey, string[]]> = [
      ["adminOrderView", ["retail:order:view"]],
      ["adminOrderManage", ["retail:order:manage"]],
    ];
    for (const [name, actions] of grants) {
      const roleId = makeId(`role_${name}`);
      await db.insert(schema.adminRole).values({ id: roleId, name: roleId, displayName: roleId });
      for (const action of actions) {
        await db.insert(schema.adminRolePermission).values({ id: makeId("perm"), roleId, action });
      }
      await db.insert(schema.adminUserRole).values({ id: makeId("aur"), userId: users[name], roleId, assignedBy: users.adminFull });
    }
    await db.update(schema.accountUser).set({ totpSecret: "JBSWY3DPEHPK3PXP", totpEnabled: true, totpEnrolledAt: new Date() }).where(eq(schema.accountUser.id, users.adminFull));
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    for (const [name, role] of roles) {
      tokens[name] = verifier.issue(users[name], role, 0);
    }

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    for (const tag of ["p1"]) {
      ids[tag] = makeId("prod");
      await db.insert(schema.product).values({ id: ids[tag], name: `Sec Product ${tag}`, slug: `sec-${ids[tag]}`, ownerType: "KOLBE", status: "published" });
      ids[`${tag}v`] = makeId("var");
      await db.insert(schema.productVariant).values({ id: ids[`${tag}v`], productId: ids[tag], sku: `SKU-${ids[`${tag}v`]}`, status: "active", attributes: { size: "M" } as any });
      await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids[tag], sellerId: kolbeSellerId, variantId: ids[`${tag}v`], sku: `OFFER-${ids[`${tag}v`]}`, status: "published", retailPrice: 250000n as any });
      await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids[`${tag}v`], sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });
    }
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

  it("T1 blocks high-risk acts for the unenrolled, then the real enroll-verify ceremony unlocks them", async () => {
    await checkoutAs("H1");
    await payOrderGateway("H1");
    // Unenrolled but fully permissioned: paid cancel is refused with the
    // existing auth-domain code, and nothing mutated.
    const refused = await post(`/api/v1/admin/retail/orders/${ids.H1}/cancel`, tokens.adminBare).expect(401);
    expect(refused.body.error).toBe("TOTP_REQUIRED");
    const stillPlaced = await retailOrders.getRetailOrder({ userId: users.adminFull, role: "admin" }, ids.H1);
    expect(stillPlaced.status).toBe("placed");
    expect(stillPlaced.payment.status).toBe("paid");
    // A second paid order reaches cancelled via the TOTP-free customer
    // self-cancel, so the unenrolled admin can file (filing is NOT
    // high-risk: money moves only on approve/complete) but not advance.
    await checkoutAs("H1c");
    await payOrderGateway("H1c");
    await post(`/api/v1/customer/orders/${ids.H1c}/cancel`, tokens.custA, { reason: "t1 setup" }).expect(201);
    const filed = await post(`/api/v1/admin/retail/orders/${ids.H1c}/refunds`, tokens.adminBare, { amount: totals.H1c, idempotencyKey: makeId("k") }).expect(201);
    const refundId = filed.body.refund.id as string;
    for (const [route, body] of [["approve", { idempotencyKey: makeId("k") }], ["complete", { externalReference: "BANK-H1", idempotencyKey: makeId("k") }], ["fail", { reason: "x", idempotencyKey: makeId("k") }]] as const) {
      const blocked = await post(`/api/v1/admin/retail/refunds/${refundId}/${route}`, tokens.adminBare, body).expect(401);
      expect(blocked.body.error).toBe("TOTP_REQUIRED");
    }
    // Bootstrap ceremony over real HTTP: enroll returns the secret exactly
    // once, verify with a live TOTP code completes enrollment.
    const enrolled = await post("/api/v1/auth/totp/enroll", tokens.adminBare).expect(201);
    expect(typeof enrolled.body.secret).toBe("string");
    expect(enrolled.body.otpauthUrl).toContain("otpauth://totp/");
    const code = new TotpService().generateCode(enrolled.body.secret as string);
    const verified = await post("/api/v1/auth/totp/verify", tokens.adminBare, { code }).expect(201);
    expect(JSON.stringify(verified.body)).not.toContain(enrolled.body.secret);
    // The same acts now succeed; no response leaks the secret.
    const cancelled = await post(`/api/v1/admin/retail/orders/${ids.H1}/cancel`, tokens.adminBare).expect(200);
    expect(JSON.stringify(cancelled.body)).not.toContain(enrolled.body.secret);
    expect(cancelled.body.order?.status ?? cancelled.body.status).toBe("cancelled");
    const approved = await post(`/api/v1/admin/retail/refunds/${refundId}/approve`, tokens.adminBare, { idempotencyKey: makeId("k") }).expect(201);
    expect(JSON.stringify(approved.body)).not.toContain(enrolled.body.secret);
    const completed = await post(`/api/v1/admin/retail/refunds/${refundId}/complete`, tokens.adminBare, { externalReference: "BANK-H1-OUT", idempotencyKey: makeId("k") }).expect(201);
    expect(completed.body.refund?.status ?? completed.body.status).toBe("completed");
    ids.H1_REFUND = refundId;
  });

  it("T2 never locks out at bootstrap: password login works until enrollment, then the code is required", async () => {
    const email = `boot_${Date.now()}@test.local`;
    const registered = await post("/api/v1/auth/register", undefined, { email, password: "Sup3r-Secret-Password", name: "Boot" }).expect(201);
    const userId = registered.body.user.id as string;
    expect(registered.body.user.role).toBe("customer");
    const verifier2 = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    const userToken = verifier2.issue(userId, "customer", 0);
    // Pre-enrollment: plain password login succeeds (no lockout).
    const plain = await post("/api/v1/auth/login", undefined, { email, password: "Sup3r-Secret-Password" }).expect(201);
    expect(plain.body.user.id).toBe(userId);
    // Enroll + verify, then the password alone is no longer enough.
    const enrolled = await post("/api/v1/auth/totp/enroll", userToken).expect(201);
    await post("/api/v1/auth/totp/verify", userToken, { code: new TotpService().generateCode(enrolled.body.secret as string) }).expect(201);
    const needCode = await post("/api/v1/auth/login", undefined, { email, password: "Sup3r-Secret-Password" }).expect(401);
    expect(needCode.body.error).toBe("TOTP_REQUIRED");
    const withCode = await post("/api/v1/auth/login", undefined, {
      email,
      password: "Sup3r-Secret-Password",
      totpCode: new TotpService().generateCode(enrolled.body.secret as string),
    }).expect(201);
    expect(withCode.body.user.id).toBe(userId);
  });

  it("T3 keeps unpaid cancels and customer self-cancels TOTP-free", async () => {
    await checkoutAs("U1");
    const unpaid = await post(`/api/v1/admin/retail/orders/${ids.U1}/cancel`, tokens.adminOpen).expect(200);
    expect(unpaid.body.order?.status ?? unpaid.body.status).toBe("cancelled");
    await checkoutAs("P1");
    await payOrderGateway("P1");
    // The buyer cancels their own PAID order with no TOTP anywhere.
    const self = await post(`/api/v1/customer/orders/${ids.P1}/cancel`, tokens.custA, { reason: "changed mind" }).expect(201);
    expect(self.body.order?.status ?? self.body.status).toBe("cancelled");
  });

  it("T4 checks permission before TOTP and keeps non-admins out", async () => {
    await checkoutAs("G1");
    await payOrderGateway("G1");
    await retailOrders.cancelRetailOrder(ids.G1, admin());
    const filed = await post(`/api/v1/admin/retail/orders/${ids.G1}/refunds`, tokens.adminFull, { amount: totals.G1, idempotencyKey: makeId("k") }).expect(201);
    // Unenrolled AND under-privileged → 403 (perm gate runs first, and the
    // TOTP gate never gets consulted, so no 401 leaks capability info).
    const denied = await post(`/api/v1/admin/retail/refunds/${filed.body.refund.id}/approve`, tokens.adminOrderView, { idempotencyKey: makeId("k") }).expect(403);
    expect(denied.body.error).toBe("ADMIN_PERMISSION_DENIED");
    // Customers are refused by role, not by TOTP.
    const customer = await post(`/api/v1/admin/retail/refunds/${filed.body.refund.id}/approve`, tokens.custA, { idempotencyKey: makeId("k") }).expect(403);
    expect(customer.body.error).not.toBe("TOTP_REQUIRED");
  });

  it("T5 flags, re-flags, and clears without ever mutating the order", async () => {
    await checkoutAs("F1");
    const before = await retailOrders.getRetailOrder({ userId: users.adminFull, role: "admin" }, ids.F1);
    const flagged = await post(`/api/v1/admin/retail/orders/${ids.F1}/suspicious`, tokens.adminOrderManage, { reason: "parcel rerouted twice" }).expect(201);
    expect(flagged.body).toMatchObject({ flagged: true });
    expect(flagged.body.flag).toMatchObject({ reason: "parcel rerouted twice", flaggedBy: users.adminOrderManage });
    expect(typeof flagged.body.flag.flaggedAt).toBe("string");
    // Flagging is review metadata: the commercial record is untouched.
    const after = await retailOrders.getRetailOrder({ userId: users.adminFull, role: "admin" }, ids.F1);
    expect(after).toEqual(before);
    // A view-only actor can see the flag but cannot change it.
    const seen = await get(`/api/v1/admin/retail/orders/${ids.F1}/suspicious`, tokens.adminOrderView).expect(200);
    expect(seen.body).toMatchObject({ flagged: true });
    await post(`/api/v1/admin/retail/orders/${ids.F1}/suspicious`, tokens.adminOrderView, { reason: "x" }).expect(403);
    // Re-flag overwrites (200, not 201); clear stamps and audits; clear is idempotent.
    const reflagged = await post(`/api/v1/admin/retail/orders/${ids.F1}/suspicious`, tokens.adminOrderManage, { reason: "second look" }).expect(200);
    expect(reflagged.body.flag.reason).toBe("second look");
    expect(reflagged.body.flag.clearedAt).toBeNull();
    const cleared = await post(`/api/v1/admin/retail/orders/${ids.F1}/suspicious/clear`, tokens.adminOrderManage, { reason: "false alarm" }).expect(200);
    expect(cleared.body).toMatchObject({ flagged: false, cleared: true });
    expect(cleared.body.flag).toMatchObject({ clearedBy: users.adminOrderManage, clearedReason: "false alarm" });
    const again = await post(`/api/v1/admin/retail/orders/${ids.F1}/suspicious/clear`, tokens.adminOrderManage).expect(200);
    expect(again.body).toMatchObject({ flagged: false, cleared: false });
    const final = await get(`/api/v1/admin/retail/orders/${ids.F1}/suspicious`, tokens.adminOrderView).expect(200);
    expect(final.body.flagged).toBe(false);
    expect(final.body.flag.clearedReason).toBe("false alarm");
  });

  it("T6 refuses flag misuse honestly and clears ghosts idempotently", async () => {
    await post("/api/v1/admin/retail/orders/ghost_order/suspicious", tokens.adminOrderManage, { reason: "x" }).expect(404);
    const ghost = await post("/api/v1/admin/retail/orders/ghost_order/suspicious", tokens.adminOrderManage, { reason: "x" });
    expect(ghost.body.error).toBe("RETAIL_ORDER_NOT_FOUND");
    await checkoutAs("E1");
    for (const body of [{ reason: "" }, { reason: "x".repeat(501) }, {}]) {
      const bad = await post(`/api/v1/admin/retail/orders/${ids.E1}/suspicious`, tokens.adminOrderManage, body).expect(422);
      expect(bad.body.error).toBe("VALIDATION_FAILED");
    }
    const badClear = await post(`/api/v1/admin/retail/orders/${ids.E1}/suspicious/clear`, tokens.adminOrderManage, { reason: "x".repeat(501) }).expect(422);
    expect(badClear.body.error).toBe("VALIDATION_FAILED");
    // Clearing an order that was never flagged is a no-op success.
    const noop = await post(`/api/v1/admin/retail/orders/${ids.E1}/suspicious/clear`, tokens.adminOrderManage).expect(200);
    expect(noop.body).toMatchObject({ flagged: false, cleared: false });
    // Customers cannot see flag state.
    await get(`/api/v1/admin/retail/orders/${ids.E1}/suspicious`, tokens.custA).expect(403);
  });

  it("T7 converges racing flag and clear pairs without errors", async () => {
    await checkoutAs("R1");
    const racers = [];
    for (let i = 0; i < 3; i++) {
      racers.push(post(`/api/v1/admin/retail/orders/${ids.R1}/suspicious`, tokens.adminOrderManage, { reason: `race-${i}` }));
      racers.push(post(`/api/v1/admin/retail/orders/${ids.R1}/suspicious/clear`, tokens.adminOrderManage, { reason: `clear-${i}` }));
    }
    const settled = await Promise.all(racers);
    for (const res of settled) {
      expect([200, 201]).toContain(res.status);
    }
    // Final state is coherent: either a live flag or a stamped clear.
    const rows = await db.select().from(schema.retailOrderSuspiciousFlag).where(eq(schema.retailOrderSuspiciousFlag.retailOrderId, ids.R1));
    expect(rows).toHaveLength(1);
    const live = await get(`/api/v1/admin/retail/orders/${ids.R1}/suspicious`, tokens.adminOrderView).expect(200);
    expect(live.body.flagged).toBe(rows[0].clearedAt === null);
    const audits = await auditRows("retail_order.suspicious_flagged", rows[0].id);
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("T8 files and reads retail notes under the existing notes permissions", async () => {
    await checkoutAs("N1");
    // Least-privilege actors without notes rights are refused.
    await post("/api/v1/admin/notes", tokens.adminOrderView, { targetType: "retail_order", targetId: ids.N1, noteText: "x" }).expect(403);
    await get(`/api/v1/admin/notes?targetType=retail_order&targetId=${ids.N1}`, tokens.adminOrderView).expect(403);
    // A notes-powered admin files retail notes through the reused seam.
    const orderNote = await post("/api/v1/admin/notes", tokens.adminOpen, { targetType: "retail_order", targetId: ids.N1, noteText: "call before dispatch" }).expect(201);
    expect(orderNote.body.note).toMatchObject({ targetType: "retail_order", targetId: ids.N1, noteText: "call before dispatch" });
    const customerNote = await post("/api/v1/admin/notes", tokens.adminOpen, { targetType: "retail_customer", targetId: users.custA, noteText: "prefers morning delivery" }).expect(201);
    expect(customerNote.body.note.targetType).toBe("retail_customer");
    const listed = await get(`/api/v1/admin/notes?targetType=retail_order&targetId=${ids.N1}`, tokens.adminOpen).expect(200);
    expect(listed.body.notes.map((n: any) => n.noteText)).toContain("call before dispatch");
    expect(listed.body.notes[0].authorId).toBe(users.adminOpen);
  });

  it("T9 audits every high-risk act and every flag transition", async () => {
    const cancelPending = await auditRows("retail_order.cancel_pending_refund", ids.H1);
    expect(cancelPending.length).toBe(1);
    expect(cancelPending[0].actorId).toBe(users.adminBare);
    const approved = await auditRows("refund.approved", ids.H1_REFUND);
    expect(approved.length).toBe(1);
    // The T1 refund was filed on H1c (H1 stayed paid-but-uncancelled until after filing was proven).
    const completed = await auditRows("retail_order.refund_completed", ids.H1c);
    expect(completed.length).toBe(1);
    const flagRows = await db.select().from(schema.retailOrderSuspiciousFlag).where(eq(schema.retailOrderSuspiciousFlag.retailOrderId, ids.F1));
    expect(flagRows).toHaveLength(1);
    const flagged = await auditRows("retail_order.suspicious_flagged", flagRows[0].id);
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    expect(flagged[0].actorId).toBe(users.adminOrderManage);
    const cleared = await auditRows("retail_order.suspicious_cleared", flagRows[0].id);
    expect(cleared.length).toBe(1);
  });

  it("T10 exposes enrollment state but never the secret", async () => {
    const me = await get("/api/v1/auth/me", tokens.adminBare).expect(200);
    expect(me.body.totpEnabled).toBe(true);
    for (const token of ["secret", "totpSecret", "totp_secret", "otpauth"]) {
      expect(JSON.stringify(me.body)).not.toContain(token);
    }
    const meOpen = await get("/api/v1/auth/me", tokens.adminOpen).expect(200);
    expect(meOpen.body.totpEnabled).toBe(false);
  });
});
