import { model } from "@medusajs/framework/utils";

/** محصول تأمینکننده در بازار عمده - معادل supplier_products. */
const SupplierProduct = model.define("supplier_product", {
  id: model.id().primaryKey(),
  supplierId: model.text(),
  name: model.text(),
  sku: model.text().unique(),
  category: model.text(),
  description: model.text().default(""),
  wholesalePrice: model.number().default(0),
  imageUrl: model.text().nullable(),
  status: model.enum(["draft", "submitted", "approved", "changes_requested", "rejected"]).default("draft"),
});

export default SupplierProduct;
