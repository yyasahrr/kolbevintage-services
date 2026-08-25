import { Module, MedusaService } from "@medusajs/framework/utils";
import RetailOrder from "./models/retail-order";

class RetailModuleService extends MedusaService({ RetailOrder }) {}

export default Module("retail", { service: RetailModuleService });
