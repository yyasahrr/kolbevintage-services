/**
 * گام ۶.۷ — «تأیید به‌عنوانِ محصولِ موجود» بدونِ اتلاف.
 *
 * این آزمون mock نیست: Nest واقعی روی PostgreSQL واقعی. پس از تأیید، جدول‌های
 * کانونیک **دوباره از دیتابیس خوانده می‌شوند** تا ثابت شود چیزی گم نشده.
 *
 * ثابتِ حاکم: آنچه ادمین تأیید می‌کند = کلِ گرافِ تجاریِ تأمین‌کننده که به
 * محصولِ کانونیکالِ موجود متصل شده — بدونِ ساختِ محصولِ تکراری و بدونِ دست‌بردن
 * به حقیقتِ کانونیک یا موجودیِ فروشندهٔ دیگر.
 */

import { execFileSync } from "node:child_process";
import { scryptSync } from "node:crypto";
import path from "node:path";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Client, Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../packages/database/src/schema/tables";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_6_7_approve_existing_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const PASSWORD = "Kolbe!Existing123";

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
 * محصولِ کانونیکِ ازقبل‌موجود با سه واریانتِ کانونیک.
 *
 * عمداً SKUهای واریانتِ کانونیک با SKUهای تأمین‌کننده **فرق دارند** تا ثابت شود
 * نگاشت از راهِ `attributes` کار می‌کند، نه از راهِ حدسِ SKU.
 */
async function seedCanonicalProduct(attributes: { exclusive?: boolean; name?: string } = {}) {
  const productId = makeId("prod");
  await db.insert(schema.product).values({
    id: productId,
    name: attributes.name ?? "پیراهن لینن موجود",
    slug: `existing-linen-${makeId("s")}`,
    description: "محصولِ کانونیکِ ازقبل‌موجودِ کلبه.",
    sku: makeId("PSKU").toUpperCase(),
    brandId: ids.brandId,
    categoryId: ids.categoryId,
    attributes: { material: "لینن" },
    ownerType: "KOLBE",
    isKolbeExclusive: attributes.exclusive ?? false,
    status: "approved",
    createdBy: ids.adminUser,
  });
  const canonical: Record<string, string> = {};
  for (const [label, color, size] of [["S", "مشکی", "S"], ["M", "مشکی", "M"], ["L", "مشکی", "L"]] as const) {
    const variantId = makeId("cvar");
    await db.insert(schema.productVariant).values({
      id: variantId, productId, sku: makeId("CSV").toUpperCase(),
      attributes: { color, size, material: "لینن" }, status: "active",
    });
    canonical[label] = variantId;
  }
  // رسانهٔ کانونیکِ محصول — نباید با تأییدِ پیشنهادِ تأمین‌کننده عوض شود.
  await db.insert(schema.productMedia).values({
    id: makeId("cpm"), productId, url: "https://cdn.kolbe.test/canonical/hero.jpg", type: "image", position: 0,
  });
  return { productId, canonical };
}

/** موجودیِ فروشندهٔ دیگر روی یک واریانتِ کانونیک — باید دست‌نخورده بماند. */
async function seedOtherSellerInventory(variantId: string, onHand: number) {
  const rowId = makeId("pvi_other");
  await db.insert(schema.productVariantInventory).values({
    id: rowId, variantId, sellerId: ids.otherSellerId, onHand, reserved: 0, status: "active",
  });
  return rowId;
}

function richStagedGraph(tag: string) {
  const sku = (base: string) => `${base}-${tag}`;
  return {
    name: "پیراهن لینن موجود",
    slug: `existing-linen-${tag}`,
    description: "همان محصولِ کانونیک، از سوی تأمین‌کننده.",
    brandId: ids.brandId,
    categoryId: ids.categoryId,
    attributes: { material: "لینن", origin: "ایران" },
    variants: [
      { sku: sku("SUP-BLACK-S"), attributes: { color: "مشکی", size: "S", material: "لینن" }, status: "active", inventory: { onHand: 40 } },
      { sku: sku("SUP-BLACK-M"), attributes: { color: "مشکی", size: "M", material: "لینن" }, status: "active", inventory: { onHand: 60 } },
      { sku: sku("SUP-BLACK-L"), attributes: { color: "مشکی", size: "L", material: "لینن" }, status: "active", inventory: { onHand: 20 } },
      { sku: sku("SUP-CREAM-S"), attributes: { color: "کرم", size: "S", material: "لینن" }, status: "active", inventory: { onHand: 15 } },
      { sku: sku("SUP-CREAM-M"), attributes: { color: "کرم", size: "M", material: "لینن" }, status: "active", inventory: { onHand: 25 } },
      { sku: sku("SUP-CREAM-L"), attributes: { color: "کرم", size: "L", material: "لینن" }, status: "draft", inventory: { onHand: 5 } },
    ],
    media: [
      { url: "https://cdn.kolbe.test/sup/main.jpg", type: "image", position: 0 },
      { url: "https://cdn.kolbe.test/sup/gallery-1.jpg", type: "image", position: 1 },
      { url: "https://cdn.kolbe.test/sup/black-s.jpg", type: "image", position: 0, variantSku: sku("SUP-BLACK-S") },
    ],
    commercial: {
      sku: sku("SUP-SHIRT"),
      // پیشنهاد به واریانتِ مشکی/S مقید است؛ باید به واریانتِ **کانونیک** نگاشت شود.
      variantSku: sku("SUP-BLACK-S"),
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
          items: [
            { sku: sku("SUP-BLACK-S"), quantity: 2 },
            { sku: sku("SUP-BLACK-M"), quantity: 2 },
            { sku: sku("SUP-BLACK-L"), quantity: 2 },
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
  const salt = "kolbe-existing-salt";
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
  await db.insert(schema.category).values({
    id: categoryId, slug: `linen-shirts-${makeId("c")}`, name: "پیراهن لینن",
    attributesSchema: { material: "string", origin: "string" },
  });
  await db.insert(schema.brand).values({ id: brandId, name: "Kolbe Linen", slug: `kolbe-linen-${makeId("b")}`, verificationStatus: "approved" });
  await db.insert(schema.adminRole).values({ id: roleId, name: `catalog_admin_${makeId("r")}`, displayName: "Catalog Admin" });
  await db.insert(schema.adminRolePermission).values({ id: makeId("perm"), roleId, action: "retail:catalog:manage" });
  await db.insert(schema.adminUserRole).values({ id: makeId("ur"), roleId, userId: adminUser, assignedBy: adminUser });

  return { supplierUser, adminUser, otherSupplierUser, supplierId, otherSupplierId, sellerId, otherSellerId, categoryId, brandId };
}

async function login(email: string): Promise<string> {
  const res = await request(http).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(raw, "no session cookie issued").toBeDefined();
  return String(raw).split(";")[0] as string;
}

async function stageSubmission(tag: string, overrides: Record<string, unknown> = {}) {
  const graph = { ...richStagedGraph(tag), ...overrides };
  const result = await catalog.createSupplierSubmission({ ...graph, createdBy: ids.supplierUser });
  return { submissionId: result.submission.id as string, graph };
}

describe("Phase 6.7 — approve-as-existing materializes the full supplier graph (real PostgreSQL)", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    await recreateDatabase();
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-existing-67";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    pool = new Pool({ connectionString: TEST_URL });
    pool.on("error", () => {});
    db = drizzle(pool, { schema });

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
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

  it("attaches the whole graph to the existing product without creating a duplicate product", async () => {
    const { productId, canonical } = await seedCanonicalProduct();
    await seedOtherSellerInventory(canonical.S!, 999);

    const before = await db.select().from(schema.product).where(eq(schema.product.id, productId));
    const productCountBefore = (await db.select({ id: schema.product.id }).from(schema.product)).length;

    const tag = makeId("t").toUpperCase();
    const { submissionId, graph } = await stageSubmission(tag);
    const result = await catalog.approveSubmissionAsExisting(submissionId, productId, ids.adminUser, "تأیید به‌عنوانِ محصولِ موجود");

    expect(result.status).toBe("approved_existing_product");
    expect(result.approvedProductId).toBe(productId);
    // سه واریانتِ مشکی از راهِ صفات به کانونیک نگاشت شدند؛ سه واریانتِ کرم ساخته شدند.
    expect(result.createdVariants).toBe(3);

    // ── محصولِ کانونیک دست‌نخورده، و محصولِ تکراری ساخته نشده ───────────────
    const after = await db.select().from(schema.product).where(eq(schema.product.id, productId));
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe(before[0].name);
    expect(after[0].ownerType).toBe(before[0].ownerType);
    expect(after[0].status).toBe(before[0].status);
    expect(after[0].isKolbeExclusive).toBe(before[0].isKolbeExclusive);
    const productCountAfter = (await db.select({ id: schema.product.id }).from(schema.product)).length;
    expect(productCountAfter).toBe(productCountBefore);

    // ── واریانت‌ها: ۳ کانونیکِ موجود + ۳ تازه، همه زیرِ همان محصول ───────────
    const variants = await db.select().from(schema.productVariant).where(eq(schema.productVariant.productId, productId));
    expect(variants).toHaveLength(6);
    // واریانتِ نگاشت‌شده همان ردیفِ کانونیک است (SKU کانونیک حفظ می‌شود).
    const canonicalIds = [canonical.S, canonical.M, canonical.L];
    expect(variants.filter((v: any) => canonicalIds.includes(v.id))).toHaveLength(3);
    // واریانتِ کرم ساخته شده و SKU تأمین‌کننده را دارد.
    const createdSkus = variants.filter((v: any) => !canonicalIds.includes(v.id)).map((v: any) => v.sku).sort();
    expect(createdSkus).toEqual([`SUP-CREAM-L-${tag}`, `SUP-CREAM-M-${tag}`, `SUP-CREAM-S-${tag}`].sort());

    // ── پیشنهادِ تجاری: هیچ قصدی پاک نشده ───────────────────────────────────
    const offers = await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.productId, productId));
    expect(offers).toHaveLength(1);
    const offer = offers[0];
    expect(offer.sellerId).toBe(ids.sellerId);
    expect(offer.wholesalePrice).toBe(1250000n);
    expect(offer.retailPrice).toBe(1890000n);
    expect(offer.currency).toBe("IRR");
    expect(offer.moq).toBe(2);
    expect(offer.moqUnit).toBe("SERIES"); // نه PIECE
    expect(offer.packageType).toBe("SIZE_RUN");
    expect(offer.variantId).toBe(canonical.S);
    // بسته به واریانتِ کانونیکِ S نگاشت شده، نه به یک ردیفِ تازه.

    // ── موجودی: شش ردیف، همه از آنِ همین فروشنده ────────────────────────────
    const variantIds = variants.map((v: any) => v.id);
    const inventory = (await db.select().from(schema.productVariantInventory))
      .filter((row: any) => variantIds.includes(row.variantId));
    const mine = inventory.filter((row: any) => row.sellerId === ids.sellerId);
    expect(mine).toHaveLength(6);
    expect(mine.find((row: any) => row.variantId === canonical.S)?.onHand).toBe(40);
    // موجودیِ فروشندهٔ دیگر روی همان واریانت دست‌نخورده.
    const theirs = inventory.filter((row: any) => row.sellerId === ids.otherSellerId);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].onHand).toBe(999);

    // ── بستهٔ SIZE_RUN با ترکیبِ درست و مجموعِ ۶ ────────────────────────────
    const packages = await db.select().from(schema.wholesalePackage).where(eq(schema.wholesalePackage.offerId, offer.id));
    expect(packages).toHaveLength(1);
    expect(packages[0].packageType).toBe("SIZE_RUN");
    expect(packages[0].totalPieces).toBe(6);
    const items = await db.select().from(schema.wholesalePackageItem).where(eq(schema.wholesalePackageItem.packageId, packages[0].id));
    expect(items).toHaveLength(3);
    // اقلام به واریانتِ **کانونیکِ** مشکی اشاره می‌کنند، نه به شناسه‌های تازه.
    expect(items.map((item: any) => item.variantId).sort()).toEqual([canonical.S, canonical.M, canonical.L].sort());
    expect(items.every((item: any) => item.quantity === 2)).toBe(true);

    // ── پله‌های قیمت با واحدِ SERIES ────────────────────────────────────────
    const tiers = await db.select().from(schema.wholesalePricingTier).where(eq(schema.wholesalePricingTier.offerId, offer.id));
    expect(tiers).toHaveLength(3);
    expect(tiers.every((tier: any) => tier.moqUnit === "SERIES")).toBe(true);
    expect(tiers.map((tier: any) => tier.unitPrice)).toEqual([1250000n, 1180000n, 1090000n]);
    expect(tiers[2].maxQuantity).toBeNull(); // پلهٔ بازِ ۵۰+

    // ── رسانه: سطحِ محصول در لایهٔ فروشنده، واریانت افزودنیِ کانونیک ────────
    const offerMediaRows = await db.select().from(schema.offerMedia).where(eq(schema.offerMedia.offerId, offer.id));
    expect(offerMediaRows.map((row: any) => row.url).sort()).toEqual([
      "https://cdn.kolbe.test/sup/gallery-1.jpg",
      "https://cdn.kolbe.test/sup/main.jpg",
    ]);
    const canonicalProductMedia = await db.select().from(schema.productMedia).where(eq(schema.productMedia.productId, productId));
    expect(canonicalProductMedia).toHaveLength(1); // رسانهٔ کانونیک جایگزین نشده
    const variantMedia = await db.select().from(schema.productVariantMedia).where(eq(schema.productVariantMedia.variantId, canonical.S!));
    expect(variantMedia.map((row: any) => row.url)).toContain("https://cdn.kolbe.test/sup/black-s.jpg");
  });

  it("a second approval is refused and duplicates nothing (domain-level idempotency)", async () => {
    const { productId } = await seedCanonicalProduct();
    const { submissionId } = await stageSubmission(makeId("t").toUpperCase());
    await catalog.approveSubmissionAsExisting(submissionId, productId, ids.adminUser);

    await expect(catalog.approveSubmissionAsExisting(submissionId, productId, ids.adminUser)).rejects.toMatchObject({ code: "SUBMISSION_NOT_PENDING" });

    const offers = await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.productId, productId));
    expect(offers).toHaveLength(1);
    const packages = await db.select().from(schema.wholesalePackage).where(eq(schema.wholesalePackage.offerId, offers[0].id));
    expect(packages).toHaveLength(1);
    const tiers = await db.select().from(schema.wholesalePricingTier).where(eq(schema.wholesalePricingTier.offerId, offers[0].id));
    expect(tiers).toHaveLength(3);
  });

  it("concurrent approvals create exactly one offer (row lock + status guard)", async () => {
    const { productId } = await seedCanonicalProduct();
    const { submissionId } = await stageSubmission(makeId("t").toUpperCase());
    const settled = await Promise.allSettled([
      catalog.approveSubmissionAsExisting(submissionId, productId, ids.adminUser),
      catalog.approveSubmissionAsExisting(submissionId, productId, ids.adminUser),
    ]);
    const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const offers = await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.productId, productId));
    expect(offers).toHaveLength(1);
  });

  it("refuses a Kolbe-exclusive product and writes nothing", async () => {
    const { productId } = await seedCanonicalProduct({ exclusive: true });
    const { submissionId } = await stageSubmission(makeId("t").toUpperCase());

    await expect(catalog.approveSubmissionAsExisting(submissionId, productId, ids.adminUser)).rejects.toMatchObject({ code: "KOLBE_EXCLUSIVE_NO_SUPPLIER" });

    expect(await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.productId, productId))).toHaveLength(0);
    // هیچ واریانت/موجودی/بسته‌ای ساخته نشده.
    expect(await db.select().from(schema.productVariant).where(eq(schema.productVariant.productId, productId))).toHaveLength(3);
    const exclusiveVariantIds = (await db.select().from(schema.productVariant).where(eq(schema.productVariant.productId, productId))).map((v: any) => v.id);
    const exclusiveInventory = (await db.select().from(schema.productVariantInventory)).filter((row: any) => exclusiveVariantIds.includes(row.variantId));
    expect(exclusiveInventory).toHaveLength(0);
    // پیشنهاد هنوز قابلِ بررسی است.
    const [submission] = await db.select().from(schema.supplierProductSubmission).where(eq(schema.supplierProductSubmission.id, submissionId));
    expect(submission.status).toBe("pending_review");
  });

  it("refuses a variant SKU that belongs to another product instead of hijacking it", async () => {
    const target = await seedCanonicalProduct();
    const foreign = await seedCanonicalProduct({ name: "محصولِ دیگر" });
    const foreignSku = (await db.select().from(schema.productVariant).where(eq(schema.productVariant.productId, foreign.productId)))[0].sku;

    const tag = makeId("t").toUpperCase();
    const graph = richStagedGraph(tag);
    // عمداً **آخرین** واریانت: پنج واریانتِ پیش از آن در همان تراکنش نوشته
    // می‌شوند، پس این آزمون واقعاً rollback را می‌سنجد نه «قبل از هر نوشتن رد شد».
    graph.variants[5].sku = foreignSku;
    const created = await catalog.createSupplierSubmission({ ...graph, createdBy: ids.supplierUser });

    await expect(catalog.approveSubmissionAsExisting(created.submission.id, target.productId, ids.adminUser))
      .rejects.toMatchObject({ code: "VARIANT_SKU_CONFLICT" });
    // هیچ‌کدام از آن پنج نوشتن باقی نمانده.
    expect(await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.productId, target.productId))).toHaveLength(0);
    expect(await db.select().from(schema.productVariant).where(eq(schema.productVariant.productId, target.productId))).toHaveLength(3);
    const targetVariantIds = (await db.select().from(schema.productVariant).where(eq(schema.productVariant.productId, target.productId))).map((v: any) => v.id);
    const leftover = (await db.select().from(schema.productVariantInventory)).filter((row: any) => targetVariantIds.includes(row.variantId) && row.sellerId === ids.sellerId);
    expect(leftover).toHaveLength(0);
  });

  it("rolls the ENTIRE approval back when a package cannot be materialized", async () => {
    const { productId } = await seedCanonicalProduct();
    const tag = makeId("t").toUpperCase();
    const graph = richStagedGraph(tag);
    /**
     * دو واریانتِ مرحله‌بندی‌شده با SKUهای متفاوت اما **صفاتِ یکسان**. هر دو به
     * یک واریانتِ کانونیک نگاشت می‌شوند، پس بستهٔ SIZE_RUN در لحظهٔ ماده‌سازی
     * دو قلمِ تکراری روی یک واریانت دارد — همان‌جا رد می‌شود.
     *
     * چرا این سناریو؟ «قلمِ بسته با SKU ناموجود» زودتر، در خودِ ثبتِ پیشنهاد رد
     * می‌شود (`validateStagedCommercialGraph`) و هرگز به تراکنشِ تأیید نمی‌رسد.
     */
    graph.variants[2] = { ...graph.variants[1], sku: `${"SUP-BLACK-M-DUP"}-${tag}` };
    graph.commercial.packages[0].items[2] = { sku: `${"SUP-BLACK-M-DUP"}-${tag}`, quantity: 2 };
    const created = await catalog.createSupplierSubmission({ ...graph, createdBy: ids.supplierUser });

    await expect(catalog.approveSubmissionAsExisting(created.submission.id, productId, ids.adminUser)).rejects.toThrow();

    expect(await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.productId, productId))).toHaveLength(0);
    expect(await db.select().from(schema.wholesalePackage).where(eq(schema.wholesalePackage.offerId, "nope"))).toHaveLength(0);
    // فقط همان سه واریانتِ کانونیکِ اولیه باقی مانده‌اند.
    expect(await db.select().from(schema.productVariant).where(eq(schema.productVariant.productId, productId))).toHaveLength(3);
    const [submission] = await db.select().from(schema.supplierProductSubmission).where(eq(schema.supplierProductSubmission.id, created.submission.id));
    expect(submission.status).toBe("pending_review");
  });

  it("refuses a duplicate offer SKU rather than silently re-using another seller's offer", async () => {
    const { productId } = await seedCanonicalProduct();
    const tag = makeId("t").toUpperCase();
    const first = await stageSubmission(tag);
    await catalog.approveSubmissionAsExisting(first.submissionId, productId, ids.adminUser);

    // همان گراف با همان SKU تجاری، بارِ دوم ثبت می‌شود.
    const secondGraph = richStagedGraph(tag);
    const second = await catalog.createSupplierSubmission({ ...secondGraph, createdBy: ids.supplierUser });
    await expect(catalog.approveSubmissionAsExisting(second.submission.id, productId, ids.adminUser))
      .rejects.toMatchObject({ code: "OFFER_SKU_EXISTS" });
    expect(await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.productId, productId))).toHaveLength(1);
  });

  it("exposes approve-as-existing through the real API boundary, admin only", async () => {
    const { productId } = await seedCanonicalProduct();
    const { submissionId } = await stageSubmission(makeId("t").toUpperCase());

    const supplierCookie = await login(`${ids.supplierUser}@kolbe.test`);
    const forbidden = await request(http)
      .post(`/api/v1/catalog/supplier-submissions/${submissionId}/approve-existing`)
      .set("Cookie", supplierCookie)
      .send({ productId });
    expect([401, 403]).toContain(forbidden.status);

    const adminCookie = await login(`${ids.adminUser}@kolbe.test`);
    const ok = await request(http)
      .post(`/api/v1/catalog/supplier-submissions/${submissionId}/approve-existing`)
      .set("Cookie", adminCookie)
      .send({ productId, note: "اتصال به محصولِ کانونیک" });
    expect([200, 201]).toContain(ok.status);
    expect(ok.body.status).toBe("approved_existing_product");

    const offers = await db.select().from(schema.sellerOffer).where(eq(schema.sellerOffer.productId, productId));
    expect(offers).toHaveLength(1);
    expect(offers[0].moqUnit).toBe("SERIES");
  });

  it("rejects an unknown canonical product with NOT_FOUND and leaves the submission reviewable", async () => {
    const { submissionId } = await stageSubmission(makeId("t").toUpperCase());
    await expect(catalog.approveSubmissionAsExisting(submissionId, "prod_does_not_exist", ids.adminUser))
      .rejects.toMatchObject({ status: 404 });
    const [submission] = await db.select().from(schema.supplierProductSubmission).where(eq(schema.supplierProductSubmission.id, submissionId));
    expect(submission.status).toBe("pending_review");
  });
});
