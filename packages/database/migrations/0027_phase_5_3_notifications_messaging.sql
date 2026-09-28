-- Phase 5.3 — Notifications & Messaging Schema Migration
-- Migration 0027: notification_event, notification_template, notification_template_version, notification_preference, notification_delivery, notification_delivery_attempt, in_app_notification, notification_provider_event, notification_provider_config

ALTER TABLE "admin_role_permission" DROP CONSTRAINT IF EXISTS "admin_role_permission_action_allowed";
--> statement-breakpoint
ALTER TABLE "admin_role_permission" ADD CONSTRAINT "admin_role_permission_action_allowed" CHECK ("action" IN ('wholesale:plan:view', 'wholesale:plan:manage', 'wholesale:membership:view', 'wholesale:membership:manage', 'wholesale:membership:override', 'wholesale:approval:view', 'wholesale:approval:create', 'wholesale:approval:decide', 'wholesale:settings:view', 'wholesale:settings:manage', 'wholesale:notes:view', 'wholesale:notes:create', 'wholesale:control_tower:view', 'crm:customer:view', 'crm:customer:manage', 'crm:stage:manage', 'crm:assign:manage', 'crm:activity:create', 'crm:task:manage', 'crm:tag:manage', 'crm:export', 'crm:sensitive:view', 'support:case:view', 'support:case:reply', 'support:case:assign', 'support:case:priority', 'support:case:resolve', 'support:internal_note:create', 'support:attachment:view', 'support:sla:manage', 'support:report:view', 'support:sensitive:view', 'notification:template:view', 'notification:template:manage', 'notification:outbox:view', 'notification:outbox:retry', 'notification:provider:view', 'notification:preference:manage', 'notification:report:view'));
--> statement-breakpoint
CREATE TABLE "notification_event" (
	"id" text PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"source_domain" text NOT NULL,
	"source_entity_type" text NOT NULL,
	"source_entity_id" text NOT NULL,
	"source_event_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recipient_scope" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_event_key_allowed" CHECK ("event_key" IN ('AUTH_SECURITY_ALERT', 'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_FULFILLMENT_UPDATED', 'SHIPMENT_CREATED', 'SHIPMENT_SHIPPED', 'SHIPMENT_DELIVERED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'VIP_MEMBERSHIP_ACTIVATED', 'VIP_MEMBERSHIP_EXPIRING', 'VIP_MEMBERSHIP_SUSPENDED', 'SUPPLIER_ORDER_CREATED', 'SUPPLIER_ORDER_ACTION_REQUIRED', 'SUPPORT_CASE_CREATED', 'SUPPORT_CASE_REPLIED', 'SUPPORT_CASE_STATUS_CHANGED', 'SETTLEMENT_AVAILABLE', 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_APPROVED', 'PAYOUT_SUBMITTED', 'PAYOUT_RECONCILIATION_REQUIRED', 'COMPLIANCE_ACTION_REQUIRED')),
	CONSTRAINT "notification_event_recipient_scope_allowed" CHECK ("recipient_scope" IN ('ACCOUNT_USER', 'VIP_ACCOUNT_MEMBER', 'SUPPLIER_MEMBER', 'ADMIN_USER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_source_unique_idx" ON "notification_event" USING btree ("source_domain","source_event_id");
--> statement-breakpoint
CREATE INDEX "notification_event_key_idx" ON "notification_event" USING btree ("event_key");
--> statement-breakpoint
CREATE INDEX "notification_event_source_idx" ON "notification_event" USING btree ("source_domain","source_entity_type","source_entity_id");
--> statement-breakpoint
CREATE INDEX "notification_event_occurred_idx" ON "notification_event" USING btree ("occurred_at");
--> statement-breakpoint
CREATE TABLE "notification_template" (
	"id" text PRIMARY KEY NOT NULL,
	"template_key" text NOT NULL,
	"name" text NOT NULL,
	"event_key" text NOT NULL,
	"channel" text NOT NULL,
	"locale" text DEFAULT 'fa-IR' NOT NULL,
	"category" text DEFAULT 'TRANSACTIONAL' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_template_event_key_allowed" CHECK ("event_key" IN ('AUTH_SECURITY_ALERT', 'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_FULFILLMENT_UPDATED', 'SHIPMENT_CREATED', 'SHIPMENT_SHIPPED', 'SHIPMENT_DELIVERED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'VIP_MEMBERSHIP_ACTIVATED', 'VIP_MEMBERSHIP_EXPIRING', 'VIP_MEMBERSHIP_SUSPENDED', 'SUPPLIER_ORDER_CREATED', 'SUPPLIER_ORDER_ACTION_REQUIRED', 'SUPPORT_CASE_CREATED', 'SUPPORT_CASE_REPLIED', 'SUPPORT_CASE_STATUS_CHANGED', 'SETTLEMENT_AVAILABLE', 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_APPROVED', 'PAYOUT_SUBMITTED', 'PAYOUT_RECONCILIATION_REQUIRED', 'COMPLIANCE_ACTION_REQUIRED')),
	CONSTRAINT "notification_template_channel_allowed" CHECK ("channel" IN ('IN_APP', 'EMAIL', 'SMS', 'PUSH')),
	CONSTRAINT "notification_template_category_allowed" CHECK ("category" IN ('TRANSACTIONAL', 'MARKETING', 'OPERATIONAL', 'SECURITY')),
	CONSTRAINT "notification_template_status_allowed" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_template_key_idx" ON "notification_template" USING btree ("template_key");
--> statement-breakpoint
CREATE INDEX "notification_template_event_idx" ON "notification_template" USING btree ("event_key","channel","status");
--> statement-breakpoint
CREATE TABLE "notification_template_version" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"variables_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" text,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_template_version_status_allowed" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED'))
);
--> statement-breakpoint
ALTER TABLE "notification_template_version" ADD CONSTRAINT "notification_template_version_template_fk" FOREIGN KEY ("template_id") REFERENCES "public"."notification_template"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_template_version" ADD CONSTRAINT "notification_template_version_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_template_version" ADD CONSTRAINT "notification_template_version_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_template_version_unique_idx" ON "notification_template_version" USING btree ("template_id","version");
--> statement-breakpoint
CREATE INDEX "notification_template_version_status_idx" ON "notification_template_version" USING btree ("template_id","status");
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" text NOT NULL,
	"category" text NOT NULL,
	"event_key" text DEFAULT '*' NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours_start" text,
	"quiet_hours_end" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_recipient_type_allowed" CHECK ("recipient_type" IN ('ACCOUNT_USER', 'VIP_ACCOUNT_MEMBER', 'SUPPLIER_MEMBER', 'ADMIN_USER')),
	CONSTRAINT "notification_preference_category_allowed" CHECK ("category" IN ('TRANSACTIONAL', 'MARKETING', 'OPERATIONAL', 'SECURITY')),
	CONSTRAINT "notification_preference_channel_allowed" CHECK ("channel" IN ('IN_APP', 'EMAIL', 'SMS', 'PUSH'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_unique_idx" ON "notification_preference" USING btree ("recipient_type","recipient_id","category","event_key","channel");
--> statement-breakpoint
CREATE INDEX "notification_preference_recipient_idx" ON "notification_preference" USING btree ("recipient_type","recipient_id");
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" text NOT NULL,
	"channel" text NOT NULL,
	"template_version_id" text,
	"rendered_subject" text,
	"rendered_body" text NOT NULL,
	"destination_masked" text NOT NULL,
	"destination_hash" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"provider_key" text,
	"provider_message_id" text,
	"idempotency_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"failure_category" text,
	"failure_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_channel_allowed" CHECK ("channel" IN ('IN_APP', 'EMAIL', 'SMS', 'PUSH')),
	CONSTRAINT "notification_delivery_recipient_type_allowed" CHECK ("recipient_type" IN ('ACCOUNT_USER', 'VIP_ACCOUNT_MEMBER', 'SUPPLIER_MEMBER', 'ADMIN_USER')),
	CONSTRAINT "notification_delivery_status_allowed" CHECK ("status" IN ('PENDING', 'QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'SUPPRESSED', 'CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_event_fk" FOREIGN KEY ("event_id") REFERENCES "public"."notification_event"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_template_version_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."notification_template_version"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_idempotency_idx" ON "notification_delivery" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "notification_delivery_event_idx" ON "notification_delivery" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX "notification_delivery_recipient_idx" ON "notification_delivery" USING btree ("recipient_type","recipient_id");
--> statement-breakpoint
CREATE INDEX "notification_delivery_status_idx" ON "notification_delivery" USING btree ("status","scheduled_at");
--> statement-breakpoint
CREATE INDEX "notification_delivery_retry_idx" ON "notification_delivery" USING btree ("status","next_retry_at");
--> statement-breakpoint
CREATE TABLE "notification_delivery_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider_key" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"external_message_id" text,
	"error_category" text,
	"error_detail" text,
	"retry_after_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_attempt_status_allowed" CHECK ("status" IN ('SUCCESS', 'RETRYABLE_ERROR', 'PERMANENT_ERROR'))
);
--> statement-breakpoint
ALTER TABLE "notification_delivery_attempt" ADD CONSTRAINT "notification_delivery_attempt_delivery_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_delivery"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_attempt_unique_idx" ON "notification_delivery_attempt" USING btree ("delivery_id","attempt_number");
--> statement-breakpoint
CREATE INDEX "notification_delivery_attempt_delivery_idx" ON "notification_delivery_attempt" USING btree ("delivery_id");
--> statement-breakpoint
CREATE INDEX "notification_delivery_attempt_provider_idx" ON "notification_delivery_attempt" USING btree ("provider_key","started_at");
--> statement-breakpoint
CREATE TABLE "in_app_notification" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" text NOT NULL,
	"delivery_id" text,
	"event_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"related_entity_type" text,
	"related_entity_id" text,
	"action_url" text,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "in_app_notification_recipient_type_allowed" CHECK ("recipient_type" IN ('ACCOUNT_USER', 'VIP_ACCOUNT_MEMBER', 'SUPPLIER_MEMBER', 'ADMIN_USER'))
);
--> statement-breakpoint
ALTER TABLE "in_app_notification" ADD CONSTRAINT "in_app_notification_delivery_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_delivery"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "in_app_notification" ADD CONSTRAINT "in_app_notification_event_fk" FOREIGN KEY ("event_id") REFERENCES "public"."notification_event"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "in_app_notification_recipient_idx" ON "in_app_notification" USING btree ("recipient_type","recipient_id","read_at");
--> statement-breakpoint
CREATE INDEX "in_app_notification_created_idx" ON "in_app_notification" USING btree ("created_at");
--> statement-breakpoint
CREATE TABLE "notification_provider_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_key" text NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"processing_status" text DEFAULT 'RECEIVED' NOT NULL,
	"delivery_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_provider_event_status_allowed" CHECK ("processing_status" IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "notification_provider_event" ADD CONSTRAINT "notification_provider_event_delivery_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_delivery"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_provider_event_unique_idx" ON "notification_provider_event" USING btree ("provider_key","external_event_id");
--> statement-breakpoint
CREATE INDEX "notification_provider_event_status_idx" ON "notification_provider_event" USING btree ("provider_key","processing_status");
--> statement-breakpoint
CREATE INDEX "notification_provider_event_delivery_idx" ON "notification_provider_event" USING btree ("delivery_id");
--> statement-breakpoint
CREATE TABLE "notification_provider_config" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_key" text NOT NULL,
	"channel" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'DISABLED' NOT NULL,
	"sender_identity" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"public_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_provider_config_channel_allowed" CHECK ("channel" IN ('IN_APP', 'EMAIL', 'SMS', 'PUSH')),
	CONSTRAINT "notification_provider_config_status_allowed" CHECK ("status" IN ('DISABLED', 'MISSING_CONFIGURATION', 'SANDBOX', 'CONFIGURED', 'PRODUCTION'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_provider_config_key_idx" ON "notification_provider_config" USING btree ("provider_key");
--> statement-breakpoint
CREATE INDEX "notification_provider_config_channel_idx" ON "notification_provider_config" USING btree ("channel","status","is_default");
