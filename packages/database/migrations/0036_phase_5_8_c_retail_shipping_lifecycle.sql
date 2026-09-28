/* Phase 5.8 Checkpoint C — retail shipment linkage, fulfillment relay facts.
 *
 * 1. `shipment`: nullable `retail_order_id` (+FK, restrict) so the canonical
 *    ShippingService can carry retail shipments without a second shipment
 *    authority. `wholesale_order_id`/`child_order_id` become nullable; the
 *    wholesale side is all-or-nothing and exactly one order side must be set
 *    (`shipment_single_order_side`). Retail rows use `seller_id = KOLBE` and
 *    `shipping_responsibility = KOLBE` (server-set, never browser input).
 * 2. `shipment_item`: nullable `retail_order_item_id` (+FK, restrict);
 *    exactly one item side must be set (`shipment_item_single_order_side`).
 *    One row per (shipment, retail line), like the wholesale unique.
 * 3. `notification_event.event_key` + `notification_template.event_key`:
 *    RETAIL_ORDER_CONFIRMED + RETAIL_SHIPMENT_CREATED/HANDED_OVER/DELIVERED
 *    for the retail fulfillment relay (sourceDomain `retail`). Both twins
 *    move together (see the 0035 lesson).
 * 4. `order_event.event_type`: `retail_order.confirmed` +
 *    `retail_order.shipment_created/handed_over/delivered` facts so every
 *    relay-worthy fulfillment occurrence is a durable fact.
 *
 * Additive only: migrations 0000-0035 remain immutable.
 */

ALTER TABLE "shipment" ADD COLUMN "retail_order_id" text;
--> statement-breakpoint
ALTER TABLE "shipment" ALTER COLUMN "wholesale_order_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "shipment" ALTER COLUMN "child_order_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_single_order_side" CHECK ((("wholesale_order_id" IS NULL) = ("child_order_id" IS NULL)) AND (("wholesale_order_id" IS NULL) <> ("retail_order_id" IS NULL)));
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_retail_order_fk" FOREIGN KEY ("retail_order_id") REFERENCES "public"."retail_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "shipment_retail_created" ON "shipment" USING btree ("retail_order_id","created_at");
--> statement-breakpoint
ALTER TABLE "shipment_item" ADD COLUMN "retail_order_item_id" text;
--> statement-breakpoint
ALTER TABLE "shipment_item" ALTER COLUMN "wholesale_order_item_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "shipment_item" ADD CONSTRAINT "shipment_item_single_order_side" CHECK (("wholesale_order_item_id" IS NULL) <> ("retail_order_item_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "shipment_item" ADD CONSTRAINT "shipment_item_retail_item_fk" FOREIGN KEY ("retail_order_item_id") REFERENCES "public"."retail_order_item"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_item_shipment_retail_unique" ON "shipment_item" USING btree ("shipment_id","retail_order_item_id");
--> statement-breakpoint
CREATE INDEX "shipment_item_retail_item" ON "shipment_item" USING btree ("retail_order_item_id");
--> statement-breakpoint
ALTER TABLE "notification_event" DROP CONSTRAINT IF EXISTS "notification_event_key_allowed";
--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_key_allowed" CHECK ("event_key" IN ('AUTH_SECURITY_ALERT', 'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_FULFILLMENT_UPDATED', 'SHIPMENT_CREATED', 'SHIPMENT_SHIPPED', 'SHIPMENT_DELIVERED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'VIP_MEMBERSHIP_ACTIVATED', 'VIP_MEMBERSHIP_EXPIRING', 'VIP_MEMBERSHIP_SUSPENDED', 'SUPPLIER_ORDER_CREATED', 'SUPPLIER_ORDER_ACTION_REQUIRED', 'SUPPORT_CASE_CREATED', 'SUPPORT_CASE_REPLIED', 'SUPPORT_CASE_STATUS_CHANGED', 'SETTLEMENT_AVAILABLE', 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_APPROVED', 'PAYOUT_SUBMITTED', 'PAYOUT_RECONCILIATION_REQUIRED', 'COMPLIANCE_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_JOB_CREATED', 'SUPPLIER_PRODUCTION_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_QUALITY_UPDATED', 'SUPPLIER_PRODUCTION_RECALL_ACTION_REQUIRED', 'RETAIL_ORDER_CREATED', 'RETAIL_ORDER_PAID', 'RETAIL_ORDER_CANCELLED', 'RETAIL_ORDER_CONFIRMED', 'RETAIL_SHIPMENT_CREATED', 'RETAIL_SHIPMENT_HANDED_OVER', 'RETAIL_SHIPMENT_DELIVERED'));
--> statement-breakpoint
ALTER TABLE "notification_template" DROP CONSTRAINT IF EXISTS "notification_template_event_key_allowed";
--> statement-breakpoint
ALTER TABLE "notification_template" ADD CONSTRAINT "notification_template_event_key_allowed" CHECK ("event_key" IN ('AUTH_SECURITY_ALERT', 'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_FULFILLMENT_UPDATED', 'SHIPMENT_CREATED', 'SHIPMENT_SHIPPED', 'SHIPMENT_DELIVERED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'VIP_MEMBERSHIP_ACTIVATED', 'VIP_MEMBERSHIP_EXPIRING', 'VIP_MEMBERSHIP_SUSPENDED', 'SUPPLIER_ORDER_CREATED', 'SUPPLIER_ORDER_ACTION_REQUIRED', 'SUPPORT_CASE_CREATED', 'SUPPORT_CASE_REPLIED', 'SUPPORT_CASE_STATUS_CHANGED', 'SETTLEMENT_AVAILABLE', 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_APPROVED', 'PAYOUT_SUBMITTED', 'PAYOUT_RECONCILIATION_REQUIRED', 'COMPLIANCE_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_JOB_CREATED', 'SUPPLIER_PRODUCTION_ACTION_REQUIRED', 'SUPPLIER_PRODUCTION_QUALITY_UPDATED', 'SUPPLIER_PRODUCTION_RECALL_ACTION_REQUIRED', 'RETAIL_ORDER_CREATED', 'RETAIL_ORDER_PAID', 'RETAIL_ORDER_CANCELLED', 'RETAIL_ORDER_CONFIRMED', 'RETAIL_SHIPMENT_CREATED', 'RETAIL_SHIPMENT_HANDED_OVER', 'RETAIL_SHIPMENT_DELIVERED'));
--> statement-breakpoint
ALTER TABLE "order_event" DROP CONSTRAINT IF EXISTS "order_event_event_type_allowed";
--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_event_type_allowed" CHECK ("event_type" IN ('order.created', 'order.confirmed', 'order.payment_gated', 'order.processing_started', 'order.fulfillment_started', 'order.shipped', 'order.completed', 'order.cancelled', 'order.parent_cancelled', 'child.created', 'child.confirmed', 'child.preparing', 'child.ready', 'child.shipped', 'child.delivered', 'child.cancelled', 'child.exception_opened', 'child.exception_resolved', 'child.replacement_requested', 'request.converted', 'request.revision_requested', 'request.revision_accepted', 'request.rejected', 'request.cancelled', 'request.expired', 'request.replacement_created', 'fulfillment.replacement_linked', 'fulfillment.replacement_requested', 'inventory.reserved', 'inventory.released', 'inventory.consumed', 'proforma.issued', 'proforma.superseded', 'proforma.voided', 'payment.evidence_submitted', 'payment.verified', 'payment.failed', 'payment.allocated', 'payment.overpaid', 'financial.release_created', 'refund.requested', 'refund.approved', 'refund.completed', 'refund.failed', 'refund.cancelled', 'payment.provider_intent_created', 'payment.provider_callback_received', 'payment.provider_webhook_received', 'payment.provider_verified', 'payment.reconciled', 'shipping.quote_created', 'shipping.quote_selected', 'shipping.quote_expired', 'shipping.shipment_created', 'shipping.shipment_ready', 'shipping.shipment_handed_over', 'shipping.shipment_in_transit', 'shipping.shipment_delivered', 'shipping.shipment_cancelled', 'shipping.shipment_failed', 'retail_order.created', 'retail_order.paid', 'retail_order.cancelled', 'retail_order.confirmed', 'retail_order.shipment_created', 'retail_order.shipment_handed_over', 'retail_order.shipment_delivered'));
