-- Phase 4.6.1 — Finance Boundary, Authorization & Payment-Gate Hardening
-- Forward-only, RESTRICT FKs, no modification to 0018

-- 1. Issued Proforma immutability protection
-- Prevent changes to issued: seller_id, supplier_id, child_order_id, currency, items_total, shipping_total, total_amount, terms_snapshot, issued_at
-- Status transition to superseded/voided remains permitted

CREATE OR REPLACE FUNCTION prevent_issued_proforma_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'issued' THEN
    -- Allow status transition to superseded/voided
    IF NEW.status IN ('superseded', 'voided') THEN
      -- But still prevent financial field mutations during status transition
      IF NEW.seller_id IS DISTINCT FROM OLD.seller_id
         OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
         OR NEW.child_order_id IS DISTINCT FROM OLD.child_order_id
         OR NEW.currency IS DISTINCT FROM OLD.currency
         OR NEW.items_total IS DISTINCT FROM OLD.items_total
         OR NEW.shipping_total IS DISTINCT FROM OLD.shipping_total
         OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
         OR NEW.terms_snapshot IS DISTINCT FROM OLD.terms_snapshot
         OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
      THEN
        RAISE EXCEPTION 'Cannot mutate issued proforma financial fields' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END IF;

    -- If still issued, prevent any financial field change
    IF NEW.seller_id IS DISTINCT FROM OLD.seller_id
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.child_order_id IS DISTINCT FROM OLD.child_order_id
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.items_total IS DISTINCT FROM OLD.items_total
       OR NEW.shipping_total IS DISTINCT FROM OLD.shipping_total
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.terms_snapshot IS DISTINCT FROM OLD.terms_snapshot
       OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
       OR NEW.wholesale_order_id IS DISTINCT FROM OLD.wholesale_order_id
       OR NEW.proforma_number IS DISTINCT FROM OLD.proforma_number
    THEN
      RAISE EXCEPTION 'Cannot mutate issued proforma financial fields' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS wholesale_proforma_issued_immutable ON wholesale_proforma;
--> statement-breakpoint
CREATE TRIGGER wholesale_proforma_issued_immutable
  BEFORE UPDATE ON wholesale_proforma
  FOR EACH ROW EXECUTE FUNCTION prevent_issued_proforma_mutation();
--> statement-breakpoint

-- 2. Financial release uniqueness — one payment_verified release per order gate transition
-- Prevent duplicate payment_verified release for same order

CREATE UNIQUE INDEX IF NOT EXISTS order_financial_release_payment_verified_once
  ON order_financial_release (order_id)
  WHERE release_type = 'payment_verified';
--> statement-breakpoint

-- 3. Ensure payment_allocation invariants — allocation amount >0 already via CHECK, but add explicit
-- Already exists via moneyCheck and positive check? Add additional check for amount >0
-- The existing moneyCheck allows 0, we need >0 for allocation
-- Add constraint if not exists

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_allocation_amount_positive'
  ) THEN
    ALTER TABLE payment_allocation ADD CONSTRAINT payment_allocation_amount_positive CHECK (amount > 0);
  END IF;
END $$;
--> statement-breakpoint

-- 4. Ensure refund foreign key for ledger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_ledger_refund_fk'
  ) THEN
    ALTER TABLE financial_ledger_entry ADD CONSTRAINT financial_ledger_refund_fk FOREIGN KEY (refund_id) REFERENCES refund(id) ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
