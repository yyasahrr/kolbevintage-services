import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, svc } from "../../../../../lib/http";

/**
 * بوتاسترپ یکبارهای ادمین - فقط با راز KOLBE_BOOTSTRAP_SECRET از env سرور کار میکند.
 * پس از ساخت ادمین، متغیر را از env حذف کنید تا endpoint عملاً قفل شود.
 */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const secret = process.env.KOLBE_BOOTSTRAP_SECRET;
  const body = req.body as { secret?: string; email?: string; password?: string; name?: string };
  if (!secret || body?.secret !== secret) return ok(res, { error: "UNAUTHORIZED" }, 401);
  if (!body?.email?.includes("@") || (body?.password?.length ?? 0) < 8) return ok(res, { error: "INVALID_INPUT" }, 422);
  const user = await svc(req).account.registerAccount({
    email: body.email, password: body.password!, role: "admin",
    displayName: body.name ?? "مدیر کلبه",
  });
  ok(res, { id: user.id, email: user.email, role: user.role }, 201);
});
