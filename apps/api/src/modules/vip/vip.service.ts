import { Inject, Injectable, Optional } from "@nestjs/common";
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
  wholesaleRequestRevision,
  commandIdempotency,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { DomainError, ForbiddenError, NotFoundError } from "@kolbe/shared";
import { CatalogDomainError } from "../catalog/catalog.logic";
import {
  isVipSubscriptionActive,
  assertVipAccess,
  validateWholesaleRequestQuantity,
  transitionWholesaleRequest,
  type WholesaleRequestStatus,
} from "./vip.logic";
import { resolvePrice, hashAcceptedTerms, type AcceptedTermsSnapshot, canonicalStringify } from "../pricing/pricing.logic";
import { createHash, randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";

type Tx = Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];
export type DbOrTx = KolbeDatabase | Tx;

function revisionId(): string {
  return `wrev_${randomUUID().replaceAll("-", "")}`;
}
function idemId(): string {
  return `cid_${randomUUID().replaceAll("-", "")}`;
}
function hashReq(input: unknown): string {
  const canonical = canonicalStringify(input as any);
  return createHash("sha256").update(canonical).digest("hex");
}

function sanitizeForJsonb(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(sanitizeForJsonb);
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeForJsonb(v);
    }
    return out;
  }
  return value;
}

@Injectable()
export class VipService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuthService) private readonly authService: AuthService,
    @Optional() @Inject(AuditService) private readonly auditService?: AuditService,
  ) {}

  async applyLegacy(userId: string, input: any) {
    const storeName = String(input.storeName ?? "").trim().replace(/[<>]/g, "").slice(0, 180);
    const phone = String(input.phone ?? "").replace(/[\s-]/g, "");
    const city = String(input.city ?? "").trim().replace(/[<>]/g, "").slice(0, 120);
    const planName = String(input.planName ?? "").trim().slice(0, 120);
    const paymentReference = String(input.paymentReference ?? "").trim().slice(0, 180);
    if (!storeName || !city || !planName || !paymentReference || !/^(?:\+98|0098|98|0)?9\d{9}$/.test(phone)) throw new DomainError(422, "INVALID_VIP_APPLICATION", "اطلاعات درخواست عضویت نامعتبر است");
    const result = await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(wholesaleAccount).where(eq(wholesaleAccount.userId, userId)).limit(1);
      if (existing && ["pending", "approved"].includes(existing.status)) return { account: existing, replayed: true };
      if (existing) {
        const [updated] = await tx.update(wholesaleAccount).set({ memberName: String(input.memberName ?? storeName).trim().slice(0, 160), storeName, phone, city, planName, status: "pending", activatedAt: null, expiresAt: null, updatedAt: new Date() }).where(eq(wholesaleAccount.id, existing.id)).returning();
        return { account: updated, replayed: false };
      }
      const [created] = await tx.insert(wholesaleAccount).values({ id: `wacc_${randomUUID().replaceAll("-", "")}`, userId, memberName: String(input.memberName ?? storeName).trim().slice(0, 160), storeName, phone, city, planName, status: "pending" }).returning();
      return { account: created, replayed: false };
    });
    await this.auditService?.record({ actorId: userId, actorRole: "customer", action: "vip.application.created", entityType: "wholesale_account", entityId: result.account.id, after: { status: result.account.status, paymentReference } });
    return {
      status: result.account.status,
      account: {
        ...result.account,
        user_id: result.account.userId,
        member_name: result.account.memberName,
        store_name: result.account.storeName,
        plan_name: result.account.planName,
        activated_at: result.account.activatedAt ?? null,
        expires_at: result.account.expiresAt ?? null,
        created_at: result.account.createdAt,
        updated_at: result.account.updatedAt,
      },
      paymentReference,
      message: "درخواست عضویت ثبت شد و در انتظار بررسی کارشناسان کلبه است.",
    };
  }

  async decideLegacyAccount(accountId: string, input: any, actorId: string) {
    const next = String(input.status ?? "");
    if (!["approved", "rejected", "suspended", "expired"].includes(next)) throw new DomainError(422, "INVALID_VIP_STATUS", "وضعیت عضویت نامعتبر است");
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`SELECT * FROM wholesale_account WHERE id=${accountId} FOR UPDATE`);
      const current = (locked as any).rows?.[0];
      if (!current) throw new DomainError(404, "VIP_ACCOUNT_NOT_FOUND", "عضویت یافت نشد");
      const allowed: Record<string, string[]> = { pending: ["approved", "rejected"], approved: ["rejected", "suspended", "expired"], suspended: ["approved", "rejected"], rejected: [], expired: ["approved"] };
      if (current.status !== next && !(allowed[current.status] ?? []).includes(next)) throw new DomainError(409, "INVALID_VIP_STATUS_TRANSITION", "گذار وضعیت عضویت مجاز نیست");
      if (current.status === next) return { status: next, replayed: true };
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiresAt && !Number.isFinite(expiresAt.getTime())) throw new DomainError(422, "INVALID_VIP_EXPIRY", "تاریخ انقضا نامعتبر است");
      await tx.update(wholesaleAccount).set({ status: next, activatedAt: next === "approved" ? new Date() : null, expiresAt: next === "approved" ? expiresAt : null, updatedAt: new Date() }).where(eq(wholesaleAccount.id, accountId));
      await this.authService.setVipRole(current.user_id, next === "approved", tx);
      await this.auditService?.record({ actorId, actorRole: "admin", action: "vip_account.status_changed", entityType: "wholesale_account", entityId: accountId, before: { status: current.status }, after: { status: next, expiresAt: expiresAt?.toISOString() ?? current.expires_at }, metadata: { note: input.note ?? null } }, tx);
      return { status: next };
    });
  }

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

    const hasVariant = !!input.variantId;
    const hasPackage = !!input.packageId;
    if (hasVariant && hasPackage) {
      throw new CatalogDomainError("REQUEST_SELECTOR_AMBIGUOUS", "هم variant و هم package نمی‌تواند همزمان باشد");
    }
    if (!hasVariant && !hasPackage) {
      throw new CatalogDomainError("REQUEST_SELECTOR_REQUIRED", "selector required: either variant_id or package_id must be provided");
    }
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
    nextStatus: WholesaleRequestStatus,
    actorRole: "vip" | "supplier" | "admin" | "system",
    actorId?: string,
    rejectionReason?: string,
    executor?: DbOrTx,
    expectedVersion?: number,
  ) {
    const db = this.getExecutor(executor);
    let existing: any;
    if (executor) {
      const rows = await (db as any).execute(sql`SELECT * FROM wholesale_request WHERE id = ${requestId} FOR UPDATE`);
      existing = rows.rows?.[0] || (await db.select().from(wholesaleRequest).where(eq(wholesaleRequest.id, requestId)).limit(1).then((r: any) => r[0]));
    } else {
      const [row] = await db.select().from(wholesaleRequest).where(eq(wholesaleRequest.id, requestId)).limit(1);
      existing = row;
    }

    if (!existing) throw new NotFoundError("درخواست یافت نشد");

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

    transitionWholesaleRequest(existing.status as WholesaleRequestStatus, nextStatus as WholesaleRequestStatus, actorRole, rejectionReason);

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

  async acceptRequest(
    requestId: string,
    actorId: string,
    actorRole: "supplier" | "admin",
    executor?: DbOrTx,
    expectedVersion?: number,
  ) {
    const db = this.getExecutor(executor);

    let existing: any;
    if (executor) {
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

    const [offer] = await db.select().from(sellerOffer).where(eq(sellerOffer.id, existing.offerId)).limit(1);
    if (!offer) throw new NotFoundError("پیشنهاد یافت نشد");

    const [sellerRow] = await db.select().from(seller).where(eq(seller.id, offer.sellerId)).limit(1);
    if (!sellerRow) throw new NotFoundError("فروشنده یافت نشد");

    if (actorRole === "supplier" && sellerRow.supplierId) {
      const { supplierMember } = await import("@kolbe/database");
      const [member] = await db
        .select()
        .from(supplierMember)
        .where(and(eq(supplierMember.supplierId, sellerRow.supplierId), eq(supplierMember.userId, actorId)))
        .limit(1);
      if (!member) throw new CatalogDomainError("SUPPLIER_OWNERSHIP_VIOLATION", "شما مالک این پیشنهاد نیستید");
      if (!["owner", "sales"].includes(member.role)) {
        throw new CatalogDomainError("ROLE_NOT_ALLOWED", `Role ${member.role} cannot accept`);
      }
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

    const tiers = await db.select().from(wholesalePricingTier).where(eq(wholesalePricingTier.offerId, offer.id));

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

    validateWholesaleRequestQuantity(existing.quantity, offer.moq);

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
        updatedAt: now,
      })
      .where(eq(wholesaleRequest.id, requestId))
      .returning();

    return updated;
  }

  async getAcceptedRequestForConversion(
    requestId: string,
    buyerUserId: string,
    expectedVersion: number,
    executor: DbOrTx,
  ) {
    const db = this.getExecutor(executor);

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

    const [linked] = await db.select().from(wholesaleOrderRequest).where(eq(wholesaleOrderRequest.requestId, requestId)).limit(1);
    if (linked) {
      throw new CatalogDomainError("REQUEST_ALREADY_ORDERED", "درخواست قبلاً به سفارش تبدیل شده است");
    }

    const expectedHash = hashAcceptedTerms(existing.acceptedTermsSnapshot as any);
    if (expectedHash !== existing.acceptedTermsHash) {
      throw new CatalogDomainError("REQUEST_HASH_MISMATCH", "هش اسنپ‌شات نامعتبر است");
    }

    return { request: existing, account };
  }

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

    const lockResult = await (db as any).execute(sql`SELECT * FROM wholesale_request WHERE id = ${requestId} FOR UPDATE`);
    const existingRaw = lockResult.rows?.[0] || (await db.select().from(wholesaleRequest).where(eq(wholesaleRequest.id, requestId)).limit(1).then((r: any) => r[0]));
    if (!existingRaw) throw new NotFoundError("درخواست یافت نشد");
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

    const recomputed = hashAcceptedTerms(existing.acceptedTermsSnapshot as any);
    if (recomputed !== existing.acceptedTermsHash) {
      throw new CatalogDomainError("ACCEPTED_TERMS_HASH_MISMATCH", "هش اسنپ‌شات نامعتبر است");
    }

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

  // ── Phase 4.4 — Revision workflow ───────────────────────────────────────
  private async claimIdempotency(
    tx: DbOrTx,
    scopeType: string,
    scopeId: string,
    commandType: string,
    idempotencyKey: string,
    requestHash: string,
  ) {
    if (!idempotencyKey) return { isReplay: false, existing: null as any };
    const [existing] = await (tx as any)
      .select()
      .from(commandIdempotency)
      .where(
        and(
          eq(commandIdempotency.scopeType, scopeType),
          eq(commandIdempotency.scopeId, scopeId),
          eq(commandIdempotency.commandType, commandType),
          eq(commandIdempotency.idempotencyKey, idempotencyKey),
        ),
      )
      .for("update")
      .limit(1);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new CatalogDomainError("IDEMPOTENCY_KEY_REUSED", `کلید عدم‌تکرار با payload متفاوت`);
      }
      if (existing.state === "completed") {
        return { isReplay: true, existing };
      }
      if (existing.state === "pending") {
        throw new CatalogDomainError("COMMAND_IN_PROGRESS", `دستور در حال اجراست`);
      }
    }
    try {
      await (tx as any).insert(commandIdempotency).values({
        id: idemId(),
        scopeType,
        scopeId,
        commandType,
        idempotencyKey,
        requestHash,
        state: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e: any) {
      if (e?.code === "23505") throw new CatalogDomainError("COMMAND_IN_PROGRESS", "هم‌زمانی کلید");
      throw e;
    }
    return { isReplay: false, existing: null as any };
  }

  private async completeIdempotency(tx: DbOrTx, scopeType: string, scopeId: string, commandType: string, idempotencyKey: string, resultId: string, payload: any) {
    if (!idempotencyKey) return;
    await (tx as any)
      .update(commandIdempotency)
      .set({ state: "completed", resultResourceId: resultId, resultPayload: sanitizeForJsonb(payload) as any, completedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(commandIdempotency.scopeType, scopeType),
          eq(commandIdempotency.scopeId, scopeId),
          eq(commandIdempotency.commandType, commandType),
          eq(commandIdempotency.idempotencyKey, idempotencyKey),
        ),
      );
  }

  async proposeRevision(input: {
    requestId: string;
    supplierUserId: string;
    reason: string;
    proposedQuantity?: number | null;
    proposedVariantId?: string | null;
    proposedPackageId?: string | null;
    proposedUnitPrice?: bigint | null;
    pricingUnit?: string | null;
    currency?: string;
    leadTimeDays?: number | null;
    idempotencyKey: string;
    expectedVersion?: number;
  }) {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new CatalogDomainError("REJECTION_REASON_REQUIRED", "Reason required for revision");
    }
    if (!input.idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    return this.db.transaction(async (tx: any) => {
      const lockRes = await tx.execute(sql`SELECT * FROM wholesale_request WHERE id = ${input.requestId} FOR UPDATE`);
      const req = lockRes.rows?.[0];
      if (!req) throw new NotFoundError("درخواست یافت نشد");

      if (input.expectedVersion !== undefined && req.version !== input.expectedVersion) {
        throw new CatalogDomainError("REQUEST_VERSION_CONFLICT", "Version conflict");
      }

      if (["rejected", "cancelled", "expired", "ordered"].includes(req.status)) {
        throw new CatalogDomainError("INVALID_REQUEST_TRANSITION", `Cannot revise terminal ${req.status}`);
      }
      if (req.status !== "supplier_review") {
        throw new CatalogDomainError("INVALID_REQUEST_TRANSITION", `Revision only from supplier_review, got ${req.status}`);
      }

      // Supplier ownership: exact supplier
      const [offer] = await tx.select().from(sellerOffer).where(eq(sellerOffer.id, req.offer_id || req.offerId)).limit(1);
      if (!offer) throw new NotFoundError("پیشنهاد یافت نشد");
      const [sellerRow] = await tx.select().from(seller).where(eq(seller.id, offer.sellerId)).limit(1);
      if (!sellerRow) throw new NotFoundError("فروشنده یافت نشد");
      if (!sellerRow.supplierId) {
        throw new CatalogDomainError("SUPPLIER_OWNERSHIP_VIOLATION", "KOLBE request cannot be revised by supplier flow? Use admin");
      }
      const { supplierMember } = await import("@kolbe/database");
      const [member] = await tx
        .select()
        .from(supplierMember)
        .where(and(eq(supplierMember.supplierId, sellerRow.supplierId), eq(supplierMember.userId, input.supplierUserId)))
        .limit(1);
      if (!member) throw new CatalogDomainError("SUPPLIER_OWNERSHIP_VIOLATION", "Not member of supplier");
      if (!["owner", "sales"].includes(member.role)) {
        throw new CatalogDomainError("ROLE_NOT_ALLOWED", `Role ${member.role} cannot negotiate commercial terms`);
      }

      // Validate proposed quantity: reduced quantity allowed, must be >0 and <= original
      if (input.proposedQuantity != null) {
        if (!Number.isSafeInteger(input.proposedQuantity) || input.proposedQuantity <= 0) {
          throw new CatalogDomainError("INVALID_QUANTITY", "proposedQuantity must be positive");
        }
        const originalQty = req.quantity;
        if (input.proposedQuantity > originalQty) {
          throw new CatalogDomainError("INVALID_QUANTITY", `proposedQuantity ${input.proposedQuantity} > original ${originalQty} — only reduced allowed`);
        }
      }

      // Validate proposed variant/package: cannot silently change buyer, VIP account, arbitrary seller, arbitrary product identity
      // Enforce same product
      if (input.proposedVariantId) {
        const [variant] = await tx.select().from(productVariant).where(eq(productVariant.id, input.proposedVariantId)).limit(1);
        if (!variant) throw new NotFoundError("واریانت پیشنهادی یافت نشد");
        if (variant.productId !== req.product_id && variant.productId !== req.productId) {
          throw new CatalogDomainError("PRODUCT_MISMATCH", "Proposed variant must belong to same product — fundamentally different product requires new request");
        }
      }
      if (input.proposedPackageId) {
        const [pkg] = await tx.select().from(wholesalePackage).where(eq(wholesalePackage.id, input.proposedPackageId)).limit(1);
        if (!pkg) throw new NotFoundError("بسته پیشنهادی یافت نشد");
        // Package must belong to same product via offer
        const [pkgOffer] = await tx.select().from(sellerOffer).where(eq(sellerOffer.id, pkg.offerId)).limit(1);
        if (!pkgOffer || pkgOffer.productId !== req.product_id) {
          throw new CatalogDomainError("PRODUCT_MISMATCH", "Proposed package must belong to same product — new request required");
        }
        // Also seller must be same seller? Spec says cannot arbitrarily change seller
        if (pkgOffer.sellerId !== sellerRow.id) {
          throw new CatalogDomainError("SELLER_MISMATCH", "Proposed package seller mismatch — cannot change seller silently");
        }
      }
      if (input.proposedVariantId && input.proposedPackageId) {
        throw new CatalogDomainError("REQUEST_SELECTOR_AMBIGUOUS", "Cannot propose both variant and package");
      }

      // Validate unit price if provided
      if (input.proposedUnitPrice != null) {
        if (input.proposedUnitPrice < 0n || input.proposedUnitPrice > 1000000000000000n) {
          throw new CatalogDomainError("INVALID_PRICE", "proposedUnitPrice out of range");
        }
      }

      // Idempotency
      const reqHash = hashReq({
        requestId: input.requestId,
        reason: input.reason,
        proposedQuantity: input.proposedQuantity,
        proposedVariantId: input.proposedVariantId,
        proposedPackageId: input.proposedPackageId,
        proposedUnitPrice: input.proposedUnitPrice?.toString(),
        pricingUnit: input.pricingUnit,
        currency: input.currency,
      });

      const claim = await this.claimIdempotency(tx, "wholesale_request", input.requestId, "vip.request_revision", input.idempotencyKey, reqHash);
      if (claim.isReplay && claim.existing) {
        return { revision: claim.existing.resultPayload as any, request: req, replayed: true };
      }

      // Determine next revision number
      const existingRevs = await tx.select().from(wholesaleRequestRevision).where(eq(wholesaleRequestRevision.requestId, input.requestId));
      const nextRevNumber = existingRevs.length > 0 ? Math.max(...existingRevs.map((r: any) => r.revisionNumber)) + 1 : 1;

      const termsSnapshot = {
        proposedQuantity: input.proposedQuantity,
        proposedVariantId: input.proposedVariantId,
        proposedPackageId: input.proposedPackageId,
        proposedUnitPrice: input.proposedUnitPrice?.toString() || null,
        pricingUnit: input.pricingUnit,
        currency: input.currency || "IRR",
        leadTimeDays: input.leadTimeDays,
        reason: input.reason,
      };
      const termsHash = hashReq(termsSnapshot);

      const revId = revisionId();
      const [revision] = await tx
        .insert(wholesaleRequestRevision)
        .values({
          id: revId,
          requestId: input.requestId,
          requestVersion: req.version,
          revisionNumber: nextRevNumber,
          proposedByUserId: input.supplierUserId,
          proposedByRole: "supplier",
          reason: input.reason,
          proposedQuantity: input.proposedQuantity,
          proposedVariantId: input.proposedVariantId,
          proposedPackageId: input.proposedPackageId,
          pricingUnit: input.pricingUnit,
          proposedUnitPrice: input.proposedUnitPrice as any,
          currency: input.currency || "IRR",
          proposedTermsSnapshot: termsSnapshot as any,
          proposedTermsHash: termsHash,
          createdAt: new Date(),
        })
        .returning();

      // Transition request to revision_requested
      transitionWholesaleRequest(req.status as WholesaleRequestStatus, "revision_requested", "supplier", input.reason);

      const [updatedReq] = await tx
        .update(wholesaleRequest)
        .set({ status: "revision_requested", version: req.version + 1, updatedAt: new Date() })
        .where(eq(wholesaleRequest.id, input.requestId))
        .returning();

      await this.completeIdempotency(tx, "wholesale_request", input.requestId, "vip.request_revision", input.idempotencyKey, revision.id, revision);

      return { revision, request: updatedReq, replayed: false };
    });
  }

  async acceptRevision(input: {
    requestId: string;
    revisionId: string;
    buyerUserId: string;
    idempotencyKey: string;
    expectedVersion?: number;
  }) {
    if (!input.idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    return this.db.transaction(async (tx: any) => {
      const lockRes = await tx.execute(sql`SELECT * FROM wholesale_request WHERE id = ${input.requestId} FOR UPDATE`);
      const req = lockRes.rows?.[0];
      if (!req) throw new NotFoundError("درخواست یافت نشد");

      if (input.expectedVersion !== undefined && req.version !== input.expectedVersion) {
        throw new CatalogDomainError("REQUEST_VERSION_CONFLICT", "Version conflict");
      }

      if (req.status !== "revision_requested") {
        throw new CatalogDomainError("INVALID_REQUEST_TRANSITION", `Accept revision only from revision_requested, got ${req.status}`);
      }

      // Verify buyer ownership
      const [account] = await tx.select().from(wholesaleAccount).where(eq(wholesaleAccount.id, req.vip_account_id || req.vipAccountId)).limit(1);
      if (!account || account.userId !== input.buyerUserId) {
        throw new CatalogDomainError("VIP_OWNERSHIP_VIOLATION", "شما مالک این درخواست نیستید");
      }

      const revRes = await tx.execute(sql`SELECT * FROM wholesale_request_revision WHERE id = ${input.revisionId} FOR UPDATE`);
      const revision = revRes.rows?.[0];
      if (!revision) throw new NotFoundError("بازنگری یافت نشد");
      if (revision.request_id !== input.requestId) throw new CatalogDomainError("REVISION_REQUEST_MISMATCH", "Revision does not belong to request");
      if (revision.buyer_response) {
        throw new CatalogDomainError("REVISION_ALREADY_RESPONDED", `Revision already responded ${revision.buyer_response}`);
      }

      const reqHash = hashReq({ requestId: input.requestId, revisionId: input.revisionId, action: "accept" });
      const claim = await this.claimIdempotency(tx, "wholesale_request", input.requestId, "vip.revision_response", input.idempotencyKey, reqHash);
      if (claim.isReplay && claim.existing) {
        return { revision: claim.existing.resultPayload as any, request: req, replayed: true };
      }

      const now = new Date();
      const [updatedRev] = await tx
        .update(wholesaleRequestRevision)
        .set({ buyerResponse: "accepted", buyerRespondedAt: now, buyerRespondedBy: input.buyerUserId })
        .where(eq(wholesaleRequestRevision.id, input.revisionId))
        .returning();

      // Accepting does NOT create order, returns to supplier_review for final supplier confirmation
      transitionWholesaleRequest(req.status as WholesaleRequestStatus, "supplier_review", "vip");

      const [updatedReq] = await tx
        .update(wholesaleRequest)
        .set({ status: "supplier_review", version: req.version + 1, updatedAt: now })
        .where(eq(wholesaleRequest.id, input.requestId))
        .returning();

      await this.completeIdempotency(tx, "wholesale_request", input.requestId, "vip.revision_response", input.idempotencyKey, updatedRev.id, updatedRev);

      return { revision: updatedRev, request: updatedReq, replayed: false };
    });
  }

  async rejectRevision(input: {
    requestId: string;
    revisionId: string;
    buyerUserId: string;
    idempotencyKey: string;
    reason?: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      const lockRes = await tx.execute(sql`SELECT * FROM wholesale_request WHERE id = ${input.requestId} FOR UPDATE`);
      const req = lockRes.rows?.[0];
      if (!req) throw new NotFoundError("درخواست یافت نشد");
      if (req.status !== "revision_requested") {
        throw new CatalogDomainError("INVALID_REQUEST_TRANSITION", `Reject revision only from revision_requested, got ${req.status}`);
      }
      const [account] = await tx.select().from(wholesaleAccount).where(eq(wholesaleAccount.id, req.vip_account_id || req.vipAccountId)).limit(1);
      if (!account || account.userId !== input.buyerUserId) throw new CatalogDomainError("VIP_OWNERSHIP_VIOLATION", "Not owner");

      const revRes = await tx.execute(sql`SELECT * FROM wholesale_request_revision WHERE id = ${input.revisionId} FOR UPDATE`);
      const revision = revRes.rows?.[0];
      if (!revision) throw new NotFoundError("بازنگری یافت نشد");
      if (revision.buyer_response) throw new CatalogDomainError("REVISION_ALREADY_RESPONDED", "Already responded");

      const reqHash = hashReq({ requestId: input.requestId, revisionId: input.revisionId, action: "reject" });
      const claim = await this.claimIdempotency(tx, "wholesale_request", input.requestId, "vip.revision_response", input.idempotencyKey, reqHash);
      if (claim.isReplay && claim.existing) {
        return { revision: claim.existing.resultPayload as any, request: req, replayed: true };
      }

      const now = new Date();
      const [updatedRev] = await tx
        .update(wholesaleRequestRevision)
        .set({ buyerResponse: "rejected", buyerRespondedAt: now, buyerRespondedBy: input.buyerUserId })
        .where(eq(wholesaleRequestRevision.id, input.revisionId))
        .returning();

      // Rejecting revision keeps request in revision_requested (buyer can still negotiate or cancel)
      // No status transition, version unchanged? But we increment version to record buyer response? Spec says versioned, append-only, audited.
      // We will keep status same but version+1 to reflect buyer response? However transition table does not have revision_requested→revision_requested.
      // So we keep version same? Let's increment version to track change but keep status.
      const [updatedReq] = await tx
        .update(wholesaleRequest)
        .set({ version: req.version + 1, updatedAt: now })
        .where(eq(wholesaleRequest.id, input.requestId))
        .returning();

      await this.completeIdempotency(tx, "wholesale_request", input.requestId, "vip.revision_response", input.idempotencyKey, updatedRev.id, updatedRev);

      return { revision: updatedRev, request: updatedReq, replayed: false };
    });
  }

  async rejectRequest(input: {
    requestId: string;
    actorId: string;
    actorRole: "supplier" | "admin";
    reason: string;
    idempotencyKey: string;
    expectedVersion?: number;
  }) {
    if (!input.reason) throw new CatalogDomainError("REJECTION_REASON_REQUIRED", "Reason required");
    return this.db.transaction(async (tx: any) => {
      const lockRes = await tx.execute(sql`SELECT * FROM wholesale_request WHERE id = ${input.requestId} FOR UPDATE`);
      const req = lockRes.rows?.[0];
      if (!req) throw new NotFoundError("درخواست یافت نشد");
      if (input.expectedVersion !== undefined && req.version !== input.expectedVersion) throw new CatalogDomainError("REQUEST_VERSION_CONFLICT", "Version conflict");
      if (["rejected", "cancelled", "expired", "ordered"].includes(req.status)) throw new CatalogDomainError("INVALID_REQUEST_TRANSITION", `Terminal ${req.status}`);

      // Ownership check
      if (input.actorRole === "supplier") {
        const [offer] = await tx.select().from(sellerOffer).where(eq(sellerOffer.id, req.offer_id || req.offerId)).limit(1);
        if (!offer) throw new NotFoundError("Offer not found");
        const [sellerRow] = await tx.select().from(seller).where(eq(seller.id, offer.sellerId)).limit(1);
        if (!sellerRow?.supplierId) throw new CatalogDomainError("SUPPLIER_OWNERSHIP_VIOLATION", "KOLBE cannot be rejected by supplier");
        const { supplierMember } = await import("@kolbe/database");
        const [member] = await tx.select().from(supplierMember).where(and(eq(supplierMember.supplierId, sellerRow.supplierId), eq(supplierMember.userId, input.actorId))).limit(1);
        if (!member) throw new CatalogDomainError("SUPPLIER_OWNERSHIP_VIOLATION", "Not member");
        if (!["owner", "sales"].includes(member.role)) throw new CatalogDomainError("ROLE_NOT_ALLOWED", `Role ${member.role} cannot reject`);
      }

      const reqHash = hashReq({ requestId: input.requestId, action: "reject", reason: input.reason });
      const claim = await this.claimIdempotency(tx, "wholesale_request", input.requestId, "vip.request_reject", input.idempotencyKey, reqHash);
      if (claim.isReplay && claim.existing) return { request: claim.existing.resultPayload as any, replayed: true };

      transitionWholesaleRequest(req.status as WholesaleRequestStatus, "rejected", input.actorRole as any, input.reason);

      const [updated] = await tx
        .update(wholesaleRequest)
        .set({ status: "rejected", rejectionReason: input.reason, version: req.version + 1, updatedAt: new Date() })
        .where(eq(wholesaleRequest.id, input.requestId))
        .returning();

      await this.completeIdempotency(tx, "wholesale_request", input.requestId, "vip.request_reject", input.idempotencyKey, updated.id, updated);
      return { request: updated, replayed: false };
    });
  }

  async cancelRequest(input: {
    requestId: string;
    actorId: string;
    actorRole: "vip" | "admin";
    reason?: string;
    idempotencyKey: string;
    expectedVersion?: number;
  }) {
    return this.db.transaction(async (tx: any) => {
      const lockRes = await tx.execute(sql`SELECT * FROM wholesale_request WHERE id = ${input.requestId} FOR UPDATE`);
      const req = lockRes.rows?.[0];
      if (!req) throw new NotFoundError("درخواست یافت نشد");
      if (input.expectedVersion !== undefined && req.version !== input.expectedVersion) throw new CatalogDomainError("REQUEST_VERSION_CONFLICT", "Version conflict");
      if (["rejected", "cancelled", "expired", "ordered"].includes(req.status)) throw new CatalogDomainError("INVALID_REQUEST_TRANSITION", `Terminal ${req.status}`);

      if (input.actorRole === "vip") {
        const [account] = await tx.select().from(wholesaleAccount).where(eq(wholesaleAccount.id, req.vip_account_id || req.vipAccountId)).limit(1);
        if (!account || account.userId !== input.actorId) throw new CatalogDomainError("VIP_OWNERSHIP_VIOLATION", "Not owner");
      }

      const reqHash = hashReq({ requestId: input.requestId, action: "cancel", reason: input.reason });
      const claim = await this.claimIdempotency(tx, "wholesale_request", input.requestId, "vip.request_cancel", input.idempotencyKey, reqHash);
      if (claim.isReplay && claim.existing) return { request: claim.existing.resultPayload as any, replayed: true };

      transitionWholesaleRequest(req.status as WholesaleRequestStatus, "cancelled", input.actorRole as any);

      const [updated] = await tx
        .update(wholesaleRequest)
        .set({ status: "cancelled", version: req.version + 1, updatedAt: new Date() })
        .where(eq(wholesaleRequest.id, input.requestId))
        .returning();

      await this.completeIdempotency(tx, "wholesale_request", input.requestId, "vip.request_cancel", input.idempotencyKey, updated.id, updated);
      return { request: updated, replayed: false };
    });
  }

  async expireWholesaleRequests(limit = 100) {
    return this.db.transaction(async (tx: any) => {
      // Worker-safe using DB time SELECT NOW() + SKIP LOCKED
      const claimedRes = await tx.execute(
        sql`SELECT * FROM wholesale_request WHERE status IN ('pending','supplier_review','revision_requested','accepted') AND acceptance_expires_at IS NOT NULL AND acceptance_expires_at < NOW() ORDER BY acceptance_expires_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
      );
      const claimed = claimedRes.rows as any[];
      const expired: any[] = [];
      for (const req of claimed) {
        try {
          transitionWholesaleRequest(req.status as WholesaleRequestStatus, "expired", "system");
          const [updated] = await tx
            .update(wholesaleRequest)
            .set({ status: "expired", version: req.version + 1, updatedAt: new Date() })
            .where(eq(wholesaleRequest.id, req.id))
            .returning();
          expired.push(updated);
        } catch {
          continue;
        }
      }
      return expired;
    });
  }

  async listRevisions(requestId: string, executor?: DbOrTx) {
    const db = this.getExecutor(executor);
    return db.select().from(wholesaleRequestRevision).where(eq(wholesaleRequestRevision.requestId, requestId)).orderBy(wholesaleRequestRevision.revisionNumber);
  }
}
