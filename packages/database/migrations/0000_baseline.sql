CREATE TABLE "account_user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"salt" text NOT NULL,
	"role" text DEFAULT 'customer' NOT NULL,
	"display_name" text,
	"phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_role" text,
	"actor_ip" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" text PRIMARY KEY NOT NULL,
	"order_code" text NOT NULL,
	"supplier_id" text NOT NULL,
	"wholesale_order_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_date" timestamp with time zone,
	"tracking_code" text,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"notes" text,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_order_code_unique" UNIQUE("order_code")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"product_name" text NOT NULL,
	"sku" text,
	"variant_id" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote" (
	"id" text PRIMARY KEY NOT NULL,
	"rfq_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"lead_time_days" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_order" (
	"id" text PRIMARY KEY NOT NULL,
	"order_code" text NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shipping_method" text DEFAULT 'post' NOT NULL,
	"shipping_price" bigint DEFAULT 0 NOT NULL,
	"pay_method" text DEFAULT 'gateway' NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"payment_status" text DEFAULT 'pending_gateway' NOT NULL,
	"fulfillment_status" text DEFAULT 'processing' NOT NULL,
	"items_total" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"price_book_version" text,
	"payment_method" text,
	"amount_source" text DEFAULT 'server' NOT NULL,
	"customer_id" text,
	"order_status" text DEFAULT 'placed' NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retail_order_order_code_unique" UNIQUE("order_code")
);
--> statement-breakpoint
CREATE TABLE "retail_order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"sku" text NOT NULL,
	"product_name" text NOT NULL,
	"colour" text,
	"size" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"line_total" bigint DEFAULT 0 NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"reference_code" text NOT NULL,
	"title" text NOT NULL,
	"customer_name" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"requested_delivery_date" timestamp with time zone,
	"specifications" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfq_reference_code_unique" UNIQUE("reference_code")
);
--> statement-breakpoint
CREATE TABLE "site_setting" (
	"setting_key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" text PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"city" text,
	"phone" text,
	"category" text,
	"monthly_capacity" integer,
	"capabilities" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_application" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"company_name" text NOT NULL,
	"representative_name" text NOT NULL,
	"phone" text NOT NULL,
	"category" text NOT NULL,
	"monthly_capacity" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_inventory_variant_id_unique" UNIQUE("variant_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_member" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'عضو تیم' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_member_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_product" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"wholesale_price" bigint DEFAULT 0 NOT NULL,
	"image_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_product_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "supplier_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"sku" text NOT NULL,
	"color" text DEFAULT 'بدون رنگ' NOT NULL,
	"color_hex" text,
	"size" text DEFAULT 'تک‌سایز' NOT NULL,
	"cost" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_variant_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "support_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text,
	"subject" text NOT NULL,
	"category" text DEFAULT 'عمومی' NOT NULL,
	"message" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"admin_reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_log" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text DEFAULT 'error' NOT NULL,
	"source" text DEFAULT 'system' NOT NULL,
	"event_type" text DEFAULT 'application.error' NOT NULL,
	"message" text NOT NULL,
	"error_name" text,
	"stack" text,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"http_method" text,
	"path" text,
	"http_status" integer,
	"duration_ms" integer,
	"request_id" text,
	"actor_id" text,
	"actor_role" text,
	"ip" text,
	"user_agent" text,
	"environment" text DEFAULT 'development' NOT NULL,
	"release" text,
	"metadata" jsonb,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wholesale_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"member_name" text NOT NULL,
	"store_name" text NOT NULL,
	"phone" text NOT NULL,
	"city" text NOT NULL,
	"plan_name" text DEFAULT 'وی‌آی‌پی' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"activated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wholesale_order" (
	"id" text PRIMARY KEY NOT NULL,
	"order_code" text NOT NULL,
	"account_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"total_units" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_order_order_code_unique" UNIQUE("order_code")
);
--> statement-breakpoint
CREATE TABLE "wholesale_order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"product_name" text NOT NULL,
	"sku" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_entity" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "retail_order_idempotency" ON "retail_order" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "retail_order_item_order" ON "retail_order_item" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wholesale_order_idempotency" ON "wholesale_order" USING btree ("idempotency_key");