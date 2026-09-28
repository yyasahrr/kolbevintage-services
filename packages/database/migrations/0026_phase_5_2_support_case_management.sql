-- Phase 5.2 — Support / Ticket / Case Management Schema Migration
-- Migration 0026: support_case, support_case_status_history, support_case_priority_history, support_case_assignment_history, support_case_relation, support_message, support_internal_note, support_attachment, support_sla_policy, support_case_sla, support_case_escalation_history, support_case_action

ALTER TABLE "admin_role_permission" DROP CONSTRAINT IF EXISTS "admin_role_permission_action_allowed";
--> statement-breakpoint
ALTER TABLE "admin_role_permission" ADD CONSTRAINT "admin_role_permission_action_allowed" CHECK ("action" IN ('wholesale:plan:view', 'wholesale:plan:manage', 'wholesale:membership:view', 'wholesale:membership:manage', 'wholesale:membership:override', 'wholesale:approval:view', 'wholesale:approval:create', 'wholesale:approval:decide', 'wholesale:settings:view', 'wholesale:settings:manage', 'wholesale:notes:view', 'wholesale:notes:create', 'wholesale:control_tower:view', 'crm:customer:view', 'crm:customer:manage', 'crm:stage:manage', 'crm:assign:manage', 'crm:activity:create', 'crm:task:manage', 'crm:tag:manage', 'crm:export', 'crm:sensitive:view', 'support:case:view', 'support:case:reply', 'support:case:assign', 'support:case:priority', 'support:case:resolve', 'support:internal_note:create', 'support:attachment:view', 'support:sla:manage', 'support:report:view', 'support:sensitive:view'));
--> statement-breakpoint
CREATE TABLE "support_case" (
	"id" text PRIMARY KEY NOT NULL,
	"public_reference" text NOT NULL,
	"requester_type" text NOT NULL,
	"requester_user_id" text,
	"wholesale_account_id" text,
	"supplier_id" text,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"source" text DEFAULT 'PORTAL' NOT NULL,
	"assigned_admin_id" text,
	"assigned_team_key" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_case_public_reference_unique" UNIQUE("public_reference"),
	CONSTRAINT "support_case_requester_type_allowed" CHECK ("requester_type" IN ('RETAIL_CUSTOMER', 'VIP_BUYER', 'SUPPLIER', 'ADMIN_CREATED')),
	CONSTRAINT "support_case_category_allowed" CHECK ("category" IN ('ORDER', 'PAYMENT', 'SHIPPING', 'RETURN', 'REFUND', 'MEMBERSHIP', 'WHOLESALE', 'SUPPLIER', 'PRODUCT', 'QUALITY', 'CUSTOM_PRODUCTION', 'FINANCE', 'SETTLEMENT', 'ACCOUNT', 'OTHER')),
	CONSTRAINT "support_case_priority_allowed" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
	CONSTRAINT "support_case_status_allowed" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_INTERNAL', 'RESOLVED', 'CLOSED')),
	CONSTRAINT "support_case_source_allowed" CHECK ("source" IN ('PORTAL', 'VIP_PORTAL', 'SUPPLIER_PORTAL', 'ADMIN_MANUAL', 'EMAIL', 'API'))
);
--> statement-breakpoint
CREATE TABLE "support_case_status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"reason" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_case_status_history_from_allowed" CHECK ("from_status" IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_INTERNAL', 'RESOLVED', 'CLOSED')),
	CONSTRAINT "support_case_status_history_to_allowed" CHECK ("to_status" IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_INTERNAL', 'RESOLVED', 'CLOSED')),
	CONSTRAINT "support_case_status_history_actor_allowed" CHECK ("actor_type" IN ('CUSTOMER', 'VIP_BUYER', 'SUPPLIER', 'ADMIN', 'SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "support_case_priority_history" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"from_priority" text NOT NULL,
	"to_priority" text NOT NULL,
	"changed_by_admin_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_case_priority_history_from_allowed" CHECK ("from_priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
	CONSTRAINT "support_case_priority_history_to_allowed" CHECK ("to_priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'))
);
--> statement-breakpoint
CREATE TABLE "support_case_assignment_history" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"from_admin_id" text,
	"to_admin_id" text,
	"from_team_key" text,
	"to_team_key" text,
	"assigned_by_admin_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_case_relation" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"relation_type" text NOT NULL,
	"target_id" text NOT NULL,
	"item_id" text,
	"quantity" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_case_relation_type_allowed" CHECK ("relation_type" IN ('ORDER', 'ORDER_ITEM', 'SHIPMENT', 'PAYMENT', 'REFUND', 'WHOLESALE_REQUEST', 'PURCHASE_ORDER', 'SUPPLIER', 'VIP_ACCOUNT', 'CRM_CONTACT', 'SETTLEMENT_WITHDRAWAL', 'PAYOUT'))
);
--> statement-breakpoint
CREATE TABLE "support_message" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"author_type" text NOT NULL,
	"author_id" text,
	"author_display_name" text NOT NULL,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_message_author_type_allowed" CHECK ("author_type" IN ('CUSTOMER', 'VIP_BUYER', 'SUPPLIER', 'ADMIN', 'SYSTEM')),
	CONSTRAINT "support_message_visibility_allowed" CHECK ("visibility" IN ('PUBLIC', 'INTERNAL'))
);
--> statement-breakpoint
CREATE TABLE "support_internal_note" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"author_admin_id" text NOT NULL,
	"author_display_name" text NOT NULL,
	"body" text NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"message_id" text,
	"uploader_type" text NOT NULL,
	"uploader_id" text,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"scan_status" text DEFAULT 'PENDING_SCAN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_attachment_uploader_type_allowed" CHECK ("uploader_type" IN ('CUSTOMER', 'VIP_BUYER', 'SUPPLIER', 'ADMIN', 'SYSTEM')),
	CONSTRAINT "support_attachment_visibility_allowed" CHECK ("visibility" IN ('PUBLIC', 'INTERNAL')),
	CONSTRAINT "support_attachment_scan_status_allowed" CHECK ("scan_status" IN ('PENDING_SCAN', 'CLEAN', 'SUSPICIOUS', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "support_sla_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"policy_code" text NOT NULL,
	"name" text NOT NULL,
	"requester_type" text,
	"category" text,
	"priority" text NOT NULL,
	"first_response_target_minutes" integer NOT NULL,
	"resolution_target_minutes" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_sla_priority_allowed" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'))
);
--> statement-breakpoint
CREATE TABLE "support_case_sla" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"policy_id" text,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"first_response_target_minutes" integer NOT NULL,
	"resolution_target_minutes" integer NOT NULL,
	"first_response_due_at" timestamp with time zone NOT NULL,
	"resolution_due_at" timestamp with time zone NOT NULL,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_case_sla_case_id_unique" UNIQUE("case_id")
);
--> statement-breakpoint
CREATE TABLE "support_case_escalation_history" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"from_priority" text NOT NULL,
	"to_priority" text NOT NULL,
	"from_team_key" text,
	"to_team_key" text,
	"actor_admin_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_escalation_source_allowed" CHECK ("source" IN ('MANUAL_ADMIN', 'SLA_BREACH', 'SYSTEM_RULE')),
	CONSTRAINT "support_escalation_from_priority_allowed" CHECK ("from_priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
	CONSTRAINT "support_escalation_to_priority_allowed" CHECK ("to_priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'))
);
--> statement-breakpoint
CREATE TABLE "support_case_action" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"action_type" text NOT NULL,
	"target_domain" text NOT NULL,
	"target_id" text NOT NULL,
	"requested_by_admin_id" text NOT NULL,
	"resulting_reference" text,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "support_action_type_allowed" CHECK ("action_type" IN ('REFUND_REQUEST', 'SHIPMENT_INVESTIGATION', 'PAYMENT_RECONCILIATION', 'COMPLIANCE_ESCALATION', 'SUPPLIER_FINANCE_INVESTIGATION')),
	CONSTRAINT "support_action_status_allowed" CHECK ("status" IN ('REQUESTED', 'IN_REVIEW', 'EXECUTED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_requester_user_fk" FOREIGN KEY ("requester_user_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_wholesale_account_fk" FOREIGN KEY ("wholesale_account_id") REFERENCES "wholesale_account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_assigned_admin_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_status_history" ADD CONSTRAINT "support_case_status_history_case_fk" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_status_history" ADD CONSTRAINT "support_case_status_history_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_priority_history" ADD CONSTRAINT "support_case_priority_history_case_fk" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_priority_history" ADD CONSTRAINT "support_case_priority_history_admin_fk" FOREIGN KEY ("changed_by_admin_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_assignment_history" ADD CONSTRAINT "support_case_assign_case_fk" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_assignment_history" ADD CONSTRAINT "support_case_assign_from_admin_fk" FOREIGN KEY ("from_admin_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_assignment_history" ADD CONSTRAINT "support_case_assign_to_admin_fk" FOREIGN KEY ("to_admin_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_assignment_history" ADD CONSTRAINT "support_case_assign_by_admin_fk" FOREIGN KEY ("assigned_by_admin_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_relation" ADD CONSTRAINT "support_case_relation_case_fk" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_case_fk" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_author_fk" FOREIGN KEY ("author_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_internal_note" ADD CONSTRAINT "support_internal_note_case_fk" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_internal_note" ADD CONSTRAINT "support_internal_note_author_fk" FOREIGN KEY ("author_admin_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_attachment" ADD CONSTRAINT "support_attachment_case_fk" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_attachment" ADD CONSTRAINT "support_attachment_message_fk" FOREIGN KEY ("message_id") REFERENCES "support_message"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_attachment" ADD CONSTRAINT "support_attachment_uploader_fk" FOREIGN KEY ("uploader_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_sla" ADD CONSTRAINT "support_case_sla_case_fk" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_sla" ADD CONSTRAINT "support_case_sla_policy_fk" FOREIGN KEY ("policy_id") REFERENCES "support_sla_policy"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_escalation_history" ADD CONSTRAINT "support_case_escalation_case_fk" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_escalation_history" ADD CONSTRAINT "support_case_escalation_admin_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_action" ADD CONSTRAINT "support_case_action_case_fk" FOREIGN KEY ("case_id") REFERENCES "support_case"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_action" ADD CONSTRAINT "support_case_action_admin_fk" FOREIGN KEY ("requested_by_admin_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "support_case_status_idx" ON "support_case" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "support_case_category_idx" ON "support_case" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "support_case_priority_idx" ON "support_case" USING btree ("priority");
--> statement-breakpoint
CREATE INDEX "support_case_requester_type_idx" ON "support_case" USING btree ("requester_type");
--> statement-breakpoint
CREATE INDEX "support_case_assigned_admin_idx" ON "support_case" USING btree ("assigned_admin_id");
--> statement-breakpoint
CREATE INDEX "support_case_wholesale_account_idx" ON "support_case" USING btree ("wholesale_account_id");
--> statement-breakpoint
CREATE INDEX "support_case_supplier_idx" ON "support_case" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX "support_case_created_at_idx" ON "support_case" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "support_case_status_history_case_idx" ON "support_case_status_history" USING btree ("case_id","created_at");
--> statement-breakpoint
CREATE INDEX "support_case_priority_history_case_idx" ON "support_case_priority_history" USING btree ("case_id","created_at");
--> statement-breakpoint
CREATE INDEX "support_case_assign_case_idx" ON "support_case_assignment_history" USING btree ("case_id","created_at");
--> statement-breakpoint
CREATE INDEX "support_case_relation_target_idx" ON "support_case_relation" USING btree ("relation_type","target_id");
--> statement-breakpoint
CREATE INDEX "support_case_relation_case_idx" ON "support_case_relation" USING btree ("case_id");
--> statement-breakpoint
CREATE INDEX "support_message_case_idx" ON "support_message" USING btree ("case_id","created_at");
--> statement-breakpoint
CREATE INDEX "support_message_idempotency_idx" ON "support_message" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "support_internal_note_case_idx" ON "support_internal_note" USING btree ("case_id","created_at");
--> statement-breakpoint
CREATE INDEX "support_attachment_case_idx" ON "support_attachment" USING btree ("case_id");
--> statement-breakpoint
CREATE INDEX "support_sla_policy_code_version_idx" ON "support_sla_policy" USING btree ("policy_code","version");
--> statement-breakpoint
CREATE INDEX "support_case_sla_first_response_due_idx" ON "support_case_sla" USING btree ("first_response_due_at");
--> statement-breakpoint
CREATE INDEX "support_case_sla_resolution_due_idx" ON "support_case_sla" USING btree ("resolution_due_at");
--> statement-breakpoint
CREATE INDEX "support_case_escalation_case_idx" ON "support_case_escalation_history" USING btree ("case_id","created_at");
--> statement-breakpoint
CREATE INDEX "support_case_action_case_idx" ON "support_case_action" USING btree ("case_id");
--> statement-breakpoint
CREATE INDEX "support_case_action_target_idx" ON "support_case_action" USING btree ("target_domain","target_id");
