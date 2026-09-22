import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AdminModule } from "../admin/admin.module";
import { AuditModule } from "../audit/audit.module";
import { CatalogModule } from "../catalog/catalog.module";
import { CrmModule } from "../crm/crm.module";
import { OffersModule } from "../offers/offers.module";
import { PricingModule } from "../pricing/pricing.module";
import { RecoveryModule } from "../recovery/recovery.module";
import { VipModule } from "../vip/vip.module";
import { AdminPromotionsController } from "./admin-promotions.controller";
import { PromotionApprovalService } from "./promotion-approval.service";
import { PROMOTION_FACTS_PROVIDER } from "./promotions.contract";
import { PromotionOwnerFactsProvider } from "./promotion-facts.provider";
import { PromotionCouponService } from "./promotion-coupon.service";
import { PromotionEligibilityService } from "./promotion-eligibility.service";
import { PromotionEvaluationService } from "./promotion-evaluation.service";
import { PromotionScheduler, PromotionSchedulerService } from "./promotion-scheduler.service";
import { PromotionService } from "./promotion.service";
import { PromotionUsageService } from "./promotion-usage.service";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    AdminModule,
    RecoveryModule,
    PricingModule,
    CatalogModule,
    OffersModule,
    VipModule,
    CrmModule,
  ],
  controllers: [AdminPromotionsController],
  providers: [
    PromotionApprovalService,
    PromotionService,
    PromotionCouponService,
    PromotionEligibilityService,
    PromotionEvaluationService,
    PromotionUsageService,
    PromotionSchedulerService,
    PromotionScheduler,
    PromotionOwnerFactsProvider,
    { provide: PROMOTION_FACTS_PROVIDER, useExisting: PromotionOwnerFactsProvider },
  ],
  exports: [
    PromotionApprovalService,
    PromotionService,
    PromotionCouponService,
    PromotionEligibilityService,
    PromotionEvaluationService,
    PromotionUsageService,
    PromotionSchedulerService,
  ],
})
export class PromotionsModule {}
