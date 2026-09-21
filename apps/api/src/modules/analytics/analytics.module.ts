import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { AdminModule } from "../admin/admin.module";
import { AnalyticsQueryService } from "./analytics-query.service";
import { AnalyticsScopeService } from "./analytics-scope.service";
import { AnalyticsReportService } from "./analytics-report.service";
import { AnalyticsExportService } from "./analytics-export.service";
import { AnalyticsReconciliationService } from "./analytics-reconciliation.service";
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
import {
  AdminAnalyticsReconciliationController,
  SupplierAnalyticsReconciliationController,
  VipAnalyticsReconciliationController,
} from "./analytics-reconciliation.controller";

@Module({
  imports: [DatabaseModule, AuditModule, AdminModule],
  controllers: [
    AdminAnalyticsController,
    SupplierAnalyticsController,
    VipAnalyticsController,
    AdminAnalyticsReportController,
    SupplierAnalyticsReportController,
    VipAnalyticsReportController,
    AdminAnalyticsReconciliationController,
    SupplierAnalyticsReconciliationController,
    VipAnalyticsReconciliationController,
  ],
  providers: [AnalyticsQueryService, AnalyticsScopeService, AnalyticsReportService, AnalyticsExportService, AnalyticsReconciliationService],
  exports: [AnalyticsQueryService, AnalyticsScopeService, AnalyticsReportService, AnalyticsExportService, AnalyticsReconciliationService],
})
export class AnalyticsModule {}
