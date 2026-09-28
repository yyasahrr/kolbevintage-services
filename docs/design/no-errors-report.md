# گزارش «بدون خطا» — پاسبان مرورگرمانند

تاریخ اجرا: 2026-09-28
ابزار: آزمون Vitest + jsdom (مرورگر واقعی در این محیط قابل نصب نیست؛ دانلود Playwright مسدود است).

## صفحه‌هایی که رندر شدند

| مسیر | عنوان | تعداد گرهٔ DOM |
| --- | --- | --- |
| #/ | صفحهٔ اصلی فروشگاه | 486 |
| #/shop | فهرست کالاها | 368 |
| #/cart | سبد خرید | 163 |
| #/checkout | تسویه حساب | 160 |
| #/wholesale | بازار عمده | 348 |
| #/wholesale-dashboard | میزکار خریدار عمده | 19 |
| #/vip | ورود اعضای ویژه | 19 |
| #/styles | کالکشن‌های استایل | 300 |
| #/about | دربارهٔ کلبه | 214 |
| #/admin › جمع کردن منو به آیکون‌ها | جمع کردن منو به آیکون‌ها | 252 |
| #/admin › تنظیمات خرده | تنظیمات خرده | 507 |
| #/admin › مرکز طراحی سایت | مرکز طراحی سایت | 102 |
| #/admin › داشبورد | داشبورد | 252 |
| #/admin › محصولات | محصولات | 405 |
| #/admin › سفارش‌ها | سفارش‌ها | 147 |
| #/admin › مرجوعی و ارسال | مرجوعی و ارسال | 170 |
| #/admin › مشتریان | مشتریان | 164 |
| #/admin › مشتریان ویژه | مشتریان ویژه | 148 |
| #/admin › پشتیبانی زنده | پشتیبانی زنده | 163 |
| #/admin › پیامک و اتوماسیون | پیامک و اتوماسیون | 161 |
| #/admin › جشنواره و تخفیف | جشنواره و تخفیف | 146 |
| #/admin › محتوا و صفحات | محتوا و صفحات | 165 |
| #/admin › گزارش‌ها | گزارش‌ها | 247 |
| #/admin › لاگ‌ها و خطاها | لاگ‌ها و خطاها | 206 |
| #/admin › دسترسی و امنیت | دسترسی و امنیت | 121 |
| #/admin › اتصال و اتوماسیون | اتصال و اتوماسیون | 121 |
| #/admin › مرکز سیستم | مرکز سیستم | 156 |

## خطاهای کنسول

هیچ خطای کنسولی ثبت نشد.

## خطاهای رهاشدهٔ زمان اجرا

هیچ خطای رهاشده‌ای ثبت نشد.

## درخواست‌های شبکهٔ دیده‌شده

- GET site/settings
- GET catalog/products
- GET me
- GET wholesale/account
- GET admin/tickets
- GET admin/logs?level=all&source=all&status=open&range=24h&q=&page=1&limit=50

> این گزارش خودکار ساخته می‌شود: `npx vitest run test/console-network-audit.test.tsx`.

## بررسی زندهٔ سرور توسعه (curl)

| مسیر | کد پاسخ |
| --- | --- |
| `/` | 200 |
| `/#/shop` | 200 |
| `/#/product/classic-short-sleeve` | 200 |
| `/#/wholesale` | 200 |
| `/#/vip` | 200 |
| `/#/admin` | 200 |
| `/supplier` | 200 |
| `/api/health` | 200 |
| `/store/kolbe/health` | 200 |
| `/store/kolbe/catalog/products` | 200 |

### کاتالوگ عمومی (نمونهٔ پاسخ)
```json
{"products":[{"id":"prod_classic","slug":"classic-short-sleeve","name":"پیراهن کلاسیک نیم‌آستین","description":"تولید کارخانه، کیفیت صادراتی","category":null,"updated_at":"2026-09-27T23:45:26.769Z","variants":[{"id":"var_classic","sku":"NL-CLASSIC-M","color":"شیری","size":"M","available":60}],"available_total":60,"retail_price":null,"price_source":"PENDING_RETAIL_PRICING"},{"id":"prod_blouse","slug":"vintage-princess-blouse","name":"بلوز وینتیج پرنس","description":"تولید کارخانه، کیفیت صادراتی","category"
```

> این بخش با curl روی همان سرور توسعهٔ در حال اجرا ساخته شده است.
