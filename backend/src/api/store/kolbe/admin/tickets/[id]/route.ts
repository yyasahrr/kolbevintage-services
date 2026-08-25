import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../../lib/http";

/** پاسخ ادمین به تیکت / بستن آن. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const id = (req as any).params?.id;
  const body = req.body as { status?: "answered" | "closed" | "open"; adminReply?: string };
  if (!id || !body?.status) return ok(res, { error: "INVALID_INPUT" }, 422);
  await svc(req).wholesale.updateSupportTickets({
    id, status: body.status,
    ...(body.adminReply?.trim() ? { adminReply: body.adminReply.trim() } : {}),
  });
  ok(res, { status: body.status });
});
