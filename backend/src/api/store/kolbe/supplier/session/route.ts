import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** بازیابی نشست تأمینکننده (برای restore بعد از رفرش). */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "supplier");
  const context = await svc(req).supplier.getMemberContext(claims.sub);
  if (!context) return ok(res, { error: "SUPPLIER_ACCESS_INACTIVE" }, 403);
  ok(res, { supplier: context });
});
