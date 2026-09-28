/* Phase 5.11-C (admin security tranche): suspicious-order flag table + retail note targets. Earlier migrations remain immutable. */

CREATE TABLE "retail_order_suspicious_flag" (
	"id" text PRIMARY KEY NOT NULL,
	"retail_order_id" text NOT NULL,
	"reason" text NOT NULL,
	"flagged_by" text NOT NULL,
	"flagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_by" text,
	"cleared_at" timestamp with time zone,
	"cleared_reason" text,
	CONSTRAINT "retail_order_suspicious_flag_reason_not_empty" CHECK ("reason" <> ''),
	CONSTRAINT "retail_order_suspicious_flag_order_fk" FOREIGN KEY ("retail_order_id") REFERENCES "public"."retail_order"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "retail_order_suspicious_flag_flagged_by_fk" FOREIGN KEY ("flagged_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "retail_order_suspicious_flag_cleared_by_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "retail_order_suspicious_flag_order_unique" ON "retail_order_suspicious_flag" USING btree ("retail_order_id");
--> statement-breakpoint
ALTER TABLE "admin_internal_note" DROP CONSTRAINT IF EXISTS "admin_internal_note_target_type_allowed";
--> statement-breakpoint
ALTER TABLE "admin_internal_note" ADD CONSTRAINT "admin_internal_note_target_type_allowed" CHECK ("target_type" IN ('wholesale_account', 'wholesale_membership', 'wholesale_order', 'wholesale_request', 'supplier', 'retail_order', 'retail_customer'));
