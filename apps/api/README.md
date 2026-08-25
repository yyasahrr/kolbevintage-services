# Kolbe API (Medusa v2)

بک‌اند تجارت کلبه بر پایه **Medusa v2** — طبق تصمیم `docs/adr/ADR-001-medusa-backend.md` جایگزین تدریجی Supabase میشود. منطق کسبوکار ثابت است: پنل ساپلایر، خرید عمده VIP و تأمین بازار عمده توسط ساپلایرها تغییر نمیکند؛ فقط بستر اجرای آن از RPCهای Supabase به ماژولها و workflowهای مدوسا منتقل میشود.

> **وضعیت:** اسکلت فاز ۰ (scaffold). این پکیج عمداً هنوز به `workspaces` ریشه اضافه نشده تا `npm install` رینه سبک بماند؛ با شروع فاز ۱ اضافه کنید.

## راهاندازی

```bash
# پیشنیاز: PostgreSQL در دسترس (می توانید از همان دیتابیس Supabase یک dump بگیرید)
cp .env.example .env.local
npm install            # داخل همین پوشه
npx medusa migrations create
npx medusa migrations run
npm run dev            # http://localhost:9000 + /app
```

## نقشه دامنه ثابت → مدوسا

| دامنه ثابت (Supabase فعلی) | معادل مدوسا | وضعیت |
|---|---|---|
| `suppliers` | ماژول سفارشی `supplier` | اسکلت آماده |
| `purchase_orders` + `purchase_order_items` | ماژول سفارشی `purchase_order` | اسکلت آماده |
| کاتالوگ + `product_variants` + `inventory` | ماژولهای native محصول/موجودی + stock location به ازای هر ساپلایر | فاز ۲ |
| `wholesale_accounts` + `wholesale_orders` | B2B Starter (شرکت‌ها، لیست قیمت، سبد خرید تأیید...) | فاز ۳ |
| `rfqs` + `quotes` | فلوی Quote در B2B Starter | فاز ۳ |
| `support_tickets` | ماژول سفارشی یا سرویس جانبی | فاز ۴ |
| درگاه بانکی ایرانی | Payment Provider اختصاصی | فاز ۴ |
| Auth کاربران/ادمین | Auth Module + API keys | فاز ۲-۳ |

## قانون طلایی مهاجرت

تا خاموشی کامل Supabase، هیچ فیچر جدیدی روی بک‌اند Supabase ساخته نمیشود (همه چیزِ جدید در همین پکیج). فرانت‌اند ها (فروشگاه و پنل ساپلایر) دست نخورده باقی میمانند و مرحلهبهمرحزه به Store/Admin API مدوسا وصل میشوند.

فازبندی کامل: `docs/roadmap.md`
