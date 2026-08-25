import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, svc } from "../../../../../lib/http";

/** ثبت درخواست عضویت تأمینکننده (عمومی، بدون احراز هویت). */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.body as { companyName?: string; representativeName?: string; phone?: string; category?: string; monthlyCapacity?: number | null };
  if (!body?.companyName?.trim() || !body?.representativeName?.trim() || !body?.phone?.trim() || !body?.category?.trim()) {
    return ok(res, { error: "INVALID_INPUT" }, 422);
  }
  const application = await svc(req).supplier.createSupplierApplications({
    companyName: body.companyName.trim(),
    representativeName: body.representativeName.trim(),
    phone: body.phone.trim(),
    category: body.category.trim(),
    monthlyCapacity: body.monthlyCapacity != null ? Number(body.monthlyCapacity) : null,
    status: "pending",
  });
  ok(res, { id: application.id }, 201);
});
