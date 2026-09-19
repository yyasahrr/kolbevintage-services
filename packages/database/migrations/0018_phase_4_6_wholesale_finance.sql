-- Phase 4.6 — Wholesale Finance Foundation: Proforma, Payment Gate, Financial Ledger & Partial Refund
-- Goals:
-- 1. Seller-specific Proforma per child order, immutable snapshots, versioning draft/issued/superseded/voided
-- 2. Payment aggregate manual bank transfer first, evidence_submitted→verified
-- 3. Payment allocation per proforma, overpayment tracking
-- 4. Financial release evidence (payment_verified, credit_approved, cod_policy_approved, manual_authorized_release)
-- 5. Financial ledger append-only IN/OUT
-- 6. Refund aggregate partial refunds per child isolation, no wallet, no settlement
-- Forward-only, RESTRICT FKs, no CASCADE, BIGINT money

-- ── 1. Extend command_idempotency CHECK for finance ────────────────────
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
  'refunds.create','refunds.approve','refunds.complete','refunds.fail','refunds.cancel'
));
--> statement-breakpoint

-- ── 2. Extend order_event CHECK for finance events ─────────────────────
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
  'refund.requested','refund.approved','refund.completed','refund.failed','refund.cancelled'
));
--> statement-breakpoint

-- ── 3. wholesale_proforma ─────────────────────────────────────────────
CREATE TABLE "wholesale_proforma" (
  "id" text PRIMARY KEY NOT NULL,
  "proforma_number" text NOT NULL,
  "wholesale_order_id" text NOT NULL,
  "child_order_id" text NOT NULL,
  "seller_id" text NOT NULL,
  "supplier_id" text,
  "version" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "currency" text DEFAULT 'IRR' NOT NULL,
  "items_total" bigint DEFAULT 0 NOT NULL,
  "shipping_total" bigint DEFAULT 0 NOT NULL,
  "total_amount" bigint DEFAULT 0 NOT NULL,
  "terms_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "issued_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "superseded_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wholesale_proforma_number_unique" UNIQUE("proforma_number"),
  CONSTRAINT "wholesale_proforma_status_allowed" CHECK ("status" IN ('draft','issued','superseded','voided')),
  CONSTRAINT "wholesale_proforma_currency_allowed" CHECK ("currency" IN ('IRR')),
  CONSTRAINT "wholesale_proforma_items_total_range" CHECK ("items_total" >= 0 AND "items_total" <= 1000000000000000),
  CONSTRAINT "wholesale_proforma_shipping_total_range" CHECK ("shipping_total" >= 0 AND "shipping_total" <= 1000000000000000),
  CONSTRAINT "wholesale_proforma_total_amount_range" CHECK ("total_amount" >= 0 AND "total_amount" <= 1000000000000000),
  CONSTRAINT "wholesale_proforma_version_non_negative" CHECK ("version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "wholesale_proforma" ADD CONSTRAINT "wholesale_proforma_order_fk" FOREIGN KEY ("wholesale_order_id") REFERENCES "wholesale_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wholesale_proforma" ADD CONSTRAINT "wholesale_proforma_child_fk" FOREIGN KEY ("child_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wholesale_proforma" ADD CONSTRAINT "wholesale_proforma_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wholesale_proforma" ADD CONSTRAINT "wholesale_proforma_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wholesale_proforma" ADD CONSTRAINT "wholesale_proforma_superseded_by_fk" FOREIGN KEY ("superseded_by") REFERENCES "wholesale_proforma"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "wholesale_proforma_child_issued_unique" ON "wholesale_proforma" ("child_order_id","status") WHERE "status" = 'issued';
--> statement-breakpoint
CREATE INDEX "wholesale_proforma_order_created" ON "wholesale_proforma" ("wholesale_order_id","created_at");
--> statement-breakpoint
CREATE INDEX "wholesale_proforma_child_created" ON "wholesale_proforma" ("child_order_id","created_at");
--> statement-breakpoint
CREATE INDEX "wholesale_proforma_seller_created" ON "wholesale_proforma" ("seller_id","created_at");
--> statement-breakpoint

-- ── 4. wholesale_proforma_line ────────────────────────────────────────
CREATE TABLE "wholesale_proforma_line" (
  "id" text PRIMARY KEY NOT NULL,
  "proforma_id" text NOT NULL,
  "wholesale_order_item_id" text NOT NULL,
  "purchase_order_item_id" text,
  "description_snapshot" text DEFAULT '' NOT NULL,
  "sku_snapshot" text DEFAULT '' NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "pricing_unit" text DEFAULT 'PIECE' NOT NULL,
  "unit_price" bigint DEFAULT 0 NOT NULL,
  "line_total" bigint DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'IRR' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wholesale_proforma_line_pricing_unit_allowed" CHECK ("pricing_unit" IN ('PIECE','PACKAGE','SERIES','BOX','CARTON','SET','PER_PIECE')),
  CONSTRAINT "wholesale_proforma_line_currency_allowed" CHECK ("currency" IN ('IRR')),
  CONSTRAINT "wholesale_proforma_line_unit_price_range" CHECK ("unit_price" >= 0 AND "unit_price" <= 1000000000000000),
  CONSTRAINT "wholesale_proforma_line_line_total_range" CHECK ("line_total" >= 0 AND "line_total" <= 1000000000000000),
  CONSTRAINT "wholesale_proforma_line_quantity_positive" CHECK ("quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "wholesale_proforma_line" ADD CONSTRAINT "wholesale_proforma_line_proforma_fk" FOREIGN KEY ("proforma_id") REFERENCES "wholesale_proforma"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wholesale_proforma_line" ADD CONSTRAINT "wholesale_proforma_line_wholesale_item_fk" FOREIGN KEY ("wholesale_order_item_id") REFERENCES "wholesale_order_item"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wholesale_proforma_line" ADD CONSTRAINT "wholesale_proforma_line_purchase_item_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_item"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "wholesale_proforma_line_proforma" ON "wholesale_proforma_line" ("proforma_id");
--> statement-breakpoint
CREATE INDEX "wholesale_proforma_line_order_item" ON "wholesale_proforma_line" ("wholesale_order_item_id");
--> statement-breakpoint

-- ── 5. payment ────────────────────────────────────────────────────────
CREATE TABLE "payment" (
  "id" text PRIMARY KEY NOT NULL,
  "payment_reference" text NOT NULL,
  "wholesale_order_id" text NOT NULL,
  "method" text NOT NULL,
  "provider" text DEFAULT 'manual' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "amount" bigint DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'IRR' NOT NULL,
  "external_reference" text,
  "submitted_by" text,
  "submitted_at" timestamp with time zone,
  "verified_by" text,
  "verified_at" timestamp with time zone,
  "failure_reason" text,
  "idempotency_key" text,
  "request_hash" text,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_reference_unique" UNIQUE("payment_reference"),
  CONSTRAINT "payment_status_allowed" CHECK ("status" IN ('pending','evidence_submitted','verified','failed','cancelled')),
  CONSTRAINT "payment_method_allowed" CHECK ("method" IN ('manual_transfer','bank_transfer','transfer','credit','cod','on_delivery','manual_authorized')),
  CONSTRAINT "payment_currency_allowed" CHECK ("currency" IN ('IRR')),
  CONSTRAINT "payment_amount_range" CHECK ("amount" >= 0 AND "amount" <= 1000000000000000),
  CONSTRAINT "payment_version_non_negative" CHECK ("version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_fk" FOREIGN KEY ("wholesale_order_id") REFERENCES "wholesale_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_submitted_by_fk" FOREIGN KEY ("submitted_by") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_verified_by_fk" FOREIGN KEY ("verified_by") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_idempotency_unique" ON "payment" ("wholesale_order_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "payment_order_created" ON "payment" ("wholesale_order_id","created_at");
--> statement-breakpoint
CREATE INDEX "payment_status_created" ON "payment" ("status","created_at");
--> statement-breakpoint

-- ── 6. payment_allocation ─────────────────────────────────────────────
CREATE TABLE "payment_allocation" (
  "id" text PRIMARY KEY NOT NULL,
  "payment_id" text NOT NULL,
  "proforma_id" text NOT NULL,
  "amount" bigint DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'IRR' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_allocation_currency_allowed" CHECK ("currency" IN ('IRR')),
  CONSTRAINT "payment_allocation_status_allowed" CHECK ("status" IN ('active','voided')),
  CONSTRAINT "payment_allocation_amount_range" CHECK ("amount" >= 0 AND "amount" <= 1000000000000000)
);
--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_fk" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_proforma_fk" FOREIGN KEY ("proforma_id") REFERENCES "wholesale_proforma"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocation_payment_proforma_unique" ON "payment_allocation" ("payment_id","proforma_id");
--> statement-breakpoint
CREATE INDEX "payment_allocation_payment_created" ON "payment_allocation" ("payment_id","created_at");
--> statement-breakpoint
CREATE INDEX "payment_allocation_proforma_created" ON "payment_allocation" ("proforma_id","created_at");
--> statement-breakpoint

-- ── 7. order_financial_release ────────────────────────────────────────
CREATE TABLE "order_financial_release" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "release_type" text NOT NULL,
  "evidence_reference" text,
  "amount" bigint,
  "currency" text DEFAULT 'IRR',
  "actor_id" text,
  "actor_role" text,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_financial_release_type_allowed" CHECK ("release_type" IN ('payment_verified','credit_approved','cod_policy_approved','manual_authorized_release')),
  CONSTRAINT "order_financial_release_currency_allowed" CHECK ("currency" IN ('IRR'))
);
--> statement-breakpoint
ALTER TABLE "order_financial_release" ADD CONSTRAINT "order_financial_release_order_fk" FOREIGN KEY ("order_id") REFERENCES "wholesale_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "order_financial_release" ADD CONSTRAINT "order_financial_release_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "account_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "order_financial_release_order_created" ON "order_financial_release" ("order_id","created_at");
--> statement-breakpoint
CREATE INDEX "order_financial_release_type_created" ON "order_financial_release" ("release_type","created_at");
--> statement-breakpoint

-- ── 8. financial_ledger_entry ─────────────────────────────────────────
CREATE TABLE "financial_ledger_entry" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "child_order_id" text,
  "payment_id" text,
  "refund_id" text,
  "entry_type" text NOT NULL,
  "direction" text NOT NULL,
  "amount" bigint NOT NULL,
  "currency" text DEFAULT 'IRR' NOT NULL,
  "external_reference" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "financial_ledger_entry_type_allowed" CHECK ("entry_type" IN ('payment_verified','refund_completed','adjustment','credit_release','cod_release')),
  CONSTRAINT "financial_ledger_direction_allowed" CHECK ("direction" IN ('IN','OUT')),
  CONSTRAINT "financial_ledger_currency_allowed" CHECK ("currency" IN ('IRR')),
  CONSTRAINT "financial_ledger_amount_positive" CHECK ("amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "financial_ledger_entry" ADD CONSTRAINT "financial_ledger_order_fk" FOREIGN KEY ("order_id") REFERENCES "wholesale_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "financial_ledger_entry" ADD CONSTRAINT "financial_ledger_child_fk" FOREIGN KEY ("child_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "financial_ledger_entry" ADD CONSTRAINT "financial_ledger_payment_fk" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "financial_ledger_order_created" ON "financial_ledger_entry" ("order_id","created_at");
--> statement-breakpoint
CREATE INDEX "financial_ledger_child_created" ON "financial_ledger_entry" ("child_order_id","created_at");
--> statement-breakpoint
CREATE INDEX "financial_ledger_payment_created" ON "financial_ledger_entry" ("payment_id","created_at");
--> statement-breakpoint
CREATE INDEX "financial_ledger_refund_created" ON "financial_ledger_entry" ("refund_id","created_at");
--> statement-breakpoint

-- ── 9. refund ─────────────────────────────────────────────────────────
CREATE TABLE "refund" (
  "id" text PRIMARY KEY NOT NULL,
  "refund_reference" text NOT NULL,
  "wholesale_order_id" text NOT NULL,
  "child_order_id" text,
  "fulfillment_exception_id" text,
  "payment_id" text,
  "amount" bigint NOT NULL DEFAULT 0,
  "currency" text DEFAULT 'IRR' NOT NULL,
  "reason_code" text,
  "reason" text,
  "status" text DEFAULT 'requested' NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "approved_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "external_reference" text,
  "idempotency_key" text,
  "request_hash" text,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "refund_reference_unique" UNIQUE("refund_reference"),
  CONSTRAINT "refund_status_allowed" CHECK ("status" IN ('requested','approved','processing','completed','failed','cancelled')),
  CONSTRAINT "refund_currency_allowed" CHECK ("currency" IN ('IRR')),
  CONSTRAINT "refund_amount_range" CHECK ("amount" >= 0 AND "amount" <= 1000000000000000),
  CONSTRAINT "refund_version_non_negative" CHECK ("version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_order_fk" FOREIGN KEY ("wholesale_order_id") REFERENCES "wholesale_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_child_fk" FOREIGN KEY ("child_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_exception_fk" FOREIGN KEY ("fulfillment_exception_id") REFERENCES "fulfillment_exception"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_fk" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "refund_order_idempotency_unique" ON "refund" ("wholesale_order_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "refund_order_created" ON "refund" ("wholesale_order_id","created_at");
--> statement-breakpoint
CREATE INDEX "refund_child_created" ON "refund" ("child_order_id","created_at");
--> statement-breakpoint
CREATE INDEX "refund_status_created" ON "refund" ("status","created_at");
--> statement-breakpoint

-- ── 10. financial_ledger_entry refund FK (after refund table) ─────────
ALTER TABLE "financial_ledger_entry" ADD CONSTRAINT "financial_ledger_refund_fk" FOREIGN KEY ("refund_id") REFERENCES "refund"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

-- ── 11. Append-only triggers for financial_ledger_entry ───────────────
CREATE OR REPLACE FUNCTION prevent_financial_ledger_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'financial_ledger_entry is append-only, UPDATE/DELETE forbidden';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER financial_ledger_entry_no_update BEFORE UPDATE ON financial_ledger_entry FOR EACH ROW EXECUTE FUNCTION prevent_financial_ledger_update_delete();
--> statement-breakpoint
CREATE TRIGGER financial_ledger_entry_no_delete BEFORE DELETE ON financial_ledger_entry FOR EACH ROW EXECUTE FUNCTION prevent_financial_ledger_update_delete();
--> statement-breakpoint

-- ── 12. No wallet, no settlement, no payout, no shipping provider ─────
-- Explicitly NOT adding supplier wallet, commission, settlement batches, payout bank transfer per Phase 4.6 scope
