import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AdminModule } from "../admin/admin.module";
import { AuditModule } from "../audit/audit.module";
import { RatingsService } from "./ratings.service";
import { RatingsController } from "./ratings.controller";
import { AdminRetailReviewsController } from "./admin-retail-reviews.controller";

@Module({
  imports: [DatabaseModule, AuditModule, AdminModule],
  controllers: [RatingsController, AdminRetailReviewsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
