import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { KOLBE_DB_HANDLE, type KolbeDbHandle } from "../../database/database.module";
import { CONFIG_TOKEN, type AppConfig } from "../../config/configuration";
import { Public } from "../../common/guards/session.guard";

/**
 * سلامت سرویس.
 *
 * قاعدهٔ عملیاتی: این endpoint باید ارزان باشد (بدون نوشتن، بدون Auth) و وضعیت
 * دیتابیس را واقعاً بسنجد — نه فقط بگوید «بالا هستم».
 */
@ApiTags("health")
@Controller("health")
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(KOLBE_DB_HANDLE) private readonly handle: KolbeDbHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: "سلامت سرویس و اتصال دیتابیس" })
  async health() {
    let database: "up" | "down" = "up";
    let databaseError: string | null = null;
    try {
      const started = Date.now();
      await this.handle.pool.query("SELECT 1");
      databaseError = `${Date.now() - started}ms`;
    } catch {
      database = "down";
      // پیام خطای دیتابیس به بیرون درز نمی‌کند؛ فقط وضعیت.
      databaseError = null;
    }

    return {
      ok: database === "up",
      service: "kolbe-api",
      version: 1,
      env: this.config.env,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      database: { status: database, latencyHint: databaseError },
      redis: this.config.redisUrl ? "configured" : "not_configured",
      storage: this.config.storage.bucket ? "configured" : "not_configured",
    };
  }
}
