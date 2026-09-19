import { Injectable, Inject } from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { PaymentsService } from "../payments/payments.service";
import { OrdersService } from "../orders/orders.service";
import { DomainError } from "@kolbe/shared";
import { createHash, randomUUID } from "node:crypto";

function hashRequest(input: unknown): string {
  const canonical = JSON.stringify(input, (key, val) => {
    if (typeof val === "bigint") return val.toString();
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: any = {};
      Object.keys(val).sort().forEach((k) => (sorted[k] = (val as any)[k]));
      return sorted;
    }
    return val;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export class FinanceOrchestratorError extends DomainError {
  constructor(code: string, message: string, status = 400) {
    if (code === "ORDER_NOT_FOUND") status = 404;
    else if (code === "ORDER_OWNERSHIP_VIOLATION") status = 403;
    else if (code === "IDEMPOTENCY_KEY_REUSED" || code === "INVALID_STATUS_TRANSITION") status = 409;
    super(status, code, message);
    this.name = "FinanceOrchestratorError";
  }
}

/**
 * WholesaleFinanceOrchestrator owns NO tables, coordinates via OrdersService and PaymentsService with same tx executor, shared tx.
 */
@Injectable()
export class WholesaleFinanceOrchestrator {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async confirmOrder(input: {
    orderId: string;
    buyerUserId: string;
    expectedVersion?: number;
    idempotencyKey: string;
    actorRole?: string;
  }) {
    if (!input.idempotencyKey) throw new FinanceOrchestratorError("ORDER_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    return this.db.transaction(async (tx: any) => {
      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ orderId: input.orderId, action: "confirm" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wOrder"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "orders.confirm"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceOrchestratorError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with different payload", 409);
        if (existingIdem.state === "completed") {
          const order = await this.ordersService.getWholesaleOrderById(input.orderId, tx);
          return { order, replayed: true };
        }
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "wOrder",
          scopeId: input.orderId,
          commandType: "orders.confirm",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: await this.ordersService.getDbNow(tx),
          updatedAt: await this.ordersService.getDbNow(tx),
        });
      }

      const confirmResult = await this.ordersService.transitionToConfirmed({
        orderId: input.orderId,
        buyerUserId: input.buyerUserId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        executor: tx,
      });
      if (confirmResult.replayed) {
        return { order: confirmResult.order, replayed: true };
      }

      const snapshot = await this.ordersService.getOrderFinancialSnapshot(input.orderId, tx);

      const { proformas } = await this.paymentsService.issueProformasFromSnapshot(snapshot, tx);

      for (const prof of proformas) {
        await this.ordersService.recordProformaIssued({
          orderId: input.orderId,
          proformaId: prof.id,
          childOrderId: prof.childOrderId,
          totalAmount: (prof.totalAmount || 0).toString(),
          actorId: input.buyerUserId,
          executor: tx,
        });
      }

      const payable = proformas.reduce((s: bigint, p: any) => s + BigInt(p.totalAmount || 0), 0n).toString();
      const gated = await this.ordersService.markAwaitingPayment({
        orderId: input.orderId,
        buyerUserId: input.buyerUserId,
        proformaCount: proformas.length,
        payable,
        executor: tx,
      });

      await this.auditService.record(
        {
          actorId: input.buyerUserId,
          actorRole: input.actorRole || "buyer",
          action: "order.confirmed",
          entityType: "wOrder",
          entityId: input.orderId,
          before: { status: confirmResult.previousStatus },
          after: { status: "awaiting_payment", proformaCount: proformas.length },
          metadata: { idempotencyKey: input.idempotencyKey },
        },
        tx,
      );

      const now = await this.ordersService.getDbNow(tx);
      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: gated.id, resultPayload: { id: gated.id, status: gated.status } as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "wOrder"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "orders.confirm"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { order: gated, proformas, replayed: false };
    });
  }

  async submitTransfer(input: {
    orderId: string;
    buyerUserId: string;
    amount: string;
    bankReference?: string;
    evidenceReference?: string;
    idempotencyKey: string;
    actorRole?: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      await this.ordersService.validateAndLockForPaymentSubmission({
        orderId: input.orderId,
        buyerUserId: input.buyerUserId,
        executor: tx,
      });

      const result = await this.paymentsService.submitTransferPayment({
        orderId: input.orderId,
        buyerUserId: input.buyerUserId,
        amount: input.amount,
        bankReference: input.bankReference,
        evidenceReference: input.evidenceReference,
        idempotencyKey: input.idempotencyKey,
        actorRole: input.actorRole,
        executor: tx,
      });

      if (!result.replayed) {
        await this.ordersService.recordPaymentEvidenceSubmitted({
          orderId: input.orderId,
          paymentId: result.payment.id,
          amount: input.amount,
          currency: result.payment.currency,
          actorId: input.buyerUserId,
          idempotencyKey: input.idempotencyKey,
          executor: tx,
        });
      }

      return result;
    });
  }

  async verifyPayment(input: {
    paymentId: string;
    adminUserId: string;
    expectedVersion?: number;
    externalReference: string;
    idempotencyKey: string;
    actorRole?: string;
    reason?: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      const verifyResult = await this.paymentsService.verifyPayment({
        paymentId: input.paymentId,
        adminUserId: input.adminUserId,
        expectedVersion: input.expectedVersion,
        externalReference: input.externalReference,
        idempotencyKey: input.idempotencyKey,
        actorRole: input.actorRole,
        reason: input.reason,
        executor: tx,
      });

      if (verifyResult.replayed) {
        return verifyResult;
      }

      const orderId = verifyResult.payment.wholesaleOrderId || verifyResult.payment.wholesale_order_id;

      await this.ordersService.recordPaymentVerified({
        orderId,
        paymentId: input.paymentId,
        amount: (verifyResult.payment.amount || 0).toString(),
        currency: verifyResult.payment.currency,
        allocations: verifyResult.allocations.map((a: any) => ({ proformaId: a.proformaId, amount: (a.amount || 0).toString() })),
        actorId: input.adminUserId,
        idempotencyKey: input.idempotencyKey,
        executor: tx,
      });

      const coverage = await this.paymentsService.getFinancialCoverageStatus(orderId, tx);

      let release: any = null;
      let releasedOrder: any = null;
      if (coverage.isFullyCovered) {
        const releaseResult = await this.paymentsService.createFinancialRelease({
          orderId,
          releaseType: "payment_verified",
          evidenceReference: `payments_verified_${coverage.allocated.toString()}`,
          amount: coverage.payable.toString(),
          currency: verifyResult.payment.currency,
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          reason: `Payable ${coverage.payable.toString()} covered by allocated ${coverage.allocated.toString()}`,
          executor: tx,
        });

        if (!releaseResult.replayed) {
          const gateResult = await this.ordersService.releaseFinancialGate({
            orderId,
            releaseId: releaseResult.release.id,
            releaseType: "payment_verified",
            amount: coverage.payable.toString(),
            currency: verifyResult.payment.currency,
            actorId: input.adminUserId,
            actorRole: input.actorRole || "admin",
            reason: `Payable covered`,
            executor: tx,
          });
          releasedOrder = gateResult.order;
          release = releaseResult.release;
        }
      }

      return { ...verifyResult, coverage, release, releasedOrder };
    });
  }

  async rejectPayment(input: { paymentId: string; adminUserId: string; reason: string; idempotencyKey: string; expectedVersion?: number; actorRole?: string }) {
    return this.db.transaction(async (tx: any) => {
      const result = await this.paymentsService.rejectPayment({ ...input, executor: tx });
      if (!result.replayed) {
        const orderId = result.payment.wholesaleOrderId || result.payment.wholesale_order_id;
        await this.ordersService.recordPaymentFailed({
          orderId,
          paymentId: input.paymentId,
          reason: input.reason,
          actorId: input.adminUserId,
          idempotencyKey: input.idempotencyKey,
          executor: tx,
        });
      }
      return result;
    });
  }

  async creditApprove(input: { orderId: string; adminUserId: string; evidenceReference: string; amount?: string; currency?: string; reason: string; idempotencyKey: string; actorRole?: string }) {
    return this.db.transaction(async (tx: any) => {
      const order: any = await this.ordersService.lockOrderForFinance(input.orderId, tx);
      if (order.status !== "awaiting_payment" && order.status !== "confirmed") {
        throw new FinanceOrchestratorError("INVALID_STATUS_TRANSITION", `Cannot credit release from ${order.status}`);
      }

      const releaseResult = await this.paymentsService.releaseWithCredit({ ...input, executor: tx });
      if (releaseResult.replayed) return releaseResult;

      const gateResult = await this.ordersService.releaseFinancialGate({
            orderId: input.orderId,
            releaseId: (releaseResult as any).releaseId,
            releaseType: "credit_approved",
            amount: input.amount || "0",
            currency: input.currency || (order as any).currency || "IRR",
            actorId: input.adminUserId,
            actorRole: input.actorRole || "admin",
            reason: input.reason,
            executor: tx,
          });

      return { ...releaseResult, order: gateResult.order };
    });
  }

  async codApprove(input: { orderId: string; adminUserId: string; evidenceReference: string; reason: string; idempotencyKey: string; actorRole?: string }) {
    return this.db.transaction(async (tx: any) => {
      const order: any = await this.ordersService.lockOrderForFinance(input.orderId, tx);
      if (order.status !== "awaiting_payment" && order.status !== "confirmed") {
        throw new FinanceOrchestratorError("INVALID_STATUS_TRANSITION", `Cannot COD release from ${order.status}`);
      }

      const releaseResult = await this.paymentsService.releaseWithCod({ ...input, executor: tx });
      if (releaseResult.replayed) return releaseResult;

      const gateResult = await this.ordersService.releaseFinancialGate({
            orderId: input.orderId,
            releaseId: (releaseResult as any).releaseId,
            releaseType: "cod_policy_approved",
            amount: "0",
            currency: (order as any).currency || "IRR",
            actorId: input.adminUserId,
            actorRole: input.actorRole || "admin",
            reason: input.reason,
            executor: tx,
          });

      return { ...releaseResult, order: gateResult.order };
    });
  }

  async createRefund(input: {
    orderId: string;
    childOrderId?: string;
    exceptionId?: string;
    paymentId?: string;
    amount: string;
    currency?: string;
    reasonCode?: string;
    reason?: string;
    actorUserId: string;
    actorRole?: string;
    idempotencyKey: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      const result = await this.paymentsService.createRefund({ ...input, executor: tx });
      if (!result.replayed) {
        await this.ordersService.recordRefundRequested({
          orderId: input.orderId,
          refundId: result.refund.id,
          childOrderId: input.childOrderId,
          amount: input.amount,
          reasonCode: input.reasonCode,
          actorId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          executor: tx,
        });
      }
      return result;
    });
  }

  async approveRefund(input: { refundId: string; adminUserId: string; idempotencyKey: string; reason?: string; actorRole?: string }) {
    return this.db.transaction(async (tx: any) => {
      const result = await this.paymentsService.approveRefund({ ...input, executor: tx });
      if (!result.replayed) {
        const orderId = result.refund.wholesaleOrderId || result.refund.wholesale_order_id;
        await this.ordersService.recordRefundApproved({
          orderId,
          refundId: input.refundId,
          amount: (result.refund.amount || 0).toString(),
          actorId: input.adminUserId,
          idempotencyKey: input.idempotencyKey,
          executor: tx,
        });
      }
      return result;
    });
  }

  async completeRefund(input: { refundId: string; adminUserId: string; externalReference: string; idempotencyKey: string; actorRole?: string }) {
    return this.db.transaction(async (tx: any) => {
      const result = await this.paymentsService.completeRefund({ ...input, executor: tx });
      if (!result.replayed) {
        const orderId = result.refund.wholesaleOrderId || result.refund.wholesale_order_id;
        await this.ordersService.recordRefundCompleted({
          orderId,
          refundId: input.refundId,
          amount: (result.refund.amount || 0).toString(),
          childOrderId: result.refund.childOrderId || result.refund.child_order_id,
          actorId: input.adminUserId,
          idempotencyKey: input.idempotencyKey,
          executor: tx,
        });
      }
      return result;
    });
  }

  async cancelChildBeforePayment(input: {
    orderId: string;
    childOrderId: string;
    actorUserId: string;
    actorRole: string;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      const order = await this.ordersService.lockOrderForFinance(input.orderId, tx);

      const allocated = await this.paymentsService.getVerifiedAllocationSumForChild(input.childOrderId, tx);
      if (allocated > 0n) {
        throw new FinanceOrchestratorError("PAYMENT_ALREADY_ALLOCATED", `Child ${input.childOrderId} has verified allocation ${allocated.toString()}, use refund flow`);
      }

      const proforma = await this.paymentsService.getIssuedProformaForChild(input.childOrderId, tx);
      if (proforma) {
        await this.paymentsService.voidProforma(proforma.id, input.actorUserId, input.reason, tx);
        await this.ordersService.recordProformaVoided({
          orderId: input.orderId,
          proformaId: proforma.id,
          childOrderId: input.childOrderId,
          reason: input.reason,
          actorId: input.actorUserId,
          actorRole: input.actorRole,
          executor: tx,
        });
      }

      await this.paymentsService.createManualReleaseForVoid({
        orderId: input.orderId,
        childOrderId: input.childOrderId,
        actorId: input.actorUserId,
        actorRole: input.actorRole,
        currency: (order as any).currency || "IRR",
        reason: `Child ${input.childOrderId} cancelled before payment, proforma voided, payable recomputed, original grand_total preserved`,
        executor: tx,
      });

      await this.auditService.record(
        {
          actorId: input.actorUserId,
          actorRole: input.actorRole,
          action: "proforma.voided",
          entityType: "wholesale_proforma",
          entityId: proforma?.id || input.childOrderId,
          after: { childOrderId: input.childOrderId, reason: input.reason, originalGrandTotalPreserved: true },
          metadata: { orderId: input.orderId },
        },
        tx,
      );

      return { voidedProforma: proforma, adjustmentCreated: true };
    });
  }

  async cancelParentWithRefundObligations(input: {
    orderId: string;
    actorUserId: string;
    actorRole: string;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      const order = await this.ordersService.lockOrderForFinance(input.orderId, tx);
      const children = await this.ordersService.getChildOrdersForFinance(input.orderId, tx);
      const childIds = children.map((c: any) => c.id);

      const refundObligations = await this.paymentsService.getRefundObligationsForOrder(input.orderId, childIds, tx);

      await this.ordersService.recordParentCancelled({
        orderId: input.orderId,
        reason: input.reason,
        refundObligations: refundObligations.map((o) => ({ childOrderId: o.childOrderId, amount: o.amount.toString() })),
        actorId: input.actorUserId,
        actorRole: input.actorRole,
        executor: tx,
      });

      return { refundObligations: refundObligations.map((o) => ({ childOrderId: o.childOrderId, amount: o.amount.toString() })), order };
    });
  }
}
