import { Inject, Injectable } from "@nestjs/common";
import { RetailOrdersService } from "../orders/retail/retail-orders.service";
import type { RetailOrderView } from "../orders/retail/retail-orders.contract";

/**
 * Phase 5.9-A — order-history façade. Commerce data stays inside the
 * orders module: listing and detail both delegate to RetailOrdersService,
 * which enforces ownership by the session viewer. This seam exists so
 * after-sales (B/C) can extend history without touching commerce.
 */
@Injectable()
export class CustomerOrderHistoryService {
  constructor(@Inject(RetailOrdersService) private readonly retail: RetailOrdersService) {}

  async listOrders(
    userId: string,
    query: { limit?: unknown; cursor?: unknown },
  ): Promise<{ orders: Array<Record<string, unknown>>; nextCursor: string | null }> {
    return this.retail.listCustomerRetailOrders(userId, query);
  }

  async getOrderDetail(
    viewer: { userId: string; role: string },
    orderId: string,
  ): Promise<{
    order: RetailOrderView;
    shipping: { orderId: string; orderCode: string; shipments: Array<Record<string, unknown>> };
  }> {
    // Ownership is enforced inside getRetailOrder: any mismatch throws
    // RETAIL_ORDER_FORBIDDEN before shipments are touched.
    const order = await this.retail.getRetailOrder(viewer, orderId);
    const shipping = await this.retail.getRetailShipment(viewer, orderId);
    return { order, shipping };
  }
}
