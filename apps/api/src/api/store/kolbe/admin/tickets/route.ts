import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** همه تیکتهای پشتیبانی. */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const tickets = (await svc(req).wholesale.listSupportTickets()) as any[];
  ok(res, {
    tickets: tickets
      .slice()
      .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .map((t: any) => ({
        id: t.id, subject: t.subject, category: t.category, message: t.message,
        priority: t.priority, status: t.status, admin_reply: t.adminReply ?? null, created_at: t.createdAt,
      })),
  });
});
