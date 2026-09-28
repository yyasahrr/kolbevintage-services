-- Phase 5.1 — CRM & Customer Operations Schema Migration
-- Migration 0025: crm_contact, crm_contact_identity_link, crm_stage_history, crm_assignment_history, crm_tag, crm_contact_tag, crm_activity, crm_task

ALTER TABLE "admin_role_permission" DROP CONSTRAINT IF EXISTS "admin_role_permission_action_allowed";
--> statement-breakpoint
ALTER TABLE "admin_role_permission" ADD CONSTRAINT "admin_role_permission_action_allowed" CHECK ("action" IN ('wholesale:plan:view', 'wholesale:plan:manage', 'wholesale:membership:view', 'wholesale:membership:manage', 'wholesale:membership:override', 'wholesale:approval:view', 'wholesale:approval:create', 'wholesale:approval:decide', 'wholesale:settings:view', 'wholesale:settings:manage', 'wholesale:notes:view', 'wholesale:notes:create', 'wholesale:control_tower:view', 'crm:customer:view', 'crm:customer:manage', 'crm:stage:manage', 'crm:assign:manage', 'crm:activity:create', 'crm:task:manage', 'crm:tag:manage', 'crm:export', 'crm:sensitive:view'));
--> statement-breakpoint
CREATE TABLE "crm_contact" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"city" text,
	"stage" text DEFAULT 'LEAD' NOT NULL,
	"assigned_admin_id" text,
	"assigned_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_contact_stage_allowed" CHECK ("stage" IN ('LEAD', 'CONTACTED', 'NEGOTIATION', 'ACTIVE_CUSTOMER', 'LOYAL', 'CHURNED'))
);
--> statement-breakpoint
CREATE TABLE "crm_contact_identity_link" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"user_id" text NOT NULL,
	"link_type" text DEFAULT 'account_user' NOT NULL,
	"linked_by" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "crm_link_type_allowed" CHECK ("link_type" IN ('account_user', 'wholesale_account'))
);
--> statement-breakpoint
CREATE TABLE "crm_stage_history" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_stage_history_to_stage_allowed" CHECK ("to_stage" IN ('LEAD', 'CONTACTED', 'NEGOTIATION', 'ACTIVE_CUSTOMER', 'LOYAL', 'CHURNED')),
	CONSTRAINT "crm_stage_history_source_allowed" CHECK ("source" IN ('manual', 'system_rule', 'import'))
);
--> statement-breakpoint
CREATE TABLE "crm_assignment_history" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"from_admin_id" text,
	"to_admin_id" text,
	"assigned_by" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"color" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_tag_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "crm_contact_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"activity_type" text NOT NULL,
	"body" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_type" text DEFAULT 'admin' NOT NULL,
	"source" text DEFAULT 'MANUAL_ACTIVITY' NOT NULL,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_activity_type_allowed" CHECK ("activity_type" IN ('NOTE', 'CALL', 'MESSAGE', 'EMAIL', 'MEETING', 'SYSTEM')),
	CONSTRAINT "crm_activity_source_allowed" CHECK ("source" IN ('MANUAL_ACTIVITY', 'SYSTEM_EVENT', 'PROVIDER_EVENT'))
);
--> statement-breakpoint
CREATE TABLE "crm_task" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_id" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"created_by" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_task_status_allowed" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
	CONSTRAINT "crm_task_priority_allowed" CHECK ("priority" IN ('low', 'medium', 'high', 'urgent'))
);
--> statement-breakpoint
ALTER TABLE "crm_contact" ADD CONSTRAINT "crm_contact_assigned_admin_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_contact_identity_link" ADD CONSTRAINT "crm_contact_identity_link_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "crm_contact"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_contact_identity_link" ADD CONSTRAINT "crm_contact_identity_link_user_fk" FOREIGN KEY ("user_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_contact_identity_link" ADD CONSTRAINT "crm_contact_identity_link_linked_by_fk" FOREIGN KEY ("linked_by") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "crm_contact"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "crm_contact"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_from_admin_fk" FOREIGN KEY ("from_admin_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_to_admin_fk" FOREIGN KEY ("to_admin_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_assigned_by_fk" FOREIGN KEY ("assigned_by") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_tag" ADD CONSTRAINT "crm_tag_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_contact_tag" ADD CONSTRAINT "crm_contact_tag_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "crm_contact"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_contact_tag" ADD CONSTRAINT "crm_contact_tag_tag_fk" FOREIGN KEY ("tag_id") REFERENCES "crm_tag"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_contact_tag" ADD CONSTRAINT "crm_contact_tag_assigned_by_fk" FOREIGN KEY ("assigned_by") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "crm_contact"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_task" ADD CONSTRAINT "crm_task_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "crm_contact"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_task" ADD CONSTRAINT "crm_task_assignee_fk" FOREIGN KEY ("assignee_id") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_task" ADD CONSTRAINT "crm_task_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_task" ADD CONSTRAINT "crm_task_completed_by_fk" FOREIGN KEY ("completed_by") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crm_task" ADD CONSTRAINT "crm_task_cancelled_by_fk" FOREIGN KEY ("cancelled_by") REFERENCES "account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "crm_contact_phone_idx" ON "crm_contact" USING btree ("phone");
--> statement-breakpoint
CREATE INDEX "crm_contact_email_idx" ON "crm_contact" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "crm_contact_stage_idx" ON "crm_contact" USING btree ("stage");
--> statement-breakpoint
CREATE INDEX "crm_contact_assigned_admin_idx" ON "crm_contact" USING btree ("assigned_admin_id");
--> statement-breakpoint
CREATE INDEX "crm_contact_created_at_idx" ON "crm_contact" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contact_identity_link_user_unique" ON "crm_contact_identity_link" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "crm_contact_identity_link_contact_idx" ON "crm_contact_identity_link" USING btree ("contact_id");
--> statement-breakpoint
CREATE INDEX "crm_stage_history_contact_idx" ON "crm_stage_history" USING btree ("contact_id","created_at");
--> statement-breakpoint
CREATE INDEX "crm_assignment_history_contact_idx" ON "crm_assignment_history" USING btree ("contact_id","created_at");
--> statement-breakpoint
CREATE INDEX "crm_tag_is_active_idx" ON "crm_tag" USING btree ("is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contact_tag_unique" ON "crm_contact_tag" USING btree ("contact_id","tag_id");
--> statement-breakpoint
CREATE INDEX "crm_activity_contact_occurred_idx" ON "crm_activity" USING btree ("contact_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "crm_task_contact_idx" ON "crm_task" USING btree ("contact_id");
--> statement-breakpoint
CREATE INDEX "crm_task_assignee_status_idx" ON "crm_task" USING btree ("assignee_id","status");
--> statement-breakpoint
CREATE INDEX "crm_task_due_at_idx" ON "crm_task" USING btree ("due_at");
