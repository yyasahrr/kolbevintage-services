-- فاز ۳ — بازار عمده و کاتالوگ: معماری محصول کانونیکال و پیشنهاد فروشنده
-- این مهاجرت جداول تازهٔ بازار را می‌سازد:
--   brand, category, product, product_media, product_variant, product_variant_media,
--   seller, seller_offer, offer_media, wholesale_package, wholesale_package_item,
--   wholesale_pricing_tier, product_match_queue, supplier_permission_config,
--   vip_plan, vip_subscription, wholesale_request, product_rating, supplier_rating,
--   transaction_rating
-- و ستون role به supplier_member اضافه می‌کند.

-- ۱) brand
CREATE TABLE "brand" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"creator_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_slug_unique" UNIQUE("slug"),
	CONSTRAINT "brand_verification_status_allowed" CHECK ("verification_status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "brand_status_allowed" CHECK ("status" IN ('active', 'suspended', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_creator_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۲) category
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"attributes_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_slug_unique" UNIQUE("slug"),
	CONSTRAINT "category_status_allowed" CHECK ("status" IN ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۳) product (canonical)
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"brand_id" text,
	"category_id" text,
	"owner_type" text DEFAULT 'KOLBE' NOT NULL,
	"is_kolbe_exclusive" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"search_rank" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_slug_unique" UNIQUE("slug"),
	CONSTRAINT "product_sku_unique" UNIQUE("sku"),
	CONSTRAINT "product_owner_type_allowed" CHECK ("owner_type" IN ('KOLBE', 'SUPPLIER')),
	CONSTRAINT "product_status_allowed" CHECK ("status" IN ('draft', 'pending_review', 'approved', 'published', 'suspended', 'archived')),
	CONSTRAINT "product_sales_count_non_negative" CHECK ("sales_count" >= 0),
	CONSTRAINT "product_view_count_non_negative" CHECK ("view_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_brand_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۴) product_media
CREATE TABLE "product_media" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"url" text NOT NULL,
	"type" text DEFAULT 'image' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "product_media_product_position" ON "product_media" USING btree ("product_id","position");
--> statement-breakpoint
-- ۵) product_variant
CREATE TABLE "product_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"sku" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variant_sku_unique" UNIQUE("sku"),
	CONSTRAINT "product_variant_status_allowed" CHECK ("status" IN ('draft', 'active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "product_variant_product" ON "product_variant" USING btree ("product_id");
--> statement-breakpoint
-- ۶) product_variant_media
CREATE TABLE "product_variant_media" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"url" text NOT NULL,
	"type" text DEFAULT 'image' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_variant_media" ADD CONSTRAINT "product_variant_media_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۷) seller (generic)
CREATE TABLE "seller" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"supplier_id" text,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_type_allowed" CHECK ("type" IN ('KOLBE', 'SUPPLIER')),
	CONSTRAINT "seller_status_allowed" CHECK ("status" IN ('active', 'suspended', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "seller" ADD CONSTRAINT "seller_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "seller_supplier_unique" ON "seller" USING btree ("supplier_id");
--> statement-breakpoint
-- ۸) seller_offer
CREATE TABLE "seller_offer" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"variant_id" text,
	"sku" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"wholesale_price" bigint DEFAULT '0' NOT NULL,
	"retail_price" bigint,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"moq" integer DEFAULT 1 NOT NULL,
	"moq_unit" text DEFAULT 'PIECE' NOT NULL,
	"package_type" text,
	"inventory_on_hand" integer DEFAULT 0 NOT NULL,
	"inventory_reserved" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_offer_sku_unique" UNIQUE("sku"),
	CONSTRAINT "seller_offer_status_allowed" CHECK ("status" IN ('draft', 'pending_review', 'approved', 'published', 'suspended', 'archived')),
	CONSTRAINT "seller_offer_moq_unit_allowed" CHECK ("moq_unit" IN ('PIECE', 'PACKAGE', 'SERIES', 'BOX', 'CARTON', 'SET')),
	CONSTRAINT "seller_offer_wholesale_price_range" CHECK ("wholesale_price" >= 0 AND "wholesale_price" <= 1000000000000000),
	CONSTRAINT "seller_offer_moq_non_negative" CHECK ("moq" >= 0),
	CONSTRAINT "seller_offer_on_hand_non_negative" CHECK ("inventory_on_hand" >= 0),
	CONSTRAINT "seller_offer_reserved_non_negative" CHECK ("inventory_reserved" >= 0),
	CONSTRAINT "seller_offer_reserved_within_on_hand" CHECK ("inventory_reserved" <= "inventory_on_hand"),
	CONSTRAINT "seller_offer_currency_allowed" CHECK ("currency" IN ('IRR'))
);
--> statement-breakpoint
ALTER TABLE "seller_offer" ADD CONSTRAINT "seller_offer_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "seller_offer" ADD CONSTRAINT "seller_offer_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "seller_offer" ADD CONSTRAINT "seller_offer_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "seller_offer_product_seller" ON "seller_offer" USING btree ("product_id","seller_id");
--> statement-breakpoint
-- ۹) offer_media
CREATE TABLE "offer_media" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"url" text NOT NULL,
	"type" text DEFAULT 'image' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offer_media" ADD CONSTRAINT "offer_media_offer_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۱۰) wholesale_package
CREATE TABLE "wholesale_package" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"package_type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"total_pieces" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_package_type_allowed" CHECK ("package_type" IN ('SIZE_RUN', 'FIXED_QUANTITY', 'COLOR_MIX', 'CUSTOM_BUNDLE')),
	CONSTRAINT "wholesale_package_total_pieces_non_negative" CHECK ("total_pieces" >= 0)
);
--> statement-breakpoint
ALTER TABLE "wholesale_package" ADD CONSTRAINT "wholesale_package_offer_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۱۱) wholesale_package_item
CREATE TABLE "wholesale_package_item" (
	"id" text PRIMARY KEY NOT NULL,
	"package_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_package_item_quantity_non_negative" CHECK ("quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "wholesale_package_item" ADD CONSTRAINT "wholesale_package_item_package_fk" FOREIGN KEY ("package_id") REFERENCES "public"."wholesale_package"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_package_item" ADD CONSTRAINT "wholesale_package_item_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۱۲) wholesale_pricing_tier
CREATE TABLE "wholesale_pricing_tier" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"min_quantity" integer NOT NULL,
	"max_quantity" integer,
	"unit_price" bigint NOT NULL,
	"currency" text DEFAULT 'IRR' NOT NULL,
	"moq_unit" text DEFAULT 'PACKAGE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_pricing_tier_min_quantity_non_negative" CHECK ("min_quantity" >= 0),
	CONSTRAINT "wholesale_pricing_tier_unit_price_range" CHECK ("unit_price" >= 0 AND "unit_price" <= 1000000000000000),
	CONSTRAINT "wholesale_pricing_tier_moq_unit_allowed" CHECK ("moq_unit" IN ('PIECE', 'PACKAGE', 'SERIES', 'BOX', 'CARTON', 'SET')),
	CONSTRAINT "wholesale_pricing_tier_currency_allowed" CHECK ("currency" IN ('IRR'))
);
--> statement-breakpoint
ALTER TABLE "wholesale_pricing_tier" ADD CONSTRAINT "wholesale_pricing_tier_offer_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "wholesale_pricing_tier_offer_min" ON "wholesale_pricing_tier" USING btree ("offer_id","min_quantity");
--> statement-breakpoint
-- ۱۳) product_match_queue
CREATE TABLE "product_match_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_product_id" text,
	"candidate_product_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_match_queue_status_allowed" CHECK ("status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "product_match_queue" ADD CONSTRAINT "product_match_queue_supplier_product_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."supplier_product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_match_queue" ADD CONSTRAINT "product_match_queue_candidate_product_fk" FOREIGN KEY ("candidate_product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_match_queue" ADD CONSTRAINT "product_match_queue_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۱۴) supplier_permission_config
CREATE TABLE "supplier_permission_config" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_permission_config_action_unique" UNIQUE("action"),
	CONSTRAINT "supplier_permission_action_allowed" CHECK ("action" IN ('create_product', 'change_images', 'change_description', 'add_variant', 'change_category', 'change_price'))
);
--> statement-breakpoint
-- ۱۵) vip_plan
CREATE TABLE "vip_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"price" bigint DEFAULT '0' NOT NULL,
	"duration_days" integer DEFAULT 365 NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vip_plan_slug_unique" UNIQUE("slug"),
	CONSTRAINT "vip_plan_status_allowed" CHECK ("status" IN ('active', 'archived')),
	CONSTRAINT "vip_plan_price_range" CHECK ("price" >= 0 AND "price" <= 1000000000000000),
	CONSTRAINT "vip_plan_duration_days_non_negative" CHECK ("duration_days" >= 0)
);
--> statement-breakpoint
-- ۱۶) vip_subscription
CREATE TABLE "vip_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vip_subscription_status_allowed" CHECK ("status" IN ('pending', 'active', 'expired', 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "vip_subscription" ADD CONSTRAINT "vip_subscription_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vip_subscription" ADD CONSTRAINT "vip_subscription_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."vip_plan"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "vip_subscription_user_status" ON "vip_subscription" USING btree ("user_id","status");
--> statement-breakpoint
-- ۱۷) wholesale_request
CREATE TABLE "wholesale_request" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"vip_account_id" text NOT NULL,
	"package_id" text,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_request_status_allowed" CHECK ("status" IN ('pending', 'supplier_review', 'accepted', 'rejected', 'ordered')),
	CONSTRAINT "wholesale_request_quantity_non_negative" CHECK ("quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "wholesale_request" ADD CONSTRAINT "wholesale_request_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_request" ADD CONSTRAINT "wholesale_request_offer_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_request" ADD CONSTRAINT "wholesale_request_vip_account_fk" FOREIGN KEY ("vip_account_id") REFERENCES "public"."wholesale_account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_request" ADD CONSTRAINT "wholesale_request_package_fk" FOREIGN KEY ("package_id") REFERENCES "public"."wholesale_package"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۱۸) product_rating
CREATE TABLE "product_rating" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"rater_id" text NOT NULL,
	"rating" integer NOT NULL,
	"review" text,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_rating_status_allowed" CHECK ("status" IN ('visible', 'hidden', 'flagged')),
	CONSTRAINT "product_rating_rating_range" CHECK ("rating" >= 0),
	CONSTRAINT "product_rating_rating_1_5" CHECK ("rating" >= 1 AND "rating" <= 5)
);
--> statement-breakpoint
ALTER TABLE "product_rating" ADD CONSTRAINT "product_rating_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_rating" ADD CONSTRAINT "product_rating_rater_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۱۹) supplier_rating
CREATE TABLE "supplier_rating" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"rater_id" text NOT NULL,
	"rating" integer NOT NULL,
	"review" text,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_rating_status_allowed" CHECK ("status" IN ('visible', 'hidden', 'flagged')),
	CONSTRAINT "supplier_rating_rating_1_5" CHECK ("rating" >= 1 AND "rating" <= 5)
);
--> statement-breakpoint
ALTER TABLE "supplier_rating" ADD CONSTRAINT "supplier_rating_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_rating" ADD CONSTRAINT "supplier_rating_rater_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۲۰) transaction_rating
CREATE TABLE "transaction_rating" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_type" text DEFAULT 'wholesale' NOT NULL,
	"rating" integer NOT NULL,
	"rater_id" text NOT NULL,
	"review" text,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_rating_status_allowed" CHECK ("status" IN ('visible', 'hidden', 'flagged')),
	CONSTRAINT "transaction_rating_rating_1_5" CHECK ("rating" >= 1 AND "rating" <= 5)
);
--> statement-breakpoint
ALTER TABLE "transaction_rating" ADD CONSTRAINT "transaction_rating_rater_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۲۱) supplier_member role column
ALTER TABLE "supplier_member" ADD COLUMN "role" text DEFAULT 'owner' NOT NULL;
--> statement-breakpoint
ALTER TABLE "supplier_member" ADD CONSTRAINT "supplier_member_role_allowed" CHECK ("role" IN ('owner', 'sales', 'warehouse', 'finance'));
--> statement-breakpoint
-- ۲۲) KOLBE seller seed (idempotent)
INSERT INTO "seller" (id, type, display_name, status) VALUES ('seller_kolbe', 'KOLBE', 'Kolbe Vintage', 'active') ON CONFLICT (id) DO NOTHING;
