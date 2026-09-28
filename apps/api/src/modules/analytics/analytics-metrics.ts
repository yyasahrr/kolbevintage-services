import type { AnalyticsScope } from "@kolbe/database";
import { ANALYTICS_DIMENSIONS, type AnalyticsDimension } from "./analytics.contract";

export type AnalyticsMetricUnit = "COUNT" | "INTEGER" | "IRR" | "RATIO";
export type AnalyticsMetricCategory =
  | "platform"
  | "retail"
  | "wholesale"
  | "marketplace"
  | "supplier"
  | "vip"
  | "inventory"
  | "payments"
  | "refunds"
  | "settlement"
  | "crm"
  | "support"
  | "notifications"
  | "production";

export type AnalyticsMetricDefinition = {
  key: string;
  label: string;
  description: string;
  category: AnalyticsMetricCategory;
  unit: AnalyticsMetricUnit;
  /** Exact counting/amount grain used by the query implementation. */
  amountBasis: string;
  sourceDomain: string;
  sourceTables: string[];
  timestampBasis: string;
  includedStatuses: string[];
  excludedStatuses: string[];
  refundTreatment: string;
  cancellationTreatment: string;
  timezoneBehavior: string;
  dimensions: AnalyticsDimension[];
  supportedScopes: AnalyticsScope[];
  freshness: string;
  queryKind: string;
};

const ALL = ["PLATFORM", "RETAIL", "WHOLESALE", "SUPPLIER", "VIP_ACCOUNT"] as AnalyticsScope[];
const WHOLESALE = ["PLATFORM", "WHOLESALE", "SUPPLIER", "VIP_ACCOUNT"] as AnalyticsScope[];
const WHOLESALE_FINANCIAL = ["PLATFORM", "WHOLESALE", "VIP_ACCOUNT"] as AnalyticsScope[];
const RETAIL = ["PLATFORM", "RETAIL"] as AnalyticsScope[];
const SUPPLIER = ["PLATFORM", "SUPPLIER"] as AnalyticsScope[];
const CRM = ["PLATFORM"] as AnalyticsScope[];
const PRODUCTION = ["PLATFORM", "SUPPLIER"] as AnalyticsScope[];

function metric(
  key: string,
  label: string,
  description: string,
  category: AnalyticsMetricCategory,
  unit: AnalyticsMetricUnit,
  amountBasis: string,
  sourceDomain: string,
  sourceTables: string[],
  timestampBasis: string,
  includedStatuses: string[],
  excludedStatuses: string[],
  refundTreatment: string,
  cancellationTreatment: string,
  supportedScopes: AnalyticsScope[],
  queryKind: string,
  dimensions: AnalyticsDimension[] = ["day", "status"],
): AnalyticsMetricDefinition {
  return {
    key,
    label,
    description,
    category,
    unit,
    amountBasis,
    sourceDomain,
    sourceTables,
    timestampBasis,
    includedStatuses,
    excludedStatuses,
    refundTreatment,
    cancellationTreatment,
    timezoneBehavior: "UTC storage/query; calendar bucketing uses the request's explicit IANA timezone",
    dimensions,
    supportedScopes,
    freshness: "LIVE authoritative source read; no analytics snapshot is treated as truth",
    queryKind,
  };
}

/**
 * Version-controlled metric dictionary. The browser can select these keys but
 * can never submit SQL, table names, predicates, or executable expressions.
 */
export const ANALYTICS_METRICS: readonly AnalyticsMetricDefinition[] = [
  metric("platform.accounts_count", "Platform accounts", "Account users created in the requested period.", "platform", "COUNT", "One account_user row", "Auth", ["account_user"], "account_user.created_at", ["all account statuses"], [], "Refunds do not apply.", "Cancellations do not apply.", ["PLATFORM"], "platform_accounts"),
  metric("platform.new_accounts_count", "New platform accounts", "Account users created in the requested period, not browser registrations.", "platform", "COUNT", "One account_user row", "Auth", ["account_user"], "account_user.created_at", ["all account statuses"], [], "Refunds do not apply.", "Cancellations do not apply.", ["PLATFORM"], "platform_accounts"),
  metric("platform.orders_count", "Platform orders", "Distinct authoritative retail orders plus wholesale parent orders; this is a count, not GMV.", "platform", "COUNT", "Distinct retail_order plus wholesale_order rows", "Orders / Retail", ["retail_order", "wholesale_order"], "each order.created_at", ["source rows in range"], ["no source row"], "Refunds do not reduce order count.", "Cancelled orders remain visible in the platform count; use status-specific metrics for fulfilled commerce.", ["PLATFORM"], "platform_orders"),
  metric("retail.orders_count", "Retail orders", "Retail order rows created in the period.", "retail", "COUNT", "One retail_order row", "Retail Orders", ["retail_order"], "retail_order.created_at", ["all recorded retail order statuses"], [], "Refunds do not reduce order count.", "Cancelled orders remain in this factual order count.", RETAIL, "retail_orders"),
  metric("retail.units_ordered", "Retail units ordered", "Units from retail order line quantities for retail orders in the period.", "retail", "INTEGER", "SUM(retail_order_item.quantity)", "Retail Orders", ["retail_order", "retail_order_item"], "retail_order.created_at", ["all recorded order statuses"], [], "Refunds are not inferred from lines.", "Cancelled order lines are not silently removed; use paid/delivered source states separately.", RETAIL, "retail_units"),
  metric("retail.ordered_gmv", "Retail ordered GMV", "Server-recorded retail items plus shipping total from retail_order.total_amount.", "retail", "IRR", "SUM(retail_order.total_amount), IRR BIGINT", "Retail Orders", ["retail_order"], "retail_order.created_at", ["all recorded order statuses"], [], "Refunds are not netted; this is ordered GMV.", "Cancellation is not netted; cancelled amount is separately visible by status.", RETAIL, "retail_ordered_gmv"),
  metric("retail.paid_orders_count", "Retail paid orders", "Retail orders whose authoritative paymentStatus is paid.", "retail", "COUNT", "One retail_order row", "Retail Orders", ["retail_order"], "retail_order.created_at", ["payment_status = paid"], ["payment_status != paid"], "Refunds do not change the paid-order count.", "Cancelled rows are excluded only when their payment status is not paid; no cancellation is guessed.", RETAIL, "retail_paid_orders"),
  metric("retail.order_status_count", "Retail orders by status", "Retail order count grouped by the stored server order status.", "retail", "COUNT", "One retail_order row per status", "Retail Orders", ["retail_order"], "retail_order.created_at", ["all recorded order_status values"], [], "Refunds do not change status counts.", "Cancelled is a source status, not a deletion.", RETAIL, "retail_status_counts", ["day", "status"]),
  metric("wholesale.orders_count", "Wholesale parent orders", "Distinct canonical wholesale parent orders in the period.", "wholesale", "COUNT", "One wholesale_order row; parent grain", "Orders", ["wholesale_order"], "wholesale_order.created_at", ["all recorded wholesale order statuses"], [], "Refunds do not reduce parent order count.", "Cancelled parents remain factual rows and are not counted as delivered.", WHOLESALE, "wholesale_orders"),
  metric("wholesale.units_ordered", "Wholesale units ordered", "SUM of canonical wholesale_order_item.piece_quantity at parent order grain.", "wholesale", "INTEGER", "SUM(wholesale_order_item.piece_quantity)", "Orders", ["wholesale_order", "wholesale_order_item"], "wholesale_order.created_at", ["all recorded parent statuses"], [], "Refund quantity is not subtracted from ordered units.", "Cancelled parent lines remain ordered history; status filters are explicit.", WHOLESALE, "wholesale_units"),
  metric("wholesale.ordered_gmv", "Wholesale ordered GMV", "Canonical wholesale parent grandTotal, counted once per parent and never added to child totals.", "wholesale", "IRR", "SUM(wholesale_order.grand_total), IRR BIGINT", "Orders", ["wholesale_order"], "wholesale_order.created_at", ["all recorded parent statuses"], [], "Refunds are not netted; this is ordered GMV.", "Cancelled parents are not silently reclassified as paid or delivered.", WHOLESALE, "wholesale_ordered_gmv"),
  metric("wholesale.confirmed_orders_count", "Confirmed wholesale orders", "Canonical wholesale parents in confirmed or later processing states.", "wholesale", "COUNT", "One wholesale_order row", "Orders", ["wholesale_order"], "wholesale_order.created_at", ["confirmed", "awaiting_payment", "processing", "fulfillment", "shipped", "completed"], ["draft", "cancelled"], "Refunds do not alter confirmation count.", "Cancelled and draft parents are excluded from this operational count.", WHOLESALE, "wholesale_confirmed_orders"),
  metric("marketplace.child_orders_count", "Marketplace child orders", "Distinct supplier/Kolbe purchase orders created for wholesale parents.", "marketplace", "COUNT", "One purchase_order row; child grain", "Orders / Marketplace", ["purchase_order"], "purchase_order.created_at", ["all recorded child statuses"], [], "Refunds do not reduce child order count.", "Cancelled child orders remain source history and are excluded only by explicit status metrics.", WHOLESALE, "child_orders"),
  metric("marketplace.supplier_gmv", "Marketplace supplier-attributed GMV", "Purchase-order grand totals, counted at child order grain and never summed with parent GMV.", "marketplace", "IRR", "SUM(purchase_order.grand_total), child grain, IRR BIGINT", "Orders / Marketplace", ["purchase_order"], "purchase_order.created_at", ["all recorded child statuses"], [], "Refunds are not netted; settlement is separate.", "Cancelled child rows are not delivered or settled by implication.", WHOLESALE, "child_gmv"),
  metric("supplier.child_orders_count", "Supplier child orders", "Purchase orders attributable to the authenticated supplier.", "supplier", "COUNT", "One purchase_order row", "Orders / Supplier", ["purchase_order"], "purchase_order.created_at", ["all recorded child statuses"], [], "Refunds do not reduce child order count.", "Cancelled child orders remain history.", SUPPLIER, "supplier_child_orders"),
  metric("supplier.order_units", "Supplier ordered units", "Units attributable to the authenticated supplier through canonical child items.", "supplier", "INTEGER", "SUM(purchase_order_item.quantity)", "Orders / Supplier", ["purchase_order", "purchase_order_item", "wholesale_order_item"], "purchase_order.created_at", ["all recorded child statuses"], [], "Refunds are not inferred from quantity.", "Cancelled child rows are not silently deleted.", SUPPLIER, "supplier_units"),
  metric("supplier.delivered_shipments_count", "Supplier delivered shipments", "Shipments for the authenticated supplier whose source status is delivered.", "supplier", "COUNT", "Distinct shipment rows", "Shipping", ["shipment", "purchase_order"], "shipment.delivered_at", ["shipment.status = delivered"], ["other shipment statuses"], "Refunds do not change shipment delivery state.", "Cancelled shipments are not delivered.", SUPPLIER, "supplier_delivered_shipments"),
  metric("vip.active_memberships_count", "Active VIP memberships", "Wholesale memberships whose authoritative status is active at the report end for the authenticated or explicitly authorized account.", "vip", "COUNT", "One wholesale_membership row", "VIP", ["wholesale_membership"], "wholesale_membership.updated_at <= report end (current status)", ["status = active"], ["pending", "suspended", "cancelled", "expired"], "Refunds do not apply.", "Membership cancellation is a source state.", ["PLATFORM", "VIP_ACCOUNT"], "vip_active_memberships", ["status"]),
  metric("vip.orders_count", "VIP wholesale orders", "Canonical wholesale parent orders for the server-resolved VIP account.", "vip", "COUNT", "One wholesale_order row", "Orders / VIP", ["wholesale_account", "wholesale_order"], "wholesale_order.created_at", ["all recorded parent statuses"], [], "Refunds do not reduce order count.", "Cancelled parents are factual history.", ["PLATFORM", "VIP_ACCOUNT"], "vip_orders"),
  metric("vip.ordered_gmv", "VIP ordered GMV", "Canonical wholesale parent grandTotal for the server-resolved VIP account.", "vip", "IRR", "SUM(wholesale_order.grand_total), IRR BIGINT", "Orders / VIP", ["wholesale_account", "wholesale_order"], "wholesale_order.created_at", ["all recorded parent statuses"], [], "Refunds are not netted.", "Cancelled parents are not treated as paid or delivered.", ["PLATFORM", "VIP_ACCOUNT"], "vip_gmv"),
  metric("inventory.on_hand_units", "Inventory on hand", "Current on-hand units from canonical product_variant_inventory rows.", "inventory", "INTEGER", "SUM(product_variant_inventory.on_hand)", "Inventory", ["product_variant_inventory"], "product_variant_inventory.updated_at <= report end (current row)", ["status = active"], ["inactive inventory rows"], "Refunds do not change inventory without an authoritative inventory event.", "Order cancellation is not used to recalculate inventory.", SUPPLIER, "inventory_on_hand", ["supplier"]),
  metric("inventory.reserved_units", "Inventory reserved", "Current reserved units from canonical product_variant_inventory rows.", "inventory", "INTEGER", "SUM(product_variant_inventory.reserved)", "Inventory", ["product_variant_inventory"], "product_variant_inventory.updated_at <= report end (current row)", ["status = active"], ["inactive inventory rows"], "Refunds do not change reservations by inference.", "Cancellation treatment follows inventory writer state, not analytics.", SUPPLIER, "inventory_reserved", ["supplier"]),
  metric("inventory.available_units", "Inventory available", "On hand minus reserved from canonical inventory rows, never below source arithmetic.", "inventory", "INTEGER", "SUM(on_hand - reserved)", "Inventory", ["product_variant_inventory"], "product_variant_inventory.updated_at <= report end (current row)", ["status = active"], ["inactive inventory rows"], "Refunds do not create availability.", "Cancellations do not create availability unless inventory truth already records it.", SUPPLIER, "inventory_available", ["supplier"]),
  metric("payments.submitted_amount", "Payment submitted amount", "Payment amounts submitted in the period, independent of verification.", "payments", "IRR", "SUM(payment.amount), IRR BIGINT", "Payments", ["payment"], "payment.submitted_at, fallback payment.created_at", ["submitted_at is present"], ["no submitted timestamp"], "Refunds are separate rows and are not netted.", "Order cancellation does not turn a payment into a refund.", WHOLESALE_FINANCIAL, "payment_submitted_amount"),
  metric("payments.confirmed_amount", "Payment confirmed amount", "Verified payment amounts in the period; not wholesale GMV and not bank settlement.", "payments", "IRR", "SUM(payment.amount) where status = verified", "Payments", ["payment"], "payment.verified_at", ["status = verified"], ["pending", "failed", "rejected", "cancelled"], "Refunds are not netted; refund metrics are separate.", "Order cancellation does not change payment status.", WHOLESALE_FINANCIAL, "payment_confirmed_amount"),
  metric("payments.failed_count", "Failed payments", "Payments recorded with a failed or rejected status.", "payments", "COUNT", "One payment row", "Payments", ["payment"], "payment.updated_at, fallback payment.created_at", ["status = failed or rejected"], ["verified", "pending"], "Refunds are separate.", "Order cancellation is not a payment failure.", WHOLESALE_FINANCIAL, "payment_failed_count"),
  metric("refunds.amount", "Completed refund amount", "Completed refund amounts in the period; never subtracted from ordered GMV in place.", "refunds", "IRR", "SUM(refund.amount), IRR BIGINT", "Payments / Refunds", ["refund"], "refund.completed_at", ["status = completed"], ["requested", "approved", "failed", "cancelled"], "This is the refund amount itself; it is not net revenue.", "Refunds may relate to cancelled/problem orders but status is taken from refund.", WHOLESALE_FINANCIAL, "refund_completed_amount"),
  metric("refunds.count", "Completed refunds", "Completed refund rows in the period.", "refunds", "COUNT", "One refund row", "Payments / Refunds", ["refund"], "refund.completed_at", ["status = completed"], ["non-completed refund statuses"], "Refund count is separate from payment and order counts.", "Cancellation is not inferred.", WHOLESALE_FINANCIAL, "refund_completed_count"),
  metric("settlement.pending_amount", "Supplier settlement pending", "Supplier pending-payable settlement account balance as of the report end from Settlement truth.", "settlement", "IRR", "SUM settlement postings for SUPPLIER_PENDING_PAYABLE, IRR BIGINT", "Settlement", ["settlement_account", "settlement_posting"], "settlement_posting.created_at <= report end (balance as-of)", ["active supplier pending accounts"], ["platform/clearing accounts"], "Refund treatment is already encoded by Settlement postings; Analytics does not recalculate it.", "Order cancellation is not used to estimate payable.", SUPPLIER, "settlement_pending"),
  metric("settlement.available_amount", "Supplier settlement available", "Supplier available-payable settlement account balance as of the report end from Settlement truth.", "settlement", "IRR", "SUM settlement postings for SUPPLIER_AVAILABLE_PAYABLE, IRR BIGINT", "Settlement", ["settlement_account", "settlement_posting"], "settlement_posting.created_at <= report end (balance as-of)", ["active supplier available accounts"], ["pending, hold, recovery accounts"], "Refund treatment is owned by Settlement.", "Cancellation is owned by Settlement readiness/Settlement.", SUPPLIER, "settlement_available"),
  metric("settlement.held_amount", "Supplier settlement held", "Supplier hold account balance as of the report end from Settlement truth.", "settlement", "IRR", "SUM settlement postings for SUPPLIER_HOLD, IRR BIGINT", "Settlement", ["settlement_account", "settlement_posting"], "settlement_posting.created_at <= report end (balance as-of)", ["active supplier hold accounts"], ["other settlement accounts"], "Refund/dispute holds are not re-derived.", "Cancellation is not a hold reason by implication.", SUPPLIER, "settlement_held"),
  metric("settlement.commission_earned", "Platform commission posted", "Commission postings recorded by Settlement; not profit and not a bank settlement.", "settlement", "IRR", "Settlement posting amount on platform commission account, IRR BIGINT", "Settlement", ["settlement_account", "settlement_posting"], "settlement_posting.created_at <= report end (balance as-of)", ["active platform commission account postings"], ["supplier payable postings"], "Refund/reversal treatment follows Settlement journal.", "Order cancellation is not a commission reversal unless Settlement posted it.", ["PLATFORM"], "settlement_commission"),
  metric("settlement.withdrawal_amount", "Supplier withdrawal requested", "Withdrawal request amounts by source request status.", "settlement", "IRR", "SUM withdrawal_request.amount, IRR BIGINT", "Settlement", ["withdrawal_request"], "withdrawal_request.created_at", ["all recorded withdrawal requests"], [], "Refunds do not alter request history.", "Cancellation/rejection remains a source status.", SUPPLIER, "withdrawal_amount"),
  metric("settlement.payout_submitted_amount", "Supplier payout submitted", "Payout amounts in transit/submitted states; not bank settled.", "settlement", "IRR", "SUM payout.amount, IRR BIGINT", "Settlement", ["payout"], "payout.processing_at, fallback payout.created_at", ["status = pending or processing"], ["succeeded, failed"], "Refunds are not inferred from payout state.", "Order cancellation is not payout state.", SUPPLIER, "payout_submitted"),
  metric("settlement.bank_settled_amount", "Supplier payout succeeded", "Payout amounts whose Settlement payout provider state is succeeded; this is not a bank statement.", "settlement", "IRR", "SUM payout.amount where status = succeeded, IRR BIGINT", "Settlement", ["payout"], "payout.succeeded_at", ["status = succeeded"], ["pending", "processing", "failed"], "Refunds are not inferred; payout reversal is source-specific.", "Cancellation is not bank settlement.", SUPPLIER, "payout_succeeded"),
  metric("crm.contacts_count", "CRM contacts", "CRM contact rows created in the period.", "crm", "COUNT", "One crm_contact row", "CRM", ["crm_contact"], "crm_contact.created_at", ["all stages"], [], "Refunds do not change contact count.", "Churned is a stage, not deletion.", CRM, "crm_contacts", ["day", "status"]),
  metric("crm.overdue_tasks_count", "Overdue CRM tasks", "Open CRM tasks whose dueAt is before the data-as-of time.", "crm", "COUNT", "One crm_task row", "CRM", ["crm_task"], "crm_task.due_at", ["status = OPEN and due_at < dataAsOf"], ["completed, cancelled, no due date"], "Refunds do not apply.", "Task cancellation is a source status.", CRM, "crm_overdue_tasks", ["status"]),
  metric("support.open_cases_count", "Open support cases", "Support cases opened before the report end and currently not resolved or closed.", "support", "COUNT", "One support_case row", "Support", ["support_case"], "support_case.opened_at", ["status not in RESOLVED,CLOSED"], ["RESOLVED", "CLOSED"], "Refunds do not apply.", "Case closure is taken from Support status.", ALL, "support_open_cases", ["status", "channel"]),
  metric("support.sla_breaches_count", "Support SLA breaches", "Open cases whose authoritative SLA first-response or resolution deadline has passed.", "support", "COUNT", "One support_case_sla row joined to open support case", "Support", ["support_case", "support_case_sla"], "support_case_sla.first_response_due_at/resolution_due_at", ["due timestamp passed and response/resolution absent"], ["met SLA or closed case"], "Refunds do not apply.", "Case status and SLA timestamps are authoritative.", ALL, "support_sla_breaches", ["status", "channel"]),
  metric("notifications.sent_count", "Notifications sent", "Notification deliveries in SENT or later provider-confirmed states, but not necessarily delivered.", "notifications", "COUNT", "One notification_delivery row", "Notifications", ["notification_delivery"], "notification_delivery.last_attempt_at, fallback scheduled_at", ["SENT", "DELIVERED"], ["PENDING", "FAILED_*", "SUPPRESSED", "CANCELLED"], "Refunds do not apply.", "Source event cancellation is not delivery cancellation.", ALL, "notification_sent_count", ["channel", "status"]),
  metric("notifications.delivered_count", "Notifications delivered", "Notification deliveries with status DELIVERED only.", "notifications", "COUNT", "One notification_delivery row", "Notifications", ["notification_delivery"], "notification_delivery.delivered_at", ["DELIVERED"], ["SENT", "FAILED_*", "SUPPRESSED", "CANCELLED"], "Refunds do not apply.", "Delivery is not inferred from sent state.", ALL, "notification_delivered_count", ["channel", "status"]),
  metric("notifications.failed_count", "Notification failures", "Permanent and retryable notification delivery failures.", "notifications", "COUNT", "One notification_delivery row", "Notifications", ["notification_delivery"], "notification_delivery.failed_at, fallback updated_at", ["FAILED_RETRYABLE", "FAILED_PERMANENT"], ["DELIVERED", "SENT"], "Refunds do not apply.", "Delivery failure is not a source business failure.", ALL, "notification_failed_count", ["channel", "status"]),
  metric("notifications.delivery_success_rate", "Notification delivery success rate", "Delivered deliveries divided by terminal attempted deliveries, preserved as a ratio and basis points.", "notifications", "RATIO", "delivered / (delivered + permanent failures)", "Notifications", ["notification_delivery"], "notification_delivery.delivered_at/failed_at", ["DELIVERED and FAILED_PERMANENT denominator"], ["pending/retryable/suppressed/cancelled"], "Refunds do not apply.", "Delivery state is never equated with source event state.", ALL, "notification_delivery_success_rate", ["channel"]),
  metric("production.jobs_count", "Production jobs", "Production job extensions created from canonical supplier child orders.", "production", "COUNT", "One production_job row", "Production", ["production_job"], "production_job.created_at", ["all recorded production statuses"], [], "Refunds do not apply.", "Cancelled jobs remain factual production history.", PRODUCTION, "production_jobs_count", ["day", "status"]),
  metric("production.completed_jobs_count", "Completed production jobs", "Production jobs whose server-owned status is completed.", "production", "COUNT", "One production_job row", "Production", ["production_job"], "production_job.completed_at", ["status = completed"], ["other statuses"], "Refunds do not apply.", "Cancelled jobs are not completed.", PRODUCTION, "production_completed_jobs_count", ["day"]),
  metric("production.actual_units", "Actual production units", "Actual integer units recorded on production jobs; this is not inventory balance or shipment quantity.", "production", "INTEGER", "SUM(production_job.actual_units)", "Production", ["production_job"], "production_job.updated_at", ["server-recorded actual_units"], [], "Refunds do not apply.", "Cancellation does not rewrite recorded output.", PRODUCTION, "production_actual_units", ["day"]),
  metric("production.quality_releases_count", "Approved quality releases", "Quality releases approved after the server-side quality gate.", "production", "COUNT", "One quality_release row", "Production / Quality", ["quality_release"], "quality_release.approved_at", ["status = approved"], ["pending", "rejected", "revoked"], "Refunds do not apply.", "A release is not a shipment or inventory mutation.", PRODUCTION, "production_quality_releases_count", ["day"]),
  metric("production.defects_count", "Recorded production defects", "Quality defects recorded against production lots.", "production", "COUNT", "One quality_defect row", "Production / Quality", ["quality_defect"], "quality_defect.created_at", ["all recorded defect severities"], [], "Refunds do not apply.", "Closed defects remain quality history.", PRODUCTION, "production_defects_count", ["day", "status"]),
  metric("production.rework_units", "Production rework units", "Integer rework quantities requested for production defects.", "production", "INTEGER", "SUM(quality_rework.quantity)", "Production / Quality", ["quality_rework"], "quality_rework.created_at", ["all recorded rework statuses"], [], "Refunds do not apply.", "Rework is not inventory adjustment or shipment quantity.", PRODUCTION, "production_rework_units", ["day", "status"]),
  metric("production.recalls_count", "Production recalls", "Recall proposals recorded by Production; activation and containment remain explicit recall states.", "production", "COUNT", "One production_recall row", "Production / Quality", ["production_recall"], "production_recall.created_at", ["all recorded recall statuses"], [], "Refunds do not apply.", "A recall does not directly mutate Orders, Shipping, Inventory, or Settlement.", PRODUCTION, "production_recalls_count", ["day", "status"]),
] as const;

export const ANALYTICS_METRIC_REGISTRY = new Map(ANALYTICS_METRICS.map((definition) => [definition.key, definition]));

export function getMetricDefinition(key: string): AnalyticsMetricDefinition | undefined {
  return ANALYTICS_METRIC_REGISTRY.get(key);
}

export function listMetricDefinitions(): AnalyticsMetricDefinition[] {
  return [...ANALYTICS_METRICS];
}

export function isAllowedDimension(value: string): value is AnalyticsDimension {
  return (ANALYTICS_DIMENSIONS as readonly string[]).includes(value);
}
