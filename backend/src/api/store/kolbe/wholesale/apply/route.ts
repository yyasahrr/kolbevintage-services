import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** درخواست عضویت عمده (VIP) - بعد از تأیید ادمین فعال میشود. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "customer");
  const body = req.body as { memberName?: string; storeName?: string; phone?: string; city?: string };
  if (!body?.storeName?.trim() || !body?.phone?.trim() || !body?.city?.trim()) {
    return ok(res, { error: "INVALID_INPUT" }, 422);
  }
  const service = svc(req);
  const existing = await service.wholesale.getActiveAccount(claims.sub);
  if (existing) return ok(res, { error: "ALREADY_MEMBER" }, 409);
  await service.wholesale.createWholesaleAccounts({
    userId: claims.sub,
    memberName: body.memberName?.trim() || body.storeName.trim(),
    storeName: body.storeName.trim(), phone: body.phone.trim(), city: body.city.trim(),
    status: "pending",
  });
  ok(res, { status: "pending" }, 201);
});
