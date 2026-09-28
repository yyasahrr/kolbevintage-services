-- Phase 4.7 — Provider-Ready Payment & Shipping Integration Foundation
-- Forward-only, RESTRICT FKs, no modification to 0019

-- ── 1. Evolve command_idempotency CHECK for new commands ───────────────
ALTER TABLE "command_idempotency" DROP CONSTRAINT IF EXISTS "command_idempotency_command_type_allowed";
ALTER TABLE "command_idempotency" ADD CONSTRAINT "command_idempotency_command_type_allowed" CHECK ("command_type" IN (
  'inventory.reserve','inventory.reserve_package','inventory.release','inventory.confirm','inventory.adjust','inventory.expire_batch',
  'inventory.confirm_child','inventory.release_child',
  'vip.request_revision','vip.revision_response','vip.request_reject','vip.request_cancel','vip.request_expire',
  'vip.create_replacement',
  'orders.child_confirm','orders.child_prepare','orders.child_ready','orders.child_dispatch','orders.child_deliver','orders.child_cancel',
  'orders.parent_cancel','orders.confirm','orders.payment_gate','orders.processing_release',
  'fulfillment.report_exception','fulfillment.resolve_exception','fulfillment.link_replacement',
  'admin.wholesale_cancel','admin.exception_resolve',
  'payments.issue_proforma','payments.submit_transfer','payments.verify','payments.reject','payments.allocate',
  'finance.credit_approve','finance.cod_approve','finance.manual_release','finance.release',
  'refunds.create','refunds.approve','refunds.complete','refunds.fail','refunds.cancel',
  'payments.create_online_intent','payments.provider_callback','payments.provider_webhook','payments.reconcile','payments.refund_provider',
  'shipping.quote_create','shipping.quote_select','shipping.shipment_create','shipping.shipment_handoff','shipping.shipment_tracking','shipping.shipment_deliver','shipping.shipment_cancel','shipping.reconcile'
));
--> statement-breakpoint

-- ── 2. Extend order_event CHECK for provider & shipping events ─────────
ALTER TABLE "order_event" DROP CONSTRAINT IF EXISTS "order_event_event_type_allowed";
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_event_type_allowed" CHECK ("event_type" IN (
  'order.created','order.confirmed','order.payment_gated','order.processing_started','order.fulfillment_started','order.shipped','order.completed','order.cancelled','order.parent_cancelled',
  'child.created','child.confirmed','child.preparing','child.ready','child.shipped','child.delivered','child.cancelled','child.exception_opened','child.exception_resolved','child.replacement_requested',
  'request.converted','request.revision_requested','request.revision_accepted','request.rejected','request.cancelled','request.expired','request.replacement_created',
  'fulfillment.replacement_linked','fulfillment.replacement_requested',
  'inventory.reserved','inventory.released','inventory.consumed',
  'proforma.issued','proforma.superseded','proforma.voided',
  'payment.evidence_submitted','payment.verified','payment.failed','payment.allocated','payment.overpaid',
  'financial.release_created',
  'refund.requested','refund.approved','refund.completed','refund.failed','refund.cancelled',
  'payment.provider_intent_created','payment.provider_callback_received','payment.provider_webhook_received','payment.provider_verified','payment.reconciled',
  'shipping.quote_created','shipping.quote_selected','shipping.quote_expired','shipping.shipment_created','shipping.shipment_ready','shipping.shipment_handed_over','shipping.shipment_in_transit','shipping.shipment_delivered','shipping.shipment_cancelled','shipping.shipment_failed'
));
--> statement-breakpoint

-- ── 3. Evolve payment table — provider-ready generic fields ────────────
ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "provider_reference" text;
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "provider_state" text;
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "redirect_url" text;
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "provider_payload_hash" text;
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "last_provider_call_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "provider_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- ── 4. payment_provider_event ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_provider_event" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "external_event_id" text NOT NULL,
  "external_payment_reference" text,
  "event_type" text DEFAULT 'unknown' NOT NULL,
  "payload_hash" text,
  "safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'received' NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "failure_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_provider_event_status_allowed" CHECK ("status" IN ('received','processing','processed','ignored','failed')),
  CONSTRAINT "payment_provider_event_type_allowed" CHECK ("event_type" IN ('payment.created','payment.pending','payment.success','payment.failed','payment.cancelled','refund.created','refund.success','refund.failed','unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_provider_event_provider_external_unique" ON "payment_provider_event" ("provider","external_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_provider_event_provider_created" ON "payment_provider_event" ("provider","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_provider_event_status_created" ON "payment_provider_event" ("status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_provider_event_external_ref" ON "payment_provider_event" ("external_payment_reference");
--> statement-breakpoint

-- ── 5. shipping_quote ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "shipping_quote" (
  "id" text PRIMARY KEY NOT NULL,
  "quote_reference" text NOT NULL,
  "provider" text DEFAULT 'manual' NOT NULL,
  "child_order_id" text NOT NULL,
  "service_level" text,
  "amount" bigint DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'IRR' NOT NULL,
  "estimated_from" timestamp with time zone,
  "estimated_to" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shipping_quote_reference_unique" UNIQUE("quote_reference"),
  CONSTRAINT "shipping_quote_status_allowed" CHECK ("status" IN ('active','selected','expired','voided')),
  CONSTRAINT "shipping_quote_currency_allowed" CHECK ("currency" IN ('IRR')),
  CONSTRAINT "shipping_quote_amount_range" CHECK ("amount" >= 0 AND "amount" <= 1000000000000000)
);
--> statement-breakpoint
ALTER TABLE "shipping_quote" ADD CONSTRAINT "shipping_quote_child_fk" FOREIGN KEY ("child_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipping_quote_child_created" ON "shipping_quote" ("child_order_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipping_quote_provider_created" ON "shipping_quote" ("provider","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipping_quote_status_created" ON "shipping_quote" ("status","created_at");
--> statement-breakpoint

-- ── 6. shipment ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "shipment" (
  "id" text PRIMARY KEY NOT NULL,
  "shipment_code" text NOT NULL,
  "wholesale_order_id" text NOT NULL,
  "child_order_id" text NOT NULL,
  "seller_id" text NOT NULL,
  "provider" text DEFAULT 'manual' NOT NULL,
  "shipping_responsibility" text DEFAULT 'SUPPLIER' NOT NULL,
  "external_reference" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "address_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "quote_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "tracking_code" text,
  "tracking_url" text,
  "handed_over_at" timestamp with time zone,
  "shipped_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shipment_code_unique" UNIQUE("shipment_code"),
  CONSTRAINT "shipment_status_allowed" CHECK ("status" IN ('pending','ready','handed_over','in_transit','delivered','cancelled','failed')),
  CONSTRAINT "shipment_shipping_responsibility_allowed" CHECK ("shipping_responsibility" IN ('SUPPLIER','KOLBE','EXTERNAL_CARRIER'))
);
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_wholesale_fk" FOREIGN KEY ("wholesale_order_id") REFERENCES "wholesale_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_child_fk" FOREIGN KEY ("child_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_wholesale_created" ON "shipment" ("wholesale_order_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_child_created" ON "shipment" ("child_order_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_seller_created" ON "shipment" ("seller_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_status_created" ON "shipment" ("status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_tracking_code" ON "shipment" ("tracking_code");
--> statement-breakpoint

-- ── 7. shipment_item ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "shipment_item" (
  "id" text PRIMARY KEY NOT NULL,
  "shipment_id" text NOT NULL,
  "wholesale_order_item_id" text NOT NULL,
  "purchase_order_item_id" text,
  "variant_id" text,
  "piece_quantity" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shipment_item_piece_quantity_positive" CHECK ("piece_quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "shipment_item" ADD CONSTRAINT "shipment_item_shipment_fk" FOREIGN KEY ("shipment_id") REFERENCES "shipment"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "shipment_item" ADD CONSTRAINT "shipment_item_wholesale_item_fk" FOREIGN KEY ("wholesale_order_item_id") REFERENCES "wholesale_order_item"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "shipment_item" ADD CONSTRAINT "shipment_item_purchase_item_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_item"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "shipment_item" ADD CONSTRAINT "shipment_item_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_item_shipment_wholesale_unique" ON "shipment_item" ("shipment_id","wholesale_order_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_item_shipment_created" ON "shipment_item" ("shipment_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_item_wholesale_item" ON "shipment_item" ("wholesale_order_item_id");
--> statement-breakpoint

-- ── 8. shipment_event ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "shipment_event" (
  "id" text PRIMARY KEY NOT NULL,
  "shipment_id" text NOT NULL,
  "provider" text NOT NULL,
  "external_event_id" text NOT NULL,
  "event_type" text DEFAULT 'unknown' NOT NULL,
  "payload_hash" text,
  "safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'received' NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "failure_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shipment_event_status_allowed" CHECK ("status" IN ('received','processing','processed','ignored','failed')),
  CONSTRAINT "shipment_event_type_allowed" CHECK ("event_type" IN ('quote.created','quote.expired','shipment.created','shipment.ready','shipment.handed_over','shipment.in_transit','shipment.delivered','shipment.cancelled','shipment.failed','unknown'))
);
--> statement-breakpoint
ALTER TABLE "shipment_event" ADD CONSTRAINT "shipment_event_shipment_fk" FOREIGN KEY ("shipment_id") REFERENCES "shipment"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_event_provider_external_unique" ON "shipment_event" ("provider","external_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_event_shipment_created" ON "shipment_event" ("shipment_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_event_provider_created" ON "shipment_event" ("provider","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_event_status_created" ON "shipment_event" ("status","created_at");
--> statement-breakpoint

-- ── 9. Append-only guard for provider events (optional, but keep mutable for status transitions) ──
-- No trigger blocking UPDATE — status transitions received→processing→processed are allowed
-- Only ensure amount checks etc already via CHECKs

-- ── 10. No wallet/settlement/payout — Phase 4.8 ───────────────────────
-- Explicitly NOT adding supplier wallet, commission, settlement batches, payout per Phase 4.7 scope
