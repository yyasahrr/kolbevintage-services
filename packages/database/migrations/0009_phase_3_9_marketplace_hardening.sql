-- Phase 3.9 — canonical marketplace hardening (pre-launch; no legacy commerce restored)

-- Normalize development-only zero values before strengthening semantic constraints.
UPDATE "seller_offer" SET "moq" = 1 WHERE "moq" <= 0;
UPDATE "wholesale_package_item" SET "quantity" = 1 WHERE "quantity" <= 0;
UPDATE "wholesale_package" SET "total_pieces" = 1 WHERE "total_pieces" <= 0;
UPDATE "wholesale_pricing_tier" SET "min_quantity" = 1 WHERE "min_quantity" <= 0;
UPDATE "wholesale_pricing_tier" SET "max_quantity" = "min_quantity" WHERE "max_quantity" IS NOT NULL AND "max_quantity" < "min_quantity";
UPDATE "vip_plan" SET "duration_days" = 1 WHERE "duration_days" <= 0;
UPDATE "wholesale_request" SET "quantity" = 1 WHERE "quantity" <= 0;
--> statement-breakpoint

ALTER TABLE "seller" ADD CONSTRAINT "seller_type_supplier_consistency"
  CHECK (("type" = 'KOLBE' AND "supplier_id" IS NULL) OR ("type" = 'SUPPLIER' AND "supplier_id" IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX "seller_kolbe_singleton" ON "seller" ("type") WHERE "type" = 'KOLBE';
--> statement-breakpoint

ALTER TABLE "seller_offer" DROP CONSTRAINT "seller_offer_moq_non_negative";
ALTER TABLE "seller_offer" ADD CONSTRAINT "seller_offer_moq_positive" CHECK ("moq" > 0);
ALTER TABLE "seller_offer" ADD CONSTRAINT "seller_offer_package_type_allowed" CHECK ("package_type" IS NULL OR "package_type" IN ('SIZE_RUN','FIXED_QUANTITY','COLOR_MIX','CUSTOM_BUNDLE'));
ALTER TABLE "wholesale_package" DROP CONSTRAINT "wholesale_package_total_pieces_non_negative";
ALTER TABLE "wholesale_package" ADD CONSTRAINT "wholesale_package_total_pieces_positive" CHECK ("total_pieces" > 0);
ALTER TABLE "wholesale_package_item" DROP CONSTRAINT "wholesale_package_item_quantity_non_negative";
ALTER TABLE "wholesale_package_item" ADD CONSTRAINT "wholesale_package_item_quantity_positive" CHECK ("quantity" > 0);
CREATE UNIQUE INDEX "wholesale_package_item_package_variant_unique" ON "wholesale_package_item" ("package_id", "variant_id");
ALTER TABLE "wholesale_pricing_tier" DROP CONSTRAINT "wholesale_pricing_tier_min_quantity_non_negative";
ALTER TABLE "wholesale_pricing_tier" ADD CONSTRAINT "wholesale_pricing_tier_min_quantity_positive" CHECK ("min_quantity" > 0);
ALTER TABLE "wholesale_pricing_tier" ADD CONSTRAINT "wholesale_pricing_tier_range_valid" CHECK ("max_quantity" IS NULL OR "max_quantity" >= "min_quantity");
ALTER TABLE "vip_plan" DROP CONSTRAINT "vip_plan_duration_days_non_negative";
ALTER TABLE "vip_plan" ADD CONSTRAINT "vip_plan_duration_days_positive" CHECK ("duration_days" > 0);
ALTER TABLE "wholesale_request" DROP CONSTRAINT "wholesale_request_quantity_non_negative";
ALTER TABLE "wholesale_request" ADD CONSTRAINT "wholesale_request_quantity_positive" CHECK ("quantity" > 0);
--> statement-breakpoint

CREATE TABLE "supplier_product_submission" (
  "id" text PRIMARY KEY NOT NULL,
  "supplier_id" text NOT NULL,
  "seller_id" text NOT NULL,
  "proposed_name" text NOT NULL,
  "proposed_slug" text NOT NULL,
  "proposed_description" text DEFAULT '' NOT NULL,
  "brand_id" text,
  "proposed_brand_id" text,
  "category_id" text,
  "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "media" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'pending_review' NOT NULL,
  "matched_product_id" text,
  "approved_product_id" text,
  "admin_review_note" text,
  "created_by" text NOT NULL,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "supplier_product_submission_status_allowed" CHECK ("status" IN ('draft','pending_review','approved_new_product','approved_existing_product','rejected','cancelled')),
  CONSTRAINT "supplier_product_submission_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE restrict,
  CONSTRAINT "supplier_product_submission_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "seller"("id") ON DELETE restrict,
  CONSTRAINT "supplier_product_submission_brand_fk" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE restrict,
  CONSTRAINT "supplier_product_submission_proposed_brand_fk" FOREIGN KEY ("proposed_brand_id") REFERENCES "brand"("id") ON DELETE restrict,
  CONSTRAINT "supplier_product_submission_category_fk" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE restrict,
  CONSTRAINT "supplier_product_submission_matched_product_fk" FOREIGN KEY ("matched_product_id") REFERENCES "product"("id") ON DELETE restrict,
  CONSTRAINT "supplier_product_submission_approved_product_fk" FOREIGN KEY ("approved_product_id") REFERENCES "product"("id") ON DELETE restrict,
  CONSTRAINT "supplier_product_submission_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "account_user"("id") ON DELETE restrict,
  CONSTRAINT "supplier_product_submission_reviewed_by_fk" FOREIGN KEY ("reviewed_by") REFERENCES "account_user"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX "supplier_product_submission_supplier_status" ON "supplier_product_submission" ("supplier_id", "status");
