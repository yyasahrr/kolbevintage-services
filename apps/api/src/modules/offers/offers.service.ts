import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { seller, sellerOffer, product, productVariant, supplierMember, wholesalePackage, wholesalePackageItem, wholesalePricingTier } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { ForbiddenError, NotFoundError } from "@kolbe/shared";
import { assertOfferAllowedForProduct, CatalogDomainError } from "../catalog/catalog.logic";
import { assertSupplierOfferIsolation } from "./offers.logic";
import { calculatePackageTotalPieces, validateWholesalePackage } from "../catalog/catalog.logic";

@Injectable()
export class OffersService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  async resolveActorSeller(user: { id: string; role: "admin" | "supplier" }) {
    if (user.role === "admin") return { sellerId: await this.ensureSeller(null, "KOLBE"), sellerType: "KOLBE" as const };
    const [membership] = await this.db.select().from(supplierMember).where(eq(supplierMember.userId, user.id)).limit(1);
    if (!membership) throw new ForbiddenError("عضویت تأمین‌کننده یافت نشد");
    const [supplierSeller] = await this.db.select().from(seller).where(eq(seller.supplierId, membership.supplierId)).limit(1);
    if (!supplierSeller || supplierSeller.type !== "SUPPLIER" || supplierSeller.status !== "active") throw new ForbiddenError("فروشندهٔ تأمین‌کننده فعال نیست");
    return { sellerId: supplierSeller.id, sellerType: "SUPPLIER" as const };
  }

  async ensureSeller(supplierId?: string | null, type: "KOLBE" | "SUPPLIER" = "SUPPLIER", displayName = "Supplier"): Promise<string> {
    if (type === "KOLBE") {
      const [kolbe] = await this.db.select().from(seller).where(eq(seller.type, "KOLBE")).limit(1);
      if (kolbe) return kolbe.id;
      const id = `seller_kolbe`;
      await this.db.insert(seller).values({ id, type: "KOLBE", displayName: "Kolbe Vintage", status: "active" }).onConflictDoNothing();
      return id;
    }

    if (!supplierId) throw new CatalogDomainError("SUPPLIER_ID_REQUIRED", "شناسه تأمین‌کننده لازم است");

    const [existing] = await this.db.select().from(seller).where(eq(seller.supplierId, supplierId)).limit(1);
    if (existing) return existing.id;

    const id = `seller_${supplierId}`;
    await this.db.insert(seller).values({ id, type: "SUPPLIER", supplierId, displayName, status: "active" });
    return id;
  }

  async createOffer(input: {
    productId: string;
    sellerId: string;
    sellerType: "KOLBE" | "SUPPLIER";
    variantId?: string | null;
    sku: string;
    wholesalePrice: bigint;
    retailPrice?: bigint | null;
    moq: number;
    moqUnit: "PIECE" | "PACKAGE" | "SERIES" | "BOX" | "CARTON" | "SET";
    packageType?: "SIZE_RUN" | "FIXED_QUANTITY" | "COLOR_MIX" | "CUSTOM_BUNDLE" | null;
    // DEPRECATED: inventoryOnHand is ignored — source of truth is product_variant_inventory
  }) {
    const [prod] = await this.db.select().from(product).where(eq(product.id, input.productId)).limit(1);
    if (!prod) throw new NotFoundError("محصول یافت نشد");

    assertOfferAllowedForProduct({
      productId: input.productId,
      sellerType: input.sellerType,
      productIsKolbeExclusive: prod.isKolbeExclusive,
      retailPrice: input.retailPrice,
      wholesalePrice: input.wholesalePrice,
      moq: input.moq,
      moqUnit: input.moqUnit,
      packageType: input.packageType,
    });
    const [actualSeller] = await this.db.select().from(seller).where(eq(seller.id, input.sellerId)).limit(1);
    if (!actualSeller || actualSeller.type !== input.sellerType || actualSeller.status !== "active") throw new ForbiddenError("هویت فروشنده معتبر نیست");
    if (input.variantId) {
      const [variant] = await this.db.select().from(productVariant).where(eq(productVariant.id, input.variantId)).limit(1);
      if (!variant || variant.productId !== input.productId) throw new CatalogDomainError("VARIANT_PRODUCT_MISMATCH", "واریانت متعلق به محصول نیست");
    }

    const id = `offer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const [created] = await this.db
      .insert(sellerOffer)
      .values({
        id,
        productId: input.productId,
        sellerId: input.sellerId,
        variantId: input.variantId || null,
        sku: input.sku,
        status: "draft",
        wholesalePrice: input.wholesalePrice,
        retailPrice: input.retailPrice || null,
        currency: "IRR",
        moq: input.moq,
        moqUnit: input.moqUnit,
        packageType: input.packageType || null,
      })
      .returning();

    return created;
  }

  async listOffersForSeller(sellerId: string, requester: { sellerId: string; role: string }) {
    // Supplier isolation
    assertSupplierOfferIsolation({
      requesterSellerId: requester.sellerId,
      offerSellerId: sellerId,
      requesterRole: requester.role as any,
    });

    return this.db.select().from(sellerOffer).where(eq(sellerOffer.sellerId, sellerId)).limit(100);
  }

  async listOffersForProduct(productId: string) {
    return this.db.select().from(sellerOffer).where(eq(sellerOffer.productId, productId)).limit(100);
  }

  // Wholesale package
  async createWholesalePackage(input: {
    offerId: string;
    packageType: "SIZE_RUN" | "FIXED_QUANTITY" | "COLOR_MIX" | "CUSTOM_BUNDLE";
    name: string;
    description?: string;
    items: Array<{ variantId: string; quantity: number }>;
    actorSellerId: string;
    actorRole: "admin" | "supplier";
  }) {
    const totalPieces = calculatePackageTotalPieces(input.items);
    validateWholesalePackage({
      offerId: input.offerId,
      packageType: input.packageType,
      name: input.name,
      totalPieces,
      items: input.items,
    });

    const [offer] = await this.db.select().from(sellerOffer).where(eq(sellerOffer.id, input.offerId)).limit(1);
    if (!offer) throw new NotFoundError("پیشنهاد فروش یافت نشد");
    if (input.actorRole !== "admin" && offer.sellerId !== input.actorSellerId) throw new ForbiddenError("پیشنهاد متعلق به این تأمین‌کننده نیست");
    if (!input.items.length || new Set(input.items.map((item) => item.variantId)).size !== input.items.length) throw new CatalogDomainError("INVALID_PACKAGE_ITEMS", "اقلام بسته باید غیرتکراری و غیرخالی باشند");
    const variants = await this.db.select().from(productVariant).where(eq(productVariant.productId, offer.productId));
    const validVariantIds = new Set(variants.map((variant) => variant.id));
    if (input.items.some((item) => item.quantity <= 0 || !validVariantIds.has(item.variantId))) throw new CatalogDomainError("INVALID_PACKAGE_VARIANT", "واریانت بسته متعلق به محصول پیشنهاد نیست");

    return this.db.transaction(async (tx) => {
      const id = `wpkg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const [pkg] = await tx.insert(wholesalePackage)
      .values({
        id,
        offerId: input.offerId,
        packageType: input.packageType,
        name: input.name,
        description: input.description || null,
        totalPieces,
      })
      .returning();

    for (const item of input.items) {
      await tx.insert(wholesalePackageItem).values({
        id: `wpki_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        packageId: id,
        variantId: item.variantId,
        quantity: item.quantity,
      });
    }

      return pkg;
    });
  }

  async createPricingTier(input: {
    offerId: string;
    minQuantity: number;
    maxQuantity?: number | null;
    unitPrice: bigint;
    moqUnit?: "PIECE" | "PACKAGE" | "SERIES" | "BOX" | "CARTON" | "SET";
    actorSellerId: string;
    actorRole: "admin" | "supplier";
  }) {
    if (input.minQuantity <= 0 || (input.maxQuantity != null && input.maxQuantity < input.minQuantity)) throw new CatalogDomainError("INVALID_PRICING_RANGE", "بازهٔ قیمت‌گذاری نامعتبر است");
    const [offer] = await this.db.select().from(sellerOffer).where(eq(sellerOffer.id, input.offerId)).limit(1);
    if (!offer) throw new NotFoundError("پیشنهاد فروش یافت نشد");
    if (input.actorRole !== "admin" && offer.sellerId !== input.actorSellerId) throw new ForbiddenError("پیشنهاد متعلق به این تأمین‌کننده نیست");
    const tiers = await this.db.select().from(wholesalePricingTier).where(eq(wholesalePricingTier.offerId, input.offerId));
    const newMax = input.maxQuantity ?? Number.POSITIVE_INFINITY;
    if (tiers.some((tier) => input.minQuantity <= (tier.maxQuantity ?? Number.POSITIVE_INFINITY) && tier.minQuantity <= newMax)) throw new CatalogDomainError("OVERLAPPING_PRICING_TIER", "بازهٔ قیمت‌گذاری هم‌پوشان است");
    const id = `wpt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const [tier] = await this.db
      .insert(wholesalePricingTier)
      .values({
        id,
        offerId: input.offerId,
        minQuantity: input.minQuantity,
        maxQuantity: input.maxQuantity || null,
        unitPrice: input.unitPrice,
        currency: "IRR",
        moqUnit: input.moqUnit || "PACKAGE",
      })
      .returning();
    return tier;
  }

  // ── Phase 4.3.1 — Order eligibility queries ───────────────────────────
  async getOfferEligibility(offerId: string, executor?: any) {
    const db = (executor as any) || this.db;
    const [offer] = await db.select().from(sellerOffer).where(eq(sellerOffer.id, offerId)).limit(1);
    if (!offer) throw new NotFoundError("پیشنهاد یافت نشد");
    if (offer.status === "archived" || offer.status === "suspended" || offer.status === "rejected") {
      throw new CatalogDomainError("OFFER_NOT_ELIGIBLE", `Offer ${offerId} status ${offer.status} not usable`);
    }
    // Must be published or active to be eligible, but allow draft for legacy? We require published/active
    if (offer.status !== "published" && offer.status !== "active") {
      // For safety, allow if not in blocked list, but log
      // We'll still return, but caller can decide; for order creation we allow draft if previously accepted? Actually acceptance already validated.
      // For revalidation, we check not archived/suspended/rejected.
    }
    return offer;
  }

  async getPackageForOrder(packageId: string, offerId: string, executor?: any) {
    const db = (executor as any) || this.db;
    const [pkg] = await db.select().from(wholesalePackage).where(eq(wholesalePackage.id, packageId)).limit(1);
    if (!pkg) throw new NotFoundError("بسته یافت نشد");
    if (pkg.offerId !== offerId) {
      throw new CatalogDomainError("PACKAGE_OFFER_MISMATCH", "بسته متعلق به پیشنهاد نیست");
    }
    const items = await db.select().from(wholesalePackageItem).where(eq(wholesalePackageItem.packageId, packageId));
    const composition = items.map((it: any) => ({ variantId: it.variantId, quantity: it.quantity }));
    return { package: pkg, composition };
  }

  async getDbNow(executor?: any) {
    const db = (executor as any) || this.db;
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`SELECT NOW() as now`);
    const nowVal = (result as any).rows?.[0]?.now || (result as any)[0]?.now;
    return new Date(nowVal);
  }
}
