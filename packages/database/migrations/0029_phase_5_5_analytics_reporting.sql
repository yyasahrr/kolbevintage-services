-- Phase 5.5 — Analytics & Reporting bounded context
-- Analytics owns only validated report/export metadata. It reads authoritative
-- business domains and never writes their tables or stores business facts.

ALTER TABLE "admin_role_permission" DROP CONSTRAINT IF EXISTS "admin_role_permission_action_allowed";
--> statement-breakpoint
ALTER TABLE "admin_role_permission" ADD CONSTRAINT "admin_role_permission_action_allowed" CHECK ("action" IN ('wholesale:plan:view', 'wholesale:plan:manage', 'wholesale:membership:view', 'wholesale:membership:manage', 'wholesale:membership:override', 'wholesale:approval:view', 'wholesale:approval:create', 'wholesale:approval:decide', 'wholesale:settings:view', 'wholesale:settings:manage', 'wholesale:notes:view', 'wholesale:notes:create', 'wholesale:control_tower:view', 'crm:customer:view', 'crm:customer:manage', 'crm:stage:manage', 'crm:assign:manage', 'crm:activity:create', 'crm:task:manage', 'crm:tag:manage', 'crm:export', 'crm:sensitive:view', 'support:case:view', 'support:case:reply', 'support:case:assign', 'support:case:priority', 'support:case:resolve', 'support:internal_note:create', 'support:attachment:view', 'support:sla:manage', 'support:report:view', 'support:sensitive:view', 'notification:template:view', 'notification:template:manage', 'notification:outbox:view', 'notification:outbox:retry', 'notification:provider:view', 'notification:preference:manage', 'notification:report:view', 'cms:content:view', 'cms:content:create', 'cms:content:edit', 'cms:content:publish', 'cms:content:archive', 'cms:navigation:manage', 'cms:media:manage', 'cms:seo:manage', 'cms:blog:manage', 'analytics:dashboard:view', 'analytics:report:view', 'analytics:report:manage', 'analytics:export', 'analytics:reconciliation:view'));
--> statement-breakpoint

CREATE TABLE "analytics_saved_report" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "report_type" text DEFAULT 'SAVED_REPORT' NOT NULL,
  "scope" text NOT NULL,
  "scope_id" text,
  "definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "owner_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "analytics_saved_report_type_allowed" CHECK ("report_type" IN ('METRIC_SET', 'SAVED_REPORT')),
  CONSTRAINT "analytics_saved_report_scope_allowed" CHECK ("scope" IN ('PLATFORM', 'RETAIL', 'WHOLESALE', 'SUPPLIER', 'VIP_ACCOUNT'))
);
--> statement-breakpoint
CREATE INDEX "analytics_saved_report_owner_idx" ON "analytics_saved_report" USING btree ("owner_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "analytics_saved_report_scope_idx" ON "analytics_saved_report" USING btree ("scope", "scope_id");
--> statement-breakpoint
ALTER TABLE "analytics_saved_report" ADD CONSTRAINT "analytics_saved_report_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "analytics_report_run" (
  "id" text PRIMARY KEY NOT NULL,
  "report_type" text DEFAULT 'METRIC_SET' NOT NULL,
  "scope" text NOT NULL,
  "scope_id" text,
  "definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'QUEUED' NOT NULL,
  "source_mode" text DEFAULT 'AUTHORITATIVE_LIVE' NOT NULL,
  "data_as_of" timestamp with time zone,
  "result" jsonb,
  "error_code" text,
  "requested_by" text NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "analytics_report_run_type_allowed" CHECK ("report_type" IN ('METRIC_SET', 'SAVED_REPORT')),
  CONSTRAINT "analytics_report_run_scope_allowed" CHECK ("scope" IN ('PLATFORM', 'RETAIL', 'WHOLESALE', 'SUPPLIER', 'VIP_ACCOUNT')),
  CONSTRAINT "analytics_report_run_status_allowed" CHECK ("status" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  CONSTRAINT "analytics_report_run_source_mode_allowed" CHECK ("source_mode" IN ('AUTHORITATIVE_LIVE'))
);
--> statement-breakpoint
CREATE INDEX "analytics_report_run_requested_idx" ON "analytics_report_run" USING btree ("requested_by", "created_at");
--> statement-breakpoint
CREATE INDEX "analytics_report_run_status_idx" ON "analytics_report_run" USING btree ("status", "created_at");
--> statement-breakpoint
ALTER TABLE "analytics_report_run" ADD CONSTRAINT "analytics_report_run_requested_by_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "analytics_export_job" (
  "id" text PRIMARY KEY NOT NULL,
  "report_run_id" text NOT NULL,
  "format" text DEFAULT 'CSV' NOT NULL,
  "status" text DEFAULT 'QUEUED' NOT NULL,
  "row_limit" integer DEFAULT 10000 NOT NULL,
  "row_count" integer,
  "file_name" text NOT NULL,
  "output_text" text,
  "failure_reason" text,
  "requested_by" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "analytics_export_job_format_allowed" CHECK ("format" IN ('CSV')),
  CONSTRAINT "analytics_export_job_status_allowed" CHECK ("status" IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED')),
  CONSTRAINT "analytics_export_job_row_limit_positive" CHECK ("row_limit" > 0 AND "row_limit" <= 10000),
  CONSTRAINT "analytics_export_job_row_count_non_negative" CHECK ("row_count" IS NULL OR "row_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "analytics_export_job_requested_idx" ON "analytics_export_job" USING btree ("requested_by", "created_at");
--> statement-breakpoint
CREATE INDEX "analytics_export_job_status_expiry_idx" ON "analytics_export_job" USING btree ("status", "expires_at");
--> statement-breakpoint
ALTER TABLE "analytics_export_job" ADD CONSTRAINT "analytics_export_job_run_fk" FOREIGN KEY ("report_run_id") REFERENCES "public"."analytics_report_run"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "analytics_export_job" ADD CONSTRAINT "analytics_export_job_requested_by_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- Analytics-owned metadata is operational and may be pruned/rebuilt; no
-- trigger makes it authoritative and no business-domain table is mutated.
