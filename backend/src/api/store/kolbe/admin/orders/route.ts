import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { handler, ok, requireRole, svc } from "../../../../../lib/http";

/** لیست سفارشهای عمده + نام فروشگاه + POهای مرتبط (پنل عملیات ادمین). */
export const GET = handler(async (req: MedusaRequest, res: MedusaResponse) => {
  requireRole(req, "admin");
  const service = svc(req);
  const orders = await service.wholesale.listAllOrders();
  const accounts = (await service.wholesale.listWholesaleAccounts()) as any[];
  const suppliers = (await service.supplier.listSuppliers()) as any[];
  const pos = await service.purchaseOrder.listAllOrders();
  const accountById = new Map(accounts.map((a: any) => [a.id, a]));
  const supplierById = new Map(suppliers.map((s: any) => [s.id, s]));
  ok(res, {
    orders: orders.map((order: any) => {
      const account = accountById.get(order.account_id);
      return {
        ...order,
        store_name: account?.storeName ?? "—",
        purchase_orders: pos
          .filter((po: any) => po.wholesale_order_id === order.id)
          .map((po: any) => ({
            id: po.id, order_code: po.order_code, status: po.status,
            supplier_name: supplierById.get(po.supplier_id)?.displayName ?? "—",
            tracking_code: po.tracking_code,
          })),
      };
    }),
  });
});
