# Kolbe Vintage Platform

پلتفرم کامل کلبه وینتیج — **لایه یکپارچه Next.js** روی **موتور بک‌اند Medusa v2 (Node/TypeScript)**:

```text
kolbevintage-services/
├── frontend-next/      ← ⭐ لایه یکپارچه Next.js: فروشگاه + پورتال ساپلایر + API بک‌اند (پورت ۳۰۰۰)
├── backend/            ← بک‌اند (Medusa v2، Node/TS): API کلبه + API ساپلایر + دیتابیس واحد (پورت ۹۰۰۰)
├── frontend-kolbe/     ← فرانت Vite قدیمی فروشگاه (نگهداری‌شده؛ مسیر اصلی از این پس Next.js است)
├── frontend-supplier/  ← فرانت Vite قدیمی ساپلایر (نگهداری‌شده)
├── docs/               ← ADR، رودمپ و ممیزی معماری
└── scripts/            ← dev-all (اجرای کل استک) + pg (PostgreSQL امبدد)
```

## معماری

```text
مرورگر
  │
  ▼
Next.js (پورت ۳۰۰۰)  ← کل پروژه از اینجا بالا میآید
  ├── /                    فروشگاه کلبه (SPA با روتر هش‌محور)
  ├── /supplier            پورتال ساپلایر
  ├── /store/kolbe/*       ← لایه API بک‌اند (route handlerهای Next.js)
  ├── /admin/kolbe/*       ←   که درخواستها را به موتور Medusa فوروارد میکنند
  └── /api/health          سلامت استک
  │
  ▼ (سرور → سرور؛ بدون CORS در مرورگر)
Medusa v2 (پورت ۹۰۰۰) — Node/TypeScript
  └── PostgreSQL امبدد (پورت ۵۴۳۲)
```

> **بک‌اند Node/TypeScript می‌ماند.** لایه Next.js فقط درِ ورودی API است: هدر Origin را حذف
> می‌کند، پاسخها را با ACAO برمی‌گرداند و اگر موتور پایین باشد ۵۰۲ با کد NETWORK میدهد.
> منطق تجاری (۵ ماژول سفارشی، فلوفها، زرینپال) همان Medusa است.

## اجرا — کل استک با یک دستور

```bash
npm install        # همه workspaces + باینریهای PostgreSQL امبدد

cd backend && cp .env.example .env   # DATABASE_URL + JWT_SECRET (اگر هنوز نیست)
npm install
cd ..

npm run dev        # ↑ PostgreSQL + Medusa + Next.js همه با هم
```

خروجی `npm run dev`:
- اگر دیتابیس تازه باشد، خودش `medusa db:setup` و seed را هم اجرا می‌کند.
- خرابی هر بخش مانع بقیه نمیشود (فروشگاه مستقل از بک‌اند بالا میآید).

### اجزا به‌صورت جدا

```bash
npm run dev:next       # فقط فرانت Next.js (پورت ۳۰۰۰)
npm run dev:api        # فقط بک‌اند Medusa (پورت ۹۰۰۰)
npm run pg ensure      # فقط PostgreSQL امبدد
npm run seed           # seed دامنه (ادمین/VIP/ساپلایر/کاتالوگ/سفارش نمونه)
npm run build          # بیلد production فرانت Next.js
```

## نقشه URLs (dev)

| بخش | آدرس |
|---|---|
| فروشگاه کلبه | http://localhost:3000 |
| پنل ادمین کلبه | http://localhost:3000/#/admin |
| پورتال VIP عمده | http://localhost:3000/#/vip |
| پورتال ساپلایر | http://localhost:3000/supplier |
| API بک‌اند (از طریق Next) | http://localhost:3000/store/kolbe/health |
| موتور Medusa + ادمین انگلیسی | http://localhost:9000 (+ /app) |
| سلامت استک | http://localhost:3000/api/health |
| فرانت Vite قدیمی (اختیاری) | npm run dev:kolbe (۵۱۷۳) / npm run dev:supplier (۵۱۷۴) |

حسابهای seed: ادمین `admin@kolbe.ir / KolbeAdmin1404!` — VIP `vip@boutique.ir / VipPass1404!` — ساپلایر `nilgoon@kolbe.ir / SupplierPass1404!`

> حالت پیش‌نمایش پنل‌ها فعلاً فعال است (`frontend-next/storefront/previewMode.ts`) — برای بازگرداندن ورود امن، مقدار را `false` کنید.

> کلید publishable در دیتابیس باید با مقدار فرانت یکی باشد
> (`pk_8f89ce…3604ee`). seed این کلید را روی کلید پیشفرض دیتابیس ست میکند.

## متغیرهای محیطی لایه Next.js (`frontend-next`)

| متغیر | پیشفرض | توضیح |
|---|---|---|
| `MEDUSA_URL` | `http://127.0.0.1:9000` | آدرس موتور Medusa برای route handlerها |
| `NEXT_PUBLIC_KOLBE_API` | (خالی = همان origin) | اگر API جای دیگری باشد |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | کلید seed | کلید publishable فروشگاه |

## تصمیمهای معماری

- `docs/adr/ADR-001-medusa-backend.md` — چرا Medusa v2 به‌جای Supabase
- `docs/adr/ADR-002-nextjs-layer.md` — لایه یکپارچه Next.js روی موتور Medusa
