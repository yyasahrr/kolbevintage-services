import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** حسابهای VIP عمده (مدیریت ادمین). */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const accounts = (await svc(req).wholesale.listWholesaleAccounts()) as any[];
  ok(res, {
    accounts: accounts.map((a: any) => ({
      id: a.id, user_id: a.userId, member_name: a.memberName, store_name: a.storeName,
      phone: a.phone, city: a.city, plan_name: a.planName, status: a.status,
      activated_at: a.activatedAt ?? null, expires_at: a.expiresAt ?? null, created_at: a.createdAt,
    })),
  });
});
