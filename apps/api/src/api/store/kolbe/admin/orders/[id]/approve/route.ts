import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../../../lib/http";
import { approveWholesaleOrderFlow } from "../../../../../../../lib/kolbe-flows";

/** تأیید سفارش عمده + ساخت PO برای هر تأمینکننده - معادل RPC approve_wholesale_order. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const id = (req as any).params?.id;
  const body = req.body as { dueDate?: string } | undefined;
  if (!id) return ok(res, { error: "INVALID_INPUT" }, 422);
  const result = await approveWholesaleOrderFlow(svc(req), id, body?.dueDate ?? null);
  ok(res, result);
});
