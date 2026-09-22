/* Phase 5.8 Checkpoint A — canonical Retail commerce foundation (Nest-owned).
 *
 * The legacy Next.js writer priced from a hardcoded TS catalog and kept no
 * promotion attribution, legal reference, request fingerprint, or status
 * history. This migration evolves the existing retail tables (no replacement,
 * no data loss) so the canonical Nest RetailOrdersService can own them:
 *
 * 1. `retail_order`: promotion discount total, legal snapshot reference,
 *    creation request hash, and an optimistic-locking version, plus the
 *    commercial total-equation CHECKs. All legacy columns are preserved;
 *    `lines` / `payment_method` / `fulfillment_status` stay frozen for
 *    rollback safety (REMOVE-LATER, only after the compat proxy is gone).
 * 2. `retail_order_item`: variant reference (truthful NULL for legacy rows),
 *    stored base line total, and per-line promotion discount, plus the
 *    per-line equation CHECKs. Backfill is provable, not manufactured:
 *    legacy orders had no promotions, so base_line_total = line_total and
 *    promotion_discount = 0 for every pre-existing row.
 * 3. New `retail_order_event`: append-only status history generalizing the
 *    `order_status_history` pattern (that table FKs to wholesale_order, so
 *    reuse is impossible). Creation is the from_status-NULL row.
 * 4. `order_event` CHECKs extended: aggregate `retail_order` + event
 *    `retail_order.created` so the canonical checkout can broadcast the
 *    creation fact on the shared outbox table.
 *
 * Additive only: migrations 0000-0032 remain immutable.
 */

ALTER TABLE "retail_order" ADD COLUMN "promotion_discount_total" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "retail_order" ADD COLUMN "legal_snapshot_id" text;
--> statement-breakpoint
ALTER TABLE "retail_order" ADD COLUMN "creation_request_hash" text;
--> statement-breakpoint
ALTER TABLE "retail_order" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_promotion_discount_total_range" CHECK ("promotion_discount_total" >= 0 AND "promotion_discount_total" <= 1000000000000000);
--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_promo_discount_within_items" CHECK ("promotion_discount_total" <= "items_total");
--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_totals_equation" CHECK ("total_amount" = "items_total" - "promotion_discount_total" + "shipping_price");
--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_version_non_negative" CHECK ("version" >= 0);
--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD COLUMN "variant_id" text;
--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD COLUMN "base_line_total" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD COLUMN "promotion_discount" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "retail_order_item" SET "base_line_total" = "line_total";
--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD CONSTRAINT "retail_order_item_base_line_total_range" CHECK ("base_line_total" >= 0 AND "base_line_total" <= 1000000000000000);
--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD CONSTRAINT "retail_order_item_promotion_discount_amount_range" CHECK ("promotion_discount" >= 0 AND "promotion_discount" <= 1000000000000000);
--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD CONSTRAINT "retail_order_item_promo_within_base" CHECK ("promotion_discount" <= "base_line_total");
--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD CONSTRAINT "retail_order_item_line_equation" CHECK ("line_total" = "base_line_total" - "promotion_discount");
--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD CONSTRAINT "retail_order_item_base_equation" CHECK ("base_line_total" = "unit_price" * "quantity");
--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD CONSTRAINT "retail_order_item_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "retail_order_event" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor_id" text,
  "actor_role" text,
  "reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "order_version" integer DEFAULT 0 NOT NULL,
  "idempotency_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "retail_order_event_order_fk" FOREIGN KEY ("order_id") REFERENCES "public"."retail_order"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "retail_order_event_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "retail_order_event_from_status_allowed" CHECK ("from_status" IS NULL OR "from_status" IN ('placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned')),
  CONSTRAINT "retail_order_event_to_status_allowed" CHECK ("to_status" IN ('placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned')),
  CONSTRAINT "retail_order_event_actor_role_allowed" CHECK ("actor_role" IN ('customer', 'guest', 'admin', 'system')),
  CONSTRAINT "retail_order_event_order_version_non_negative" CHECK ("order_version" >= 0)
);
--> statement-breakpoint
CREATE INDEX "retail_order_event_order_created" ON "retail_order_event" USING btree ("order_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "retail_order_event_order_version_unique" ON "retail_order_event" USING btree ("order_id", "order_version");
--> statement-breakpoint
ALTER TABLE "order_event" DROP CONSTRAINT IF EXISTS "order_event_aggregate_type_allowed";
--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_aggregate_type_allowed" CHECK ("aggregate_type" IN ('wholesale_order', 'purchase_order', 'retail_order'));
--> statement-breakpoint
ALTER TABLE "order_event" DROP CONSTRAINT IF EXISTS "order_event_event_type_allowed";
--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_event_type_allowed" CHECK ("event_type" IN ('order.created', 'order.confirmed', 'order.payment_gated', 'order.processing_started', 'order.fulfillment_started', 'order.shipped', 'order.completed', 'order.cancelled', 'order.parent_cancelled', 'child.created', 'child.confirmed', 'child.preparing', 'child.ready', 'child.shipped', 'child.delivered', 'child.cancelled', 'child.exception_opened', 'child.exception_resolved', 'child.replacement_requested', 'request.converted', 'request.revision_requested', 'request.revision_accepted', 'request.rejected', 'request.cancelled', 'request.expired', 'request.replacement_created', 'fulfillment.replacement_linked', 'fulfillment.replacement_requested', 'inventory.reserved', 'inventory.released', 'inventory.consumed', 'proforma.issued', 'proforma.superseded', 'proforma.voided', 'payment.evidence_submitted', 'payment.verified', 'payment.failed', 'payment.allocated', 'payment.overpaid', 'financial.release_created', 'refund.requested', 'refund.approved', 'refund.completed', 'refund.failed', 'refund.cancelled', 'payment.provider_intent_created', 'payment.provider_callback_received', 'payment.provider_webhook_received', 'payment.provider_verified', 'payment.reconciled', 'shipping.quote_created', 'shipping.quote_selected', 'shipping.quote_expired', 'shipping.shipment_created', 'shipping.shipment_ready', 'shipping.shipment_handed_over', 'shipping.shipment_in_transit', 'shipping.shipment_delivered', 'shipping.shipment_cancelled', 'shipping.shipment_failed', 'retail_order.created'));
