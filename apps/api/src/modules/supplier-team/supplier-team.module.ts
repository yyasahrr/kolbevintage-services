import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { SupplierTeamController } from "./supplier-team.controller";
import { SupplierTeamService } from "./supplier-team.service";

/**
 * ماژولِ «تیمِ تأمین‌کننده».
 *
 * پیش از فاز ۶.۲ این ماژول فقط `imports: [DatabaseModule]` داشت — یعنی یک
 * پوستهٔ خالی که در `app.module.ts` و `finance.module.ts` ثبت شده بود ولی هیچ
 * سرویس یا کنترلری نداشت. ثبتِ آن در `modules/registry.ts` هم جدولِ
 * `supplier_member` را به این ماژول نسبت می‌داد.
 *
 * اکنون سرویس و کنترلرِ supplier-facing واقعی دارد. `AuditModule` برای ثبتِ
 * رویدادهای تغییرِ عضویت لازم است (همان الگوی `SuppliersModule`).
 */
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [SupplierTeamController],
  providers: [SupplierTeamService],
  exports: [SupplierTeamService],
})
export class SupplierTeamModule {}
