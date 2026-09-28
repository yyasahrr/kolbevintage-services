import { Inject, Injectable } from "@nestjs/common";
import { RetailOrdersService } from "../orders/retail/retail-orders.service";
import type { RetailOrderView } from "../orders/retail/retail-orders.contract";

export type GuestOrderResolution = {
  orderId: string;
  orderCode: string;
  order: RetailOrderView;
  shipping: { orderId: string; orderCode: string; shipments: Array<Record<string, unknown>> };
};

/**
 * Phase 5.9-A — guest order access. The capability secret is verified
 * inside the orders module (hash never leaves it); this service is the
 * policy seam where Checkpoint B adds operation scoping. In A the only
 * guest operation is `read`.
 */
@Injectable()
export class GuestOrderAccessService {
  constructor(@Inject(RetailOrdersService) private readonly retail: RetailOrdersService) {}

  assertGuestOperationAllowed(operation: string): void {
    if (operation !== "read") {
      throw new Error(`guest operation "${operation}" is not supported in this phase`);
    }
  }

  async resolveGuestOrder(orderCode: string, presentedToken: unknown): Promise<GuestOrderResolution> {
    this.assertGuestOperationAllowed("read");
    return this.retail.getRetailOrderAsGuest(orderCode, presentedToken);
  }
}
