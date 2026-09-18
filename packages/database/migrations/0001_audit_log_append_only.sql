-- قاعدهٔ A13: «Financial history is append-only» و «Admin operations must be auditable».
--
-- چرا تریگر و نه فقط قرارداد کد؟ چون «فقط-افزودنی» یک تضمین داده است، نه یک
-- سبک برنامه‌نویسی: یک اسکریپت مهاجرت، یک کوئری دستی یا یک ماژول اشتباه نباید
-- بتواند تاریخ حسابرسی را بازنویسی یا حذف کند. تریگر در سطح دیتابیس همهٔ
-- مسیرها را می‌بندد — از جمله مسیرهایی که هنوز نوشته نشده‌اند.
--
-- همین الگو در فاز ۵ برای `ledger_entries` و `wallet_entries` تکرار می‌شود.

CREATE OR REPLACE FUNCTION kolbe_audit_log_append_only() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only (operation: %)', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_append_only ON "audit_log";--> statement-breakpoint

CREATE TRIGGER audit_log_append_only
	BEFORE UPDATE OR DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION kolbe_audit_log_append_only();
