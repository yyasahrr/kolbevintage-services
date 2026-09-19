import { Inject, Injectable, Logger } from "@nestjs/common";
import { JobLockService, type LockExecutionResult } from "./job-lock.service";
import { InventoryService } from "../inventory/inventory.service";
import { ShippingService } from "../shipping/shipping.service";
import { PaymentsService } from "../payments/payments.service";
import { PaymentProviderEventService } from "../payments/payment-provider-event.service";
import { SettlementService } from "../settlement/settlement.service";
import { AuditService } from "../audit/audit.service";

export interface InventoryHoldCleanupResult {
  releasedCount: number;
  reservations: Array<{
    id: string;
    variantId: string;
    quantity: number;
    status: string;
  }>;
}

export interface ShippingRecoveryResult {
  reclaimedEventsCount: number;
  pendingShipmentsCount: number;
  pendingShipments: Array<{
    id: string;
    status: string;
    provider: string;
  }>;
}

export interface PaymentsRecoveryResult {
  reclaimedEventsCount: number;
  unresolvedPaymentsCount: number;
  unresolvedPayments: Array<{
    id: string;
    paymentReference: string;
    provider: string;
    status: string;
  }>;
}

export interface SettlementRecoveryResult {
  payoutReconciliation: {
    runId: string;
    scannedCount: number;
    resolvedCount: number;
  };
  projectionReconciliation: {
    runId: string;
    status: string;
    discrepancyCount: number;
    summary: Record<string, unknown>;
  };
}

export interface FullRecoverySummary {
  timestamp: string;
  inventory: LockExecutionResult<InventoryHoldCleanupResult> | { executed: false; error: string };
  shipping: LockExecutionResult<ShippingRecoveryResult> | { executed: false; error: string };
  payments: LockExecutionResult<PaymentsRecoveryResult> | { executed: false; error: string };
  settlement: LockExecutionResult<SettlementRecoveryResult> | { executed: false; error: string };
  allSuccessful: boolean;
}

/**
 * Phase 4.9 Checkpoint B — Production Recovery & Disaster Recovery Orchestrator.
 *
 * Coordinates reliability routines across domain boundaries under strict
 * advisory locks:
 *  - Inventory: expired hold cleanup & stock release.
 *  - Shipping: stale carrier event reclamation & pending dispatch scans.
 *  - Payments: stale webhook reclamation & unconfirmed payment sweeps.
 *  - Settlement: periodic settlement projection & payout reconciliation sweeps.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    @Inject(JobLockService) private readonly jobLock: JobLockService,
    @Inject(InventoryService) private readonly inventoryService: InventoryService,
    @Inject(ShippingService) private readonly shippingService: ShippingService,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(PaymentProviderEventService)
    private readonly paymentEventService: PaymentProviderEventService,
    @Inject(SettlementService) private readonly settlementService: SettlementService,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  /**
   * 1. Inventory Recovery: Expired hold cleanup & release held stock.
   */
  async runInventoryHoldCleanup(options?: {
    limit?: number;
    actorId?: string;
  }): Promise<LockExecutionResult<InventoryHoldCleanupResult>> {
    return this.jobLock.withSessionLock("job:recovery:inventory_holds", async () => {
      const limit = options?.limit ?? 100;
      const actorId = options?.actorId ?? "system";
      this.logger.log(`Starting inventory hold cleanup (limit=${limit}, actorId=${actorId})...`);

      const released = await this.inventoryService.releaseExpiredReservations(limit, actorId);
      this.logger.log(`Inventory hold cleanup completed; released=${released.length}`);

      if (released.length > 0) {
        await this.auditService.record({
          actorId: "system",
          actorRole: "system",
          action: "recovery.inventory_hold_cleanup",
          entityType: "recovery_job",
          entityId: "inventory_holds",
          metadata: { releasedCount: released.length, limit },
        });
      }

      return {
        releasedCount: released.length,
        reservations: released.map((r: any) => ({
          id: r.id,
          variantId: r.variantId,
          quantity: r.quantity,
          status: r.status,
        })),
      };
    });
  }

  /**
   * 2. Shipping Recovery: Stale carrier event reclamation & pending dispatch sweeps.
   */
  async runShippingRecovery(options?: {
    staleMinutes?: number;
    limit?: number;
  }): Promise<LockExecutionResult<ShippingRecoveryResult>> {
    return this.jobLock.withSessionLock("job:recovery:shipping_events", async () => {
      const staleMinutes = options?.staleMinutes ?? 15;
      const limit = options?.limit ?? 50;
      this.logger.log(
        `Starting shipping recovery (staleMinutes=${staleMinutes}, limit=${limit})...`,
      );

      const reclaimedEventsCount =
        await this.shippingService.reclaimStaleProcessingEvents(staleMinutes);

      const pendingShipments =
        await this.shippingService.findShipmentsNeedingReconciliation({
          provider: "fake",
          limit,
          pendingOlderThanSeconds: 300,
        });

      this.logger.log(
        `Shipping recovery completed; reclaimedEvents=${reclaimedEventsCount}, pendingShipments=${pendingShipments.length}`,
      );

      if (reclaimedEventsCount > 0 || pendingShipments.length > 0) {
        await this.auditService.record({
          actorId: "system",
          actorRole: "system",
          action: "recovery.shipping_events",
          entityType: "recovery_job",
          entityId: "shipping_recovery",
          metadata: {
            reclaimedEventsCount,
            pendingShipmentsCount: pendingShipments.length,
          },
        });
      }

      return {
        reclaimedEventsCount,
        pendingShipmentsCount: pendingShipments.length,
        pendingShipments: pendingShipments.map((s: any) => ({
          id: s.id,
          status: s.status,
          provider: s.provider,
        })),
      };
    });
  }

  /**
   * 3. Payments Recovery: Stale webhook reclamation & unconfirmed payment reconciliation sweeps.
   */
  async runPaymentsRecovery(options?: {
    staleMinutes?: number;
    limit?: number;
  }): Promise<LockExecutionResult<PaymentsRecoveryResult>> {
    return this.jobLock.withSessionLock("job:recovery:payments", async () => {
      const staleMinutes = options?.staleMinutes ?? 15;
      const limit = options?.limit ?? 50;
      this.logger.log(
        `Starting payments recovery (staleMinutes=${staleMinutes}, limit=${limit})...`,
      );

      const reclaimedEventsCount =
        await this.paymentEventService.reclaimStaleProcessing(staleMinutes);

      const unresolvedPayments =
        await this.paymentsService.listUnresolvedProviderPayments(limit);

      this.logger.log(
        `Payments recovery completed; reclaimedEvents=${reclaimedEventsCount}, unresolvedPayments=${unresolvedPayments.length}`,
      );

      if (reclaimedEventsCount > 0 || unresolvedPayments.length > 0) {
        await this.auditService.record({
          actorId: "system",
          actorRole: "system",
          action: "recovery.payments",
          entityType: "recovery_job",
          entityId: "payments_recovery",
          metadata: {
            reclaimedEventsCount,
            unresolvedPaymentsCount: unresolvedPayments.length,
          },
        });
      }

      return {
        reclaimedEventsCount,
        unresolvedPaymentsCount: unresolvedPayments.length,
        unresolvedPayments: unresolvedPayments.map((p: any) => ({
          id: p.id,
          paymentReference: p.payment_reference,
          provider: p.provider,
          status: p.status,
        })),
      };
    });
  }

  /**
   * 4. Settlement Recovery: Periodic payout status reconciliation & balance projection sweeps.
   */
  async runSettlementRecovery(options?: {
    olderThanMinutes?: number;
    supplierId?: string;
    actorId?: string;
  }): Promise<LockExecutionResult<SettlementRecoveryResult>> {
    return this.jobLock.withSessionLock("job:recovery:settlement", async () => {
      const maxAgeMinutes = options?.olderThanMinutes ?? 30;
      const actorId = options?.actorId ?? "user_system";
      this.logger.log(
        `Starting settlement recovery (maxAgeMinutes=${maxAgeMinutes}, actorId=${actorId})...`,
      );

      const payoutReconciliation =
        await this.settlementService.reconcileProcessingPayouts({
          maxAgeMinutes,
          triggeredBy: actorId,
        });

      const projectionReconciliation =
        await this.settlementService.reconcileSettlementProjection(
          options?.supplierId,
          actorId,
        );

      this.logger.log(
        `Settlement recovery completed; payoutScanned=${payoutReconciliation.scannedCount}, payoutResolved=${payoutReconciliation.resolvedCount}, projectionStatus=${projectionReconciliation.status}`,
      );

      if (
        payoutReconciliation.resolvedCount > 0 ||
        projectionReconciliation.discrepancyCount > 0
      ) {
        await this.auditService.record({
          actorId: "system",
          actorRole: "system",
          action: "recovery.settlement",
          entityType: "recovery_job",
          entityId: "settlement_recovery",
          metadata: {
            payoutReconciliation,
            projectionReconciliation: {
              status: projectionReconciliation.status,
              discrepancyCount: projectionReconciliation.discrepancyCount,
            },
          },
        });
      }

      return {
        payoutReconciliation,
        projectionReconciliation,
      };
    });
  }

  /**
   * Executes all four recovery domains sequentially under their isolated locks.
   * Isolates errors so failure in one domain does not prevent others from running.
   */
  async runAll(options?: { actorId?: string }): Promise<FullRecoverySummary> {
    const timestamp = new Date().toISOString();
    let inventoryResult: any;
    let shippingResult: any;
    let paymentsResult: any;
    let settlementResult: any;
    let allSuccessful = true;

    try {
      inventoryResult = await this.runInventoryHoldCleanup({ actorId: options?.actorId });
    } catch (err: any) {
      allSuccessful = false;
      this.logger.error(`Inventory recovery failed: ${err?.message || err}`);
      inventoryResult = { executed: false, error: String(err?.message || err) };
    }

    try {
      shippingResult = await this.runShippingRecovery();
    } catch (err: any) {
      allSuccessful = false;
      this.logger.error(`Shipping recovery failed: ${err?.message || err}`);
      shippingResult = { executed: false, error: String(err?.message || err) };
    }

    try {
      paymentsResult = await this.runPaymentsRecovery();
    } catch (err: any) {
      allSuccessful = false;
      this.logger.error(`Payments recovery failed: ${err?.message || err}`);
      paymentsResult = { executed: false, error: String(err?.message || err) };
    }

    try {
      settlementResult = await this.runSettlementRecovery({ actorId: options?.actorId });
    } catch (err: any) {
      allSuccessful = false;
      this.logger.error(`Settlement recovery failed: ${err?.message || err}`);
      settlementResult = { executed: false, error: String(err?.message || err) };
    }

    return {
      timestamp,
      inventory: inventoryResult,
      shipping: shippingResult,
      payments: paymentsResult,
      settlement: settlementResult,
      allSuccessful,
    };
  }
}
