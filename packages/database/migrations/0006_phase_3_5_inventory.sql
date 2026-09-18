-- فاز ۳.۵ — تثبیت مالکیت موجودی و موجودی در سطح واریانت
-- هدف: رفع ابهام موجودی قبل از جریان تراکنش
--   - منبع حقیقت موجودی: تأمین‌کننده (Supplier Inventory System)
--   - نمایش بازار: Marketplace Availability View (مشتق)
--   - رزرو: Reservation با انقضا، آزادسازی، تأیید، لغو
--   - دفتر کل: Inventory Ledger فقط حرکت موجودی (نه مالی)

-- ۱) product_variant_inventory — موجودی در سطح واریانت + فروشنده، مالک تأمین‌کننده
CREATE TABLE "product_variant_inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variant_inventory_status_allowed" CHECK ("status" IN ('active', 'archived')),
	CONSTRAINT "product_variant_inventory_on_hand_non_negative" CHECK ("on_hand" >= 0),
	CONSTRAINT "product_variant_inventory_reserved_non_negative" CHECK ("reserved" >= 0),
	CONSTRAINT "product_variant_inventory_reserved_within_on_hand" CHECK ("reserved" <= "on_hand")
);
--> statement-breakpoint
ALTER TABLE "product_variant_inventory" ADD CONSTRAINT "product_variant_inventory_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_variant_inventory" ADD CONSTRAINT "product_variant_inventory_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_inventory_variant_seller_unique" ON "product_variant_inventory" USING btree ("variant_id","seller_id");
--> statement-breakpoint
CREATE INDEX "product_variant_inventory_seller" ON "product_variant_inventory" USING btree ("seller_id");
--> statement-breakpoint
-- ۲) inventory_reservation — رزرو با انقضا
CREATE TABLE "inventory_reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"request_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservation_status_allowed" CHECK ("status" IN ('pending', 'active', 'released', 'confirmed', 'expired', 'cancelled')),
	CONSTRAINT "inventory_reservation_quantity_non_negative" CHECK ("quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."wholesale_request"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inventory_reservation_variant_seller" ON "inventory_reservation" USING btree ("variant_id","seller_id");
--> statement-breakpoint
CREATE INDEX "inventory_reservation_status_expires" ON "inventory_reservation" USING btree ("status","expires_at");
--> statement-breakpoint
-- ۳) inventory_ledger — دفتر کل حرکت موجودی
CREATE TABLE "inventory_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"change_type" text NOT NULL,
	"quantity_delta" integer NOT NULL,
	"before_on_hand" integer DEFAULT 0 NOT NULL,
	"after_on_hand" integer DEFAULT 0 NOT NULL,
	"before_reserved" integer DEFAULT 0 NOT NULL,
	"after_reserved" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_ledger_change_type_allowed" CHECK ("change_type" IN ('INCREASE', 'DECREASE', 'RESERVE', 'RELEASE', 'ADJUSTMENT'))
);
--> statement-breakpoint
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inventory_ledger_variant_created" ON "inventory_ledger" USING btree ("variant_id","created_at");
--> statement-breakpoint
CREATE INDEX "inventory_ledger_seller_created" ON "inventory_ledger" USING btree ("seller_id","created_at");
--> statement-breakpoint
-- ۴) توضیح: seller_offer.inventory_on_hand/reserved دیگر منبع حقیقت نیست
--    منبع حقیقت: product_variant_inventory (مالک تأمین‌کننده)
--    نمایش: seller_offer inventory به عنوان کش قدیمی باقی می‌ماند تا مهاجرت کامل شود
--    در فاز ۴، رزرو باید روی product_variant_inventory انجام شود، نه seller_offer
