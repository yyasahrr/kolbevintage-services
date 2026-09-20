import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { SupportCaseService } from "./support-case.service";

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [SupportCaseService],
  exports: [SupportCaseService],
})
export class SupportModule {}
