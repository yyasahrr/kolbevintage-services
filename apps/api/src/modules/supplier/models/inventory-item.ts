import { model } from "@medusajs/framework/utils";

/** موجودی واریانت - معادل inventory (on_hand / reserved). */
const SupplierInventory = model.define("supplier_inventory", {
  id: model.id().primaryKey(),
  variantId: model.text().unique(),
  onHand: model.number().default(0),
  reserved: model.number().default(0),
});

export default SupplierInventory;
