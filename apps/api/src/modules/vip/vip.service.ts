import { Inject, Injectable } from "@nestjs/common";
import { eq, and, sql } from "drizzle-orm";
import {
  vipPlan,
  vipSubscription,
  wholesaleRequest,
  wholesaleAccount,
  product,
  sellerOffer,
  wholesalePackage,
  wholesalePackageItem,
  seller,
  supplier,
  productVariant,
  wholesalePricingTier,
  wholesaleOrderRequest,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { ForbiddenError, NotFoundError } from "@kolbe/shared";
import { CatalogDomainError } from "../catalog/catalog.logic";
import {
  isVipSubscriptionActive,
  assertVipAccess,
  validateWholesaleRequestQuantity,
  transitionWholesaleRequest,
} from "./vip.logic";
import { resolvePrice, hashAcceptedTerms, type AcceptedTermsSnapshot } from "../pricing/pricing.logic";

type Tx = Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];
export type DbOrTx = KolbeDatabase | Tx;

@Injectable()
export class VipService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  private getExecutor(executor?: DbOrTx) {
    return (executor as any) || this.db;
  }

  async createPlan(input: {
    name: string;
    slug: string;
    price: bigint;
    durationDays: number;
    features?: Record<string, any>;
    limits?: Record<string, any>;
  }) {
    const id = `vplan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const [plan] = await this.db
      .insert(vipPlan)
      .values({
        id,
        name: input.name,
        slug: input.slug,
        price: input.price,
        durationDays: input.durationDays,
        features: input.features || {},
        limits: input.limits || {},
        status: "active",
      })
      .returning();
    return plan;
  }

  async listPlans() {
    return this.db.select().from(vipPlan).where(eq(vipPlan.status, "active"));
  }

  async subscribe(userId: string, planId: string) {
    const [plan] = await this.db.select().from(vipPlan).where(eq(vipPlan.id, planId)).limit(1);
    if (!plan) throw new NotFoundError("پلن یافت نشد");

    const id = `vsub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const [sub] = await this.db
      .insert(vipSubscription)
      .values({ id, userId, planId, status: "pending", startedAt: null, expiresAt: null })
      .returning();
    return sub;
  }

  async activateSubscription(subscriptionId: string, _adminId: string) {
    const [existing] = await this.db
      .select({ subscription: vipSubscription, plan: vipPlan })
      .from(vipSubscription)
      .innerJoin(vipPlan, eq(vipSubscription.planId, vipPlan.id))
      .where(eq(vipSubscription.id, subscriptionId))
      .limit(1);
    if (!existing) throw new NotFoundError("اشتراک یافت نشد");
    if (existing.subscription.status !== "pending")
      throw new CatalogDomainError("SUBSCRIPTION_NOT_PENDING", "اشتراک در انتظار فعال‌سازی نیست");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + existing.plan.durationDays * 86400000);
    const [activated] = await this.db
      .update(vipSubscription)
      .set({ status: "active", startedAt: now, expiresAt, updatedAt: now })
      .where(eq(vipSubscription.id, subscriptionId))
      .returning();
    return activated;
  }

  async getActiveSubscription(userId: string, executor?: DbOrTx) {
    const db = this.getExecutor(executor);
    const subs = await db.select().from(vipSubscription).where(eq(vipSubscription.userId, userId)).limit(10);
    return subs.find((s: any) => isVipSubscriptionActive(s as any)) || null;
  }

  async createWholesaleRequest(
    input: {
      productId: string;
      offerId: string;
      variantId?: string | null;
      packageId?: string | null;
      quantity: number;
      userId: string;
    },
    executor?: DbOrTx,
  ) {
    const db = this.getExecutor(executor);

    const sub = await this.getActiveSubscription(input.userId, db);
    assertVipAccess(sub as any);

    const [account] = await db
      .select()
      .from(wholesaleAccount)
      .where(and(eq(wholesaleAccount.userId, input.userId), eq(wholesaleAccount.status, "approved")))
      .limit(1);
    if (!account) throw new ForbiddenError("حساب عمدهٔ فعال برای کاربر یافت نشد");
    if (account.expiresAt && account.expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenError("حساب عمده منقضی شده است");
    }

    const [prod] = await db.select().from(product).where(eq(product.id, input.productId)).limit(1);
    if (!prod) throw new NotFoundError("محصول یافت نشد");
    if (prod.status !== "published") throw new NotFoundError("محصول منتشرشده یافت نشد");

    const [offer] = await db.select().from(sellerOffer).where(eq(sellerOffer.id, input.offerId)).limit(1);
    if (!offer) throw new NotFoundError("پیشنهاد یافت نشد");
    if (offer.productId !== input.productId) {
      throw new CatalogDomainError("OFFER_PRODUCT_MISMATCH", "پیشنهاد متعلق به محصول نیست");
    }
    if (offer.status !== "published") {
      throw new CatalogDomainError("OFFER_NOT_PUBLISHED", "پیشنهاد منتشر نشده است");
    }
    if (offer.wholesalePrice < 0n) {
      throw new CatalogDomainError("OFFER_NOT_WHOLESALE_ELIGIBLE", "پیشنهاد برای عمده‌فروشی فعال نیست");
    }

    const [sellerRow] = await db.select().from(seller).where(eq(seller.id, offer.sellerId)).limit(1);
    if (!sellerRow) throw new NotFoundError("فروشندهٔ پیشنهاد یافت نشد");
    if (sellerRow.supplierId) {
      const [supplierRow] = await db.select().from(supplier).where(eq(supplier.id, sellerRow.supplierId)).limit(1);
      if (!supplierRow) throw new NotFoundError("تأمین‌کننده یافت نشد");
      if (supplierRow.status !== "active" && supplierRow.status !== "approved") {
        throw new CatalogDomainError("SUPPLIER_NOT_ACTIVE", "تأمین‌کننده فعال نیست");
      }
    }

    // Phase 4.3.1 — strict selector validation for NEW requests
    const hasVariant = !!input.variantId;
    const hasPackage = !!input.packageId;
    if (hasVariant && hasPackage) {
      throw new CatalogDomainError("REQUEST_SELECTOR_AMBIGUOUS", "هم variant و هم package نمی‌تواند همزمان باشد");
    }
    if (!hasVariant && !hasPackage) {
      throw new CatalogDomainError("REQUEST_SELECTOR_REQUIRED", "selector required: either variant_id or package_id must be provided");
    }
    // For PIECE sale, variant required; for PACKAGE-like, package required
    if (offer.moqUnit === "PIECE") {
      if (!hasVariant) {
        throw new CatalogDomainError("REQUEST_SELECTOR_REQUIRED", "PIECE sale requires variant_id, package_id must be NULL");
      }
      if (hasPackage) {
        throw new CatalogDomainError("REQUEST_SELECTOR_AMBIGUOUS", "PIECE sale must not have package_id");
      }
    }
    if (["PACKAGE", "SERIES", "BOX", "CARTON", "SET"].includes(offer.moqUnit)) {
      if (!hasPackage) {
        throw new CatalogDomainError("REQUEST_SELECTOR_REQUIRED", `Package-like sale ${offer.moqUnit} requires package_id, variant_id must be NULL`);
      }
      if (hasVariant) {
        throw new CatalogDomainError("REQUEST_SELECTOR_AMBIGUOUS", `Package-like sale ${offer.moqUnit} must not have variant_id`);
      }
    }

    if (hasVariant) {
      const [variant] = await db.select().from(productVariant).where(eq(productVariant.id, input.variantId!)).limit(1);
      if (!variant) throw new NotFoundError("واریانت یافت نشد");
      if (variant.productId !== input.productId) {
        throw new CatalogDomainError("VARIANT_PRODUCT_MISMATCH", "واریانت متعلق به محصول نیست");
      }
    }

    if (input.packageId) {
      const [pkg] = await db.select().from(wholesalePackage).where(eq(wholesalePackage.id, input.packageId)).limit(1);
      if (!pkg) throw new NotFoundError("بسته یافت نشد");
      if (pkg.offerId !== offer.id) {
        throw new CatalogDomainError("PACKAGE_OFFER_MISMATCH", "بسته متعلق به پیشنهاد نیست");
      }
      if (pkg.totalPieces <= 0) {
        throw new CatalogDomainError("PACKAGE_INVALID_PIECES", "بسته نامعتبر است");
      }
      const items = await db.select().from(wholesalePackageItem).where(eq(wholesalePackageItem.packageId, pkg.id)).limit(20);
      if (items.length === 0) {
        throw new CatalogDomainError("PACKAGE_EMPTY", "بسته خالی است");
      }
    }

    validateWholesaleRequestQuantity(input.quantity, offer.moq);

    const id = `wreq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const [req] = await db
      .insert(wholesaleRequest)
      .values({
        id,
        productId: input.productId,
        offerId: input.offerId,
        vipAccountId: account.id,
        variantId: input.variantId || null,
        packageId: input.packageId || null,
        quantity: input.quantity,
        status: "pending",
        version: 0,
      })
      .returning();

    return req;
  }

  async transitionRequest(
    requestId: string,
    nextStatus: "pending" | "supplier_review" | "accepted" | "rejected" | "ordered",
    actorRole: "vip" | "supplier" | "admin",
    actorId?: string,
    rejectionReason?: string,
    executor?: DbOrTx,
    expectedVersion?: number,
  ) {
    const db = this.getExecutor(executor);
    // Lock request FOR UPDATE if executor is a transaction
    let existing: any;
    if (executor) {
      const rows = await (db as any).execute(sql`SELECT * FROM wholesale_request WHERE id = ${requestId} FOR UPDATE`);
      existing = rows.rows?.[0] || (await db.select().from(wholesaleRequest).where(eq(wholesaleRequest.id, requestId)).limit(1).then((r: any) => r[0]));
    } else {
      const [row] = await db.select().from(wholesaleRequest).where(eq(wholesaleRequest.id, requestId)).limit(1);
      existing = row;
    }

    if (!existing) throw new NotFoundError("درخواست یافت نشد");

    // Version check for optimistic concurrency
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new CatalogDomainError("REQUEST_VERSION_CONFLICT", `نسخهٔ درخواست منقضی شده: expected ${expectedVersion}, got ${existing.version}`);
    }

    if (actorRole === "supplier" && actorId) {
      const [offer] = await db.select().from(sellerOffer).where(eq(sellerOffer.id, existing.offerId)).limit(1);
      if (offer) {
        const [sellerRow] = await db.select().from(seller).where(eq(seller.id, offer.sellerId)).limit(1);
        if (sellerRow?.supplierId) {
          const { supplierMember } = await import("@kolbe/database");
          const [member] = await db
            .select()
            .from(supplierMember)
            .where(and(eq(supplierMember.supplierId, sellerRow.supplierId), eq(supplierMember.userId, actorId)))
            .limit(1);
          if (!member) {
            throw new CatalogDomainError("SUPPLIER_OWNERSHIP_VIOLATION", "شما مالک این پیشنهاد نیستید");
          }
        }
      }
    }

    if (actorRole === "vip" && actorId) {
      const [account] = await db.select().from(wholesaleAccount).where(eq(wholesaleAccount.id, existing.vipAccountId)).limit(1);
      if (!account || account.userId !== actorId) {
        throw new CatalogDomainError("VIP_OWNERSHIP_VIOLATION", "شما مالک این درخواست نیستید");
      }
    }

    transitionWholesaleRequest(existing.status as any, nextStatus as any, actorRole, rejectionReason);

    const [updated] = await db
      .update(wholesaleRequest)
      .set({
        status: nextStatus,
        rejectionReason: rejectionReason || null,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(wholesaleRequest.id, requestId))
      .returning();
    return updated;
  }

  /**
   * Phase 4.2.2 — Acceptance with frozen commercial terms snapshot
   * When supplier_review → accepted, server must lock, verify, load authoritative offer/seller/package/variant/composition/pricing, validate MOQ, calculate piece quantity and line total, construct snapshot, hash, persist
   */
  async acceptRequest(
    requestId: string,
    actorId: string,
    actorRole: "supplier" | "admin",
    executor?: DbOrTx,
    expectedVersion?: number,
  ) {
    const db = this.getExecutor(executor);

    // Lock request FOR UPDATE
    let existing: any;
    if (executor) {
      // Use raw SQL FOR UPDATE
      const result = await (db as any).execute(sql`SELECT * FROM wholesale_request WHERE id = ${requestId} FOR UPDATE`);
      existing = result.rows?.[0];
      if (!existing) {
        const [row] = await db.select().from(wholesaleRequest).where(eq(wholesaleRequest.id, requestId)).limit(1);
        existing = row;
      }
    } else {
      const [row] = await db.select().from(wholesaleRequest).where(eq(wholesaleRequest.id, requestId)).limit(1);
      existing = row;
    }

    if (!existing) throw new NotFoundError("درخواست یافت نشد");

    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new CatalogDomainError("REQUEST_VERSION_CONFLICT", `نسخهٔ درخواست منقضی شده`);
    }

    if (existing.status !== "supplier_review" && existing.status !== "pending") {
      throw new CatalogDomainError("REQUEST_NOT_ACCEPTABLE", `درخواست در وضعیت ${existing.status} قابل پذیرش نیست`);
    }

    // Load authoritative Offer, Seller, Package/Variant, composition, pricing
    const [offer] = await db.select().from(sellerOffer).where(eq(sellerOffer.id, existing.offerId)).limit(1);
    if (!offer) throw new NotFoundError("پیشنهاد یافت نشد");

    const [sellerRow] = await db.select().from(seller).where(eq(seller.id, offer.sellerId)).limit(1);
    if (!sellerRow) throw new NotFoundError("فروشنده یافت نشد");

    // Verify actor ownership for supplier
    if (actorRole === "supplier" && sellerRow.supplierId) {
      const { supplierMember } = await import("@kolbe/database");
      const [member] = await db
        .select()
        .from(supplierMember)
        .where(and(eq(supplierMember.supplierId, sellerRow.supplierId), eq(supplierMember.userId, actorId)))
        .limit(1);
      if (!member) throw new CatalogDomainError("SUPPLIER_OWNERSHIP_VIOLATION", "شما مالک این پیشنهاد نیستید");
    }

    let variant: any = null;
    let pkg: any = null;
    let composition: any[] = [];

    const [prod] = await db.select().from(product).where(eq(product.id, existing.productId)).limit(1);
    if (!prod) throw new NotFoundError("محصول یافت نشد");

    if (existing.variantId) {
      const [v] = await db.select().from(productVariant).where(eq(productVariant.id, existing.variantId)).limit(1);
      if (!v) throw new NotFoundError("واریانت یافت نشد");
      variant = v;
    }

    if (existing.packageId) {
      const [p] = await db.select().from(wholesalePackage).where(eq(wholesalePackage.id, existing.packageId)).limit(1);
      if (!p) throw new NotFoundError("بسته یافت نشد");
      pkg = p;
      const items = await db.select().from(wholesalePackageItem).where(eq(wholesalePackageItem.packageId, p.id));
      composition = items.map((it: any) => ({ variantId: it.variantId, quantity: it.quantity }));
      if (composition.length === 0) throw new CatalogDomainError("PACKAGE_EMPTY", "بسته خالی است");
    }

    // Load pricing tiers
    const tiers = await db.select().from(wholesalePricingTier).where(eq(wholesalePricingTier.offerId, offer.id));

    // Resolve authoritative pricing via PricingService logic
    const pricingInput = {
      offer: {
        id: offer.id,
        productId: offer.productId,
        sellerId: offer.sellerId,
        wholesalePrice: offer.wholesalePrice,
        currency: offer.currency,
        moq: offer.moq,
        moqUnit: offer.moqUnit as any,
        pricingUnit: (offer as any).pricingUnit || (offer.moqUnit as any) || "PIECE",
        packageType: (offer as any).packageType,
      },
      variantId: existing.variantId,
      packageId: existing.packageId,
      package: pkg
        ? {
            id: pkg.id,
            offerId: pkg.offerId,
            packageType: pkg.packageType,
            name: pkg.name,
            totalPieces: pkg.totalPieces,
            composition,
          }
        : null,
      quantity: existing.quantity,
      pricingTiers: tiers.map((t: any) => ({
        id: t.id,
        offerId: t.offerId,
        minQuantity: t.minQuantity,
        maxQuantity: t.maxQuantity,
        unitPrice: t.unitPrice,
        currency: t.currency,
        moqUnit: t.moqUnit as any,
        pricingUnit: (t as any).pricingUnit || (t.moqUnit as any) || "PACKAGE",
      })),
    };

    const resolved = resolvePrice(pricingInput as any);

    // Validate MOQ (already done at creation, but re-validate with authoritative offer)
    validateWholesaleRequestQuantity(existing.quantity, offer.moq);

    // Construct accepted terms snapshot — server-side, never from client — Phase 4.3.1 complete freeze
    const snapshot: AcceptedTermsSnapshot = {
      requestVersion: existing.version,
      productId: existing.productId,
      offerId: existing.offerId,
      sellerId: sellerRow.id,
      supplierId: sellerRow.supplierId || null,
      variantId: existing.variantId || null,
      packageId: existing.packageId || null,
      quantity: existing.quantity,
      saleUnit: offer.moqUnit as any,
      pricingUnit: resolved.pricingUnit as any,
      pricingTierId: resolved.pricingTierId,
      unitPrice: resolved.unitPrice.toString(),
      currency: resolved.currency,
      product: {
        id: prod.id,
        name: prod.name,
      },
      variant: variant
        ? {
            id: variant.id,
            sku: variant.sku,
            attributes: variant.attributes || {},
          }
        : null,
      seller: {
        id: sellerRow.id,
        type: sellerRow.type,
        displayName: sellerRow.displayName,
        supplierId: sellerRow.supplierId || null,
      },
      package: pkg
        ? {
            id: pkg.id,
            type: pkg.packageType,
            name: pkg.name,
            piecesPerPackage: resolved.pieceQuantity / existing.quantity,
            composition,
          }
        : null,
      pieceQuantity: resolved.pieceQuantity,
      lineTotal: resolved.lineTotal.toString(),
    };

    const hash = hashAcceptedTerms(snapshot);

    const now = new Date();
    const [updated] = await db
      .update(wholesaleRequest)
      .set({
        status: "accepted",
        version: existing.version + 1,
        acceptedAt: now,
        acceptedBy: actorId,
        acceptedTermsSnapshot: snapshot as any,
        acceptedTermsHash: hash,
        // acceptanceExpiresAt remains nullable, Phase 4.4 will configure
        updatedAt: now,
      })
      .where(eq(wholesaleRequest.id, requestId))
      .returning();

    return updated;
  }

  /**
   * Phase 4.2.2 — Prepare atomic request conversion contract for Phase 4.3
   * Executor aware, SELECT FOR UPDATE, verifies buyer/account ownership, status accepted, snapshot/hash existence, version match, not expired, not already ordered
   */
  async getAcceptedRequestForConversion(
    requestId: string,
    buyerUserId: string,
    expectedVersion: number,
    executor: DbOrTx,
  ) {
    const db = this.getExecutor(executor);

    // Lock FOR UPDATE
    const result = await (db as any).execute(sql`SELECT * FROM wholesale_request WHERE id = ${requestId} FOR UPDATE`);
    const existingRaw = result.rows?.[0] || (await db.select().from(wholesaleRequest).where(eq(wholesaleRequest.id, requestId)).limit(1).then((r: any) => r[0]));

    if (!existingRaw) throw new NotFoundError("درخواست یافت نشد");

    const existing = {
      ...existingRaw,
      vipAccountId: (existingRaw as any).vipAccountId || (existingRaw as any).vip_account_id,
      acceptedTermsSnapshot: (existingRaw as any).acceptedTermsSnapshot || (existingRaw as any).accepted_terms_snapshot,
      acceptedTermsHash: (existingRaw as any).acceptedTermsHash || (existingRaw as any).accepted_terms_hash,
      acceptanceExpiresAt: (existingRaw as any).acceptanceExpiresAt || (existingRaw as any).acceptance_expires_at,
      version: (existingRaw as any).version,
      status: (existingRaw as any).status,
    };

    // Verify buyer/account ownership
    const [account] = await db.select().from(wholesaleAccount).where(eq(wholesaleAccount.id, existing.vipAccountId)).limit(1);
    if (!account || account.userId !== buyerUserId) {
      throw new CatalogDomainError("VIP_OWNERSHIP_VIOLATION", "شما مالک این درخواست نیستید");
    }

    if (existing.status !== "accepted") {
      throw new CatalogDomainError("REQUEST_NOT_ACCEPTED", `درخواست در وضعیت ${existing.status} قابل تبدیل نیست`);
    }

    if (!existing.acceptedTermsSnapshot) {
      throw new CatalogDomainError("REQUEST_MISSING_SNAPSHOT", "اسنپ‌شات تجاری پذیرفته‌شده وجود ندارد");
    }

    if (!existing.acceptedTermsHash) {
      throw new CatalogDomainError("REQUEST_MISSING_HASH", "هش شرایط پذیرفته‌شده وجود ندارد");
    }

    if (existing.version !== expectedVersion) {
      throw new CatalogDomainError("REQUEST_VERSION_CONFLICT", `نسخهٔ درخواست منقضی شده`);
    }

    const dbNow = await this.getDbNow(db);
    if (existing.acceptanceExpiresAt && new Date(existing.acceptanceExpiresAt).getTime() <= dbNow.getTime()) {
      throw new CatalogDomainError("REQUEST_ACCEPTANCE_EXPIRED", "اعتبار پذیرش منقضی شده است");
    }

    // Check if already linked to an order (via wholesale_order_request)
    const [linked] = await db.select().from(wholesaleOrderRequest).where(eq(wholesaleOrderRequest.requestId, requestId)).limit(1);
    if (linked) {
      throw new CatalogDomainError("REQUEST_ALREADY_ORDERED", "درخواست قبلاً به سفارش تبدیل شده است");
    }

    // Verify hash matches snapshot
    const expectedHash = hashAcceptedTerms(existing.acceptedTermsSnapshot as any);
    if (expectedHash !== existing.acceptedTermsHash) {
      throw new CatalogDomainError("REQUEST_HASH_MISMATCH", "هش اسنپ‌شات نامعتبر است");
    }

    return { request: existing, account };
  }

  // ── Phase 4.3.1 — Order-related public queries ───────────────────────
  async getWholesaleAccountForOrder(accountId: string, executor?: DbOrTx) {
    const db = this.getExecutor(executor);
    const [account] = await db.select().from(wholesaleAccount).where(eq(wholesaleAccount.id, accountId)).limit(1);
    if (!account) throw new NotFoundError("حساب عمده یافت نشد");
    return account;
  }

  async lockWholesaleAccountForUpdate(accountId: string, executor: DbOrTx) {
    const db = this.getExecutor(executor);
    const result = await (db as any).execute(sql`SELECT * FROM wholesale_account WHERE id = ${accountId} FOR UPDATE`);
    const row = result.rows?.[0];
    if (!row) throw new NotFoundError("حساب عمده یافت نشد");
    return row;
  }

  async getDbNow(executor?: DbOrTx) {
    const db = this.getExecutor(executor);
    const result = await (db as any).execute(sql`SELECT NOW() as now`);
    const nowVal = result.rows?.[0]?.now || (result as any)[0]?.now;
    return new Date(nowVal);
  }

  async markRequestOrdered(requestId: string, expectedVersion: number, executor: DbOrTx, orderId?: string) {
    const db = this.getExecutor(executor);

    // Lock request FOR UPDATE to ensure state remains accepted
    const lockResult = await (db as any).execute(sql`SELECT * FROM wholesale_request WHERE id = ${requestId} FOR UPDATE`);
    const existingRaw = lockResult.rows?.[0] || (await db.select().from(wholesaleRequest).where(eq(wholesaleRequest.id, requestId)).limit(1).then((r: any) => r[0]));
    if (!existingRaw) throw new NotFoundError("درخواست یافت نشد");
    // Normalize snake_case vs camelCase (raw SQL vs drizzle)
    const existing = {
      ...existingRaw,
      acceptedTermsSnapshot: (existingRaw as any).acceptedTermsSnapshot || (existingRaw as any).accepted_terms_snapshot,
      acceptedTermsHash: (existingRaw as any).acceptedTermsHash || (existingRaw as any).accepted_terms_hash,
      acceptanceExpiresAt: (existingRaw as any).acceptanceExpiresAt || (existingRaw as any).acceptance_expires_at,
      version: (existingRaw as any).version,
      status: (existingRaw as any).status,
    };

    if (existing.version !== expectedVersion) {
      throw new CatalogDomainError("REQUEST_VERSION_CONFLICT", "نسخهٔ درخواست منقضی شده");
    }

    if (existing.status !== "accepted") {
      throw new CatalogDomainError("REQUEST_NOT_ACCEPTED", "فقط درخواست پذیرفته‌شده می‌تواند سفارشی شود");
    }

    if (!existing.acceptedTermsSnapshot || !existing.acceptedTermsHash) {
      throw new CatalogDomainError("ACCEPTED_TERMS_MISSING", "اسنپ‌شات پذیرفته‌شده وجود ندارد");
    }

    // Verify hash remains valid
    const recomputed = hashAcceptedTerms(existing.acceptedTermsSnapshot as any);
    if (recomputed !== existing.acceptedTermsHash) {
      throw new CatalogDomainError("ACCEPTED_TERMS_HASH_MISMATCH", "هش اسنپ‌شات نامعتبر است");
    }

    // If orderId supplied, verify link exists and matches version/hash and DB-time expiry
    if (orderId) {
      const [link] = await db.select().from(wholesaleOrderRequest).where(eq(wholesaleOrderRequest.requestId, requestId)).limit(1);
      if (!link) {
        throw new CatalogDomainError("REQUEST_LINK_MISSING", `Request ${requestId} link missing for order ${orderId}`);
      }
      if (link.orderId !== orderId) {
        throw new CatalogDomainError("REQUEST_LINK_MISMATCH", `Request ${requestId} linked to different order ${link.orderId} != ${orderId}`);
      }
      if (link.requestVersion !== existing.version) {
        throw new CatalogDomainError("REQUEST_VERSION_CONFLICT", `Link version ${link.requestVersion} != locked version ${existing.version}`);
      }
      if (link.acceptedTermsHash !== existing.acceptedTermsHash) {
        throw new CatalogDomainError("ACCEPTED_TERMS_HASH_MISMATCH", `Link hash mismatch`);
      }
    }

    // DB-time expiry check
    const dbNow = await this.getDbNow(db);
    if (existing.acceptanceExpiresAt && new Date(existing.acceptanceExpiresAt).getTime() <= dbNow.getTime()) {
      throw new CatalogDomainError("REQUEST_ACCEPTANCE_EXPIRED", "اعتبار پذیرش منقضی شده است");
    }

    const [updated] = await db
      .update(wholesaleRequest)
      .set({
        status: "ordered",
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(wholesaleRequest.id, requestId))
      .returning();

    return updated;
  }
}
