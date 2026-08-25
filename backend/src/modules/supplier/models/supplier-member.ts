import { model } from "@medusajs/framework/utils";

/** عضو تیم تأمینکننده با دسترسی ورود به پنل ساپلایر. userId به account_user اشاره میکند. */
const SupplierMember = model.define("supplier_member", {
  id: model.id().primaryKey(),
  supplierId: model.text(),
  userId: model.text(),
  title: model.text().default("عضو تیم"),
});

export default SupplierMember;
