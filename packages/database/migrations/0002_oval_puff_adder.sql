-- ═══════════════════════════════════════════════════════════════════════════
-- گام ۱.۲ — یکپارچگی داده: کلیدهای خارجی، قیدهای CHECK، پول و موجودی
--
-- این مهاجرت سه کار می‌کند و ترتیب‌شان عمدی است:
--   ۱) BACKFILL  — تبدیل مقدار تاریخی `pending_gateway` در پرداخت خرده‌فروشی به
--      `unpaid` (بدهی N4 / اصلاح D19a: هیچ درگاه پرداختی وجود ندارد و هیچ
--      سفارشی نباید ادعای «منتظر درگاه» داشته باشد). سپس پیش‌فرض ستون هم
--      `unpaid` می‌شود تا مسیرهای آیندهٔ ثبت سفارش ارزش گمراه‌کننده ننویسند.
--   ۲) PRECHECK  — یک بلوک فقط-خواندنی که **همهٔ** ناسازگاری‌های داده را یک‌جا
--      گزارش می‌کند (row های بی‌والد، مقادیر خارج از مجموعهٔ مجاز، مبالغ/مقادیر
--      نامعتبر). اگر چیزی پیدا شود، مهاجرت با پیام روشن می‌شکند و هیچ قیدی
--      اضافه نمی‌شود — نه اینکه وسط کار با خطای مبهم Postgres بترکد.
--   ۳) CONSTRAINT — افزودن FK/CHECK/ایندکس‌ها.
--
-- شواهد افزودن این قیدها (ممیزی داده روی اسکیمای زنده + خواندن کد، نه حدس از
-- نام ستون): گزارش فاز در `docs/phase-reports/phase-1.2-report.md` و مجموعهٔ
-- مقادیر مجاز در `packages/database/src/schema/state-values.ts`.
--
-- دو ایندکس `system_log` در DDL قدیمی زمان‌اجرا وجود داشتند ولی در مهاجرت‌های
-- پایه نبودند (رانش کشف‌شده)؛ چون روی دیتابیس‌های مرحلهٔ ۱.۵ از قبل موجودند،
-- با `IF NOT EXISTS` ساخته می‌شوند تا هر دو مسیر (دیتابیس تازه و دیتابیس ۱.۵)
-- به یک نتیجه برسند.
--
-- ⚠️ هیچ جدول/ستونی حذف یا بازسازی نمی‌شود و هیچ داده‌ای پاک نمی‌شود؛ تنها نوشتن
-- این مهاجرت همان backfill پرداخت است.
-- ═══════════════════════════════════════════════════════════════════════════

-- ۱) BACKFILL — «منتظر درگاه» یعنی «پرداخت‌نشده»؛ چون ارائه‌دهنده‌ای وجود ندارد.
UPDATE "retail_order"
   SET "payment_status" = 'unpaid'
 WHERE "payment_status" = 'pending_gateway';

-- ۲) PRECHECK — همهٔ ناسازگاری‌ها یک‌جا گزارش می‌شوند و در صورت وجود، هیچ قیدی
--    اضافه نمی‌شود (تراکنش مهاجرت برمی‌گردد).
DO $precheck$
DECLARE
  problems text[] := ARRAY[]::text[];
  fk_pairs text[][] := ARRAY[
    ARRAY['supplier_member','supplier_id','supplier','id'],
    ARRAY['supplier_member','user_id','account_user','id'],
    ARRAY['supplier_application','user_id','account_user','id'],
    ARRAY['supplier_product','supplier_id','supplier','id'],
    ARRAY['supplier_variant','product_id','supplier_product','id'],
    ARRAY['supplier_inventory','variant_id','supplier_variant','id'],
    ARRAY['wholesale_account','user_id','account_user','id'],
    ARRAY['wholesale_order','account_id','wholesale_account','id'],
    ARRAY['wholesale_order_item','order_id','wholesale_order','id'],
    ARRAY['wholesale_order_item','product_id','supplier_product','id'],
    ARRAY['wholesale_order_item','variant_id','supplier_variant','id'],
    ARRAY['purchase_order','supplier_id','supplier','id'],
    ARRAY['purchase_order','wholesale_order_id','wholesale_order','id'],
    ARRAY['purchase_order_item','purchase_order_id','purchase_order','id'],
    ARRAY['purchase_order_item','variant_id','supplier_variant','id'],
    ARRAY['rfq','supplier_id','supplier','id'],
    ARRAY['quote','rfq_id','rfq','id'],
    ARRAY['quote','supplier_id','supplier','id'],
    ARRAY['support_ticket','supplier_id','supplier','id'],
    ARRAY['retail_order','customer_id','account_user','id'],
    ARRAY['retail_order_item','order_id','retail_order','id']
  ];
  domains text[][] := ARRAY[
    ARRAY['account_user','role','customer,vip,admin,supplier'],
    ARRAY['supplier','status','pending,reviewing,approved,rejected'],
    ARRAY['supplier_application','status','pending,reviewing,approved,rejected'],
    ARRAY['supplier_product','status','draft,submitted,approved,rejected,archived'],
    ARRAY['wholesale_account','status','pending,approved,rejected,suspended,expired'],
    ARRAY['wholesale_order','status','pending,approved,fulfilling,fulfilled,cancelled'],
    ARRAY['purchase_order','status','pending,confirmed,preparing,shipped,delivered,cancelled'],
    ARRAY['rfq','status','open,quoted'],
    ARRAY['quote','status','submitted'],
    ARRAY['support_ticket','status','open,answered,closed'],
    ARRAY['support_ticket','priority','low,normal,high'],
    ARRAY['retail_order','order_status','placed,confirmed,packed,shipped,delivered,cancelled,returned'],
    ARRAY['retail_order','payment_status','unpaid,pending_cod'],
    ARRAY['retail_order','pay_method','gateway,installment,cod,wallet'],
    ARRAY['retail_order','payment_method','gateway,installment,cod,wallet'],
    ARRAY['retail_order','shipping_method','post,pishtaz,tipax'],
    ARRAY['retail_order','currency','IRR'],
    ARRAY['purchase_order','currency','IRR']
  ];
  ranges text[][] := ARRAY[
    ARRAY['supplier_product','"wholesale_price" >= 0 AND "wholesale_price" <= 1000000000000000'],
    ARRAY['supplier_variant','"cost" >= 0 AND "cost" <= 1000000000000000'],
    ARRAY['supplier_inventory','"on_hand" >= 0 AND "reserved" >= 0 AND "reserved" <= "on_hand"'],
    ARRAY['wholesale_order','"total_amount" >= 0 AND "total_amount" <= 1000000000000000 AND "total_units" >= 0'],
    ARRAY['wholesale_order_item','"quantity" >= 0 AND "unit_price" >= 0 AND "unit_price" <= 1000000000000000'],
    ARRAY['purchase_order','"total_amount" >= 0 AND "total_amount" <= 1000000000000000'],
    ARRAY['purchase_order_item','"quantity" >= 0 AND "unit_price" >= 0 AND "unit_price" <= 1000000000000000 AND "total_amount" >= 0 AND "total_amount" <= 1000000000000000'],
    ARRAY['quote','"unit_price" >= 0 AND "unit_price" <= 1000000000000000 AND "lead_time_days" >= 0'],
    ARRAY['rfq','"quantity" >= 0'],
    ARRAY['retail_order','"total_amount" >= 0 AND "total_amount" <= 1000000000000000 AND "items_total" >= 0 AND "items_total" <= 1000000000000000 AND "shipping_price" >= 0 AND "shipping_price" <= 1000000000000000'],
    ARRAY['retail_order_item','"quantity" >= 0 AND "unit_price" >= 0 AND "unit_price" <= 1000000000000000 AND "line_total" >= 0 AND "line_total" <= 1000000000000000']
  ];
  i integer;
  n bigint;
BEGIN
  FOR i IN 1..array_length(fk_pairs, 1) LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.%I = c.%I)',
      fk_pairs[i][1], fk_pairs[i][2], fk_pairs[i][3], fk_pairs[i][4], fk_pairs[i][2]
    ) INTO n;
    IF n > 0 THEN
      problems := problems || format('%s.%s → %s.%s: %s orphan row(s)',
        fk_pairs[i][1], fk_pairs[i][2], fk_pairs[i][3], fk_pairs[i][4], n);
    END IF;
  END LOOP;

  FOR i IN 1..array_length(domains, 1) LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE %I IS NOT NULL AND %I <> ALL (string_to_array($1, '',''))',
      domains[i][1], domains[i][2], domains[i][2]
    ) USING domains[i][3] INTO n;
    IF n > 0 THEN
      problems := problems || format('%s.%s: %s row(s) outside {%s}',
        domains[i][1], domains[i][2], n, domains[i][3]);
    END IF;
  END LOOP;

  FOR i IN 1..array_length(ranges, 1) LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE NOT (%s)', ranges[i][1], ranges[i][2]) INTO n;
    IF n > 0 THEN
      problems := problems || format('%s: %s row(s) violate (%s)',
        ranges[i][1], n, ranges[i][2]);
    END IF;
  END LOOP;

  IF array_length(problems, 1) IS NOT NULL AND array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION E'integrity precheck failed — clean up or backfill the data, then re-run the migration:\n  %',
      array_to_string(problems, E'\n  ');
  END IF;
END
$precheck$;
-- ۳) CONSTRAINT — قیدهای جدید (تولیدشدهٔ drizzle-kit از اسکیمای Drizzle).
ALTER TABLE "retail_order" ALTER COLUMN "payment_status" SET DEFAULT 'unpaid';--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_wholesale_order_fk" FOREIGN KEY ("wholesale_order_id") REFERENCES "public"."wholesale_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_purchase_order_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."supplier_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_rfq_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfq"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_customer_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD CONSTRAINT "retail_order_item_order_fk" FOREIGN KEY ("order_id") REFERENCES "public"."retail_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq" ADD CONSTRAINT "rfq_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_application" ADD CONSTRAINT "supplier_application_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."supplier_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_member" ADD CONSTRAINT "supplier_member_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_member" ADD CONSTRAINT "supplier_member_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product" ADD CONSTRAINT "supplier_product_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_variant" ADD CONSTRAINT "supplier_variant_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."supplier_product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_account" ADD CONSTRAINT "wholesale_account_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wholesale_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_order_fk" FOREIGN KEY ("order_id") REFERENCES "public"."wholesale_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."supplier_product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."supplier_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "system_log_open_fingerprint" ON "system_log" USING btree ("fingerprint") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_log_last_seen" ON "system_log" USING btree ("last_seen_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "account_user" ADD CONSTRAINT "account_user_role_allowed" CHECK ("role" IN ('customer', 'vip', 'admin', 'supplier'));--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_status_allowed" CHECK ("status" IN ('pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'));--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_total_amount_range" CHECK ("total_amount" >= 0 AND "total_amount" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_currency_allowed" CHECK ("currency" IN ('IRR'));--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_quantity_non_negative" CHECK ("quantity" >= 0);--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_unit_price_range" CHECK ("unit_price" >= 0 AND "unit_price" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_total_amount_range" CHECK ("total_amount" >= 0 AND "total_amount" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_status_allowed" CHECK ("status" IN ('submitted'));--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_unit_price_range" CHECK ("unit_price" >= 0 AND "unit_price" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_lead_time_days_non_negative" CHECK ("lead_time_days" >= 0);--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_status_allowed" CHECK ("order_status" IN ('placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'));--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_payment_status_allowed" CHECK ("payment_status" IN ('unpaid', 'pending_cod'));--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_pay_method_allowed" CHECK ("pay_method" IN ('gateway', 'installment', 'cod', 'wallet'));--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_payment_method_allowed" CHECK ("payment_method" IN ('gateway', 'installment', 'cod', 'wallet'));--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_shipping_method_allowed" CHECK ("shipping_method" IN ('post', 'pishtaz', 'tipax'));--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_currency_allowed" CHECK ("currency" IN ('IRR'));--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_total_amount_range" CHECK ("total_amount" >= 0 AND "total_amount" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_items_total_range" CHECK ("items_total" >= 0 AND "items_total" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "retail_order" ADD CONSTRAINT "retail_order_shipping_price_range" CHECK ("shipping_price" >= 0 AND "shipping_price" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD CONSTRAINT "retail_order_item_quantity_non_negative" CHECK ("quantity" >= 0);--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD CONSTRAINT "retail_order_item_unit_price_range" CHECK ("unit_price" >= 0 AND "unit_price" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "retail_order_item" ADD CONSTRAINT "retail_order_item_line_total_range" CHECK ("line_total" >= 0 AND "line_total" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "rfq" ADD CONSTRAINT "rfq_status_allowed" CHECK ("status" IN ('open', 'quoted'));--> statement-breakpoint
ALTER TABLE "rfq" ADD CONSTRAINT "rfq_quantity_non_negative" CHECK ("quantity" >= 0);--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_status_allowed" CHECK ("status" IN ('pending', 'reviewing', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "supplier_application" ADD CONSTRAINT "supplier_application_status_allowed" CHECK ("status" IN ('pending', 'reviewing', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_on_hand_non_negative" CHECK ("on_hand" >= 0);--> statement-breakpoint
ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_reserved_non_negative" CHECK ("reserved" >= 0);--> statement-breakpoint
ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_reserved_within_on_hand" CHECK ("reserved" <= "on_hand");--> statement-breakpoint
ALTER TABLE "supplier_product" ADD CONSTRAINT "supplier_product_status_allowed" CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected', 'archived'));--> statement-breakpoint
ALTER TABLE "supplier_product" ADD CONSTRAINT "supplier_product_wholesale_price_range" CHECK ("wholesale_price" >= 0 AND "wholesale_price" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "supplier_variant" ADD CONSTRAINT "supplier_variant_cost_range" CHECK ("cost" >= 0 AND "cost" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_status_allowed" CHECK ("status" IN ('open', 'answered', 'closed'));--> statement-breakpoint
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_priority_allowed" CHECK ("priority" IN ('low', 'normal', 'high'));--> statement-breakpoint
ALTER TABLE "wholesale_account" ADD CONSTRAINT "wholesale_account_status_allowed" CHECK ("status" IN ('pending', 'approved', 'rejected', 'suspended', 'expired'));--> statement-breakpoint
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_status_allowed" CHECK ("status" IN ('pending', 'approved', 'fulfilling', 'fulfilled', 'cancelled'));--> statement-breakpoint
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_total_amount_range" CHECK ("total_amount" >= 0 AND "total_amount" <= 1000000000000000);--> statement-breakpoint
ALTER TABLE "wholesale_order" ADD CONSTRAINT "wholesale_order_total_units_non_negative" CHECK ("total_units" >= 0);--> statement-breakpoint
ALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_quantity_non_negative" CHECK ("quantity" >= 0);--> statement-breakpointALTER TABLE "wholesale_order_item" ADD CONSTRAINT "wholesale_order_item_unit_price_range" CHECK ("unit_price" >= 0 AND "unit_price" <= 1000000000000000);
