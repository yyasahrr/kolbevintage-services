import { Body, Controller, Get, Param, Post, Headers, Inject, forwardRef } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { ShippingService } from "./shipping.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { WholesaleFinanceOrchestrator } from "../finance/wholesale-finance.orchestrator";
import { OrdersService } from "../orders/orders.service";

@Controller("supplier/shipments")
export class ShippingSupplierController {
  constructor(
    @Inject(ShippingService) private readonly shippingService: ShippingService,
    @Inject(SuppliersService) private readonly suppliersService: SuppliersService,
    @Inject(forwardRef(() => WholesaleFinanceOrchestrator)) private readonly orchestrator: WholesaleFinanceOrchestrator,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
  ) {}

  private async resolveSellerId(claims: Claims): Promise<string> {
    const memberships = await this.suppliersService.getUserMemberships(claims.sub);
    if (!memberships || memberships.length === 0) throw new Error("Not a supplier member");
    return (memberships[0] as any).sellerId || (memberships[0] as any).seller_id;
  }

  @Get("child/:childOrderId")
  @Roles("supplier")
  async getShipmentsForChild(@CurrentUser() claims: Claims, @Param("childOrderId") childOrderId: string) {
    const sellerId = await this.resolveSellerId(claims);
    const shipments = await this.shippingService.getShipmentsForChild(childOrderId, sellerId);
    return { shipments };
  }

  @Get(":id")
  @Roles("supplier")
  async getShipment(@CurrentUser() claims: Claims, @Param("id") id: string) {
    const sellerId = await this.resolveSellerId(claims);
    const result = await this.shippingService.getShipmentById(id, sellerId);
    return result;
  }

  @Post("quote")
  @Roles("supplier")
  async createQuote(
    @CurrentUser() claims: Claims,
    @Body() body: { childOrderId: string; wholesaleOrderId: string; serviceLevel?: string; provider?: string },
    @Headers("idempotency-key") idemHeader: string,
    @Headers("Idempotency-Key") idemHeader2: string,
  ) {
    const idempotencyKey = idemHeader || idemHeader2 || body?.childOrderId + ":" + Date.now();
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    const sellerId = await this.resolveSellerId(claims);
    const result = await this.shippingService.createQuote({
      childOrderId: body.childOrderId,
      sellerId,
      wholesaleOrderId: body.wholesaleOrderId,
      serviceLevel: body.serviceLevel,
      providerName: body.provider,
      idempotencyKey,
      actorId: claims.sub,
      actorRole: claims.role,
    });
    return { quote: result.quote, replayed: result.replayed };
  }

  @Post()
  @Roles("supplier")
  async createShipment(
    @CurrentUser() claims: Claims,
    @Body() body: { wholesaleOrderId: string; childOrderId: string; shippingResponsibility?: string; provider?: string; addressSnapshot?: any; quoteId?: string; items: Array<{ wholesaleOrderItemId: string; purchaseOrderItemId?: string; variantId?: string; pieceQuantity: number }> },
    @Headers("idempotency-key") idemHeader: string,
    @Headers("Idempotency-Key") idemHeader2: string,
  ) {
    const idempotencyKey = idemHeader || idemHeader2;
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    const sellerId = await this.resolveSellerId(claims);
    const result = await this.orchestrator.createShipmentWithInventory({
      wholesaleOrderId: body.wholesaleOrderId,
      childOrderId: body.childOrderId,
      sellerId,
      shippingResponsibility: body.shippingResponsibility,
      providerName: body.provider,
      addressSnapshot: body.addressSnapshot,
      quoteId: body.quoteId,
      items: body.items,
      idempotencyKey,
      actorId: claims.sub,
      actorRole: claims.role,
    });

    if (!result.replayed) {
      try {
        await this.ordersService.recordShippingShipmentCreated({
          orderId: body.wholesaleOrderId,
          childOrderId: body.childOrderId,
          shipmentId: result.shipment.id,
          actorId: claims.sub,
          executor: undefined as any,
        });
      } catch {}
    }

    return { shipment: result.shipment, replayed: result.replayed };
  }

  @Post(":id/handoff")
  @Roles("supplier")
  async handoff(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() body: { trackingCode?: string; trackingUrl?: string; evidence?: string },
  ) {
    const sellerId = await this.resolveSellerId(claims);
    await this.shippingService.getShipmentById(id, sellerId);
    const updated = await this.shippingService.handoffShipment({
      shipmentId: id,
      actorId: claims.sub,
      actorRole: claims.role,
      trackingCode: body.trackingCode,
      trackingUrl: body.trackingUrl,
      evidence: body.evidence,
    });
    return { shipment: updated };
  }

  @Post(":id/tracking")
  @Roles("supplier")
  async updateTracking(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() body: { trackingCode?: string; trackingUrl?: string },
  ) {
    const sellerId = await this.resolveSellerId(claims);
    await this.shippingService.getShipmentById(id, sellerId);
    const updated = await this.shippingService.updateTracking({
      shipmentId: id,
      trackingCode: body.trackingCode,
      trackingUrl: body.trackingUrl,
      actorId: claims.sub,
      actorRole: claims.role,
    });
    return { shipment: updated };
  }
}
