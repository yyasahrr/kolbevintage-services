-- Phase 4.1 — Inventory transaction hardening + persistent idempotency
-- Goals: close I-01..I-11 critical/high inventory risks

-- 1) Add idempotency and allocation columns to inventory_reservation
ALTER TABLE "inventory_reservation" ADD COLUMN "idempotency_key" text;
ALTER TABLE "inventory_reservation" ADD COLUMN "allocation_id" text;
--> statement-breakpoint
-- Normalize existing zero quantities before strengthening constraint (pre-launch dev data)
UPDATE "inventory_reservation" SET "quantity" = 1 WHERE "quantity" <= 0;
--> statement-breakpoint
-- Strengthen quantity constraint: positive only (I-06, I-11)
ALTER TABLE "inventory_reservation" DROP CONSTRAINT IF EXISTS "inventory_reservation_quantity_non_negative";
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_quantity_positive" CHECK ("quantity" > 0);
--> statement-breakpoint
-- Indexes for idempotency and allocation (business uniqueness, I-06)
CREATE INDEX "inventory_reservation_allocation" ON "inventory_reservation" ("allocation_id");
CREATE UNIQUE INDEX "inventory_reservation_idempotency_unique" ON "inventory_reservation" ("seller_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "inventory_reservation_allocation_unique" ON "inventory_reservation" ("allocation_id", "seller_id", "variant_id") WHERE "allocation_id" IS NOT NULL;
--> statement-breakpoint
-- 2) Create neutral command_idempotency facility (idempotency-rules.md)
CREATE TABLE "command_idempotency" (
  "id" text PRIMARY KEY NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "command_type" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "result_resource_id" text,
  "result_payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  CONSTRAINT "command_idempotency_state_allowed" CHECK ("state" IN ('pending','completed','failed')),
  CONSTRAINT "command_idempotency_command_type_allowed" CHECK ("command_type" IN ('inventory.reserve','inventory.reserve_package','inventory.release','inventory.confirm','inventory.adjust','inventory.expire_batch'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "command_idempotency_scope_key_unique" ON "command_idempotency" ("scope_type", "scope_id", "command_type", "idempotency_key");
CREATE INDEX "command_idempotency_expires" ON "command_idempotency" ("expires_at");
CREATE INDEX "command_idempotency_created" ON "command_idempotency" ("created_at");
