# ممیزی معماری و سیستم طراحی کلبه وینتیج

## هدف محصول

یک هویت کاربری واحد برای چهار تجربه: فروشگاه عمومی، خریدار VIP، تأمین‌کننده و مدیر. هر نقش پوسته و ناوبری متناسب با کار خود دارد، اما هویت برند، توکن‌های بصری، وضعیت‌های تعاملی و قراردادهای داده مشترک‌اند.

## معماری هدف

```text
Kolbe Platform
├── Storefront (عمومی و مشتری عادی)
├── VIP Workspace (خریدار عمده)
├── Supplier Workspace (تأمین و تولید)
├── Admin Control Room (فروشگاه و عمده)
└── Platform Services
    ├── Supabase Auth (هویت واحد)
    ├── PostgreSQL + RLS (مالکیت و نقش‌ها)
    ├── Product / Variant / Inventory
    ├── Wholesale Orders
    └── Supplier Operations
```

## قرارداد طراحی مشترک

- رنگ پایه: `#071c31`، پس‌زمینه گرم `#f7f5f0`، سطح `#fcfbf8` و accent مرجانی `#c9654d`.
- radius کنترل ۱۰px و سطح ۱۶px؛ pill فقط برای وضعیت‌های کوتاه.
- سایه فقط برای overlay؛ سلسله‌مراتب صفحات عملیاتی با border، spacing و typography.
- focus یکسان و قابل‌دیدن، active با جابه‌جایی ۱px، motion بین ۱۸۰ تا ۲۶۰ms.
- تیترهای متعادل، متن خوانا، اعداد tabular و وضعیت همراه متن؛ رنگ تنها نشانه نیست.

## ایرادهای بحرانی کشف‌شده

| اولویت | ایراد | اثر | وضعیت |
|---|---|---|---|
| P0 | احراز هویت ادمین با sessionStorage و credential محلی | امکان دورزدن کنترل نقش | رفع شد؛ نشست و نقش از Supabase بازیابی می‌شود |
| P0 | عملیات چندمرحله‌ای سفارش بدون تراکنش اتمیک | احتمال ثبت سفارش بدون آیتم در خطای شبکه | باز؛ انتقال ثبت سفارش به RPC تراکنشی |
| P1 | داده نمایشی و localStorage در بخش‌هایی از ادمین و پشتیبانی VIP | تفاوت رفتار دمو و محصول واقعی | باز؛ باید repositoryهای واقعی جایگزین شوند |
| P1 | کامپوننت‌های دامنه‌ای بسیار بزرگ | coupling، رندر و تست سخت | باز؛ شکستن براساس feature |
| P1 | قرارداد سفارش VIP و purchase order ساپلایر دو مدل جدا دارد | قطع زنجیره خریدار تا تأمین‌کننده | باز؛ workflow تبدیل سفارش تأییدشده به PO لازم است |
| P2 | رنگ و radius پراکنده در JSX/CSS | drift بصری | لایه توکن مشترک ایجاد شد؛ مهاجرت تدریجی باقی است |
| P2 | swallowed error در بارگذاری ساپلایر | صفحه با داده قدیمی بدون هشدار | باز؛ error boundary و retry لازم است |
| P2 | وابستگی‌های `latest` در پنل ساپلایر | build غیرقابل‌تکرار | باز؛ pin نسخه‌ها و lockfile |
| P2 | bundle اصلی بزرگ و بدون code splitting | شروع کند روی موبایل | باز؛ lazy route برای admin/VIP/editor |

## مرزهای پیشنهادی کد

```text
src/
├── app/                 # router, providers, role shells
├── design-system/       # tokens, primitives, states
├── features/
│   ├── auth/
│   ├── catalog/
│   ├── wholesale-orders/
│   ├── supplier-products/
│   └── admin-operations/
├── entities/            # typed domain models
└── lib/supabase/        # clients and repositories
```

## برنامه اصلاح مرحله‌ای

1. امنیت و یکپارچگی داده: RPC تراکنشی سفارش، حذف کامل auth محلی، RLS و audit log.
2. قرارداد دامنه: یک state machine برای Product، WholesaleOrder و PurchaseOrder.
3. استخراج design-system: Button/Input/Status/Surface/PageHeader/EmptyState.
4. مهاجرت صفحات نقش‌ها به primitives مشترک و حذف hexهای تکراری.
5. شکستن فایل‌های بزرگ و lazy loading مسیرهای عملیاتی.
6. تست E2E نقش‌محور: مشتری → VIP → سفارش → ادمین → ساپلایر.

## معیار اتمام

- هیچ credential یا مجوزی در کلاینت hardcode نباشد.
- هیچ صفحه عملیاتی بدون loading، error، empty، disabled و mobile state نباشد.
- همه تغییرات سفارش/موجودی از API واقعی و تراکنش اتمیک عبور کنند.
- هر نقش فقط ردیف‌های مجاز خود را با RLS ببیند.
- contrast، focus و keyboard navigation در CI تست شوند.
- buildها با نسخه‌های pin‌شده و بدون warning بحرانی تکرارپذیر باشند.
