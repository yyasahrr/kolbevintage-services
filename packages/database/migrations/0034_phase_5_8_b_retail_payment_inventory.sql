/* Phase 5.8 Checkpoint B — retail payment linkage, paid status, relay facts.
 *
 * 1. `payment`: nullable `retail_order_id` (+FK, restrict) so the canonical
 *    PaymentsService can carry retail payments without a second payment
 *    authority. `wholesale_order_id` becomes nullable; exactly one order
 *    side must be set (`payment_single_order_side`). Retail idempotency gets
 *    the same partial-unique treatment as wholesale.
 * 2. `retail_order.payment_status`: `paid` joins the catalog. It is written
 *    only by verified-payment orchestration (never by checkout).
 * 3. `notification_event.event_key`: RETAIL_ORDER_CREATED/PAID/CANCELLED for
 *    the retail transactional relay (sourceDomain `retail`).
 * 4. `order_event.event_type`: `retail_order.paid` + `retail_order.cancelled`
 *    facts so every relay-worthy occurrence is a durable fact.
 *
 * Additive only: migrations 0000-0033 remain immutable.
 */

ALTER TABLE "payment" ADD COLUMN "retail_order_id" text;
--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "wholesale_order_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_single_order_side" CHECK (("wholesale_order_id" IS NULL) <> ("retail_order_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_retail_order_fk" FOREIGN KEY ("retail_order_id") REFERENCES "public"."retail_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_retail_order_idempotency_unique" ON "payment" USING btree ("retail_order_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "payment_retail_order_created" ON "payment" USING btree ("retail_order_id","created_at");
--> statement-breakpoint
ALTER TABLE "retail_order" DROP CONSTRAINT IF EXISTS "retail_order_payment_status_allowed";
--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_payment_status_allowed" CHECK ("payment_status" IN ('unpaid', 'pending_cod', 'paid'));
--> statement-breakpoint
ALTER TABLE "notification_event" DROP CONSTRAINT IF EXISTS "notification_event_key_allowed";
--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_key_allowed" CHECK ("event_key" IN ('AUTH_SECURITY_ALERT', 'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_FULFILLMENT_UPDATED', 'SHIPMENT_CREATED', 'SHIPMENT_SHIPPED', 'SHIPMENT_DELIVERED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'VIP_MEMBERSHIP_ACTIVATED', 'VIP_MEMBERSHIP_EXPIRING', 'VIP_MEMBERSHIP_SUSPENDED', 'SUPPLIER_ORDER_CREATED', 'SUPPLIER_ORDER_ACTION_REQUIRED', 'SUPPORT_CASE_CREATED', 'SUPPORT_CASE_REPLIED', 'SUPPORT_CASE_STATUS_CHANGED', 'SETTLEMENT_AVAILABLE', 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_APPROVED', 'PAYOUT_SUBMITTED', 'PAYOUT_RECONCILIATION_REQUIRED', 'COMPLIANCE_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_JOB_CREATED', 'SUPPLIER_PRODUCTION_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_QUALITY_UPDATED', 'SUPPLIER_PRODUCTION_RECALL_ACTION_REQUIRED', 'RETAIL_ORDER_CREATED', 'RETAIL_ORDER_PAID', 'RETAIL_ORDER_CANCELLED'));
--> statement-breakpoint
ALTER TABLE "order_event" DROP CONSTRAINT IF EXISTS "order_event_event_type_allowed";
--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_event_type_allowed" CHECK ("event_type" IN ('order.created', 'order.confirmed', 'order.payment_gated', 'order.processing_started', 'order.fulfillment_started', 'order.shipped', 'order.completed', 'order.cancelled', 'order.parent_cancelled', 'child.created', 'child.confirmed', 'child.preparing', 'child.ready', 'child.shipped', 'child.delivered', 'child.cancelled', 'child.exception_opened', 'child.exception_resolved', 'child.replacement_requested', 'request.converted', 'request.revision_requested', 'request.revision_accepted', 'request.rejected', 'request.cancelled', 'request.expired', 'request.replacement_created', 'fulfillment.replacement_linked', 'fulfillment.replacement_requested', 'inventory.reserved', 'inventory.released', 'inventory.consumed', 'proforma.issued', 'proforma.superseded', 'proforma.voided', 'payment.evidence_submitted', 'payment.verified', 'payment.failed', 'payment.allocated', 'payment.overpaid', 'financial.release_created', 'refund.requested', 'refund.approved', 'refund.completed', 'refund.failed', 'refund.cancelled', 'payment.provider_intent_created', 'payment.provider_callback_received', 'payment.provider_webhook_received', 'payment.provider_verified', 'payment.reconciled', 'shipping.quote_created', 'shipping.quote_selected', 'shipping.quote_expired', 'shipping.shipment_created', 'shipping.shipment_ready', 'shipping.shipment_handed_over', 'shipping.shipment_in_transit', 'shipping.shipment_delivered', 'shipping.shipment_cancelled', 'shipping.shipment_failed', 'retail_order.created', 'retail_order.paid', 'retail_order.cancelled'));
