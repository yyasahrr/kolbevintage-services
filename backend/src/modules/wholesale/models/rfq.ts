import { model } from "@medusajs/framework/utils";

/** درخواست تأمین (RFQ) - معادل rfqs. */
export const Rfq = model.define("rfq", {
  id: model.id().primaryKey(),
  supplierId: model.text(),
  referenceCode: model.text().unique(),
  title: model.text(),
  customerName: model.text(),
  quantity: model.number().default(0),
  requestedDeliveryDate: model.dateTime().nullable(),
  specifications: model.json().nullable(),
  status: model.enum(["open", "quoted", "closed"]).default("open"),
});
