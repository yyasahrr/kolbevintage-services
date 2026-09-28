CREATE TABLE "site_design_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"setting_key" text DEFAULT 'storefront' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "site_design_revision_lookup" ON "site_design_revision" USING btree ("setting_key","status","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "site_design_revision_created" ON "site_design_revision" USING btree ("created_at" DESC NULLS LAST);
