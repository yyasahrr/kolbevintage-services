import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, svc } from "../../../../../lib/http";

/** ورود واحد پلتفرم؛ role اختیاری برای محدودکردن نقش (admin / vip / supplier). */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.body as { email?: string; password?: string; role?: string };
  if (!body?.email || !body?.password) return ok(res, { error: "INVALID_INPUT" }, 422);
  const { user, token } = await svc(req).account.loginAccount(body.email, body.password, body.role);
  ok(res, {
    token,
    user: { id: user.id, email: user.email, role: user.role, name: user.displayName, phone: user.phone },
  });
});
