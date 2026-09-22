/* Phase 5.8 Checkpoint B — one ACTIVE hold per (allocation, seller, variant).
 *
 * The Phase 4.1 `inventory_reservation_allocation_unique` index forbids any
 * second reservation row for an (allocation, seller, variant) triple — even
 * terminal history. Retail expiry reaps the hold but never the order, and a
 * later verify must re-reserve the lapsed line: that second row is
 * legitimate history, not a double hold. Scoping the predicate to
 * `status = 'active'` keeps the anti-double-hold guarantee (at most one
 * live hold per triple) while letting expired/confirmed/released rows
 * coexist as audit history. No backfill: existing rows are unaffected.
 *
 * Second, `notification_template.event_key` joins the 0034 relay keys.
 * Migration 0034 extended the `notification_event` CHECK but not the
 * template table's twin: without this, no template can ever be created for
 * the retail keys and every relayed delivery fails at enqueue (template
 * lookup, not send time). The declared schema (`tables.ts`) already lists
 * the retail keys for both tables; this brings the database to it.
 *
 * Migrations 0000-0034 remain immutable.
 */

DROP INDEX IF EXISTS "inventory_reservation_allocation_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_reservation_allocation_unique" ON "inventory_reservation" USING btree ("allocation_id","seller_id","variant_id") WHERE "allocation_id" IS NOT NULL AND "status" = 'active';
--> statement-breakpoint
ALTER TABLE "notification_template" DROP CONSTRAINT IF EXISTS "notification_template_event_key_allowed";
--> statement-breakpoint
ALTER TABLE "notification_template" ADD CONSTRAINT "notification_template_event_key_allowed" CHECK ("event_key" IN ('AUTH_SECURITY_ALERT', 'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_FULFILLMENT_UPDATED', 'SHIPMENT_CREATED', 'SHIPMENT_SHIPPED', 'SHIPMENT_DELIVERED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'VIP_MEMBERSHIP_ACTIVATED', 'VIP_MEMBERSHIP_EXPIRING', 'VIP_MEMBERSHIP_SUSPENDED', 'SUPPLIER_ORDER_CREATED', 'SUPPLIER_ORDER_ACTION_REQUIRED', 'SUPPORT_CASE_CREATED', 'SUPPORT_CASE_REPLIED', 'SUPPORT_CASE_STATUS_CHANGED', 'SETTLEMENT_AVAILABLE', 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_APPROVED', 'PAYOUT_SUBMITTED', 'PAYOUT_RECONCILIATION_REQUIRED', 'COMPLIANCE_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_JOB_CREATED', 'SUPPLIER_PRODUCTION_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_QUALITY_UPDATED', 'SUPPLIER_PRODUCTION_RECALL_ACTION_REQUIRED', 'RETAIL_ORDER_CREATED', 'RETAIL_ORDER_PAID', 'RETAIL_ORDER_CANCELLED'));
