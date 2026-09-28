import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { supplier, supplierApplication, supplierMember, seller, supplierPermissionConfig } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { NotFoundError } from "@kolbe/shared";
import { checkSupplierPermission, assertSupplierMemberRoleAllowed } from "./supplier-permissions.logic";
import { CatalogDomainError } from "../catalog/catalog.logic";
import { DomainError } from "@kolbe/shared";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class SuppliersService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase, private readonly audit: AuditService) {}

  async apply(input: { companyName: unknown; representativeName: unknown; phone: unknown; category: unknown; monthlyCapacity?: unknown; email?: unknown }, idempotencyKey?: string) {
    const companyName = String(input.companyName ?? "").trim().replace(/[<>]/g, "").slice(0, 180);
    const representativeName = String(input.representativeName ?? "").trim().replace(/[<>]/g, "").slice(0, 160);
    const phone = String(input.phone ?? "").replace(/[\s-]/g, "");
    const category = String(input.category ?? "").trim().replace(/[<>]/g, "").slice(0, 120);
    const monthlyCapacity = input.monthlyCapacity == null || input.monthlyCapacity === "" ? null : Number(input.monthlyCapacity);
    if (!companyName || !representativeName || !category || !/^(?:\+98|0098|98|0)?9\d{9}$/.test(phone)) throw new DomainError(422, "INVALID_INPUT", "اطلاعات درخواست تأمین‌کننده نامعتبر است");
    if (monthlyCapacity !== null && (!Number.isSafeInteger(monthlyCapacity) || monthlyCapacity < 0 || monthlyCapacity > 10_000_000)) throw new DomainError(422, "INVALID_MONTHLY_CAPACITY", "ظرفیت ماهانه نامعتبر است");
    const [existing] = await this.db.select().from(supplierApplication).where(and(eq(supplierApplication.phone, phone), eq(supplierApplication.companyName, companyName))).limit(1);
    if (existing && ["pending", "approved"].includes(existing.status)) return { id: existing.id, replayed: true };
    const id = idempotencyKey && /^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey) ? `sapp_${Buffer.from(idempotencyKey).toString("hex").slice(0, 32)}` : `sapp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const [created] = await this.db.insert(supplierApplication).values({ id, companyName, representativeName, phone, category, monthlyCapacity }).onConflictDoNothing().returning();
    const application = created ?? (await this.db.select().from(supplierApplication).where(eq(supplierApplication.id, id)).limit(1))[0];
    if (!application) throw new DomainError(409, "SUPPLIER_APPLICATION_CONFLICT", "درخواست هم‌زمان ثبت شده است");
    await this.audit.record({ actorId: null, actorRole: "public", action: "supplier.application.created", entityType: "supplier_application", entityId: application.id, metadata: { companyName, category } });
    return { id: application.id, replayed: !created };
  }

  async createSupplier(input: { legalName: string; displayName: string }) {
    const id = `sup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const [created] = await this.db.insert(supplier).values({ id, legalName: input.legalName, displayName: input.displayName, status: "approved" }).returning();
    // Create seller for supplier
    const sellerId = `seller_${id}`;
    await this.db.insert(seller).values({ id: sellerId, type: "SUPPLIER", supplierId: id, displayName: input.displayName, status: "active" }).onConflictDoNothing();
    return created;
  }

  async addMember(input: { supplierId: string; userId: string; role: "owner" | "sales" | "warehouse" | "finance" }) {
    assertSupplierMemberRoleAllowed(input.role, "create_product"); // owner can, others will throw for some actions, but adding member itself is owner only
    const id = `smem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const [member] = await this.db.insert(supplierMember).values({ id, supplierId: input.supplierId, userId: input.userId, role: input.role }).returning();
    return member;
  }

  async listMembers(supplierId: string) {
    return this.db.select().from(supplierMember).where(eq(supplierMember.supplierId, supplierId));
  }

  async getPermissionConfigs() {
    return this.db.select().from(supplierPermissionConfig);
  }

  async checkAction(action: "create_product" | "change_images" | "change_description" | "add_variant" | "change_category" | "change_price", supplierId: string) {
    const configs = await this.db.select().from(supplierPermissionConfig);
    if (configs.length === 0) {
      // Default configs if not seeded
      return { allowed: true, requiresApproval: action !== "change_price" };
    }
    return checkSupplierPermission({ action, supplierId }, configs as any);
  }

  // ── Phase 4.3.1 — Order eligibility queries ───────────────────────────
  async getSellerEligibility(sellerId: string, executor?: any) {
    const db = (executor as any) || this.db;
    const [sellerRow] = await db.select().from(seller).where(eq(seller.id, sellerId)).limit(1);
    if (!sellerRow) throw new NotFoundError("فروشنده یافت نشد");
    if (sellerRow.status !== "active") {
      throw new CatalogDomainError("SELLER_NOT_ELIGIBLE", `Seller ${sellerId} not active`);
    }
    if (sellerRow.type === "SUPPLIER") {
      if (!sellerRow.supplierId) {
        throw new CatalogDomainError("SELLER_NOT_ELIGIBLE", `Supplier seller ${sellerId} missing supplierId`);
      }
      const [sup] = await db.select().from(supplier).where(eq(supplier.id, sellerRow.supplierId)).limit(1);
      if (!sup) throw new NotFoundError("تأمین‌کننده یافت نشد");
      if (sup.status !== "active" && sup.status !== "approved") {
        throw new CatalogDomainError("SELLER_NOT_ELIGIBLE", `Supplier ${sup.id} not active`);
      }
      return { seller: sellerRow, supplier: sup };
    }
    return { seller: sellerRow, supplier: null };
  }

  async getDbNow(executor?: any) {
    const db = (executor as any) || this.db;
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`SELECT NOW() as now`);
    const nowVal = (result as any).rows?.[0]?.now || (result as any)[0]?.now;
    return new Date(nowVal);
  }

  /** Phase 4.7.5 — owner-service read used by Compliance (never a direct table read from another module). */
  async getSupplierById(supplierId: string, executor?: any) {
    const db = (executor as any) || this.db;
    const [row] = await db.select().from(supplier).where(eq(supplier.id, supplierId)).limit(1);
    return row ?? null;
  }

  async getUserMemberships(userId: string, executor?: any) {
    const db = (executor as any) || this.db;
    const members = await db.select().from(supplierMember).where(eq(supplierMember.userId, userId));
    const result: any[] = [];
    for (const m of members) {
      const [sellerRow] = await db.select().from(seller).where(eq(seller.supplierId, m.supplierId)).limit(1);
      result.push({ ...m, sellerId: sellerRow?.id || null, supplierId: m.supplierId, role: m.role, userId: m.userId });
    }
    return result;
  }
}
