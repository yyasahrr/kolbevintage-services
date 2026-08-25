import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** صندوق RFQ تأمینکننده جاری. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "supplier");
  const service = svc(req);
  const context = await service.supplier.getMemberContext(claims.sub);
  if (!context) return ok(res, { error: "SUPPLIER_ACCESS_INACTIVE" }, 403);
  const all = (await service.wholesale.listRfqs({ supplierId: context.supplierId } as any)) as any[];
  ok(res, {
    rfqs: all
      .slice()
      .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .map((r: any) => ({
        id: r.id, reference_code: r.referenceCode, title: r.title, customer_name: r.customerName,
        quantity: r.quantity, requested_delivery_date: r.requestedDeliveryDate ?? null,
        specifications: r.specifications ?? {}, status: r.status, created_at: r.createdAt,
      })),
  });
});
