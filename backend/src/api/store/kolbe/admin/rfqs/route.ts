import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** همه RFQها. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const rfqs = (await svc(req).wholesale.listRfqs()) as any[];
  ok(res, {
    rfqs: rfqs.map((r: any) => ({
      id: r.id, supplier_id: r.supplierId, reference_code: r.referenceCode, title: r.title,
      customer_name: r.customerName, quantity: r.quantity, status: r.status, created_at: r.createdAt,
    })),
  });
});

/** ثبت RFQ جدید برای یک تأمینکننده. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const body = req.body as { supplierId?: string; title?: string; customerName?: string; quantity?: number; requestedDeliveryDate?: string; specifications?: Record<string, unknown> };
  if (!body?.supplierId || !body?.title?.trim()) return ok(res, { error: "INVALID_INPUT" }, 422);
  const rfq = await svc(req).wholesale.createRfqs({
    supplierId: body.supplierId,
    referenceCode: `RFQ-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    title: body.title.trim(), customerName: body.customerName?.trim() || "کلبه وینتیج",
    quantity: Number(body.quantity ?? 0),
    requestedDeliveryDate: body.requestedDeliveryDate ? new Date(body.requestedDeliveryDate) : null,
    specifications: body.specifications ?? {}, status: "open",
  });
  ok(res, { id: rfq.id, reference_code: rfq.referenceCode }, 201);
});
