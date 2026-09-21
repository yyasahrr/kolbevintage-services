import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AdminModule } from "../admin/admin.module";
import { AnalyticsQueryService } from "./analytics-query.service";
import { AnalyticsScopeService } from "./analytics-scope.service";
import {
  AdminAnalyticsController,
  SupplierAnalyticsController,
  VipAnalyticsController,
} from "./analytics.controller";

@Module({
  imports: [DatabaseModule, AdminModule],
  controllers: [AdminAnalyticsController, SupplierAnalyticsController, VipAnalyticsController],
  providers: [AnalyticsQueryService, AnalyticsScopeService],
  exports: [AnalyticsQueryService, AnalyticsScopeService],
})
export class AnalyticsModule {}
