/**
 * نقطهٔ ورود بک‌اند کلبه (NestJS) — فاز ۴.۹ سخت‌سازی تولید.
 *
 * قواعد رعایت‌شده:
 *  - نسخه‌بندی از روز اول: پیشوند سراسری `/api/v1` (قاعدهٔ API).
 *  - پیکربندی نامعتبر یا رازهای ضعیف ⇒ بالا نیامدن سرویس (fail-closed).
 *  - پیکربندی trust proxy برای شناسایی صحیح IP کلاینت در پشت پراکسی معتمد.
 *  - محدودسازی سقف حجم Payload برای جلوگیری از حملات DoS مبتنی بر حافظه.
 *  - پاک‌سازی لاگ‌ها و جلوگیری از چاپ رازها.
 */

import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import * as express from "express";
import { AppModule } from "./app.module";
import { ConfigurationError, loadConfig, toSafeConfig } from "./config/configuration";
import { API_PREFIX, setupOpenApi } from "./openapi";

async function bootstrap() {
  const logger = new Logger("Bootstrap");

  // پیکربندی پیش از ساخت اپلیکیشن اعتبارسنجی می‌شود تا خطا واضح و زودهنگام باشد.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, {
    logger: ["log", "warn", "error"],
    bodyParser: false, // کنترل دستی سقف حجم بدنه
  });

  // اعمال سقف حجم بدنه برای جلوگیری از سرریز حافظه
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));

  // پیکربندی Trust Proxy برای دریافت آدرس کلاینت در Nginx/Cloud
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set("trust proxy", config.trustProxy);

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

  // فعال‌سازی shutdown hooks برای تخلیه امن اتصالات (Graceful Draining on SIGTERM/SIGINT)
  app.enableShutdownHooks();

  await app.listen(config.port, "0.0.0.0");
  logger.log(`کلبه API روی http://0.0.0.0:${config.port}/${API_PREFIX} (env=${config.env})`);
  logger.log(`مستندات OpenAPI: http://0.0.0.0:${config.port}/${API_PREFIX}/docs`);
  logger.log(`پیکربندی امن اولیه: ${JSON.stringify(toSafeConfig(config))}`);
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
