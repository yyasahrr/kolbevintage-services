import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AdminModule } from "../admin/admin.module";
import { AnalyticsQueryService } from "./analytics-query.service";
import { AnalyticsScopeService } from "./analytics-scope.service";
import { AnalyticsReportService } from "./analytics-report.service";
import { AnalyticsExportService } from "./analytics-export.service";
import {
  AdminAnalyticsController,
  SupplierAnalyticsController,
  VipAnalyticsController,
} from "./analytics.controller";
import {
  AdminAnalyticsReportController,
  SupplierAnalyticsReportController,
  VipAnalyticsReportController,
} from "./analytics-report.controller";

@Module({
  imports: [DatabaseModule, AdminModule],
  controllers: [
    AdminAnalyticsController,
    SupplierAnalyticsController,
    VipAnalyticsController,
    AdminAnalyticsReportController,
    SupplierAnalyticsReportController,
    VipAnalyticsReportController,
  ],
  providers: [AnalyticsQueryService, AnalyticsScopeService, AnalyticsReportService, AnalyticsExportService],
  exports: [AnalyticsQueryService, AnalyticsScopeService, AnalyticsReportService, AnalyticsExportService],
})
export class AnalyticsModule {}
