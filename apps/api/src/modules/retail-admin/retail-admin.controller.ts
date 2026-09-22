import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { Roles, CurrentUser } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { RetailAdminService } from "./retail-admin.service";

/**
 * Phase 5.11-A — Retail Admin & Operations namespace.
 *
 *  - `@Roles("admin")`: the session role (signed claims) must be admin.
 *  - `@RequireAdminPermission("retail:*")`: granular RBAC via
 *    AdminPermissionGuard — unknown or missing permissions fail CLOSED
 *    (no `role === "admin"` bypass anywhere in this namespace).
 *  - The actor is always `claims.sub`; nothing identifying the actor is
 *    accepted from the body/query/headers (A6 rule).
 *  - Every response passes through `toApiJson` (BigInt → string, Date → ISO).
 *
 * Views only in checkpoint A; the operational commands (B) and read models
 * (C) land on this same controller in their checkpoints.
 */
@Controller("admin/retail")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class RetailAdminController {
  constructor(@Inject(RetailAdminService) private readonly retailAdminService: RetailAdminService) {}

  // ── control tower ────────────────────────────────────────────────────────

  @Get("overview")
  @RequireAdminPermission("retail:dashboard:view")
  async overview() {
    const overview = await this.retailAdminService.getOverview();
    return toApiJson({ overview });
  }

  // ── orders ───────────────────────────────────────────────────────────────

  @Get("orders")
  @RequireAdminPermission("retail:order:view")
  async orders(
    @CurrentUser() claims: Claims,
    @Query("status") status?: string,
    @Query("paymentStatus") paymentStatus?: string,
    @Query("customerId") customerId?: string,
    @Query("customerPhone") customerPhone?: string,
    @Query("orderCode") orderCode?: string,
    @Query("shipmentStatus") shipmentStatus?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.retailAdminService.listOrders(claims.sub, {
      status,
      paymentStatus,
      customerId,
      customerPhone,
      orderCode,
      shipmentStatus,
      dateFrom,
      dateTo,
      limit,
      cursor,
    });
    return toApiJson(page);
  }

  @Get("orders/:orderId")
  @RequireAdminPermission("retail:order:view")
  async orderDetail(@CurrentUser() claims: Claims, @Param("orderId") orderId: string) {
    const detail = await this.retailAdminService.getOrderDetail(claims.sub, orderId);
    return toApiJson({ order: detail });
  }

  @Get("orders/:orderId/timeline")
  @RequireAdminPermission("retail:order:view")
  async orderTimeline(@CurrentUser() claims: Claims, @Param("orderId") orderId: string) {
    const timeline = await this.retailAdminService.getOrderTimeline(claims.sub, orderId);
    return toApiJson(timeline);
  }

  // ── payments ─────────────────────────────────────────────────────────────

  @Get("payments")
  @RequireAdminPermission("retail:payment:view")
  async payments(
    @CurrentUser() claims: Claims,
    @Query("retailOrderId") retailOrderId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.retailAdminService.listPayments(claims.sub, { retailOrderId, status, limit, cursor });
    return toApiJson(page);
  }

  @Get("payments/:paymentId")
  @RequireAdminPermission("retail:payment:view")
  async paymentDetail(@CurrentUser() claims: Claims, @Param("paymentId") paymentId: string) {
    const detail = await this.retailAdminService.getPaymentDetail(claims.sub, paymentId);
    return toApiJson({ payment: detail });
  }

  // ── shipments ────────────────────────────────────────────────────────────

  @Get("shipments")
  @RequireAdminPermission("retail:shipment:view")
  async shipments(
    @CurrentUser() claims: Claims,
    @Query("retailOrderId") retailOrderId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.retailAdminService.listShipments(claims.sub, { retailOrderId, status, limit, cursor });
    return toApiJson(page);
  }

  @Get("shipments/:shipmentId")
  @RequireAdminPermission("retail:shipment:view")
  async shipmentDetail(@CurrentUser() claims: Claims, @Param("shipmentId") shipmentId: string) {
    const detail = await this.retailAdminService.getShipmentDetail(claims.sub, shipmentId);
    return toApiJson({ shipment: detail });
  }

  // ── returns ──────────────────────────────────────────────────────────────

  @Get("returns")
  @RequireAdminPermission("retail:return:view")
  async returns(
    @CurrentUser() claims: Claims,
    @Query("status") status?: string,
    @Query("orderId") orderId?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.retailAdminService.listReturns(claims.sub, { status, orderId, limit, cursor });
    return toApiJson(page);
  }

  @Get("returns/:returnId")
  @RequireAdminPermission("retail:return:view")
  async returnDetail(@CurrentUser() claims: Claims, @Param("returnId") returnId: string) {
    const detail = await this.retailAdminService.getReturnDetail(claims.sub, returnId);
    return toApiJson({ return: detail });
  }

  // ── refunds ──────────────────────────────────────────────────────────────

  @Get("refunds")
  @RequireAdminPermission("retail:refund:view")
  async refunds(
    @CurrentUser() claims: Claims,
    @Query("retailOrderId") retailOrderId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.retailAdminService.listRefunds(claims.sub, { retailOrderId, status, limit, cursor });
    return toApiJson(page);
  }

  @Get("refunds/:refundId")
  @RequireAdminPermission("retail:refund:view")
  async refundDetail(@CurrentUser() claims: Claims, @Param("refundId") refundId: string) {
    const detail = await this.retailAdminService.getRefundDetail(claims.sub, refundId);
    return toApiJson({ refund: detail });
  }

  // ── customers ────────────────────────────────────────────────────────────

  @Get("customers")
  @RequireAdminPermission("retail:customer:view")
  async customers(
    @CurrentUser() claims: Claims,
    @Query("search") search?: string,
    @Query("role") role?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.retailAdminService.listCustomers(claims.sub, { search, role, status, limit, cursor });
    return toApiJson(page);
  }

  @Get("customers/:userId")
  @RequireAdminPermission("retail:customer:view")
  async customerDetail(@CurrentUser() claims: Claims, @Param("userId") userId: string) {
    const profile = await this.retailAdminService.getCustomerDetail(claims.sub, userId);
    return toApiJson({ customer: profile });
  }

  // ── reviews ──────────────────────────────────────────────────────────────

  @Get("reviews")
  @RequireAdminPermission("retail:review:view")
  async reviews(
    @CurrentUser() claims: Claims,
    @Query("productId") productId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.retailAdminService.listReviews(claims.sub, { productId, status, limit, cursor });
    return toApiJson(page);
  }

  // ── products ─────────────────────────────────────────────────────────────

  @Get("products")
  @RequireAdminPermission("retail:catalog:view")
  async products(
    @CurrentUser() claims: Claims,
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.retailAdminService.listProducts(claims.sub, { status, search, limit, cursor });
    return toApiJson(page);
  }

  @Get("products/:productId")
  @RequireAdminPermission("retail:catalog:view")
  async productDetail(@CurrentUser() claims: Claims, @Param("productId") productId: string) {
    const detail = await this.retailAdminService.getProductDetail(claims.sub, productId);
    return toApiJson({ product: detail });
  }

  // ── inventory ────────────────────────────────────────────────────────────

  @Get("inventory/low-stock")
  @RequireAdminPermission("retail:inventory:view")
  async lowStock(@CurrentUser() claims: Claims, @Query("minAvailable") minAvailable?: string, @Query("limit") limit?: string) {
    const result = await this.retailAdminService.listLowStock(claims.sub, { minAvailable, limit });
    return toApiJson(result);
  }
}
