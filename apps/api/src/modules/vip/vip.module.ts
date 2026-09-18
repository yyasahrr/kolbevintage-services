import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { VipService } from "./vip.service";
import { VipController } from "./vip.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [VipController],
  providers: [VipService],
  exports: [VipService],
})
export class VipModule {}
