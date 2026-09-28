ALTER TABLE "product_rating" ADD COLUMN "verified_retail_order_id" text;
--> statement-breakpoint
ALTER TABLE "product_rating" ADD COLUMN "verified_wholesale_order_id" text;
--> statement-breakpoint
ALTER TABLE "product_rating" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_rating" ADD CONSTRAINT "product_rating_single_proof_side" CHECK (("verified_retail_order_id" IS NULL) <> ("verified_wholesale_order_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "product_rating" ADD CONSTRAINT "product_rating_retail_order_fk" FOREIGN KEY ("verified_retail_order_id") REFERENCES "public"."retail_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_rating" ADD CONSTRAINT "product_rating_wholesale_order_fk" FOREIGN KEY ("verified_wholesale_order_id") REFERENCES "public"."wholesale_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "product_rating_product_rater_unique" ON "product_rating" USING btree ("product_id","rater_id");
