/**
 * گام ۶.۷ — آزمونِ «رفت‌وبرگشتِ بدونِ اتلافِ» چرخهٔ عمرِ محصولِ تأمین‌کننده.
 *
 * این آزمون **mock نیست**: یک Nest واقعی روی PostgreSQL واقعی بالا می‌آید و پس از
 * تأییدِ ادمین، جدول‌های کانونیکال را **دوباره از دیتابیس می‌خواند**. یعنی
 * «ماندگاری» اثبات می‌شود، نه «متد success برگرداند».
 *
 * ثابتِ حاکم: آنچه ادمین تأیید می‌کند = آنچه کانونیکال می‌شود؛ بدونِ اتلافِ
 * بی‌صدا و بدونِ پیش‌فرضِ پنهانی که قصدِ تأمین‌کننده را پاک کند.
 */

import { execFileSync } from "node:child_process";
import { scryptSync } from "node:crypto";
import path from "node:path";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { Client, Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../packages/database/src/schema/tables";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_6_7_roundtrip_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const PASSWORD = "Kolbe!Roundtrip123";

let pool: Pool;
let db: any;
let app: any;
let http: any;
let catalog: any;
let ids: Record<string, string>;

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * گرافِ مرحله‌بندی‌شدهٔ **غنی** — همان چیزی که یک تأمین‌کنندهٔ واقعی ارسال می‌کند.
 *
 * شش واریانت (دو رنگ × سه سایز)، رسانهٔ محصول و واریانت، پیشنهادِ تجاری با
 * MOQ=2 و واحدِ SERIES، یک بستهٔ SIZE_RUN با ترکیبِ صریح، سه پلهٔ قیمتِ
 * بدونِ هم‌پوشانی، و موجودیِ پیشنهادی برای هر واریانت.
 */
function richStagedGraph() {
  /**
   * SKUها در هر نمونه یکتا ساخته می‌شوند.
   *
   * چرا؟ `product.sku` و `product_variant.sku` در اسکیما `unique()` هستند، پس
   * اگر هر نمونه SKU ثابت داشته باشد، دومین تأیید به قیدِ یکتایی می‌خورد. این
   * یک محدودیتِ آزمون است نه باگِ محصول: دو تأمین‌کنندهٔ واقعی هم نمی‌توانند
   * SKU یکسان ثبت کنند.
   */
  const tag = makeId("g").toUpperCase();
  const sku = (base: string) => `${base}-${tag}`;
  return {
    name: "پیراهن لینن آزمایشی",
    slug: `linen-shirt-${makeId("s")}`,
    description: "پیراهن لینن سبک مناسب فصل گرم، دوخت ایرانی.",
    brandId: ids.brandId,
    categoryId: ids.categoryId,
    attributes: { color_family: "خنثی", material: "لینن", fit: "regular", origin: "ایران" },
    variants: [
      { sku: sku("LINEN-BLACK-S"), attributes: { color: "مشکی", size: "S", material: "لینن" }, status: "active", inventory: { onHand: 40 } },
      { sku: sku("LINEN-BLACK-M"), attributes: { color: "مشکی", size: "M", material: "لینن" }, status: "active", inventory: { onHand: 60 } },
      { sku: sku("LINEN-BLACK-L"), attributes: { color: "مشکی", size: "L", material: "لینن" }, status: "active", inventory: { onHand: 20 } },
      { sku: sku("LINEN-CREAM-S"), attributes: { color: "کرم", size: "S", material: "لینن" }, status: "active", inventory: { onHand: 15 } },
      { sku: sku("LINEN-CREAM-M"), attributes: { color: "کرم", size: "M", material: "لینن" }, status: "active", inventory: { onHand: 25 } },
      { sku: sku("LINEN-CREAM-L"), attributes: { color: "کرم", size: "L", material: "لینن" }, status: "draft", inventory: { onHand: 5 } },
    ],
    media: [
      { url: "https://cdn.kolbe.test/linen/main.jpg", type: "image", position: 0 },
      { url: "https://cdn.kolbe.test/linen/gallery-1.jpg", type: "image", position: 1 },
      { url: "https://cdn.kolbe.test/linen/black-s.jpg", type: "image", position: 0, variantSku: sku("LINEN-BLACK-S") },
    ],
    commercial: {
      sku: sku("LINEN-SHIRT"),
      wholesalePrice: "1250000",
      retailPrice: "1890000",
      currency: "IRR",
      moq: 2,
      moqUnit: "SERIES",
      packageType: "SIZE_RUN",
      packages: [
        {
          packageType: "SIZE_RUN",
          name: "سری سایزبندی S-L",
          description: "سری کامل سایزهای S تا L از رنگ مشکی",
          items: [
            { sku: sku("LINEN-BLACK-S"), quantity: 2 },
            { sku: sku("LINEN-BLACK-M"), quantity: 2 },
            { sku: sku("LINEN-BLACK-L"), quantity: 2 },
          ],
        },
      ],
      pricingTiers: [
        { minQuantity: 2, maxQuantity: 9, unitPrice: "1250000", moqUnit: "SERIES" },
        { minQuantity: 10, maxQuantity: 49, unitPrice: "1180000", moqUnit: "SERIES" },
        { minQuantity: 50, unitPrice: "1090000", moqUnit: "SERIES" },
      ],
    },
  };
}

async function recreateDatabase() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.end();
  }
}

async function seed() {
  const salt = "kolbe-roundtrip-salt";
  const passwordHash = scryptSync(PASSWORD, salt, 64).toString("hex");
  const supplierUser = makeId("usr_sup");
  const adminUser = makeId("usr_adm");
  const otherSupplierUser = makeId("usr_sup2");
  const supplierId = makeId("sup");
  const otherSupplierId = makeId("sup2");
  const sellerId = makeId("sel");
  const otherSellerId = makeId("sel2");
  const categoryId = makeId("cat");
  const brandId = makeId("brn");
  const roleId = makeId("role");

  await db.insert(schema.accountUser).values([
    { id: supplierUser, email: `${supplierUser}@kolbe.test`, passwordHash, salt, role: "supplier", status: "active", tokenVersion: 0, failedLoginAttempts: 0 },
    { id: adminUser, email: `${adminUser}@kolbe.test`, passwordHash, salt, role: "admin", status: "active", tokenVersion: 0, failedLoginAttempts: 0 },
    { id: otherSupplierUser, email: `${otherSupplierUser}@kolbe.test`, passwordHash, salt, role: "supplier", status: "active", tokenVersion: 0, failedLoginAttempts: 0 },
  ]);
  await db.insert(schema.supplier).values([
    { id: supplierId, legalName: "تأمین‌کنندهٔ آزمایشی", displayName: "Kolbe Test Supplier", status: "approved" },
    { id: otherSupplierId, legalName: "تأمین‌کنندهٔ دیگر", displayName: "Other Supplier", status: "approved" },
  ]);
  await db.insert(schema.seller).values([
    { id: sellerId, type: "SUPPLIER", supplierId, displayName: "Seller Test", status: "active" },
    { id: otherSellerId, type: "SUPPLIER", supplierId: otherSupplierId, displayName: "Seller Other", status: "active" },
  ]);
  await db.insert(schema.supplierMember).values([
    { id: makeId("mem"), supplierId, userId: supplierUser, role: "owner", title: "Owner" },
    { id: makeId("mem2"), supplierId: otherSupplierId, userId: otherSupplierUser, role: "owner", title: "Owner" },
  ]);
  // دسته با attributes_schema — همان چیزی که محصول سطحِ ویژگی‌هایش را از آن می‌گیرد.
  await db.insert(schema.category).values({
    id: categoryId, slug: `linen-shirts-${makeId("c")}`, name: "پیراهن لینن",
    attributesSchema: { color_family: "string", material: "string", fit: "string", origin: "string" },
  });
  await db.insert(schema.brand).values({ id: brandId, name: "Kolbe Linen", slug: `kolbe-linen-${makeId("b")}`, verificationStatus: "approved" });
  // RBAC ادمین برای `retail:catalog:manage`.
  await db.insert(schema.adminRole).values({ id: roleId, name: `catalog_admin_${makeId("r")}`, displayName: "Catalog Admin" });
  await db.insert(schema.adminRolePermission).values({ id: makeId("perm"), roleId, action: "retail:catalog:manage" });
  await db.insert(schema.adminUserRole).values({ id: makeId("ur"), roleId, userId: adminUser, assignedBy: adminUser });

  return { supplierUser, adminUser, otherSupplierUser, supplierId, otherSupplierId, sellerId, otherSellerId, categoryId, brandId };
}

/**
 * ورود و برگرداندنِ کوکیِ جلسه.
 *
 * چرا کوکی؟ کنترلرِ ورود توکن را در **بدنهٔ پاسخ نمی‌گذارد**؛ آن را با
 * `Set-Cookie` می‌فرستد (و `X-Kolbe-Session-Token` فقط با توکنِ داخلیِ سرور).
 * `POST /login` هم در Nest پیش‌فرض ۲۰۱ می‌دهد، نه ۲۰۰.
 */
async function login(email: string): Promise<string> {
  const res = await request(http).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(raw, "no session cookie issued").toBeDefined();
  return String(raw).split(";")[0] as string;
}

/** ساختِ پیشنهاد و برگرداندنِ شناسهٔ آن (مسیرِ سرویس، همان که کنترلر صدا می‌زند). */
async function submitRich(overrides: Record<string, unknown> = {}) {
  const graph = { ...richStagedGraph(), ...overrides };
  const result = await catalog.createSupplierSubmission({ ...graph, createdBy: ids.supplierUser });
  return { submission: result.submission, graph };
}

describe("Phase 6.7 — Supplier Product lossless lifecycle roundtrip (real PostgreSQL)", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    await recreateDatabase();
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-roundtrip-67";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    pool = new Pool({ connectionString: TEST_URL });
    pool.on("error", () => {});
    db = drizzle(pool, { schema });

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // همان پیشوندی که `main.ts` ست می‌کند؛ وگرنه هیچ مسیری زیرِ /api/v1 نیست.
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = app.getHttpServer();

    const { CatalogService } = await import("../src/modules/catalog/catalog.service");
    catalog = app.get(CatalogService);

    ids = (await seed()) as Record<string, string>;
  }, 240_000);

  afterAll(async () => {
    try { await app?.close(); } catch {}
    try { await pool?.end(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  /* ── ۱) ثبت و بازبینی ─────────────────────────────────────────────────── */

  it("stages the exact submitted graph in supplier_product_submission (no field dropped on the way in)", async () => {
    const { submission, graph } = await submitRich();

    const [row] = await db.select().from(schema.supplierProductSubmission).where(eq(schema.supplierProductSubmission.id, submission.id));
    expect(row).toBeDefined();
    expect(row.status).toBe("pending_review");
    // هویت از جلسهٔ سرور مشتق شده، نه از مرورگر.
    expect(row.supplierId).toBe(ids.supplierId);
    expect(row.sellerId).toBe(ids.sellerId);
    expect(row.createdBy).toBe(ids.supplierUser);

    expect(row.proposedName).toBe(graph.name);
    expect(row.proposedSlug).toBe(graph.slug);
    expect(row.proposedDescription).toBe(graph.description);
    expect(row.categoryId).toBe(graph.categoryId);
    expect(row.brandId).toBe(graph.brandId);
    expect(row.attributes).toEqual(graph.attributes);
    expect(row.variants).toEqual(graph.variants);
    expect(row.media).toEqual(graph.media);
    expect(row.commercial).toEqual(graph.commercial);
  });

  it("admin review payload exposes the WHOLE staged graph before approval (nothing commercial hidden)", async () => {
    const { submission, graph } = await submitRich();
    const review = await catalog.getSupplierSubmission(submission.id);

    expect(review.product.name).toBe(graph.name);
    expect(review.product.description).toBe(graph.description);
    expect(review.product.categoryId).toBe(graph.categoryId);
    expect(review.product.brandId).toBe(graph.brandId);
    expect(review.product.attributes).toEqual(graph.attributes);

    expect(review.variants).toHaveLength(6);
    expect(review.variants.map((v: any) => v.sku)).toEqual(graph.variants.map((v) => v.sku));
    // وضعیتِ اعلام‌شدهٔ واریانت هم دیده می‌شود (draft روی LINEN-CREAM-L).
    expect(review.variants.find((v: any) => v.sku.includes("LINEN-CREAM-L")).status).toBe("draft");
    // موجودیِ پیشنهادی بخشی از گرافِ مرحله‌بندی‌شده است.
    expect(review.variants.find((v: any) => v.sku.includes("LINEN-BLACK-M")).inventory.onHand).toBe(60);

    expect(review.media).toHaveLength(3);
    expect(review.media.find((m: any) => m.variantSku != null && m.variantSku.includes("LINEN-BLACK-S"))).toBeDefined();

    expect(review.commercial.wholesalePrice).toBe("1250000");
    expect(review.commercial.retailPrice).toBe("1890000");
    expect(review.commercial.currency).toBe("IRR");
    expect(review.commercial.moq).toBe(2);
    expect(review.commercial.moqUnit).toBe("SERIES");
    expect(review.commercial.packageType).toBe("SIZE_RUN");
    expect(review.commercial.pricingTiers).toHaveLength(3);

    // بسته با ترکیب و مجموعِ محاسبه‌شده برای بازبینی.
    expect(review.packageTotals).toHaveLength(1);
    expect(review.packageTotals[0].name).toBe("سری سایزبندی S-L");
    expect(review.packageTotals[0].packageType).toBe("SIZE_RUN");
    expect(review.packageTotals[0].totalPieces).toBe(6);
  });

  it("GET /api/v1/catalog/supplier-submissions/:id returns the full graph through the real API boundary", async () => {
    const { submission, graph } = await submitRich();
    const token = await login(`${ids.adminUser}@kolbe.test`);

    const res = await request(http)
      .get(`/api/v1/catalog/supplier-submissions/${submission.id}`)
      .set("Cookie", token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const body = res.body;
    expect(body.id).toBe(submission.id);
    expect(body.product.name).toBe(graph.name);
    expect(body.product.attributes).toEqual(graph.attributes);
    expect(body.variants).toHaveLength(6);
    expect(body.commercial.moqUnit).toBe("SERIES");
    expect(body.commercial.packageType).toBe("SIZE_RUN");
    expect(body.commercial.pricingTiers).toHaveLength(3);
    expect(body.packageTotals[0].totalPieces).toBe(6);

    const list = await request(http)
      .get("/api/v1/catalog/supplier-submissions")
      .query({ status: "pending_review" })
      .set("Cookie", token);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.some((item: any) => item.id === submission.id)).toBe(true);
  });

  /* ── ۲) ماده‌سازی و خواندنِ حقیقت از دیتابیس ──────────────────────────── */

  it("approval materializes the COMPLETE canonical graph, verified by re-querying every table", async () => {
    const { submission, graph } = await submitRich();
    const created = await catalog.approveSubmissionAsNew(submission.id, ids.adminUser, "تأیید شد");

    // ── محصول ────────────────────────────────────────────────────────────
    const [product] = await db.select().from(schema.product).where(eq(schema.product.id, created.id));
    expect(product.name).toBe(graph.name);
    expect(product.slug).toBe(graph.slug);
    expect(product.description).toBe(graph.description);
    expect(product.categoryId).toBe(graph.categoryId);
    expect(product.brandId).toBe(graph.brandId);
    expect(product.ownerType).toBe("SUPPLIER");
    expect(product.status).toBe("approved");
    // ویژگی‌های سطحِ محصول اکنون مقصدِ کانونیکال دارند (مهاجرت ۰۰۴۷).
    expect(product.attributes).toEqual(graph.attributes);

    // ── واریانت‌ها ───────────────────────────────────────────────────────
    const variants = await db.select().from(schema.productVariant).where(eq(schema.productVariant.productId, created.id));
    expect(variants).toHaveLength(6);
    const bySku = new Map(variants.map((v: any) => [v.sku, v]));
    for (const staged of graph.variants) {
      const canonical = bySku.get(staged.sku);
      expect(canonical, `variant ${staged.sku} missing`).toBeDefined();
      expect(canonical.attributes).toEqual(staged.attributes);
      // وضعیتِ اعلام‌شده حفظ می‌شود، نه `active`ِ سخت‌کدشده.
      expect(canonical.status).toBe(staged.status);
    }

    // ── رسانهٔ محصول ─────────────────────────────────────────────────────
    const productMedia = await db.select().from(schema.productMedia).where(eq(schema.productMedia.productId, created.id));
    expect(productMedia).toHaveLength(2);
    const mediaUrls = productMedia.map((m: any) => m.url).sort();
    expect(mediaUrls).toEqual(["https://cdn.kolbe.test/linen/gallery-1.jpg", "https://cdn.kolbe.test/linen/main.jpg"]);
    expect(productMedia.find((m: any) => m.url.endsWith("main.jpg")).position).toBe(0);
    expect(productMedia.find((m: any) => m.url.endsWith("gallery-1.jpg")).position).toBe(1);

    // ── رسانهٔ واریانت: به واریانتِ درست چسبیده ──────────────────────────
    const blackS = bySku.get(graph.variants[0].sku)!;
    const variantMedia = await db.select().from(schema.productVariantMedia).where(eq(schema.productVariantMedia.variantId, blackS.id));
    expect(variantMedia).toHaveLength(1);
    expect(variantMedia[0].url).toBe("https://cdn.kolbe.test/linen/black-s.jpg");
    // و هیچ واریانتِ دیگری رسانهٔ اشتباهی نگرفته.
    const allVariantMedia = await db
      .select({ variantId: schema.productVariantMedia.variantId })
      .from(schema.productVariantMedia)
      .innerJoin(schema.productVariant, eq(schema.productVariant.id, schema.productVariantMedia.variantId))
      .where(eq(schema.productVariant.productId, created.id));
    expect(allVariantMedia).toHaveLength(1);
    expect(allVariantMedia[0].variantId).toBe(blackS.id);

    // ── موجودی ───────────────────────────────────────────────────────────
    const inventory = await db
      .select({ sku: schema.productVariant.sku, onHand: schema.productVariantInventory.onHand, sellerId: schema.productVariantInventory.sellerId })
      .from(schema.productVariantInventory)
      .innerJoin(schema.productVariant, eq(schema.productVariant.id, schema.productVariantInventory.variantId))
      .where(eq(schema.productVariant.productId, created.id));
    expect(inventory).toHaveLength(6);
    for (const staged of graph.variants) {
      const row = inventory.find((r: any) => r.sku === staged.sku);
      expect(row, `inventory for ${staged.sku}`).toBeDefined();
      expect(row.onHand).toBe(staged.inventory.onHand);
      expect(row.sellerId).toBe(ids.sellerId);
    }

    // ── پیشنهادِ تجاری ───────────────────────────────────────────────────
    const offers = await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.productId, created.id));
    expect(offers).toHaveLength(1);
    const offer = offers[0];
    expect(offer.sellerId).toBe(ids.sellerId);          // سرور مشتق کرده، نه کلاینت
    expect(offer.sku).toBe(graph.commercial.sku);
    expect(offer.wholesalePrice).toBe(1250000n);        // BigInt، بدونِ اعشار
    expect(offer.retailPrice).toBe(1890000n);
    expect(offer.currency).toBe("IRR");
    expect(offer.moq).toBe(2);
    expect(offer.moqUnit).toBe("SERIES");               // پیش‌تر PIECE سخت‌کد می‌شد
    expect(offer.packageType).toBe("SIZE_RUN");

    // ── بسته و اقلامش ────────────────────────────────────────────────────
    const packages = await db.select().from(schema.wholesalePackage).where(eq(schema.wholesalePackage.offerId, offer.id));
    expect(packages).toHaveLength(1);
    expect(packages[0].packageType).toBe("SIZE_RUN");
    expect(packages[0].name).toBe("سری سایزبندی S-L");
    expect(packages[0].totalPieces).toBe(6);

    const items = await db.select().from(schema.wholesalePackageItem).where(eq(schema.wholesalePackageItem.packageId, packages[0].id));
    expect(items).toHaveLength(3);
    const skuByVariantId = new Map(variants.map((v: any) => [v.id, v.sku]));
    const itemBySku = new Map(items.map((i: any) => [skuByVariantId.get(i.variantId), i.quantity]));
    expect(itemBySku.get(graph.variants[0].sku)).toBe(2);
    expect(itemBySku.get(graph.variants[1].sku)).toBe(2);
    expect(itemBySku.get(graph.variants[2].sku)).toBe(2);
    // شناسه‌های اقلام باید به واریانت‌های کانونیکالِ **همین محصول** اشاره کنند.
    for (const item of items) {
      const owner = variants.find((v: any) => v.id === item.variantId);
      expect(owner, "package item points outside this product").toBeDefined();
    }

    // ── پله‌های قیمت ─────────────────────────────────────────────────────
    const tiers = await db
      .select()
      .from(schema.wholesalePricingTier)
      .where(eq(schema.wholesalePricingTier.offerId, offer.id));
    expect(tiers).toHaveLength(3);
    const sorted = [...tiers].sort((a: any, b: any) => a.minQuantity - b.minQuantity);
    expect(sorted.map((t: any) => [t.minQuantity, t.maxQuantity])).toEqual([[2, 9], [10, 49], [50, null]]);
    expect(sorted.map((t: any) => t.unitPrice)).toEqual([1250000n, 1180000n, 1090000n]);
    expect(sorted.every((t: any) => t.currency === "IRR")).toBe(true);
    expect(sorted.every((t: any) => t.moqUnit === "SERIES")).toBe(true);

    // ── وضعیتِ خودِ پیشنهاد ──────────────────────────────────────────────
    const [after] = await db.select().from(schema.supplierProductSubmission).where(eq(schema.supplierProductSubmission.id, submission.id));
    expect(after.status).toBe("approved_new_product");
    expect(after.approvedProductId).toBe(created.id);
    expect(after.reviewedBy).toBe(ids.adminUser);
  });

  /* ── ۳) idempotency در سطحِ دامنه ─────────────────────────────────────── */

  it("a second approval does not duplicate ANY canonical row (domain-level idempotency)", async () => {
    const { submission } = await submitRich();
    const created = await catalog.approveSubmissionAsNew(submission.id, ids.adminUser);

    const before = await snapshotCanonical(created.id);

    let secondError: any = null;
    let secondResult: any = null;
    try {
      secondResult = await catalog.approveSubmissionAsNew(submission.id, ids.adminUser);
    } catch (error) {
      secondError = error as { code?: string; message?: string };
    }

    // قراردادِ موجودِ دامنه: `SUBMISSION_NOT_PENDING` (نه یک پاسخِ ساختگیِ تازه).
    expect(secondResult).toBeNull();
    expect(secondError).not.toBeNull();
    expect(secondError.code).toBe("SUBMISSION_NOT_PENDING");

    const after = await snapshotCanonical(created.id);
    expect(after).toEqual(before);
  });

  it("concurrent approvals create exactly one product (row lock + status guard)", async () => {
    const { submission, graph } = await submitRich();
    const outcomes = await Promise.allSettled([
      catalog.approveSubmissionAsNew(submission.id, ids.adminUser),
      catalog.approveSubmissionAsNew(submission.id, ids.adminUser),
    ]);
    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    expect(succeeded).toHaveLength(1);

    const products = await db.select().from(schema.product).where(eq(schema.product.slug, graph.slug));
    expect(products).toHaveLength(1);
    const variants = await db.select().from(schema.productVariant).where(eq(schema.productVariant.productId, products[0].id));
    expect(variants).toHaveLength(6);
  });

  /* ── ۴) اتمیک بودن: هیچ گرافِ ناقصی فرار نمی‌کند ───────────────────────── */

  it("a mid-transaction failure rolls back the ENTIRE graph (no orphan product/variant/media/offer)", async () => {
    // یک واریانتِ کانونیکالِ ازقبل‌موجود با همان SKU می‌سازیم. اعتبارسنجیِ
    // زودهنگام این را نمی‌بیند (SKU درونِ خودِ پیشنهاد یکتا است)، پس خطا
    // **وسطِ تراکنش** و از قیدِ یکتاییِ دیتابیس رخ می‌دهد — یعنی واقعی‌ترین
    // مسیرِ شکستِ میانی که بدونِ ضعیف‌کردنِ اعتبارسنجی قابلِ ساختن است.
    const { submission, graph } = await submitRich();
    const collidingSku = graph.variants[0].sku;
    const blockerProduct = makeId("prod_block");
    await db.insert(schema.product).values({ id: blockerProduct, name: "Blocker", slug: `blocker-${blockerProduct}`, status: "published" });
    await db.insert(schema.productVariant).values({ id: makeId("var_block"), productId: blockerProduct, sku: collidingSku, status: "active", attributes: {} });
    await expect(catalog.approveSubmissionAsNew(submission.id, ids.adminUser)).rejects.toThrow();

    // هیچ محصولِ یتیمی با این slug ساخته نشده.
    const products = await db.select().from(schema.product).where(eq(schema.product.slug, graph.slug));
    expect(products).toHaveLength(0);
    // هیچ واریانتِ یتیمی از این پیشنهاد نمانده (به‌جز همان blocker).
    const variants = await db.select().from(schema.productVariant).where(eq(schema.productVariant.sku, graph.variants[1].sku));
    expect(variants).toHaveLength(0);
    const offer = await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.sku, graph.commercial.sku));
    expect(offer).toHaveLength(0);
    // و خودِ پیشنهاد همچنان در انتظارِ بررسی است، نه نیمه‌تائیدشده.
    const [row] = await db.select().from(schema.supplierProductSubmission).where(eq(schema.supplierProductSubmission.id, submission.id));
    expect(row.status).toBe("pending_review");
    expect(row.approvedProductId).toBeNull();
  });

  /* ── ۵) سازگاریِ backward با پیشنهادِ تختِ قدیمی ──────────────────────── */

  it("a legacy flat submission still materializes into a valid simple canonical product", async () => {
    // همان چیزی که مسیرِ `compat/` امروز می‌سازد: یک واریانت، یک رسانه، بدونِ
    // moqUnit و بدونِ بسته.
    const legacySku = `LEGACY-BAG-${makeId("l").toUpperCase()}`;
    const legacy = await catalog.createSupplierSubmission({
      name: "کیف چرمی قدیمی",
      slug: `legacy-bag-${makeId("s")}`,
      description: "",
      attributes: { category: "چرم", proposedStock: 12 },
      variants: [{ sku: `${legacySku}-FREE`, attributes: { size: "FREE", color: "قهوه‌ای", color_hex: "#5b3a21" }, inventory: { onHand: 12 } }],
      media: [{ url: "https://cdn.kolbe.test/legacy/bag.jpg", type: "image" }],
      commercial: { sku: legacySku, wholesalePrice: "450000", moq: 1 },
      createdBy: ids.supplierUser,
    });

    const created = await catalog.approveSubmissionAsNew(legacy.submission.id, ids.adminUser);
    const [product] = await db.select().from(schema.product).where(eq(schema.product.id, created.id));
    expect(product.name).toBe("کیف چرمی قدیمی");
    // attributes سطحِ محصول از مسیرِ قدیمی هم حفظ می‌شود.
    expect(product.attributes).toEqual({ category: "چرم", proposedStock: 12 });

    const variants = await db.select().from(schema.productVariant).where(eq(schema.productVariant.productId, created.id));
    expect(variants).toHaveLength(1);
    expect(variants[0].sku).toBe(`${legacySku}-FREE`);

    const offers = await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.productId, created.id));
    expect(offers).toHaveLength(1);
    expect(offers[0].wholesalePrice).toBe(450000n);
    expect(offers[0].moq).toBe(1);
    // واحدی اعلام نشده بود، پس PIECE یک پیش‌فرضِ صریحِ دامنه است.
    expect(offers[0].moqUnit).toBe("PIECE");
    expect(offers[0].currency).toBe("IRR");

    const packages = await db.select().from(schema.wholesalePackage).where(eq(schema.wholesalePackage.offerId, offers[0].id));
    expect(packages).toHaveLength(0);

    // موجودیِ پیشنهادیِ مسیرِ قدیمی هم به مقصدِ کانونیکالش می‌رسد.
    const inventory = await db
      .select()
      .from(schema.productVariantInventory)
      .where(eq(schema.productVariantInventory.variantId, variants[0].id));
    expect(inventory).toHaveLength(1);
    expect(inventory[0].onHand).toBe(12);
    expect(inventory[0].sellerId).toBe(ids.sellerId);
  });

  /* ── ۶) امنیت و قواعدِ دامنه ──────────────────────────────────────────── */

  it("the supplier cannot pick the sellerId — it is derived from the session identity", async () => {
    const { submission } = await submitRich({ sellerId: ids.otherSellerId } as any);
    expect(submission.sellerId).toBe(ids.sellerId);
    expect(submission.supplierId).toBe(ids.supplierId);
  });

  it("a non-admin cannot read the admin review endpoints", async () => {
    const { submission } = await submitRich();
    const supplierToken = await login(`${ids.supplierUser}@kolbe.test`);

    const one = await request(http)
      .get(`/api/v1/catalog/supplier-submissions/${submission.id}`)
      .set("Cookie", supplierToken);
    expect(one.status).toBe(403);

    const list = await request(http)
      .get("/api/v1/catalog/supplier-submissions")
      .set("Cookie", supplierToken);
    expect(list.status).toBe(403);

    // و چیزی تأیید نشده است.
    const [row] = await db.select().from(schema.supplierProductSubmission).where(eq(schema.supplierProductSubmission.id, submission.id));
    expect(row.status).toBe("pending_review");
  });

  it("a supplier cannot approve its own submission through the API", async () => {
    const { submission } = await submitRich();
    const supplierToken = await login(`${ids.supplierUser}@kolbe.test`);

    const res = await request(http)
      .post(`/api/v1/catalog/supplier-submissions/${submission.id}/approve-new`)
      .set("Cookie", supplierToken)
      .send({});
    expect(res.status).toBe(403);

    const [row] = await db.select().from(schema.supplierProductSubmission).where(eq(schema.supplierProductSubmission.id, submission.id));
    expect(row.status).toBe("pending_review");
    expect(row.approvedProductId).toBeNull();
  });

  it("rejects invalid staged graphs with the real domain error codes", async () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["duplicate variant SKU", { variants: [{ sku: "DUP-1", attributes: {} }, { sku: "DUP-1", attributes: {} }], commercial: {} }, "DUPLICATE_VARIANT_SKU"],
      ["empty variant SKU", { variants: [{ sku: "", attributes: {} }], commercial: {} }, "VARIANT_SKU_REQUIRED"],
      ["non-decimal wholesale price", { variants: [{ sku: "P-1", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "12.5", moq: 1 } }, "INVALID_WHOLESALE_PRICE"],
      ["non-decimal retail price", { variants: [{ sku: "P-1", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", retailPrice: "NaN", moq: 1 } }, "INVALID_RETAIL_PRICE"],
      ["zero MOQ", { variants: [{ sku: "P-1", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 0 } }, "INVALID_MOQ"],
      ["invalid MOQ unit", { variants: [{ sku: "P-1", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 1, moqUnit: "DOZEN" } }, "INVALID_MOQ_UNIT"],
      ["invalid package type", { variants: [{ sku: "P-1", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 1, packageType: "MYSTERY" } }, "INVALID_PACKAGE_TYPE"],
      ["offer variant not found", { variants: [{ sku: "P-1", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 1, variantSku: "GHOST" } }, "OFFER_VARIANT_NOT_FOUND"],
      ["media variant not found", { variants: [{ sku: "P-1", attributes: {} }], media: [{ url: "https://x.test/a.jpg", variantSku: "GHOST" }], commercial: {} }, "MEDIA_VARIANT_NOT_FOUND"],
      ["empty media url", { variants: [{ sku: "P-1", attributes: {} }], media: [{ url: "  " }], commercial: {} }, "INVALID_MEDIA_URL"],
      ["negative inventory", { variants: [{ sku: "P-1", attributes: {}, inventory: { onHand: -5 } }], commercial: {} }, "INVALID_INVENTORY_ON_HAND"],
      ["overlapping tiers", { variants: [{ sku: "P-1", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 1, pricingTiers: [{ minQuantity: 1, maxQuantity: 10, unitPrice: "100" }, { minQuantity: 5, unitPrice: "90" }] } }, "OVERLAPPING_PRICING_TIER"],
      ["inverted tier range", { variants: [{ sku: "P-1", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 1, pricingTiers: [{ minQuantity: 10, maxQuantity: 2, unitPrice: "100" }] } }, "INVALID_PRICING_RANGE"],
      ["non-decimal tier price", { variants: [{ sku: "P-1", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 1, pricingTiers: [{ minQuantity: 1, unitPrice: "12.5" }] } }, "INVALID_TIER_PRICE"],
      ["package variant not in product", { variants: [{ sku: "P-1", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 1, packages: [{ packageType: "CUSTOM_BUNDLE", name: "بسته", items: [{ sku: "GHOST", quantity: 1 }] }] } }, "INVALID_PACKAGE_VARIANT"],
      ["package quantity zero", { variants: [{ sku: "P-1", attributes: {} }, { sku: "P-2", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 1, packages: [{ packageType: "SIZE_RUN", name: "بسته", items: [{ sku: "P-1", quantity: 0 }, { sku: "P-2", quantity: 1 }] }] } }, "INVALID_PACKAGE_QUANTITY"],
      ["SIZE_RUN with one size", { variants: [{ sku: "P-1", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 1, packages: [{ packageType: "SIZE_RUN", name: "بسته", items: [{ sku: "P-1", quantity: 2 }] }] } }, "SIZE_RUN_NEEDS_MULTIPLE_SIZES"],
      ["FIXED_QUANTITY with two variants", { variants: [{ sku: "P-1", attributes: {} }, { sku: "P-2", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 1, packages: [{ packageType: "FIXED_QUANTITY", name: "بسته", items: [{ sku: "P-1", quantity: 2 }, { sku: "P-2", quantity: 2 }] }] } }, "FIXED_QUANTITY_SINGLE_VARIANT"],
      ["package without name", { variants: [{ sku: "P-1", attributes: {} }, { sku: "P-2", attributes: {} }], commercial: { sku: "P-1", wholesalePrice: "100", moq: 1, packages: [{ packageType: "CUSTOM_BUNDLE", name: "", items: [{ sku: "P-1", quantity: 1 }] }] } }, "INVALID_PACKAGE_NAME"],
    ];

    for (const [label, override, expectedCode] of cases) {
      let code: string | undefined;
      try {
        await catalog.createSupplierSubmission({
          name: `neg-${label}`,
          slug: `neg-${makeId("s")}`,
          createdBy: ids.supplierUser,
          ...override,
        } as any);
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code, `${label} → expected ${expectedCode}, got ${code}`).toBe(expectedCode);
    }

    // و هیچ‌کدام چیزی در دیتابیس نگذاشته‌اند.
    const negatives = await db
      .select({ id: schema.supplierProductSubmission.id })
      .from(schema.supplierProductSubmission)
      .where(eq(schema.supplierProductSubmission.proposedName, "neg-duplicate variant SKU"));
    expect(negatives).toHaveLength(0);
  });

  it("commercial fields may not be smuggled inside product attributes", async () => {
    let code: string | undefined;
    try {
      await catalog.createSupplierSubmission({
        name: "قاچاقِ قیمت",
        slug: `smuggle-${makeId("s")}`,
        attributes: { wholesalePrice: "100" },
        createdBy: ids.supplierUser,
      } as any);
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBeDefined();
    expect(code).not.toBe("SUBMISSION_NOT_PENDING");
  });

  /* ── ابزارها ─────────────────────────────────────────────────────────── */

  /**
   * تصویرِ کاملِ گرافِ کانونیکال برای مقایسهٔ «چیزی اضافه نشد».
   *
   * `createdAt`/`updatedAt` حذف می‌شوند چون بین دو خواندن تغییر می‌کنند؛ آنچه
   * مقایسه می‌شود **تعداد و هویت** ردیف‌ها است، نه مهرِ زمانی.
   */
  async function snapshotCanonical(productId: string) {
    const products = await db.select().from(schema.product).where(eq(schema.product.id, productId));
    const variants = await db.select().from(schema.productVariant).where(eq(schema.productVariant.productId, productId));
    const variantIds = variants.map((v: any) => v.id);
    const productMedia = await db.select().from(schema.productMedia).where(eq(schema.productMedia.productId, productId));
    const offers = await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.productId, productId));
    const offerIds = offers.map((o: any) => o.id);
    const packages = offerIds.length > 0
      ? await db.select().from(schema.wholesalePackage).where(inArray(schema.wholesalePackage.offerId, offerIds))
      : [];
    const packageIds = packages.map((p: any) => p.id);
    const items = packageIds.length > 0
      ? await db.select().from(schema.wholesalePackageItem).where(inArray(schema.wholesalePackageItem.packageId, packageIds))
      : [];
    const tiers = offerIds.length > 0
      ? await db.select().from(schema.wholesalePricingTier).where(inArray(schema.wholesalePricingTier.offerId, offerIds))
      : [];
    const inventory = variantIds.length > 0
      ? await db.select().from(schema.productVariantInventory).where(inArray(schema.productVariantInventory.variantId, variantIds))
      : [];
    const variantMedia = variantIds.length > 0
      ? await db.select().from(schema.productVariantMedia).where(inArray(schema.productVariantMedia.variantId, variantIds))
      : [];
    return {
      products: products.length,
      variants: variants.length,
      productMedia: productMedia.length,
      variantMedia: variantMedia.length,
      offers: offers.length,
      packages: packages.length,
      items: items.length,
      tiers: tiers.length,
      inventory: inventory.length,
      variantSkus: variants.map((v: any) => v.sku).sort(),
      offerIds: offerIds.sort(),
      offerPrices: offers.map((o: any) => String(o.wholesalePrice)),
      tierPrices: tiers.map((t: any) => String(t.unitPrice)).sort(),
    };
  }

});
