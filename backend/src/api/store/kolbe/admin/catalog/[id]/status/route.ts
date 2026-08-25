import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../../../lib/http";

/** تغییر وضعیت تأیید محصول (approved / changes_requested / rejected). */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const id = (req as any).params?.id;
  const body = req.body as { status?: "draft" | "submitted" | "approved" | "changes_requested" | "rejected" };
  if (!id || !body?.status) return ok(res, { error: "INVALID_INPUT" }, 422);
  await svc(req).supplier.updateSupplierProducts({ id, status: body.status });
  ok(res, { status: body.status });
});
