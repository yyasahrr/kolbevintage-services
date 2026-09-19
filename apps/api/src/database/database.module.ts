/**
 * ماژول دیتابیس — تنها نقطهٔ ساخت اتصال.
 *
 * قاعدهٔ A7: اسکیمای Drizzle فقط از اینجا در دسترس ماژول‌ها قرار می‌گیرد.
 * هر ماژول `KOLBE_DB` را تزریق می‌کند و **نباید** خودش Pool بسازد؛ در غیر این
 * صورت تعداد اتصال‌ها با تعداد ماژول‌ها ضرب می‌شود.
 */

import { Global, Inject, Module, OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import {
  assertDatabaseReady,
  createDatabase,
  type KolbeDatabase,
  type KolbeDbHandle,
} from "@kolbe/database";

export type { KolbeDatabase, KolbeDbHandle };
import { CONFIG_TOKEN, type AppConfig } from "../config/configuration";
import { ConfigModule } from "../config/config.module";

export const KOLBE_DB = Symbol("KOLBE_DB");
export const KOLBE_DB_HANDLE = Symbol("KOLBE_DB_HANDLE");

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: KOLBE_DB_HANDLE,
      useFactory: (config: AppConfig): KolbeDbHandle =>
        createDatabase({
          connectionString: config.databaseUrl,
          max: config.database?.poolMax ?? 10,
          min: config.database?.poolMin ?? 0,
          idleTimeoutMillis: config.database?.idleTimeoutMs ?? 30000,
          connectionTimeoutMillis: config.database?.connectionTimeoutMs ?? 5000,
          statementTimeoutMillis: config.database?.statementTimeoutMs ?? 15000,
        }),
      inject: [CONFIG_TOKEN],
    },
    {
      provide: KOLBE_DB,
      useFactory: (handle: KolbeDbHandle): KolbeDatabase => handle.db,
      inject: [KOLBE_DB_HANDLE],
    },
  ],
  exports: [KOLBE_DB, KOLBE_DB_HANDLE],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(KOLBE_DB_HANDLE) private readonly handle: KolbeDbHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  /**
   * بررسی اتصال و **سازگاری اسکیما** در زمان راه‌اندازی.
   *
   * قاعدهٔ «fail fast» (گام ۱.۲): سرویسی که دیتابیس ندارد یا روی دیتابیس
   * مهاجرت‌نشده/ناقص اجرا می‌شود نباید سالم به نظر برسد و ترافیک بگیرد.
   * `assertDatabaseReady` هیچ DDL اجرا نمی‌کند؛ فقط می‌خواند و مقایسه می‌کند و در
   * صورت ناسازگاری با پیام «Database migrations are required…» بالا نمی‌آید.
   */
  async onModuleInit(): Promise<void> {
    await this.handle.pool.query("SELECT 1");
    const compatibility = await assertDatabaseReady(this.handle.pool);
    console.log(
      `[kolbe-api] دیتابیس آماده است (env=${this.config.env}، ${compatibility.applied}/${compatibility.expected} مهاجرت، ${compatibility.tables} جدول)`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
