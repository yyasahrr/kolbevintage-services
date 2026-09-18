import { Inject, Injectable } from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { product, productVariant, brand, category, seller, sellerOffer, supplierMember, supplierProductSubmission } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { ForbiddenError, NotFoundError } from "@kolbe/shared";
import {
  assertProductOwnership,
  assertOfferAllowedForProduct,
  assertProductStatusTransition,
  assertSubmissionSeparation,
  findDuplicateCandidates,
  CatalogDomainError,
} from "./catalog.logic";

@Injectable()
export class CatalogService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  // ── Brand ────────────────────────────────────────────────────────────────
  async createBrand(input: { name: string; slug: string; logoUrl?: string; creatorId: string; role: string }) {
    const existing = await this.db.select({ id: brand.id, name: brand.name, slug: brand.slug }).from(brand);
    const isDuplicate = existing.some((b) => b.name.toLowerCase() === input.name.toLowerCase());
    if (isDuplicate) {
      throw new CatalogDomainError("BRAND_EXISTS", "برند تکراری است");
    }

    const verificationStatus = input.role === "admin" ? "approved" : "pending";
    const id = `brand_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const [created] = await this.db
      .insert(brand)
      .values({
        id,
        name: input.name,
        slug: input.slug,
        logoUrl: input.logoUrl || null,
        creatorId: input.creatorId,
        verificationStatus,
        status: "active",
      })
      .returning();

    return created;
  }

  async approveBrand(brandId: string) {
    const [updated] = await this.db
      .update(brand)
      .set({ verificationStatus: "approved", updatedAt: new Date() })
      .where(eq(brand.id, brandId))
      .returning();
    if (!updated) throw new NotFoundError("برند یافت نشد");
    return updated;
  }

  // ── Category ─────────────────────────────────────────────────────────────
  async createCategory(input: {
    slug: string;
    name: string;
    parentId?: string | null;
    attributesSchema?: Record<string, any>;
  }) {
    const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const [created] = await this.db
      .insert(category)
      .values({
        id,
        slug: input.slug,
        name: input.name,
        parentId: input.parentId || null,
        attributesSchema: input.attributesSchema || {},
        status: "active",
      })
      .returning();
    return created;
  }

  // ── Product (canonical) ──────────────────────────────────────────────────
  async createProduct(input: {
    name: string;
    slug: string;
    description?: string;
    brandId?: string | null;
    categoryId?: string | null;
    ownerType: "KOLBE" | "SUPPLIER";
    isKolbeExclusive: boolean;
    createdBy: string;
    role: "supplier" | "admin" | "customer" | "vip";
  }) {
    if (input.role !== "admin") {
      throw new ForbiddenError("فقط مدیر می‌تواند محصول کانونیکال ایجاد کند");
    }
    // Business rule: supplier cannot create KOLBE product
    assertProductOwnership(input.role as any, {
      name: input.name,
      slug: input.slug,
      brandId: input.brandId,
      categoryId: input.categoryId,
      ownerType: input.ownerType,
      isKolbeExclusive: input.isKolbeExclusive,
    });

    // Duplicate detection — matching engine foundation
    const existingProducts = await this.db
      .select({ id: product.id, name: product.name, slug: product.slug, brandId: product.brandId, categoryId: product.categoryId })
      .from(product)
      .limit(100);

    const candidates = findDuplicateCandidates(
      { name: input.name, slug: input.slug, brandId: input.brandId, categoryId: input.categoryId },
      existingProducts.map((p) => ({ id: p.id, name: p.name, slug: p.slug, brandId: p.brandId, categoryId: p.categoryId })),
    );

    const id = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const [created] = await this.db
      .insert(product)
      .values({
        id,
        name: input.name,
        slug: input.slug,
        description: input.description || "",
        brandId: input.brandId || null,
        categoryId: input.categoryId || null,
        ownerType: input.ownerType,
        isKolbeExclusive: input.isKolbeExclusive,
        status: "draft",
        createdBy: input.createdBy,
      })
      .returning();

    // Duplicate candidates returned for admin review — no separate queue table needed in Phase 3.8
    // Supplier creates canonical product directly: Supplier → Create Product → Create Variant → Create Seller Offer → Admin Review → Publish

    return { product: created, duplicateCandidates: candidates };
  }

  async createSupplierSubmission(input: {
    name: string; slug: string; description?: string; brandId?: string; proposedBrandId?: string;
    categoryId?: string; attributes?: Record<string, unknown>; variants?: unknown[]; media?: unknown[]; commercial?: Record<string, unknown>; createdBy: string;
  }) {
    assertSubmissionSeparation({ attributes: input.attributes as any, commercial: input.commercial as any });

    const [membership] = await this.db.select().from(supplierMember).where(eq(supplierMember.userId, input.createdBy)).limit(1);
    if (!membership) throw new ForbiddenError("عضویت فعال تأمین‌کننده یافت نشد");
    const [supplierSeller] = await this.db.select().from(seller).where(eq(seller.supplierId, membership.supplierId)).limit(1);
    if (!supplierSeller || supplierSeller.type !== "SUPPLIER" || supplierSeller.status !== "active") {
      throw new ForbiddenError("فروشندهٔ تأمین‌کننده فعال نیست");
    }
    if (input.brandId && input.proposedBrandId) throw new CatalogDomainError("AMBIGUOUS_BRAND", "فقط یک برند قابل انتخاب است");
    if (input.brandId) {
      const [existingBrand] = await this.db.select().from(brand).where(eq(brand.id, input.brandId)).limit(1);
      if (!existingBrand || existingBrand.verificationStatus !== "approved") throw new CatalogDomainError("BRAND_NOT_APPROVED", "برند انتخابی تأیید نشده است");
    }
    if (input.proposedBrandId) {
      const [proposed] = await this.db.select().from(brand).where(eq(brand.id, input.proposedBrandId)).limit(1);
      if (!proposed || proposed.verificationStatus !== "pending" || proposed.creatorId !== input.createdBy) {
        throw new CatalogDomainError("INVALID_PROPOSED_BRAND", "برند پیشنهادی معتبر نیست");
      }
    }
    const existing = await this.db.select({ id: product.id, name: product.name, slug: product.slug, brandId: product.brandId, categoryId: product.categoryId }).from(product).limit(100);
    const candidates = findDuplicateCandidates(
      { name: input.name, slug: input.slug, brandId: input.brandId ?? input.proposedBrandId, categoryId: input.categoryId }, existing,
    );
    const [submission] = await this.db.insert(supplierProductSubmission).values({
      id: `sps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      supplierId: membership.supplierId, sellerId: supplierSeller.id, proposedName: input.name,
      proposedSlug: input.slug, proposedDescription: input.description ?? "", brandId: input.brandId ?? null,
      proposedBrandId: input.proposedBrandId ?? null, categoryId: input.categoryId ?? null,
      attributes: input.attributes ?? {}, variants: input.variants ?? [], media: input.media ?? [],
      commercial: input.commercial ?? {},
      status: "pending_review", matchedProductId: candidates[0]?.id ?? null, createdBy: input.createdBy,
    }).returning();
    return { submission, duplicateCandidates: candidates };
  }

  async approveSubmissionAsNew(id: string, reviewedBy: string, note?: string) {
    return this.db.transaction(async (tx) => {
      const [submission] = await tx.select().from(supplierProductSubmission).where(eq(supplierProductSubmission.id, id)).limit(1);
      if (!submission) throw new NotFoundError("درخواست محصول یافت نشد");
      if (submission.status !== "pending_review") throw new CatalogDomainError("SUBMISSION_NOT_PENDING", "درخواست در انتظار بررسی نیست");
      if (submission.proposedBrandId) {
        const [proposedBrand] = await tx.select().from(brand).where(eq(brand.id, submission.proposedBrandId)).limit(1);
        if (!proposedBrand || proposedBrand.verificationStatus !== "approved") throw new CatalogDomainError("BRAND_REVIEW_REQUIRED", "برند پیشنهادی ابتدا باید تأیید شود");
      }
      const [created] = await tx.insert(product).values({
        id: `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: submission.proposedName,
        slug: submission.proposedSlug, description: submission.proposedDescription,
        brandId: submission.brandId ?? submission.proposedBrandId, categoryId: submission.categoryId,
        ownerType: "SUPPLIER", isKolbeExclusive: false, status: "approved", createdBy: submission.createdBy,
      }).returning();
      const proposedVariants = Array.isArray(submission.variants) ? submission.variants as Array<{ sku?: string; attributes?: Record<string, unknown> }> : [];
      const createdVariants: Array<{ id: string; sku: string }> = [];
      for (const proposed of proposedVariants) {
        if (!proposed.sku) continue;
        const [variant] = await tx.insert(productVariant).values({ id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, productId: created.id, sku: proposed.sku, attributes: proposed.attributes ?? {}, status: "active" }).returning();
        createdVariants.push(variant);
      }
      const commercial = (submission.commercial ?? {}) as { sku?: string; wholesalePrice?: number; moq?: number };
      const offerSku = createdVariants[0]?.sku ?? commercial.sku;
      if (offerSku && Number.isSafeInteger(Number(commercial.wholesalePrice)) && Number(commercial.wholesalePrice) >= 0) {
        await tx.insert(sellerOffer).values({ id: `offer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, productId: created.id, sellerId: submission.sellerId, variantId: createdVariants[0]?.id ?? null, sku: offerSku, status: "draft", wholesalePrice: BigInt(commercial.wholesalePrice ?? 0), retailPrice: null, moq: Math.max(1, commercial.moq ?? 1), moqUnit: "PIECE" });
      }
      await tx.update(supplierProductSubmission).set({ status: "approved_new_product", approvedProductId: created.id, reviewedBy, reviewedAt: new Date(), adminReviewNote: note ?? null, updatedAt: new Date() }).where(eq(supplierProductSubmission.id, id));
      return created;
    });
  }

  async approveSubmissionAsExisting(id: string, productId: string, reviewedBy: string, note?: string) {
    const [target] = await this.db.select().from(product).where(eq(product.id, productId)).limit(1);
    if (!target) throw new NotFoundError("محصول کانونیکال یافت نشد");
    if (target.isKolbeExclusive) throw new CatalogDomainError("KOLBE_EXCLUSIVE_NO_SUPPLIER", "محصول انحصاری کلبه پیشنهاد تأمین‌کننده نمی‌پذیرد");
    return this.db.transaction(async (tx) => {
      const [submission] = await tx.select().from(supplierProductSubmission).where(and(eq(supplierProductSubmission.id, id), eq(supplierProductSubmission.status, "pending_review"))).limit(1);
      if (!submission) throw new CatalogDomainError("SUBMISSION_NOT_PENDING", "درخواست در انتظار بررسی نیست");
      const commercial = (submission.commercial ?? {}) as { sku?: string; wholesalePrice?: number; moq?: number };
      if (!commercial.sku) throw new CatalogDomainError("SUBMISSION_SKU_REQUIRED", "شناسهٔ تجاری پیشنهاد موجود نیست");
      await tx.insert(sellerOffer).values({ id: `offer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, productId, sellerId: submission.sellerId, variantId: null, sku: commercial.sku, status: "draft", wholesalePrice: BigInt(commercial.wholesalePrice ?? 0), retailPrice: null, moq: Math.max(1, commercial.moq ?? 1), moqUnit: "PIECE" });
      const [updated] = await tx.update(supplierProductSubmission).set({ status: "approved_existing_product", approvedProductId: productId, reviewedBy, reviewedAt: new Date(), adminReviewNote: note ?? null, updatedAt: new Date() }).where(eq(supplierProductSubmission.id, id)).returning();
      return updated;
    });
  }

  async rejectSubmission(id: string, reviewedBy: string, note: string) {
    if (!note?.trim()) throw new CatalogDomainError("REVIEW_NOTE_REQUIRED", "دلیل رد الزامی است");
    const [updated] = await this.db.update(supplierProductSubmission).set({ status: "rejected", reviewedBy, reviewedAt: new Date(), adminReviewNote: note.trim(), updatedAt: new Date() }).where(and(eq(supplierProductSubmission.id, id), eq(supplierProductSubmission.status, "pending_review"))).returning();
    if (!updated) throw new CatalogDomainError("SUBMISSION_NOT_PENDING", "درخواست در انتظار بررسی نیست");
    return updated;
  }

  async transitionProductStatus(productId: string, nextStatus: "draft" | "pending_review" | "approved" | "published" | "suspended" | "archived", role: string) {
    const [existing] = await this.db.select().from(product).where(eq(product.id, productId)).limit(1);
    if (!existing) throw new NotFoundError("محصول یافت نشد");

    assertProductStatusTransition(existing.status as any, nextStatus as any, role as any);

    const [updated] = await this.db
      .update(product)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(product.id, productId))
      .returning();

    return updated;
  }

  async listProducts() {
    return this.db.select().from(product).limit(100);
  }

  async listRetailProducts() {
    // Retail ONLY Kolbe products, published
    return this.db
      .select()
      .from(product)
      .where(and(eq(product.ownerType, "KOLBE"), eq(product.status, "published")))
      .limit(100);
  }

  async listWholesaleProducts() {
    // Wholesale: Kolbe + Supplier, approved/published
    return this.db.select().from(product).where(eq(product.status, "published")).limit(100);
  }

  async getProductById(id: string) {
    const [found] = await this.db.select().from(product).where(eq(product.id, id)).limit(1);
    if (!found) throw new NotFoundError("محصول یافت نشد");
    return found;
  }

  // ── Variant ──────────────────────────────────────────────────────────────
  async createVariant(input: { productId: string; sku: string; attributes?: Record<string, any> }) {
    const id = `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const [created] = await this.db
      .insert(productVariant)
      .values({
        id,
        productId: input.productId,
        sku: input.sku,
        attributes: input.attributes || {},
        status: "active",
      })
      .returning();
    return created;
  }

  // ── Search/Ranking ───────────────────────────────────────────────────────
  async searchProducts(query: string, channel: "retail" | "wholesale" = "wholesale") {
    // Foundation: search by name/slug, order by search_rank + Kolbe priority
    // Retail ONLY Kolbe, Wholesale Kolbe+Supplier
    let all: (typeof product.$inferSelect)[];
    if (channel === "retail") {
      all = await this.db
        .select()
        .from(product)
        .where(and(eq(product.ownerType, "KOLBE"), eq(product.status, "published")))
        .limit(100);
    } else {
      all = await this.db.select().from(product).where(eq(product.status, "published")).limit(100);
    }
    const normalized = query.trim().toLowerCase();
    return all
      .filter((p) => p.name.toLowerCase().includes(normalized) || p.slug.toLowerCase().includes(normalized))
      .sort((a, b) => {
        // Kolbe priority
        if (a.ownerType === "KOLBE" && b.ownerType !== "KOLBE") return -1;
        if (b.ownerType === "KOLBE" && a.ownerType !== "KOLBE") return 1;
        return (b.searchRank ?? 0) - (a.searchRank ?? 0);
      });
  }

  async assertRetailIsolation(productId: string) {
    const [prod] = await this.db.select().from(product).where(eq(product.id, productId)).limit(1);
    if (!prod) throw new NotFoundError("محصول یافت نشد");
    if (prod.ownerType !== "KOLBE") {
      throw new CatalogDomainError("RETAIL_ONLY_KOLBE", "خرده‌فروشی فقط محصولات کلبه — محصول تأمین‌کننده در خرده‌فروشی مجاز نیست");
    }
    return prod;
  }

  // ── Phase 4.3.1 — Order eligibility queries (owner reads) ───────────────
  async getOrderEligibleProduct(productId: string, executor?: any) {
    const db = (executor as any) || this.db;
    const [prod] = await db.select().from(product).where(eq(product.id, productId)).limit(1);
    if (!prod) throw new NotFoundError("محصول یافت نشد");
    // For wholesale order, product must exist and not be archived? Keep eligibility lenient but not deleted
    if (prod.status === "archived") {
      throw new CatalogDomainError("PRODUCT_NOT_ELIGIBLE", `Product ${productId} archived`);
    }
    return prod;
  }

  async getVariantForOrder(variantId: string, productId: string, executor?: any) {
    const db = (executor as any) || this.db;
    const [variant] = await db.select().from(productVariant).where(eq(productVariant.id, variantId)).limit(1);
    if (!variant) throw new NotFoundError("واریانت یافت نشد");
    if (productId && variant.productId !== productId) {
      throw new CatalogDomainError("VARIANT_PRODUCT_MISMATCH", "واریانت متعلق به محصول نیست");
    }
    return variant;
  }

  async getDbNow(executor?: any) {
    const db = (executor as any) || this.db;
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`SELECT NOW() as now`);
    const nowVal = (result as any).rows?.[0]?.now || (result as any)[0]?.now;
    return new Date(nowVal);
  }
}
