import { model } from "@medusajs/framework/utils";

/**
 * مدل سفارش خرید از تأمینکننده - معادل purchase_orders + purchase_order_items
 * در اسکیمای فعلی Supabase. زنجیره وضعیت همان order_status فعلی حفظ شده است:
 * pending -> confirmed -> preparing -> shipped -> delivered (یا cancelled)
 */
const PurchaseOrderItem = model.define("purchase_order_item", {
  id: model.id().primaryKey(),
  productName: model.text(),
  sku: model.text().nullable(),
  quantity: model.number().default(1),
  unitAmount: model.number().nullable(),
  totalAmount: model.number().nullable(),
});

const PurchaseOrder = model.define("purchase_order", {
  id: model.id().primaryKey(),
  orderCode: model.text().unique(),
  supplierId: model.text(),
  status: model
    .enum("order_status", [
      "pending",
      "confirmed",
      "preparing",
      "shipped",
      "delivered",
      "cancelled",
    ])
    .default("pending"),
  dueDate: model.date().nullable(),
  trackingCode: model.text().nullable(),
  totalAmount: model.number().nullable(),
  currency: model.text().default("IRR"),
  notes: model.text().nullable(),
  items: model.hasMany(() => PurchaseOrderItem),
});

export { PurchaseOrderItem, PurchaseOrder };
export default PurchaseOrder;
