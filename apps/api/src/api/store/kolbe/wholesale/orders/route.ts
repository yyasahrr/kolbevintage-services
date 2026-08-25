import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";
import { submitWholesaleOrderFlow } from "../../../../../lib/kolbe-flows";

/** سفارشهای حساب VIP جاری. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "vip");
  const account = await svc(req).wholesale.getActiveAccount(claims.sub);
  if (!account) return ok(res, { error: "VIP_ACCOUNT_INACTIVE" }, 403);
  const orders = await svc(req).wholesale.listAccountOrders(account.id);
  ok(res, { orders });
});

/** ثبت سفارش عمده - معادل RPC تراکنشی submit_wholesale_order. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "vip");
  const service = svc(req);
  const account = await service.wholesale.getActiveAccount(claims.sub);
  if (!account) return ok(res, { error: "VIP_ACCOUNT_INACTIVE" }, 403);
  const body = req.body as { lines?: Array<{ variantId: string; quantity: number }> };
  const result = await submitWholesaleOrderFlow(service, account, body?.lines ?? []);
  ok(res, result, 201);
});
