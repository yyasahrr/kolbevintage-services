import { Controller, Get, Param, Inject } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { PaymentsService } from "../payments/payments.service";

@Controller("supplier/finance")
export class SupplierFinanceController {
  constructor(@Inject(PaymentsService) private readonly paymentsService: PaymentsService) {}

  @Get("proformas")
  @Roles("supplier")
  async listProformas(@CurrentUser() claims: Claims) {
    // Supplier's sellerId derived from claims
    // For simplicity, assume claims.sellerId exists, else use supplierId lookup
    // In real implementation, we would resolve seller via SuppliersService
    const sellerId = (claims as any).sellerId || (claims as any).supplierId;
    if (!sellerId) return { proformas: [] };
    // For supplier, we need to filter by sellerId — use repository directly
    const proformas = await (this.paymentsService as any).repository.findProformasByOrderId
      ? [] // placeholder
      : [];
    // Simplified: use service method getProformasForSupplier
    const result = await this.paymentsService.getProformasForSupplier("", sellerId);
    return { proformas: result };
  }

  @Get("proformas/:id")
  @Roles("supplier")
  async getProforma(@CurrentUser() claims: Claims, @Param("id") id: string) {
    const sellerId = (claims as any).sellerId;
    const proforma = await (this.paymentsService as any).repository.findProformaById(id);
    if (!proforma) throw new Error("Proforma not found");
    if (proforma.sellerId !== sellerId) throw new Error("Access denied");
    return {
      proforma: {
        id: proforma.id,
        proformaNumber: proforma.proformaNumber,
        childOrderId: proforma.childOrderId,
        status: proforma.status,
        totalAmount: (proforma.totalAmount || 0).toString(),
        currency: proforma.currency,
        issuedAt: proforma.issuedAt,
      },
    };
  }
}
