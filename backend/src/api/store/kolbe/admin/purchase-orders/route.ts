import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** همه POهای بازار عمده. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  ok(res, { orders: await svc(req).purchaseOrder.listAllOrders() });
});
