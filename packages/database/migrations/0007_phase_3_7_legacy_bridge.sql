-- فاز ۳.۷ — پل میراث و مراجع کانونیکال برای آمادگی تراکنش
-- هدف: مسیر مهاجرت از supplier_product/variant به product/product_variant بدون حذف legacy
-- No automatic destructive merge, SKU matching suggests candidates, admin approval required

-- ۱) legacy_product_mapping — نگاشت محصول قدیمی به کانونیکال
CREATE TABLE "legacy_product_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"legacy_supplier_product_id" text NOT NULL,
	"canonical_product_id" text NOT NULL,
	"created_by" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_product_mapping_status_allowed" CHECK ("status" IN ('PENDING', 'MAPPED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "legacy_product_mapping" ADD CONSTRAINT "legacy_product_mapping_legacy_fk" FOREIGN KEY ("legacy_supplier_product_id") REFERENCES "public"."supplier_product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legacy_product_mapping" ADD CONSTRAINT "legacy_product_mapping_canonical_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legacy_product_mapping" ADD CONSTRAINT "legacy_product_mapping_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_product_mapping_legacy_unique" ON "legacy_product_mapping" USING btree ("legacy_supplier_product_id");
--> statement-breakpoint
CREATE INDEX "legacy_product_mapping_canonical" ON "legacy_product_mapping" USING btree ("canonical_product_id");
--> statement-breakpoint
CREATE INDEX "legacy_product_mapping_status" ON "legacy_product_mapping" USING btree ("status");
--> statement-breakpoint
-- ۲) legacy_variant_mapping — نگاشت واریانت قدیمی به کانونیکال
CREATE TABLE "legacy_variant_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"legacy_supplier_variant_id" text NOT NULL,
	"canonical_variant_id" text NOT NULL,
	"created_by" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_variant_mapping_status_allowed" CHECK ("status" IN ('PENDING', 'MAPPED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "legacy_variant_mapping" ADD CONSTRAINT "legacy_variant_mapping_legacy_fk" FOREIGN KEY ("legacy_supplier_variant_id") REFERENCES "public"."supplier_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legacy_variant_mapping" ADD CONSTRAINT "legacy_variant_mapping_canonical_fk" FOREIGN KEY ("canonical_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legacy_variant_mapping" ADD CONSTRAINT "legacy_variant_mapping_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_variant_mapping_legacy_unique" ON "legacy_variant_mapping" USING btree ("legacy_supplier_variant_id");
--> statement-breakpoint
CREATE INDEX "legacy_variant_mapping_canonical" ON "legacy_variant_mapping" USING btree ("canonical_variant_id");
--> statement-breakpoint
CREATE INDEX "legacy_variant_mapping_status" ON "legacy_variant_mapping" USING btree ("status");
--> statement-breakpoint
-- ۳) wholesale_order_item — مراجع کانونیکال برای آینده (nullable, coexist with legacy)
ALTER TABLE "wholesale_order_item" ADD COLUMN "canonical_product_id" text;
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD COLUMN "canonical_variant_id" text;
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD COLUMN "seller_offer_id" text;
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_canonical_product_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_canonical_variant_fk" FOREIGN KEY ("canonical_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_seller_offer_fk" FOREIGN KEY ("seller_offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۴) purchase_order_item — مراجع کانونیکال
ALTER TABLE "purchase_order_item" ADD COLUMN "canonical_product_id" text;
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD COLUMN "canonical_variant_id" text;
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD COLUMN "seller_offer_id" text;
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_canonical_product_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_canonical_variant_fk" FOREIGN KEY ("canonical_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_seller_offer_fk" FOREIGN KEY ("seller_offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۵) rfq — مراجع کانونیکال
ALTER TABLE "rfq" ADD COLUMN "canonical_product_id" text;
--> statement-breakpoint
ALTER TABLE "rfq" ADD COLUMN "seller_offer_id" text;
--> statement-breakpoint
ALTER TABLE "rfq" ADD CONSTRAINT "rfq_canonical_product_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rfq" ADD CONSTRAINT "rfq_seller_offer_fk" FOREIGN KEY ("seller_offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- ۶) quote — مراجع کانونیکال
ALTER TABLE "quote" ADD COLUMN "canonical_product_id" text;
--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "canonical_variant_id" text;
--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "seller_offer_id" text;
--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_canonical_product_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_canonical_variant_fk" FOREIGN KEY ("canonical_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_seller_offer_fk" FOREIGN KEY ("seller_offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
