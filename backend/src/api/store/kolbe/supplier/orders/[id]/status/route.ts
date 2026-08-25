import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../../../lib/http";
import { handlePurchaseOrderDeliveredFlow } from "../../../../../../../lib/kolbe-flows";

/** بهروزرسانی وضعیت PO توسط تأمینکننده - معادل RPC update_supplier_purchase_order. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "supplier");
  const service = svc(req);
  const context = await service.supplier.getMemberContext(claims.sub);
  if (!context) return ok(res, { error: "SUPPLIER_ACCESS_INACTIVE" }, 403);
  const id = (req as any).params?.id;
  const body = req.body as { status?: "confirmed" | "preparing" | "shipped" | "delivered"; trackingCode?: string };
  if (!id || !body?.status) return ok(res, { error: "INVALID_INPUT" }, 422);

  const supplierOrders = await service.purchaseOrder.listSupplierOrders(context.supplierId);
  const target = supplierOrders.find((o: any) => o.id === id);
  if (!target) return ok(res, { error: "ORDER_NOT_FOUND" }, 404);

  try {
    await service.purchaseOrder.updateStatus({ orderId: id, status: body.status, trackingCode: body.trackingCode });
    if (body.status === "delivered") {
      const [row] = (await service.purchaseOrder.listByWholesaleOrder(target.wholesale_order_id ?? "")).filter((o: any) => o.id === id);
      const withItems = supplierOrders.find((o: any) => o.id === id);
      await handlePurchaseOrderDeliveredFlow(service, { ...target, ...(withItems ?? {}), ...(row ?? {}) });
    }
    ok(res, { status: body.status });
  } catch (error: any) {
    const code = error?.message ?? "UPDATE_FAILED";
    const status = code === "INVALID_STATUS_TRANSITION" || code === "TRACKING_CODE_REQUIRED" ? 409 : 400;
    ok(res, { error: code }, status);
  }
});
