import { Inject, Injectable } from "@nestjs/common";
import { eq, and, sql, inArray } from "drizzle-orm";
import { product, productVariant, productMedia, productVariantMedia, brand, category, seller, sellerOffer, supplierMember, supplierProductSubmission, productVariantInventory, wholesalePackage, wholesalePackageItem, wholesalePricingTier } from "@kolbe/database";
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
  calculatePackageTotalPieces,
  validateWholesalePackage,
  validateStagedCommercialGraph,
  normalizeStagedVariants,
  normalizeStagedMedia,
  normalizeStagedCommercial,
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
    // اعتبارسنجیِ زودهنگامِ گرافِ تجاریِ مرحله‌بندی‌شده تا تأمین‌کننده همان لحظه
    // بازخورد بگیرد، نه هنگامِ تأییدِ ادمین. همان قواعدِ ماده‌سازی.
    validateStagedCommercialGraph({
      variants: normalizeStagedVariants(input.variants),
      media: normalizeStagedMedia(input.media),
      commercial: normalizeStagedCommercial(input.commercial),
    });

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

  /**
   * ماده‌سازیِ **بدونِ اتلافِ** پیشنهادِ تأمین‌کننده به گرافِ کانونیکال.
   *
   * ثابتِ حاکم: «آنچه ادمین تأیید می‌کند = آنچه کانونیکال می‌شود». پیش‌تر این
   * مسیر `moqUnit` را به `PIECE` سخت‌کد می‌کرد (پاک‌کردنِ SERIES)، رسانه و
   * رسانهٔ واریانت را هرگز نمی‌ساخت، `retailPrice`/`currency`/`packageType` را
   * نمی‌خواند، بسته‌ها و پله‌های قیمت را ماده‌سازی نمی‌کرد، و در صورتِ قیمتِ
   * نامعتبر **بی‌صدا** هیچ پیشنهادی نمی‌ساخت. همهٔ اینها اینجا اصلاح شده است.
   *
   * - تمام‌یا-هیچ: هر خطا تراکنش را برمی‌گرداند؛ محصولِ نیمه‌ماده‌سازی‌شده ممنوع.
   * - idempotency: قفلِ سطری `FOR UPDATE` + نگهبانِ وضعیت؛ کلیکِ دوبارهٔ ادمین
   *   محصول/واریانت/پیشنهادِ تکراری نمی‌سازد.
   * - سازگاریِ backward: پیشنهادِ ساده/قدیمی (بدونِ `moqUnit` و بسته) همچنان به
   *   محصولِ سادهٔ معتبر تبدیل می‌شود؛ `PIECE` یک **پیش‌فرضِ صریحِ دامنه** است
   *   برای وقتی که تأمین‌کننده واحدی اعلام نکرده، نه پاک‌کردنِ قصدِ او.
   *
   * نکتهٔ مالکیت: جداولِ تجاری (`seller_offer`, `wholesale_package`,
   * `wholesale_package_item`, `wholesale_pricing_tier`) مالکشان ماژولِ `offers`
   * است و `product_variant_inventory` مالکِ `inventory`. چون `offers dependsOn
   * catalog`، وابستگیِ معکوس حلقهٔ DI می‌سازد؛ پس این «درزِ ماده‌سازیِ تأیید»
   * همان الگوی ازقبل‌موجود است (همین متد پیش‌تر هم `seller_offer` را می‌نوشت) و
   * در `READ_EXCEPTIONS` به‌صورت **صریح و ثبت‌شده** قابلِ مشاهده است — نه تکیه بر
   * نقطهٔ کورِ آزمون. بدهیِ ثبت‌شده برای فاز ۶.۷.
   */
  async approveSubmissionAsNew(id: string, reviewedBy: string, note?: string) {
    return this.db.transaction(async (tx) => {
      const [submission] = await tx
        .select()
        .from(supplierProductSubmission)
        .where(eq(supplierProductSubmission.id, id))
        .for("update")
        .limit(1);
      if (!submission) throw new NotFoundError("درخواست محصول یافت نشد");
      if (submission.status !== "pending_review") throw new CatalogDomainError("SUBMISSION_NOT_PENDING", "درخواست در انتظار بررسی نیست");
      if (submission.proposedBrandId) {
        const [proposedBrand] = await tx.select().from(brand).where(eq(brand.id, submission.proposedBrandId)).limit(1);
        if (!proposedBrand || proposedBrand.verificationStatus !== "approved") throw new CatalogDomainError("BRAND_REVIEW_REQUIRED", "برند پیشنهادی ابتدا باید تأیید شود");
      }

      const stagedVariants = normalizeStagedVariants(submission.variants);
      const stagedMedia = normalizeStagedMedia(submission.media);
      const stagedCommercial = normalizeStagedCommercial(submission.commercial);
      // اعتبارسنجیِ صریحِ کلِ گراف **پیش از** هر نوشتن — جایِ ردِ بی‌صدا.
      validateStagedCommercialGraph({ variants: stagedVariants, media: stagedMedia, commercial: stagedCommercial });

      const stamp = Date.now();
      const uid = (prefix: string, index: number) => `${prefix}_${stamp}_${index}_${Math.random().toString(36).slice(2, 8)}`;

      const [created] = await tx.insert(product).values({
        id: uid("prod", 0), name: submission.proposedName,
        slug: submission.proposedSlug, description: submission.proposedDescription,
        // SKU پایه/مرجعِ محصول از بخشِ تجاری — پیش‌تر فقط در attributes می‌ماند.
        sku: stagedCommercial.sku ?? stagedVariants[0]?.sku ?? null,
        brandId: submission.brandId ?? submission.proposedBrandId, categoryId: submission.categoryId,
        ownerType: "SUPPLIER", isKolbeExclusive: false, status: "approved", createdBy: submission.createdBy,
      }).returning();

      // ── واریانت‌ها ─────────────────────────────────────────────────────────
      const variantIdBySku = new Map<string, string>();
      for (let index = 0; index < stagedVariants.length; index += 1) {
        const staged = stagedVariants[index]!;
        const [variant] = await tx.insert(productVariant).values({
          id: uid("var", index), productId: created.id, sku: staged.sku,
          attributes: staged.attributes ?? {},
          // قصدِ تأمین‌کننده برای وضعیت حفظ می‌شود (پیش‌فرضِ دامنه: active).
          status: staged.status ?? "active",
        }).returning();
        variantIdBySku.set(staged.sku, variant.id);
      }

      // ── رسانهٔ محصول و رسانهٔ واریانت ─────────────────────────────────────
      let mediaIndex = 0;
      for (const item of stagedMedia) {
        const targetVariantId = item.variantSku != null ? variantIdBySku.get(item.variantSku) : undefined;
        if (targetVariantId) {
          await tx.insert(productVariantMedia).values({
            id: uid("pvm", mediaIndex), variantId: targetVariantId, url: item.url,
            type: item.type ?? "image", position: item.position ?? mediaIndex,
          });
        } else {
          await tx.insert(productMedia).values({
            id: uid("pm", mediaIndex), productId: created.id, url: item.url,
            type: item.type ?? "image", position: item.position ?? mediaIndex,
          });
        }
        mediaIndex += 1;
      }
      for (let index = 0; index < stagedVariants.length; index += 1) {
        const staged = stagedVariants[index]!;
        const variantId = variantIdBySku.get(staged.sku)!;
        const embedded = staged.media ?? [];
        for (let m = 0; m < embedded.length; m += 1) {
          await tx.insert(productVariantMedia).values({
            id: uid("pve", index * 100 + m), variantId, url: embedded[m]!.url,
            type: embedded[m]!.type ?? "image", position: embedded[m]!.position ?? m,
          });
        }
      }

      // ── موجودیِ هر واریانت (مرجعِ کانونیکال) ───────────────────────────────
      for (let index = 0; index < stagedVariants.length; index += 1) {
        const staged = stagedVariants[index]!;
        const onHand = staged.inventory?.onHand;
        if (onHand == null) continue;
        await tx.insert(productVariantInventory).values({
          id: uid("pvi", index), variantId: variantIdBySku.get(staged.sku)!,
          sellerId: submission.sellerId, onHand, reserved: 0, status: "active",
        });
      }

      // ── پیشنهادِ تجاری (بدونِ پاک‌کردنِ واحدِ MOQ) ─────────────────────────
      let offerId: string | null = null;
      const hasCommercial = stagedCommercial.wholesalePrice != null;
      if (hasCommercial) {
        const offerSku = stagedCommercial.sku ?? stagedVariants[0]?.sku;
        if (!offerSku) throw new CatalogDomainError("SUBMISSION_SKU_REQUIRED", "شناسهٔ تجاری پیشنهاد موجود نیست");
        const boundVariantId = stagedCommercial.variantSku != null
          ? variantIdBySku.get(stagedCommercial.variantSku) ?? null
          : variantIdBySku.get(offerSku) ?? null;
        const id = uid("offer", 0);
        await tx.insert(sellerOffer).values({
          id, productId: created.id, sellerId: submission.sellerId, variantId: boundVariantId,
          sku: offerSku, status: "draft",
          wholesalePrice: BigInt(stagedCommercial.wholesalePrice as string),
          retailPrice: stagedCommercial.retailPrice != null ? BigInt(stagedCommercial.retailPrice) : null,
          currency: stagedCommercial.currency ?? "IRR",
          moq: stagedCommercial.moq ?? 1,
          // قصدِ تأمین‌کننده حفظ می‌شود؛ PIECE فقط وقتی که واحدی اعلام نشده.
          moqUnit: stagedCommercial.moqUnit ?? "PIECE",
          packageType: stagedCommercial.packageType ?? null,
        });
        offerId = id;
      }

      // ── بسته‌ها / سری‌ها (SKU مرحله‌بندی‌شده → شناسهٔ واریانتِ ساخته‌شده) ────
      const packages = stagedCommercial.packages ?? [];
      if (packages.length > 0) {
        if (!offerId) throw new CatalogDomainError("PACKAGE_REQUIRES_OFFER", "بسته بدونِ پیشنهادِ تجاری قابلِ ساخت نیست");
        for (let p = 0; p < packages.length; p += 1) {
          const pkg = packages[p]!;
          const items = pkg.items.map((item) => ({
            variantId: variantIdBySku.get(item.sku)!,
            quantity: item.quantity,
          }));
          if (items.some((item) => item.variantId == null)) {
            throw new CatalogDomainError("INVALID_PACKAGE_VARIANT", "واریانتِ بسته متعلق به این محصول نیست");
          }
          const totalPieces = calculatePackageTotalPieces(items);
          // بازاستفاده از همان قواعدِ دامنهٔ `offers` (نوع + مجموع + ترکیب).
          validateWholesalePackage({ offerId, packageType: pkg.packageType, name: pkg.name, totalPieces, items });
          const packageId = uid("wpkg", p);
          await tx.insert(wholesalePackage).values({
            id: packageId, offerId, packageType: pkg.packageType, name: pkg.name,
            description: pkg.description ?? null, totalPieces,
          });
          for (let i = 0; i < items.length; i += 1) {
            await tx.insert(wholesalePackageItem).values({
              id: uid("wpit", p * 100 + i), packageId, variantId: items[i]!.variantId, quantity: items[i]!.quantity,
            });
          }
        }
      }

      // ── پله‌های قیمت (همان قاعدهٔ هم‌پوشانیِ `offers.service`) ──────────────
      const tiers = stagedCommercial.pricingTiers ?? [];
      if (tiers.length > 0) {
        if (!offerId) throw new CatalogDomainError("PRICING_TIER_REQUIRES_OFFER", "پلهٔ قیمت بدونِ پیشنهادِ تجاری قابلِ ساخت نیست");
        for (let t = 0; t < tiers.length; t += 1) {
          const tier = tiers[t]!;
          await tx.insert(wholesalePricingTier).values({
            id: uid("wpt", t), offerId, minQuantity: tier.minQuantity,
            maxQuantity: tier.maxQuantity ?? null, unitPrice: BigInt(tier.unitPrice),
            currency: stagedCommercial.currency ?? "IRR",
            moqUnit: tier.moqUnit ?? stagedCommercial.moqUnit ?? "PIECE",
          });
        }
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
      const commercial = (submission.commercial ?? {}) as { sku?: string; wholesalePrice?: string | number; moq?: number };
      if (!commercial.sku) throw new CatalogDomainError("SUBMISSION_SKU_REQUIRED", "شناسهٔ تجاری پیشنهاد موجود نیست");
      await tx.insert(sellerOffer).values({ id: `offer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, productId, sellerId: submission.sellerId, variantId: null, sku: commercial.sku, status: "draft", wholesalePrice: BigInt(commercial.wholesalePrice ?? 0), retailPrice: null, moq: Math.max(1, commercial.moq ?? 1), moqUnit: "PIECE" });
      const [updated] = await tx.update(supplierProductSubmission).set({ status: "approved_existing_product", approvedProductId: productId, reviewedBy, reviewedAt: new Date(), adminReviewNote: note ?? null, updatedAt: new Date() }).where(eq(supplierProductSubmission.id, id)).returning();
      return updated;
    });
  }

  /**
   * قراردادِ بازبینیِ ادمین.
   *
   * ادمین نباید چیزی را تأیید کند که نمی‌تواند ببیند؛ پیش‌تر هیچ `GET` ای وجود
   * نداشت و approve/reject تنها مسیرها بودند. این متد **کلِ** گرافِ
   * مرحله‌بندی‌شده را برمی‌گرداند: اطلاعاتِ پایه، واریانت‌ها، رسانه، بخشِ تجاری
   * (قیمت، ارز، MOQ، «واحدِ MOQ»، نوعِ بسته)، بسته‌ها با ترکیبشان، و پله‌های قیمت.
   * هیچ فیلدی برای بازبینی پنهان نمی‌ماند.
   */
  async listSupplierSubmissions(filter: { supplierId?: string; status?: string } = {}) {
    const conditions = [];
    if (filter.supplierId) conditions.push(eq(supplierProductSubmission.supplierId, filter.supplierId));
    if (filter.status) conditions.push(eq(supplierProductSubmission.status, filter.status));
    const rows = await this.db
      .select()
      .from(supplierProductSubmission)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(supplierProductSubmission.createdAt);
    return rows.map((row) => this.toSubmissionReview(row));
  }

  async getSupplierSubmission(id: string) {
    const [row] = await this.db.select().from(supplierProductSubmission).where(eq(supplierProductSubmission.id, id)).limit(1);
    if (!row) throw new NotFoundError("درخواست محصول یافت نشد");
    return this.toSubmissionReview(row);
  }

  /** نگاشتِ رکوردِ پیشنهاد به قراردادِ بازبینی (بدونِ هیچ حذفِ بی‌صدا). */
  private toSubmissionReview(row: typeof supplierProductSubmission.$inferSelect) {
    const variants = normalizeStagedVariants(row.variants);
    const media = normalizeStagedMedia(row.media);
    const commercial = normalizeStagedCommercial(row.commercial);
    return {
      id: row.id,
      status: row.status,
      supplierId: row.supplierId,
      sellerId: row.sellerId,
      createdBy: row.createdBy,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      adminReviewNote: row.adminReviewNote,
      matchedProductId: row.matchedProductId,
      approvedProductId: row.approvedProductId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      product: {
        name: row.proposedName,
        slug: row.proposedSlug,
        description: row.proposedDescription,
        brandId: row.brandId,
        proposedBrandId: row.proposedBrandId,
        categoryId: row.categoryId,
        // صریح: ستونِ `attributes` در جدولِ `product` وجود ندارد، پس attributes
        // سطحِ محصول مقصدِ کانونیکال ندارد و در ماده‌سازی حفظ نمی‌شود. اینجا
        // **دیده می‌شود** تا ادمین بداند، و به‌عنوان شکافِ ثبت‌شده باقی می‌ماند.
        attributes: row.attributes,
      },
      variants,
      media,
      commercial,
      // جمعِ قطعاتِ هر بسته برای بازبینی (مرجعِ نهایی `validateWholesalePackage`).
      packageTotals: (commercial.packages ?? []).map((pkg) => ({
        name: pkg.name,
        packageType: pkg.packageType,
        totalPieces: calculatePackageTotalPieces(pkg.items.map((item) => ({ variantId: item.sku, quantity: item.quantity }))),
        items: pkg.items,
      })),
    };
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
  // tiers. The legacy rank column is deliberately NOT consulted: nothing maintains
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

  private clampPageLimit(limit: unknown): number {
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
      // DomainError, not CatalogDomainError: the latter carries no HTTP
      // status and would surface a client error as 500.
      throw new DomainError(400, "SEARCH_CURSOR_INVALID", "search cursor is malformed");
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
    const limit = this.clampPageLimit(opts.limit);
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

  // ── Phase 5.10-B — discovery ───────────────────────────────────────────────
  // Browse prices from published channel offers over active variants; a
  // product with no priced offer is excluded (a listing without a price
  // is a lie). Availability sums sellable shelf (on_hand − reserved,
  // floored at 0) only where a priced offer can actually sell it.

  parseBrowseSort(sort: unknown): "newest" | "price_asc" | "price_desc" | "rating" {
    return sort === "price_asc" || sort === "price_desc" || sort === "rating" ? sort : "newest";
  }

  /** Unsigned BIGINT bound; garbage → null (ignored), over-max → clamped. */
  parseMoneyBound(value: unknown): string | null {
    if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) return null;
    const parsed = BigInt(value);
    return (parsed > 9223372036854775807n ? 9223372036854775807n : parsed).toString();
  }

  private decodeBrowseCursor(cursor: unknown): { sort: string; keys: string[]; id: string } | null {
    if (cursor === undefined || cursor === null) return null;
    try {
      if (typeof cursor !== "string" || cursor === "") throw new Error("empty");
      const parts = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      const [sort, ...rest] = parts as unknown[];
      const id = rest[rest.length - 1];
      const keys = rest.slice(0, -1);
      // Keys are numeric strings in every sort (epoch micros for newest,
      // minor units for price sorts, avg + count for rating) — anything
      // else fails closed instead of reaching SQL.
      const bigint = (v: unknown) => typeof v === "string" && /^\d{1,25}$/.test(v);
      const numeric = (v: unknown) => typeof v === "string" && /^\d{1,25}(\.\d{1,30})?$/.test(v);
      if (typeof id !== "string" || id === "") throw new Error("shape");
      if (sort === "rating") {
        if (keys.length !== 2 || !numeric(keys[0]) || !bigint(keys[1])) throw new Error("shape");
      } else if (sort === "newest" || sort === "price_asc" || sort === "price_desc") {
        if (keys.length !== 1 || !bigint(keys[0])) throw new Error("shape");
      } else {
        throw new Error("shape");
      }
      return { sort: sort as string, keys: keys as string[], id };
    } catch {
      throw new DomainError(400, "BROWSE_CURSOR_INVALID", "browse cursor is malformed");
    }
  }

  private encodeBrowseCursor(sort: string, keys: string[], id: string): string {
    return Buffer.from(JSON.stringify([sort, ...keys, id])).toString("base64url");
  }

  /** Active-subtree ids for a category root; null = unknown/inactive root. */
  async collectCategorySubtree(rootId: string): Promise<string[] | null> {
    const rows = await this.db
      .select({ id: category.id, parentId: category.parentId, status: category.status })
      .from(category);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const root = byId.get(rootId);
    if (!root || root.status !== "active") return null;
    const children = new Map<string, string[]>();
    for (const row of rows) {
      if (row.status !== "active" || !row.parentId) continue;
      const list = children.get(row.parentId) ?? [];
      list.push(row.id);
      children.set(row.parentId, list);
    }
    const out = [rootId];
    const queue = [rootId];
    const seen = new Set([rootId]);
    while (queue.length) {
      const next = queue.shift()!;
      for (const child of children.get(next) ?? []) {
        if (seen.has(child)) continue; // cycle-guard
        seen.add(child);
        out.push(child);
        queue.push(child);
      }
    }
    return out;
  }

  async browseProducts(query: {
    channel?: unknown;
    category?: unknown;
    brand?: unknown;
    minPrice?: unknown;
    maxPrice?: unknown;
    inStock?: unknown;
    sort?: unknown;
    limit?: unknown;
    cursor?: unknown;
  }): Promise<{
    results: Array<Record<string, unknown>>;
    nextCursor: string | null;
    facets: { categories: Array<{ id: string; count: number }>; brands: Array<{ id: string; count: number }> };
  }> {
    const empty = () => ({ results: [], nextCursor: null, facets: { categories: [], brands: [] } });
    const retail = query.channel === "retail";
    const sort = this.parseBrowseSort(query.sort);
    const limit = this.clampPageLimit(query.limit);
    const cursor = this.decodeBrowseCursor(query.cursor);
    if (cursor && cursor.sort !== sort) {
      throw new DomainError(400, "BROWSE_CURSOR_INVALID", "browse cursor was issued for another sort");
    }

    let categoryIds: string[] | null = null;
    if (typeof query.category === "string" && query.category !== "") {
      categoryIds = await this.collectCategorySubtree(query.category);
      if (!categoryIds) return empty();
    }
    const brandId = typeof query.brand === "string" && query.brand !== "" ? query.brand : null;
    const minPrice = this.parseMoneyBound(query.minPrice);
    const maxPrice = this.parseMoneyBound(query.maxPrice);
    if (minPrice !== null && maxPrice !== null && BigInt(minPrice) > BigInt(maxPrice)) return empty();
    const stockOnly = query.inStock === true || query.inStock === "true";

    let kolbeSellerId: string | null = null;
    if (retail) {
      const [kolbe] = await this.db.select({ id: seller.id }).from(seller).where(eq(seller.type, "KOLBE")).limit(1);
      kolbeSellerId = kolbe?.id ?? null;
      if (!kolbeSellerId) return empty(); // No KOLBE seller → no retail offers exist.
    }

    // Static fragments chosen by booleans — never interpolated user input.
    const priceCol = retail ? sql`"retail_price"` : sql`"wholesale_price"`;
    const sellerFence = retail ? sql`AND o."seller_id" = ${kolbeSellerId}` : sql``;
    const ownerFence = retail ? sql`AND p."owner_type" = 'KOLBE'` : sql``;
    const pricedFrom = (withCategory: boolean, withBrand: boolean) => sql`
      rated AS (
        SELECT "product_id", AVG("rating") AS "avg", COUNT(*) AS "cnt"
        FROM "product_rating" WHERE "status" IN ('visible', 'flagged') GROUP BY "product_id"
      ),
      channel_offers AS (
        SELECT o."product_id", o.${priceCol} AS "price", o."currency", o."variant_id", o."seller_id"
        FROM "seller_offer" AS o
        JOIN "product_variant" AS v ON v."id" = o."variant_id" AND v."status" = 'active'
        WHERE o."status" = 'published' AND o.${priceCol} IS NOT NULL ${sellerFence}
      ),
      priced AS (
        SELECT
          p."id", p."name", p."slug", p."description", p."brand_id", p."category_id",
          p."owner_type", p."view_count", p."created_at",
          (SELECT MIN(co."price") FROM channel_offers co WHERE co."product_id" = p."id") AS "price_from",
          (SELECT co."currency" FROM channel_offers co WHERE co."product_id" = p."id"
           ORDER BY co."price" ASC, co."variant_id" ASC, co."seller_id" ASC LIMIT 1) AS "price_currency",
          (SELECT COALESCE(SUM(GREATEST(inv."on_hand" - inv."reserved", 0)), 0)
           FROM channel_offers co
           JOIN "product_variant_inventory" inv
             ON inv."variant_id" = co."variant_id" AND inv."seller_id" = co."seller_id"
           WHERE co."product_id" = p."id") AS "availability",
          rt."avg" AS "rating_avg", COALESCE(rt."cnt", 0) AS "rating_count"
        FROM "product" AS p
        LEFT JOIN rated rt ON rt."product_id" = p."id"
        WHERE p."status" = 'published' ${ownerFence}
          ${withCategory && categoryIds ? sql`AND p."category_id" IN (${sql.join(categoryIds.map((cid) => sql`${cid}`), sql`, `)})` : sql``}
          ${withBrand && brandId ? sql`AND p."brand_id" = ${brandId}` : sql``}
      )`;
    const windowFence =
      minPrice !== null && maxPrice !== null
        ? sql`AND priced."price_from" >= ${minPrice} AND priced."price_from" <= ${maxPrice}`
        : minPrice !== null
          ? sql`AND priced."price_from" >= ${minPrice}`
          : maxPrice !== null
            ? sql`AND priced."price_from" <= ${maxPrice}`
            : sql``;
    const stockFence = stockOnly ? sql`AND priced."availability" > 0` : sql``;
    // Newest keys on epoch microseconds computed in SQL: exact in both
    // worlds (a JS Date cannot hold the sub-millisecond part).
    const newestKey = sql`(EXTRACT(EPOCH FROM priced."created_at") * 1000000)::bigint`;
    // Unrated products sink: COALESCE(avg, 0) keeps the order total and
    // the cursor numeric (a NULL key could never round-trip exactly).
    const ratingKey = sql`COALESCE(priced."rating_avg", 0)`;
    const keyset = !cursor
      ? sql``
      : sort === "newest"
        ? sql`AND (${newestKey} < ${cursor.keys[0]} OR (${newestKey} = ${cursor.keys[0]} AND priced."id" > ${cursor.id}))`
        : sort === "price_asc"
          ? sql`AND (priced."price_from" > ${cursor.keys[0]} OR (priced."price_from" = ${cursor.keys[0]} AND priced."id" > ${cursor.id}))`
          : sort === "price_desc"
            ? sql`AND (priced."price_from" < ${cursor.keys[0]} OR (priced."price_from" = ${cursor.keys[0]} AND priced."id" > ${cursor.id}))`
            : sql`AND (${ratingKey} < ${cursor.keys[0]} OR (${ratingKey} = ${cursor.keys[0]} AND (priced."rating_count" < ${cursor.keys[1]} OR (priced."rating_count" = ${cursor.keys[1]} AND priced."id" > ${cursor.id}))))`;
    const orderBy =
      sort === "newest"
        ? sql`${newestKey} DESC, priced."id" ASC`
        : sort === "price_asc"
          ? sql`priced."price_from" ASC, priced."id" ASC`
          : sort === "price_desc"
            ? sql`priced."price_from" DESC, priced."id" ASC`
            : sql`${ratingKey} DESC, priced."rating_count" DESC, priced."id" ASC`;

    const result = await this.db.execute(sql`
      WITH ${pricedFrom(true, true)}
      SELECT priced.*, ${newestKey} AS "newest_key" FROM priced
      WHERE priced."price_from" IS NOT NULL ${windowFence} ${stockFence} ${keyset}
      ORDER BY ${orderBy}
      LIMIT ${limit + 1}
    `);
    const rows = ((result as any).rows ?? []) as Array<Record<string, unknown>>;
    const kept = rows.slice(0, limit);
    const cursorKeys = (row: Record<string, unknown>) =>
      sort === "rating"
        ? [(row.rating_avg as string | null) ?? "0", String(row.rating_count)]
        : [sort === "newest" ? String(row.newest_key) : (row.price_from as string)];
    const nextCursor =
      rows.length > limit
        ? this.encodeBrowseCursor(sort, cursorKeys(kept[kept.length - 1]), kept[kept.length - 1].id as string)
        : null;

    const facet = async (column: ReturnType<typeof sql>, withCategory: boolean, withBrand: boolean) => {
      const res = await this.db.execute(sql`
        WITH ${pricedFrom(withCategory, withBrand)}
        SELECT priced.${column} AS "id", COUNT(*)::int AS "count"
        FROM priced
        WHERE priced."price_from" IS NOT NULL ${windowFence} ${stockFence} AND priced.${column} IS NOT NULL
        GROUP BY priced.${column}
      `);
      return (((res as any).rows ?? []) as Array<{ id: string; count: number }>).sort((a, b) =>
        a.id < b.id ? -1 : 1,
      );
    };

    return {
      results: kept.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        brandId: row.brand_id,
        categoryId: row.category_id,
        ownerType: row.owner_type,
        priceFrom: row.price_from,
        priceCurrency: row.price_currency,
        availability: Number(row.availability),
        ratingAverage: row.rating_avg === null ? null : Math.round(Number(row.rating_avg) * 100) / 100,
        ratingCount: Number(row.rating_count),
        viewCount: row.view_count,
        createdAt: new Date(row.created_at as string | Date).toISOString(),
      })),
      nextCursor,
      facets: {
        categories: await facet(sql`"category_id"`, false, true),
        brands: await facet(sql`"brand_id"`, true, false),
      },
    };
  }

  /**
   * Public detail: the status gate and the view bump are ONE statement,
   * so drafts and missing ids 404 identically (no draft oracle). The
   * counter counts detail hits, not unique visitors — no dedup, no bot
   * filtering, honestly labeled.
   */
  async getProductDetail(
    id: string,
    channel: "retail" | "wholesale" = "wholesale",
  ): Promise<Record<string, unknown>> {
    const retail = channel === "retail";
    const bumped = await this.db.execute(sql`
      UPDATE "product" SET "view_count" = "view_count" + 1, "updated_at" = NOW()
      WHERE "id" = ${id} AND "status" = 'published' RETURNING "id"
    `);
    if (!(((bumped as any).rows ?? []) as unknown[]).length) {
      throw new DomainError(404, "PRODUCT_NOT_FOUND", "محصول یافت نشد");
    }
    let kolbeSellerId: string | null = null;
    if (retail) {
      const [kolbe] = await this.db.select({ id: seller.id }).from(seller).where(eq(seller.type, "KOLBE")).limit(1);
      kolbeSellerId = kolbe?.id ?? null;
    }

    // 5.10-D: re-check status on the read — a product unpublished
    // between the bump and this SELECT 404s instead of leaking.
    const [prod] = await this.db
      .select()
      .from(product)
      .where(and(eq(product.id, id), eq(product.status, "published")))
      .limit(1);
    if (!prod) throw new DomainError(404, "PRODUCT_NOT_FOUND", "محصول یافت نشد");
    const [brandRow] = prod.brandId
      ? await this.db.select().from(brand).where(eq(brand.id, prod.brandId)).limit(1)
      : [null];
    const breadcrumb: Array<{ id: string; name: string; slug: string }> = [];
    {
      let cursorId = prod.categoryId;
      const seen = new Set<string>();
      for (let depth = 0; depth < 20 && cursorId && !seen.has(cursorId); depth++) {
        seen.add(cursorId);
        const [cat] = await this.db
          .select({ id: category.id, name: category.name, slug: category.slug, parentId: category.parentId })
          .from(category)
          .where(eq(category.id, cursorId))
          .limit(1);
        if (!cat) break;
        breadcrumb.unshift({ id: cat.id, name: cat.name, slug: cat.slug });
        cursorId = cat.parentId;
      }
    }

    const variants = await this.db
      .select()
      .from(productVariant)
      .where(and(eq(productVariant.productId, id), eq(productVariant.status, "active")));
    const activeVariantIds = new Set(variants.map((row) => row.id));
    const allOffers = await this.db
      .select()
      .from(sellerOffer)
      .where(and(eq(sellerOffer.productId, id), eq(sellerOffer.status, "published")));
    const offers = allOffers.filter(
      (offer) =>
        offer.variantId &&
        activeVariantIds.has(offer.variantId) &&
        (retail ? offer.retailPrice != null : offer.wholesalePrice != null) &&
        (!retail || offer.sellerId === kolbeSellerId),
    );
    const priceOf = (offer: (typeof offers)[number]) =>
      BigInt(((retail ? offer.retailPrice : offer.wholesalePrice) as unknown as string | number).toString());
    const cheapest = [...offers].sort((a, b) => (priceOf(a) < priceOf(b) ? -1 : 1))[0];

    let availability = 0;
    if (offers.length) {
      const variantIds = [...new Set(offers.map((offer) => offer.variantId!))];
      const sellerIds = [...new Set(offers.map((offer) => offer.sellerId))];
      const stock = await this.db
        .select()
        .from(productVariantInventory)
        .where(
          and(
            inArray(productVariantInventory.variantId, variantIds),
            inArray(productVariantInventory.sellerId, sellerIds),
          ),
        );
      const pairs = new Set(offers.map((offer) => `${offer.variantId} ${offer.sellerId}`));
      for (const row of stock) {
        if (pairs.has(`${row.variantId} ${row.sellerId}`)) {
          availability += Math.max(0, row.onHand - row.reserved);
        }
      }
    }

    const summaryResult = await this.db.execute(sql`
      SELECT COUNT(*)::int AS "count", ROUND(AVG("rating"), 2) AS "average"
      FROM "product_rating" WHERE "product_id" = ${id} AND "status" IN ('visible', 'flagged')
    `);
    const summaryRow = ((((summaryResult as any).rows ?? []) as Array<{ count: number; average: string | null }>)[0]);
    const media = await this.db
      .select()
      .from(productMedia)
      .where(eq(productMedia.productId, id))
      .orderBy(productMedia.position, productMedia.id);
    const variantMedia =
      variants.length > 0
        ? await this.db
            .select()
            .from(productVariantMedia)
            .where(inArray(productVariantMedia.variantId, variants.map((row) => row.id)))
            .orderBy(productVariantMedia.position, productVariantMedia.id)
        : [];

    return {
      id: prod.id,
      name: prod.name,
      slug: prod.slug,
      description: prod.description,
      ownerType: prod.ownerType,
      status: prod.status,
      brand: brandRow ? { id: brandRow.id, name: brandRow.name, slug: brandRow.slug } : null,
      breadcrumb,
      variants: variants.map((row) => ({
        id: row.id,
        sku: row.sku,
        attributes: row.attributes,
        media: variantMedia.filter((medium) => medium.variantId === row.id),
      })),
      offers: offers.map((offer) => ({
        id: offer.id,
        sellerId: offer.sellerId,
        variantId: offer.variantId,
        price: (retail ? offer.retailPrice : offer.wholesalePrice)!.toString(),
        currency: offer.currency,
      })),
      media: media.map((row) => ({ id: row.id, url: row.url, type: row.type, position: row.position })),
      priceFrom: cheapest ? priceOf(cheapest).toString() : null,
      priceCurrency: cheapest?.currency ?? null,
      availability,
      rating: {
        average: summaryRow?.average === null || summaryRow?.average === undefined ? null : Number(summaryRow.average),
        count: summaryRow?.count ?? 0,
      },
      viewCount: prod.viewCount,
    };
  }

  /** Active-only category tree; dangling parents dropped, cycles cut. */
  async listCategories(): Promise<Array<Record<string, unknown>>> {
    const rows = await this.db.select().from(category).where(eq(category.status, "active"));
    type Node = { id: string; name: string; slug: string; children: Node[] };
    const byId = new Map<string, Node>();
    for (const row of rows) byId.set(row.id, { id: row.id, name: row.name, slug: row.slug, children: [] });
    const roots: Node[] = [];
    for (const row of rows) {
      const node = byId.get(row.id)!;
      if (row.parentId && byId.has(row.parentId)) {
        byId.get(row.parentId)!.children.push(node);
      } else if (!row.parentId) {
        roots.push(node);
      }
      // Dangling parent (missing/inactive): dropped, never surfaced.
    }
    const clean = (nodes: Node[], seen: Set<string>): Node[] =>
      nodes
        .filter((node) => !seen.has(node.id))
        .map((node) => ({ ...node, children: clean(node.children, new Set([...seen, node.id])) }))
        .sort((a, b) => (a.name < b.name ? -1 : 1));
    return clean(roots, new Set());
  }

  /** Public brands: approved AND active, name order. */
  async listBrands(): Promise<Array<Record<string, unknown>>> {
    return this.db
      .select({ id: brand.id, name: brand.name, slug: brand.slug, logoUrl: brand.logoUrl })
      .from(brand)
      .where(and(eq(brand.verificationStatus, "approved"), eq(brand.status, "active")))
      .orderBy(brand.name, brand.id);
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
