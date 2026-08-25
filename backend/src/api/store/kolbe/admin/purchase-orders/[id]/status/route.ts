import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../../../lib/http";
import { handlePurchaseOrderDeliveredFlow } from "../../../../../../../lib/kolbe-flows";

/** تغییر وضعیت PO توسط ادمین. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const id = (req as any).params?.id;
  const body = req.body as { status?: "confirmed" | "preparing" | "shipped" | "delivered" | "cancelled"; trackingCode?: string };
  if (!id || !body?.status) return ok(res, { error: "INVALID_INPUT" }, 422);
  const service = svc(req);
  await service.purchaseOrder.updateStatus({ orderId: id, status: body.status, trackingCode: body.trackingCode });
  if (body.status === "delivered") {
    const all = await service.purchaseOrder.listAllOrders();
    const row = all.find((o: any) => o.id === id);
    if (row) await handlePurchaseOrderDeliveredFlow(service, row);
  }
  ok(res, { status: body.status });
});
