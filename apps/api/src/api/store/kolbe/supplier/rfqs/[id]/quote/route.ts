import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../../../lib/http";

/** ارسال پیشنهاد قیمت روی RFQ. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "supplier");
  const service = svc(req);
  const context = await service.supplier.getMemberContext(claims.sub);
  if (!context) return ok(res, { error: "SUPPLIER_ACCESS_INACTIVE" }, 403);
  const id = (req as any).params?.id;
  const body = req.body as { unitPrice?: number; leadTimeDays?: number; notes?: string };
  if (!id || !body?.unitPrice) return ok(res, { error: "INVALID_INPUT" }, 422);
  const rfqs = (await service.wholesale.listRfqs({ id } as any)) as any[];
  if (rfqs.length === 0) return ok(res, { error: "RFQ_NOT_FOUND" }, 404);
  await service.wholesale.createQuotes({
    rfqId: id, supplierId: context.supplierId,
    unitPrice: Number(body.unitPrice), leadTimeDays: Number(body.leadTimeDays ?? 0),
    notes: body.notes?.trim() || null, status: "submitted",
  });
  await service.wholesale.updateRfqs({ id, status: "quoted" });
  ok(res, { status: "quoted" }, 201);
});
