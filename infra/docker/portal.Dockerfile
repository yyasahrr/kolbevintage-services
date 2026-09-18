# ─────────────────────────────────────────────────────────────────────────────
# پورتال‌های Vite (تأمین‌کننده / مدیر) — خروجی استاتیک با Nginx
#
# ساخت (یکی از دو پورتال):
#   docker build -f infra/docker/portal.Dockerfile \
#     --build-arg APP_DIR=frontend-supplier --build-arg APP_NAME=kolbe-supplier-portal \
#     -t kolbe-supplier-portal .
#
# ⚠️ پورتال مدیر هنوز وجود ندارد (امروز پنل مدیر داخل SPA فروشگاه است)؛ این
# Dockerfile برای زمانی آماده است که `apps/admin-portal` استخراج شود (فاز ۷).
#
# فاز ۱.۳: اضافه شد USER nginx و HEALTHCHECK برای هم‌خوانی با api/storefront.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
ARG APP_DIR
ARG APP_NAME
WORKDIR /repo

COPY package.json package-lock.json ./
COPY frontend-supplier/package.json frontend-supplier/
COPY frontend-kolbe/package.json frontend-kolbe/
COPY frontend-next/package.json frontend-next/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
RUN npm ci --no-audit --no-fund

COPY ${APP_DIR} ${APP_DIR}
RUN npm run build --workspace ${APP_NAME}

FROM nginx:1.27-alpine AS runtime
ARG APP_DIR
COPY --from=build /repo/${APP_DIR}/dist /usr/share/nginx/html
COPY infra/nginx/portal-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
# nginx image به‌صورت پیش‌فرض master را با root و worker را با nginx اجرا می‌کند؛
# برای شفافیت و هم‌خوانی با api/storefront، کاربر غیرروت را صریح می‌کنیم.
USER nginx
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
