import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CatalogService } from "./catalog.service";
import { CatalogController } from "./catalog.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
