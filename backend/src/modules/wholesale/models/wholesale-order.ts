import { model } from "@medusajs/framework/utils";

/** سفارش عمده - معادل wholesale_orders. */
export const WholesaleOrder = model.define("wholesale_order", {
  id: model.id().primaryKey(),
  orderCode: model.text().unique(),
  accountId: model.text(),
  status: model.enum(["pending", "approved", "fulfilled", "cancelled"]).default("pending"),
  totalAmount: model.number().default(0),
  totalUnits: model.number().default(0),
});
