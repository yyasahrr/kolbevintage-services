# استقرار کلبه وینتیج — راهنمای عملیاتی (فاز ۱.۳)

> وضعیت: **فاز ۱.۳ — اثبات استقرار واقعی**
> این سند از فایل‌های `infra/compose/*.yml` و `infra/nginx/*.conf` و `infra/.env.example`
> استخراج شده و روی میزبان دارای Docker باید آزمایش شود. در محیط ساخت فعلی (این
> مخزن) Docker و Nginx نصب نیستند، پس `infra:verify` فقط بازبینی ایستاست.

---

## ۱. توپولوژی اجرا

```text
                 Internet (80/443)
                        |
                      Nginx (1.27-alpine)
                        |
        ---------------------------------
        |                               |
  Next.js Storefront (3000)      NestJS API (4000)
  - /                            - /api/v1/*
  - /supplier (فعلاً داخل همین)  - /api/v1/health
  - /store/kolbe/* (گذار)        - /api/v1/audit/*
  - /admin/kolbe/* (گذار)        |
  - /api/health                  |
        |                        |
        ---------------------------------
                        |
                  PostgreSQL 16 (5432)
                  - فقط در شبکهٔ داخلی Compose
                        |
                  Redis 7 (6379)
                  - cache / BullMQ / blacklist نشست
                        |
                  Object Storage (ParsPack S3)
                  - خارج از Compose، S3-compatible

  Job: migrate (یک‌باره)
  - node packages/database/migrate.mjs
  - باید پیش از api و storefront موفق شود
```

**نکته‌ها:**
- Worker (BullMQ) هنوز وجود ندارد — فاز ۶. فعلاً صف‌ها در کد نیستند.
- پورتال‌های مستقل (supplier-portal, admin-portal) هنوز استخراج نشده‌اند — فاز ۷.
  امروز هر دو داخل `frontend-next` سرو می‌شوند و در `kolbe.conf` به upstream
  `storefront` مسیر شده‌اند.
- Modular Monolith: یک فرایند NestJS همهٔ دامنه‌ها را دارد، مرزها درون‌برنامه‌ای‌اند.

---

## ۲. استقرار محلی (توسعه)

### ۲.۱ پیش‌نیاز

- Node.js 22
- npm 10+
- Docker + Docker Compose (برای postgres/redis/minio) — اختیاری، چون `scripts/pg.mjs`
  با embedded-postgres هم کار می‌کند.

### ۲.۲ اجرای زیرساخت محلی

```bash
# فقط postgres/redis/minio را با Docker بالا بیاور (پورت‌ها با embedded-postgres تعارض ندارند)
docker compose -f infra/compose/docker-compose.dev.yml up -d

# یا بدون Docker: از embedded-postgres استفاده کن
npm run pg   # postgres://postgres:postgres@127.0.0.1:55432/kolbe

# بررسی سلامت
docker compose -f infra/compose/docker-compose.dev.yml ps
```

پورت‌ها:
- postgres: `55433:5432` (تا با `55432` embedded تعارض نداشته باشد)
- redis: `6379:6379`
- minio: `9000:9000` (S3 API) و `9001:9001` (کنسول)

### ۲.۳ مهاجرت دیتابیس

```bash
# از صفر:
npm run db:migrate

# وضعیت:
npm run db:migrate:status
# ✓ 0000_baseline
# ✓ 0001_audit_log_append_only
# ✓ 0002_oval_puff_adder

# فقط بررسی سازگاری (بدون اجرای مهاجرت):
npm run db:migrate:verify

# ارتقای دیتابیس‌های قدیمی (ساخته‌شده با DDL زمان‌اجرا):
npm run db:adopt-legacy
```

قاعدهٔ A21: `packages/database/migrations` تنها مرجع اسکیماست. کد زمان اجرا هیچ‌وقت
`CREATE/ALTER/DROP` نمی‌زند؛ فقط `assertDatabaseReady()` می‌خواند و اگر ناسازگار
بود با `503`/`MIGRATIONS_NOT_APPLIED` می‌بندد.

### ۲.۴ اجرای اپلیکیشن‌ها

```bash
# همه با هم (postgres + next + api)
npm run dev

# یا جداگانه:
npm run dev:next   # http://localhost:3000
npm run dev:api    # http://localhost:4000/api/v1/health
```

### ۲.۵ سلامت

```bash
curl http://localhost:3000/api/health
# {"ok":true,"service":"kolbe-vintage","runtime":"nextjs","database":{"engine":"postgresql","status":"up","detail":"query ok"}}

curl http://localhost:4000/api/v1/health
# {"ok":true,"service":"kolbe-api","version":1,"database":{"status":"up"}}
```

اگر دیتابیس مهاجرت‌نشده باشد:

```bash
# next: 503 {"ok":false,"database":{"status":"down","detail":"migrations-required"}}
# api:  اصلاً بالا نمی‌آید — لاگ: "Database migrations are required..."
```

---

## ۳. استقرار تولید (ParsPack Cloud Server)

### ۳.۱ پیش‌نیاز سرور

- Ubuntu 22.04+ / Debian 12+
- Docker Engine + Compose v2
- دامنه تنظیم‌شده (مثلاً `kolbe.ir`)
- فایل `infra/.env` (از `infra/.env.example` کپی و پر شده)

### ۳.۲ متغیرهای محیطی الزامی

| متغیر | توضیح | نمونه |
|---|---|---|
| `POSTGRES_USER` | کاربر postgres داخل کانتینر | `kolbe` |
| `POSTGRES_PASSWORD` | رمز postgres — قوی، تصادفی | `openssl rand -base64 32` |
| `POSTGRES_DB` | نام دیتابیس | `kolbe` |
| `DATABASE_URL` | رشتهٔ اتصال کامل (داخل Compose: `postgres:5432`) | `postgres://kolbe:...@postgres:5432/kolbe` |
| `KOLBE_SESSION_SECRET` | امضای توکن نشست — حداقل ۳۲ کاراکتر | `openssl rand -base64 48` |
| `KOLBE_ALLOWED_ORIGINS` | CORS — لیست دامنه‌های مجاز با کاما | `https://kolbe.ir,https://www.kolbe.ir` |
| `REDIS_URL` | آدرس Redis داخلی | `redis://redis:6379` |
| `S3_ENDPOINT` | آدرس S3 ParsPack | `https://s3.parspack.com` |
| `S3_BUCKET` | نام باکت | `kolbe-media` |
| `S3_ACCESS_KEY` | کلید دسترسی S3 | — |
| `S3_SECRET_KEY` | کلید محرمانه S3 | — |
| `S3_REGION` | ریجن (معمولاً `default`) | `default` |
| `PERFECT_CORP_API_KEY` | کلید پرو مجازی لباس (اختیاری) | — |

همهٔ متغیرهای بالا در `infra/.env.example` مستند شده‌اند. `infra:verify` بررسی می‌کند
که هر `${VAR}` استفاده‌شده در Compose در `.env.example` وجود داشته باشد.

### ۳.۳ جریان استقرار تولید

```text
1. backup
   ↓
2. pull release (git pull / image pull)
   ↓
3. run migrations (migrate job)
   ↓
4. restart containers (api, storefront, nginx)
   ↓
5. health checks
   ↓
6. traffic verification (curl از داخل و بیرون)
```

دستورات:

```bash
# ۱. پشتیبان
docker compose -f infra/compose/docker-compose.prod.yml exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB | gzip > backup-$(date +%F).sql.gz

# ۲. دریافت نسخهٔ جدید
git pull origin arena/01a0ad1f-kolbevintage-services
# یا اگر imageها از registry می‌آیند:
docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/.env pull

# ۳. اعتبارسنجی Compose
docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/.env config

# ۴. مهاجرت (به‌صورت job یک‌باره)
docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/.env up migrate
# لاگ باید: "دفتر مهاجرت از قبل وجود دارد؛ پذیرش لازم نیست." یا "مهاجرت‌ها با موفقیت اعمال شدند"

# ۵. بالا آوردن سرویس‌ها
docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/.env up -d

# ۶. سلامت
docker compose -f infra/compose/docker-compose.prod.yml ps
curl -f http://localhost/api/v1/health
curl -f http://localhost/api/health
curl -f http://localhost/healthz   # nginx خودش

# ۷. لاگ‌ها
docker compose -f infra/compose/docker-compose.prod.yml logs -f api storefront nginx
```

### ۳.۴ Nginx و TLS

- `infra/nginx/kolbe.conf` نقطهٔ کنترل مهاجرت (strangler) است.
- هر دامنه‌ای که در NestJS به هم‌ارزی می‌رسد، فقط یک `location` از `storefront`
  به `kolbe_api` منتقل می‌شود.
- TLS با certbot/Let's Encrypt روی همین سرور اضافه می‌شود (گام جداگانهٔ عملیاتی):

```bash
# نمونه (باید روی سرور واقعی اجرا شود):
certbot --nginx -d kolbe.ir -d www.kolbe.ir
# سپس در kolbe.conf: listen 443 ssl; و مسیر certها
```

اعتبارسنجی پیکربندی:

```bash
docker compose -f infra/compose/docker-compose.prod.yml exec nginx nginx -t
# یا روی هاست اگر nginx نصب است:
nginx -t -c $(pwd)/infra/nginx/kolbe.conf
```

---

## ۴. ترتیب راه‌اندازی و مدیریت خطا

| سناریو | رفتار موردانتظار | وضعیت فعلی |
|---|---|---|
| **PostgreSQL در دسترس نیست** | `api` بالا نمی‌آید (log: `ECONNREFUSED`), `storefront` → `503 migrations-required` یا `query-failed`. هیچ دادهٔ خرابی ایجاد نمی‌شود. | ✅ تست شده (embedded-postgres خاموش + `DATABASE_URL` اشتباه) |
| **Redis در دسترس نیست** | `api` اگر `REDIS_URL` تنظیم شده باشد و قطع باشد، باید gracefully خطا بدهد؛ فعلاً فقط `configured/not_configured` در health نشان می‌دهد و اتصال Redis اختیاری است (هنوز صف نداریم). `storefront` وابسته به Redis نیست. | ⚠️ نیمه‌کاره — Redis هنوز اختیاری است، در فاز ۶ باید fail gracefully مستند شود |
| **مهاجرت اعمال نشده** | `api`: `onModuleInit` → `DatabaseNotMigratedError` → process.exit(1) → Compose restart. `storefront`: `/api/health` → `503` با `detail: migrations-required`، لاگ سرور شامل جزئیات (۱۹ جدول گم‌شده). هیچ DDL خودکاری انجام نمی‌شود. | ✅ تست شده (DB خالی `kolbe_unmigrated` → ۰ جدول پس از probe) |
| **Nginx upstream در دسترس نیست** | اگر `api` یا `storefront` unhealthy باشند، `nginx` با `depends_on: condition: service_healthy` بالا نمی‌آید (در prod compose). اگر در حین کار قطع شوند، `502 Bad Gateway` با لاگ upstream. | ✅ در prod compose با `service_healthy` اصلاح شد |
| **متغیر محیطی الزامی نیست** | `${VAR:?پیام}` در Compose باعث خطای واضح در `docker compose config` می‌شود؛ `loadConfig()` در NestJS با `ConfigurationError` و لیست مشکلات بالا نمی‌آید. | ✅ تست شده |

---

## ۵. امنیت

- کانتینرهای `api` و `storefront` با کاربر غیرروت (`USER node`) اجرا می‌شوند.
- `postgres` و `redis` فقط `expose` دارند، نه `ports` — از بیرون قابل دسترسی نیستند.
- رمزها داخل image نیستند؛ فقط از `infra/.env` (که commit نمی‌شود) می‌آیند.
- هدرهای امنیتی Nginx: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: strict-origin-when-cross-origin`.
- کوکی نشست `HttpOnly; SameSite=Lax` است و پاسخ‌ها با `proxy_no_cache` و `proxy_cache_bypass`
  از کش‌شدن محافظت می‌شوند.
- `client_max_body_size 30m` سقف آپلود را محدود می‌کند (سرور ۲۵ مگابایت چک می‌کند).
- هیچ راز S3 یا Perfect Corp با پیشوند `NEXT_PUBLIC_` در کلاینت افشا نمی‌شود.

---

## ۶. کارایی و پایداری

- **منابع:** postgres و redis از volumeهای نام‌دار استفاده می‌کنند (`kolbe-postgres`, `kolbe-redis`).
- **سلامت:** همهٔ سرویس‌ها `healthcheck` دارند (postgres: `pg_isready`, redis: `redis-cli ping`,
  api/storefront: `fetch /health`, nginx: `/healthz`).
- **راه‌اندازی:** `start_period` برای api/storefront ۳۰–۴۰ ثانیه تا مهاجرت و build اولیه تمام شود.
- **خاموشی نرم:** Node.js به `SIGTERM` گوش می‌دهد؛ NestJS `onApplicationShutdown` اتصال DB را می‌بندد.
  Compose با `stop_grace_period` پیش‌فرض ۱۰ ثانیه، درخواست‌های فعال را قطع نمی‌کند اگر
  `keepalive` درست باشد.
- **زمان بیلد:** `npm ci` با لایه‌بندی Dockerfile (manifest اول، کد بعد) cache می‌شود.

---

## ۷. CI/CD

- فایل `infra/ci/ci.yml` در مسیر `infra/ci/` نگه داشته شده چون توکن فعلی GitHub App اجازهٔ
  ساخت workflow را ندارد (`refusing to allow a GitHub App to create or update workflow`).
- فعال‌سازی:

```bash
mkdir -p .github/workflows
cp infra/ci/ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: activate GitHub Actions workflow"
```

- این workflow شامل ۵ job است: `infra` (بازبینی ایستای Compose/Nginx), `shared`, `database`,
  `api`, `storefront`. همه با `embedded-postgres` و بدون نیاز به سرویس جانبی اجرا می‌شوند.
- تا زمانی که روی Docker host اجرا نشود، `docker build` و `nginx -t` واقعی تست نمی‌شوند.

---

## ۸. محدودیت‌های بازگشت و پشتیبان

- **مهاجرت‌ها forward-only هستند** — هیچ `down` migration وجود ندارد (قاعدهٔ A21).
  بازگشت فقط با restore از backup ممکن است.
- **پشتیبان قبل از هر استقرار الزامی است:**

```bash
docker compose -f infra/compose/docker-compose.prod.yml exec postgres pg_dump -U kolbe kolbe | gzip > backup.sql.gz
```

- **rollback اپلیکیشن** (بدون تغییر اسکیما) با `git checkout <previous-tag>` و
  `docker compose up -d --build` ممکن است، ولی اگر migration جدیدی اعمال شده باشد،
  کد قدیمی با اسکیمای جدید ممکن است ناسازگار باشد — باید با `compareShape` بررسی شود.

---

## ۹. عیب‌یابی

| علامت | دلیل محتمل | اقدام |
|---|---|---|
| `api` در حلقهٔ restart | `DATABASE_URL` اشتباه یا مهاجرت ناقص | `docker logs kolbe-api-*` → باید `Database migrations are required` یا `ECONNREFUSED` ببینید |
| `storefront` → `503 migrations-required` | DB خالی یا `migrate` موفق نشده | `docker compose up migrate` را دوباره اجرا کنید، سپس `db:migrate:status` |
| `nginx` بالا نمی‌آید `host not found in upstream` | سرویس متناظر در Compose وجود ندارد | `infra:verify` را اجرا کنید؛ `kolbe.conf` فقط به `api` و `storefront` اشاره کند |
| `502 Bad Gateway` از Nginx | `api` یا `storefront` unhealthy | `docker ps` و `docker logs` را چک کنید؛ health endpointها را مستقیم curl کنید |
| `KOLBE_SESSION_SECRET` خطا در prod | طول کمتر از ۳۲ کاراکتر | `openssl rand -base64 48` و در `.env` جایگزین کنید |
| MinIO healthcheck fails | `mc` در image نیست (قبلاً) | به `curl -f http://localhost:9000/minio/health/live` تغییر داده شد (فاز ۱.۳) |

---

## ۱۰. دستورات بازبینی (گیت‌های فاز ۱.۳)

```bash
npm ci
npm run db:migrate
npm run typecheck:all
npm run test:all
npm run build
npm run infra:verify

# روی میزبان دارای Docker (در این محیط موجود نیست — باید روی سرور واقعی اجرا شود):
docker compose -f infra/compose/docker-compose.dev.yml config
docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/.env config
docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/.env build --no-cache
docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/.env up -d
docker compose -f infra/compose/docker-compose.prod.yml exec nginx nginx -t
curl -f http://localhost/healthz
curl -f http://localhost/api/v1/health
curl -f http://localhost/api/health
```

نتیجهٔ هر دستور باید در گزارش فاز ۱.۳ ثبت شود: اجرا شد یا نه، نتیجه، دلیل skip.

---

## ۱۱. بدهی فنی باقی‌مانده در حوزهٔ infra (فاز ۱.۳ به بعد)

- **N13**: Docker و Nginx در این محیط آزمایش نشده‌اند — باید روی سرور واقعی با
  `docker build --no-cache` و `nginx -t` تأیید شود.
- **N14**: Worker (BullMQ) وجود ندارد — `redis` فعلاً فقط `configured/not_configured`
  در health نشان می‌دهد؛ در فاز ۶ باید صف‌ها و رفتار قطع Redis مستند و تست شود.
- **N15**: TLS (certbot/Let's Encrypt) هنوز تنظیم نشده — `kolbe.conf` فقط `80` دارد.
- **N16**: `frontend-kolbe/` و `frontend-supplier/` هنوز `VITE_SUPABASE_*` در
  `.env.example` تبلیغ می‌کنند — بدهی Supabase sweep list.
- **N17**: Resource limits (CPU/memory) در Compose تنظیم نشده — برای تولید باید
  `deploy.resources.limits` اضافه شود.

---

## ۱۲. ارجاعات

- `docs/database-migrations.md` — تنها راه تغییر اسکیما
- `docs/architecture/master-architecture-rules.md` — A21: مرجع واحد اسکیما
- `docs/architecture/prompt-1-audit-and-migration-blueprint.md` — نقشهٔ فازها
- `infra/.env.example` — نمونهٔ متغیرهای محیطی
- `infra/compose/docker-compose.prod.yml` — توپولوژی تولید
- `infra/nginx/kolbe.conf` — نقطهٔ کنترل strangler
