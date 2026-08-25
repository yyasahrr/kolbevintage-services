import { Module, MedusaService } from "@medusajs/framework/utils";
import { PurchaseOrder, PurchaseOrderItem } from "./models/purchase-order";

export const PURCHASE_ORDER_MODULE = "purchase_order";

/**
 * سرویس ماژول سفارش خرید؛ زنجیره تأمین (تأیید، آمادهسازی، ارسال، کد رهگیری)
 * بهصورت workflow در فاز ۴ مهاجرت پیادهسازی میشود (معادل RPCهای
 * update_supplier_purchase_order در Supabase).
 */
class PurchaseOrderModuleService extends MedusaService({
  PurchaseOrder,
  PurchaseOrderItem,
}) {}

export default Module(PURCHASE_ORDER_MODULE, {
  service: PurchaseOrderModuleService,
});
