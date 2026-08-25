# Kolbe Vintage Platform

این ریپازیتوری پلتفرم کامل کلبه است: فروشگاه خرده، پنل مدیریت، فضای VIP عمده، پنل ساپلایر و **بک‌اند Medusa v2** (جایگزین Supabase طبق `docs/adr/ADR-001-medusa-backend.md`). منطق کسبوکار ثابت مانده: تأمین بازار عمده توسط ساپلایرها، خرید عمده توسط VIPها و پنل ساپلایر — حالا روی مدوسا.

## ساختار

```text
├── src/                  # فروشگاه، VIP و پنل مدیریت (React + Vite)
├── apps/supplier/        # پنل مستقل ساپلایر (React + Vite)
├── apps/api/             # بک‌اند Medusa v2 (ماژولهای دامنه + API + زرینپال + seed)
├── docs/                 # ADR، رودمپ و ممیزی معماری
├── public/               # assetها + فونت وزیرمتن (self-host)
└── scripts/              # ابزارهای توسعه monorepo
```

## معماری

```text
Storefront (5173) ──┐
Supplier Portal (5174) ──┼── vite proxy ──> Medusa API (9000) ──> PostgreSQL
```

- **ماژولهای دامنه در `apps/api/src/modules`:** `account` (احراز هویت یکپارچه با scrypt + توکن HMAC)، `supplier` (تأمینکنندگان/کاتالوگ/موجودی)، `wholesale` (VIP/سفارش عمده/RFQ/تیکت)، `purchase_order` (زنجیره تأمین)، `retail` (سفارش خرده) + پرووایدر `payment-zarinpal`
- **جریانهای دامنه در `src/lib/kolbe-flows.ts`:** ثبت سفارش عمده (رزرو موجودی + جبران خطا)، تأیید → ساخت PO برای هر ساپلایر، لغو، تحویل
- درخواستهای مرورگر همیشه نسبی هستند (`/store/kolbe/...`) و با پروکسی vite به سرور ۹۰۰۰ میروند — بدون CORS

## راهاندازی

پیشنیاز: Node 20+ و PostgreSQL (برای dev محلی میتوانید از `embedded-postgres` استفاده کنید).

```bash
npm install

# بک‌اند
cd apps/api && cp .env.example .env   # DATABASE_URL و JWT_SECRET را تنظیم کنید
npm install
npx medusa db:setup --db kolbe_medusa --no-interactive --execute-safe-links
npx medusa develop                     # http://localhost:9000 (+ /app)
node scripts/seed.mjs                  # داده اولیه + تست E2E کل زنجیره

# فرانتها (از ریشه)
npm run dev          # فروشگاه: http://localhost:5173
npm run dev:supplier # پنل ساپلایر: http://localhost:5174
```

حسابهای seed: ادمین `admin@kolbe.ir / KolbeAdmin1404!` — VIP `vip@boutique.ir / VipPass1404!` — ساپلایر `nilgoon@kolbe.ir / SupplierPass1404!`

> کلید publishable درخواستهای Store API در `x-publishable-api-key` ارسال میشود؛ کلید sandbox dev بهصورت پیشفرض در کلاینتها هست و با `VITE_MEDUSA_PUBLISHABLE_KEY` قابل بازنویسی است.

## مهاجرت از Supabase

کامل انجام شد (`git log` برای جزئیات): ماژولها و RPCهای Supabase → ماژولهای Medusa + flows؛ `supabase-js` از هر دو فرانت حذف شد؛ پوشه `supabase/` بازنشسته شد (اسکیمای مرجع در تاریخ گیت موجود است).
