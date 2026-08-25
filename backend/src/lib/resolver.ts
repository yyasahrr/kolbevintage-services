import type { MedusaContainer } from "@medusajs/framework";

/** دسترسی یکجا به سرویسهای دامنه کلبه. */
export function resolve(container: MedusaContainer) {
  return {
    account: container.resolve("account"),
    supplier: container.resolve("supplier"),
    wholesale: container.resolve("wholesale"),
    purchaseOrder: container.resolve("purchase_order"),
    retail: container.resolve("retail"),
  };
}
