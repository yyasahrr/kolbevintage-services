import { model } from "@medusajs/framework/utils";

/** درخواست عضویت تأمینکننده - ثبت عمومی و بررسی توسط ادمین کلبه. */
const SupplierApplication = model.define("supplier_application", {
  id: model.id().primaryKey(),
  userId: model.text().nullable(),
  companyName: model.text(),
  representativeName: model.text(),
  phone: model.text(),
  category: model.text(),
  monthlyCapacity: model.number().nullable(),
  status: model.enum(["pending", "reviewing", "approved", "rejected"]).default("pending"),
});

export default SupplierApplication;
