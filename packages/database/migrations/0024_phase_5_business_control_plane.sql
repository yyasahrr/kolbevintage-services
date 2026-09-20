-- Phase 5.0 — Business Management & Admin Control Plane Foundation
-- Forward-only. 0000-0023 are NOT modified. All FKs ON DELETE RESTRICT. No data rewrite.
-- Ownership: `vip` module (plans, versions, features, limits, memberships) and `admin` module (roles, permissions, approvals, settings, notes).

--> statement-breakpoint
CREATE TABLE "wholesale_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"tier_level" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"current_published_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_plan_status_allowed" CHECK ("status" IN ('draft', 'active', 'archived')),
	CONSTRAINT "wholesale_plan_currency_allowed" CHECK ("currency" IN ('IRR')),
	CONSTRAINT "wholesale_plan_tier_level_positive" CHECK ("tier_level" > 0),
	CONSTRAINT "wholesale_plan_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "wholesale_plan_version" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"billing_period" text DEFAULT 'annual' NOT NULL,
	"duration_days" integer DEFAULT 365 NOT NULL,
	"base_fee" bigint DEFAULT 0 NOT NULL,
	"deposit_requirement" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"change_summary" text,
	"published_by" text,
	"published_at" timestamp with time zone,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_plan_version_status_allowed" CHECK ("status" IN ('draft', 'published', 'superseded', 'archived')),
	CONSTRAINT "wholesale_plan_version_billing_period_allowed" CHECK ("billing_period" IN ('monthly', 'quarterly', 'semi_annual', 'annual', 'custom')),
	CONSTRAINT "wholesale_plan_version_duration_positive" CHECK ("duration_days" > 0),
	CONSTRAINT "wholesale_plan_version_number_positive" CHECK ("version_number" > 0),
	CONSTRAINT "wholesale_plan_version_base_fee_range" CHECK ("base_fee" >= 0 AND "base_fee" <= 1000000000000000),
	CONSTRAINT "wholesale_plan_version_deposit_range" CHECK ("deposit_requirement" >= 0 AND "deposit_requirement" <= 1000000000000000)
);
--> statement-breakpoint
CREATE TABLE "wholesale_plan_feature" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_version_id" text NOT NULL,
	"feature_key" text NOT NULL,
	"feature_type" text DEFAULT 'boolean' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"config_value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_plan_feature_type_allowed" CHECK ("feature_type" IN ('boolean', 'limit', 'config'))
);
--> statement-breakpoint
CREATE TABLE "wholesale_plan_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_version_id" text NOT NULL,
	"limit_key" text NOT NULL,
	"limit_value" bigint NOT NULL,
	"period" text DEFAULT 'order' NOT NULL,
	"is_enforced" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_plan_limit_period_allowed" CHECK ("period" IN ('order', 'day', 'month', 'year', 'lifetime')),
	CONSTRAINT "wholesale_plan_limit_value_positive" CHECK ("limit_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wholesale_membership" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_version_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"scheduled_plan_id" text,
	"scheduled_plan_version_id" text,
	"scheduled_effective_at" timestamp with time zone,
	"snapshot_features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_membership_status_allowed" CHECK ("status" IN ('pending', 'active', 'suspended', 'expired', 'cancelled', 'scheduled_change')),
	CONSTRAINT "wholesale_membership_version_positive" CHECK ("current_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "wholesale_membership_history" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"account_id" text NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"from_plan_version_id" text,
	"to_plan_version_id" text,
	"actor_id" text NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_membership_history_event_allowed" CHECK ("event_type" IN ('activated', 'renewed', 'upgraded', 'downgraded', 'plan_change_scheduled', 'suspended', 'resumed', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "admin_role" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_role_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "admin_role_permission" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_role_permission_action_allowed" CHECK ("action" IN ('wholesale:plan:view', 'wholesale:plan:manage', 'wholesale:membership:view', 'wholesale:membership:manage', 'wholesale:membership:override', 'wholesale:approval:view', 'wholesale:approval:create', 'wholesale:approval:decide', 'wholesale:settings:view', 'wholesale:settings:manage', 'wholesale:notes:view', 'wholesale:notes:create', 'wholesale:control_tower:view'))
);
--> statement-breakpoint
CREATE TABLE "admin_user_role" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" text PRIMARY KEY NOT NULL,
	"request_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"maker_id" text NOT NULL,
	"checker_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"maker_notes" text,
	"checker_notes" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"execution_result" jsonb,
	"idempotency_key" text NOT NULL,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_request_type_allowed" CHECK ("request_type" IN ('MEMBERSHIP_OVERRIDE', 'MEMBERSHIP_PLAN_CHANGE', 'PLAN_VERSION_PUBLISH', 'BUSINESS_SETTING_CHANGE', 'MEMBERSHIP_MANUAL_ACTIVATE', 'MEMBERSHIP_TERMINATE')),
	CONSTRAINT "approval_request_status_allowed" CHECK ("status" IN ('pending', 'approved', 'rejected', 'executed', 'failed', 'cancelled')),
	CONSTRAINT "maker_checker_distinct" CHECK ("checker_id" IS NULL OR "checker_id" <> "maker_id"),
	CONSTRAINT "approval_request_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "business_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text DEFAULT 'wholesale' NOT NULL,
	"key" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"value_type" text DEFAULT 'string' NOT NULL,
	"description" text,
	"is_secret" boolean DEFAULT false NOT NULL,
	"is_read_only" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_setting_category_allowed" CHECK ("category" IN ('wholesale', 'membership', 'operations', 'security', 'financial')),
	CONSTRAINT "business_setting_version_positive" CHECK ("version" > 0),
	CONSTRAINT "business_setting_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "business_setting_history" (
	"id" text PRIMARY KEY NOT NULL,
	"setting_id" text NOT NULL,
	"key" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb NOT NULL,
	"version" integer NOT NULL,
	"reason" text,
	"changed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_setting_history_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "admin_internal_note" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"author_id" text NOT NULL,
	"note_text" text NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_internal_note_target_type_allowed" CHECK ("target_type" IN ('wholesale_account', 'wholesale_membership', 'wholesale_order', 'wholesale_request', 'supplier'))
);
--> statement-breakpoint
ALTER TABLE "wholesale_plan_version" ADD CONSTRAINT "wholesale_plan_version_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."wholesale_plan"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_plan_version" ADD CONSTRAINT "wholesale_plan_version_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_plan_feature" ADD CONSTRAINT "wholesale_plan_feature_version_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."wholesale_plan_version"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_plan_limit" ADD CONSTRAINT "wholesale_plan_limit_version_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."wholesale_plan_version"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_membership" ADD CONSTRAINT "wholesale_membership_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wholesale_account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_membership" ADD CONSTRAINT "wholesale_membership_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."wholesale_plan"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_membership" ADD CONSTRAINT "wholesale_membership_plan_version_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."wholesale_plan_version"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_membership" ADD CONSTRAINT "wholesale_membership_sched_plan_fk" FOREIGN KEY ("scheduled_plan_id") REFERENCES "public"."wholesale_plan"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_membership" ADD CONSTRAINT "wholesale_membership_sched_version_fk" FOREIGN KEY ("scheduled_plan_version_id") REFERENCES "public"."wholesale_plan_version"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_membership_history" ADD CONSTRAINT "wholesale_membership_history_membership_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."wholesale_membership"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_membership_history" ADD CONSTRAINT "wholesale_membership_history_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wholesale_account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_membership_history" ADD CONSTRAINT "wholesale_membership_history_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "admin_role_permission" ADD CONSTRAINT "admin_role_permission_role_fk" FOREIGN KEY ("role_id") REFERENCES "public"."admin_role"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "admin_user_role" ADD CONSTRAINT "admin_user_role_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "admin_user_role" ADD CONSTRAINT "admin_user_role_role_fk" FOREIGN KEY ("role_id") REFERENCES "public"."admin_role"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "admin_user_role" ADD CONSTRAINT "admin_user_role_assigned_by_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_maker_fk" FOREIGN KEY ("maker_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_checker_fk" FOREIGN KEY ("checker_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_setting" ADD CONSTRAINT "business_setting_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_setting_history" ADD CONSTRAINT "business_setting_history_setting_fk" FOREIGN KEY ("setting_id") REFERENCES "public"."business_setting"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_setting_history" ADD CONSTRAINT "business_setting_history_changed_by_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "admin_internal_note" ADD CONSTRAINT "admin_internal_note_author_fk" FOREIGN KEY ("author_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "wholesale_plan_version_plan_ver_unique" ON "wholesale_plan_version" USING btree ("plan_id","version_number");
--> statement-breakpoint
CREATE INDEX "wholesale_plan_version_plan_status" ON "wholesale_plan_version" USING btree ("plan_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "wholesale_plan_feature_version_key_unique" ON "wholesale_plan_feature" USING btree ("plan_version_id","feature_key");
--> statement-breakpoint
CREATE INDEX "wholesale_plan_feature_version_idx" ON "wholesale_plan_feature" USING btree ("plan_version_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wholesale_plan_limit_version_key_unique" ON "wholesale_plan_limit" USING btree ("plan_version_id","limit_key");
--> statement-breakpoint
CREATE INDEX "wholesale_plan_limit_version_idx" ON "wholesale_plan_limit" USING btree ("plan_version_id");
--> statement-breakpoint
CREATE INDEX "wholesale_membership_account_status_idx" ON "wholesale_membership" USING btree ("account_id","status");
--> statement-breakpoint
CREATE INDEX "wholesale_membership_status_expires_idx" ON "wholesale_membership" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE INDEX "wholesale_membership_history_membership_idx" ON "wholesale_membership_history" USING btree ("membership_id","created_at");
--> statement-breakpoint
CREATE INDEX "wholesale_membership_history_account_idx" ON "wholesale_membership_history" USING btree ("account_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_role_permission_role_action_unique" ON "admin_role_permission" USING btree ("role_id","action");
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_user_role_user_role_unique" ON "admin_user_role" USING btree ("user_id","role_id");
--> statement-breakpoint
CREATE INDEX "approval_request_status_type_idx" ON "approval_request" USING btree ("status","request_type");
--> statement-breakpoint
CREATE INDEX "approval_request_maker_idx" ON "approval_request" USING btree ("maker_id");
--> statement-breakpoint
CREATE INDEX "approval_request_checker_idx" ON "approval_request" USING btree ("checker_id");
--> statement-breakpoint
CREATE INDEX "approval_request_target_idx" ON "approval_request" USING btree ("target_type","target_id");
--> statement-breakpoint
CREATE INDEX "business_setting_category_idx" ON "business_setting" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "business_setting_history_setting_ver_idx" ON "business_setting_history" USING btree ("setting_id","version");
--> statement-breakpoint
CREATE INDEX "admin_internal_note_target_idx" ON "admin_internal_note" USING btree ("target_type","target_id","created_at");
--> statement-breakpoint
CREATE INDEX "admin_internal_note_author_idx" ON "admin_internal_note" USING btree ("author_id");
