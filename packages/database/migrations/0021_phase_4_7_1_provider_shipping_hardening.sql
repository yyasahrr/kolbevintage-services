-- Phase 4.7.1 — Payment & Shipping Correctness, Concurrency & Verification Hardening
-- Forward-only. 0020 is NOT modified. RESTRICT FKs. No data rewrite.
--
-- Why each change exists (spec reference in brackets):
--   A5  payment(provider, provider_reference) must identify exactly one payment.
--   A13 refund_allocation — every refund is drawn from concrete verified payment(s).
--   A14 refund_line       — exact item/quantity basis of a partial refund.
--   B14 shipment.failure_reason — pre/post-handoff failure semantics are recorded.
--   B16 shipment_event.shipment_id nullable — a carrier event that cannot be mapped
--       to a shipment is persisted as `ignored`, never silently dropped.
--   C1/C6 inventory_reservation.consumed_quantity — a shipment consumes a portion of
--       the ORDER reservation (no second reservation); CHECK forbids over-consumption.

-- ── 0. Online (provider-driven) payments are a real method ──────────────────
-- Phase 4.7 inserted method='online' for provider intents, which the CHECK rejected
-- (the online path was never executable). Forward-only CHECK evolution.
ALTER TABLE "payment" DROP CONSTRAINT IF EXISTS "payment_method_allowed";
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_method_allowed"
  CHECK ("method" IN ('manual_transfer','bank_transfer','transfer','credit','cod','on_delivery','manual_authorized','online'));
--> statement-breakpoint

-- ── 1. A5: provider reference uniqueness (partial: manual transfers have none) ──
CREATE UNIQUE INDEX IF NOT EXISTS "payment_provider_reference_unique"
  ON "payment" ("provider", "provider_reference")
  WHERE "provider_reference" IS NOT NULL;
--> statement-breakpoint

-- ── 2. C1/C6: exact partial consumption of the order reservation ──────────
ALTER TABLE "inventory_reservation" ADD COLUMN IF NOT EXISTS "consumed_quantity" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "inventory_reservation" DROP CONSTRAINT IF EXISTS "inventory_reservation_consumed_within_quantity";
--> statement-breakpoint
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_consumed_within_quantity"
  CHECK ("consumed_quantity" >= 0 AND "consumed_quantity" <= "quantity");
--> statement-breakpoint

-- ── 3. B14: shipment failure reason ────────────────────────────────────────
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "failure_reason" text;
--> statement-breakpoint

-- ── 4. B16/B17: unmapped carrier events are persisted (ignored), not dropped ──
ALTER TABLE "shipment_event" ALTER COLUMN "shipment_id" DROP NOT NULL;
--> statement-breakpoint

-- ── 5. A13: refund → source payment mapping ────────────────────────────────
CREATE TABLE IF NOT EXISTS "refund_allocation" (
  "id" text PRIMARY KEY NOT NULL,
  "refund_id" text NOT NULL,
  "payment_id" text NOT NULL,
  "amount" bigint NOT NULL,
  "currency" text NOT NULL DEFAULT 'IRR',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "refund_allocation_amount_positive" CHECK ("amount" > 0 AND "amount" <= 1000000000000000),
  CONSTRAINT "refund_allocation_currency_allowed" CHECK ("currency" IN ('IRR'))
);
--> statement-breakpoint
ALTER TABLE "refund_allocation" ADD CONSTRAINT "refund_allocation_refund_fk" FOREIGN KEY ("refund_id") REFERENCES "refund"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "refund_allocation" ADD CONSTRAINT "refund_allocation_payment_fk" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refund_allocation_refund_payment_unique" ON "refund_allocation" ("refund_id","payment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_allocation_payment" ON "refund_allocation" ("payment_id");
--> statement-breakpoint

-- ── 6. A14: exact item/quantity basis of partial refunds ───────────────────
CREATE TABLE IF NOT EXISTS "refund_line" (
  "id" text PRIMARY KEY NOT NULL,
  "refund_id" text NOT NULL,
  "wholesale_order_item_id" text NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price" bigint NOT NULL,
  "line_total" bigint NOT NULL,
  "currency" text NOT NULL DEFAULT 'IRR',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "refund_line_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "refund_line_unit_price_range" CHECK ("unit_price" >= 0 AND "unit_price" <= 1000000000000000),
  CONSTRAINT "refund_line_total_matches" CHECK ("line_total" = "unit_price" * "quantity"),
  CONSTRAINT "refund_line_currency_allowed" CHECK ("currency" IN ('IRR'))
);
--> statement-breakpoint
ALTER TABLE "refund_line" ADD CONSTRAINT "refund_line_refund_fk" FOREIGN KEY ("refund_id") REFERENCES "refund"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "refund_line" ADD CONSTRAINT "refund_line_item_fk" FOREIGN KEY ("wholesale_order_item_id") REFERENCES "wholesale_order_item"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refund_line_refund_item_unique" ON "refund_line" ("refund_id","wholesale_order_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_line_item" ON "refund_line" ("wholesale_order_item_id");
