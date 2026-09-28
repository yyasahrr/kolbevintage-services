-- ═══════════════════════════════════════════════════════════════════════════
-- گام ۲ — سخت‌سازی احراز هویت: نسخه‌سازی توکن، قفل حساب، ردیابی تلاش ورود
--
-- این مهاجرت سه کار می‌کند:
--   ۱) PRECHECK — بررسی می‌کند که وضعیت‌های موجود `account_user.status`
--      فقط `active` باشند (یا NULL که به پیش‌فرض تبدیل می‌شود). اگر مقدار
--      ناسازگار وجود داشته باشد، مهاجرت با پیام روشن می‌شکند.
--   ۲) SCHEMA — افزودن ستون‌های جدید به `account_user`:
--        - token_version            : برای ابطال توکن (افزایش در logout)
--        - last_login_at            : آخرین ورود موفق
--        - failed_login_attempts    : شمارش تلاش‌های ناموفق برای قفل
--        - locked_until             : زمان پایان قفل موقت
--      و ساخت دو جدول تازه:
--        - login_attempt            : هر تلاش ورود با IP و نتیجه
--        - user_session             : ردیابی نشست‌های فعال (hash توکن)
--   ۳) CONSTRAINT — افزودن CHECK برای status جدید و بازه‌های عددی.
--
-- قاعدهٔ A21: هیچ کد زمان‌اجرا اسکیما نمی‌سازد؛ فقط مهاجرت نسخه‌دار.
-- مالک هر سه جدول `auth` است (registry.ts).
-- ═══════════════════════════════════════════════════════════════════════════

-- ۱) PRECHECK — فقط وضعیت‌های مجاز
DO $precheck$
DECLARE
  problems text[] := ARRAY[]::text[];
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM "account_user" WHERE "status" IS NOT NULL AND "status" NOT IN ('active', 'suspended', 'locked');
  IF n > 0 THEN
    problems := problems || format('account_user.status: %s row(s) outside {active,suspended,locked}', n);
  END IF;

  IF array_length(problems, 1) IS NOT NULL AND array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION E'auth precheck failed — clean up account_user.status, then re-run:\n  %',
      array_to_string(problems, E'\n  ');
  END IF;
END
$precheck$;

-- ۲) SCHEMA — جداول تازه
CREATE TABLE "login_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"ip" text,
	"success" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_user" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "account_user" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_user" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "account_user" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "login_attempt" ADD CONSTRAINT "login_attempt_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_attempt_user_created" ON "login_attempt" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "login_attempt_email_created" ON "login_attempt" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "login_attempt_ip_created" ON "login_attempt" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "user_session_user_created" ON "user_session" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_session_token_hash" ON "user_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_session_expires" ON "user_session" USING btree ("expires_at");--> statement-breakpoint
-- ۳) CONSTRAINT — قیدهای جدید
ALTER TABLE "account_user" ADD CONSTRAINT "account_user_status_allowed" CHECK ("status" IN ('active', 'suspended', 'locked'));--> statement-breakpoint
ALTER TABLE "account_user" ADD CONSTRAINT "account_user_token_version_non_negative" CHECK ("token_version" >= 0);--> statement-breakpoint
ALTER TABLE "account_user" ADD CONSTRAINT "account_user_failed_attempts_non_negative" CHECK ("failed_login_attempts" >= 0);
