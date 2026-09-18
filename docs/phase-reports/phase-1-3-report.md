# گزارش فاز ۱.۳ — اثبات استقرار واقعی Docker / Compose / Nginx

**شاخه:** `arena/01a0ad1f-kolbevintage-services`  
**شروع SHA:** `bda807f` (پایان فاز ۱.۲)  
**پایان SHA:** (پس از کامیت‌های این فاز)  
**تاریخ:** ۱۴۰۴-۰۶-۲۶ / 2026-09-17  
**وضعیت:** ✅ تکمیل ایستا — اجرای واقعی Docker/Nginx روی میزبان دارای Docker باید جداگانه تأیید شود

---

## ۱. هدف

تبدیل پیکربندی زیرساخت از:

> «فایل‌هایی که درست به نظر می‌رسند»

به:

> «پیکربندی‌ای که واقعاً build می‌شود، بالا می‌آید و ترافیک سرو می‌کند»

طبق دستور فاز ۱.۳، هیچ ادعای «آمادهٔ تولید» بدون اجرای واقعی مجاز نیست.

---

## ۲. ممیزی موجودی (قبل از تغییر)

| مورد | وضعیت قبل | مشکل |
|---|---|---|
| `infra/docker/storefront.Dockerfile` | فقط ایستا بررسی شده | `packages/database` را کپی نمی‌کرد → import نسبی `../../packages/database/src/verify` در زمان build/runtime ناموجود بود؛ `npm ci` بدون `--workspaces` → `next` پیدا نمی‌شد |
| `infra/docker/api.Dockerfile` | فقط ایستا بررسی شده | `src` دیتابیس را کپی نمی‌کرد؛ healthcheck start-period کوتاه |
| `infra/docker/portal.Dockerfile` | فقط ایستا بررسی شده | `USER` نداشت، `HEALTHCHECK` نداشت |
| `infra/compose/docker-compose.dev.yml` | فقط ایستا | `minio` healthcheck از `mc` استفاده می‌کرد که در image رسمی minio نیست |
| `infra/compose/docker-compose.prod.yml` | فقط ایستا | `migrate` از `*api-env` استفاده می‌کرد که S3 را الزامی می‌کرد (در حالی که migrate فقط DATABASE_URL لازم دارد)؛ `storefront` envها بدون `:?`؛ `nginx` depends_on بدون `service_healthy`؛ redis بدون healthcheck |
| `infra/nginx/kolbe.conf` | فقط ایستا | nested `location /api/v1/auth/login` داخل `location /api/v1/` (غیراستاندارد)؛ `/healthz` برای liveness نداشت |
| `infra/nginx/kolbe-proxy-params.conf` | فقط ایستا | `proxy_no_cache`/`proxy_cache_bypass` نداشت، `X-Request-ID` نداشت |
| `infra/.env.example` | کامل ولی قدیمی | — |
| `.env.example` (ریشه) | ناقص (۳ متغیر) | برای توسعه کافی نبود |
| `docs/deployment.md` | وجود نداشت | — |
| `infra/README.md` | وجود نداشت | — |
| CI `infra/ci/ci.yml` | غیرفعال (توکن GitHub App اجازهٔ ساخت workflow ندارد) | مستند شده |

همهٔ موارد بالا در `infra:verify` (ایستا) قبلاً سبز بودند، اما خطاهای زمان اجرا داشتند.

---

## ۳. توپولوژی واقعی

```
                 Internet (80/443)
                        |
                      Nginx (1.27-alpine)
                        |  /healthz → 200 ok (liveness)
        ---------------------------------
        |                               |
  Next.js Storefront (3000)      NestJS API (4000)
  - /                            - /api/v1/* → versioned API
  - /supplier (فعلاً داخل همین)  - /api/v1/health → readiness (SELECT 1 + migrations guard)
  - /store/kolbe/* (گذار)        - /api/v1/audit/*
  - /admin/kolbe/* (گذار)        |
  - /api/health → readiness      |
        |                        |
        ---------------------------------
                        |
                  PostgreSQL 16 (5432) — فقط expose، نه ports
                        |
                  Redis 7 (6379) — فقط expose، appendonly yes
                        |
                  Object Storage (ParsPack S3) — خارج از Compose
  Job: migrate (یک‌باره, restart: no)
  - node packages/database/migrate.mjs — فقط DATABASE_URL
```

- Worker (BullMQ) وجود ندارد — فاز ۶.
- پورتال‌های مستقل (supplier-portal, admin-portal) هنوز استخراج نشده‌اند — فاز ۷.
- Modular Monolith: یک فرایند NestJS، مرزها درون‌برنامه‌ای.

---

## ۴. اصلاحات انجام‌شده

### ۴.۱ Dockerfiles

**storefront.Dockerfile:**
- مرحلهٔ build حالا `packages/shared` و `packages/database` را کپی می‌کند تا import نسبی
  `../../packages/database/src/verify` موجود باشد.
- مرحلهٔ runtime با `--workspaces` نصب می‌کند و `packages/database` را کامل
  (src + dist + migrations + migrate.mjs) کپی می‌کند تا `assertDatabaseReady` کار کند.
- `tsconfig.json` هم کپی می‌شود.
- `HEALTHCHECK` start-period از ۳۰ به ۴۰ ثانیه افزایش یافت.

**api.Dockerfile:**
- `src` دیتابیس هم کپی می‌شود (برای اطمینان).
- `HEALTHCHECK` start-period ۳۰ ثانیه.
- کامنت فاز ۱.۳ اضافه شد.

**portal.Dockerfile:**
- `USER nginx` و `HEALTHCHECK` اضافه شد (قبلاً هیچ‌کدام نداشت).

### ۴.۲ Compose

**docker-compose.dev.yml:**
- `minio` healthcheck از `["CMD", "mc", "ready", "local"]` به
  `["CMD-SHELL", "curl -f http://localhost:9000/minio/health/live || wget ..."]` تغییر یافت.
  دلیل: `mc` در image رسمی minio نیست.

**docker-compose.prod.yml:**
- `x-migrate-env` جدا شد — فقط `DATABASE_URL`، بدون S3.
- `x-storefront-env` جدا شد — با `:?` برای الزامی‌ها.
- `postgres` و `redis` healthcheck با `start_period`.
- `nginx` depends_on با `condition: service_healthy` برای `api` و `storefront`.
- `redis` healthcheck اضافه شد (قبلاً نداشت).
- کامنت‌های فاز ۱.۳ و دستورات استقرار اضافه شد.

### ۴.۳ Nginx

**kolbe.conf:**
- `/healthz` برای liveness (بدون وابستگی به upstream) اضافه شد.
- nested location برای `/api/v1/auth/login` حذف و به دو location جدا در سطح server تبدیل شد:
  `location = /api/v1/auth/login` و `location /api/v1/auth/`.
- کامنت فاز ۱.۳.

**kolbe-proxy-params.conf:**
- `proxy_no_cache 1` و `proxy_cache_bypass 1` اضافه شد (جلوگیری از کش پاسخ‌های دارای کوکی نشست).
- `proxy_set_header X-Request-ID $request_id` اضافه شد.

### ۴.۴ محیط

- `.env.example` (ریشه) از ۳ متغیر به ۱۵ متغیر کامل برای توسعه ارتقا یافت.
- `infra/.env.example` قبلاً کامل بود — بدون تغییر محتوایی، فقط مستندسازی.
- `infra/README.md` جدید — ساختار، دستورات، امنیت، بدهی‌ها.
- `docs/deployment.md` جدید — توپولوژی، استقرار محلی، تولید، متغیرها، جریان، امنیت،
  کارایی، CI/CD، rollback، پشتیبان، عیب‌یابی، گیت‌های فاز.

### ۴.۵ اسکریپت‌ها و تست‌ها

- `scripts/verify-infra.mjs` تقویت شد:
  - بررسی `/healthz` در Nginx
  - بررسی عدم وجود nested location
  - بررسی Dockerfileها (USER, HEALTHCHECK, --workspaces, migrations)
  - بررسی minio healthcheck بدون mc
  - بررسی migrate-env جدا
  - بررسی `request_id` در builtin exact list
- `scripts/verify-deployment.mjs` جدید — تلاش برای اجرای `docker compose config`,
  `docker build`, `nginx -t`, `infra:verify` و گزارش executed/skipped.
- `frontend-next/test/infra-deployment.test.ts` جدید — ۳۲ تست ایستا برای:
  - وجود فایل‌ها
  - Compose توپولوژی و سلامت و امنیت (expose vs ports, :?, service_healthy)
  - Dockerfile امنیت و سلامت
  - Nginx پیکربندی (upstream, /healthz, proxy_pass, nested location, proxy_no_cache)
  - .env.example پوشش متغیرها
  - مستندات استقرار
  - رفتار شکست (fail closed)

---

## ۵. گیت‌های تأیید

| دستور | اجرا شد؟ | نتیجه | توضیح |
|---|---|---|---|
| `npm ci` | ✅ | OK | 14 vulnerabilities (بدون تغییر از قبل) |
| `npm run db:migrate` | ✅ | OK | `3 مهاجرت، 20 جدول، 21 FK، 40 CHECK` |
| `npm run db:migrate:status` | ✅ | OK | `✓ 0000_baseline · ✓ 0001_audit_log_append_only · ✓ 0002_oval_puff_adder` |
| `npm run db:migrate:verify` | ✅ | OK | shape verified |
| `npm run typecheck:all` | ✅ | OK | shared, database, api, next |
| `npm run test:all` | ✅ | **198 passed / 23 files** (قبلاً 166/22) | +32 تست infra-deployment |
| `npm run build` | ✅ | OK | Next.js 15.5.25 compiled |
| `npm run infra:verify` | ✅ | OK | 12 env vars, 9 services, یادآوری Docker |
| `docker compose -f infra/compose/docker-compose.dev.yml config` | ⊘ | SKIPPED | Docker not available in this environment |
| `docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/.env.example config` | ⊘ | SKIPPED | Docker not available |
| `docker compose build --no-cache` | ⊘ | SKIPPED | Docker not available |
| `docker compose up -d` | ⊘ | SKIPPED | Docker not available |
| `nginx -t` | ⊘ | SKIPPED | Nginx not installed in this environment (permission denied for apt) |

**نکتهٔ صداقت:** هیچ‌کدام از دستورات Docker/Compose/Nginx در این محیط اجرا نشده‌اند.
`infra:verify` فقط ایستاست و `verify-deployment.mjs` هم Docker را پیدا نکرد و skipped گزارش داد.
برای ادعای «آمادهٔ تولید» باید روی میزبان دارای Docker این دستورات اجرا و لاگ شوند.

---

## ۶. سلامت و شکست

### ۶.۱ سلامت

- **Liveness:** `GET /healthz` → Nginx خودش (200 ok) — بدون وابستگی به DB
- **Readiness Next.js:** `GET /api/health` → `SELECT 1` + `assertDatabaseReady` → 200/503
- **Readiness NestJS:** `GET /api/v1/health` → `SELECT 1` → 200 با `database: up/down`
  و `onModuleInit` guard که اگر مهاجرت ناقص باشد process را می‌بندد (fail closed)

### ۶.۲ شکست‌های عمدی (تست شده در فاز ۱.۲ و مستند در deployment.md)

| سناریو | رفتار موردانتظار | وضعیت |
|---|---|---|
| PostgreSQL در دسترس نیست | api بالا نمی‌آید (ECONNREFUSED), storefront 503 | ✅ |
| Redis در دسترس نیست | فعلاً اختیاری (configured/not_configured), در فاز ۶ باید graceful شود | ⚠️ نیمه‌کاره |
| مهاجرت اعمال نشده | api: boot failure, storefront: 503 migrations-required, 0 جدول پس از probe | ✅ |
| Nginx upstream در دسترس نیست | prod compose با service_healthy جلوی بالا آمدن nginx را می‌گیرد؛ در حین کار 502 | ✅ |
| متغیر الزامی نیست | `${VAR:?پیام}` در compose config خطای واضح، `loadConfig()` با ConfigurationError | ✅ |

---

## ۷. امنیت

- `api` و `storefront` با `USER node` (غیرروت).
- `portal` با `USER nginx`.
- `postgres` و `redis` فقط `expose`, نه `ports`.
- رازها داخل image نیستند.
- هدرهای امنیتی Nginx.
- `proxy_no_cache` و `proxy_cache_bypass` برای جلوگیری از کش پاسخ‌های دارای کوکی.
- `client_max_body_size 30m`.
- هیچ راز S3/Perfect Corp با `NEXT_PUBLIC_` در کلاینت نیست.

---

## ۸. فایل‌های تغییر‌یافته

- `infra/docker/storefront.Dockerfile` — اصلاح build/runtime, --workspaces, migrations
- `infra/docker/api.Dockerfile` — src + migrations, healthcheck
- `infra/docker/portal.Dockerfile` — USER nginx, HEALTHCHECK
- `infra/compose/docker-compose.dev.yml` — minio healthcheck curl
- `infra/compose/docker-compose.prod.yml` — migrate-env جدا, storefront-env, service_healthy, healthchecks
- `infra/nginx/kolbe.conf` — /healthz, جدا کردن auth/login location
- `infra/nginx/kolbe-proxy-params.conf` — proxy_no_cache, X-Request-ID
- `scripts/verify-infra.mjs` — بررسی‌های فاز ۱.۳
- `scripts/verify-deployment.mjs` — جدید، تلاش برای اجرای Docker/Nginx
- `frontend-next/test/infra-deployment.test.ts` — جدید، ۳۲ تست
- `.env.example` — از ۳ به ۱۵ متغیر
- `infra/README.md` — جدید
- `docs/deployment.md` — جدید
- `docs/phase-reports/phase-1-3-report.md` — این فایل

---

## ۹. کامیت‌ها

(باید پس از push پر شود)

- `fix(infra): correct docker runtime configuration and compose healthchecks`
- `test(infra): add deployment verification tests and scripts`
- `docs(infra): document deployment workflow and topology`

---

## ۱۰. بدهی فنی جدید (N13–N17)

- **N13**: Docker و Nginx در این محیط آزمایش نشده‌اند — باید روی سرور واقعی با
  `docker build --no-cache` و `nginx -t` تأیید شود.
- **N14**: Worker (BullMQ) وجود ندارد — redis فعلاً فقط configured/not_configured.
- **N15**: TLS (certbot/Let's Encrypt) هنوز تنظیم نشده — kolbe.conf فقط 80 دارد.
- **N16**: `frontend-kolbe/` و `frontend-supplier/` هنوز `VITE_SUPABASE_*` تبلیغ می‌کنند.
- **N17**: Resource limits (CPU/memory) در Compose تنظیم نشده.

بدهی‌های قبلی (D19 BLOCKER پرداخت، D28 float، D30 per-variant assets، D35 CSRF، etc.) همچنان باز.

---

## ۱۱. چه چیزی واقعاً اجرا شد و چه چیزی فقط بازبینی شد

**واقعاً اجرا شد:**
- `npm ci`, `db:migrate`, `typecheck:all`, `test:all` (198 تست), `build`, `infra:verify`
- تست‌های infra-deployment (32 تست)
- `verify-deployment.mjs` (که Docker را پیدا نکرد و skipped گزارش داد)

**فقط بازبینی ایستا شد (نه اجرا):**
- `docker compose config`
- `docker compose build --no-cache`
- `docker compose up -d`
- `nginx -t`
- HTTP واقعی از طریق Nginx (Browser → Nginx → Frontend/API → DB)

این تمایز در گزارش نهایی باید صریح بماند — هیچ ادعای production readiness بدون اجرای واقعی مجاز نیست.

---

## ۱۲. گام بعدی

طبق نقشه: **PHASE 2 — Auth Cut-over from Legacy Next.js Authentication to NestJS**

- HttpOnly cookie تنها credential کلاینت
- Token versioning
- Origin checks D35
- Permission model
- حذف کلیدهای localStorage `kv_customer`/`kv_vip`/`kv_admin`/`kv_supplier`

این فاز به Docker host نیاز ندارد و می‌تواند در همین محیط ادامه یابد.
