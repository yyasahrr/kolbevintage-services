# ─────────────────────────────────────────────────────────────────────────────
# Kolbe API — موتور NestJS (مونولیت ماژولار)
#
# ساخت چندمرحله‌ای: مرحلهٔ اول همهٔ workspaceها را نصب و پکیج‌های مشترک را می‌سازد،
# مرحلهٔ دوم فقط artefactهای لازم را کپی می‌کند. چون `@kolbe/api` به پکیج‌های
# workspace (`@kolbe/shared` و `@kolbe/database`) وابسته است، ترتیب ساخت مهم است:
# shared → database → api.
#
# ساخت:
#   docker build -f infra/docker/api.Dockerfile -t kolbe-api .
#
# فاز ۱.۳: این Dockerfile از نظر ایستا بازبینی شد؛ در این محیط Docker وجود ندارد
# اما خطاهای شناخته‌شده (نصب workspace، مسیر مهاجرت‌ها) اصلاح شد.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /repo

# فقط مانیفست‌ها اول کپی می‌شوند تا لایهٔ نصب در صورت تغییر کد دوباره ساخته نشود.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY frontend-next/package.json frontend-next/
COPY frontend-supplier/package.json frontend-supplier/
COPY frontend-kolbe/package.json frontend-kolbe/

# `npm ci` روی همهٔ workspaceها کار می‌کند؛ پکیج‌های غیرمرتبط هم نصب می‌شوند که
# برای سادگی و درستی قفل نسخه‌ها پذیرفته شده است (بدهی: prune هدف‌دار در فاز ۶).
RUN npm ci --no-audit --no-fund

COPY packages/shared packages/shared
COPY packages/database packages/database
COPY apps/api apps/api

RUN npm run build --workspace @kolbe/shared \
 && npm run build --workspace @kolbe/database \
 && npm run build --workspace @kolbe/api

FROM node:22-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# dumb-init برای فوروارد دقیق سیگنال‌های SIGTERM و SIGINT به عنوان PID 1
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
 && rm -rf /var/lib/apt/lists/*

# فقط وابستگی‌های زمان اجرا.
#
# ⚠️ همهٔ مانیفست‌های workspace کپی می‌شوند، نه فقط آن‌هایی که اجرا می‌شوند:
# ریشهٔ مخزن مسیرهایی مانند `frontend-next` را صریحاً در `workspaces` اعلام کرده
# است و `npm ci` اگر پوشهٔ آن‌ها نباشد شکست می‌خورد (globها این‌طور نیستند، اما
# مسیرهای صریح هستند).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY frontend-next/package.json frontend-next/
COPY frontend-supplier/package.json frontend-supplier/
COPY frontend-kolbe/package.json frontend-kolbe/
RUN npm ci --omit=dev --no-audit --no-fund --workspaces --include-workspace-root

# artefactهای لازم برای اجرا و مهاجرت
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/database/dist packages/database/dist
COPY --from=build /repo/packages/database/src packages/database/src
COPY --from=build /repo/packages/database/migrations packages/database/migrations
COPY --from=build /repo/packages/database/migrate.mjs packages/database/migrate.mjs
COPY --from=build /repo/apps/api/dist apps/api/dist

# اجرا با کاربر غیرروت — فایل‌ها readable هستند، نیازی به chown نیست اما برای
# شفافیت از کاربر node استفاده می‌کنیم.
USER node
EXPOSE 4000

# سلامت کانتینر: /api/v1/health خودش SELECT 1 می‌زند؛ اگر دیتابیس قطع باشد
# orchestrator سرویس را جایگزین می‌کند. start-period برای مهاجرت و اتصال اولیه.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/main.js"]
