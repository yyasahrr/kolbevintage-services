import { forwardRef, Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { VipModule } from "../vip/vip.module";
import { AdminRbacService } from "./admin-rbac.service";
import { BusinessSettingsService } from "./business-settings.service";
import { InternalNotesService } from "./internal-notes.service";
import { AdminApprovalsService } from "./admin-approvals.service";
import { ControlTowerService } from "./control-tower.service";
import { AdminPermissionGuard } from "./admin-rbac.guard";
import { AdminTotpService } from "./admin-totp.service";
import { AdminTotpGuard } from "./admin-totp.guard";
import { AdminOrderFlagsService } from "./admin-order-flags.service";
import { AdminApprovalsController } from "./admin-approvals.controller";
import { AdminSettingsController } from "./admin-settings.controller";
import { AdminNotesController } from "./admin-notes.controller";
import { AdminRbacController } from "./admin-rbac.controller";
import { AdminOrderFlagsController } from "./admin-order-flags.controller";
import { ControlTowerController } from "./control-tower.controller";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    forwardRef(() => VipModule),
  ],
  controllers: [
    AdminApprovalsController,
    AdminSettingsController,
    AdminNotesController,
    AdminRbacController,
    AdminOrderFlagsController,
    ControlTowerController,
  ],
  providers: [
    AdminRbacService,
    BusinessSettingsService,
    InternalNotesService,
    AdminApprovalsService,
    ControlTowerService,
    AdminPermissionGuard,
    AdminTotpService,
    AdminTotpGuard,
    AdminOrderFlagsService,
  ],
  exports: [
    AdminRbacService,
    BusinessSettingsService,
    InternalNotesService,
    AdminApprovalsService,
    ControlTowerService,
    AdminPermissionGuard,
    AdminTotpService,
    AdminTotpGuard,
    AdminOrderFlagsService,
  ],
})
export class AdminModule {}
