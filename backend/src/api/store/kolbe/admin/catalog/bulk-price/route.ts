import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../../lib/http";

/** ویرایش گروهی قیمت عمده (درصدی یا مبلغی) — پاسخ نیازسنجی 9-d و 10-a (بدون تأیید). */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const body = req.body as {
    ids?: string[];
    mode?: "percent" | "amount";
    value?: number;
  };
  if (!Array.isArray(body?.ids) || body.ids.length === 0 || (body?.value !== 0 && !body?.value)) {
    return ok(res, { error: "INVALID_INPUT" }, 422);
  }
  const service = svc(req);
  const products = (await service.supplier.listSupplierProducts()) as any[];
  const targets = products.filter((p) => body.ids!.includes(p.id));
  let updated = 0;
  for (const product of targets) {
    const next =
      body.mode === "amount"
        ? Math.max(0, Math.round(product.wholesalePrice + Number(body.value)))
        : Math.max(0, Math.round(product.wholesalePrice * (1 + Number(body.value) / 100)));
    await service.supplier.updateSupplierProducts({ id: product.id, wholesalePrice: next });
    updated += 1;
  }
  ok(res, { updated });
});
