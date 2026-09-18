-- فاز ۳.۸ — حذف دامنه‌های قدیمی و معماری تمیز
-- No production data, clean architecture over compatibility

-- ۱) حذف FK های قدیمی که به legacy اشاره می‌کنند (اگر وجود دارند)
ALTER TABLE "wholesale_order_item" DROP CONSTRAINT IF EXISTS "wholesale_order_item_product_fk";
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" DROP CONSTRAINT IF EXISTS "wholesale_order_item_variant_fk";
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" DROP CONSTRAINT IF EXISTS "wholesale_order_item_canonical_product_fk";
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" DROP CONSTRAINT IF EXISTS "wholesale_order_item_canonical_variant_fk";
--> statement-breakpoint
ALTER TABLE "purchase_order_item" DROP CONSTRAINT IF EXISTS "purchase_order_item_variant_fk";
--> statement-breakpoint
ALTER TABLE "purchase_order_item" DROP CONSTRAINT IF EXISTS "purchase_order_item_canonical_product_fk";
--> statement-breakpoint
ALTER TABLE "purchase_order_item" DROP CONSTRAINT IF EXISTS "purchase_order_item_canonical_variant_fk";
--> statement-breakpoint
ALTER TABLE "rfq" DROP CONSTRAINT IF EXISTS "rfq_canonical_product_fk";
--> statement-breakpoint
ALTER TABLE "quote" DROP CONSTRAINT IF EXISTS "quote_canonical_product_fk";
--> statement-breakpoint
ALTER TABLE "quote" DROP CONSTRAINT IF EXISTS "quote_canonical_variant_fk";
--> statement-breakpoint
ALTER TABLE "product_match_queue" DROP CONSTRAINT IF EXISTS "product_match_queue_supplier_product_fk";
--> statement-breakpoint
ALTER TABLE "product_match_queue" DROP CONSTRAINT IF EXISTS "product_match_queue_candidate_product_fk";
--> statement-breakpoint
ALTER TABLE "product_match_queue" DROP CONSTRAINT IF EXISTS "product_match_queue_created_by_fk";
--> statement-breakpoint
ALTER TABLE "legacy_product_mapping" DROP CONSTRAINT IF EXISTS "legacy_product_mapping_legacy_fk";
--> statement-breakpoint
ALTER TABLE "legacy_product_mapping" DROP CONSTRAINT IF EXISTS "legacy_product_mapping_canonical_fk";
--> statement-breakpoint
ALTER TABLE "legacy_product_mapping" DROP CONSTRAINT IF EXISTS "legacy_product_mapping_created_by_fk";
--> statement-breakpoint
ALTER TABLE "legacy_variant_mapping" DROP CONSTRAINT IF EXISTS "legacy_variant_mapping_legacy_fk";
--> statement-breakpoint
ALTER TABLE "legacy_variant_mapping" DROP CONSTRAINT IF EXISTS "legacy_variant_mapping_canonical_fk";
--> statement-breakpoint
ALTER TABLE "legacy_variant_mapping" DROP CONSTRAINT IF EXISTS "legacy_variant_mapping_created_by_fk";
--> statement-breakpoint
ALTER TABLE "supplier_variant" DROP CONSTRAINT IF EXISTS "supplier_variant_product_fk";
--> statement-breakpoint
ALTER TABLE "supplier_inventory" DROP CONSTRAINT IF EXISTS "supplier_inventory_variant_fk";
--> statement-breakpoint
ALTER TABLE "supplier_product" DROP CONSTRAINT IF EXISTS "supplier_product_supplier_fk";
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" DROP CONSTRAINT IF EXISTS "wholesale_order_item_seller_offer_fk";
--> statement-breakpoint
ALTER TABLE "purchase_order_item" DROP CONSTRAINT IF EXISTS "purchase_order_item_seller_offer_fk";
--> statement-breakpoint
ALTER TABLE "purchase_order_item" DROP CONSTRAINT IF EXISTS "purchase_order_item_product_fk";
--> statement-breakpoint
ALTER TABLE "rfq" DROP CONSTRAINT IF EXISTS "rfq_seller_offer_fk";
--> statement-breakpoint
ALTER TABLE "rfq" DROP CONSTRAINT IF EXISTS "rfq_product_fk";
--> statement-breakpoint
ALTER TABLE "quote" DROP CONSTRAINT IF EXISTS "quote_seller_offer_fk";
--> statement-breakpoint
ALTER TABLE "quote" DROP CONSTRAINT IF EXISTS "quote_product_fk";
--> statement-breakpoint
ALTER TABLE "quote" DROP CONSTRAINT IF EXISTS "quote_variant_fk";
--> statement-breakpoint
ALTER TABLE "seller_offer" DROP CONSTRAINT IF EXISTS "seller_offer_product_fk";
--> statement-breakpoint
ALTER TABLE "seller_offer" DROP CONSTRAINT IF EXISTS "seller_offer_variant_fk";
--> statement-breakpoint
ALTER TABLE "seller_offer" DROP CONSTRAINT IF EXISTS "seller_offer_seller_fk";
--> statement-breakpoint

-- ۲) حذف ستون‌های canonical موقت و قدیمی
ALTER TABLE "wholesale_order_item" DROP COLUMN IF EXISTS "canonical_product_id";
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" DROP COLUMN IF EXISTS "canonical_variant_id";
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" DROP COLUMN IF EXISTS "product_id";
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" DROP COLUMN IF EXISTS "variant_id";
--> statement-breakpoint
ALTER TABLE "purchase_order_item" DROP COLUMN IF EXISTS "variant_id";
--> statement-breakpoint
ALTER TABLE "purchase_order_item" DROP COLUMN IF EXISTS "canonical_product_id";
--> statement-breakpoint
ALTER TABLE "purchase_order_item" DROP COLUMN IF EXISTS "canonical_variant_id";
--> statement-breakpoint
ALTER TABLE "rfq" DROP COLUMN IF EXISTS "canonical_product_id";
--> statement-breakpoint
ALTER TABLE "quote" DROP COLUMN IF EXISTS "canonical_product_id";
--> statement-breakpoint
ALTER TABLE "quote" DROP COLUMN IF EXISTS "canonical_variant_id";
--> statement-breakpoint

-- ۳) پاکسازی داده‌های قدیمی (چون دادهٔ تولید نداریم، تمیز کردن امن) — قبل از افزودن ستون‌های NOT NULL
TRUNCATE TABLE "wholesale_order_item", "purchase_order_item", "quote", "rfq" CASCADE;
--> statement-breakpoint

-- ۴) افزودن ستون‌های کانونیکال نهایی با NOT NULL (جدول‌ها خالی هستند)
ALTER TABLE "wholesale_order_item" ADD COLUMN "product_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD COLUMN "variant_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD COLUMN IF NOT EXISTS "seller_offer_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD COLUMN IF NOT EXISTS "product_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD COLUMN IF NOT EXISTS "variant_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD COLUMN IF NOT EXISTS "seller_offer_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "rfq" ADD COLUMN IF NOT EXISTS "product_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "product_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "variant_id" text NOT NULL;
--> statement-breakpoint

-- ۵) seller_offer — حذف deprecated inventory_on_hand/reserved
ALTER TABLE "seller_offer" DROP COLUMN IF EXISTS "inventory_on_hand";
--> statement-breakpoint
ALTER TABLE "seller_offer" DROP COLUMN IF EXISTS "inventory_reserved";
--> statement-breakpoint

-- ۶) حذف جدول‌های قدیمی
DROP TABLE IF EXISTS "legacy_product_mapping" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "legacy_variant_mapping" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "product_match_queue" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "supplier_inventory" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "supplier_variant" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "supplier_product" CASCADE;
--> statement-breakpoint

-- ۷) افزودن FK های کانونیکال نهایی
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_seller_offer_fk" FOREIGN KEY ("seller_offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_seller_offer_fk" FOREIGN KEY ("seller_offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rfq" ADD CONSTRAINT "rfq_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rfq" ADD CONSTRAINT "rfq_seller_offer_fk" FOREIGN KEY ("seller_offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_seller_offer_fk" FOREIGN KEY ("seller_offer_id") REFERENCES "public"."seller_offer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "seller_offer" ADD CONSTRAINT "seller_offer_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "seller_offer" ADD CONSTRAINT "seller_offer_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "seller_offer" ADD CONSTRAINT "seller_offer_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;
