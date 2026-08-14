# Kolbe Vintage — داشبورد عملیات عمده‌فروشی B2B

## قاعده طلایی دامنه

```
VIP Customer  ↔  Kolbe Vintage  ↔  Supplier
```

مشتری VIP هرگز مستقیماً با تأمین‌کننده در ارتباط نیست. تأمین‌کننده شریک داخلی تأمین کلبه
وینتیج است و در هیچ نمای مشتری‌محور نمایش داده نمی‌شود.

جداسازی‌های اجباری که در کد و UI رعایت شده‌اند:

```
Customer Order   ≠  Supplier Fulfillment
Customer Payment ≠  Supplier Settlement
Order Total      ≠  Supplier Payable

1 Order → N Fulfillment Requests → N Supplier Settlements
```

## معماری کد

```
src/
  App.tsx                     روتر هش: #/store → فروشگاه دمو، بقیه → داشبورد
  StorefrontApp.tsx           دموی قبلی MR MARVIS (حفظ‌شده، بدون تغییر عملکرد)
  dashboard/
    DashboardApp.tsx          شل اپ: سایدبار، تاپ‌بار، فیلترها، کشو، پالت فرمان
    state.tsx                 Context: dataset، index، filtered، KPIs
    nav.ts                    ۱۲ مسیر سایدبار
    domain/
      types.ts                مدل کامل دامنه (۱۷ موجودیت)
      generate.ts             تولید داده قطعی (seeded PRNG) نسبت به زمان اجرا
      filters.ts              فیلترهای سراسری + سریال‌سازی در URL
      labels.ts               برچسب‌ها و رنگ‌بندی وضعیت‌ها
      selectors.ts            ایندکس‌ها و همه aggregationها (memoized)
    components/
      primitives.tsx          MetricCard, StatusBadge, TrendIndicator, MoneyValue, …
      DataTable.tsx           جدول با مرتب‌سازی، صفحه‌بندی و حالت کارتی موبایل
      charts.tsx              Recharts + نمودارهای SVG سفارشی (قیف و SLA)
      modules.tsx             ماژول‌های قابل استفاده مجدد داشبورد
      GlobalFilters.tsx       ۸ فیلتر سراسری + ۸ پریست تاریخ
      OrderDetailDrawer.tsx   ۹ بخش جزئیات سفارش + خط زمانی
      CommandPalette.tsx      ⌘K / Ctrl+K
      Sidebar.tsx / Topbar.tsx
    pages/                    ۱۲ صفحه کامل
    lib/                      format (تومان، تقویم دوگانه)، useHashRoute، useTheme
tests/dashboard.spec.ts       ۱۵ تست Playwright (دسکتاپ + موبایل)
```

## داده نمونه

در زمان اجرا نسبت به تاریخ سیستم تولید می‌شود؛ با seed ثابت، بنابراین در هر بارگذاری
یکسان است:

| مورد | مقدار |
|---|---|
| بازه | ۱۲۰ روز |
| سفارش‌ها | ۱۴۰ |
| تأمین‌کنندگان | ۱۲ |
| مشتریان VIP | ۲۶ |
| محصولات | ۶۰ (۱۸۰ واریانت) |
| کاتالوگ‌ها | ۶ |
| نرخ اختلاف | ~۷٪ |

## قواعد کسب‌وکار

- **SLA**: پذیرش ≤ ۶ ساعت · آماده‌سازی ≤ ۴۸ ساعت · ارسال ≤ ۷۲ ساعت
- **بازرسی**: ۷۲ ساعت ثابت پس از تحویل کامل
- **کمیسیون**: پلکانی ۸–۱۲٪ بر مبنای حجم و تأمین‌کننده
- **فرمول تسویه**:
  ```
  Supplier Payable = Fulfilled Order Amount
                   − Kolbe Vintage Commission
                   − Refunds
                   − Damage Adjustments
                   − Other Authorized Adjustments
  ```
- **امتیاز عملکرد تأمین‌کننده**: وزن یکسان ۲۵٪ برای پذیرش، سرعت پذیرش، ارسال به‌موقع و کیفیت
- **مقایسه دوره‌ای**: دوره قبلی هم‌طول بلافاصله قبل از بازه انتخابی

## رابط کاربری

- فارسی + RTL، ارقام لاتین، واحد تومان
- تقویم دوگانه: میلادی + شمسی در همه تاریخ‌ها
- تم روشن / تیره / سیستم (پیش‌فرض: سیستم) با `color-scheme` روی `<html>`
- همه وضعیت‌ها در URL منعکس می‌شوند (`#/orders?preset=90d&supplier=sup-3&order=ord-12`)
- کارت‌های KPI کلیک‌پذیر و متصل به صفحات مرتبط
- موبایل: فیلترها در کشوی جمع‌شونده، جدول‌ها به کارت تبدیل می‌شوند

## اجرا

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc strict، بدون unused
npm run build      # خروجی تک‌فایلی dist/index.html
npm test           # Playwright (نیازمند نصب مرورگر: npx playwright install chromium)
```

> در سندباکس فعلی دانلود مرورگر Playwright به دلیل محدودیت شبکه ممکن نبود؛ تست‌ها نوشته
> شده و روی محیطی با دسترسی اینترنت با `npx playwright install chromium` اجرا می‌شوند.
