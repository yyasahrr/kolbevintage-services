import { Module } from "@nestjs/common";
import { FulfillmentService } from "./fulfillment.service";
import { FulfillmentController } from "./fulfillment.controller";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { OrdersModule } from "../orders/orders.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { VipModule } from "../vip/vip.module";

@Module({
  imports: [DatabaseModule, AuditModule, OrdersModule, SuppliersModule, VipModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
