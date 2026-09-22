import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { RetailOrdersModule } from "../orders/retail/retail-orders.module";
import { CustomerAccountController } from "./customer-account.controller";
import { GuestOrderAccessController } from "./guest-order-access.controller";
import { CustomerAccountService } from "./customer-account.service";
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
 */
@Module({
  imports: [AuthModule, AuditModule, RetailOrdersModule],
  controllers: [CustomerAccountController, GuestOrderAccessController],
  providers: [
    CustomerAccountService,
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
