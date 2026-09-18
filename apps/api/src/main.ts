/**
 * نقطهٔ ورود بک‌اند کلبه (NestJS).
 *
 * وضعیت در نقشهٔ مهاجرت: **فاز ۱ — اسکلت.** این سرویس امروز فقط `/api/v1/health`
 * و `/api/v1/audit/*` را سرو می‌کند و هیچ ترافیکی از آن عبور نمی‌کند؛ مسیرهای زندهٔ
 * محصول هنوز در route handler قدیمی Next.js هستند. مسیرها یکی‌یکی و پس از
 * عبور آزمون هم‌ارزی، در Nginx به این سرویس منتقل می‌شوند (ADR-004).
 *
 * قواعد رعایت‌شده:
 *  - نسخه‌بندی از روز اول: پیشوند سراسری `/api/v1` (قاعدهٔ API).
 *  - پیکربندی نامعتبر ⇒ بالا نیامدن سرویس (fail-closed)، نه اجرا با مقدار پیش‌فرض.
 *  - `0.0.0.0` برای اجرا در کانتینر و پیش‌نمایش محیط توسعه.
 */

import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ConfigurationError, loadConfig } from "./config/configuration";
import { API_PREFIX, setupOpenApi } from "./openapi";

async function bootstrap() {
  const logger = new Logger("Bootstrap");

  // پیکربندی پیش از ساخت اپلیکیشن اعتبارسنجی می‌شود تا خطا واضح و زودهنگام باشد.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  app.setGlobalPrefix(API_PREFIX);

  // CORS فقط برای مبدأهای مجاز؛ در تولید اگر تنظیم نشده باشد، هیچ مبدأیی مجاز نیست
  // (فروشگاه same-origin نیازی به CORS ندارد و پورتال‌ها با Nginx سرو می‌شوند).
  app.enableCors({
    origin: config.allowedOrigins.length ? config.allowedOrigins : false,
    credentials: true,
    allowedHeaders: ["content-type", "authorization", "idempotency-key", "x-request-id"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  setupOpenApi(app);

  await app.listen(config.port, "0.0.0.0");
  logger.log(`کلبه API روی http://0.0.0.0:${config.port}/${API_PREFIX} (env=${config.env})`);
  logger.log(`مستندات OpenAPI: http://0.0.0.0:${config.port}/${API_PREFIX}/docs`);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger("Bootstrap");
  if (error instanceof ConfigurationError) {
    logger.error(error.message);
  } else {
    logger.error(`راه‌اندازی سرویس شکست خورد: ${error instanceof Error ? error.message : String(error)}`);
  }
  // خروج با کد ناموفق تا orchestrator/Compose سرویس را دوباره راه‌اندازی کند.
  process.exit(1);
});
