import { Module, MedusaService } from "@medusajs/framework/utils";
import Supplier from "./models/supplier";

export const SUPPLIER_MODULE = "supplier";

/**
 * سرویس ماژول ساپلایر؛ CRUD پایه توسط MedusaService تولید میشود.
 * متدهای دامنه (تأیید عضویت، نسبت دادن محصول به ساپلایر) در فاز ۳ اضافه میشوند.
 */
class SupplierModuleService extends MedusaService({ Supplier }) {}

export default Module(SUPPLIER_MODULE, {
  service: SupplierModuleService,
});
