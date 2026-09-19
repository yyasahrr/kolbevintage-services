import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { SettlementService } from "./settlement.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { SettlementDomainError } from "./settlement.errors";

@Controller("supplier/financial-account")
export class SupplierFinancialAccountController {
  constructor(
    @Inject(SettlementService) private readonly settlement: SettlementService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
  ) {}

  private async resolveMembership(
    userId: string,
    targetSupplierId?: string,
  ): Promise<{ supplierId: string; role: string }> {
    const memberships = await this.suppliers.getUserMemberships(userId);
    if (!memberships || memberships.length === 0) {
      throw new SettlementDomainError(
        "SUPPLIER_MEMBERSHIP_REQUIRED",
        "شما عضو هیچ تامین‌کننده‌ای نیستید",
        403,
      );
    }

    const supId = targetSupplierId || memberships[0].supplierId;
    const membership = memberships.find((m: any) => m.supplierId === supId);

    if (!membership) {
      throw new SettlementDomainError(
        "SUPPLIER_MEMBERSHIP_REQUIRED",
        "شما عضو این تامین‌کننده نیستید",
        403,
      );
    }

    if (!["owner", "finance"].includes(membership.role)) {
      throw new SettlementDomainError(
        "SUPPLIER_ROLE_NOT_AUTHORIZED",
        `نقش ${membership.role} مجاز به دسترسی به حساب مالی تامین‌کننده نیست`,
        403,
      );
    }

    return { supplierId: supId, role: membership.role };
  }

  @Get("summary")
  @Roles("supplier")
  async getSummary(
    @CurrentUser() claims: Claims,
    @Query("supplierId") querySupplierId?: string,
  ) {
    const { supplierId } = await this.resolveMembership(claims.sub, querySupplierId);
    const summary = await this.settlement.getSupplierSummary(supplierId);
    return toApiJson(summary);
  }

  @Get("history")
  @Roles("supplier")
  async getHistory(
    @CurrentUser() claims: Claims,
    @Query("supplierId") querySupplierId?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const { supplierId } = await this.resolveMembership(claims.sub, querySupplierId);
    const history = await this.settlement.listSupplierHistory(supplierId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return toApiJson({ items: history });
  }

  @Post("withdrawals")
  @Roles("supplier")
  async requestWithdrawal(
    @CurrentUser() claims: Claims,
    @Headers("idempotency-key") idemHeader: string | undefined,
    @Body() body: { supplierId?: string; amount: string },
  ) {
    const idempotencyKey = idemHeader?.trim();
    if (!idempotencyKey) {
      throw new SettlementDomainError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Key header الزامی است",
        400,
      );
    }

    if (!body?.amount || typeof body.amount !== "string") {
      throw new SettlementDomainError("INVALID_AMOUNT", "مبلغ برداشت الزامی است", 400);
    }

    let amount: bigint;
    try {
      amount = BigInt(body.amount);
    } catch {
      throw new SettlementDomainError("INVALID_AMOUNT", "مبلغ برداشت باید رشته عددی صحیح باشد", 400);
    }

    if (amount <= 0n) {
      throw new SettlementDomainError("INVALID_AMOUNT", "مبلغ برداشت باید بزرگتر از صفر باشد", 400);
    }

    const { supplierId } = await this.resolveMembership(claims.sub, body.supplierId);

    const withdrawal = await this.settlement.createWithdrawalRequest({
      supplierId,
      amount,
      requestedByUserId: claims.sub,
      idempotencyKey,
    });

    return toApiJson({ withdrawal });
  }

  @Get("withdrawals")
  @Roles("supplier")
  async listWithdrawals(
    @CurrentUser() claims: Claims,
    @Query("supplierId") querySupplierId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const { supplierId } = await this.resolveMembership(claims.sub, querySupplierId);
    const withdrawals = await this.settlement.listWithdrawalRequests({
      supplierId,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return toApiJson({ withdrawals });
  }

  @Get("withdrawals/:id")
  @Roles("supplier")
  async getWithdrawal(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
  ) {
    const withdrawal = await this.settlement.getWithdrawalRequestById(id);
    await this.resolveMembership(claims.sub, withdrawal.supplierId);
    return toApiJson({ withdrawal });
  }
}
