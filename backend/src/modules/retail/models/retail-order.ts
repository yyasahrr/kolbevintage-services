import { model } from "@medusajs/framework/utils";

/**
 * سفارش خردهفروشی - برای اولین بار سفارشهای فروشگاه واقعاً ذخیره میشوند.
 * در فاز ۲ (طبق ADR-001) این ماژول با Cart/Order بومی مدوسا ادغام میشود.
 */
export const RetailOrder = model.define("retail_order", {
  id: model.id().primaryKey(),
  orderCode: model.text().unique(),
  customerName: model.text(),
  phone: model.text(),
  email: model.text().nullable(),
  lines: model.json().default([]),
  address: model.json().default({}),
  shippingMethod: model.text().default("post"),
  shippingPrice: model.number().default(0),
  payMethod: model.text().default("gateway"),
  totalAmount: model.number().default(0),
  paymentStatus: model.text().default("pending_gateway"),
  fulfillmentStatus: model.text().default("processing"),
});

export default RetailOrder;
