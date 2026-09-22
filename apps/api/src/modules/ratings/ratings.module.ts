import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { RatingsService } from "./ratings.service";
import { RatingsController } from "./ratings.controller";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
