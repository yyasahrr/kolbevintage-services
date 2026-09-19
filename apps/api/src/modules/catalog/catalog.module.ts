import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CatalogService } from "./catalog.service";
import { CatalogController } from "./catalog.controller";
import { ComplianceModule } from "../compliance/compliance.module";

@Module({
  imports: [DatabaseModule, ComplianceModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
