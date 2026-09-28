/* Phase 5.7 additive extensions to existing owner-domain state checks. Earlier migrations remain immutable. */

ALTER TABLE "admin_role_permission" DROP CONSTRAINT IF EXISTS "admin_role_permission_action_allowed";
--> statement-breakpoint
ALTER TABLE "admin_role_permission" ADD CONSTRAINT "admin_role_permission_action_allowed" CHECK ("action" IN ('wholesale:plan:view', 'wholesale:plan:manage', 'wholesale:membership:view', 'wholesale:membership:manage', 'wholesale:membership:override', 'wholesale:approval:view', 'wholesale:approval:create', 'wholesale:approval:decide', 'wholesale:settings:view', 'wholesale:settings:manage', 'wholesale:notes:view', 'wholesale:notes:create', 'wholesale:control_tower:view', 'crm:customer:view', 'crm:customer:manage', 'crm:stage:manage', 'crm:assign:manage', 'crm:activity:create', 'crm:task:manage', 'crm:tag:manage', 'crm:export', 'crm:sensitive:view', 'support:case:view', 'support:case:reply', 'support:case:assign', 'support:case:priority', 'support:case:resolve', 'support:internal_note:create', 'support:attachment:view', 'support:sla:manage', 'support:report:view', 'support:sensitive:view', 'notification:template:view', 'notification:template:manage', 'notification:outbox:view', 'notification:outbox:retry', 'notification:provider:view', 'notification:preference:manage', 'notification:report:view', 'cms:content:view', 'cms:content:create', 'cms:content:edit', 'cms:content:publish', 'cms:content:archive', 'cms:navigation:manage', 'cms:media:manage', 'cms:seo:manage', 'cms:blog:manage', 'analytics:dashboard:view', 'analytics:report:view', 'analytics:report:manage', 'analytics:export', 'analytics:reconciliation:view', 'production:jobs:view', 'production:config:view', 'production:config:manage', 'production:quality:review', 'production:release:decide', 'production:recall:approve', 'promotion:view', 'promotion:create', 'promotion:edit', 'promotion:publish', 'promotion:pause', 'promotion:coupon:manage'));
--> statement-breakpoint

/*
 * Phase 5.7 — Promotions / Campaign / Commercial Engine
 *
 * Promotion identity is separate from versioned commercial terms. A published
 * revision (terms + targets) is immutable: editing a live promotion creates a
 * new draft revision. Coupons are first-class rows bound to an exact revision.
 * Cross-domain references are plain text revalidated through owner services;
 * this migration adds no foreign keys outside the promotions tables.
 */

CREATE TABLE promotion (
  id text PRIMARY KEY,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  current_published_revision_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_channel_allowed CHECK ("channel" IN ('RETAIL', 'WHOLESALE')),
  CONSTRAINT promotion_status_allowed CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE promotion_revision (
  id text PRIMARY KEY,
  promotion_id text NOT NULL,
  revision_number integer NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  benefit_type text NOT NULL,
  benefit_scope text NOT NULL,
  percent_bps integer,
  amount bigint,
  currency text NOT NULL DEFAULT 'IRR',
  stacking_policy text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  max_total_uses integer,
  max_uses_per_actor integer,
  coupon_required boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  terms_hash text NOT NULL,
  published_at timestamptz,
  published_by text,
  superseded_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_revision_status_allowed CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  CONSTRAINT promotion_revision_benefit_type_allowed CHECK ("benefit_type" IN ('PERCENT_DISCOUNT', 'FIXED_AMOUNT_DISCOUNT', 'FREE_SHIPPING')),
  CONSTRAINT promotion_revision_benefit_scope_allowed CHECK ("benefit_scope" IN ('ORDER', 'LINE', 'SHIPPING')),
  CONSTRAINT promotion_revision_currency_allowed CHECK ("currency" IN ('IRR')),
  CONSTRAINT promotion_revision_stacking_allowed CHECK ("stacking_policy" IN ('EXCLUSIVE', 'STACKABLE')),
  CONSTRAINT promotion_revision_number_positive CHECK ("revision_number" > 0),
  CONSTRAINT promotion_revision_priority_non_negative CHECK ("priority" >= 0),
  CONSTRAINT promotion_revision_amount_range CHECK ("amount" >= 0 AND "amount" <= 1000000000000000),
  CONSTRAINT promotion_revision_bps_range CHECK ("percent_bps" IS NULL OR ("percent_bps" >= 1 AND "percent_bps" <= 10000)),
  CONSTRAINT promotion_revision_max_total_uses_positive CHECK ("max_total_uses" IS NULL OR "max_total_uses" > 0),
  CONSTRAINT promotion_revision_max_uses_per_actor_positive CHECK ("max_uses_per_actor" IS NULL OR "max_uses_per_actor" > 0),
  CONSTRAINT promotion_revision_window_valid CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT promotion_revision_benefit_coherent CHECK (("benefit_type" = 'PERCENT_DISCOUNT' AND "benefit_scope" IN ('LINE', 'ORDER') AND "percent_bps" IS NOT NULL AND "amount" IS NULL) OR ("benefit_type" = 'FIXED_AMOUNT_DISCOUNT' AND "benefit_scope" = 'ORDER' AND "amount" IS NOT NULL AND "percent_bps" IS NULL) OR ("benefit_type" = 'FREE_SHIPPING' AND "benefit_scope" = 'SHIPPING' AND "percent_bps" IS NULL AND "amount" IS NULL)),
  CONSTRAINT promotion_revision_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotion(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE promotion_target (
  id text PRIMARY KEY,
  revision_id text NOT NULL,
  target_type text NOT NULL,
  value_text text,
  value_amount bigint,
  value_quantity integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_target_type_allowed CHECK ("target_type" IN ('PRODUCT', 'CATEGORY', 'OFFER', 'VIP_PLAN', 'VIP_ACCOUNT', 'CUSTOMER_SEGMENT', 'MIN_SUBTOTAL', 'MIN_QUANTITY')),
  CONSTRAINT promotion_target_value_amount_range CHECK ("value_amount" >= 0 AND "value_amount" <= 1000000000000000),
  CONSTRAINT promotion_target_value_quantity_positive CHECK ("value_quantity" IS NULL OR "value_quantity" > 0),
  CONSTRAINT promotion_target_value_coherent CHECK (("target_type" IN ('PRODUCT', 'CATEGORY', 'OFFER', 'VIP_PLAN', 'VIP_ACCOUNT', 'CUSTOMER_SEGMENT') AND "value_text" IS NOT NULL AND "value_amount" IS NULL AND "value_quantity" IS NULL) OR ("target_type" = 'MIN_SUBTOTAL' AND "value_amount" IS NOT NULL AND "value_text" IS NULL AND "value_quantity" IS NULL) OR ("target_type" = 'MIN_QUANTITY' AND "value_quantity" IS NOT NULL AND "value_text" IS NULL AND "value_amount" IS NULL)),
  CONSTRAINT promotion_target_revision_fk FOREIGN KEY (revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE promotion_coupon (
  id text PRIMARY KEY,
  promotion_id text NOT NULL,
  revision_id text NOT NULL,
  code text NOT NULL,
  code_normalized text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer NOT NULL,
  used_count integer NOT NULL DEFAULT 0,
  per_actor_limit integer,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_coupon_usage_limit_positive CHECK ("usage_limit" > 0),
  CONSTRAINT promotion_coupon_used_count_non_negative CHECK ("used_count" >= 0),
  CONSTRAINT promotion_coupon_used_within_limit CHECK ("used_count" <= "usage_limit"),
  CONSTRAINT promotion_coupon_per_actor_limit_positive CHECK ("per_actor_limit" IS NULL OR "per_actor_limit" > 0),
  CONSTRAINT promotion_coupon_window_valid CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT promotion_coupon_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotion(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_coupon_revision_fk FOREIGN KEY (revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE promotion_coupon_redemption (
  id text PRIMARY KEY,
  -- Nullable: automatic (codeless) promotions redeem without a coupon row.
  coupon_id text,
  promotion_id text NOT NULL,
  revision_id text NOT NULL,
  actor_type text NOT NULL,
  actor_ref text NOT NULL,
  base_amount bigint NOT NULL,
  discount_amount bigint NOT NULL,
  order_reference text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_coupon_redemption_actor_type_allowed CHECK ("actor_type" IN ('RETAIL_CUSTOMER', 'WHOLESALE_ACCOUNT')),
  CONSTRAINT promotion_coupon_redemption_base_amount_range CHECK ("base_amount" >= 0 AND "base_amount" <= 1000000000000000),
  CONSTRAINT promotion_coupon_redemption_discount_amount_range CHECK ("discount_amount" >= 0 AND "discount_amount" <= 1000000000000000),
  CONSTRAINT promotion_coupon_redemption_discount_within_base CHECK ("discount_amount" <= "base_amount"),
  CONSTRAINT promotion_coupon_redemption_coupon_fk FOREIGN KEY (coupon_id) REFERENCES promotion_coupon(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_coupon_redemption_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotion(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_coupon_redemption_revision_fk FOREIGN KEY (revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE promotion_usage (
  id text PRIMARY KEY,
  promotion_id text NOT NULL,
  revision_id text NOT NULL,
  coupon_id text,
  actor_type text NOT NULL,
  actor_ref text NOT NULL,
  uses integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_usage_actor_type_allowed CHECK ("actor_type" IN ('RETAIL_CUSTOMER', 'WHOLESALE_ACCOUNT')),
  CONSTRAINT promotion_usage_uses_non_negative CHECK ("uses" >= 0),
  CONSTRAINT promotion_usage_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotion(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_usage_revision_fk FOREIGN KEY (revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_usage_coupon_fk FOREIGN KEY (coupon_id) REFERENCES promotion_coupon(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE promotion_schedule (
  id text PRIMARY KEY,
  promotion_id text NOT NULL,
  revision_id text NOT NULL,
  action text NOT NULL,
  run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED',
  claimed_by text,
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  idempotency_key text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_schedule_action_allowed CHECK ("action" IN ('ACTIVATE', 'END')),
  CONSTRAINT promotion_schedule_status_allowed CHECK ("status" IN ('SCHEDULED', 'CLAIMED', 'DONE', 'CANCELLED', 'FAILED')),
  CONSTRAINT promotion_schedule_attempts_non_negative CHECK ("attempts" >= 0),
  CONSTRAINT promotion_schedule_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotion(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_schedule_revision_fk FOREIGN KEY (revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_code_unique" ON "promotion" ("code");
--> statement-breakpoint
CREATE INDEX "promotion_status_channel_idx" ON "promotion" ("status", "channel");
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_revision_promotion_number_unique" ON "promotion_revision" ("promotion_id", "revision_number");
--> statement-breakpoint
CREATE INDEX "promotion_revision_promotion_status_idx" ON "promotion_revision" ("promotion_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_target_revision_value_unique" ON "promotion_target" ("revision_id", "target_type", "value_text") WHERE "value_text" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_target_revision_threshold_unique" ON "promotion_target" ("revision_id", "target_type") WHERE "value_text" IS NULL;
--> statement-breakpoint
CREATE INDEX "promotion_target_revision_idx" ON "promotion_target" ("revision_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_coupon_code_normalized_unique" ON "promotion_coupon" ("code_normalized");
--> statement-breakpoint
CREATE INDEX "promotion_coupon_promotion_idx" ON "promotion_coupon" ("promotion_id");
--> statement-breakpoint
CREATE INDEX "promotion_coupon_revision_idx" ON "promotion_coupon" ("revision_id");
--> statement-breakpoint
CREATE INDEX "promotion_coupon_enabled_idx" ON "promotion_coupon" ("enabled");
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_coupon_redemption_idempotency_unique" ON "promotion_coupon_redemption" ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_coupon_redemption_coupon_order_unique" ON "promotion_coupon_redemption" ("coupon_id", "order_reference") WHERE "coupon_id" IS NOT NULL AND "order_reference" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_coupon_redemption_auto_order_unique" ON "promotion_coupon_redemption" ("revision_id", "order_reference") WHERE "coupon_id" IS NULL AND "order_reference" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "promotion_coupon_redemption_coupon_created_idx" ON "promotion_coupon_redemption" ("coupon_id", "created_at");
--> statement-breakpoint
CREATE INDEX "promotion_coupon_redemption_promotion_created_idx" ON "promotion_coupon_redemption" ("promotion_id", "created_at");
--> statement-breakpoint
CREATE INDEX "promotion_coupon_redemption_actor_idx" ON "promotion_coupon_redemption" ("actor_type", "actor_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_usage_coupon_actor_unique" ON "promotion_usage" ("revision_id", "coupon_id", "actor_type", "actor_ref") WHERE "coupon_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_usage_promotion_actor_unique" ON "promotion_usage" ("revision_id", "actor_type", "actor_ref") WHERE "coupon_id" IS NULL;
--> statement-breakpoint
CREATE INDEX "promotion_usage_promotion_idx" ON "promotion_usage" ("promotion_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_schedule_idempotency_unique" ON "promotion_schedule" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "promotion_schedule_status_run_idx" ON "promotion_schedule" ("status", "run_at");
--> statement-breakpoint
CREATE INDEX "promotion_schedule_promotion_idx" ON "promotion_schedule" ("promotion_id");
--> statement-breakpoint

/*
 * Published commercial terms are immutable history: a manual query, a future
 * module, or a buggy service must not be able to rewrite or delete them. Only
 * DRAFT revisions may change or be removed; the single legal in-place
 * transition is PUBLISHED -> SUPERSEDED (status bookkeeping during publish).
 */
CREATE OR REPLACE FUNCTION kolbe_promotion_revision_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'promotion_revision % is % and cannot be deleted', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.promotion_id IS DISTINCT FROM NEW.promotion_id
    OR OLD.revision_number IS DISTINCT FROM NEW.revision_number
    OR OLD.benefit_type IS DISTINCT FROM NEW.benefit_type
    OR OLD.benefit_scope IS DISTINCT FROM NEW.benefit_scope
    OR OLD.percent_bps IS DISTINCT FROM NEW.percent_bps
    OR OLD.amount IS DISTINCT FROM NEW.amount
    OR OLD.currency IS DISTINCT FROM NEW.currency
    OR OLD.stacking_policy IS DISTINCT FROM NEW.stacking_policy
    OR OLD.priority IS DISTINCT FROM NEW.priority
    OR OLD.max_total_uses IS DISTINCT FROM NEW.max_total_uses
    OR OLD.max_uses_per_actor IS DISTINCT FROM NEW.max_uses_per_actor
    OR OLD.coupon_required IS DISTINCT FROM NEW.coupon_required
    OR OLD.starts_at IS DISTINCT FROM NEW.starts_at
    OR OLD.ends_at IS DISTINCT FROM NEW.ends_at
    OR OLD.terms_hash IS DISTINCT FROM NEW.terms_hash
    OR OLD.published_at IS DISTINCT FROM NEW.published_at
    OR OLD.published_by IS DISTINCT FROM NEW.published_by
    OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'promotion_revision % is %: commercial terms are immutable', OLD.id, OLD.status;
  END IF;
  IF OLD.status = 'PUBLISHED' AND (NEW.status = 'PUBLISHED' OR NEW.status = 'SUPERSEDED') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'promotion_revision % illegal status transition % -> %', OLD.id, OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS promotion_revision_immutable ON "promotion_revision";
--> statement-breakpoint
CREATE TRIGGER promotion_revision_immutable
  BEFORE UPDATE OR DELETE ON "promotion_revision"
  FOR EACH ROW EXECUTE FUNCTION kolbe_promotion_revision_immutable();
--> statement-breakpoint

/*
 * Targets are part of the revision terms snapshot: rows may only be added,
 * changed, or removed while the parent revision is still a DRAFT.
 */
CREATE OR REPLACE FUNCTION kolbe_promotion_target_revision_guard() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO parent_status FROM promotion_revision WHERE id = OLD.revision_id;
    IF parent_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'promotion_target of revision % (%) cannot be deleted', OLD.revision_id, parent_status;
    END IF;
    RETURN OLD;
  END IF;
  SELECT status INTO parent_status FROM promotion_revision WHERE id = NEW.revision_id;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'promotion_target of revision % (%) is immutable', NEW.revision_id, parent_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS promotion_target_revision_guard ON "promotion_target";
--> statement-breakpoint
CREATE TRIGGER promotion_target_revision_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "promotion_target"
  FOR EACH ROW EXECUTE FUNCTION kolbe_promotion_target_revision_guard();
