import { Inject, Injectable } from "@nestjs/common";
import { ForbiddenError } from "@kolbe/shared";
import { RetailOrdersService } from "../orders/retail/retail-orders.service";
import { RetailReturnsService } from "../orders/retail/retail-returns.service";
import { PaymentsService } from "../payments/payments.service";
import { SupportCaseService } from "../support/support-case.service";
import { CustomerAccountService } from "./customer-account.service";

/**
 * Phase 5.11-A — retail customer operator view (admin-only read seam).
 *
 * Composition only: identity comes from the redacted profile façade
 * (no password hash, salt, TOTP secret, or capability hash can cross —
 * `getCustomerProfile` selects the six safe columns), commerce pages
 * come from the owner list seams scoped by the target customer id,
 * refunds attach to the returned orders page (deep paging lives on
 * the dedicated refunds queue), and support relations are slimmed to
 * case headers (messages stay on the support admin surface).
 * Unknown customers 404 with the profile code; the HTTP guard runs
 * first, so the 404 is not a cross-role oracle.
 */
@Injectable()
export class CustomerOperatorViewService {
  constructor(
    @Inject(CustomerAccountService) private readonly account: CustomerAccountService,
    @Inject(RetailOrdersService) private readonly retail: RetailOrdersService,
    @Inject(RetailReturnsService) private readonly returns: RetailReturnsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(SupportCaseService) private readonly cases: SupportCaseService,
  ) {}

  private clampLimit(limit: unknown): number {
    const parsed = typeof limit === "string" && limit !== "" ? Number(limit) : (limit as number);
    if (!Number.isSafeInteger(parsed)) return 10;
    return Math.min(Math.max(parsed, 1), 50);
  }

  async getRetailCustomerForStaff(
    actor: { actorId: string | null; actorRole: string },
    userId: string,
    query: { limit?: unknown; ordersCursor?: unknown; returnsCursor?: unknown } = {},
  ): Promise<Record<string, unknown>> {
    if (actor.actorRole !== "admin" || !actor.actorId) {
      throw new ForbiddenError("FORBIDDEN", "retail customer view is admin-only");
    }
    const customer = await this.account.getProfile(userId);
    const limit = this.clampLimit(query.limit);
    const orders = await this.retail.listCustomerRetailOrders(userId, { limit, cursor: query.ordersCursor });
    const returns = await this.returns.listCustomerRetailReturns(userId, { limit, cursor: query.returnsCursor });
    const orderIds = orders.orders.map((o) => o.id as string);
    const refunds = await this.payments.listRetailRefundsForStaff({ limit, retailOrderIds: orderIds });
    const support = await this.cases.listCases({ requesterUserId: userId, limit });
    return {
      customer,
      orders: orders.orders,
      ordersNextCursor: orders.nextCursor,
      returns: returns.returns,
      returnsNextCursor: returns.nextCursor,
      refunds: refunds.refunds,
      refundsNextCursor: refunds.nextCursor,
      supportCases: (support.cases as any[]).map((c: any) => ({
        id: c.id,
        publicReference: c.publicReference,
        category: c.category,
        subject: c.subject,
        priority: c.priority,
        status: c.status,
        openedAt: c.openedAt,
        resolvedAt: c.resolvedAt ?? null,
        closedAt: c.closedAt ?? null,
      })),
      supportTotal: support.total,
    };
  }
}
