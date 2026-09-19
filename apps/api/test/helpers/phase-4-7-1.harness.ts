/**
 * Phase 4.7.1 — shared real-PostgreSQL harness for the payment/shipping/concurrency suites.
 *
 * Every suite boots its own Nest application against its own freshly migrated
 * database (embedded PostgreSQL on 127.0.0.1:55432) with the fake payment and
 * shipping providers ENABLED (`PAYMENT_PROVIDER_MODE=fake`, `SHIPPING_PROVIDER_MODE=fake`,
 * NODE_ENV=test). Assertions in the suites inspect DB state — never only mock call counts.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@kolbe/database";
import { hashAcceptedTerms } from "../../src/modules/pricing/pricing.logic";

export const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
export const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function urlFor(dbName: string): string {
  return `postgres://postgres:postgres@127.0.0.1:55432/${dbName}`;
}

export async function recreateDatabase(dbName: string) {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
}

export async function dropDatabase(dbName: string) {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } catch {
    /* best effort */
  } finally {
    try {
      await admin.end();
    } catch {
      /* ignore */
    }
  }
}

export type Harness = {
  app: INestApplication;
  pool: Pool;
  db: ReturnType<typeof drizzle>;
  ordersService: any;
  inventoryService: any;
  paymentsService: any;
  financeOrchestrator: any;
  paymentProviderOrchestrator: any;
  paymentEventService: any;
  paymentRegistry: any;
  fakePayment: any;
  shippingService: any;
  shippingOrchestrator: any;
  shippingRegistry: any;
  fakeShipping: any;
  issueToken: (userId: string, role: string) => string;
  close: () => Promise<void>;
};

export async function bootHarness(dbName: string, opts: { httpPrefix?: boolean } = {}): Promise<Harness> {
  const url = urlFor(dbName);
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
  await recreateDatabase(dbName);
  execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });

  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = "test";
  process.env.KOLBE_SESSION_SECRET = process.env.KOLBE_SESSION_SECRET || "test-secret-phase-4-7-1";
  process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";
  process.env.PAYMENT_PROVIDER_MODE = "fake";
  process.env.SHIPPING_PROVIDER_MODE = "fake";
  delete process.env.WHOLESALE_PAYMENT_PROVIDER;
  delete process.env.WHOLESALE_SHIPPING_PROVIDER;

  const { AppModule } = await import("../../src/app.module");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  if (opts.httpPrefix !== false) {
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  }
  await app.init();

  const { OrdersService } = await import("../../src/modules/orders/orders.service");
  const { InventoryService } = await import("../../src/modules/inventory/inventory.service");
  const { PaymentsService } = await import("../../src/modules/payments/payments.service");
  const { WholesaleFinanceOrchestrator } = await import("../../src/modules/finance/wholesale-finance.orchestrator");
  const { PaymentProviderOrchestrator } = await import("../../src/modules/finance/payment-provider.orchestrator");
  const { PaymentProviderEventService } = await import("../../src/modules/payments/payment-provider-event.service");
  const { PaymentProviderRegistry } = await import("../../src/modules/payments/payment-provider.registry");
  const { FakePaymentProvider } = await import("../../src/modules/payments/providers/fake-payment.provider");
  const { ShippingService } = await import("../../src/modules/shipping/shipping.service");
  const { ShippingProviderRegistry } = await import("../../src/modules/shipping/shipping-provider.registry");
  const { FakeShippingProvider } = await import("../../src/modules/shipping/providers/fake-shipping.provider");
  let shippingOrchestrator: any = null;
  try {
    const { ShippingOrchestrator } = await import("../../src/modules/shipping/shipping.orchestrator");
    shippingOrchestrator = app.get(ShippingOrchestrator);
  } catch {
    shippingOrchestrator = null;
  }

  const { SessionVerifier } = await import("../../src/common/session");
  const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);

  const pool = new Pool({ connectionString: url });
  pool.on("error", () => {});
  const db = drizzle(pool, { schema: schema as any });

  return {
    app,
    pool,
    db,
    ordersService: app.get(OrdersService),
    inventoryService: app.get(InventoryService),
    paymentsService: app.get(PaymentsService),
    financeOrchestrator: app.get(WholesaleFinanceOrchestrator),
    paymentProviderOrchestrator: app.get(PaymentProviderOrchestrator),
    paymentEventService: app.get(PaymentProviderEventService),
    paymentRegistry: app.get(PaymentProviderRegistry),
    fakePayment: app.get(FakePaymentProvider),
    shippingService: app.get(ShippingService),
    shippingOrchestrator,
    shippingRegistry: app.get(ShippingProviderRegistry),
    fakeShipping: app.get(FakeShippingProvider),
    issueToken: (userId: string, role: string) => verifier.issue(userId, role as any, 0),
    close: async () => {
      try {
        await app.close();
      } catch {
        /* ignore */
      }
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 200));
      await dropDatabase(dbName);
    },
  };
}

export type SupplierContext = {
  supA: string;
  supB: string;
  sellerA: string;
  sellerB: string;
  userBuyer: string;
  userAOwner: string;
  userASales: string;
  userAWarehouse: string;
  userAFinance: string;
  userBOwner: string;
  userAdmin: string;
  prodId: string;
  varId: string;
  offerA: string;
  offerB: string;
  accId: string;
  priceA: bigint;
  priceB: bigint;
};

/** Two suppliers (A with owner/sales/warehouse/finance members, B with owner), one product/variant, offers, buyer account, inventory. */
export async function seedTwoSuppliers(db: ReturnType<typeof drizzle>, opts: { priceA?: bigint; priceB?: bigint; onHand?: number } = {}): Promise<SupplierContext> {
  const priceA = opts.priceA ?? 1000n;
  const priceB = opts.priceB ?? 2000n;
  const onHand = opts.onHand ?? 100;
  const supA = makeId("supA");
  const supB = makeId("supB");
  const sellerA = makeId("sellerA");
  const sellerB = makeId("sellerB");
  const userBuyer = makeId("buyer");
  const userAOwner = makeId("userA_owner");
  const userASales = makeId("userA_sales");
  const userAWarehouse = makeId("userA_wh");
  const userAFinance = makeId("userA_fin");
  const userBOwner = makeId("userB_owner");
  const userAdmin = makeId("admin");
  const prodId = makeId("prod");
  const varId = makeId("var");
  const offerA = makeId("offerA");
  const offerB = makeId("offerB");
  const accId = makeId("acc");

  const user = (id: string, role: string) => ({ id, email: `${id}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0 });
  await db.insert(schema.accountUser).values([
    user(userBuyer, "vip"),
    user(userAOwner, "supplier"),
    user(userASales, "supplier"),
    user(userAWarehouse, "supplier"),
    user(userAFinance, "supplier"),
    user(userBOwner, "supplier"),
    user(userAdmin, "admin"),
  ] as any);
  await db.insert(schema.supplier).values([
    { id: supA, legalName: "Sup A", displayName: "Sup A", status: "approved" },
    { id: supB, legalName: "Sup B", displayName: "Sup B", status: "approved" },
  ] as any);
  await db.insert(schema.seller).values([
    { id: sellerA, type: "SUPPLIER", supplierId: supA, displayName: "Seller A", status: "active" },
    { id: sellerB, type: "SUPPLIER", supplierId: supB, displayName: "Seller B", status: "active" },
  ] as any);
  await db.insert(schema.supplierMember).values([
    { id: makeId("memA_owner"), supplierId: supA, userId: userAOwner, role: "owner", title: "Owner" },
    { id: makeId("memA_sales"), supplierId: supA, userId: userASales, role: "sales", title: "Sales" },
    { id: makeId("memA_wh"), supplierId: supA, userId: userAWarehouse, role: "warehouse", title: "Warehouse" },
    { id: makeId("memA_fin"), supplierId: supA, userId: userAFinance, role: "finance", title: "Finance" },
    { id: makeId("memB_owner"), supplierId: supB, userId: userBOwner, role: "owner", title: "Owner" },
  ] as any);
  await db.insert(schema.product).values({ id: prodId, name: "Prod", slug: `prod-${prodId}`, status: "published" } as any);
  await db.insert(schema.productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active", attributes: {} as any } as any);
  await db.insert(schema.sellerOffer).values([
    { id: offerA, productId: prodId, sellerId: sellerA, variantId: varId, sku: `OFFER-${offerA}`, status: "published", wholesalePrice: priceA as any, currency: "IRR", moq: 1, moqUnit: "PIECE", pricingUnit: "PIECE" as any },
    { id: offerB, productId: prodId, sellerId: sellerB, variantId: varId, sku: `OFFER-${offerB}`, status: "published", wholesalePrice: priceB as any, currency: "IRR", moq: 1, moqUnit: "PIECE", pricingUnit: "PIECE" as any },
  ] as any);
  await db.insert(schema.wholesaleAccount).values({ id: accId, userId: userBuyer, memberName: "Buyer", storeName: "Store", phone: "0912", city: "Tehran", status: "approved" } as any);
  await db.insert(schema.productVariantInventory).values([
    { id: makeId("invA"), variantId: varId, sellerId: sellerA, onHand, reserved: 0, status: "active" },
    { id: makeId("invB"), variantId: varId, sellerId: sellerB, onHand, reserved: 0, status: "active" },
  ] as any);

  return { supA, supB, sellerA, sellerB, userBuyer, userAOwner, userASales, userAWarehouse, userAFinance, userBOwner, userAdmin, prodId, varId, offerA, offerB, accId, priceA, priceB };
}

function snapshotFor(ctx: SupplierContext, which: "A" | "B", quantity: number) {
  const price = which === "A" ? ctx.priceA : ctx.priceB;
  return {
    requestVersion: 0,
    productId: ctx.prodId,
    offerId: which === "A" ? ctx.offerA : ctx.offerB,
    sellerId: which === "A" ? ctx.sellerA : ctx.sellerB,
    supplierId: which === "A" ? ctx.supA : ctx.supB,
    variantId: ctx.varId,
    packageId: null,
    quantity,
    saleUnit: "PIECE",
    pricingUnit: "PIECE",
    pricingTierId: null,
    unitPrice: price.toString(),
    currency: "IRR",
    package: null,
    pieceQuantity: quantity,
    lineTotal: (price * BigInt(quantity)).toString(),
  };
}

/**
 * Creates a draft wholesale order through the canonical command (reservations
 * included). `qtyB = 0` yields a single-child (A only) order.
 */
export async function createOrder(h: Harness, ctx: SupplierContext, opts: { qtyA?: number; qtyB?: number } = {}) {
  const qtyA = opts.qtyA ?? 5;
  const qtyB = opts.qtyB ?? 0;
  const requests: Array<{ requestId: string; expectedVersion: number }> = [];
  const rows: any[] = [];
  const reqA = makeId("wreq_A");
  const snapA = snapshotFor(ctx, "A", qtyA);
  rows.push({ id: reqA, productId: ctx.prodId, offerId: ctx.offerA, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: qtyA, status: "accepted", version: 1, acceptedTermsSnapshot: snapA as any, acceptedTermsHash: hashAcceptedTerms(snapA as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer });
  requests.push({ requestId: reqA, expectedVersion: 1 });
  let reqB: string | null = null;
  if (qtyB > 0) {
    reqB = makeId("wreq_B");
    const snapB = snapshotFor(ctx, "B", qtyB);
    rows.push({ id: reqB, productId: ctx.prodId, offerId: ctx.offerB, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: qtyB, status: "accepted", version: 1, acceptedTermsSnapshot: snapB as any, acceptedTermsHash: hashAcceptedTerms(snapB as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer });
    requests.push({ requestId: reqB, expectedVersion: 1 });
  }
  await h.db.insert(schema.wholesaleRequest).values(rows as any);

  const result = await h.ordersService.createWholesaleOrder({
    requests,
    paymentMode: "transfer",
    shippingAddress: { city: "Tehran", line1: "Valiasr 1", postalCode: "11111" },
    billingAddress: { city: "Tehran", line1: "Valiasr 1", postalCode: "11111" },
    idempotencyKey: makeId("idem_create"),
    buyerUserId: ctx.userBuyer,
  });
  const childA = result.children.find((c: any) => c.sellerId === ctx.sellerA);
  const childB = result.children.find((c: any) => c.sellerId === ctx.sellerB) || null;
  return { order: result.order, childA, childB, reqA, reqB };
}

/** Buyer confirms → proformas issued → parent `awaiting_payment`. */
export async function confirmToAwaitingPayment(h: Harness, orderId: string, buyerUserId: string) {
  return h.financeOrchestrator.confirmOrder({ orderId, buyerUserId, idempotencyKey: makeId("idem_confirm"), actorRole: "buyer" });
}

/** Buyer creates a fake-provider online intent (TxA → provider → TxB). Returns the persisted payment row (snake_case). */
export async function createFakeIntent(h: Harness, orderId: string, buyerUserId: string) {
  const result = await h.financeOrchestrator.createOnlinePaymentIntent({ orderId, buyerUserId, idempotencyKey: makeId("idem_intent"), providerName: "fake", actorRole: "buyer" });
  const paymentId = result.payment.id;
  const row = await h.paymentsService.getPaymentRowById(paymentId);
  return { paymentId, providerReference: String(row.provider_reference), row, result };
}

export function signedFakeHeaders(): Record<string, string> {
  return { "x-fake-signature": process.env.FAKE_PAYMENT_WEBHOOK_SECRET || "fake-payment-webhook-secret" };
}

export function fakeWebhookBody(providerReference: string, opts: { status?: string; eventId?: string; amount?: string; currency?: string } = {}) {
  const body: Record<string, unknown> = { providerReference, status: opts.status ?? "success" };
  if (opts.eventId) body.eventId = opts.eventId;
  if (opts.amount) body.amount = opts.amount;
  if (opts.currency) body.currency = opts.currency;
  return body;
}

export async function q<T = any>(pool: Pool, text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params as any[]);
  return r.rows as T[];
}

export async function one<T = any>(pool: Pool, text: string, params: unknown[] = []): Promise<T> {
  const rows = await q<T>(pool, text, params);
  if (rows.length !== 1) throw new Error(`expected exactly one row, got ${rows.length}: ${text}`);
  return rows[0];
}

export async function count(pool: Pool, text: string, params: unknown[] = []): Promise<number> {
  const rows = await q<{ n: string }>(pool, `SELECT COUNT(*)::text AS n FROM (${text}) sub`, params);
  return Number(rows[0].n);
}

export async function expectDomainError(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (e: any) {
    return e;
  }
  throw new Error("expected promise to reject");
}
