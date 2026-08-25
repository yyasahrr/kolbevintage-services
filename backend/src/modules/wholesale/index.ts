import { Module, MedusaService } from "@medusajs/framework/utils";
import { WholesaleAccount } from "./models/wholesale-account";
import { WholesaleOrder } from "./models/wholesale-order";
import { WholesaleOrderItem } from "./models/wholesale-order-item";
import { Rfq } from "./models/rfq";
import { Quote } from "./models/quote";
import { SupportTicket } from "./models/support-ticket";

export const WHOLESALE_MODULE = "wholesale";

export const WHOLESALE_MIN_UNITS = 12; // حداقل واحد هر سفارش عمده (ثابت دامنه)

/**
 * سرویس دامنه عمدهفروشی. منطقهای چندماژولی (رزرو موجودی، ساخت PO)
 * در src/lib/kolbe-flows.ts ترکیب میشوند - این سرویس دسترسی داده است.
 */
class WholesaleModuleService extends MedusaService({
  WholesaleAccount, WholesaleOrder, WholesaleOrderItem, Rfq, Quote, SupportTicket,
}) {
  /** حساب فعال VIP برای کاربر (یا null). */
  async getActiveAccount(userId: string) {
    const accounts = (await this.listWholesaleAccounts({ userId } as any)) as any[];
    const account = accounts[0];
    if (!account || account.status !== "approved") return null;
    if (account.expiresAt && new Date(account.expiresAt).getTime() <= Date.now()) return null;
    return account;
  }

  async listAccountOrders(accountId: string) {
    const orders = (await this.listWholesaleOrders({ accountId } as any)) as any[];
    return this.attachOrderItems(orders);
  }

  async listAllOrders() {
    const orders = (await this.listWholesaleOrders()) as any[];
    return this.attachOrderItems(orders);
  }

  async attachOrderItems(orders: any[]) {
    const items = (await this.listWholesaleOrderItems()) as any[];
    const byOrder = new Map<string, any[]>();
    for (const item of items) {
      if (!byOrder.has(item.orderId)) byOrder.set(item.orderId, []);
      byOrder.get(item.orderId)!.push({
        id: item.id, product_id: item.productId, variant_id: item.variantId,
        product_name: item.productName, sku: item.sku,
        quantity: item.quantity, unit_price: item.unitPrice,
      });
    }
    return orders
      .slice()
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .map((o) => ({
        id: o.id, order_code: o.orderCode, status: o.status, total_amount: o.totalAmount,
        total_units: o.totalUnits, created_at: o.createdAt, account_id: o.accountId,
        wholesale_order_items: byOrder.get(o.id) ?? [],
      }));
  }

  async getOrderWithItems(orderId: string) {
    const [order] = (await this.listWholesaleOrders({ id: orderId } as any)) as any[];
    if (!order) throw new Error("ORDER_NOT_FOUND");
    const [row] = await this.attachOrderItems([order]);
    return row;
  }
}

export default Module(WHOLESALE_MODULE, { service: WholesaleModuleService });
