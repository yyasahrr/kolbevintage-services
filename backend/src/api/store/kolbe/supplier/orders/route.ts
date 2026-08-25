import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** سفارشهای خرید (PO) تأمینکننده جاری. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "supplier");
  const context = await svc(req).supplier.getMemberContext(claims.sub);
  if (!context) return ok(res, { error: "SUPPLIER_ACCESS_INACTIVE" }, 403);
  const orders = await svc(req).purchaseOrder.listSupplierOrders(context.supplierId);
  ok(res, { orders });
});
