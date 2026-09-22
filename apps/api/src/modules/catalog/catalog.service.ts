import { Inject, Injectable } from "@nestjs/common";
import { eq, and, sql } from "drizzle-orm";
import { product, productVariant, productMedia, productVariantMedia, brand, category, seller, sellerOffer, supplierMember, supplierProductSubmission } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { DomainError } from "@kolbe/shared";
import { ProductComplianceService } from "../compliance/product-compliance.service";
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
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(ProductComplianceService) private readonly productCompliance: ProductComplianceService,
  ) {}

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

    // Phase 4.7.5 — publication gate owned by Compliance (catalog stays the owner of the transition).
    if (nextStatus === "published") {
      const decision = await this.productCompliance.canPublishProduct({ productId, ownerType: existing.ownerType });
      if (!decision.allowed) {
        throw new DomainError(409, decision.reasonCode ?? "PRODUCT_COMPLIANCE_BLOCKED", `انتشار محصول مسدود است (وضعیت انطباق: ${decision.complianceStatus}, حالت: ${decision.mode})`);
      }
    }

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

  // ── Phase 5.10-A — server-side search ────────────────────────────────────
  // Stock PostgreSQL ships no Persian stemmer, so relevance is trigram
  // similarity (script-agnostic, typo-tolerant) inside deterministic
  // tiers. searchRank is deliberately NOT consulted: nothing maintains
  // it yet, and consulting it would launder stale zeros as signal.
  //
  // Tier score (total order with id ASC, stable across runs):
  //   exact name match ............ 1000
  //   name prefix ................. 500 + 100·sim(name)
  //   name contains OR sim > 0.18 .. 100 + 100·sim(name)
  //   slug/brand/category match ... 10 + 100·max(sim(slug, brand, category))
  private static readonly SEARCH_LIMIT_DEFAULT = 20;
  private static readonly SEARCH_LIMIT_MAX = 50;
  private static readonly SEARCH_SIMILARITY_FLOOR = 0.18;
  private static readonly SEARCH_QUERY_MAX = 200;

  /**
   * Trim + collapse whitespace + fold Arabic Yeh/Kaf to Persian
   * (U+064A→U+06CC, U+0643→U+06A9). A recall boundary, not a security
   * boundary: every query is parameterized, so this only widens matches.
   */
  normalizeSearchQuery(query: unknown): string {
    if (typeof query !== "string") return "";
    return query
      .replace(/\u064A/g, "\u06CC")
      .replace(/\u0643/g, "\u06A9")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, CatalogService.SEARCH_QUERY_MAX);
  }

  private clampSearchLimit(limit: unknown): number {
    const parsed = typeof limit === "string" && limit !== "" ? Number(limit) : (limit as number);
    if (!Number.isSafeInteger(parsed)) return CatalogService.SEARCH_LIMIT_DEFAULT;
    return Math.min(Math.max(parsed, 1), CatalogService.SEARCH_LIMIT_MAX);
  }

  private decodeSearchCursor(cursor: unknown): { score: number; id: string } | null {
    if (cursor === undefined || cursor === null) return null;
    try {
      if (typeof cursor !== "string" || cursor === "") throw new Error("empty");
      const [score, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (typeof score !== "number" || !Number.isFinite(score) || typeof id !== "string" || id === "") {
        throw new Error("shape");
      }
      return { score, id };
    } catch {
      throw new CatalogDomainError("SEARCH_CURSOR_INVALID", "search cursor is malformed");
    }
  }

  private encodeSearchCursor(score: number, id: string): string {
    return Buffer.from(JSON.stringify([score, id])).toString("base64url");
  }

  async searchProducts(
    query: string,
    channel: "retail" | "wholesale" = "wholesale",
    opts: { limit?: unknown; cursor?: unknown } = {},
  ): Promise<{ results: Array<Record<string, unknown>>; nextCursor: string | null }> {
    const q = this.normalizeSearchQuery(query);
    if (!q) return { results: [], nextCursor: null };
    const retail = channel === "retail";
    const limit = this.clampSearchLimit(opts.limit);
    const cursor = this.decodeSearchCursor(opts.cursor);
    const ql = q.toLowerCase();
    const escaped = ql.replace(/[\\%_]/g, "\\$&");
    const contains = `%${escaped}%`;
    const prefix = `${escaped}%`;
    const floor = CatalogService.SEARCH_SIMILARITY_FLOOR;

    const scoreExpr = sql<number>`(CASE
      WHEN lower(p."name") = ${ql} THEN 1000
      WHEN lower(p."name") LIKE ${prefix} ESCAPE '\\' THEN 500 + 100 * similarity(lower(p."name"), ${ql})
      WHEN p."name" ILIKE ${contains} ESCAPE '\\' OR similarity(lower(p."name"), ${ql}) > ${floor}
        THEN 100 + 100 * similarity(lower(p."name"), ${ql})
      ELSE 10 + 100 * GREATEST(
        similarity(lower(p."slug"), ${ql}),
        similarity(lower(COALESCE(b."name", '')), ${ql}),
        similarity(lower(COALESCE(c."name", '')), ${ql})
      )
    END)::double precision`;

    const keyset = cursor
      ? sql`AND (scored."score" < ${cursor.score} OR (scored."score" = ${cursor.score} AND scored."id" > ${cursor.id}))`
      : sql``;

    const result = await this.db.execute(sql`
      WITH scored AS (
        SELECT p.*, ${scoreExpr} AS "score"
        FROM "product" AS p
        LEFT JOIN "brand" AS b ON b."id" = p."brand_id"
        LEFT JOIN "category" AS c ON c."id" = p."category_id"
        WHERE p."status" = 'published'
          ${retail ? sql`AND p."owner_type" = 'KOLBE'` : sql``}
          AND (
            p."name" ILIKE ${contains} ESCAPE '\\'
            OR p."slug" ILIKE ${contains} ESCAPE '\\'
            OR similarity(lower(p."name"), ${ql}) > ${floor}
            OR similarity(lower(p."slug"), ${ql}) > ${floor}
            OR similarity(lower(COALESCE(b."name", '')), ${ql}) > ${floor}
            OR similarity(lower(COALESCE(c."name", '')), ${ql}) > ${floor}
          )
      )
      SELECT * FROM scored
      WHERE 1 = 1 ${keyset}
      ORDER BY "score" DESC, "id" ASC
      LIMIT ${limit + 1}
    `);
    const rows = ((result as any).rows ?? []) as Array<Record<string, unknown>>;
    const kept = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit ? this.encodeSearchCursor(kept[kept.length - 1].score as number, kept[kept.length - 1].id as string) : null;
    return {
      results: kept.map((row) => ({ ...row, score: Math.round((row.score as number) * 1000) / 1000 })),
      nextCursor,
    };
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

  // ── Phase 5.8 — nullable owner reads for Retail pricing ────────────────
  // Retail throws its own precise codes (RETAIL_PRODUCT_NOT_FOUND, …), so
  // these return rows-or-null instead of throwing catalog errors.

  async findProductForRetail(productId: string, executor?: any) {
    const db = (executor as any) || this.db;
    const [prod] = await db.select().from(product).where(eq(product.id, productId)).limit(1);
    return prod ?? null;
  }

  async findVariantById(variantId: string, executor?: any) {
    const db = (executor as any) || this.db;
    const [variant] = await db.select().from(productVariant).where(eq(productVariant.id, variantId)).limit(1);
    return variant ?? null;
  }

  async listActiveVariantsForProduct(productId: string, executor?: any) {
    const db = (executor as any) || this.db;
    return db
      .select()
      .from(productVariant)
      .where(and(eq(productVariant.productId, productId), eq(productVariant.status, "active")));
  }

  /** Primary display image for an order snapshot: variant media wins, else product media. */
  async getPrimaryMedia(productId: string, variantId: string | null, executor?: any): Promise<string | null> {
    const db = (executor as any) || this.db;
    if (variantId) {
      const rows = await db
        .select({ url: productVariantMedia.url })
        .from(productVariantMedia)
        .where(eq(productVariantMedia.variantId, variantId))
        .orderBy(productVariantMedia.position)
        .limit(1);
      if (rows[0]?.url) return rows[0].url;
    }
    const rows = await db
      .select({ url: productMedia.url })
      .from(productMedia)
      .where(eq(productMedia.productId, productId))
      .orderBy(productMedia.position)
      .limit(1);
    return rows[0]?.url ?? null;
  }

  async getDbNow(executor?: any) {
    const db = (executor as any) || this.db;
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`SELECT NOW() as now`);
    const nowVal = (result as any).rows?.[0]?.now || (result as any)[0]?.now;
    return new Date(nowVal);
  }
}
