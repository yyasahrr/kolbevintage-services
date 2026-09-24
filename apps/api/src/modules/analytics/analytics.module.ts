import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { AdminModule } from "../admin/admin.module";
import { AnalyticsQueryService } from "./analytics-query.service";
import { AnalyticsScopeService } from "./analytics-scope.service";
import { AnalyticsReportService } from "./analytics-report.service";
import { AnalyticsExportService } from "./analytics-export.service";
import { AnalyticsReconciliationService } from "./analytics-reconciliation.service";
import { RetailDashboardService } from "./retail-dashboard.service";
import { AdminRetailDashboardController } from "./admin-retail-dashboard.controller";
import { AdminRetailInventoryController } from "./admin-retail-inventory.controller";
import { AdminRetailExceptionsController } from "./admin-retail-exceptions.controller";
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
import { OperationalLogController } from "./operational-log.controller";
import { OperationalLogService } from "./operational-log.service";

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
    // Phase 5.11-B — retail operations read model (same module: the
    // dashboard reuses the in-module analytics engine, and AdminModule
    // is already imported for the granular guards — zero new edges).
    AdminRetailDashboardController,
    AdminRetailInventoryController,
    AdminRetailExceptionsController,
    OperationalLogController,
  ],
  providers: [AnalyticsQueryService, AnalyticsScopeService, AnalyticsReportService, AnalyticsExportService, AnalyticsReconciliationService, RetailDashboardService, OperationalLogService],
  exports: [AnalyticsQueryService, AnalyticsScopeService, AnalyticsReportService, AnalyticsExportService, AnalyticsReconciliationService],
})
export class AnalyticsModule {}
