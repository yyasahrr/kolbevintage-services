-- Phase 4.5 — VIP/Admin Order Management, Replacement Workflow & Full Parent Cancellation
-- Goals:
-- 1. Create fulfillment_replacement_request (Fulfillment-owned link table)
-- 2. Extend command_idempotency CHECK for Phase 4.5 commands
-- 3. Extend order_event CHECK for parent cancellation and replacement events
-- 4. No payment/refund/wallet/payout tables, no money movement
-- Forward-only, RESTRICT FKs, no CASCADE

-- ── 1. Extend command_idempotency CHECK ─────────────────────────────────
ALTER TABLE "command_idempotency" DROP CONSTRAINT IF EXISTS "command_idempotency_command_type_allowed";
ALTER TABLE "command_idempotency" ADD CONSTRAINT "command_idempotency_command_type_allowed" CHECK ("command_type" IN (
  'inventory.reserve','inventory.reserve_package','inventory.release','inventory.confirm','inventory.adjust','inventory.expire_batch',
  'inventory.confirm_child','inventory.release_child',
  'vip.request_revision','vip.revision_response','vip.request_reject','vip.request_cancel','vip.request_expire',
  'vip.create_replacement',
  'orders.child_confirm','orders.child_prepare','orders.child_ready','orders.child_dispatch','orders.child_deliver','orders.child_cancel',
  'orders.parent_cancel',
  'fulfillment.report_exception','fulfillment.resolve_exception','fulfillment.link_replacement',
  'admin.wholesale_cancel','admin.exception_resolve'
));
--> statement-breakpoint

-- ── 2. Extend order_event CHECK ─────────────────────────────────────────
ALTER TABLE "order_event" DROP CONSTRAINT IF EXISTS "order_event_event_type_allowed";
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_event_type_allowed" CHECK ("event_type" IN (
  'order.created','order.confirmed','order.payment_gated','order.processing_started','order.fulfillment_started','order.shipped','order.completed','order.cancelled','order.parent_cancelled',
  'child.created','child.confirmed','child.preparing','child.ready','child.shipped','child.delivered','child.cancelled','child.exception_opened','child.exception_resolved','child.replacement_requested',
  'request.converted','request.revision_requested','request.revision_accepted','request.rejected','request.cancelled','request.expired','request.replacement_created',
  'fulfillment.replacement_linked','fulfillment.replacement_requested',
  'inventory.reserved','inventory.released','inventory.consumed'
));
--> statement-breakpoint

-- ── 3. fulfillment_replacement_request (Fulfillment-owned) ──────────────
CREATE TABLE "fulfillment_replacement_request" (
  "id" text PRIMARY KEY NOT NULL,
  "exception_id" text NOT NULL,
  "replacement_request_id" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fulfillment_replacement_request" ADD CONSTRAINT "fulfillment_replacement_request_exception_fk" FOREIGN KEY ("exception_id") REFERENCES "fulfillment_exception"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "fulfillment_replacement_request" ADD CONSTRAINT "fulfillment_replacement_request_replacement_fk" FOREIGN KEY ("replacement_request_id") REFERENCES "wholesale_request"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "fulfillment_replacement_request" ADD CONSTRAINT "fulfillment_replacement_request_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_replacement_request_exception_unique" ON "fulfillment_replacement_request" ("exception_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_replacement_request_replacement_unique" ON "fulfillment_replacement_request" ("replacement_request_id");
--> statement-breakpoint
CREATE INDEX "fulfillment_replacement_request_exception_created" ON "fulfillment_replacement_request" ("exception_id","created_at");
--> statement-breakpoint
CREATE INDEX "fulfillment_replacement_request_created" ON "fulfillment_replacement_request" ("created_at");

-- ── 4. No payment/refund tables added per Phase 4.5 scope ───────────────
