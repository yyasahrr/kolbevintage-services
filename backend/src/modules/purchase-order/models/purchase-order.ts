import { model } from "@medusajs/framework/utils";

/**
 * سفارش خرید از تأمینکننده - معادل purchase_orders + purchase_order_items.
 * زنجیره وضعیت همان order_status فعلی حفظ شده است:
 * pending -> confirmed -> preparing -> shipped -> delivered (یا cancelled)
 */
export const PurchaseOrderItem = model.define("purchase_order_item", {
  id: model.id().primaryKey(),
  purchaseOrderId: model.text(),
  productName: model.text(),
  sku: model.text().nullable(),
  variantId: model.text().nullable(),
  quantity: model.number().default(1),
  unitPrice: model.number().default(0),
  totalAmount: model.number().default(0),
});

export const PurchaseOrder = model.define("purchase_order", {
  id: model.id().primaryKey(),
  orderCode: model.text().unique(),
  supplierId: model.text(),
  wholesaleOrderId: model.text().nullable(),
  status: model
    .enum(["pending", "confirmed", "preparing", "shipped", "delivered", "cancelled"])
    .default("pending"),
  dueDate: model.dateTime().nullable(),
  trackingCode: model.text().nullable(),
  totalAmount: model.number().default(0),
  currency: model.text().default("IRR"),
  notes: model.text().nullable(),
  shippedAt: model.dateTime().nullable(),
  deliveredAt: model.dateTime().nullable(),
});

export default PurchaseOrder;
