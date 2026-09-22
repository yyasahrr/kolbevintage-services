/* Phase 5.9 Checkpoint B — first-class retail returns.
 *
 * `retail_return_request`: one customer return filing against a DELIVERED
 * retail order. `order_id` + `customer_id` are server-resolved (FKs,
 * restrict); `status`/`reason` are CHECK-typed; `inspection_decision`
 * stays NULL until the INSPECTED transition. `support_case_id` is a
 * LOOSE cross-module pointer (no FK — support owns its lifecycle;
 * returns must survive case archival).
 * `retail_return_item`: one returned order line per row (unique per
 * request), quantity strictly positive. Delivered-vs-requested math is
 * enforced by the service; this table only guarantees shape.
 * `retail_return_event`: append-only transition history (unique per
 * request + version), mirroring `retail_order_event`.
 *
 * Additive only: migrations 0000-0037 remain immutable.
 */

CREATE TABLE "retail_return_request" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "customer_id" text NOT NULL,
  "status" text NOT NULL,
  "reason" text NOT NULL,
  "note" text,
  "support_case_id" text,
  "received_at" timestamp with time zone,
  "inspected_at" timestamp with time zone,
  "inspection_decision" text,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "retail_return_request_order_fk" FOREIGN KEY ("order_id") REFERENCES "public"."retail_order"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "retail_return_request_customer_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "retail_return_request_status_allowed" CHECK ("status" IN ('REQUESTED', 'APPROVED', 'RECEIVED', 'INSPECTED', 'RESTOCKED', 'REJECTED', 'WITHDRAWN')),
  CONSTRAINT "retail_return_request_reason_allowed" CHECK ("reason" IN ('DAMAGED', 'WRONG_ITEM', 'SIZE_FIT', 'QUALITY_ISSUE', 'CHANGED_MIND', 'OTHER')),
  CONSTRAINT "retail_return_request_inspection_allowed" CHECK ("inspection_decision" IS NULL OR "inspection_decision" IN ('RESTOCKABLE', 'DAMAGED', 'INCOMPLETE', 'NOT_AS_DESCRIBED')),
  CONSTRAINT "retail_return_request_version_non_negative" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE INDEX "retail_return_request_order_created" ON "retail_return_request" USING btree ("order_id","created_at");
--> statement-breakpoint
CREATE INDEX "retail_return_request_customer_created" ON "retail_return_request" USING btree ("customer_id","created_at");
--> statement-breakpoint
CREATE INDEX "retail_return_request_support_case" ON "retail_return_request" USING btree ("support_case_id");
--> statement-breakpoint
CREATE TABLE "retail_return_item" (
  "id" text PRIMARY KEY NOT NULL,
  "return_id" text NOT NULL,
  "order_item_id" text NOT NULL,
  "quantity" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "retail_return_item_return_fk" FOREIGN KEY ("return_id") REFERENCES "public"."retail_return_request"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "retail_return_item_order_item_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."retail_order_item"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "retail_return_item_quantity_positive" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX "retail_return_item_return" ON "retail_return_item" USING btree ("return_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "retail_return_item_return_line_unique" ON "retail_return_item" USING btree ("return_id","order_item_id");
--> statement-breakpoint
CREATE TABLE "retail_return_event" (
  "id" text PRIMARY KEY NOT NULL,
  "return_id" text NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor_id" text,
  "actor_role" text,
  "reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "return_version" integer DEFAULT 0 NOT NULL,
  "idempotency_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "retail_return_event_return_fk" FOREIGN KEY ("return_id") REFERENCES "public"."retail_return_request"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "retail_return_event_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "retail_return_event_from_status_allowed" CHECK ("from_status" IS NULL OR "from_status" IN ('REQUESTED', 'APPROVED', 'RECEIVED', 'INSPECTED', 'RESTOCKED', 'REJECTED', 'WITHDRAWN')),
  CONSTRAINT "retail_return_event_to_status_allowed" CHECK ("to_status" IN ('REQUESTED', 'APPROVED', 'RECEIVED', 'INSPECTED', 'RESTOCKED', 'REJECTED', 'WITHDRAWN')),
  CONSTRAINT "retail_return_event_return_version_non_negative" CHECK ("return_version" >= 0)
);
--> statement-breakpoint
CREATE INDEX "retail_return_event_return_created" ON "retail_return_event" USING btree ("return_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "retail_return_event_return_version_unique" ON "retail_return_event" USING btree ("return_id","return_version");
