import { Module, MedusaService } from "@medusajs/framework/utils";
import { PurchaseOrder, PurchaseOrderItem } from "./models/purchase-order";

export const PURCHASE_ORDER_MODULE = "purchase_order";

/** نقشه گذارهای مجاز وضعیت PO - معادل منطق update_supplier_purchase_order در Supabase. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export type PurchaseOrderRow = {
  id: string; order_code: string; status: string; supplier_id: string; wholesale_order_id: string | null;
  due_date: string | null; total_amount: number; tracking_code: string | null;
  shipped_at: string | null; delivered_at: string | null; created_at: string;
  purchase_order_items: Array<{ id: string; product_name: string; sku: string | null; quantity: number; unit_price: number }>;
};

class PurchaseOrderModuleService extends MedusaService({ PurchaseOrder, PurchaseOrderItem }) {
  async updateStatus(input: { orderId: string; status: "confirmed" | "preparing" | "shipped" | "delivered" | "cancelled"; trackingCode?: string | null }) {
    const [order] = (await this.listPurchaseOrders({ id: input.orderId } as any)) as any[];
    if (!order) throw new Error("ORDER_NOT_FOUND");
    const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(input.status)) throw new Error("INVALID_STATUS_TRANSITION");
    if (input.status === "shipped" && !(input.trackingCode?.trim())) throw new Error("TRACKING_CODE_REQUIRED");

    const patch: any = { id: order.id, status: input.status };
    if (input.status === "shipped") {
      patch.trackingCode = input.trackingCode!.trim();
      patch.shippedAt = new Date();
    }
    if (input.status === "delivered") patch.deliveredAt = new Date();
    await this.updatePurchaseOrders(patch);
    return { ...order, status: input.status };
  }

  async listSupplierOrders(supplierId: string): Promise<PurchaseOrderRow[]> {
    const orders = (await this.listPurchaseOrders({ supplierId } as any)) as any[];
    return this.attachItems(orders);
  }

  async listAllOrders(): Promise<PurchaseOrderRow[]> {
    const orders = (await this.listPurchaseOrders()) as any[];
    return this.attachItems(orders);
  }

  async listByWholesaleOrder(wholesaleOrderId: string): Promise<PurchaseOrderRow[]> {
    const orders = (await this.listPurchaseOrders({ wholesaleOrderId } as any)) as any[];
    return this.attachItems(orders);
  }

  async attachItems(orders: any[]): Promise<PurchaseOrderRow[]> {
    const items = (await this.listPurchaseOrderItems()) as any[];
    const byOrder = new Map<string, any[]>();
    for (const item of items) {
      if (!byOrder.has(item.purchaseOrderId)) byOrder.set(item.purchaseOrderId, []);
      byOrder.get(item.purchaseOrderId)!.push({
        id: item.id, product_name: item.productName, sku: item.sku, quantity: item.quantity, unit_price: item.unitPrice,
      });
    }
    const toIso = (d: any) => (d ? new Date(d).toISOString() : null);
    return orders
      .slice()
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .map((o) => ({
        id: o.id, order_code: o.orderCode, status: o.status, supplier_id: o.supplierId,
        wholesale_order_id: o.wholesaleOrderId ?? null, due_date: toIso(o.dueDate),
        total_amount: o.totalAmount ?? 0, tracking_code: o.trackingCode ?? null,
        shipped_at: toIso(o.shippedAt), delivered_at: toIso(o.deliveredAt),
        created_at: toIso(o.createdAt) ?? new Date().toISOString(),
        purchase_order_items: byOrder.get(o.id) ?? [],
      }));
  }
}

export default Module(PURCHASE_ORDER_MODULE, { service: PurchaseOrderModuleService });
