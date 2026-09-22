CREATE INDEX "product_status_category" ON "product" USING btree ("status","category_id");
--> statement-breakpoint
CREATE INDEX "product_status_brand" ON "product" USING btree ("status","brand_id");
