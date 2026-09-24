import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { AdminPermissionGuard } from "./admin-rbac.guard";
import { AdminRbacService } from "./admin-rbac.service";

/**
 * Phase 5.13-A — granular admin RBAC surface, and nothing else.
 *
 * Why this module exists: the Phase 5.12 compatibility writers (catalog
 * moderation, CMS settings, supplier decisions, VIP decisions, RFQ/bulk
 * pricing, operational logs) are enforced by `AdminPermissionGuard`, which
 * needs `AdminRbacService` to be resolvable from the consuming module's
 * injector. Importing the whole `AdminModule` to obtain that one dependency
 * drags the entire admin orchestration graph — `VipModule`, and through it
 * every table the VIP domain reads — into modules that must stay free of an
 * Orders dependency (see the Phase 3.10 architecture freeze guard for
 * `catalog`/`inventory`).
 *
 * This module owns and exports exactly the two RBAC collaborators, so a
 * consumer can enforce granular permissions without inheriting unrelated
 * domain edges. `AdminModule` imports it and re-exports both providers, so
 * existing `AdminModule` consumers keep the identical injectable graph and
 * `AdminRbacService.onModuleInit` still seeds the system roles exactly once.
 */
@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [AdminRbacService, AdminPermissionGuard],
  exports: [AdminRbacService, AdminPermissionGuard],
})
export class AdminRbacModule {}
