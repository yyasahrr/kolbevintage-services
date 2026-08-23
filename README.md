# Kolbe Vintage Platform

این ریپازیتوری تمام بخش‌های پلتفرم کلبه را در یک monorepo نگه می‌دارد. فروشگاه، پنل ادمین و تجربه VIP در اپ اصلی هستند و پنل مستقل ساپلایر در workspace خودش اجرا می‌شود. هر دو اپ به یک پروژه Supabase و یک زنجیره سفارش عمده متصل‌اند.

## ساختار

```text
.
├── src/                  # فروشگاه، VIP و پنل مدیریت کلبه
├── apps/
│   └── supplier/         # پنل مستقل ساپلایر
├── supabase/migrations/  # دیتابیس و workflow مشترک
├── docs/                 # معماری و مستندات محصول
├── public/               # assetهای اپ اصلی
└── scripts/              # ابزارهای توسعه monorepo
```

## راه‌اندازی

پیش‌نیاز: Node.js 20 یا جدیدتر.

```bash
npm install
```

فایل `.env.local` را در ریشه برای اپ اصلی و در `apps/supplier/.env.local` برای پنل ساپلایر بسازید. هر دو فایل باید به یک Supabase متصل باشند:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

اجرای هم‌زمان هر دو اپ:

```bash
npm run dev:all
```

- فروشگاه و پنل ادمین: `http://127.0.0.1:5173`
- پنل ساپلایر: `http://127.0.0.1:5174`

فرمان‌های مستقل نیز در دسترس‌اند: `npm run dev:storefront` و `npm run dev:supplier`.

## build

```bash
npm run build:all
```

خروجی اپ اصلی در `dist/` و خروجی پنل ساپلایر در `apps/supplier/dist/` ساخته می‌شود.

## مدل استقرار

دو اپ از یک کدبیس و دیتابیس مشترک استفاده می‌کنند، اما مستقل deploy می‌شوند. برای نمونه، دامنه اصلی می‌تواند میزبان فروشگاه باشد و `supplier.example.com` پنل ساپلایر را ارائه کند. متغیرهای محیطی هر دو deployment باید به همان پروژه Supabase اشاره کنند.

ریپازیتوری قدیمی ساپلایر فقط برای نگهداری تاریخچه باقی می‌ماند؛ مرجع توسعه از این پس پوشه `apps/supplier` در همین ریپازیتوری است.
