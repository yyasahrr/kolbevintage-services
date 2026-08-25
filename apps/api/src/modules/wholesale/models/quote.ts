import { model } from "@medusajs/framework/utils";

/** پیشنهاد قیمت روی RFQ - معادل quotes. */
export const Quote = model.define("quote", {
  id: model.id().primaryKey(),
  rfqId: model.text(),
  supplierId: model.text(),
  unitPrice: model.number().default(0),
  leadTimeDays: model.number().default(0),
  notes: model.text().nullable(),
  status: model.enum(["submitted", "accepted", "rejected"]).default("submitted"),
});
