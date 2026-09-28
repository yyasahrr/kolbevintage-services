/* Phase 5.11 reconciliation: durable customer return-filing replay identity. */

ALTER TABLE "retail_return_request" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "retail_return_request" ADD COLUMN "creation_request_hash" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "retail_return_request_customer_order_idempotency_unique"
  ON "retail_return_request" USING btree ("customer_id", "order_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
