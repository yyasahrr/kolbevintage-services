import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, svc } from "../../../../../lib/http";

/** ساخت حساب مشتری (فروشگاه یا متقاضی VIP). */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.body as { email?: string; password?: string; name?: string; phone?: string; role?: string };
  if (!body?.email?.includes("@") || !body?.password || body.password.length < 8) {
    return ok(res, { error: "INVALID_INPUT" }, 422);
  }
  const allowedRoles = ["customer", "vip"];
  const role = allowedRoles.includes(body.role ?? "") ? body.role! : "customer";
  const user = await svc(req).account.registerAccount({
    email: body.email, password: body.password, role,
    displayName: body.name, phone: body.phone,
  });
  ok(res, { id: user.id, email: user.email, role: user.role }, 201);
});
