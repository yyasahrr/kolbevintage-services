# ─────────────────────────────────────────────────────────────────────────────
# Kolbe Storefront — Next.js (فروشگاه، VIP، میزبان موقت route handler قدیمی)
#
# ⚠️ توجه: تا پایان مهاجرت (ADR-004) این کانتینر هم‌زمان فروشگاه را سرو می‌کند و
# هم مسیرهای `/store/kolbe/*` و `/admin/kolbe/*` را — یعنی بک‌اند گذار. با منتقل
# شدن هر دامنه به `kolbe-api`، مسیر مربوطه در Nginx از این upstream برداشته می‌شود
# و در پایان فاز ۷ این کانتینر فقط یک فرانت Next.js خواهد بود.
#
# ساخت:
#   docker build -f infra/docker/storefront.Dockerfile -t kolbe-storefront .
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# Kolbe Storefront — Next.js (فروشگاه، VIP، میزبان موقت route handler قدیمی)
#
# ⚠️ توجه: تا پایان مهاجرت (ADR-004) این کانتینر هم‌زمان فروشگاه را سرو می‌کند و
# هم مسیرهای `/store/kolbe/*` و `/admin/kolbe/*` را — یعنی بک‌اند گذار. با منتقل
# شدن هر دامنه به `kolbe-api`، مسیر مربوطه در Nginx از این upstream برداشته می‌شود
# و در پایان فاز ۷ این کانتینر فقط یک فرانت Next.js خواهد بود.
#
# ساخت:
#   docker build -f infra/docker/storefront.Dockerfile -t kolbe-storefront .
#
# فاز ۱.۳: این Dockerfile روی میزبان دارای Docker آزمایش نشده است (این محیط
# Docker ندارد)، اما از نظر ایستا اصلاح شد:
#   - مرحلهٔ build حالا `packages/database` و `packages/shared` را کپی می‌کند تا
#     import نسبی `../../packages/database/src/verify` در زمان build موجود باشد.
#   - مرحلهٔ runtime با `--workspaces` نصب می‌کند و `packages/database` را کامل
#     (src + dist + migrations) کپی می‌کند تا نگهبان اسکیما در زمان اجرا کار کند.
#   - `tsconfig.json` هم کپی می‌شود تا ابزارهای جانبی خطا ندهند.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY frontend-next/package.json frontend-next/
COPY frontend-supplier/package.json frontend-supplier/
COPY frontend-kolbe/package.json frontend-kolbe/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
RUN npm ci --no-audit --no-fund

# برای import نسبی `../../packages/database/src/verify` در `frontend-next/server/database.ts`
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY frontend-next frontend-next

# بیلد Next.js با ignoreBuildErrors اجرا می‌شود (تصمیم موجود پروژه)؛ اما خطاهای
# تایپ در CI با `tsc --noEmit` گرفته می‌شوند، پس این پرچم راه فرار نیست.
RUN npm run build --workspace kolbe-next

FROM node:22-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY frontend-next/package.json frontend-next/
COPY frontend-supplier/package.json frontend-supplier/
COPY frontend-kolbe/package.json frontend-kolbe/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
# نصب وابستگی‌های زمان اجرا برای همهٔ workspaceها؛ بدون این پرچم `next` پیدا نمی‌شود.
RUN npm ci --omit=dev --no-audit --no-fund --workspaces --include-workspace-root

COPY --from=build /repo/frontend-next/.next frontend-next/.next
COPY --from=build /repo/frontend-next/public frontend-next/public
COPY --from=build /repo/frontend-next/next.config.ts frontend-next/next.config.ts
COPY frontend-next/postcss.config.mjs frontend-next/postcss.config.mjs
COPY frontend-next/tsconfig.json frontend-next/tsconfig.json
COPY frontend-next/app frontend-next/app
COPY frontend-next/server frontend-next/server
COPY frontend-next/storefront frontend-next/storefront
COPY frontend-next/supplier-src frontend-next/supplier-src

# نگهبان اسکیما در زمان اجرا به این فایل‌ها نیاز دارد:
#   - `src/verify.ts` برای import نسبی قدیمی (strangler)
#   - `dist/` برای `migrate.mjs` (اگر در همین image مهاجرت اجرا شود)
#   - `migrations/` برای `resolveMigrationsDir`
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/shared/src packages/shared/src
COPY --from=build /repo/packages/database/dist packages/database/dist
COPY --from=build /repo/packages/database/src packages/database/src
COPY --from=build /repo/packages/database/migrations packages/database/migrations
COPY --from=build /repo/packages/database/migrate.mjs packages/database/migrate.mjs

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "--workspace", "kolbe-next"]
