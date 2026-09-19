-- Phase 4.8 — Supplier Financial Account, Settlement & Payout Foundation
-- Forward-only. 0018-0022 are NOT modified. All FKs ON DELETE RESTRICT. No data rewrite.
-- Ownership: `settlement` module.

--> statement-breakpoint
CREATE TABLE "settlement_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_type" text NOT NULL,
	"supplier_id" text,
	"seller_id" text,
	"child_order_id" text,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_account_type_allowed" CHECK ("account_type" IN ('PLATFORM_COLLECTION_CLEARING', 'SUPPLIER_PENDING_PAYABLE', 'SUPPLIER_AVAILABLE_PAYABLE', 'SUPPLIER_HOLD', 'PAYOUT_CLEARING', 'PLATFORM_FEE', 'SUPPLIER_RECOVERY', 'REFUND_CLEARING', 'ROUNDING_RESIDUE', 'ADJUSTMENT_CLEARING')),
	CONSTRAINT "settlement_account_currency_allowed" CHECK ("currency" IN ('IRR')),
	CONSTRAINT "settlement_account_status_allowed" CHECK ("status" IN ('active', 'suspended', 'closed')),
	CONSTRAINT "settlement_account_supplier_bound" CHECK (("account_type" NOT IN ('SUPPLIER_PENDING_PAYABLE', 'SUPPLIER_AVAILABLE_PAYABLE', 'SUPPLIER_HOLD', 'SUPPLIER_RECOVERY', 'PAYOUT_CLEARING')) OR ("supplier_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "settlement_journal" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_type" text NOT NULL,
	"source_event_type" text NOT NULL,
	"source_event_id" text NOT NULL,
	"child_order_id" text,
	"order_item_id" text,
	"supplier_id" text,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"total_amount" bigint NOT NULL,
	"snapshot_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"posted_by" text,
	"reason" text,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_journal_type_allowed" CHECK ("journal_type" IN ('FUNDS_HELD', 'ENTITLEMENT', 'COMMISSION', 'AVAILABILITY', 'HOLD_PLACED', 'HOLD_RELEASED', 'REFUND_ADJUSTMENT', 'POST_SETTLEMENT_ADJUSTMENT', 'WITHDRAWAL_RESERVED', 'PAYOUT_SETTLED', 'PAYOUT_REVERSED', 'MANUAL_ADJUSTMENT', 'RECOVERY_OFFSET')),
	CONSTRAINT "settlement_journal_source_type_allowed" CHECK ("source_event_type" IN ('ChildPaymentCovered', 'ChildQuantityDelivered', 'ChildQuantityRefunded', 'SettlementBatchRelease', 'FinancialHoldPlaced', 'FinancialHoldReleased', 'WithdrawalAccepted', 'PayoutProviderResult', 'AdminAdjustment')),
	CONSTRAINT "settlement_journal_currency_allowed" CHECK ("currency" IN ('IRR')),
	CONSTRAINT "settlement_journal_total_amount_range" CHECK ("total_amount" >= 0 AND "total_amount" <= 1000000000000000)
);
--> statement-breakpoint
CREATE TABLE "settlement_posting" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_id" text NOT NULL,
	"account_id" text NOT NULL,
	"direction" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_posting_direction_allowed" CHECK ("direction" IN ('DEBIT', 'CREDIT')),
	CONSTRAINT "settlement_posting_amount_range" CHECK ("amount" >= 0 AND "amount" <= 1000000000000000),
	CONSTRAINT "settlement_posting_amount_positive" CHECK ("amount" > 0),
	CONSTRAINT "settlement_posting_currency_allowed" CHECK ("currency" IN ('IRR'))
);
--> statement-breakpoint
CREATE TABLE "commission_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_version" integer NOT NULL,
	"name" text NOT NULL,
	"basis" text NOT NULL,
	"rate_bps" integer DEFAULT 0 NOT NULL,
	"fixed_amount" bigint DEFAULT 0 NOT NULL,
	"rounding_mode" text DEFAULT 'HALF_UP' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_policy_basis_allowed" CHECK ("basis" IN ('MERCHANDISE_ENTITLED_NET', 'GROSS_ORDERED')),
	CONSTRAINT "commission_policy_rate_bps_range" CHECK ("rate_bps" >= 0 AND "rate_bps" <= 10000),
	CONSTRAINT "commission_policy_fixed_amount_range" CHECK ("fixed_amount" >= 0 AND "fixed_amount" <= 1000000000000000),
	CONSTRAINT "commission_policy_rounding_mode_allowed" CHECK ("rounding_mode" IN ('HALF_UP', 'DOWN')),
	CONSTRAINT "commission_policy_status_allowed" CHECK ("status" IN ('active', 'retired')),
	CONSTRAINT "commission_policy_version_positive" CHECK ("policy_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "commission_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"child_order_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" integer NOT NULL,
	"basis" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"fixed_amount" bigint NOT NULL,
	"rounding_mode" text NOT NULL,
	"snapshotted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_snapshot_basis_allowed" CHECK ("basis" IN ('MERCHANDISE_ENTITLED_NET', 'GROSS_ORDERED')),
	CONSTRAINT "commission_snapshot_rate_bps_range" CHECK ("rate_bps" >= 0 AND "rate_bps" <= 10000),
	CONSTRAINT "commission_snapshot_fixed_amount_range" CHECK ("fixed_amount" >= 0 AND "fixed_amount" <= 1000000000000000),
	CONSTRAINT "commission_snapshot_rounding_mode_allowed" CHECK ("rounding_mode" IN ('HALF_UP', 'DOWN'))
);
--> statement-breakpoint
CREATE TABLE "shipping_economics_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"child_order_id" text NOT NULL,
	"shipping_charge_to_buyer" bigint DEFAULT 0 NOT NULL,
	"shipping_economic_recipient" text DEFAULT 'UNDEFINED' NOT NULL,
	"shipping_cost_bearer" text DEFAULT 'UNDEFINED' NOT NULL,
	"shipping_provider" text,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"status" text DEFAULT 'finalized' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_economics_recipient_allowed" CHECK ("shipping_economic_recipient" IN ('SUPPLIER', 'KOLBE', 'CARRIER_PASS_THROUGH', 'NONE', 'UNDEFINED')),
	CONSTRAINT "shipping_economics_bearer_allowed" CHECK ("shipping_cost_bearer" IN ('SUPPLIER', 'KOLBE', 'BUYER', 'UNDEFINED')),
	CONSTRAINT "shipping_economics_status_allowed" CHECK ("status" IN ('draft', 'finalized')),
	CONSTRAINT "shipping_economics_currency_allowed" CHECK ("currency" IN ('IRR')),
	CONSTRAINT "shipping_economics_charge_range" CHECK ("shipping_charge_to_buyer" >= 0 AND "shipping_charge_to_buyer" <= 1000000000000000)
);
--> statement-breakpoint
CREATE TABLE "settlement_hold_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_version" integer NOT NULL,
	"name" text NOT NULL,
	"hold_duration_days" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_hold_policy_status_allowed" CHECK ("status" IN ('active', 'retired')),
	CONSTRAINT "settlement_hold_policy_duration_range" CHECK ("hold_duration_days" >= 0 AND "hold_duration_days" <= 365),
	CONSTRAINT "settlement_hold_policy_version_positive" CHECK ("policy_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_hold" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text,
	"reason" text NOT NULL,
	"amount" bigint,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"placed_by" text,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" text,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_hold_scope_allowed" CHECK ("scope" IN ('SUPPLIER', 'CHILD_ORDER', 'PAYOUT')),
	CONSTRAINT "settlement_hold_reason_allowed" CHECK ("reason" IN ('RETURN_WINDOW', 'REFUND_PENDING', 'DISPUTE', 'CHARGEBACK_RISK', 'PROVIDER_UNCERTAINTY', 'MANUAL_FINANCE_HOLD')),
	CONSTRAINT "settlement_hold_status_allowed" CHECK ("status" IN ('active', 'released')),
	CONSTRAINT "settlement_hold_currency_allowed" CHECK ("currency" IN ('IRR')),
	CONSTRAINT "settlement_hold_amount_range" CHECK ("amount" IS NULL OR ("amount" >= 0 AND "amount" <= 1000000000000000))
);
--> statement-breakpoint
CREATE TABLE "settlement_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"total_released_amount" bigint DEFAULT 0 NOT NULL,
	"total_items_count" integer DEFAULT 0 NOT NULL,
	"executed_by" text,
	"error_message" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_batch_status_allowed" CHECK ("status" IN ('draft', 'processing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "settlement_batch_currency_allowed" CHECK ("currency" IN ('IRR')),
	CONSTRAINT "settlement_batch_amount_range" CHECK ("total_released_amount" >= 0 AND "total_released_amount" <= 1000000000000000),
	CONSTRAINT "settlement_batch_items_count_non_negative" CHECK ("total_items_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_batch_item" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"child_order_id" text NOT NULL,
	"journal_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'released' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_batch_item_status_allowed" CHECK ("status" IN ('released')),
	CONSTRAINT "settlement_batch_item_amount_range" CHECK ("amount" >= 0 AND "amount" <= 1000000000000000),
	CONSTRAINT "settlement_batch_item_amount_positive" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "withdrawal_request" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"bank_destination_id" text NOT NULL,
	"bank_destination_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"rejected_by_user_id" text,
	"rejected_at" timestamp with time zone,
	"reservation_journal_id" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_request_amount_range" CHECK ("amount" >= 0 AND "amount" <= 1000000000000000),
	CONSTRAINT "withdrawal_request_amount_positive" CHECK ("amount" > 0),
	CONSTRAINT "withdrawal_request_currency_allowed" CHECK ("currency" IN ('IRR')),
	CONSTRAINT "withdrawal_request_status_allowed" CHECK ("status" IN ('requested', 'approved', 'rejected', 'cancelled', 'converted_to_payout'))
);
--> statement-breakpoint
CREATE TABLE "payout" (
	"id" text PRIMARY KEY NOT NULL,
	"withdrawal_request_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"bank_destination_snapshot" jsonb NOT NULL,
	"initiated_by" text NOT NULL,
	"external_evidence" jsonb,
	"error_message" text,
	"reconciliation_notes" text,
	"success_journal_id" text,
	"failure_reversal_journal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_at" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_amount_range" CHECK ("amount" >= 0 AND "amount" <= 1000000000000000),
	CONSTRAINT "payout_amount_positive" CHECK ("amount" > 0),
	CONSTRAINT "payout_currency_allowed" CHECK ("currency" IN ('IRR')),
	CONSTRAINT "payout_status_allowed" CHECK ("status" IN ('pending', 'processing', 'provider_pending', 'succeeded', 'failed', 'reconciliation_required')),
	CONSTRAINT "payout_provider_allowed" CHECK ("provider" IN ('fake', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "payout_provider_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payout_id" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payout_provider_event_type_allowed" CHECK ("event_type" IN ('PAYOUT_COMPLETED', 'PAYOUT_FAILED', 'PAYOUT_REVERSED')),
	CONSTRAINT "payout_provider_event_status_allowed" CHECK ("status" IN ('received', 'processing', 'processed', 'ignored', 'failed')),
	CONSTRAINT "payout_provider_event_provider_allowed" CHECK ("provider" IN ('fake', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "settlement_reconciliation_run" (
	"id" text PRIMARY KEY NOT NULL,
	"run_type" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"triggered_by" text NOT NULL,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "settlement_reconciliation_type_allowed" CHECK ("run_type" IN ('SETTLEMENT_PROJECTION', 'PAYOUT_STATUS')),
	CONSTRAINT "settlement_reconciliation_status_allowed" CHECK ("status" IN ('running', 'completed', 'failed', 'mismatch_detected'))
);
--> statement-breakpoint
CREATE TABLE "settlement_adjustment" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"direction" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason_description" text NOT NULL,
	"evidence_reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_adjustment_amount_range" CHECK ("amount" >= 0 AND "amount" <= 1000000000000000),
	CONSTRAINT "settlement_adjustment_amount_positive" CHECK ("amount" > 0),
	CONSTRAINT "settlement_adjustment_direction_allowed" CHECK ("direction" IN ('DEBIT', 'CREDIT'))
);
--> statement-breakpoint
ALTER TABLE "settlement_account" ADD CONSTRAINT "settlement_account_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_account" ADD CONSTRAINT "settlement_account_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_account" ADD CONSTRAINT "settlement_account_child_order_fk" FOREIGN KEY ("child_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_journal" ADD CONSTRAINT "settlement_journal_child_order_fk" FOREIGN KEY ("child_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_journal" ADD CONSTRAINT "settlement_journal_order_item_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."wholesale_order_item"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_journal" ADD CONSTRAINT "settlement_journal_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_journal" ADD CONSTRAINT "settlement_journal_posted_by_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_posting" ADD CONSTRAINT "settlement_posting_journal_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."settlement_journal"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_posting" ADD CONSTRAINT "settlement_posting_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."settlement_account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commission_snapshot" ADD CONSTRAINT "commission_snapshot_child_fk" FOREIGN KEY ("child_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commission_snapshot" ADD CONSTRAINT "commission_snapshot_policy_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."commission_policy"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shipping_economics_policy" ADD CONSTRAINT "shipping_economics_child_fk" FOREIGN KEY ("child_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_hold" ADD CONSTRAINT "settlement_hold_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_hold" ADD CONSTRAINT "settlement_hold_placed_by_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_hold" ADD CONSTRAINT "settlement_hold_released_by_fk" FOREIGN KEY ("released_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_batch" ADD CONSTRAINT "settlement_batch_executed_by_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_batch_item" ADD CONSTRAINT "settlement_batch_item_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."settlement_batch"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_batch_item" ADD CONSTRAINT "settlement_batch_item_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_batch_item" ADD CONSTRAINT "settlement_batch_item_child_fk" FOREIGN KEY ("child_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_batch_item" ADD CONSTRAINT "settlement_batch_item_journal_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."settlement_journal"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_requested_by_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_bank_destination_fk" FOREIGN KEY ("bank_destination_id") REFERENCES "public"."supplier_bank_verification"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_approved_by_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_rejected_by_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_reservation_journal_fk" FOREIGN KEY ("reservation_journal_id") REFERENCES "public"."settlement_journal"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_withdrawal_request_fk" FOREIGN KEY ("withdrawal_request_id") REFERENCES "public"."withdrawal_request"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_initiated_by_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_success_journal_fk" FOREIGN KEY ("success_journal_id") REFERENCES "public"."settlement_journal"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_failure_reversal_journal_fk" FOREIGN KEY ("failure_reversal_journal_id") REFERENCES "public"."settlement_journal"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payout_provider_event" ADD CONSTRAINT "payout_provider_event_payout_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payout"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_reconciliation_run" ADD CONSTRAINT "settlement_reconciliation_triggered_by_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_adjustment" ADD CONSTRAINT "settlement_adjustment_journal_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."settlement_journal"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_adjustment" ADD CONSTRAINT "settlement_adjustment_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_adjustment" ADD CONSTRAINT "settlement_adjustment_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."settlement_account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_adjustment" ADD CONSTRAINT "settlement_adjustment_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_account_supplier_type_currency_unique" ON "settlement_account" USING btree ("supplier_id","account_type","currency") WHERE "supplier_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_account_platform_type_currency_unique" ON "settlement_account" USING btree ("account_type","currency") WHERE "supplier_id" IS NULL AND "child_order_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_account_child_type_currency_unique" ON "settlement_account" USING btree ("child_order_id","account_type","currency") WHERE "child_order_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_journal_source_event_unique" ON "settlement_journal" USING btree ("source_event_type","source_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "commission_policy_version_unique" ON "commission_policy" USING btree ("policy_version");
--> statement-breakpoint
CREATE UNIQUE INDEX "commission_snapshot_child_unique" ON "commission_snapshot" USING btree ("child_order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_economics_child_unique" ON "shipping_economics_policy" USING btree ("child_order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_hold_policy_version_unique" ON "settlement_hold_policy" USING btree ("policy_version");
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_batch_code_unique" ON "settlement_batch" USING btree ("batch_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_batch_idempotency_unique" ON "settlement_batch" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawal_request_supplier_idempotency_unique" ON "withdrawal_request" USING btree ("supplier_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "payout_withdrawal_unique" ON "payout" USING btree ("withdrawal_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payout_provider_event_unique" ON "payout_provider_event" USING btree ("provider","external_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_adjustment_journal_unique" ON "settlement_adjustment" USING btree ("journal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_adjustment_idempotency_unique" ON "settlement_adjustment" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "settlement_account_supplier" ON "settlement_account" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX "settlement_account_type" ON "settlement_account" USING btree ("account_type");
--> statement-breakpoint
CREATE INDEX "settlement_journal_supplier" ON "settlement_journal" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX "settlement_journal_child_order" ON "settlement_journal" USING btree ("child_order_id");
--> statement-breakpoint
CREATE INDEX "settlement_journal_effective" ON "settlement_journal" USING btree ("effective_at");
--> statement-breakpoint
CREATE INDEX "settlement_posting_journal" ON "settlement_posting" USING btree ("journal_id");
--> statement-breakpoint
CREATE INDEX "settlement_posting_account_created" ON "settlement_posting" USING btree ("account_id","created_at");
--> statement-breakpoint
CREATE INDEX "settlement_hold_supplier_status" ON "settlement_hold" USING btree ("supplier_id","status");
--> statement-breakpoint
CREATE INDEX "settlement_batch_item_batch" ON "settlement_batch_item" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX "settlement_batch_item_supplier" ON "settlement_batch_item" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX "settlement_batch_item_child" ON "settlement_batch_item" USING btree ("child_order_id");
--> statement-breakpoint
CREATE INDEX "withdrawal_request_supplier_status" ON "withdrawal_request" USING btree ("supplier_id","status");
--> statement-breakpoint
CREATE INDEX "payout_supplier_status" ON "payout" USING btree ("supplier_id","status");
--> statement-breakpoint
CREATE INDEX "payout_provider_reference" ON "payout" USING btree ("provider","provider_reference");
--> statement-breakpoint
CREATE INDEX "payout_provider_event_payout" ON "payout_provider_event" USING btree ("payout_id");
--> statement-breakpoint
CREATE INDEX "settlement_reconciliation_run_type_status" ON "settlement_reconciliation_run" USING btree ("run_type","status");
--> statement-breakpoint
CREATE INDEX "settlement_adjustment_supplier" ON "settlement_adjustment" USING btree ("supplier_id");
--> statement-breakpoint
-- ── Immutability trigger for append-only settlement evidence ────────────────
CREATE OR REPLACE FUNCTION kolbe_settlement_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is immutable settlement evidence: % forbidden', TG_TABLE_NAME, TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER kolbe_settlement_journal_append_only
  BEFORE UPDATE OR DELETE ON "settlement_journal"
  FOR EACH ROW EXECUTE FUNCTION kolbe_settlement_append_only();
--> statement-breakpoint
CREATE TRIGGER kolbe_settlement_posting_append_only
  BEFORE UPDATE OR DELETE ON "settlement_posting"
  FOR EACH ROW EXECUTE FUNCTION kolbe_settlement_append_only();
--> statement-breakpoint
CREATE TRIGGER kolbe_settlement_adjustment_append_only
  BEFORE UPDATE OR DELETE ON "settlement_adjustment"
  FOR EACH ROW EXECUTE FUNCTION kolbe_settlement_append_only();
--> statement-breakpoint
CREATE TRIGGER kolbe_commission_snapshot_append_only
  BEFORE UPDATE OR DELETE ON "commission_snapshot"
  FOR EACH ROW EXECUTE FUNCTION kolbe_settlement_append_only();
--> statement-breakpoint
CREATE TRIGGER kolbe_shipping_economics_policy_append_only
  BEFORE UPDATE OR DELETE ON "shipping_economics_policy"
  FOR EACH ROW EXECUTE FUNCTION kolbe_settlement_append_only();
--> statement-breakpoint
-- ── Hold release-only guard ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION kolbe_settlement_hold_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% % cannot be deleted (immutable hold history)', TG_TABLE_NAME, OLD.id;
  END IF;
  IF OLD.status = 'released' THEN
    RAISE EXCEPTION 'settlement_hold % is already released and cannot be modified', OLD.id;
  END IF;
  IF NEW.status = 'released' AND NEW.released_at IS NULL THEN
    RAISE EXCEPTION 'settlement_hold % released transition requires released_at', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER kolbe_settlement_hold_guard_trg
  BEFORE UPDATE OR DELETE ON "settlement_hold"
  FOR EACH ROW EXECUTE FUNCTION kolbe_settlement_hold_guard();
--> statement-breakpoint
-- ── Deferred constraint trigger for balanced double-entry subledger ─────────
CREATE OR REPLACE FUNCTION kolbe_settlement_journal_balance_check() RETURNS TRIGGER AS $$
DECLARE
  v_debit_sum numeric;
  v_credit_sum numeric;
  v_journal_id text;
BEGIN
  v_journal_id := NEW.journal_id;
  SELECT
    COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0)
  INTO v_debit_sum, v_credit_sum
  FROM settlement_posting
  WHERE journal_id = v_journal_id;

  IF v_debit_sum <> v_credit_sum THEN
    RAISE EXCEPTION 'settlement_journal % is unbalanced: debits (%) <> credits (%)', v_journal_id, v_debit_sum, v_credit_sum;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER kolbe_settlement_journal_balance_trg
  AFTER INSERT ON "settlement_posting"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kolbe_settlement_journal_balance_check();
