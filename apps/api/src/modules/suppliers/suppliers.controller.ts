import { Controller, Get, Post, Body, Param, Headers, HttpCode, Inject } from "@nestjs/common";
import { SuppliersService } from "./suppliers.service";
import { CurrentUser, Public, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { SupplierApprovalOrchestrator } from "../../orchestration/supplier-approval.orchestrator";

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
  async decide(@Param("id") id: string, @Body() body: any, @CurrentUser() claims: Claims) {
    return this.approvals.decide(id, body, claims.sub);
  }

  @Post()
  async create(@Body() body: { legalName: string; displayName: string }) {
    return this.suppliers.createSupplier(body);
  }

  @Get(":id/members")
  async members(@Param("id") id: string) {
    return this.suppliers.listMembers(id);
  }
}
