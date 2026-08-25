import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** تیکتهای پشتیبانی تأمینکننده جاری. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "supplier");
  const service = svc(req);
  const context = await service.supplier.getMemberContext(claims.sub);
  if (!context) return ok(res, { error: "SUPPLIER_ACCESS_INACTIVE" }, 403);
  const tickets = (await service.wholesale.listSupportTickets({ supplierId: context.supplierId } as any)) as any[];
  ok(res, {
    tickets: tickets.map((t: any) => ({
      id: t.id, subject: t.subject, category: t.category, message: t.message,
      priority: t.priority, status: t.status, admin_reply: t.adminReply ?? null, created_at: t.createdAt,
    })),
  });
});

/** ثبت تیکت جدید توسط تأمینکننده. */
export const POST = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  const claims = requireRole(req, "supplier");
  const service = svc(req);
  const context = await service.supplier.getMemberContext(claims.sub);
  if (!context) return ok(res, { error: "SUPPLIER_ACCESS_INACTIVE" }, 403);
  const body = req.body as { subject?: string; category?: string; message?: string; priority?: string };
  if (!body?.subject?.trim() || !body?.message?.trim()) return ok(res, { error: "INVALID_INPUT" }, 422);
  const ticket = await service.wholesale.createSupportTickets({
    supplierId: context.supplierId, subject: body.subject.trim(),
    category: body.category?.trim() || "عمومی", message: body.message.trim(),
    priority: (["low", "normal", "high"].includes(body.priority ?? "") ? body.priority : "normal") as any,
    status: "open",
  });
  ok(res, { id: ticket.id }, 201);
});
