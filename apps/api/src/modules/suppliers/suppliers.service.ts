import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { supplier, supplierMember, seller, supplierPermissionConfig } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { NotFoundError } from "@kolbe/shared";
import { checkSupplierPermission, assertSupplierMemberRoleAllowed } from "./supplier-permissions.logic";
import { CatalogDomainError } from "../catalog/catalog.logic";

@Injectable()
export class SuppliersService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

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
