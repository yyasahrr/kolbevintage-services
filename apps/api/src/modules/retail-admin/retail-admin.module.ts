import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AdminModule } from "../admin/admin.module";
import { AuthModule } from "../auth/auth.module";
import { CatalogModule } from "../catalog/catalog.module";
import { InventoryModule } from "../inventory/inventory.module";
import { OffersModule } from "../offers/offers.module";
import { RetailOrdersModule } from "../orders/retail/retail-orders.module";
import { PaymentsModule } from "../payments/payments.module";
import { RatingsModule } from "../ratings/ratings.module";
import { ShippingModule } from "../shipping/shipping.module";
import { RetailAdminController } from "./retail-admin.controller";
import { RetailAdminService } from "./retail-admin.service";

/**
 * Phase 5.11-A — Retail Admin & Operations control plane (orchestrator).
 *
 * Owns NO tables (registry: `tables: []`). It composes owner-domain
 * services — every read goes through an owner seam, and (checkpoint B+)
 * every write delegates to an owner command. The graph stays acyclic:
 * none of the imported modules import retail-admin back (verified by the
 * architecture-freeze acyclicity guard).
 *
 * Checkpoint B adds AdminApprovalsService wiring (via the existing
 * AdminModule) and the command endpoints; checkpoint C adds the
 * read-model services (analytics/crm/support/notifications) — those
 * imports land with their checkpoints.
 */
@Module({
  imports: [
    DatabaseModule,
    AdminModule,
    AuthModule,
    CatalogModule,
    OffersModule,
    InventoryModule,
    RetailOrdersModule,
    PaymentsModule,
    RatingsModule,
    ShippingModule,
  ],
  controllers: [RetailAdminController],
  providers: [RetailAdminService],
  exports: [RetailAdminService],
})
export class RetailAdminModule {}
