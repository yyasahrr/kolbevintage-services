# Kolbe Vintage Platform

پلتفرم یکپارچه کلبه وینتیج با **Next.js 15** و **PostgreSQL**.

```text
مرورگر
  └── Next.js :3000
      ├── /                    فروشگاه
      ├── /supplier            پورتال تأمین‌کننده
      ├── /#/admin             پنل مدیریت کلبه
      ├── /#/vip               پورتال VIP
      └── /store/kolbe/*       API یکپارچه
          └── PostgreSQL :55432
```

## اجرا

```bash
npm install
npm run dev
```

`npm run dev` دیتابیس محلی را آماده می‌کند و سپس Next.js را روی پورت `3000` اجرا
می‌کند. جداول و داده‌های نمونه در اولین درخواست API به‌صورت idempotent ساخته می‌شوند.

برای اجرای فرانت روی پورت دیگر:

```bash
npm exec --workspace kolbe-next -- next dev -H 0.0.0.0 -p 3001
```

## آدرس‌ها

| بخش | آدرس |
|---|---|
| فروشگاه | http://localhost:3000 |
| پنل مدیریت | http://localhost:3000/#/admin |
| پنل VIP | http://localhost:3000/#/vip |
| پنل تأمین‌کننده | http://localhost:3000/supplier |
| سلامت سرویس | http://localhost:3000/api/health |

## حساب‌های توسعه

| نقش | ایمیل | رمز |
|---|---|---|
| مدیر | `admin@kolbe.ir` | `KolbeAdmin1404!` |
| VIP | `vip@boutique.ir` | `VipPass1404!` |
| تأمین‌کننده | `nilgoon@kolbe.ir` | `SupplierPass1404!` |

## تنظیمات

فایل `.env.example` را برای محیط واقعی به `.env` تبدیل کنید و حتماً
`KOLBE_SESSION_SECRET` را با یک مقدار تصادفی طولانی جایگزین کنید.

برای فعال‌کردن پرو مجازی لباس، کلید API ساخته‌شده در پنل Perfect Corp را فقط در
فایل `frontend-next/.env.local` قرار دهید (این مقدار نباید با پیشوند
`NEXT_PUBLIC_` تعریف شود):

```env
PERFECT_CORP_API_KEY=your-api-key
```

پس از تغییر متغیر محیطی، برنامه Next.js را دوباره اجرا کنید.

فرانت‌های Vite قدیمی در `frontend-kolbe` و `frontend-supplier` فقط برای نگهداری باقی
مانده‌اند و در حالت توسعه، API را از برنامه Next.js روی پورت `3000` می‌گیرند.
