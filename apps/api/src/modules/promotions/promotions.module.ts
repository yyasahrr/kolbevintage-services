import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { AdminModule } from "../admin/admin.module";
import { RecoveryModule } from "../recovery/recovery.module";
import { CatalogModule } from "../catalog/catalog.module";
import { OffersModule } from "../offers/offers.module";
import { VipModule } from "../vip/vip.module";
import { CrmModule } from "../crm/crm.module";
import { PromotionService } from "./promotion.service";
import { PromotionRevisionService } from "./promotion-revision.service";
import { PromotionEligibilityService } from "./promotion-eligibility.service";
import { PromotionEvaluationService } from "./promotion-evaluation.service";
import { CouponService } from "./coupon.service";
import { PromotionUsageService } from "./promotion-usage.service";
import { PromotionScheduleService, PromotionScheduleRunner } from "./promotion-schedule.service";
import { PromotionFactsService } from "./promotion-facts.service";
import { PromotionsAdminController } from "./promotions.controller";

@Module({
  imports: [DatabaseModule, AuditModule, AdminModule, RecoveryModule, CatalogModule, OffersModule, VipModule, CrmModule],
  controllers: [PromotionsAdminController],
  providers: [
    PromotionService,
    PromotionRevisionService,
    PromotionEligibilityService,
    PromotionEvaluationService,
    CouponService,
    PromotionUsageService,
    PromotionScheduleService,
    PromotionScheduleRunner,
    PromotionFactsService,
  ],
  exports: [PromotionService, PromotionRevisionService, PromotionEligibilityService, PromotionEvaluationService, CouponService, PromotionUsageService, PromotionScheduleService],
})
export class PromotionsModule {}
