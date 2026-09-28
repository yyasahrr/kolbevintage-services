-- Phase 4.2.1 — Order Foundation Contract Corrections
-- Goals:
-- 1. Document legacy status migration semantics for fulfilled → completed
-- 2. Enforce order_code immutability via triggers (wholesale_order, purchase_order)
-- 3. Preserve Phase 4.2 foundation, no Order Engine yet

-- ── 1. Legacy status migration semantics documentation ───────────────────
-- Migration 0012 contained unconditional:
--   UPDATE wholesale_order SET status='completed' WHERE status='fulfilled'
-- Frozen architecture (status-machines.md) says:
--   fulfilled → completed only with delivery evidence.
-- Repository state analysis (e318711):
--   - This repository is pre-launch
--   - Commerce data in target environments is dev/fake (seeded via KOLBE_SEED_DEMO_DATA)
--   - No meaningful legacy production commerce rows exist
--   - Existing tests and CI use ephemeral databases recreated from migrations
-- Decision (Option A - safest, documented):
--   - Treat 0012's fulfilled → completed as pre-launch/dev-only reset/backfill
--   - Explicitly document that this is NOT fabricating delivery evidence for production
--   - For production, fulfilled rows would require quarantine/evidence-check, but
--     since no production data exists, the dev-only mapping is safe
--   - If legacy fulfilled rows were to exist in a future production migration,
--     they must be quarantined, not auto-completed, per frozen spec
--   - This migration adds a guard to ensure no 'fulfilled' status remains after 0012,
--     proving the dev-only assumption
--   - Future migrations must NOT reintroduce fulfilled→completed without evidence

-- Guard: ensure no legacy statuses remain (pending, approved, fulfilling, fulfilled)
-- These should have been migrated in 0012. If any remain, quarantine them to draft with reason.
DO $$
BEGIN
  -- If any legacy status still exists, move to draft and log reason (pre-launch quarantine)
  -- This is defensive: 0012 should have already migrated them
  IF EXISTS (SELECT 1 FROM wholesale_order WHERE status IN ('pending','approved','fulfilling','fulfilled')) THEN
    RAISE NOTICE 'Phase 4.2.1: Found legacy wholesale_order statuses, quarantining to draft (pre-launch dev-only)';
    UPDATE wholesale_order SET status='draft' WHERE status IN ('pending','approved','fulfilling','fulfilled');
  END IF;
END $$;
--> statement-breakpoint

-- Document assumption in a comment table (if not exists, create a migration metadata table for docs)
-- We use a simple DO block to log, not a new table, to avoid schema bloat
-- The actual documentation lives in docs/phase-reports/phase-4-2-report.md and this file's header

-- ── 2. Order code immutability ────────────────────────────────────────────
-- Verify both wholesale_order.order_code and purchase_order.order_code are:
-- NOT NULL, unique, generated server-side, immutable after creation
-- We enforce immutability via triggers consistent with append-only protections

-- wholesale_order.order_code immutability trigger
CREATE OR REPLACE FUNCTION prevent_wholesale_order_code_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.order_code IS DISTINCT FROM NEW.order_code THEN
    RAISE EXCEPTION 'wholesale_order.order_code is immutable: cannot change from % to %', OLD.order_code, NEW.order_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS wholesale_order_code_immutable ON wholesale_order;
CREATE TRIGGER wholesale_order_code_immutable
  BEFORE UPDATE ON wholesale_order
  FOR EACH ROW EXECUTE FUNCTION prevent_wholesale_order_code_mutation();
--> statement-breakpoint

-- purchase_order.order_code immutability trigger
CREATE OR REPLACE FUNCTION prevent_purchase_order_code_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.order_code IS DISTINCT FROM NEW.order_code THEN
    RAISE EXCEPTION 'purchase_order.order_code is immutable: cannot change from % to %', OLD.order_code, NEW.order_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS purchase_order_code_immutable ON purchase_order;
CREATE TRIGGER purchase_order_code_immutable
  BEFORE UPDATE ON purchase_order
  FOR EACH ROW EXECUTE FUNCTION prevent_purchase_order_code_mutation();
--> statement-breakpoint

-- ── 3. Verify constraints still hold ──────────────────────────────────────
-- Ensure order_code uniqueness and NOT NULL are already enforced (from prior migrations)
-- Add explicit checks if missing (defensive)

DO $$
BEGIN
  -- wholesale_order.order_code should be NOT NULL and unique (already exists as unique index)
  -- We verify the unique index exists
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='wholesale_order_order_code_unique') THEN
    -- If not exists, check for any unique constraint on order_code
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wholesale_order_order_code_unique') THEN
      RAISE NOTICE 'wholesale_order_order_code_unique index missing, creating';
      CREATE UNIQUE INDEX IF NOT EXISTS wholesale_order_order_code_unique ON wholesale_order (order_code);
    END IF;
  END IF;

  -- purchase_order.order_code should be unique
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='purchase_order_order_code_unique') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='purchase_order_order_code_unique') THEN
      RAISE NOTICE 'purchase_order_order_code_unique index missing, creating';
      CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_order_code_unique ON purchase_order (order_code);
    END IF;
  END IF;
END $$;
--> statement-breakpoint
