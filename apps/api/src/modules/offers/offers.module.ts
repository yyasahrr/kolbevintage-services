import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { OffersService } from "./offers.service";
import { OffersController } from "./offers.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [OffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
