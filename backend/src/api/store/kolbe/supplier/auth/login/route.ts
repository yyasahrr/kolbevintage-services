import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, svc } from "../../../../../../lib/http";

/** ورود تأمینکننده: نقش supplier + عضویت فعال تأییدشده لازم است. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.body as { email?: string; password?: string };
  if (!body?.email || !body?.password) return ok(res, { error: "INVALID_INPUT" }, 422);
  const service = svc(req);
  const { user, token } = await service.account.loginAccount(body.email, body.password, "supplier");
  const context = await service.supplier.getMemberContext(user.id);
  if (!context) return ok(res, { error: "SUPPLIER_ACCESS_INACTIVE" }, 403);
  ok(res, { token, supplier: context });
});
