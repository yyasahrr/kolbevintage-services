import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { AdminModule } from "../admin/admin.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { OrdersModule } from "../orders/orders.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { ProductionService } from "./production.service";
import { SupplierProductionController } from "./production.controller";
import { AdminProductionController } from "./admin-production.controller";
import { ProductionNotificationRelayService } from "./production-notification-relay.service";

@Module({
  imports: [DatabaseModule, AuditModule, AdminModule, NotificationsModule, OrdersModule, SuppliersModule],
  controllers: [SupplierProductionController, AdminProductionController],
  providers: [ProductionService, ProductionNotificationRelayService],
  exports: [ProductionService, ProductionNotificationRelayService],
})
export class ProductionModule {}
