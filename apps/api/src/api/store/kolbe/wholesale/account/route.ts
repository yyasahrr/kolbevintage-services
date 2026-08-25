import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** حساب VIP کاربر جاری (null = عضویت فعال نیست). */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "vip");
  const account = await svc(req).wholesale.getActiveAccount(claims.sub);
  if (!account) return ok(res, { account: null });
  ok(res, {
    account: {
      id: account.id, member_name: account.memberName, store_name: account.storeName,
      phone: account.phone, city: account.city, plan_name: account.planName,
      activated_at: account.activatedAt ?? null, expires_at: account.expiresAt ?? null,
    },
  });
});
