import { Inject, Injectable } from "@nestjs/common";
import { DomainError } from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { ShippingService } from "../shipping/shipping.service";
import { SupplierComplianceService } from "../compliance/supplier-compliance.service";
import { InvoicingService } from "../invoicing/invoicing.service";
import {
  type BlockerClass,
  type BlockerCode,
  type ChildSettlementReadiness,
  FORBIDDEN_READINESS_FIELDS,
  type OrderSettlementReadiness,
  type ReadinessBlocker,
  type ReadinessItem,
  SETTLEMENT_READINESS_DISCLAIMER,
  SETTLEMENT_READINESS_SCHEMA_VERSION,
  SOURCE_DATA_BLOCKERS,
} from "./settlement-readiness.contract";

export class SettlementReadinessError extends DomainError {
  constructor(code: string, message: string, status = 400) {
    if (code === "CHILD_ORDER_NOT_FOUND" || code === "ORDER_NOT_FOUND") status = 404;
    super(status, code, message);
    this.name = "SettlementReadinessError";
  }
}

const LIVE_REFUND_STATUSES = new Set(["requested", "approved", "processing", "completed"]);
const PENDING_REFUND_STATUSES = new Set(["requested", "approved", "processing"]);

function big(value: unknown): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  return BigInt(String(value));
}

/**
 * Phase 4.7.6 — read-only settlement-readiness computation.
 *
 * Reads ONLY through owner services (Orders, Payments, Shipping, Compliance, Invoicing); owns no
 * table; never writes; never locks; never returns a balance. See `settlement-readiness.contract.ts`.
 */
@Injectable()
export class SettlementReadinessService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(ShippingService) private readonly shipping: ShippingService,
    @Inject(SupplierComplianceService) private readonly supplierCompliance: SupplierComplianceService,
    @Inject(InvoicingService) private readonly invoicing: InvoicingService,
  ) {}

  async computeForOrder(orderId: string): Promise<OrderSettlementReadiness> {
    const order = await this.orders.getWholesaleOrderById(orderId);
    if (!order) throw new SettlementReadinessError("ORDER_NOT_FOUND", `Order ${orderId} not found`);
    const childIds = await this.orders.listChildOrderIdsForOrder(orderId);
    const children: ChildSettlementReadiness[] = [];
    for (const childId of childIds) children.push(await this.computeForChild(childId));
    // Order-level facts are child-independent; any child id (or none) yields the same order block.
    const facts = await this.payments.getChildSettlementFacts({ orderId, childOrderId: childIds[0] ?? "__none__" });
    const verifiedPaid = big(facts.order.verifiedPaid);
    const allocated = big(facts.order.allocatedVerified);
    const orderScopedLive = facts.order.orderScopedRefunds.filter((r) => LIVE_REFUND_STATUSES.has(r.status)).reduce((s, r) => s + big(r.amount), 0n);
    const result: OrderSettlementReadiness = {
      disclaimer: SETTLEMENT_READINESS_DISCLAIMER,
      schemaVersion: SETTLEMENT_READINESS_SCHEMA_VERSION,
      computedAt: new Date().toISOString(),
      orderId,
      order: {
        verifiedPaid: verifiedPaid.toString(),
        allocatedVerified: allocated.toString(),
        unallocatedPaid: (verifiedPaid - allocated).toString(),
        orderScopedRefundsLive: orderScopedLive.toString(),
        ledgerIn: facts.order.ledgerIn,
        ledgerOut: facts.order.ledgerOut,
        ledgerMeaning: "SUM(IN) − SUM(OUT) = net verified cash of the ORDER after completed refunds; never a seller balance",
      },
      children,
    };
    this.assertNoForbiddenFields(result);
    return result;
  }

  async computeForChild(childOrderId: string): Promise<ChildSettlementReadiness> {
    let ctx: Awaited<ReturnType<OrdersService["getChildOrderEconomicContext"]>>;
    try {
      ctx = await this.orders.getChildOrderEconomicContext(childOrderId);
    } catch (error: any) {
      if (error?.code === "ORDER_NOT_FOUND") throw new SettlementReadinessError("CHILD_ORDER_NOT_FOUND", `Child order ${childOrderId} not found`);
      throw error;
    }
    if (!ctx.parent || !ctx.child.wholesaleOrderId) {
      throw new SettlementReadinessError("CHILD_ORDER_NOT_MARKETPLACE", `Child order ${childOrderId} has no parent wholesale order`, 409);
    }
    const orderId = ctx.child.wholesaleOrderId;
    const facts = await this.payments.getChildSettlementFacts({ orderId, childOrderId });
    const deliveredByItem = await this.shipping.getAllocatedQuantitiesForChild(childOrderId, this.db as any, ["delivered"]);
    const shipments: any[] = await this.shipping.listShipmentsForChild(childOrderId);
    const deliveredShipments = shipments.filter((s) => String(s.status) === "delivered").length;
    const tax = await this.invoicing.getTaxFactsForChild(childOrderId);

    const blockers: ReadinessBlocker[] = [];
    const notices: string[] = [];
    const block = (code: BlockerCode, cls: BlockerClass, detail: string) => {
      if (!blockers.some((b) => b.code === code)) blockers.push({ code, class: cls, detail });
    };

    // ── Participant identity (server-side, from the persisted child) ──
    const sellerType: "KOLBE" | "SUPPLIER" = ctx.child.supplierId ? "SUPPLIER" : "KOLBE";
    const settlementCandidate = sellerType === "SUPPLIER";
    if (!settlementCandidate) block("KOLBE_FIRST_PARTY", "economic", "Kolbe first-party child: no supplier payable exists; commission 0; excluded from settlement");
    if (ctx.child.status === "cancelled") block("CHILD_CANCELLED", "economic", "Child order is cancelled; cancellation is not a payment, release, refund or settlement event");

    // ── Currency consistency ──
    const currency = ctx.child.currency;
    const currencies = new Set<string>([currency, ctx.parent.currency]);
    for (const l of facts.lines) currencies.add(l.currency);
    for (const a of facts.allocations) currencies.add(a.currency);
    for (const r of facts.refunds) currencies.add(r.currency);
    for (const p of facts.proformas) currencies.add(p.currency);
    if (currencies.size > 1) block("CURRENCY_MISMATCH", "economic", `Mixed currencies on one child: ${[...currencies].sort().join(",")}; no FX is defined`);

    // ── Commercial terms snapshot (active issued proforma lines) ──
    const activeProforma = facts.proformas.find((p) => p.id === facts.activeProformaId) || null;
    const items: ReadinessItem[] = [];
    let termsOk = activeProforma !== null && facts.lines.length > 0;
    const termsProblems: string[] = [];
    for (const orderItem of ctx.items) {
      const line = facts.lines.find((l) => l.wholesaleOrderItemId === orderItem.wholesaleOrderItemId) || null;
      if (!line) {
        termsOk = false;
        termsProblems.push(`item ${orderItem.wholesaleOrderItemId} has no active proforma line`);
        continue;
      }
      const orderedUnits = line.quantity;
      const unitPrice = big(line.unitPrice);
      const lineTotal = big(line.lineTotal);
      if (!Number.isSafeInteger(orderedUnits) || orderedUnits <= 0 || unitPrice * BigInt(orderedUnits) !== lineTotal) {
        termsOk = false;
        termsProblems.push(`item ${orderItem.wholesaleOrderItemId}: unit_price × quantity != line_total`);
      }
      const orderedPieces = orderItem.pieceQuantity > 0 ? orderItem.pieceQuantity : orderedUnits;
      const piecesPerUnit = orderedUnits > 0 && orderedPieces % orderedUnits === 0 ? orderedPieces / orderedUnits : 0;
      if (piecesPerUnit <= 0) {
        termsOk = false;
        termsProblems.push(`item ${orderItem.wholesaleOrderItemId}: piece_quantity ${orderedPieces} is not a multiple of quantity ${orderedUnits}`);
      }
      const deliveredPiecesRaw = deliveredByItem.get(orderItem.wholesaleOrderItemId || "") ?? 0;
      const deliveredPieces = Math.min(deliveredPiecesRaw, orderedPieces);
      if (deliveredPiecesRaw > orderedPieces) notices.push(`OVER_DELIVERY:${orderItem.wholesaleOrderItemId}:${deliveredPiecesRaw}>${orderedPieces}`);
      const deliveredUnits = piecesPerUnit > 0 ? Math.floor(deliveredPieces / piecesPerUnit) : 0;
      let refundedUndelivered = 0;
      let refundedDelivered = 0;
      let refundedValue = 0n;
      for (const refund of facts.refunds) {
        if (!LIVE_REFUND_STATUSES.has(refund.status)) continue;
        for (const rl of refund.lines) {
          if (rl.wholesaleOrderItemId !== orderItem.wholesaleOrderItemId) continue;
          if (refund.fulfillmentExceptionId) refundedUndelivered += rl.quantity;
          else refundedDelivered += rl.quantity;
          refundedValue += big(rl.lineTotal);
        }
      }
      const entitledUnits = Math.max(0, Math.min(deliveredUnits, orderedUnits - refundedUndelivered) - refundedDelivered);
      items.push({
        wholesaleOrderItemId: String(orderItem.wholesaleOrderItemId),
        purchaseOrderItemId: orderItem.purchaseOrderItemId,
        pricingUnit: line.pricingUnit,
        orderedUnits,
        orderedPieces,
        piecesPerUnit,
        unitPrice: unitPrice.toString(),
        lineTotal: lineTotal.toString(),
        deliveredPieces,
        deliveredUnits,
        refundedUnitsUndelivered: refundedUndelivered,
        refundedUnitsDelivered: refundedDelivered,
        entitledUnitsPreview: entitledUnits,
        deliveredValue: (unitPrice * BigInt(deliveredUnits)).toString(),
        refundedValue: refundedValue.toString(),
        entitledValuePreview: (unitPrice * BigInt(entitledUnits)).toString(),
      });
    }
    if (ctx.items.length === 0) {
      termsOk = false;
      termsProblems.push("child has no order items");
    }
    if (!termsOk && ctx.child.status !== "cancelled") {
      block("COMMERCIAL_TERMS_NOT_SNAPSHOTTED", "economic", termsProblems.join("; ") || "no issued proforma with lines");
    }

    // ── Fulfillment evidence ──
    const orderedPieces = items.reduce((s, i) => s + i.orderedPieces, 0);
    const deliveredPieces = items.reduce((s, i) => s + i.deliveredPieces, 0);
    const statusDelivered = ctx.child.status === "delivered";
    let deliveryEvidence: ChildSettlementReadiness["fulfillment"]["deliveryEvidence"];
    if (deliveredPieces === 0) deliveryEvidence = statusDelivered ? "STATUS_ONLY" : "NONE";
    else if (deliveredPieces < orderedPieces) deliveryEvidence = statusDelivered ? "STATUS_ONLY" : "PARTIAL_QUANTITY_EVIDENCED";
    else deliveryEvidence = "QUANTITY_EVIDENCED";
    if (settlementCandidate && ctx.child.status !== "cancelled") {
      if (statusDelivered && deliveredPieces < orderedPieces) {
        block("DELIVERY_EVIDENCE_MISSING", "economic", `Status is delivered but shipment items evidence only ${deliveredPieces}/${orderedPieces} pieces (status-only delivery is not settlement evidence)`);
      }
      if (deliveredPieces === 0 && !statusDelivered) block("CHILD_NOT_DELIVERED", "economic", "No quantity-evidenced delivery yet");
      if (deliveredPieces > 0 && deliveredPieces < orderedPieces) block("PARTIAL_FULFILLMENT", "payout", `Delivered ${deliveredPieces}/${orderedPieces} pieces; only the delivered slice is attributable`);
    }

    // ── Cash coverage (verified active allocations to this child's proforma lineage) ──
    const childPayable = activeProforma ? big(activeProforma.totalAmount) : 0n;
    const allocatedVerified = facts.allocations.reduce((s, a) => s + big(a.amount), 0n);
    const covered = childPayable > 0n && allocatedVerified >= childPayable;
    const verifiedPaid = big(facts.order.verifiedPaid);
    const orderAllocated = big(facts.order.allocatedVerified);
    const unallocated = verifiedPaid - orderAllocated;
    const orderScopedLive = facts.order.orderScopedRefunds.filter((r) => LIVE_REFUND_STATUSES.has(r.status)).reduce((s, r) => s + big(r.amount), 0n);
    const releases = facts.order.releases;
    const financialReleaseWithoutCash = releases.some((r) => r.releaseType !== "payment_verified") && !covered;
    if (settlementCandidate && ctx.child.status !== "cancelled" && !covered) {
      block("PAYMENT_NOT_COLLECTED", "economic", `Verified allocations ${allocatedVerified.toString()} < child payable ${childPayable.toString()} (a credit/cod/manual release is not cash)`);
    }
    if (orderScopedLive > unallocated) {
      block("REFUND_NOT_ATTRIBUTABLE", "economic", `Order-scoped refunds ${orderScopedLive.toString()} exceed the order's unallocated money ${unallocated.toString()}; seller attribution of that refund is undefined`);
    }

    // ── Refund state ──
    const childRefundsLive = facts.refunds.filter((r) => LIVE_REFUND_STATUSES.has(r.status));
    const refundedCompleted = facts.refunds.filter((r) => r.status === "completed").reduce((s, r) => s + big(r.amount), 0n);
    const refundedPending = facts.refunds.filter((r) => PENDING_REFUND_STATUSES.has(r.status)).reduce((s, r) => s + big(r.amount), 0n);
    const refundedWithoutLines = childRefundsLive.filter((r) => r.lines.length === 0).reduce((s, r) => s + big(r.amount), 0n);
    if (refundedWithoutLines > 0n) notices.push("REFUND_WITHOUT_LINES:child-scoped amount refund reduces the child preview without a quantity basis");
    if (refundedPending > 0n) block("REFUND_PENDING", "payout", `Live refunds not yet completed: ${refundedPending.toString()}`);

    // ── Basis ──
    const merchandiseOrdered = items.reduce((s, i) => s + big(i.lineTotal), 0n);
    const merchandiseDelivered = items.reduce((s, i) => s + big(i.deliveredValue), 0n);
    const entitledLines = items.reduce((s, i) => s + big(i.entitledValuePreview), 0n);
    const entitledPreview = entitledLines - refundedWithoutLines > 0n ? entitledLines - refundedWithoutLines : 0n;
    const shippingCharged = activeProforma ? big(activeProforma.shippingTotal) : 0n;
    const taxExcluded = tax.issuedInvoice ? big(tax.issuedInvoice.taxTotal) : 0n;

    // ── Configuration (Phase 4.8 has not started: nothing is configured) ──
    if (settlementCandidate) {
      block("COMMISSION_POLICY_UNDEFINED", "configuration", "No commission policy exists; default before configuration is 0 (basis and rate are business decisions)");
      block("HOLD_POLICY_UNDEFINED", "configuration", "No availability hold policy exists; no duration is assumed");
      if (shippingCharged > 0n) block("SHIPPING_ECONOMIC_OWNER_UNDEFINED", "configuration", `Buyer was charged ${shippingCharged.toString()} shipping; economic recipient / cost bearer are not modelled`);
      if (tax.vatRateActive || taxExcluded > 0n) block("TAX_TREATMENT_UNVERIFIED", "configuration", "A VAT rate is active or tax was assessed on the invoice; tax is never supplier cash and its treatment is unverified");
    }

    // ── Compliance (owner: Compliance; reused, not duplicated) ──
    let compliance: ChildSettlementReadiness["compliance"] = { evaluated: false, eligible: null, reasons: [], checkedAt: null };
    if (settlementCandidate && ctx.child.supplierId) {
      const eligibility = await this.supplierCompliance.getSupplierSettlementEligibility(ctx.child.supplierId);
      compliance = { evaluated: true, eligible: eligibility.eligible, reasons: [...eligibility.reasons], checkedAt: eligibility.checkedAt };
      if (eligibility.reasons.includes("SUPPLIER_BANK_NOT_VERIFIED")) block("BANK_DESTINATION_NOT_VERIFIED", "compliance", "Supplier bank destination is not verified");
      const otherReasons = eligibility.reasons.filter((r) => r !== "SUPPLIER_BANK_NOT_VERIFIED");
      if (otherReasons.length > 0) block("SUPPLIER_COMPLIANCE_BLOCKED", "compliance", otherReasons.join(","));
    }

    const sourceDataSufficient = settlementCandidate && !blockers.some((b) => SOURCE_DATA_BLOCKERS.includes(b.code));
    const readyForSettlementEngine = settlementCandidate && !blockers.some((b) => b.class !== "payout");

    const result: ChildSettlementReadiness = {
      disclaimer: SETTLEMENT_READINESS_DISCLAIMER,
      schemaVersion: SETTLEMENT_READINESS_SCHEMA_VERSION,
      computedAt: new Date().toISOString(),
      orderId,
      orderCode: ctx.parent.orderCode,
      childOrderId,
      childOrderCode: ctx.child.orderCode,
      childStatus: ctx.child.status,
      parentStatus: ctx.parent.status,
      paymentMode: ctx.parent.paymentMode,
      currency,
      participant: {
        sellerId: ctx.child.sellerId,
        sellerType,
        supplierId: ctx.child.supplierId,
        settlementCandidate,
        identifiedBy: "purchase_order.supplier_id (server-side, never client input)",
      },
      commercialTerms: {
        snapshotted: termsOk,
        proformaId: activeProforma?.id ?? null,
        proformaVersion: activeProforma?.version ?? null,
        proformaHistory: facts.proformas.map((p) => ({ proformaId: p.id, version: p.version, status: p.status, itemsTotal: p.itemsTotal, shippingTotal: p.shippingTotal, totalAmount: p.totalAmount })),
        items: settlementCandidate ? items : [],
      },
      fulfillment: {
        orderedPieces,
        deliveredPieces,
        deliveredShipments,
        statusDelivered,
        deliveryEvidence,
        deliveryHistory: ctx.deliveryHistory,
      },
      economicBasis: {
        label: SETTLEMENT_READINESS_DISCLAIMER,
        merchandiseOrdered: settlementCandidate ? merchandiseOrdered.toString() : "0",
        merchandiseDelivered: settlementCandidate ? merchandiseDelivered.toString() : "0",
        merchandiseRefundedCompleted: settlementCandidate ? refundedCompleted.toString() : "0",
        merchandiseRefundedPending: settlementCandidate ? refundedPending.toString() : "0",
        merchandiseRefundedWithoutLines: settlementCandidate ? refundedWithoutLines.toString() : "0",
        merchandiseEntitledPreview: settlementCandidate ? entitledPreview.toString() : "0",
        shippingChargedToBuyer: shippingCharged.toString(),
        shippingEconomicOwner: shippingCharged > 0n ? "UNDEFINED" : "NOT_CHARGED",
        shippingPhysicalResponsibility: ctx.child.shippingResponsibility,
        taxExcluded: taxExcluded.toString(),
        taxTreatment: tax.vatRateActive || taxExcluded > 0n ? "VAT_RATE_ACTIVE_TREATMENT_UNVERIFIED" : "NOT_ASSESSED",
        taxBasisReference: tax.issuedInvoice?.taxBasisReference ?? tax.vatRateReference ?? null,
      },
      cashCoverage: {
        basis: "VERIFIED_ACTIVE_ALLOCATIONS_TO_CHILD_PROFORMA_LINEAGE",
        childPayable: childPayable.toString(),
        allocatedVerified: allocatedVerified.toString(),
        covered,
        allocations: facts.allocations.map((a) => ({ paymentId: a.paymentId, proformaId: a.proformaId, amount: a.amount, method: a.method, provider: a.provider, verifiedAt: a.verifiedAt })),
        unallocatedOrderMoney: unallocated.toString(),
        orderVerifiedPaid: verifiedPaid.toString(),
        orderScopedRefundsLive: orderScopedLive.toString(),
        releases,
        financialReleaseWithoutCash,
      },
      refunds: facts.refunds.map((r) => ({
        refundId: r.id,
        status: r.status,
        amount: r.amount,
        exceptionLinked: r.fulfillmentExceptionId !== null,
        lines: r.lines.map((l) => ({ wholesaleOrderItemId: l.wholesaleOrderItemId, quantity: l.quantity, lineTotal: l.lineTotal })),
      })),
      commission: { applicable: settlementCandidate, policyRef: null, basis: null, rateBps: null, amount: null, defaultBeforeConfiguration: "0" },
      compliance,
      capabilities: { chargebackFactsAvailable: false, disputeFactsAvailable: false, commissionPolicyAvailable: false, holdPolicyAvailable: false },
      blockers,
      notices,
      sourceDataSufficient,
      readyForSettlementEngine,
    };
    this.assertNoForbiddenFields(result);
    return result;
  }

  /** Defensive: a readiness payload must never carry a balance-looking field. */
  private assertNoForbiddenFields(value: unknown, path = "$"): void {
    if (Array.isArray(value)) {
      value.forEach((v, i) => this.assertNoForbiddenFields(v, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if ((FORBIDDEN_READINESS_FIELDS as readonly string[]).includes(k)) {
          throw new SettlementReadinessError("READINESS_FORBIDDEN_FIELD", `Readiness payload must not expose ${path}.${k}`, 500);
        }
        this.assertNoForbiddenFields(v, `${path}.${k}`);
      }
    }
  }
}
