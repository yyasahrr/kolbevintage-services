import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../../../lib/http";
import { cancelWholesaleOrderFlow } from "../../../../../../../lib/kolbe-flows";

/** لغو سفارش عمده + آزادسازی رزروها + لغو POهای باز. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const id = (req as any).params?.id;
  if (!id) return ok(res, { error: "INVALID_INPUT" }, 422);
  await cancelWholesaleOrderFlow(svc(req), id);
  ok(res, { status: "cancelled" });
});
