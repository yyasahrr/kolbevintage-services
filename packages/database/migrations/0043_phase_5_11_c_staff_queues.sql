CREATE INDEX "retail_order_status_created" ON "retail_order" USING btree ("order_status","created_at","id");
--> statement-breakpoint
CREATE INDEX "retail_order_payment_created" ON "retail_order" USING btree ("payment_status","created_at","id");
--> statement-breakpoint
CREATE INDEX "retail_return_request_status_created" ON "retail_return_request" USING btree ("status","created_at","id");
--> statement-breakpoint
CREATE INDEX "refund_retail_status_created" ON "refund" USING btree ("status","created_at","id") WHERE "retail_order_id" IS NOT NULL;
