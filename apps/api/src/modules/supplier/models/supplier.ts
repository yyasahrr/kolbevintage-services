import { model } from "@medusajs/framework/utils";

/**
 * مدل تأمینکننده - معادل جدول public.suppliers در اسکیمای فعلی Supabase.
 * منطق کسبوکار (درخواست عضویت، اعضای تیم، دستهبندی) در فاز ۳ مهاجرت منتقل میشود.
 */
const Supplier = model.define("supplier", {
  id: model.id().primaryKey(),
  legalName: model.text(),
  displayName: model.text(),
  contactEmail: model.text().nullable(),
  phone: model.text().nullable(),
  category: model.text().nullable(),
  monthlyCapacity: model.number().nullable(),
  status: model.enum("application_status", [
    "pending",
    "approved",
    "rejected",
    "changes_requested",
  ]).default("pending"),
  metadata: model.json().nullable(),
});

export default Supplier;
