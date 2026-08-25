import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** درخواستهای عضویت تأمینکنندگان. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const apps = (await svc(req).supplier.listSupplierApplications()) as any[];
  ok(res, {
    applications: apps
      .slice()
      .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .map((a: any) => ({
        id: a.id, company_name: a.companyName, representative_name: a.representativeName,
        phone: a.phone, category: a.category, monthly_capacity: a.monthlyCapacity,
        status: a.status, created_at: a.createdAt,
      })),
  });
});
