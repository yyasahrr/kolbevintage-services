import { model } from "@medusajs/framework/utils";

/** تأمینکننده - معادل suppliers در اسکیمای قدیمی Supabase. */
const Supplier = model.define("supplier", {
  id: model.id().primaryKey(),
  legalName: model.text(),
  displayName: model.text(),
  city: model.text().nullable(),
  phone: model.text().nullable(),
  category: model.text().nullable(),
  monthlyCapacity: model.number().nullable(),
  capabilities: model.json().nullable(),
  status: model.enum(["pending", "reviewing", "approved", "rejected", "changes_requested"]).default("pending"),
  metadata: model.json().nullable(),
});

export default Supplier;
