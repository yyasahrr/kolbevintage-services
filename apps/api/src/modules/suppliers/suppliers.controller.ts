import { Controller, Get, Post, Body, Param, Headers, HttpCode, Inject, UseGuards } from "@nestjs/common";
import { SuppliersService } from "./suppliers.service";
import { CurrentUser, Public, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { SupplierApprovalOrchestrator } from "../../orchestration/supplier-approval.orchestrator";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";

@Controller("suppliers")
export class SuppliersController {
  constructor(
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(SupplierApprovalOrchestrator) private readonly approvals: SupplierApprovalOrchestrator,
  ) {}

  @Public()
  @Post("applications")
  async apply(@Body() body: any, @Headers("idempotency-key") idempotencyKey?: string) {
    const result = await this.suppliers.apply(body, idempotencyKey);
    return { id: result.id };
  }

  @Post("applications/:id/decision")
  @HttpCode(200)
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("wholesale:approval:decide")
  async decide(@Param("id") id: string, @Body() body: any, @CurrentUser() claims: Claims) {
    return this.approvals.decide(id, body, claims.sub);
  }

  @Post()
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("wholesale:membership:manage")
  async create(@Body() body: { legalName: string; displayName: string }) {
    return this.suppliers.createSupplier(body);
  }

  @Get(":id/members")
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("wholesale:membership:view")
  async members(@Param("id") id: string) {
    return this.suppliers.listMembers(id);
  }
}
