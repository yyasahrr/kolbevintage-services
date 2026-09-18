import { Global, Module } from "@nestjs/common";
import { CONFIG_TOKEN, loadConfig } from "./configuration";

/**
 * ماژول پیکربندی — سراسری.
 *
 * `loadConfig` در زمان ساخت provider اجرا می‌شود؛ اگر متغیرهای محیطی نامعتبر
 * باشند، اپلیکیشن بالا نمی‌آید (fail-closed) و پیام دقیق می‌دهد.
 */
@Global()
@Module({
  providers: [
    {
      provide: CONFIG_TOKEN,
      useFactory: () => loadConfig(),
    },
  ],
  exports: [CONFIG_TOKEN],
})
export class ConfigModule {}
