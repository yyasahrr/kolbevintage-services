import { forwardRef, Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { VipModule } from "../vip/vip.module";
import { BusinessSettingsService } from "./business-settings.service";
import { InternalNotesService } from "./internal-notes.service";
import { AdminApprovalsService } from "./admin-approvals.service";
import { ControlTowerService } from "./control-tower.service";
import { AdminRbacModule } from "./admin-rbac.module";
import { AdminTotpService } from "./admin-totp.service";
import { AdminTotpGuard } from "./admin-totp.guard";
import { AdminOrderFlagsService } from "./admin-order-flags.service";
import { AdminApprovalsController } from "./admin-approvals.controller";
import { AdminSettingsController } from "./admin-settings.controller";
import { AdminNotesController } from "./admin-notes.controller";
import { AdminRbacController } from "./admin-rbac.controller";
import { AdminOrderFlagsController } from "./admin-order-flags.controller";
import { ControlTowerController } from "./control-tower.controller";
import {
  AccountReadCutoverController,
  AdminReadCutoverController,
  StorefrontReadCutoverController,
  SupplierReadCutoverController,
  WholesaleReadCutoverController,
} from "../../database/legacy-read-cutover.controller";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    AdminRbacModule,
    forwardRef(() => VipModule),
  ],
  controllers: [
    AdminApprovalsController,
    AdminSettingsController,
    AdminNotesController,
    AdminRbacController,
    AdminOrderFlagsController,
    ControlTowerController,
    AccountReadCutoverController,
    AdminReadCutoverController,
    StorefrontReadCutoverController,
    SupplierReadCutoverController,
    WholesaleReadCutoverController,
  ],
  providers: [
    BusinessSettingsService,
    InternalNotesService,
    AdminApprovalsService,
    ControlTowerService,
    AdminTotpService,
    AdminTotpGuard,
    AdminOrderFlagsService,
  ],
  exports: [
    AdminRbacModule,
    BusinessSettingsService,
    InternalNotesService,
    AdminApprovalsService,
    ControlTowerService,
    AdminTotpService,
    AdminTotpGuard,
    AdminOrderFlagsService,
  ],
})
export class AdminModule {}
