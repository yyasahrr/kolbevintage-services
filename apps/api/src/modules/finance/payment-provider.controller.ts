import { Controller, Get, Post, Param, Body, Query, Headers, Inject, HttpCode } from "@nestjs/common";
import { Public, Roles, CurrentUser } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { PaymentProviderOrchestrator } from "./payment-provider.orchestrator";

/**
 * Phase 4.7.1 — provider-facing payment endpoints.
 *
 * Both routes are `@Public()` because the caller is the gateway, not a session:
 * authenticity is established by the provider adapter (`parseWebhook` — shared
 * secret / signature), never by a cookie. Nothing here verifies a payment by
 * itself: the callback is informational (A7) and the webhook is only a trigger
 * for the canonical, provider-authoritative path (A1).
 */
@Controller("payments/providers")
export class PaymentProviderController {
  constructor(@Inject(PaymentProviderOrchestrator) private readonly orchestrator: PaymentProviderOrchestrator) {}

  @Public()
  @Get(":provider/callback")
  async callback(@Param("provider") provider: string, @Query() query: Record<string, unknown>) {
    return this.orchestrator.describeCallback(provider, query || {});
  }

  @Public()
  @Post(":provider/webhook")
  @HttpCode(200)
  async webhook(@Param("provider") provider: string, @Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    const result = await this.orchestrator.ingestWebhook({ provider, request: { headers: headers || {}, body } });
    // Never echo payload or references back to the caller.
    return {
      received: true,
      duplicate: result.duplicate,
      eventId: result.outcome.eventId,
      status: result.outcome.status,
    };
  }

  /** B18/A8 — operator-triggered reconciliation (also suitable for a scheduler). */
  @Post("reconcile")
  @Roles("admin", "finance")
  @HttpCode(200)
  async reconcile(@CurrentUser() _claims: Claims, @Body() body: { limit?: number; staleProcessingMinutes?: number } = {}) {
    return this.orchestrator.reconcile({ limit: body?.limit, staleProcessingMinutes: body?.staleProcessingMinutes });
  }
}
