import { Controller, Get, Post, Param, Body, Query, Req, Inject, Logger } from "@nestjs/common";
import { PaymentProviderRegistry } from "./payment-provider.registry";
import { PaymentProviderEventService } from "./payment-provider-event.service";
import { PaymentsService } from "./payments.service";

@Controller("payments/providers")
export class PaymentProviderController {
  private readonly logger = new Logger(PaymentProviderController.name);

  constructor(
    @Inject(PaymentProviderRegistry) private readonly registry: PaymentProviderRegistry,
    @Inject(PaymentProviderEventService) private readonly eventService: PaymentProviderEventService,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
  ) {}

  @Get(":provider/callback")
  async callback(@Param("provider") provider: string, @Query() query: any) {
    this.logger.log(`Callback received for provider ${provider} query=${JSON.stringify({ authorityPresent: !!(query.authority || query.Authority || query.ref), status: query.status || query.Status })}`);
    return {
      provider,
      message: "Callback received, verification will be performed via webhook or reconciliation",
      authorityPresent: !!(query.authority || query.Authority || query.ref || query.Ref || query.paymentId),
      status: query.status || query.Status || "unknown",
    };
  }

  @Post(":provider/webhook")
  async webhook(@Param("provider") provider: string, @Body() body: any) {
    const externalEventId = body?.externalEventId || body?.eventId || body?.id || body?.authority || `evt_${Date.now()}`;
    const externalPaymentRef = body?.externalPaymentRef || body?.authority || body?.paymentId || body?.ref || null;
    const eventType = body?.eventType || body?.type || "payment.updated";

    const inboxResult = await this.eventService.recordEvent({
      provider,
      externalEventId,
      externalPaymentReference: externalPaymentRef,
      eventType,
      safeMetadata: body,
    } as any);

    if (inboxResult.isDuplicate) {
      this.logger.log(`Duplicate webhook event provider=${provider} externalEventId=${externalEventId} status=${inboxResult.existingStatus}`);
      return { received: true, duplicate: true, id: inboxResult.id };
    }

    try {
      const adapter = this.registry.resolve(provider);
      if (externalPaymentRef) {
        const verification = await adapter.queryStatus({ paymentId: body?.paymentId || externalPaymentRef, providerReference: externalPaymentRef } as any);
        this.logger.log(`Webhook verification provider=${provider} ref present state=${(verification as any).state || (verification as any).status}`);
        try {
          const payment = await this.paymentsService.findByProviderReference(externalPaymentRef);
          if (payment) this.logger.log(`Webhook attempting canonical verification for payment ${payment.id}`);
        } catch (e: any) {
          this.logger.warn(`Webhook payment lookup failed: ${e.message}`);
        }
      }
      await this.eventService.markProcessed(inboxResult.id, provider);
    } catch (e: any) {
      this.logger.warn(`Webhook processing failed provider=${provider} event=${externalEventId}: ${e.message}`);
      await this.eventService.markFailed(inboxResult.id, e.message);
    }

    return { received: true, duplicate: false, id: inboxResult.id };
  }
}
