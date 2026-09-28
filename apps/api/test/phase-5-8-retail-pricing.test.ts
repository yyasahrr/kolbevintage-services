import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { MAX_MONEY } from "@kolbe/shared";
import * as schema from "../../packages/database/src/schema/tables";
import { CatalogService } from "../src/modules/catalog/catalog.service";
import { OffersService } from "../src/modules/offers/offers.service";
import { RETAIL_SHIPPING_RULES, RetailPricingService } from "../src/modules/pricing/retail-pricing.service";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../packages/database/test/helpers";

/**
 * Phase 5.8-A — canonical Retail pricing authority (Nest `RetailPricingService`).
 *
 * Every line resolves from canonical truth (KOLBE + published product, live
 * variant, KOLBE offer `retail_price`); browser money/names are never
 * authority. Real PostgreSQL, real Catalog/Offers owner reads.
 *
 * A24 coverage: 1, 2, 3, 4, 5, 6, 7, 8, 36, 37, 38.
 */

const DB = "kolbe_phase_5_8_retail_pricing_test";

let pool: Pool;
let pricing: RetailPricingService;
let kolbeSellerId: string;

let seq = 0;
const id = (prefix: string) => `${prefix}_p58_${Date.now()}_${seq++}`;

async function seed() {
  const db = drizzle(pool, { schema: schema as any });
  const catalog = new CatalogService(db as any, {} as any);
  const offers = new OffersService(db as any);
  pricing = new RetailPricingService(db as any, catalog, offers);

  kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
  const supId = id("sup");
  await db.insert(schema.supplier).values({ id: supId, legalName: "Sup", displayName: "Sup", status: "approved" });
  const supplierSellerId = await offers.ensureSeller(supId, "SUPPLIER");

  const addProduct = async (slug: string, ownerType: "KOLBE" | "SUPPLIER", status: string, name: string) => {
    const productId = id("prod");
    await db.insert(schema.product).values({ id: productId, name, slug: `${slug}-${productId}`, ownerType, status });
    return productId;
  };
  const addVariant = async (productId: string, sku: string, attributes: Record<string, unknown>, status: string) => {
    const variantId = id("var");
    await db.insert(schema.productVariant).values({ id: variantId, productId, sku: `${sku}-${variantId}`, attributes, status });
    return variantId;
  };
  const addOffer = async (
    productId: string,
    sellerId: string,
    variantId: string | null,
    status: string,
    retailPrice: bigint | null,
  ) => {
    const offerId = id("offer");
    await db.insert(schema.sellerOffer).values({
      id: offerId,
      productId,
      sellerId,
      variantId,
      sku: `sku-${offerId}`,
      status,
      retailPrice,
    });
    return offerId;
  };

  // Live product: variant-scoped + product-level + pending + NULL-price offers.
  const pLive = await addProduct("live", "KOLBE", "published", "Live Product");
  const vM = await addVariant(pLive, "VM", { size: "M", color: "Black" }, "active");
  const vL = await addVariant(pLive, "VL", { size: "L", color: "Black" }, "active");
  const vArch = await addVariant(pLive, "VA", { size: "S" }, "archived");
  await db.insert(schema.productMedia).values({ id: id("pm"), productId: pLive, url: "https://cdn.test/p.jpg", position: 0 });
  await db.insert(schema.productVariantMedia).values({ id: id("vm"), variantId: vM, url: "https://cdn.test/v.jpg", position: 0 });
  const oProd = await addOffer(pLive, kolbeSellerId, null, "published", 100000n);
  const oVm = await addOffer(pLive, kolbeSellerId, vM, "published", 120000n);
  await addOffer(pLive, kolbeSellerId, vL, "published", null);
  await addOffer(pLive, kolbeSellerId, null, "pending_review", 50000n);

  // Supplier-owned product with a live supplier offer (must never satisfy retail).
  const pSupp = await addProduct("supp", "SUPPLIER", "published", "Supplier Product");
  const vSupp = await addVariant(pSupp, "VS", { size: "M" }, "active");
  await addOffer(pSupp, supplierSellerId, null, "published", 10000n);

  const pDraft = await addProduct("draft", "KOLBE", "draft", "Draft Product");
  const vDraft = await addVariant(pDraft, "VD", { size: "M" }, "active");
  await addOffer(pDraft, kolbeSellerId, null, "published", 70000n);
  const pArch = await addProduct("arch", "KOLBE", "archived", "Archived Product");

  const pNoOffer = await addProduct("nooffer", "KOLBE", "published", "No Offer Product");
  const vNoOffer = await addVariant(pNoOffer, "VN", { size: "M" }, "active");

  // Ambiguous attributes: two live M variants.
  const pAmb = await addProduct("amb", "KOLBE", "published", "Ambiguous Product");
  const va1 = await addVariant(pAmb, "VA1", { size: "M", color: "Red" }, "active");
  await addVariant(pAmb, "VA2", { size: "M", color: "Blue" }, "active");
  await addOffer(pAmb, kolbeSellerId, null, "published", 90000n);

  // Overflow + negative price products.
  const pBig = await addProduct("big", "KOLBE", "published", "Big Product");
  const vBig = await addVariant(pBig, "VB", { size: "M" }, "active");
  await addOffer(pBig, kolbeSellerId, vBig, "published", MAX_MONEY);
  const pNeg = await addProduct("neg", "KOLBE", "published", "Negative Product");
  const vNeg = await addVariant(pNeg, "VNG", { size: "M" }, "active");
  await addOffer(pNeg, kolbeSellerId, vNeg, "published", -50n);

  // Two live product-level offers -> ambiguous.
  const pDual = await addProduct("dual", "KOLBE", "published", "Dual Offer Product");
  const vDual = await addVariant(pDual, "VDU", { size: "M" }, "active");
  await addOffer(pDual, kolbeSellerId, null, "published", 1000n);
  await addOffer(pDual, kolbeSellerId, null, "approved", 2000n);

  return { pLive, vM, vL, vArch, oProd, oVm, pSupp, vSupp, pDraft, vDraft, pArch, pNoOffer, vNoOffer, pAmb, va1, pBig, vBig, pNeg, vNeg, pDual, vDual };
}

let S: Awaited<ReturnType<typeof seed>>;

function line(productId: string, quantity: number, extra: Record<string, unknown> = {}) {
  return { productId, quantity, ...extra };
}

describe("Phase 5.8-A canonical retail pricing", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    S = await seed();
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("resolves an explicit variant from the variant-scoped KOLBE offer with a server snapshot", async () => {
    const result = await pricing.resolveCheckoutPricing({
      lines: [line(S.pLive, 2, { variantId: S.vM })],
      shippingMethodId: "post",
      freeShippingOverride: false,
    });
    expect(result.lines).toHaveLength(1);
    const resolved = result.lines[0];
    expect(resolved.variantId).toBe(S.vM);
    expect(resolved.offerId).toBe(S.oVm);
    expect(resolved.unitPrice).toBe(120000n);
    expect(resolved.baseLineTotal).toBe(240000n);
    expect(resolved.productName).toBe("Live Product");
    expect(resolved.size).toBe("M");
    expect(resolved.colour).toBe("Black");
    expect(resolved.imageUrl).toBe("https://cdn.test/v.jpg");
    expect(resolved.sku).toContain("VM-");
    expect(result.itemsTotal).toBe(240000n);
    expect(result.adjusted).toBe(false);
  });

  it("resolves variants from size/colour attributes case-insensitively (colour/color keys)", async () => {
    const result = await pricing.resolveCheckoutPricing({
      lines: [line(S.pLive, 1, { size: "m", colour: "black" })],
      shippingMethodId: "post",
      freeShippingOverride: false,
    });
    expect(result.lines[0].variantId).toBe(S.vM);
    expect(result.lines[0].offerId).toBe(S.oVm);
  });

  it("rejects supplier-owned products even when a live supplier offer exists", async () => {
    await expect(
      pricing.resolveCheckoutPricing({
        lines: [line(S.pSupp, 1, { variantId: S.vSupp })],
        shippingMethodId: "post",
        freeShippingOverride: false,
      }),
    ).rejects.toMatchObject({ code: "RETAIL_PRODUCT_NOT_KOLBE" });
    await expect(
      pricing.resolveCheckoutPricing({
        lines: [line("prod_wholesale_only", 1)],
        shippingMethodId: "post",
        freeShippingOverride: false,
      }),
    ).rejects.toMatchObject({ code: "RETAIL_PRODUCT_NOT_FOUND" });
  });

  it("rejects draft and archived products", async () => {
    await expect(
      pricing.resolveCheckoutPricing({
        lines: [line(S.pDraft, 1, { variantId: S.vDraft })],
        shippingMethodId: "post",
        freeShippingOverride: false,
      }),
    ).rejects.toMatchObject({ code: "RETAIL_PRODUCT_NOT_PUBLISHED" });
    await expect(
      pricing.resolveCheckoutPricing({
        lines: [line(S.pArch, 1)],
        shippingMethodId: "post",
        freeShippingOverride: false,
      }),
    ).rejects.toMatchObject({ code: "RETAIL_PRODUCT_NOT_PUBLISHED" });
  });

  it("rejects foreign, inactive, unknown and unmatched variants", async () => {
    const base = { shippingMethodId: "post", freeShippingOverride: false } as const;
    await expect(pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pLive, 1, { variantId: S.vSupp })] })).rejects.toMatchObject({
      code: "RETAIL_VARIANT_MISMATCH",
    });
    await expect(pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pLive, 1, { variantId: S.vArch })] })).rejects.toMatchObject({
      code: "RETAIL_VARIANT_INACTIVE",
    });
    await expect(pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pLive, 1, { variantId: "var_missing" })] })).rejects.toMatchObject({
      code: "RETAIL_VARIANT_NOT_FOUND",
    });
    await expect(pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pLive, 1, { size: "XXXXL" })] })).rejects.toMatchObject({
      code: "RETAIL_VARIANT_UNRESOLVED",
    });
  });

  it("rejects ambiguous attribute matches without variantId; explicit variantId resolves", async () => {
    const base = { shippingMethodId: "post", freeShippingOverride: false } as const;
    await expect(pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pAmb, 1, { size: "M" })] })).rejects.toMatchObject({
      code: "RETAIL_VARIANT_AMBIGUOUS",
    });
    const result = await pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pAmb, 1, { variantId: S.va1 })] });
    expect(result.lines[0].variantId).toBe(S.va1);
    expect(result.lines[0].unitPrice).toBe(90000n);
  });

  it("prefers the variant-scoped offer and falls back to the product-level offer", async () => {
    const base = { shippingMethodId: "post", freeShippingOverride: false } as const;
    const scoped = await pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pLive, 1, { variantId: S.vM })] });
    expect(scoped.lines[0].offerId).toBe(S.oVm);
    // vL has only a NULL-price variant row: the live product-level offer applies.
    const fallback = await pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pLive, 1, { variantId: S.vL })] });
    expect(fallback.lines[0].offerId).toBe(S.oProd);
    expect(fallback.lines[0].unitPrice).toBe(100000n);
  });

  it("rejects missing and ambiguous live KOLBE offers", async () => {
    const base = { shippingMethodId: "post", freeShippingOverride: false } as const;
    await expect(pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pNoOffer, 1, { variantId: S.vNoOffer })] })).rejects.toMatchObject({
      code: "RETAIL_OFFER_MISSING",
    });
    await expect(pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pDual, 1, { variantId: S.vDual })] })).rejects.toMatchObject({
      code: "RETAIL_OFFER_AMBIGUOUS",
    });
  });

  it("ignores browser unit price and name as authority but flags the mismatch", async () => {
    const result = await pricing.resolveCheckoutPricing({
      lines: [line(S.pLive, 2, { variantId: S.vM, presentedUnitPrice: 1, presentedName: "جعلی" })],
      shippingMethodId: "post",
      freeShippingOverride: false,
    });
    expect(result.lines[0].unitPrice).toBe(120000n);
    expect(result.lines[0].productName).toBe("Live Product");
    expect(result.itemsTotal).toBe(240000n);
    expect(result.adjusted).toBe(true);
  });

  it("applies the transitional shipping table: price under threshold, free at threshold or on COD", async () => {
    expect(RETAIL_SHIPPING_RULES.methods.pishtaz).toBe(89000n);
    expect(RETAIL_SHIPPING_RULES.freeThreshold).toBe(3000000n);
    const cheap = await pricing.resolveCheckoutPricing({
      lines: [line(S.pLive, 1, { variantId: S.vM })],
      shippingMethodId: "pishtaz",
      freeShippingOverride: false,
    });
    expect(cheap.itemsTotal).toBe(120000n);
    expect(cheap.shippingTotal).toBe(89000n);
    expect(cheap.prePromoGrandTotal).toBe(209000n);
    // 25 x 120000 = exactly the free-shipping threshold.
    const free = await pricing.resolveCheckoutPricing({
      lines: [line(S.pLive, 25, { variantId: S.vM })],
      shippingMethodId: "tipax",
      freeShippingOverride: false,
    });
    expect(free.shippingTotal).toBe(0n);
    const cod = await pricing.resolveCheckoutPricing({
      lines: [line(S.pLive, 1, { variantId: S.vM })],
      shippingMethodId: "tipax",
      freeShippingOverride: true,
    });
    expect(cod.shippingTotal).toBe(0n);
    await expect(
      pricing.resolveCheckoutPricing({
        lines: [line(S.pLive, 1, { variantId: S.vM })],
        shippingMethodId: "teleport",
        freeShippingOverride: false,
      }),
    ).rejects.toMatchObject({ code: "RETAIL_SHIPPING_METHOD_INVALID" });
  });

  it("enforces line and quantity limits", async () => {
    const base = { shippingMethodId: "post", freeShippingOverride: false } as const;
    await expect(pricing.resolveCheckoutPricing({ ...base, lines: [] })).rejects.toMatchObject({ code: "RETAIL_LINES_REQUIRED" });
    await expect(
      pricing.resolveCheckoutPricing({ ...base, lines: Array.from({ length: 51 }, () => line(S.pLive, 1, { variantId: S.vM })) }),
    ).rejects.toMatchObject({ code: "RETAIL_TOO_MANY_LINES" });
    for (const quantity of [0, -1, 101, 1.5]) {
      await expect(pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pLive, quantity as number, { variantId: S.vM })] })).rejects.toMatchObject({
        code: "RETAIL_QUANTITY_INVALID",
      });
    }
  });

  it("rejects monetary overflow and versions authority deterministically", async () => {
    const base = { shippingMethodId: "post", freeShippingOverride: false } as const;
    await expect(pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pBig, 2, { variantId: S.vBig })] })).rejects.toMatchObject({
      code: "RETAIL_MONETARY_OVERFLOW",
    });
    await expect(pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pNeg, 1, { variantId: S.vNeg })] })).rejects.toMatchObject({
      code: "RETAIL_MONETARY_OVERFLOW",
    });
    const input = { ...base, lines: [line(S.pLive, 2, { variantId: S.vM })] };
    const first = await pricing.resolveCheckoutPricing(input);
    const second = await pricing.resolveCheckoutPricing(input);
    expect(first.version).toMatch(/^rpv1\.[0-9a-f]{16}$/);
    expect(second.version).toBe(first.version);
    const changed = await pricing.resolveCheckoutPricing({ ...base, lines: [line(S.pLive, 3, { variantId: S.vM })] });
    expect(changed.version).not.toBe(first.version);
  });
});
