/**
 * ریشهٔ اپلیکیشن — مونولیت ماژولار کلبه.
 *
 * ⚠️ قاعدهٔ A1: «Do not build microservices». این یک فرایند واحد است که همهٔ
 * دامنه‌ها را در خود دارد؛ مرزها **درون‌برنامه‌ای** و اجراشدنی‌اند
 * (`src/modules/registry.ts` + آزمون مرزها)، نه مرز شبکه‌ای.
 *
 * قواعد سراسری که اینجا اعمال می‌شوند:
 *  - فیلتر خطای دامنه (قرارداد پایدار `{error,message}` و عدم افشای جزئیات).
 *  - نگهبان نشست سراسری؛ هر کنترلر برای عمومی‌شدن باید صریحاً `@Public()` بزند
 *    (پیش‌فرض «بسته» است، نه «باز»).
 *  - اعتبارسنجی DTO با `class-validator` و `whitelist` (فیلد ناشناخته حذف می‌شود).
 */

import { Module, ValidationPipe } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE } from "@nestjs/core";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { DomainExceptionFilter } from "./common/filters/domain-exception.filter";
import { SessionGuard } from "./common/guards/session.guard";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { OffersModule } from "./modules/offers/offers.module";
import { SuppliersModule } from "./modules/suppliers/suppliers.module";
import { SupplierTeamModule } from "./modules/supplier-team/supplier-team.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { VipModule } from "./modules/vip/vip.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { FulfillmentModule } from "./modules/fulfillment/fulfillment.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { FinanceModule } from "./modules/finance/finance.module";
import { ShippingModule } from "./modules/shipping/shipping.module";
import { ComplianceModule } from "./modules/compliance/compliance.module";
import { InvoicingModule } from "./modules/invoicing/invoicing.module";
import { SettlementReadinessModule } from "./modules/settlement-readiness/settlement-readiness.module";
import { SettlementModule } from "./modules/settlement/settlement.module";
import { RatingsModule } from "./modules/ratings/ratings.module";
import { AdminModule } from "./modules/admin/admin.module";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    // ماژول‌های دامنه؛ ترتیب بر اساس فاز نقشهٔ مهاجرت ثبت می‌شود، نه وابستگی فنی.
    HealthModule,
    AuditModule,
    AuthModule,
    CatalogModule,
    OffersModule,
    SuppliersModule,
    SupplierTeamModule,
    InventoryModule,
    VipModule,
    OrdersModule,
    FulfillmentModule,
    PaymentsModule,
    ShippingModule,
    ComplianceModule,
    InvoicingModule,
    FinanceModule,
    SettlementReadinessModule,
    SettlementModule,
    RatingsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_GUARD, useClass: SessionGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        // فیلدهای ارسالی خارج از DTO حذف می‌شوند (جلوگیری از Mass Assignment).
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        // مبالغ و شناسه‌ها نباید بی‌سروصدا به نوع دیگری تبدیل شوند.
        transformOptions: { enableImplicitConversion: false },
      }),
    },
  ],
})
export class AppModule {}
