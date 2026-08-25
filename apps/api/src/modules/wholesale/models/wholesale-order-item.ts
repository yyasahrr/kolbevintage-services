import { model } from "@medusajs/framework/utils";

/** ردیف سفارش عمده - معادل wholesale_order_items. */
export const WholesaleOrderItem = model.define("wholesale_order_item", {
  id: model.id().primaryKey(),
  orderId: model.text(),
  productId: model.text(),
  variantId: model.text(),
  productName: model.text(),
  sku: model.text(),
  quantity: model.number().default(1),
  unitPrice: model.number().default(0),
});
