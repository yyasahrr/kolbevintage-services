ALTER TABLE "refund" ADD COLUMN "retail_order_id" text;
--> statement-breakpoint
ALTER TABLE "refund" ALTER COLUMN "wholesale_order_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_single_order_side" CHECK (("wholesale_order_id" IS NULL) <> ("retail_order_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_retail_order_fk" FOREIGN KEY ("retail_order_id") REFERENCES "public"."retail_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "refund_retail_order_idempotency_unique" ON "refund" USING btree ("retail_order_id","idempotency_key") WHERE "refund"."idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "refund_retail_order_created" ON "refund" USING btree ("retail_order_id","created_at");
--> statement-breakpoint
ALTER TABLE "refund_line" ADD COLUMN "retail_order_item_id" text;
--> statement-breakpoint
ALTER TABLE "refund_line" ALTER COLUMN "wholesale_order_item_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "refund_line" ADD CONSTRAINT "refund_line_single_item_side" CHECK (("wholesale_order_item_id" IS NULL) <> ("retail_order_item_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "refund_line" ADD CONSTRAINT "refund_line_retail_item_fk" FOREIGN KEY ("retail_order_item_id") REFERENCES "public"."retail_order_item"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "refund_line_refund_retail_item_unique" ON "refund_line" USING btree ("refund_id","retail_order_item_id") WHERE "refund_line"."retail_order_item_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "refund_line_retail_item" ON "refund_line" USING btree ("retail_order_item_id");
--> statement-breakpoint
ALTER TABLE "financial_ledger_entry" ADD COLUMN "retail_order_id" text;
--> statement-breakpoint
ALTER TABLE "financial_ledger_entry" ALTER COLUMN "order_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "financial_ledger_entry" ADD CONSTRAINT "financial_ledger_single_order_side" CHECK (("order_id" IS NULL) <> ("retail_order_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "financial_ledger_entry" ADD CONSTRAINT "financial_ledger_retail_order_fk" FOREIGN KEY ("retail_order_id") REFERENCES "public"."retail_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "financial_ledger_retail_order_created" ON "financial_ledger_entry" USING btree ("retail_order_id","created_at");
--> statement-breakpoint
ALTER TABLE "order_event" DROP CONSTRAINT IF EXISTS "order_event_event_type_allowed";
--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_event_type_allowed" CHECK ("event_type" IN ('order.created', 'order.confirmed', 'order.payment_gated', 'order.processing_started', 'order.fulfillment_started', 'order.shipped', 'order.completed', 'order.cancelled', 'order.parent_cancelled', 'child.created', 'child.confirmed', 'child.preparing', 'child.ready', 'child.shipped', 'child.delivered', 'child.cancelled', 'child.exception_opened', 'child.exception_resolved', 'child.replacement_requested', 'request.converted', 'request.revision_requested', 'request.revision_accepted', 'request.rejected', 'request.cancelled', 'request.expired', 'request.replacement_created', 'fulfillment.replacement_linked', 'fulfillment.replacement_requested', 'inventory.reserved', 'inventory.released', 'inventory.consumed', 'proforma.issued', 'proforma.superseded', 'proforma.voided', 'payment.evidence_submitted', 'payment.verified', 'payment.failed', 'payment.allocated', 'payment.overpaid', 'financial.release_created', 'refund.requested', 'refund.approved', 'refund.completed', 'refund.failed', 'refund.cancelled', 'payment.provider_intent_created', 'payment.provider_callback_received', 'payment.provider_webhook_received', 'payment.provider_verified', 'payment.reconciled', 'shipping.quote_created', 'shipping.quote_selected', 'shipping.quote_expired', 'shipping.shipment_created', 'shipping.shipment_ready', 'shipping.shipment_handed_over', 'shipping.shipment_in_transit', 'shipping.shipment_delivered', 'shipping.shipment_cancelled', 'shipping.shipment_failed', 'retail_order.created', 'retail_order.paid', 'retail_order.cancelled', 'retail_order.confirmed', 'retail_order.shipment_created', 'retail_order.shipment_handed_over', 'retail_order.shipment_delivered', 'retail_order.refund_requested', 'retail_order.refund_completed'));
