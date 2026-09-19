import { Injectable, Inject, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { PaymentProviderRegistry } from "./payment-provider.registry";
import { PaymentProviderEventService } from "./payment-provider-event.service";
import { PaymentsService } from "./payments.service";

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly providerEventService: PaymentProviderEventService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async reconcileUnresolved(limit = 20): Promise<{ reconciled: number; failed: number }> {
    const result = await (this.db as any).execute(sql`
      SELECT id, payment_reference, provider, provider_reference, external_reference, amount, currency, status, provider_state
      FROM payment
      WHERE status IN ('pending','evidence_submitted')
        AND provider != 'manual'
      ORDER BY created_at ASC
      LIMIT ${limit}
    `);
    const rows = (result as any).rows || [];
    let reconciled = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const provider = this.providerRegistry.resolve(row.provider);
        const statusQuery = await provider.queryStatus({
          paymentId: row.id,
          providerReference: row.provider_reference || row.external_reference,
        });

        this.logger.log(`Reconciling payment ${row.id} provider ${row.provider} state ${(statusQuery as any).state || (statusQuery as any).status}`);

        const state = (statusQuery as any).state || (statusQuery as any).status;
        if (state === "success") {
          await this.paymentsService.verifyPayment({
            paymentId: row.id,
            adminUserId: "system-reconciliation",
            expectedVersion: undefined,
            externalReference: (statusQuery as any).providerReference || row.provider_reference || row.external_reference || `reconcile-${row.id}`,
            idempotencyKey: `reconcile-${row.id}-${Date.now()}`,
            actorRole: "system",
          });
          reconciled++;
        } else if (state === "failed") {
          await this.paymentsService.rejectPayment({
            paymentId: row.id,
            adminUserId: "system-reconciliation",
            reason: "reconciliation_failed",
            idempotencyKey: `reconcile-fail-${row.id}-${Date.now()}`,
            actorRole: "system",
          });
          failed++;
        }
      } catch (e: any) {
        this.logger.warn(`Reconciliation failed for payment ${row.id}: ${e.message}`);
        failed++;
      }
    }

    const unresolvedEvents = await this.providerEventService.findUnresolvedEvents(limit);
    for (const ev of unresolvedEvents) {
      try {
        await this.providerEventService.markProcessing(ev.id);
        if (ev.event_type === "payment.success" && ev.external_payment_ref) {
          const paymentResult = await (this.db as any).execute(sql`
            SELECT id FROM payment WHERE provider_reference = ${ev.external_payment_ref} OR external_reference = ${ev.external_payment_ref} OR payment_reference = ${ev.external_payment_ref} LIMIT 1
          `);
          const paymentRow = (paymentResult as any).rows?.[0];
          if (paymentRow) {
            try {
              await this.paymentsService.verifyPayment({
                paymentId: paymentRow.id,
                adminUserId: "system-reconciliation-event",
                externalReference: ev.external_payment_ref || `event-${ev.id}`,
                idempotencyKey: `reconcile-event-${ev.id}`,
                actorRole: "system",
              });
            } catch (err: any) {
              if (!err.message?.includes("already") && !err.message?.includes("replayed")) throw err;
            }
          }
        }
        await this.providerEventService.markProcessed(ev.id);
        reconciled++;
      } catch (e: any) {
        await this.providerEventService.markFailed(ev.id, e.message);
        failed++;
      }
    }

    return { reconciled, failed };
  }
}
