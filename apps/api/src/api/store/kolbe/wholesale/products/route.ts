import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** کاتالوگ عمده - فقط برای اعضای VIP فعال. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "vip");
  const service = svc(req);
  const account = await service.wholesale.getActiveAccount(claims.sub);
  if (!account) return ok(res, { error: "VIP_ACCOUNT_INACTIVE" }, 403);
  const products = await service.supplier.listApprovedCatalog();
  ok(res, { products });
});
