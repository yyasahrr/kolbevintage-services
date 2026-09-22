/* Phase 5.9 Checkpoint A — customer saved addresses + guest capability columns.
 *
 * 1. `customer_address`: first-class saved delivery addresses owned by the
 *    customer-account module. `user_id` is server-derived (FK account_user,
 *    restrict); every field is typed (no JSON authority). Exactly one
 *    ACTIVE default per user via the partial unique index
 *    `customer_address_single_default`; archival is soft (`archived_at`)
 *    so referenced history is never destroyed. Past retail orders keep
 *    their immutable address snapshots — this table never rewrites them.
 * 2. `retail_order`: nullable guest-capability columns. Hash only at rest
 *    (`guest_capability_hash`); `issued_at` proves issuance,
 *    `revoked_at` proves revocation. Legacy guest rows keep NULL (no
 *    fabricated secrets) and resolve to the support recovery path.
 *
 * Additive only: migrations 0000-0036 remain immutable.
 */

CREATE TABLE "customer_address" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "label" text,
  "recipient_name" text NOT NULL,
  "recipient_phone" text NOT NULL,
  "province" text NOT NULL,
  "city" text NOT NULL,
  "address_line" text NOT NULL,
  "plaque" text,
  "unit" text,
  "postal_code" text NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "customer_address_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "customer_address_version_non_negative" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_address_single_default" ON "customer_address" USING btree ("user_id") WHERE ("is_default" AND "archived_at" IS NULL);
--> statement-breakpoint
CREATE INDEX "customer_address_user_created" ON "customer_address" USING btree ("user_id","created_at");
--> statement-breakpoint
ALTER TABLE "retail_order" ADD COLUMN "guest_capability_hash" text;
--> statement-breakpoint
ALTER TABLE "retail_order" ADD COLUMN "guest_capability_issued_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "retail_order" ADD COLUMN "guest_capability_revoked_at" timestamp with time zone;
