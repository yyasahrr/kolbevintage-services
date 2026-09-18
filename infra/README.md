# زیرساخت کلبه — Docker / Compose / Nginx

این پوشه همهٔ مصنوعات استقرار را دارد. **فاز ۱.۳** آن‌ها را از «فایل‌هایی که درست
به نظر می‌رسند» به «پیکربندی‌ای که واقعاً build و اجرا می‌شود» تبدیل کرد — تا حدی
که در محیط بدون Docker ممکن است.

> برای راهنمای عملیاتی کامل: `docs/deployment.md`

## ساختار

```
infra/
├── compose/
│   ├── docker-compose.dev.yml   # توسعه: postgres, redis, minio (بدون api/storefront/nginx)
│   └── docker-compose.prod.yml  # تولید: postgres, redis, migrate, api, storefront, nginx
├── docker/
│   ├── api.Dockerfile           # NestJS API (modular monolith)
│   ├── storefront.Dockerfile    # Next.js Storefront (شامل route handler گذار)
│   └── portal.Dockerfile        # آینده: پورتال‌های Vite (فاز ۷)
├── nginx/
│   ├── kolbe.conf               # نقطهٔ کنترل strangler — همهٔ locationها
│   ├── kolbe-proxy-params.conf  # پارامترهای مشترک proxy
│   └── portal-spa.conf          # پیکربندی SPA برای پورتال‌های آینده
├── ci/
│   └── ci.yml                   # GitHub Actions — باید به .github/workflows/ منتقل شود
└── .env.example                 # نمونهٔ متغیرهای محیطی تولید
```

## توپولوژی

```
Internet → Nginx (80) → storefront (3000) / api (4000) → postgres (5432) + redis (6379) → S3
```

- `migrate` job یک‌باره پیش از `api` و `storefront` اجرا می‌شود.
- `postgres` و `redis` فقط `expose` دارند، نه `ports` — از بیرون دیده نمی‌شوند.
- Worker (BullMQ) هنوز وجود ندارد — فاز ۶.

## دستورات

```bash
# توسعه
docker compose -f infra/compose/docker-compose.dev.yml up -d
docker compose -f infra/compose/docker-compose.dev.yml ps
docker compose -f infra/compose/docker-compose.dev.yml logs -f

# تولید — اعتبارسنجی
docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/.env config

# تولید — مهاجرت و بالا آوردن
docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/.env up migrate
docker compose -f infra/compose/docker-compose.prod.yml --env-file infra/.env up -d

# سلامت
curl http://localhost/healthz
curl http://localhost/api/health
curl http://localhost/api/v1/health

# Nginx
docker compose -f infra/compose/docker-compose.prod.yml exec nginx nginx -t

# بازبینی ایستا (بدون نیاز به Docker)
npm run infra:verify
```

## متغیرهای محیطی

همه در `infra/.env.example` مستند شده‌اند. الزامی‌ها با `${VAR:?پیام}` در Compose
چک می‌شوند و نبودشان باعث خطای واضح در `docker compose config` می‌شود.

- `DATABASE_URL` — داخل Compose: `postgres://kolbe:...@postgres:5432/kolbe`
- `KOLBE_SESSION_SECRET` — حداقل ۳۲ کاراکتر، `openssl rand -base64 48`
- `KOLBE_ALLOWED_ORIGINS` — در تولید اجباری
- `S3_*` — ParsPack Object Storage
- `REDIS_URL` — `redis://redis:6379` داخل Compose

## امنیت

- `api` و `storefront` با `USER node` (غیرروت) اجرا می‌شوند.
- رازها داخل image نیستند.
- هدرهای امنیتی Nginx: `nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`.
- `proxy_no_cache` و `proxy_cache_bypass` برای پاسخ‌های دارای کوکی نشست.

## بدهی‌ها

- Docker و Nginx در محیط CI فعلی آزمایش نمی‌شوند — باید روی سرور واقعی با
  `docker build --no-cache` و `nginx -t` تأیید شود (N13).
- TLS هنوز تنظیم نشده (N15).
- Resource limits در Compose تنظیم نشده (N17).

## ارجاعات

- `docs/deployment.md` — راهنمای کامل استقرار
- `docs/database-migrations.md` — مهاجرت‌ها
- `docs/architecture/master-architecture-rules.md` — A21
