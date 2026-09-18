import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { InventoryService } from "./inventory.service";
import { InventoryController } from "./inventory.controller";
import { InventoryCutoverService } from "./cutover.service";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryCutoverService],
  exports: [InventoryService, InventoryCutoverService],
})
export class InventoryModule {}
