import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { CustomerAccountService } from "./customer-account.service";
import { CustomerAddressService } from "./customer-address.service";
import { CustomerOrderHistoryService } from "./customer-order-history.service";

/**
 * Phase 5.9-A — retail customer account API. Session-only, buyer roles;
 * every route scopes by the session subject (never by a client-supplied
 * user id). Admin/support surfaces are out of scope for this phase.
 */
@Controller("customer")
@Roles("customer", "vip")
export class CustomerAccountController {
  constructor(
    @Inject(CustomerAccountService) private readonly account: CustomerAccountService,
    @Inject(CustomerAddressService) private readonly addresses: CustomerAddressService,
    @Inject(CustomerOrderHistoryService) private readonly history: CustomerOrderHistoryService,
  ) {}

  @Get("account")
  async getAccount(@CurrentUser() claims: Claims) {
    return this.account.getProfile(claims.sub);
  }

  @Patch("account")
  async updateAccount(@CurrentUser() claims: Claims, @Body() body: Record<string, any>) {
    return this.account.updateProfile(claims.sub, {
      displayName: body?.displayName,
      phone: body?.phone,
    });
  }

  @Get("addresses")
  async listAddresses(@CurrentUser() claims: Claims) {
    return { addresses: await this.addresses.listAddresses(claims.sub) };
  }

  @Post("addresses")
  @HttpCode(201)
  async createAddress(@CurrentUser() claims: Claims, @Body() body: Record<string, any>) {
    return this.addresses.createAddress(claims.sub, {
      label: body?.label,
      recipientName: body?.recipientName,
      recipientPhone: body?.recipientPhone,
      province: body?.province,
      city: body?.city,
      addressLine: body?.addressLine,
      plaque: body?.plaque,
      unit: body?.unit,
      postalCode: body?.postalCode,
      isDefault: body?.isDefault,
    });
  }

  @Patch("addresses/:id")
  async updateAddress(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: Record<string, any>) {
    return this.addresses.updateAddress(claims.sub, id, {
      label: body?.label,
      recipientName: body?.recipientName,
      recipientPhone: body?.recipientPhone,
      province: body?.province,
      city: body?.city,
      addressLine: body?.addressLine,
      plaque: body?.plaque,
      unit: body?.unit,
      postalCode: body?.postalCode,
      isDefault: body?.isDefault,
      version: body?.version,
    });
  }

  @Post("addresses/:id/make-default")
  async makeDefault(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return this.addresses.makeDefault(claims.sub, id);
  }

  @Delete("addresses/:id")
  async archiveAddress(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return this.addresses.archiveAddress(claims.sub, id);
  }

  @Get("orders")
  async listOrders(
    @CurrentUser() claims: Claims,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ) {
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    return this.history.listOrders(claims.sub, { limit: parsedLimit, cursor });
  }

  @Get("orders/:id")
  async getOrder(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return this.history.getOrderDetail({ userId: claims.sub, role: claims.role }, id);
  }
}
