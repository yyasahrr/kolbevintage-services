import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** لیست تأمینکنندگان. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const suppliers = (await svc(req).supplier.listSuppliers()) as any[];
  ok(res, {
    suppliers: suppliers
      .slice()
      .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .map((s: any) => ({
        id: s.id, display_name: s.displayName, legal_name: s.legalName, city: s.city ?? null,
        phone: s.phone ?? null, status: s.status, monthly_capacity: s.monthlyCapacity ?? null,
        capabilities: (s.capabilities as string[]) ?? [],
      })),
  });
});
