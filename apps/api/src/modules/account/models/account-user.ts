import { model } from "@medusajs/framework/utils";

/** کاربر پلتفرم کلبه - یک هویت برای نقشهای مشتری، VIP، ادمین و ساپلایر. */
const AccountUser = model.define("account_user", {
  id: model.id().primaryKey(),
  email: model.text().unique(),
  passwordHash: model.text(),
  salt: model.text(),
  role: model.enum(["customer", "vip", "admin", "supplier"]).default("customer"),
  displayName: model.text().nullable(),
  phone: model.text().nullable(),
  status: model.text().default("active"),
});

export default AccountUser;
