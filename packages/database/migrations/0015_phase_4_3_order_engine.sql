-- Phase 4.3 — Canonical Wholesale Order Engine
-- Goals:
-- 1. Fix purchase_order_item.variant_id NOT NULL → nullable for package lines
-- 2. Fix order_status_history.from_status NOT NULL → nullable (NULL = ABSENT→draft/pending)
-- 3. Add wholesale_order.creation_request_hash for idempotency payload detection
-- 4. Ensure inventory_reservation supports order_id, order_item_id, request_id, allocation_id traceability (already present, verify)
-- No destructive rewrite of 0011-0014

-- ── 1. purchase_order_item.variant_id nullable ───────────────────────────
ALTER TABLE "purchase_order_item" ALTER COLUMN "variant_id" DROP NOT NULL;
--> statement-breakpoint

-- ── 2. order_status_history.from_status nullable + CHECK allows NULL ──────
ALTER TABLE "order_status_history" DROP CONSTRAINT IF EXISTS "order_status_history_from_status_allowed";
ALTER TABLE "order_status_history" ALTER COLUMN "from_status" DROP NOT NULL;
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_from_status_allowed" CHECK ("from_status" IS NULL OR "from_status" IN ('draft','confirmed','awaiting_payment','processing','fulfillment','shipped','completed','cancelled','pending','preparing','delivered'));
--> statement-breakpoint

-- ── 3. wholesale_order.creation_request_hash ──────────────────────────────
ALTER TABLE "wholesale_order" ADD COLUMN "creation_request_hash" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "wholesale_order_creation_hash" ON "wholesale_order" ("creation_request_hash");
--> statement-breakpoint

-- ── 4. Verify inventory_reservation traceability columns exist ───────────
-- order_id, order_item_id, request_id, allocation_id already exist from Phase 4.1/4.2
-- Ensure indexes for order traceability
CREATE INDEX IF NOT EXISTS "inventory_reservation_order_item_variant_seller_unique_check" ON "inventory_reservation" ("order_item_id","variant_id","seller_id") WHERE "order_item_id" IS NOT NULL;
--> statement-breakpoint

-- ── 5. Document that originating_request_id remains legacy ───────────────
-- No DDL change, documentation in order-boundary.md and phase reports

-- ── 6. Ensure wholesale_order_request remains authoritative ───────────────
-- Already has UNIQUE(request_id) and UNIQUE(order_id,request_id) and RESTRICT
-- No change needed, but verify no CASCADE
-- This migration does not alter it
