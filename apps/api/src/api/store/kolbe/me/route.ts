import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../lib/http";

/** هویت کاربر جاری (مشتری فروشگاه). */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "customer");
  const user = await svc(req).account.getAccount(claims.sub);
  if (!user) return ok(res, { error: "UNAUTHORIZED" }, 401);
  ok(res, { id: user.id, name: user.displayName ?? user.email.split("@")[0], phone: user.phone ?? "—", email: user.email });
});
