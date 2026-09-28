import { Controller, Get, Param, Inject } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { PaymentsService, FinanceDomainError } from "../payments/payments.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { eq, and } from "drizzle-orm";
import { supplierMember, supplier, seller } from "@kolbe/database";

@Controller("supplier/finance")
export class SupplierFinanceController {
  constructor(
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(SuppliersService) private readonly suppliersService: SuppliersService,
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
  ) {}

  private async resolveSellerForUser(userId: string, executor?: any) {
    const db = executor || this.db;
    // Canonical: Claims.sub → supplier_member → supplier → seller
    const [member] = await db.select().from(supplierMember).where(eq(supplierMember.userId, userId)).limit(1);
    if (!member) {
      throw new FinanceDomainError("SUPPLIER_MEMBERSHIP_REQUIRED", "Supplier membership required", 403);
    }
    const [sup] = await db.select().from(supplier).where(eq(supplier.id, member.supplierId)).limit(1);
    if (!sup) {
      throw new FinanceDomainError("SUPPLIER_NOT_FOUND", "Supplier not found", 404);
    }
    const [sellerRow] = await db.select().from(seller).where(eq(seller.supplierId, sup.id)).limit(1);
    if (!sellerRow) {
      throw new FinanceDomainError("SELLER_NOT_FOUND", "Seller not found for supplier", 404);
    }
    return { member, supplier: sup, seller: sellerRow };
  }

  @Get("proformas")
  @Roles("supplier")
  async listProformas(@CurrentUser() claims: Claims) {
    // Server derives authenticated supplier seller via Claims.sub → supplier_member → supplier → seller
    const { seller: sellerRow } = await this.resolveSellerForUser(claims.sub);
    const result = await this.paymentsService.getProformasForSupplierBySellerId(sellerRow.id);
    return { proformas: result };
  }

  @Get("proformas/:id")
  @Roles("supplier")
  async getProforma(@CurrentUser() claims: Claims, @Param("id") id: string) {
    const { seller: sellerRow } = await this.resolveSellerForUser(claims.sub);
    try {
      const proforma = await this.paymentsService.getProformaForSupplierById(id, sellerRow.id);
      return { proforma };
    } catch (e: any) {
      if (e.code === "PROFORMA_NOT_FOUND") {
        throw new FinanceDomainError("PROFORMA_NOT_FOUND", "Proforma not found", 404);
      }
      if (e.code === "PROFORMA_ACCESS_DENIED") {
        throw new FinanceDomainError("PROFORMA_ACCESS_DENIED", "Access denied to proforma", 403);
      }
      throw e;
    }
  }
}
