# Kolbe Vintage Platform

پلتفرم یکپارچه کلبه وینتیج با **Next.js 15** و **PostgreSQL**.

```text
مرورگر
  └── Next.js :3000
      ├── /                    فروشگاه
      ├── /supplier            پورتال تأمین‌کننده
      ├── /admin               پنل مدیریت کلبه + مدیریت عمده‌فروشی
      ├── /vip · /wholesale*   پورتال VIP و عمده‌فروشی
      ├── /api/v1/*  ────────► NestJS API :4000   (مسیر قانونی / canonical)
      └── /store/kolbe/*       پروکسی سازگاری (compat)
                                   └── PostgreSQL :55432
```

> **دو فرایند، نه یکی.** قابلیت‌های قانونی (`/api/v1/*`) توسط NestJS روی پورت
> `4000` سرو می‌شوند. `npm run dev` فقط Next.js را بالا می‌آورد؛ برای API باید
> `npm run dev:api` را جداگانه اجرا کنید.

## اجرا

```bash
npm install
cp .env.example .env      # یک‌بار؛ بدون این فایل پروکسی /api/v1 فعال نمی‌شود
npm run db:migrate        # صریح و الزامی — زمان اجرا اسکیما نمی‌سازد
npm run dev               # PostgreSQL (embedded) + build پکیج‌ها + Next.js :3000
npm run dev:api           # در ترمینال جداگانه: NestJS :4000
```

`npm run dev` (یعنی `scripts/dev-all.mjs`) سه کار می‌کند: دیتابیس محلی embedded را
با `scripts/pg.mjs ensure` آماده می‌کند، پکیج‌های `@kolbe/shared` و `@kolbe/database`
را می‌سازد، و سپس Next.js را روی پورت `3000` اجرا می‌کند. **NestJS API را بالا
نمی‌آورد.**

> ⚠️ **زمان اجرا هیچ DDL نمی‌سازد.** اگر دیتابیس مهاجرت‌نشده باشد، نگهبانِ اسکیما
> **fail closed** عمل می‌کند و `503 SERVICE_UNAVAILABLE` برمی‌گرداند — نه `500` و
> نه ساخت خودکار جدول. این یک قاعدهٔ معماری است، نه یک محدودیت: تنها مرجع اسکیما
> `packages/database/src/verify.ts` به‌همراه مهاجرت‌های forward-only است.
> آزمونِ `frontend-next/test/schema-authority.test.ts` همین رفتار را اثبات می‌کند.

> ⚠️ **`KOLBE_API_INTERNAL_URL` باید هنگام *شروع* Next تنظیم باشد.** اگر نباشد،
> rewrite پروکسی `/api/v1` فعال نمی‌شود و آن مسیرها به routehandler عمومی
> `[[...slug]]` می‌افتند؛ یعنی پاسخ **`200` با HTML** دریافت می‌کنید، نه خطا.
> برای همین بررسی سلامت را با `content-type` انجام دهید، نه فقط کد وضعیت.
> هیچ پورت/میزبانی در کد hardcode نشده؛ همه‌چیز از `.env` می‌آید.

برای اجرای فرانت روی پورت دیگر:

```bash
npm exec --workspace kolbe-next -- next dev -H 0.0.0.0 -p 3001
```

## آدرس‌ها

| بخش | آدرس |
|---|---|
| فروشگاه | http://localhost:3000 |
| پنل مدیریت کلبه + عمده‌فروشی | http://localhost:3000/admin |
| پورتال VIP | http://localhost:3000/vip |
| عمده‌فروشی (عمومی) | http://localhost:3000/wholesale |
| پورتال تأمین‌کننده | http://localhost:3000/supplier |
| سلامت Next | http://localhost:3000/api/health |
| سلامت API قانونی | http://localhost:4000/api/v1/health |

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
