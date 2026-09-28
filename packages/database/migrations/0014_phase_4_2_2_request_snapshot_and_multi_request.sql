-- Phase 4.2.2 — Accepted Request Commercial Snapshot & Multi-Request Order Contract
-- Goals:
-- 1. immutable accepted wholesale-request commercial terms (version, snapshot, hash, expiry)
-- 2. multi-request → one parent order support via wholesale_order_request link table
-- 3. correct variant/package selector semantics
-- 4. explicit pricing-unit semantics
-- 5. removal of legacy BOX/CARTON quantity assumptions (code fix, no DB multiplier)
-- 6. transaction-ready VIP request conversion contract

-- ── 1. Evolve wholesale_request ───────────────────────────────────────────

-- Add variant_id nullable FK to product_variant
ALTER TABLE "wholesale_request" ADD COLUMN "variant_id" text;
--> statement-breakpoint

-- Add versioning
ALTER TABLE "wholesale_request" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- Add accepted terms fields
ALTER TABLE "wholesale_request" ADD COLUMN "accepted_at" timestamp with time zone;
ALTER TABLE "wholesale_request" ADD COLUMN "accepted_by" text;
ALTER TABLE "wholesale_request" ADD COLUMN "accepted_terms_snapshot" jsonb;
ALTER TABLE "wholesale_request" ADD COLUMN "accepted_terms_hash" text;
ALTER TABLE "wholesale_request" ADD COLUMN "acceptance_expires_at" timestamp with time zone;
--> statement-breakpoint

-- Backfill version for existing rows (already default 0)
UPDATE "wholesale_request" SET "version" = 0 WHERE "version" IS NULL;
--> statement-breakpoint

-- Add FKs and checks
ALTER TABLE "wholesale_request" DROP CONSTRAINT IF EXISTS "wholesale_request_selector_check";
ALTER TABLE "wholesale_request" ADD CONSTRAINT "wholesale_request_selector_check" CHECK ((("variant_id" IS NOT NULL AND "package_id" IS NULL) OR ("variant_id" IS NULL AND "package_id" IS NOT NULL) OR ("variant_id" IS NULL AND "package_id" IS NULL)));
--> statement-breakpoint

ALTER TABLE "wholesale_request" DROP CONSTRAINT IF EXISTS "wholesale_request_version_non_negative";
ALTER TABLE "wholesale_request" ADD CONSTRAINT "wholesale_request_version_non_negative" CHECK ("version" >= 0);
--> statement-breakpoint

ALTER TABLE "wholesale_request" ADD CONSTRAINT "wholesale_request_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "wholesale_request" ADD CONSTRAINT "wholesale_request_accepted_by_fk" FOREIGN KEY ("accepted_by") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE INDEX "wholesale_request_account_status" ON "wholesale_request" ("vip_account_id", "status");
CREATE INDEX "wholesale_request_status_created" ON "wholesale_request" ("status", "created_at");
CREATE INDEX "wholesale_request_variant" ON "wholesale_request" ("variant_id");
--> statement-breakpoint

-- ── 2. Fix wholesale_order_item variant semantics ─────────────────────────

-- Make variant_id nullable (currently NOT NULL)
ALTER TABLE "wholesale_order_item" ALTER COLUMN "variant_id" DROP NOT NULL;
--> statement-breakpoint

-- Add source_request_id FK to wholesale_request
ALTER TABLE "wholesale_order_item" ADD COLUMN "source_request_id" text;
--> statement-breakpoint

-- Add selector check: exactly one of variant_id or package_id (or both null for legacy dev rows)
ALTER TABLE "wholesale_order_item" DROP CONSTRAINT IF EXISTS "wholesale_order_item_selector_check";
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_selector_check" CHECK ((("variant_id" IS NOT NULL AND "package_id" IS NULL) OR ("variant_id" IS NULL AND "package_id" IS NOT NULL) OR ("variant_id" IS NULL AND "package_id" IS NULL)));
--> statement-breakpoint

-- Add FK for source_request_id
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_source_request_fk" FOREIGN KEY ("source_request_id") REFERENCES "wholesale_request"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE INDEX "wholesale_order_item_source_request" ON "wholesale_order_item" ("source_request_id");
--> statement-breakpoint

-- ── 3. Multi-request → one parent order link table (Orders-owned) ─────────

CREATE TABLE "wholesale_order_request" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "request_id" text NOT NULL,
  "request_version" integer DEFAULT 0 NOT NULL,
  "accepted_terms_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wholesale_order_request_version_non_negative" CHECK ("request_version" >= 0)
);
--> statement-breakpoint

ALTER TABLE "wholesale_order_request" ADD CONSTRAINT "wholesale_order_request_order_fk" FOREIGN KEY ("order_id") REFERENCES "wholesale_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "wholesale_order_request" ADD CONSTRAINT "wholesale_order_request_request_fk" FOREIGN KEY ("request_id") REFERENCES "wholesale_request"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE UNIQUE INDEX "wholesale_order_request_request_unique" ON "wholesale_order_request" ("request_id");
CREATE UNIQUE INDEX "wholesale_order_request_order_request_unique" ON "wholesale_order_request" ("order_id", "request_id");
CREATE INDEX "wholesale_order_request_order" ON "wholesale_order_request" ("order_id");
CREATE INDEX "wholesale_order_request_request" ON "wholesale_order_request" ("request_id");
--> statement-breakpoint

-- ── 4. Explicit pricing unit for commercial sources ───────────────────────

-- seller_offer: add pricing_unit
ALTER TABLE "seller_offer" ADD COLUMN "pricing_unit" text DEFAULT 'PIECE' NOT NULL;
--> statement-breakpoint

-- Backfill pricing_unit from moq_unit deterministically (PIECE→PIECE, PACKAGE→PACKAGE, SERIES→SERIES, BOX→BOX, CARTON→CARTON, SET→SET)
UPDATE "seller_offer" SET "pricing_unit" = "moq_unit" WHERE "pricing_unit" = 'PIECE' AND "moq_unit" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "seller_offer" DROP CONSTRAINT IF EXISTS "seller_offer_pricing_unit_allowed";
ALTER TABLE "seller_offer" ADD CONSTRAINT "seller_offer_pricing_unit_allowed" CHECK ("pricing_unit" IN ('PIECE','PACKAGE','SERIES','BOX','CARTON','SET','PER_PIECE'));
--> statement-breakpoint

-- wholesale_pricing_tier: add pricing_unit
ALTER TABLE "wholesale_pricing_tier" ADD COLUMN "pricing_unit" text DEFAULT 'PACKAGE' NOT NULL;
--> statement-breakpoint

UPDATE "wholesale_pricing_tier" SET "pricing_unit" = "moq_unit" WHERE "pricing_unit" = 'PACKAGE' AND "moq_unit" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "wholesale_pricing_tier" DROP CONSTRAINT IF EXISTS "wholesale_pricing_tier_pricing_unit_allowed";
ALTER TABLE "wholesale_pricing_tier" ADD CONSTRAINT "wholesale_pricing_tier_pricing_unit_allowed" CHECK ("pricing_unit" IN ('PIECE','PACKAGE','SERIES','BOX','CARTON','SET','PER_PIECE'));
--> statement-breakpoint

-- ── 5. Document originating_request_id as legacy compatibility pointer ─────
-- wholesale_order.originating_request_id remains, but canonical engine MUST use wholesale_order_request as authoritative
-- No destructive removal in this phase
-- Documentation lives in docs/phase-reports/phase-4-2-2-report.md and order-boundary.md

-- ── 6. Ensure no BOX/CARTON universal multiplier in DB (code fix only) ─────
-- DB has no multiplier, only explicit recipe. Code fix in offers.logic.ts removes BOX*5 CARTON*20
-- No DB change needed
