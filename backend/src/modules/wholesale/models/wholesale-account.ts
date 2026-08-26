import { model } from "@medusajs/framework/utils";

/** حساب VIP عمده - معادل wholesale_accounts. */
export const WholesaleAccount = model.define("wholesale_account", {
  id: model.id().primaryKey(),
  userId: model.text(),
  memberName: model.text(),
  storeName: model.text(),
  phone: model.text(),
  city: model.text(),
  planName: model.text().default("وی‌آی‌پی"),
  status: model.enum(["pending", "approved", "suspended", "financial_blocked", "rejected", "changes_requested"]).default("pending"),
  activatedAt: model.dateTime().nullable(),
  expiresAt: model.dateTime().nullable(),
});
