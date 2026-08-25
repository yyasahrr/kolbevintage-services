# Kolbe Vintage Platform

پلتفرم کامل کلبه وینتیج روی **Medusa v2** — چهار بخش مستقل و تمیز:

```text
kolbevintage-services/
├── backend/            ← بک‌اند (Medusa v2): API کلبه + API ساپلایر + دیتابیس واحد
├── frontend-kolbe/     ← فرانت کلبه: فروشگاه، پنل ادمین، پورتال VIP، استودیوی هیرو
├── frontend-supplier/  ← فرانت ساپلایر: پنل عملیات تأمین‌کننده
├── docs/               ← ADR، رودمپ و ممیزی معماری
└── scripts/            ← ابزارهای توسعه
```

> **چرا بک‌اند یکی است و نه دو تا؟** زنجیره «ساپلایر → کلبه → VIP» یک دیتابیس و یک منطق مشترک دارد؛
> دو بک‌اند جدا یعنی دو دیتابیس و شکستن زنجیره سفارش. داخل `backend` اما سرویس‌ها کاملاً جدا هستند:
> APIهای ساپلایر زیر `/store/kolbe/supplier/*` و APIهای کلبه (فروشگاه/ادمین/VIP) زیر `/store/kolbe/*`.

## اجرا

```bash
npm install                # فرانت‌ها (workspaces)

# بک‌اند (Medusa)
cd backend && cp .env.example .env   # DATABASE_URL + JWT_SECRET
npm install
npx medusa db:setup --db kolbe_medusa --no-interactive --execute-safe-links
npx medusa develop                   # http://localhost:9000
node scripts/seed.mjs                # داده اولیه + تست E2E کل زنجیره

# فرانت‌ها (از ریشه)
npm run dev              # فرانت کلبه: http://localhost:5173
npm run dev:supplier     # فرانت ساپلایر: http://localhost:5174
```

**میان‌بر:** پنل ساپلایر از روی همون سرور فرانت کلبه هم در دسترس است: **`/supplier.html`** — بدون نیاز به سرور دوم.

## نقشه URLs (dev)

| بخش | آدرس |
|---|---|
| فروشگاه کلبه | http://localhost:5173 |
| پنل ادمین کلبه | http://localhost:5173/#/admin |
| پورتال VIP عمده | http://localhost:5173/#/vip |
| پنل ساپلایر | http://localhost:5173/supplier.html یا http://localhost:5174 |
| API مدوسا + ادمین انگلیسی | http://localhost:9000 (+ /app) |

حسابهای seed: ادمین `admin@kolbe.ir / KolbeAdmin1404!` — VIP `vip@boutique.ir / VipPass1404!` — ساپلایر `nilgoon@kolbe.ir / SupplierPass1404!`

> حالت پیش‌نمایش پنل‌ها فعلاً فعال است (`frontend-kolbe/src/previewMode.ts`) — برای بازگرداندن ورود امن، مقدار را `false` کنید.
