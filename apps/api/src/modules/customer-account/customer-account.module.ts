import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { AdminModule } from "../admin/admin.module";
import { PaymentsModule } from "../payments/payments.module";
import { SupportModule } from "../support/support.module";
import { RetailOrdersModule } from "../orders/retail/retail-orders.module";
import { AdminRetailCustomersController } from "./admin-retail-customers.controller";
import { CustomerAccountController } from "./customer-account.controller";
import { GuestOrderAccessController } from "./guest-order-access.controller";
import { CustomerAccountService } from "./customer-account.service";
import { CustomerOperatorViewService } from "./customer-operator-view.service";
import { CustomerAddressRepository } from "./customer-address.repository";
import { CustomerAddressService } from "./customer-address.service";
import { CustomerOrderHistoryService } from "./customer-order-history.service";
import { CustomerReturnService } from "./customer-return.service";
import { GuestOrderAccessGuard } from "./guest-order-access.guard";
import { GuestOrderAccessService } from "./guest-order-access.service";

/**
 * Phase 5.9-A — retail customer account (leaf module). Depends on auth
 * (profile reads/writes), orders (commerce reads + capability policy),
 * and audit. Owns `customer_address`; Checkpoint B/C extend through the
 * history and guest-access seams without touching commerce.
 * Phase 5.11-A adds the admin-only operator view: Payments and Support
 * are leaves (Database/Audit[/Admin]) that never import account back,
 * and AdminModule supplies the granular permission guard.
 */
@Module({
  imports: [AuthModule, AuditModule, AdminModule, PaymentsModule, SupportModule, RetailOrdersModule],
  controllers: [CustomerAccountController, GuestOrderAccessController, AdminRetailCustomersController],
  providers: [
    CustomerAccountService,
    CustomerOperatorViewService,
    CustomerAddressRepository,
    CustomerAddressService,
    CustomerOrderHistoryService,
    CustomerReturnService,
    GuestOrderAccessGuard,
    GuestOrderAccessService,
  ],
  exports: [CustomerAccountService, CustomerAddressService, CustomerOrderHistoryService, CustomerReturnService, GuestOrderAccessService],
})
export class CustomerAccountModule {}
