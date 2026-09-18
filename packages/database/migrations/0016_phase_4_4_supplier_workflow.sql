-- Phase 4.4 — Supplier Revision, Confirmation & Exception-Safe Fulfillment
-- Goals:
-- 1. Extend wholesale_request status CHECK to include revision_requested, cancelled, expired
-- 2. Extend order_event event_type CHECK to include new revision and child ready/exception events
-- 3. Extend command_idempotency command_type CHECK to include new Phase 4.4 commands
-- 4. Create wholesale_request_revision (VIP-owned, append-only, preserves history)
-- 5. Create fulfillment_exception (Fulfillment-owned, durable exception model)
-- 6. Add inventory_reservation.child_order_id for isolated release/consume
-- Forward-only, no destructive rewrite, no payment/shipping/finance tables

-- ── 1. wholesale_request status CHECK ─────────────────────────────────────
ALTER TABLE "wholesale_request" DROP CONSTRAINT IF EXISTS "wholesale_request_status_allowed";
ALTER TABLE "wholesale_request" ADD CONSTRAINT "wholesale_request_status_allowed" CHECK ("status" IN ('pending','supplier_review','revision_requested','accepted','rejected','cancelled','expired','ordered'));
--> statement-breakpoint

-- ── 2. order_event event_type CHECK ───────────────────────────────────────
ALTER TABLE "order_event" DROP CONSTRAINT IF EXISTS "order_event_event_type_allowed";
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_event_type_allowed" CHECK ("event_type" IN (
  'order.created','order.confirmed','order.payment_gated','order.processing_started','order.fulfillment_started','order.shipped','order.completed','order.cancelled',
  'child.created','child.confirmed','child.preparing','child.ready','child.shipped','child.delivered','child.cancelled','child.exception_opened','child.exception_resolved',
  'request.converted','request.revision_requested','request.revision_accepted','request.rejected','request.cancelled','request.expired',
  'inventory.reserved','inventory.released','inventory.consumed'
));
--> statement-breakpoint

-- ── 3. command_idempotency command_type CHECK ─────────────────────────────
ALTER TABLE "command_idempotency" DROP CONSTRAINT IF EXISTS "command_idempotency_command_type_allowed";
ALTER TABLE "command_idempotency" ADD CONSTRAINT "command_idempotency_command_type_allowed" CHECK ("command_type" IN (
  'inventory.reserve','inventory.reserve_package','inventory.release','inventory.confirm','inventory.adjust','inventory.expire_batch',
  'inventory.confirm_child','inventory.release_child',
  'vip.request_revision','vip.revision_response','vip.request_reject','vip.request_cancel','vip.request_expire',
  'orders.child_confirm','orders.child_prepare','orders.child_ready','orders.child_dispatch','orders.child_deliver','orders.child_cancel',
  'fulfillment.report_exception','fulfillment.resolve_exception'
));
--> statement-breakpoint

-- ── 4. wholesale_request_revision (VIP-owned, append-only) ─────────────────
CREATE TABLE "wholesale_request_revision" (
  "id" text PRIMARY KEY NOT NULL,
  "request_id" text NOT NULL,
  "request_version" integer NOT NULL,
  "revision_number" integer NOT NULL,
  "proposed_by_user_id" text NOT NULL,
  "proposed_by_role" text NOT NULL,
  "reason" text,
  "proposed_quantity" integer,
  "proposed_variant_id" text,
  "proposed_package_id" text,
  "pricing_unit" text,
  "proposed_unit_price" bigint,
  "currency" text DEFAULT 'IRR' NOT NULL,
  "proposed_terms_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "proposed_terms_hash" text,
  "buyer_responded_at" timestamp with time zone,
  "buyer_responded_by" text,
  "buyer_response" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_request_version_non_negative" CHECK ("request_version" >= 0);
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_revision_number_positive" CHECK ("revision_number" > 0);
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_proposed_quantity_non_negative" CHECK ("proposed_quantity" IS NULL OR "proposed_quantity" >= 0);
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_pricing_unit_allowed" CHECK ("pricing_unit" IS NULL OR "pricing_unit" IN ('PIECE','PACKAGE','SERIES','BOX','CARTON','SET','PER_PIECE'));
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_currency_allowed" CHECK ("currency" IN ('IRR'));
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_buyer_response_allowed" CHECK ("buyer_response" IS NULL OR "buyer_response" IN ('accepted','rejected'));
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_proposed_by_role_allowed" CHECK ("proposed_by_role" IN ('buyer','admin','supplier','system','fulfillment'));
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_proposed_unit_price_range" CHECK ("proposed_unit_price" IS NULL OR ("proposed_unit_price" >= 0 AND "proposed_unit_price" <= 1000000000000000));
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_selector_check" CHECK ((("proposed_variant_id" IS NULL AND "proposed_package_id" IS NULL) OR ("proposed_variant_id" IS NOT NULL AND "proposed_package_id" IS NULL) OR ("proposed_variant_id" IS NULL AND "proposed_package_id" IS NOT NULL)));
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_request_fk" FOREIGN KEY ("request_id") REFERENCES "wholesale_request"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_proposed_by_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_buyer_responded_by_fk" FOREIGN KEY ("buyer_responded_by") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_proposed_variant_fk" FOREIGN KEY ("proposed_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wholesale_request_revision" ADD CONSTRAINT "wholesale_request_revision_proposed_package_fk" FOREIGN KEY ("proposed_package_id") REFERENCES "wholesale_package"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "wholesale_request_revision_request_revision_unique" ON "wholesale_request_revision" ("request_id","revision_number");
--> statement-breakpoint
CREATE INDEX "wholesale_request_revision_request_created" ON "wholesale_request_revision" ("request_id","created_at");
--> statement-breakpoint

-- ── 5. fulfillment_exception (Fulfillment-owned) ───────────────────────────
CREATE TABLE "fulfillment_exception" (
  "id" text PRIMARY KEY NOT NULL,
  "child_order_id" text NOT NULL,
  "seller_id" text NOT NULL,
  "wholesale_order_id" text,
  "type" text NOT NULL,
  "reason_code" text,
  "reason" text,
  "status" text DEFAULT 'open' NOT NULL,
  "reported_by" text NOT NULL,
  "reported_at" timestamp with time zone DEFAULT now() NOT NULL,
  "affected_amount" bigint DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'IRR' NOT NULL,
  "affected_items_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "buyer_resolution" text,
  "buyer_resolved_at" timestamp with time zone,
  "buyer_resolved_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fulfillment_exception" ADD CONSTRAINT "fulfillment_exception_type_allowed" CHECK ("type" IN ('cannot_fulfill','partial_shortage','package_unavailable','operational_failure'));
--> statement-breakpoint
ALTER TABLE "fulfillment_exception" ADD CONSTRAINT "fulfillment_exception_status_allowed" CHECK ("status" IN ('open','awaiting_buyer','replacement_requested','resolved','cancelled'));
--> statement-breakpoint
ALTER TABLE "fulfillment_exception" ADD CONSTRAINT "fulfillment_exception_buyer_resolution_allowed" CHECK ("buyer_resolution" IS NULL OR "buyer_resolution" IN ('replacement_requested','quantity_reduction','cancel_portion'));
--> statement-breakpoint
ALTER TABLE "fulfillment_exception" ADD CONSTRAINT "fulfillment_exception_currency_allowed" CHECK ("currency" IN ('IRR'));
--> statement-breakpoint
ALTER TABLE "fulfillment_exception" ADD CONSTRAINT "fulfillment_exception_affected_amount_range" CHECK ("affected_amount" >= 0 AND "affected_amount" <= 1000000000000000);
--> statement-breakpoint
ALTER TABLE "fulfillment_exception" ADD CONSTRAINT "fulfillment_exception_child_fk" FOREIGN KEY ("child_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "fulfillment_exception" ADD CONSTRAINT "fulfillment_exception_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "fulfillment_exception" ADD CONSTRAINT "fulfillment_exception_wholesale_fk" FOREIGN KEY ("wholesale_order_id") REFERENCES "wholesale_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "fulfillment_exception" ADD CONSTRAINT "fulfillment_exception_reported_by_fk" FOREIGN KEY ("reported_by") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "fulfillment_exception" ADD CONSTRAINT "fulfillment_exception_buyer_resolved_by_fk" FOREIGN KEY ("buyer_resolved_by") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "fulfillment_exception_child_status" ON "fulfillment_exception" ("child_order_id","status");
--> statement-breakpoint
CREATE INDEX "fulfillment_exception_seller_status" ON "fulfillment_exception" ("seller_id","status");
--> statement-breakpoint
CREATE INDEX "fulfillment_exception_wholesale_status" ON "fulfillment_exception" ("wholesale_order_id","status");
--> statement-breakpoint

-- ── 6. inventory_reservation.child_order_id ───────────────────────────────
ALTER TABLE "inventory_reservation" ADD COLUMN "child_order_id" text;
--> statement-breakpoint
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_child_order_fk" FOREIGN KEY ("child_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "inventory_reservation_child_order" ON "inventory_reservation" ("child_order_id");
--> statement-breakpoint

-- ── 7. Ensure wholesale_order_request remains authoritative, no change ────
-- Documented in order-boundary.md

-- ── 8. No payment/shipping/finance tables added per Phase 4.4 scope ───────
