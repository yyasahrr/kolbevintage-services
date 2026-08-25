import { model } from "@medusajs/framework/utils";

/** واریانت محصول - معادل product_variants. */
const SupplierVariant = model.define("supplier_variant", {
  id: model.id().primaryKey(),
  productId: model.text(),
  sku: model.text().unique(),
  color: model.text().default("بدون رنگ"),
  colorHex: model.text().nullable(),
  size: model.text().default("تک‌سایز"),
  cost: model.number().default(0),
});

export default SupplierVariant;
