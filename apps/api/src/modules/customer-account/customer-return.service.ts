import { Inject, Injectable } from "@nestjs/common";
import { RetailReturnsService } from "../orders/retail/retail-returns.service";
import type { RetailReturnView } from "../orders/retail/retail-orders.contract";

/**
 * Phase 5.9-B — return façade. The return aggregate stays inside the
 * orders module (filing gates, quantity math, restock, support linkage);
 * this seam shapes the customer HTTP surface and will carry Checkpoint C
 * refund surfacing without touching commerce.
 */
@Injectable()
export class CustomerReturnService {
  constructor(@Inject(RetailReturnsService) private readonly returns: RetailReturnsService) {}

  async fileReturn(
    actor: { actorId: string; actorRole: string },
    orderId: string,
    input: { lines?: unknown; reason?: unknown; note?: unknown },
  ): Promise<RetailReturnView> {
    return this.returns.fileRetailReturn({ actorId: actor.actorId, actorRole: actor.actorRole }, orderId, input);
  }

  async listReturns(
    customerId: string,
    query: { limit?: unknown; cursor?: unknown },
  ): Promise<{ returns: Array<Record<string, unknown>>; nextCursor: string | null }> {
    return this.returns.listCustomerRetailReturns(customerId, query);
  }

  async getReturnDetail(viewer: { userId: string; role: string }, returnId: string): Promise<RetailReturnView> {
    return this.returns.getRetailReturn(viewer, returnId);
  }

  async withdrawReturn(actor: { actorId: string; actorRole: string }, returnId: string): Promise<RetailReturnView> {
    return this.returns.withdrawRetailReturn({ actorId: actor.actorId, actorRole: actor.actorRole }, returnId);
  }
}
