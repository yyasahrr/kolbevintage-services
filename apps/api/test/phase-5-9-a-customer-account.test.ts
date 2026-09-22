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

/**
 * Phase 5.9-A — customer account HTTP surface (Nest e2e).
 *
 * GET/PATCH /api/v1/customer/account (profile), /addresses CRUD +
 * make-default + archive, /orders history + detail. Session-only, buyer
 * roles; ownership enforced structurally by the session subject. Real
 * PostgreSQL, full Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_9_a_customer_account_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_c59a_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "custB" | "admin" | "supplier", string>;
const tokens = {} as Record<"custA" | "custB" | "admin" | "supplier", string>;
const ids = {} as Record<string, string>;

function addressBody(overrides: Record<string, unknown> = {}) {
  return {
    label: "خانه",
    recipientName: "سارا آزمون",
    recipientPhone: "09121234567",
    province: "تهران",
    city: "تهران",
    addressLine: "خیابان آزمون، پلاک ۱",
    plaque: "۱",
    unit: "۲",
    postalCode: "1234567890",
    ...overrides,
  };
}

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "سارا آزمون", phone: "09121234567", email: "sara@example.test" },
    lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 1 }],
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

const api = (token?: string) => {
  const agent = request(app.getHttpServer());
  const withAuth = (req: any) => (token ? req.set("authorization", `Bearer ${token}`) : req);
  return {
    get: (url: string) => withAuth(agent.get(url)),
    post: (url: string, body?: unknown) => withAuth(agent.post(url).send(body)),
    patch: (url: string, body?: unknown) => withAuth(agent.patch(url).send(body)),
    delete: (url: string) => withAuth(agent.delete(url)),
  };
};

describe("Phase 5.9-A customer account", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    } finally {
      await admin.end();
    }
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-p59a-customer-account";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_URL });
    const db = drizzle(pool, { schema: schema as any });

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["admin", "admin"], ["supplier", "supplier"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    for (const name of ["custA", "custB", "admin", "supplier"] as const) {
      tokens[name] = verifier.issue(users[name], name === "custA" || name === "custB" ? "customer" : name, 0);
    }

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Account Product", slug: `acct-${ids.p1}`, ownerType: "KOLBE", status: "published" });
    ids.v1 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v1, productId: ids.p1, sku: `SKU-${ids.v1}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.v1, sku: `OFFER-${ids.v1}`, status: "published", retailPrice: 250000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v1, sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it("reads the own profile and rejects anonymous callers", async () => {
    const response = await api(tokens.custA).get("/api/v1/customer/account").expect(200);
    expect(response.body).toMatchObject({ id: users.custA, role: "customer", status: "active" });
    expect(response.body.email).toContain("@test.com");
    await api().get("/api/v1/customer/account").expect(401);
  });

  it("rejects non-buyer roles on the self-service surface", async () => {
    await api(tokens.admin).get("/api/v1/customer/account").expect(403);
    await api(tokens.supplier).patch("/api/v1/customer/account", { displayName: "x" }).expect(403);
  });

  it("updates displayName/phone but ignores identity escalation fields", async () => {
    const before = await api(tokens.custA).get("/api/v1/customer/account").expect(200);
    const response = await api(tokens.custA)
      .patch("/api/v1/customer/account", {
        displayName: "سارا جدید",
        phone: "09987654321",
        role: "admin",
        email: "evil@example.test",
        status: "suspended",
      })
      .expect(200);
    expect(response.body).toMatchObject({ id: users.custA, displayName: "سارا جدید", phone: "09987654321", role: "customer", status: "active" });
    expect(response.body.email).toBe(before.body.email);
    const row = await pool.query("SELECT role,email,status FROM account_user WHERE id=$1", [users.custA]);
    expect(row.rows[0]).toMatchObject({ role: "customer", email: before.body.email, status: "active" });
    const audit = await pool.query("SELECT action,entity_type FROM audit_log WHERE entity_id=$1 AND action='customer_profile.updated'", [users.custA]);
    expect(audit.rows).toHaveLength(1);
  });

  it("rejects invalid profile input without writing", async () => {
    await api(tokens.custA).patch("/api/v1/customer/account", { phone: "12345" }).expect(400);
    await api(tokens.custA).patch("/api/v1/customer/account", { displayName: "   " }).expect(400);
    const row = await pool.query("SELECT display_name,phone FROM account_user WHERE id=$1", [users.custA]);
    expect(row.rows[0]).toMatchObject({ display_name: "سارا جدید", phone: "09987654321" });
  });

  it("runs the address book lifecycle: create, default switch, update, conflict, archive", async () => {
    const a = await api(tokens.custA).post("/api/v1/customer/addresses", addressBody({ label: "خانه", isDefault: true })).expect(201);
    expect(a.body).toMatchObject({ label: "خانه", city: "تهران", isDefault: true, version: 0 });
    expect(a.body.userId).toBeUndefined();
    ids.addrA = a.body.id;

    const b = await api(tokens.custA).post("/api/v1/customer/addresses", addressBody({ label: "محل کار" })).expect(201);
    ids.addrB = b.body.id;
    expect(b.body.isDefault).toBe(false);

    const made = await api(tokens.custA).post(`/api/v1/customer/addresses/${ids.addrB}/make-default`).expect(201);
    expect(made.body.isDefault).toBe(true);
    const list = await api(tokens.custA).get("/api/v1/customer/addresses").expect(200);
    expect(list.body.addresses).toHaveLength(2);
    expect(list.body.addresses[0].id).toBe(ids.addrB); // default first
    expect(list.body.addresses.find((row: any) => row.id === ids.addrA).isDefault).toBe(false);

    // Unsetting the default directly is rejected: pick a replacement instead.
    await api(tokens.custA).patch(`/api/v1/customer/addresses/${ids.addrB}`, { isDefault: false, version: made.body.version }).expect(422);

    // Optimistic update: happy path then stale-version conflict.
    const updated = await api(tokens.custA)
      .patch(`/api/v1/customer/addresses/${ids.addrA}`, { city: "کرج", version: a.body.version })
      .expect(200);
    expect(updated.body).toMatchObject({ city: "کرج", version: 1 });
    await api(tokens.custA).patch(`/api/v1/customer/addresses/${ids.addrA}`, { city: "قم", version: 0 }).expect(409);
    await api(tokens.custA).patch(`/api/v1/customer/addresses/${ids.addrA}`, { city: "قم" }).expect(400);

    // Soft archive: gone from the list, immutable afterwards, row retained.
    const archived = await api(tokens.custA).delete(`/api/v1/customer/addresses/${ids.addrA}`).expect(200);
    expect(archived.body).toMatchObject({ id: ids.addrA });
    expect(typeof archived.body.archivedAt).toBe("string");
    const after = await api(tokens.custA).get("/api/v1/customer/addresses").expect(200);
    expect(after.body.addresses.map((row: any) => row.id)).toEqual([ids.addrB]);
    await api(tokens.custA).patch(`/api/v1/customer/addresses/${ids.addrA}`, { city: "x", version: 2 }).expect(404);
    const retained = await pool.query("SELECT archived_at FROM customer_address WHERE id=$1", [ids.addrA]);
    expect(retained.rows).toHaveLength(1);
    expect(retained.rows[0].archived_at).not.toBeNull();

    const audit = await pool.query("SELECT action FROM audit_log WHERE entity_type='customer_address' AND actor_id=$1 ORDER BY action", [users.custA]);
    expect(audit.rows.map((row) => row.action)).toEqual([
      "customer_address.archived",
      "customer_address.created",
      "customer_address.created",
      "customer_address.default_changed",
      "customer_address.updated",
    ]);
  });

  it("validates address input and sanitizes display text", async () => {
    await api(tokens.custA).post("/api/v1/customer/addresses", addressBody({ recipientPhone: "123" })).expect(400);
    await api(tokens.custA).post("/api/v1/customer/addresses", addressBody({ postalCode: "123" })).expect(400);
    await api(tokens.custA).post("/api/v1/customer/addresses", addressBody({ recipientName: "" })).expect(400);
    const xss = await api(tokens.custA)
      .post("/api/v1/customer/addresses", addressBody({ recipientName: "<script>alert(1)</script>", addressLine: "a<b>c" }))
      .expect(201);
    expect(xss.body.recipientName).toBe("scriptalert(1)/script");
    expect(xss.body.addressLine).toBe("abc");
  });

  it("enforces address ownership across customers", async () => {
    await api(tokens.custB).get("/api/v1/customer/addresses").expect(200).then((response) => {
      expect(response.body.addresses).toEqual([]);
    });
    await api(tokens.custB).patch(`/api/v1/customer/addresses/${ids.addrB}`, { city: "x", version: 1 }).expect(403);
    await api(tokens.custB).post(`/api/v1/customer/addresses/${ids.addrB}/make-default`).expect(403);
    await api(tokens.custB).delete(`/api/v1/customer/addresses/${ids.addrB}`).expect(403);
    await api(tokens.custA).patch("/api/v1/customer/addresses/cadr_missing", { city: "x", version: 0 }).expect(404);
    await api(tokens.custA).post("/api/v1/customer/addresses/cadr_missing/make-default").expect(404);
    await api(tokens.custA).delete("/api/v1/customer/addresses/cadr_missing").expect(404);
    await api().get("/api/v1/customer/addresses").expect(401);
  });

  it("lists own order history newest-first with cursor pagination", async () => {
    const first = await api(tokens.custA)
      .post("/api/v1/retail/orders", orderBody())
      .set("Idempotency-Key", makeId("key"))
      .expect(201);
    const second = await api(tokens.custA)
      .post("/api/v1/retail/orders", orderBody())
      .set("Idempotency-Key", makeId("key"))
      .expect(201);
    ids.order1 = first.body.id;
    ids.order2 = second.body.id;
    expect(second.body.orderCode).not.toBe(first.body.orderCode);
    // Customer checkout emits no guest capability.
    expect(second.body.guestCapability).toBeUndefined();

    const page1 = await api(tokens.custA).get("/api/v1/customer/orders?limit=1").expect(200);
    expect(page1.body.orders).toHaveLength(1);
    expect(page1.body.orders[0].id).toBe(ids.order2);
    expect(page1.body.orders[0]).toMatchObject({ status: "placed", grandTotal: "339000", currency: "IRR" });
    expect(typeof page1.body.nextCursor).toBe("string");

    const page2 = await api(tokens.custA).get(`/api/v1/customer/orders?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`).expect(200);
    expect(page2.body.orders).toHaveLength(1);
    expect(page2.body.orders[0].id).toBe(ids.order1);
    expect(page2.body.nextCursor).toBeNull();

    // Other customers see none of these; bad paging fails closed.
    const other = await api(tokens.custB).get("/api/v1/customer/orders").expect(200);
    expect(other.body).toEqual({ orders: [], nextCursor: null });
    await api(tokens.custA).get("/api/v1/customer/orders?cursor=!!!").expect(400);
    await api(tokens.custA).get("/api/v1/customer/orders?limit=101").expect(400);
  });

  it("merges order detail with shipments and enforces ownership", async () => {
    const detail = await api(tokens.custA).get(`/api/v1/customer/orders/${ids.order1}`).expect(200);
    expect(detail.body.order.id).toBe(ids.order1);
    expect(detail.body.order.lines).toHaveLength(1);
    expect(detail.body.shipping.orderId).toBe(ids.order1);
    expect(Array.isArray(detail.body.shipping.shipments)).toBe(true);

    await api(tokens.custB).get(`/api/v1/customer/orders/${ids.order1}`).expect(403);
    await api(tokens.custA).get("/api/v1/customer/orders/ro_missing").expect(404);
    await api().get(`/api/v1/customer/orders/${ids.order1}`).expect(401);
  });
});
