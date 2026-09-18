-- فاز ۲ — TOTP دومرحله‌ای: افزودن ستون‌های احراز هویت دومرحله‌ای به account_user
ALTER TABLE "account_user" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "account_user" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_user" ADD COLUMN "totp_enrolled_at" timestamp with time zone;
