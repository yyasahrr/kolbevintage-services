import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../../../lib/http";

/** فعال/رد کردن عضویت VIP + ارتقای نقش حساب کاربر به vip. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const id = (req as any).params?.id;
  const body = req.body as { status?: "approved" | "rejected"; expiresAt?: string };
  if (!id || !body?.status) return ok(res, { error: "INVALID_INPUT" }, 422);
  const service = svc(req);
  const accounts = (await service.wholesale.listWholesaleAccounts({ id } as any)) as any[];
  const account = accounts[0];
  if (!account) return ok(res, { error: "ACCOUNT_NOT_FOUND" }, 404);

  await service.wholesale.updateWholesaleAccounts({
    id,
    status: body.status,
    ...(body.status === "approved"
      ? { activatedAt: new Date(), expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
      : {}),
  });
  if (body.status === "approved") {
    await service.account.updateAccountUsers({ id: account.userId, role: "vip" });
  }
  ok(res, { status: body.status });
});
