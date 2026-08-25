import { model } from "@medusajs/framework/utils";

/** تیکت پشتیبانی - معادل support_tickets. */
export const SupportTicket = model.define("support_ticket", {
  id: model.id().primaryKey(),
  supplierId: model.text().nullable(),
  subject: model.text(),
  category: model.text().default("عمومی"),
  message: model.text(),
  priority: model.enum(["low", "normal", "high"]).default("normal"),
  status: model.enum(["open", "answered", "closed"]).default("open"),
  adminReply: model.text().nullable(),
});
