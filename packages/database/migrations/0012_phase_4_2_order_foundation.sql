-- Phase 4.2 — Wholesale Order Database Foundation
-- Goals: evolve existing wholesale_order, wholesale_order_item, purchase_order, purchase_order_item
-- into canonical foundation with immutable snapshots, scoped idempotency, KOLBE nullable supplier,
-- status history/events, inventory linkage. Pre-launch dev fixture cleanup documented.

-- ── wholesale_order evolution ─────────────────────────────────────────────

-- Add new columns as nullable first to allow backfill
ALTER TABLE "wholesale_order" ADD COLUMN "buyer_user_id" text;
ALTER TABLE "wholesale_order" ADD COLUMN "originating_request_id" text;
ALTER TABLE "wholesale_order" ADD COLUMN "currency" text DEFAULT 'IRR' NOT NULL;
ALTER TABLE "wholesale_order" ADD COLUMN "items_total" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "wholesale_order" ADD COLUMN "shipping_total" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "wholesale_order" ADD COLUMN "grand_total" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "wholesale_order" ADD COLUMN "pricing_version" text;
ALTER TABLE "wholesale_order" ADD COLUMN "payment_mode" text;
ALTER TABLE "wholesale_order" ADD COLUMN "shipping_address_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "wholesale_order" ADD COLUMN "billing_address_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "wholesale_order" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "wholesale_order" ADD COLUMN "confirmed_at" timestamp with time zone;
ALTER TABLE "wholesale_order" ADD COLUMN "cancelled_at" timestamp with time zone;
ALTER TABLE "wholesale_order" ADD COLUMN "completed_at" timestamp with time zone;
ALTER TABLE "wholesale_order" ADD COLUMN "cancellation_reason" text;
ALTER TABLE "wholesale_order" ADD COLUMN "cancelled_by" text;
--> statement-breakpoint

-- Backfill buyer_user_id from wholesale_account.user_id
UPDATE "wholesale_order" SET "buyer_user_id" = "wholesale_account"."user_id"
FROM "wholesale_account" WHERE "wholesale_order"."account_id" = "wholesale_account"."id" AND "wholesale_order"."buyer_user_id" IS NULL;
--> statement-breakpoint

-- For any remaining null buyer_user_id (orphaned dev fixtures), attempt to set from account_user if account_id matches user_id, else delete invalid rows (pre-launch cleanup)
-- First, delete orders where account_id does not exist in wholesale_account (invalid dev fixture)
DELETE FROM "wholesale_order_item" WHERE "order_id" IN (SELECT "id" FROM "wholesale_order" WHERE "buyer_user_id" IS NULL);
DELETE FROM "wholesale_order" WHERE "buyer_user_id" IS NULL AND "account_id" NOT IN (SELECT "id" FROM "wholesale_account");
--> statement-breakpoint

-- For remaining nulls where wholesale_account exists but user_id is null? wholesale_account.user_id is NOT NULL, so should be backfilled. If still null, delete.
DELETE FROM "wholesale_order_item" WHERE "order_id" IN (SELECT "id" FROM "wholesale_order" WHERE "buyer_user_id" IS NULL);
DELETE FROM "wholesale_order" WHERE "buyer_user_id" IS NULL;
--> statement-breakpoint

-- Backfill totals from total_amount
UPDATE "wholesale_order" SET "items_total" = "total_amount", "grand_total" = "total_amount", "shipping_total" = 0 WHERE "items_total" = 0 AND "total_amount" != 0;
--> statement-breakpoint

-- Status mapping: pending→draft, approved→confirmed, fulfilling→fulfillment, fulfilled→completed, cancelled→cancelled
UPDATE "wholesale_order" SET "status" = 'draft' WHERE "status" = 'pending';
UPDATE "wholesale_order" SET "status" = 'confirmed' WHERE "status" = 'approved';
UPDATE "wholesale_order" SET "status" = 'fulfillment' WHERE "status" = 'fulfilling';
UPDATE "wholesale_order" SET "status" = 'completed' WHERE "status" = 'fulfilled';
-- cancelled stays cancelled
--> statement-breakpoint

-- Drop old constraints and indexes
DROP INDEX IF EXISTS "wholesale_order_idempotency";
ALTER TABLE "wholesale_order" DROP CONSTRAINT IF EXISTS "wholesale_order_status_allowed";
ALTER TABLE "wholesale_order" DROP CONSTRAINT IF EXISTS "wholesale_order_total_amount_range";
ALTER TABLE "wholesale_order" DROP CONSTRAINT IF EXISTS "wholesale_order_total_units_non_negative";
--> statement-breakpoint

-- Make buyer_user_id NOT NULL after backfill
ALTER TABLE "wholesale_order" ALTER COLUMN "buyer_user_id" SET NOT NULL;
--> statement-breakpoint

-- Add new CHECKs and constraints
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_status_allowed" CHECK ("status" IN ('draft','confirmed','awaiting_payment','processing','fulfillment','shipped','completed','cancelled'));
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_currency_allowed" CHECK ("currency" IN ('IRR'));
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_payment_mode_allowed" CHECK ("payment_mode" IN ('prepaid','credit','on_delivery','transfer','cod'));
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_total_amount_range" CHECK ("total_amount" >= 0 AND "total_amount" <= 1000000000000000);
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_items_total_range" CHECK ("items_total" >= 0 AND "items_total" <= 1000000000000000);
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_shipping_total_range" CHECK ("shipping_total" >= 0 AND "shipping_total" <= 1000000000000000);
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_grand_total_range" CHECK ("grand_total" >= 0 AND "grand_total" <= 1000000000000000);
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_total_units_non_negative" CHECK ("total_units" >= 0);
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_version_non_negative" CHECK ("version" >= 0);
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_grand_total_equation" CHECK ("grand_total" >= "items_total" AND "grand_total" >= "shipping_total");
--> statement-breakpoint

-- Add FKs
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_buyer_user_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_originating_request_fk" FOREIGN KEY ("originating_request_id") REFERENCES "wholesale_request"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_cancelled_by_fk" FOREIGN KEY ("cancelled_by") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

-- Add new indexes
CREATE UNIQUE INDEX "wholesale_order_account_idempotency_unique" ON "wholesale_order" ("account_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "wholesale_order_originating_request_unique" ON "wholesale_order" ("originating_request_id") WHERE "originating_request_id" IS NOT NULL;
CREATE INDEX "wholesale_order_account_created" ON "wholesale_order" ("account_id", "created_at");
CREATE INDEX "wholesale_order_status_created" ON "wholesale_order" ("status", "created_at");
CREATE INDEX "wholesale_order_buyer_created" ON "wholesale_order" ("buyer_user_id", "created_at");
--> statement-breakpoint

-- ── wholesale_order_item evolution ────────────────────────────────────────

ALTER TABLE "wholesale_order_item" ADD COLUMN "seller_id" text;
ALTER TABLE "wholesale_order_item" ADD COLUMN "supplier_id" text;
ALTER TABLE "wholesale_order_item" ADD COLUMN "package_id" text;
ALTER TABLE "wholesale_order_item" ADD COLUMN "pricing_tier_id" text;
ALTER TABLE "wholesale_order_item" ADD COLUMN "product_name_snapshot" text DEFAULT '' NOT NULL;
ALTER TABLE "wholesale_order_item" ADD COLUMN "sku_snapshot" text;
ALTER TABLE "wholesale_order_item" ADD COLUMN "variant_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "wholesale_order_item" ADD COLUMN "seller_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "wholesale_order_item" ADD COLUMN "package_type_snapshot" text;
ALTER TABLE "wholesale_order_item" ADD COLUMN "package_name_snapshot" text;
ALTER TABLE "wholesale_order_item" ADD COLUMN "package_composition_snapshot" jsonb;
ALTER TABLE "wholesale_order_item" ADD COLUMN "moq_unit_snapshot" text;
ALTER TABLE "wholesale_order_item" ADD COLUMN "pricing_unit" text DEFAULT 'PIECE' NOT NULL;
ALTER TABLE "wholesale_order_item" ADD COLUMN "package_quantity" integer;
ALTER TABLE "wholesale_order_item" ADD COLUMN "piece_quantity" integer DEFAULT 1 NOT NULL;
ALTER TABLE "wholesale_order_item" ADD COLUMN "line_total" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "wholesale_order_item" ADD COLUMN "currency" text DEFAULT 'IRR' NOT NULL;
--> statement-breakpoint

-- Backfill snapshots from existing columns
UPDATE "wholesale_order_item" SET "product_name_snapshot" = "product_name" WHERE "product_name_snapshot" = '';
UPDATE "wholesale_order_item" SET "sku_snapshot" = "sku" WHERE "sku_snapshot" IS NULL;
UPDATE "wholesale_order_item" SET "piece_quantity" = "quantity" WHERE "piece_quantity" = 1 AND "quantity" != 1;
UPDATE "wholesale_order_item" SET "line_total" = "unit_price" * "quantity" WHERE "line_total" = 0;
--> statement-breakpoint

-- Backfill seller_id from seller_offer
UPDATE "wholesale_order_item" SET "seller_id" = "seller_offer"."seller_id"
FROM "seller_offer" WHERE "wholesale_order_item"."seller_offer_id" = "seller_offer"."id" AND "wholesale_order_item"."seller_id" IS NULL;
--> statement-breakpoint

-- For remaining null seller_id, use KOLBE seller if exists, else first seller
UPDATE "wholesale_order_item" SET "seller_id" = (SELECT "id" FROM "seller" WHERE "type" = 'KOLBE' LIMIT 1) WHERE "seller_id" IS NULL;
UPDATE "wholesale_order_item" SET "seller_id" = (SELECT "id" FROM "seller" LIMIT 1) WHERE "seller_id" IS NULL;
--> statement-breakpoint

-- Delete invalid items where seller_id still null (should not happen after above, but safety)
DELETE FROM "wholesale_order_item" WHERE "seller_id" IS NULL;
--> statement-breakpoint

-- Make seller_id NOT NULL
ALTER TABLE "wholesale_order_item" ALTER COLUMN "seller_id" SET NOT NULL;
--> statement-breakpoint

-- Drop old constraints
ALTER TABLE "wholesale_order_item" DROP CONSTRAINT IF EXISTS "wholesale_order_item_quantity_non_negative";
ALTER TABLE "wholesale_order_item" DROP CONSTRAINT IF EXISTS "wholesale_order_item_unit_price_range";
--> statement-breakpoint

-- Add new constraints
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_package_type_allowed" CHECK ("package_type_snapshot" IN ('SIZE_RUN','FIXED_QUANTITY','COLOR_MIX','CUSTOM_BUNDLE'));
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_moq_unit_allowed" CHECK ("moq_unit_snapshot" IN ('PIECE','PACKAGE','SERIES','BOX','CARTON','SET'));
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_pricing_unit_allowed" CHECK ("pricing_unit" IN ('PIECE','PACKAGE','SERIES','BOX','CARTON','SET','PER_PIECE'));
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_currency_allowed" CHECK ("currency" IN ('IRR'));
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_package_quantity_non_negative" CHECK ("package_quantity" IS NULL OR "package_quantity" >= 0);
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_piece_quantity_positive" CHECK ("piece_quantity" > 0);
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_unit_price_range" CHECK ("unit_price" >= 0 AND "unit_price" <= 1000000000000000);
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_line_total_range" CHECK ("line_total" >= 0 AND "line_total" <= 1000000000000000);
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_seller_supplier_consistency" CHECK (("supplier_id" IS NULL) OR ("supplier_id" IS NOT NULL AND "seller_id" IS NOT NULL));
--> statement-breakpoint

-- Add FKs
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_package_fk" FOREIGN KEY ("package_id") REFERENCES "wholesale_package"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_pricing_tier_fk" FOREIGN KEY ("pricing_tier_id") REFERENCES "wholesale_pricing_tier"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

-- Add indexes
CREATE INDEX "wholesale_order_item_order" ON "wholesale_order_item" ("order_id");
CREATE INDEX "wholesale_order_item_seller_order" ON "wholesale_order_item" ("seller_id", "order_id");
CREATE INDEX "wholesale_order_item_product" ON "wholesale_order_item" ("product_id");
--> statement-breakpoint

-- ── purchase_order evolution ──────────────────────────────────────────────

-- Add seller_id column (nullable first)
ALTER TABLE "purchase_order" ADD COLUMN "seller_id" text;
ALTER TABLE "purchase_order" ADD COLUMN "items_total" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "purchase_order" ADD COLUMN "grand_total" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "purchase_order" ADD COLUMN "shipping_responsibility" text DEFAULT 'SUPPLIER' NOT NULL;
ALTER TABLE "purchase_order" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "purchase_order" ADD COLUMN "due_at" timestamp with time zone;
ALTER TABLE "purchase_order" ADD COLUMN "confirmed_at" timestamp with time zone;
ALTER TABLE "purchase_order" ADD COLUMN "preparation_started_at" timestamp with time zone;
ALTER TABLE "purchase_order" ADD COLUMN "ready_at" timestamp with time zone;
ALTER TABLE "purchase_order" ADD COLUMN "cancelled_at" timestamp with time zone;
ALTER TABLE "purchase_order" ADD COLUMN "cancellation_reason" text;
--> statement-breakpoint

-- Backfill seller_id from supplier -> seller
UPDATE "purchase_order" SET "seller_id" = "seller"."id"
FROM "seller" WHERE "purchase_order"."supplier_id" = "seller"."supplier_id" AND "purchase_order"."seller_id" IS NULL;
--> statement-breakpoint

-- For any remaining null seller_id (should not happen, but safety for KOLBE case), use KOLBE seller
UPDATE "purchase_order" SET "seller_id" = (SELECT "id" FROM "seller" WHERE "type" = 'KOLBE' LIMIT 1) WHERE "seller_id" IS NULL;
--> statement-breakpoint

-- Delete invalid purchase orders where seller_id still null
DELETE FROM "purchase_order_item" WHERE "purchase_order_id" IN (SELECT "id" FROM "purchase_order" WHERE "seller_id" IS NULL);
DELETE FROM "purchase_order" WHERE "seller_id" IS NULL;
--> statement-breakpoint

-- Make seller_id NOT NULL
ALTER TABLE "purchase_order" ALTER COLUMN "seller_id" SET NOT NULL;
--> statement-breakpoint

-- Make supplier_id nullable (for KOLBE)
ALTER TABLE "purchase_order" ALTER COLUMN "supplier_id" DROP NOT NULL;
--> statement-breakpoint

-- Backfill totals and due_at
UPDATE "purchase_order" SET "items_total" = "total_amount", "grand_total" = "total_amount" WHERE "items_total" = 0;
UPDATE "purchase_order" SET "due_at" = "due_date" WHERE "due_at" IS NULL AND "due_date" IS NOT NULL;
--> statement-breakpoint

-- Drop old constraints
ALTER TABLE "purchase_order" DROP CONSTRAINT IF EXISTS "purchase_order_status_allowed";
ALTER TABLE "purchase_order" DROP CONSTRAINT IF EXISTS "purchase_order_total_amount_range";
ALTER TABLE "purchase_order" DROP CONSTRAINT IF EXISTS "purchase_order_currency_allowed";
--> statement-breakpoint

-- Add new constraints
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_status_allowed" CHECK ("status" IN ('pending','confirmed','preparing','shipped','delivered','cancelled'));
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_shipping_responsibility_allowed" CHECK ("shipping_responsibility" IN ('SUPPLIER','KOLBE','EXTERNAL_CARRIER'));
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_total_amount_range" CHECK ("total_amount" >= 0 AND "total_amount" <= 1000000000000000);
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_items_total_range" CHECK ("items_total" >= 0 AND "items_total" <= 1000000000000000);
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_grand_total_range" CHECK ("grand_total" >= 0 AND "grand_total" <= 1000000000000000);
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_currency_allowed" CHECK ("currency" IN ('IRR'));
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_version_non_negative" CHECK ("version" >= 0);
--> statement-breakpoint

-- Add FK for seller_id
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

-- Add new indexes
CREATE UNIQUE INDEX "purchase_order_wholesale_seller_unique" ON "purchase_order" ("wholesale_order_id", "seller_id") WHERE "wholesale_order_id" IS NOT NULL;
CREATE INDEX "purchase_order_seller_status_created" ON "purchase_order" ("seller_id", "status", "created_at");
CREATE INDEX "purchase_order_wholesale_created" ON "purchase_order" ("wholesale_order_id", "created_at");
--> statement-breakpoint

-- ── purchase_order_item evolution ─────────────────────────────────────────

ALTER TABLE "purchase_order_item" ADD COLUMN "wholesale_order_item_id" text;
--> statement-breakpoint

-- Add FK and indexes
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_wholesale_order_item_fk" FOREIGN KEY ("wholesale_order_item_id") REFERENCES "wholesale_order_item"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "purchase_order_item_purchase_order" ON "purchase_order_item" ("purchase_order_id");
CREATE UNIQUE INDEX "purchase_order_item_parent_child_unique" ON "purchase_order_item" ("wholesale_order_item_id", "purchase_order_id") WHERE "wholesale_order_item_id" IS NOT NULL;
--> statement-breakpoint

-- ── inventory_reservation linkage ─────────────────────────────────────────

ALTER TABLE "inventory_reservation" ADD COLUMN "order_id" text;
ALTER TABLE "inventory_reservation" ADD COLUMN "order_item_id" text;
--> statement-breakpoint

ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_order_fk" FOREIGN KEY ("order_id") REFERENCES "wholesale_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_order_item_fk" FOREIGN KEY ("order_item_id") REFERENCES "wholesale_order_item"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "inventory_reservation_order" ON "inventory_reservation" ("order_id");
CREATE INDEX "inventory_reservation_order_item" ON "inventory_reservation" ("order_item_id");
CREATE UNIQUE INDEX "inventory_reservation_order_item_variant_seller_unique" ON "inventory_reservation" ("order_item_id", "variant_id", "seller_id") WHERE "order_item_id" IS NOT NULL;
--> statement-breakpoint

-- ── order_status_history (append-only) ────────────────────────────────────

CREATE TABLE "order_status_history" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text,
  "child_order_id" text,
  "from_status" text NOT NULL,
  "to_status" text NOT NULL,
  "actor_id" text,
  "actor_role" text,
  "reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "order_version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_status_history_from_status_allowed" CHECK ("from_status" IN ('draft','confirmed','awaiting_payment','processing','fulfillment','shipped','completed','cancelled','pending','preparing','delivered')),
  CONSTRAINT "order_status_history_to_status_allowed" CHECK ("to_status" IN ('draft','confirmed','awaiting_payment','processing','fulfillment','shipped','completed','cancelled','pending','preparing','delivered')),
  CONSTRAINT "order_status_history_actor_role_allowed" CHECK ("actor_role" IN ('buyer','admin','supplier','system','fulfillment')),
  CONSTRAINT "order_status_history_order_version_non_negative" CHECK ("order_version" >= 0),
  CONSTRAINT "order_status_history_exactly_one_order_fk" CHECK ((("order_id" IS NOT NULL AND "child_order_id" IS NULL) OR ("order_id" IS NULL AND "child_order_id" IS NOT NULL)))
);
--> statement-breakpoint

ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_fk" FOREIGN KEY ("order_id") REFERENCES "wholesale_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_child_order_fk" FOREIGN KEY ("child_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE INDEX "order_status_history_order_created" ON "order_status_history" ("order_id", "created_at");
CREATE INDEX "order_status_history_child_created" ON "order_status_history" ("child_order_id", "created_at");
CREATE INDEX "order_status_history_actor_created" ON "order_status_history" ("actor_id", "created_at");
CREATE UNIQUE INDEX "order_status_history_order_version_unique" ON "order_status_history" ("order_id", "order_version") WHERE "order_id" IS NOT NULL;
CREATE UNIQUE INDEX "order_status_history_child_version_unique" ON "order_status_history" ("child_order_id", "order_version") WHERE "child_order_id" IS NOT NULL;
--> statement-breakpoint

-- Append-only trigger for order_status_history
CREATE OR REPLACE FUNCTION prevent_order_status_history_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'order_status_history is append-only: UPDATE/DELETE forbidden';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER order_status_history_append_only
  BEFORE UPDATE OR DELETE ON "order_status_history"
  FOR EACH ROW EXECUTE FUNCTION prevent_order_status_history_mutation();
--> statement-breakpoint

-- ── order_event (append-only) ─────────────────────────────────────────────

CREATE TABLE "order_event" (
  "id" text PRIMARY KEY NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actor_id" text,
  "actor_role" text,
  "idempotency_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_event_aggregate_type_allowed" CHECK ("aggregate_type" IN ('wholesale_order','purchase_order')),
  CONSTRAINT "order_event_event_type_allowed" CHECK ("event_type" IN ('order.created','order.confirmed','order.payment_gated','order.processing_started','order.fulfillment_started','order.shipped','order.completed','order.cancelled','child.created','child.confirmed','child.preparing','child.shipped','child.delivered','child.cancelled','request.converted','inventory.reserved','inventory.released','inventory.consumed')),
  CONSTRAINT "order_event_actor_role_allowed" CHECK ("actor_role" IN ('buyer','admin','supplier','system','fulfillment'))
);
--> statement-breakpoint

ALTER TABLE "order_event" ADD CONSTRAINT "order_event_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE INDEX "order_event_aggregate_created" ON "order_event" ("aggregate_type", "aggregate_id", "created_at");
CREATE INDEX "order_event_type_created" ON "order_event" ("event_type", "created_at");
CREATE UNIQUE INDEX "order_event_aggregate_idempotency_unique" ON "order_event" ("aggregate_type", "aggregate_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

-- Append-only trigger for order_event
CREATE OR REPLACE FUNCTION prevent_order_event_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'order_event is append-only: UPDATE/DELETE forbidden';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER order_event_append_only
  BEFORE UPDATE OR DELETE ON "order_event"
  FOR EACH ROW EXECUTE FUNCTION prevent_order_event_mutation();
--> statement-breakpoint
