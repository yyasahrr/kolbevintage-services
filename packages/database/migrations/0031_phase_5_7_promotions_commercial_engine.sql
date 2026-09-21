/* Phase 5.7 additive extensions to existing owner-domain state checks. Earlier migrations remain immutable. */

ALTER TABLE "admin_role_permission" DROP CONSTRAINT IF EXISTS "admin_role_permission_action_allowed";
--> statement-breakpoint
ALTER TABLE "admin_role_permission" ADD CONSTRAINT "admin_role_permission_action_allowed" CHECK ("action" IN ('wholesale:plan:view', 'wholesale:plan:manage', 'wholesale:membership:view', 'wholesale:membership:manage', 'wholesale:membership:override', 'wholesale:approval:view', 'wholesale:approval:create', 'wholesale:approval:decide', 'wholesale:settings:view', 'wholesale:settings:manage', 'wholesale:notes:view', 'wholesale:notes:create', 'wholesale:control_tower:view', 'crm:customer:view', 'crm:customer:manage', 'crm:stage:manage', 'crm:assign:manage', 'crm:activity:create', 'crm:task:manage', 'crm:tag:manage', 'crm:export', 'crm:sensitive:view', 'support:case:view', 'support:case:reply', 'support:case:assign', 'support:case:priority', 'support:case:resolve', 'support:internal_note:create', 'support:attachment:view', 'support:sla:manage', 'support:report:view', 'support:sensitive:view', 'notification:template:view', 'notification:template:manage', 'notification:outbox:view', 'notification:outbox:retry', 'notification:provider:view', 'notification:preference:manage', 'notification:report:view', 'cms:content:view', 'cms:content:create', 'cms:content:edit', 'cms:content:publish', 'cms:content:archive', 'cms:navigation:manage', 'cms:media:manage', 'cms:seo:manage', 'cms:blog:manage', 'analytics:dashboard:view', 'analytics:report:view', 'analytics:report:manage', 'analytics:export', 'analytics:reconciliation:view', 'production:jobs:view', 'production:config:view', 'production:config:manage', 'production:quality:review', 'production:release:decide', 'production:recall:approve', 'promotion:view', 'promotion:create', 'promotion:edit', 'promotion:publish', 'promotion:pause', 'promotion:coupon:manage'));
--> statement-breakpoint

/*
 * Phase 5.7 — Promotions / Campaign / Commercial Engine
 *
 * Promotions decides commercial eligibility + benefit only. Promotion identity
 * is separate from versioned commercial terms: once a revision is published,
 * its terms are frozen (service + triggers below), and every redemption /
 * usage row references the exact revision applied. Money is BIGINT IRR,
 * percents are integer basis points. Targets are allowlisted (type,
 * reference) rows — there is no executable rule language.
 */

ALTER TABLE approval_request DROP CONSTRAINT IF EXISTS approval_request_type_allowed;
--> statement-breakpoint
ALTER TABLE approval_request
  ADD CONSTRAINT approval_request_type_allowed CHECK (request_type IN (
    'MEMBERSHIP_OVERRIDE', 'MEMBERSHIP_PLAN_CHANGE', 'PLAN_VERSION_PUBLISH',
    'BUSINESS_SETTING_CHANGE', 'MEMBERSHIP_MANUAL_ACTIVATE', 'MEMBERSHIP_TERMINATE',
    'PRODUCTION_RECALL', 'PROMOTION_PUBLISH'
  ));
--> statement-breakpoint

CREATE TABLE promotion (
  id text PRIMARY KEY,
  promotion_key text NOT NULL,
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  current_published_revision_id text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_channel_allowed CHECK (channel IN ('RETAIL', 'WHOLESALE')),
  CONSTRAINT promotion_status_allowed CHECK (status IN ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED')),
  CONSTRAINT promotion_key_format CHECK (promotion_key ~ '^[A-Z0-9][A-Z0-9._-]{2,63}$'),
  CONSTRAINT promotion_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX promotion_key_unique ON promotion(promotion_key);
--> statement-breakpoint
CREATE INDEX promotion_channel_status ON promotion(channel, status);
--> statement-breakpoint

CREATE TABLE promotion_revision (
  id text PRIMARY KEY,
  promotion_id text NOT NULL,
  revision_number integer NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  stacking_policy text NOT NULL DEFAULT 'STACKABLE',
  priority integer NOT NULL DEFAULT 100,
  coupon_required boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit_total integer,
  usage_limit_per_customer integer,
  approval_request_id text,
  terms_hash text NOT NULL,
  published_at timestamptz,
  published_by text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_revision_status_allowed CHECK (status IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),
  CONSTRAINT promotion_revision_stacking_allowed CHECK (stacking_policy IN ('EXCLUSIVE', 'STACKABLE')),
  CONSTRAINT promotion_revision_number_positive CHECK (revision_number > 0),
  CONSTRAINT promotion_revision_priority_non_negative CHECK (priority >= 0),
  CONSTRAINT promotion_revision_window_valid CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CONSTRAINT promotion_revision_usage_limit_total_positive CHECK (usage_limit_total IS NULL OR usage_limit_total > 0),
  CONSTRAINT promotion_revision_usage_limit_per_customer_positive CHECK (usage_limit_per_customer IS NULL OR usage_limit_per_customer > 0),
  CONSTRAINT promotion_revision_terms_hash_format CHECK (terms_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT promotion_revision_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotion(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_revision_approval_request_fk FOREIGN KEY (approval_request_id) REFERENCES approval_request(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_revision_published_by_fk FOREIGN KEY (published_by) REFERENCES account_user(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_revision_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX promotion_revision_number_unique ON promotion_revision(promotion_id, revision_number);
--> statement-breakpoint
CREATE INDEX promotion_revision_promotion_status ON promotion_revision(promotion_id, status);
--> statement-breakpoint
ALTER TABLE promotion
  ADD CONSTRAINT promotion_current_revision_fk FOREIGN KEY (current_published_revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT;
--> statement-breakpoint

CREATE TABLE promotion_target (
  id text PRIMARY KEY,
  revision_id text NOT NULL,
  target_type text NOT NULL,
  reference_id text,
  min_subtotal bigint,
  min_quantity integer,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_target_type_allowed CHECK (target_type IN ('CHANNEL', 'PRODUCT', 'CATEGORY', 'OFFER', 'VIP_PLAN', 'VIP_ACCOUNT', 'CUSTOMER_SEGMENT', 'MIN_SUBTOTAL', 'MIN_QUANTITY', 'DATE_WINDOW')),
  CONSTRAINT promotion_target_shape_valid CHECK (
    (target_type IN ('PRODUCT', 'CATEGORY', 'OFFER', 'VIP_PLAN', 'VIP_ACCOUNT', 'CUSTOMER_SEGMENT', 'CHANNEL') AND reference_id IS NOT NULL AND min_subtotal IS NULL AND min_quantity IS NULL AND starts_at IS NULL AND ends_at IS NULL)
    OR (target_type = 'MIN_SUBTOTAL' AND min_subtotal IS NOT NULL AND reference_id IS NULL AND min_quantity IS NULL AND starts_at IS NULL AND ends_at IS NULL)
    OR (target_type = 'MIN_QUANTITY' AND min_quantity IS NOT NULL AND reference_id IS NULL AND min_subtotal IS NULL AND starts_at IS NULL AND ends_at IS NULL)
    OR (target_type = 'DATE_WINDOW' AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at AND reference_id IS NULL AND min_subtotal IS NULL AND min_quantity IS NULL)
  ),
  CONSTRAINT promotion_target_channel_reference_valid CHECK (target_type <> 'CHANNEL' OR reference_id IN ('RETAIL', 'WHOLESALE')),
  CONSTRAINT promotion_target_min_subtotal_range CHECK (min_subtotal IS NULL OR (min_subtotal >= 0 AND min_subtotal <= 1000000000000000)),
  CONSTRAINT promotion_target_min_quantity_positive CHECK (min_quantity IS NULL OR min_quantity > 0),
  CONSTRAINT promotion_target_revision_fk FOREIGN KEY (revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX promotion_target_revision ON promotion_target(revision_id);
--> statement-breakpoint

CREATE TABLE promotion_benefit (
  id text PRIMARY KEY,
  revision_id text NOT NULL,
  benefit_type text NOT NULL,
  scope text NOT NULL,
  percent_bps integer,
  amount bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_benefit_type_allowed CHECK (benefit_type IN ('PERCENT_DISCOUNT', 'FIXED_AMOUNT_DISCOUNT', 'FREE_SHIPPING')),
  CONSTRAINT promotion_benefit_scope_allowed CHECK (scope IN ('ORDER', 'LINE', 'SHIPPING')),
  CONSTRAINT promotion_benefit_shape_valid CHECK (
    (benefit_type = 'PERCENT_DISCOUNT' AND scope IN ('LINE', 'ORDER') AND percent_bps >= 1 AND percent_bps <= 10000 AND amount IS NULL)
    OR (benefit_type = 'FIXED_AMOUNT_DISCOUNT' AND scope = 'ORDER' AND amount > 0 AND amount <= 1000000000000000 AND percent_bps IS NULL)
    OR (benefit_type = 'FREE_SHIPPING' AND scope = 'SHIPPING' AND percent_bps IS NULL AND amount IS NULL)
  ),
  CONSTRAINT promotion_benefit_revision_fk FOREIGN KEY (revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX promotion_benefit_revision ON promotion_benefit(revision_id);
--> statement-breakpoint

CREATE TABLE promotion_coupon (
  id text PRIMARY KEY,
  promotion_id text NOT NULL,
  revision_id text,
  code text NOT NULL,
  code_normalized text NOT NULL,
  status text NOT NULL DEFAULT 'ENABLED',
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer,
  per_customer_limit integer,
  redeemed_count integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_coupon_status_allowed CHECK (status IN ('ENABLED', 'DISABLED')),
  CONSTRAINT promotion_coupon_window_valid CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CONSTRAINT promotion_coupon_usage_limit_positive CHECK (usage_limit IS NULL OR usage_limit > 0),
  CONSTRAINT promotion_coupon_per_customer_limit_positive CHECK (per_customer_limit IS NULL OR per_customer_limit > 0),
  CONSTRAINT promotion_coupon_redeemed_count_non_negative CHECK (redeemed_count >= 0),
  CONSTRAINT promotion_coupon_code_normalized_format CHECK (code_normalized ~ '^[A-Z0-9][A-Z0-9._-]{1,63}$'),
  CONSTRAINT promotion_coupon_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotion(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_coupon_revision_fk FOREIGN KEY (revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_coupon_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX promotion_coupon_code_unique ON promotion_coupon(code_normalized);
--> statement-breakpoint
CREATE INDEX promotion_coupon_promotion_status ON promotion_coupon(promotion_id, status);
--> statement-breakpoint
CREATE INDEX promotion_coupon_revision ON promotion_coupon(revision_id);
--> statement-breakpoint

CREATE TABLE promotion_coupon_redemption (
  id text PRIMARY KEY,
  coupon_id text NOT NULL,
  promotion_id text NOT NULL,
  revision_id text NOT NULL,
  channel text NOT NULL,
  customer_key text NOT NULL,
  order_reference text,
  base_amount bigint NOT NULL,
  discount_amount bigint NOT NULL,
  final_amount bigint NOT NULL,
  evaluation_hash text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_coupon_redemption_channel_allowed CHECK (channel IN ('RETAIL', 'WHOLESALE')),
  CONSTRAINT promotion_coupon_redemption_base_amount_range CHECK (base_amount >= 0 AND base_amount <= 1000000000000000),
  CONSTRAINT promotion_coupon_redemption_discount_amount_range CHECK (discount_amount >= 0 AND discount_amount <= 1000000000000000),
  CONSTRAINT promotion_coupon_redemption_final_amount_range CHECK (final_amount >= 0 AND final_amount <= 1000000000000000),
  CONSTRAINT promotion_coupon_redemption_amounts_consistent CHECK (discount_amount <= base_amount AND final_amount = base_amount - discount_amount),
  CONSTRAINT promotion_coupon_redemption_evaluation_hash_format CHECK (evaluation_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT promotion_coupon_redemption_coupon_fk FOREIGN KEY (coupon_id) REFERENCES promotion_coupon(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_coupon_redemption_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotion(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_coupon_redemption_revision_fk FOREIGN KEY (revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX promotion_coupon_redemption_idempotency_unique ON promotion_coupon_redemption(coupon_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX promotion_coupon_redemption_coupon_created ON promotion_coupon_redemption(coupon_id, created_at);
--> statement-breakpoint
CREATE INDEX promotion_coupon_redemption_promotion_customer ON promotion_coupon_redemption(promotion_id, customer_key);
--> statement-breakpoint
CREATE INDEX promotion_coupon_redemption_revision ON promotion_coupon_redemption(revision_id);
--> statement-breakpoint

CREATE TABLE promotion_usage (
  id text PRIMARY KEY,
  promotion_id text NOT NULL,
  revision_id text NOT NULL,
  channel text NOT NULL,
  customer_key text NOT NULL,
  order_reference text,
  base_amount bigint NOT NULL,
  discount_amount bigint NOT NULL,
  final_amount bigint NOT NULL,
  evaluation_hash text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_usage_channel_allowed CHECK (channel IN ('RETAIL', 'WHOLESALE')),
  CONSTRAINT promotion_usage_base_amount_range CHECK (base_amount >= 0 AND base_amount <= 1000000000000000),
  CONSTRAINT promotion_usage_discount_amount_range CHECK (discount_amount >= 0 AND discount_amount <= 1000000000000000),
  CONSTRAINT promotion_usage_final_amount_range CHECK (final_amount >= 0 AND final_amount <= 1000000000000000),
  CONSTRAINT promotion_usage_amounts_consistent CHECK (discount_amount <= base_amount AND final_amount = base_amount - discount_amount),
  CONSTRAINT promotion_usage_evaluation_hash_format CHECK (evaluation_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT promotion_usage_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotion(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_usage_revision_fk FOREIGN KEY (revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX promotion_usage_idempotency_unique ON promotion_usage(promotion_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX promotion_usage_promotion_customer ON promotion_usage(promotion_id, customer_key);
--> statement-breakpoint
CREATE INDEX promotion_usage_revision ON promotion_usage(revision_id);
--> statement-breakpoint

CREATE TABLE promotion_schedule (
  id text PRIMARY KEY,
  promotion_id text NOT NULL,
  revision_id text NOT NULL,
  action text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED',
  attempt_count integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  executed_at timestamptz,
  last_error text,
  idempotency_key text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_schedule_action_allowed CHECK (action IN ('ACTIVATE', 'DEACTIVATE')),
  CONSTRAINT promotion_schedule_status_allowed CHECK (status IN ('SCHEDULED', 'PROCESSING', 'EXECUTED', 'FAILED', 'CANCELLED')),
  CONSTRAINT promotion_schedule_attempt_count_non_negative CHECK (attempt_count >= 0),
  CONSTRAINT promotion_schedule_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotion(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_schedule_revision_fk FOREIGN KEY (revision_id) REFERENCES promotion_revision(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_schedule_created_by_fk FOREIGN KEY (created_by) REFERENCES account_user(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX promotion_schedule_idempotency_unique ON promotion_schedule(idempotency_key);
--> statement-breakpoint
CREATE INDEX promotion_schedule_status_scheduled ON promotion_schedule(status, scheduled_at);
--> statement-breakpoint
CREATE INDEX promotion_schedule_promotion ON promotion_schedule(promotion_id);
--> statement-breakpoint

/*
 * Immutability guards. Published commercial terms must never be silently
 * mutated: editing an active campaign always creates a new draft revision.
 * Ledger rows (redemptions, usage) are append-only history.
 */

CREATE OR REPLACE FUNCTION phase_5_7_reject_published_revision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('PUBLISHED', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'promotion_revision % is immutable once published', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.promotion_id IS DISTINCT FROM OLD.promotion_id
     OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'promotion_revision identity columns are immutable';
  END IF;
  IF OLD.status IN ('PUBLISHED', 'SUPERSEDED') THEN
    IF NEW.stacking_policy IS DISTINCT FROM OLD.stacking_policy
       OR NEW.priority IS DISTINCT FROM OLD.priority
       OR NEW.coupon_required IS DISTINCT FROM OLD.coupon_required
       OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
       OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
       OR NEW.usage_limit_total IS DISTINCT FROM OLD.usage_limit_total
       OR NEW.usage_limit_per_customer IS DISTINCT FROM OLD.usage_limit_per_customer
       OR NEW.approval_request_id IS DISTINCT FROM OLD.approval_request_id
       OR NEW.terms_hash IS DISTINCT FROM OLD.terms_hash
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
      RAISE EXCEPTION 'promotion_revision % commercial terms are immutable once published', OLD.id;
    END IF;
    IF NEW.status NOT IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') THEN
      RAISE EXCEPTION 'promotion_revision % cannot return to editable status %', OLD.id, NEW.status;
    END IF;
    IF OLD.status = 'SUPERSEDED' AND NEW.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'promotion_revision % is superseded and cannot be republished', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER promotion_revision_immutable_once_published BEFORE UPDATE OR DELETE ON promotion_revision FOR EACH ROW EXECUTE FUNCTION phase_5_7_reject_published_revision_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION phase_5_7_reject_published_terms_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO parent_status FROM promotion_revision WHERE id = OLD.revision_id;
  ELSE
    SELECT status INTO parent_status FROM promotion_revision WHERE id = NEW.revision_id;
  END IF;
  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'promotion terms require an existing revision';
  END IF;
  IF parent_status NOT IN ('DRAFT', 'IN_REVIEW') THEN
    RAISE EXCEPTION 'promotion terms are immutable once the revision is published';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER promotion_target_immutable_once_published BEFORE INSERT OR UPDATE OR DELETE ON promotion_target FOR EACH ROW EXECUTE FUNCTION phase_5_7_reject_published_terms_mutation();
--> statement-breakpoint
CREATE TRIGGER promotion_benefit_immutable_once_published BEFORE INSERT OR UPDATE OR DELETE ON promotion_benefit FOR EACH ROW EXECUTE FUNCTION phase_5_7_reject_published_terms_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION phase_5_7_reject_promotion_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'promotion ledger rows are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER promotion_coupon_redemption_append_only BEFORE UPDATE OR DELETE ON promotion_coupon_redemption FOR EACH ROW EXECUTE FUNCTION phase_5_7_reject_promotion_history_mutation();
--> statement-breakpoint
CREATE TRIGGER promotion_usage_append_only BEFORE UPDATE OR DELETE ON promotion_usage FOR EACH ROW EXECUTE FUNCTION phase_5_7_reject_promotion_history_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION phase_5_7_reject_coupon_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.promotion_id IS DISTINCT FROM OLD.promotion_id
     OR NEW.revision_id IS DISTINCT FROM OLD.revision_id
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.code_normalized IS DISTINCT FROM OLD.code_normalized THEN
    RAISE EXCEPTION 'promotion_coupon identity columns are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER promotion_coupon_identity_immutable BEFORE UPDATE ON promotion_coupon FOR EACH ROW EXECUTE FUNCTION phase_5_7_reject_coupon_identity_mutation();
