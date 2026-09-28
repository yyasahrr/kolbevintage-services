/**
 * Phase 4.7.6 — helpers on top of the 4.7.1 real-PostgreSQL harness.
 *
 * Adds a Kolbe first-party offer (the seeded `seller_kolbe` singleton), mixed orders (Kolbe + supplier
 * children), and the quantity-evidenced delivery path (shipment → handoff → carrier delivered).
 */
import * as schema from "@kolbe/database";
import { hashAcceptedTerms } from "../../src/modules/pricing/pricing.logic";
import {
  adminActor,
  confirmToAwaitingPayment,
  createFakeIntent,
  createReadyShipment,
  fakeWebhookBody,
  makeId,
  one,
  orderItemsForChild,
  signedFakeHeaders,
  supplierA,
  type Harness,
  type SupplierContext,
} from "./phase-4-7-1.harness";

export const KOLBE_SELLER_ID = "seller_kolbe";

export type KolbeContext = { offerKolbe: string; priceKolbe: bigint };

/** Kolbe first-party offer on the shared variant + inventory for the seeded Kolbe seller. */
export async function seedKolbeOffer(h: Harness, ctx: SupplierContext, price: bigint): Promise<KolbeContext> {
  const offerKolbe = makeId("offerK");
  await h.db.insert(schema.sellerOffer).values({
    id: offerKolbe,
    productId: ctx.prodId,
    sellerId: KOLBE_SELLER_ID,
    variantId: ctx.varId,
    sku: `OFFER-${offerKolbe}`,
    status: "published",
    wholesalePrice: price as any,
    currency: "IRR",
    moq: 1,
    moqUnit: "PIECE",
    pricingUnit: "PIECE" as any,
  } as any);
  await h.db.insert(schema.productVariantInventory).values({ id: makeId("invK"), variantId: ctx.varId, sellerId: KOLBE_SELLER_ID, onHand: 500, reserved: 0, status: "active" } as any);
  return { offerKolbe, priceKolbe: price };
}

function snapshot(ctx: SupplierContext, seller: { sellerId: string; supplierId: string | null; offerId: string; price: bigint }, quantity: number) {
  return {
    requestVersion: 0,
    productId: ctx.prodId,
    offerId: seller.offerId,
    sellerId: seller.sellerId,
    supplierId: seller.supplierId,
    variantId: ctx.varId,
    packageId: null,
    quantity,
    saleUnit: "PIECE",
    pricingUnit: "PIECE",
    pricingTierId: null,
    unitPrice: seller.price.toString(),
    currency: "IRR",
    package: null,
    pieceQuantity: quantity,
    lineTotal: (seller.price * BigInt(quantity)).toString(),
  };
}

/** Accepted wholesale request for one seller (the buyer's accepted terms snapshot). */
export async function acceptedRequest(h: Harness, ctx: SupplierContext, seller: { sellerId: string; supplierId: string | null; offerId: string; price: bigint }, quantity: number) {
  const id = makeId("wreq");
  const snap = snapshot(ctx, seller, quantity);
  await h.db.insert(schema.wholesaleRequest).values({
    id,
    productId: ctx.prodId,
    offerId: seller.offerId,
    vipAccountId: ctx.accId,
    variantId: ctx.varId,
    quantity,
    status: "accepted",
    version: 1,
    acceptedTermsSnapshot: snap as any,
    acceptedTermsHash: hashAcceptedTerms(snap as any),
    acceptedAt: new Date(),
    acceptedBy: ctx.userBuyer,
  } as any);
  return { requestId: id, expectedVersion: 1 };
}

export const sellerARef = (ctx: SupplierContext) => ({ sellerId: ctx.sellerA, supplierId: ctx.supA, offerId: ctx.offerA, price: ctx.priceA });
export const sellerBRef = (ctx: SupplierContext) => ({ sellerId: ctx.sellerB, supplierId: ctx.supB, offerId: ctx.offerB, price: ctx.priceB });
export const kolbeRef = (k: KolbeContext) => ({ sellerId: KOLBE_SELLER_ID, supplierId: null, offerId: k.offerKolbe, price: k.priceKolbe });

/** Draft order with any mix of children (Kolbe first-party and/or suppliers). */
export async function createMixedOrder(
  h: Harness,
  ctx: SupplierContext,
  lines: Array<{ seller: { sellerId: string; supplierId: string | null; offerId: string; price: bigint }; quantity: number }>,
  opts: { paymentMode?: string } = {},
) {
  const requests = [];
  for (const line of lines) requests.push(await acceptedRequest(h, ctx, line.seller, line.quantity));
  const result = await h.ordersService.createWholesaleOrder({
    requests,
    paymentMode: opts.paymentMode || "transfer",
    shippingAddress: { city: "Tehran", line1: "Valiasr 1", postalCode: "11111" },
    billingAddress: { city: "Tehran", line1: "Valiasr 1", postalCode: "11111" },
    idempotencyKey: makeId("idem_create"),
    buyerUserId: ctx.userBuyer,
  });
  const childFor = (sellerId: string) => result.children.find((c: any) => c.sellerId === sellerId) || null;
  return { order: result.order, children: result.children, childFor, requests };
}

/** Confirm + online (fake provider) payment verified through the canonical webhook ⇒ parent `processing`. */
export async function payByWebhook(h: Harness, ctx: SupplierContext, orderId: string) {
  await confirmToAwaitingPayment(h, orderId, ctx.userBuyer);
  const intent = await createFakeIntent(h, orderId, ctx.userBuyer);
  const res = await h.paymentProviderOrchestrator.ingestWebhook({
    provider: "fake",
    request: { headers: signedFakeHeaders(), body: fakeWebhookBody(intent.providerReference, { eventId: makeId("evt") }) },
  });
  if (res.outcome.status !== "processed") throw new Error(`payment webhook not processed: ${JSON.stringify(res.outcome)}`);
  const parent = await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [orderId]);
  if (parent.status !== "processing") throw new Error(`expected processing, got ${parent.status}`);
  return { paymentId: intent.paymentId, providerReference: intent.providerReference };
}

export async function prepareChild(h: Harness, childOrderId: string, actorUserId: string) {
  await h.ordersService.confirmChildOrder({ childOrderId, actorUserId, actorRole: "supplier", supplierRole: "owner", idempotencyKey: makeId("idem_confirm_child") });
  await h.ordersService.startChildPreparation({ childOrderId, actorUserId, actorRole: "supplier", supplierRole: "owner", idempotencyKey: makeId("idem_prepare") });
}

/** Ships `pieces` of the child's single item and lets the carrier deliver it (quantity-evidenced delivery). */
export async function deliverPieces(h: Harness, ctx: SupplierContext, childOrderId: string, pieces: number, actor = supplierA(ctx)) {
  const items = await orderItemsForChild(h, childOrderId);
  const s = await createReadyShipment(h, ctx, { childOrderId, actor, items: [{ wholesaleOrderItemId: items[0].id, pieceQuantity: pieces }] });
  await h.shippingOrchestrator.handoff({ actor, shipmentId: s.shipment.id, idempotencyKey: makeId("h") });
  const delivered = await h.shippingOrchestrator.markDelivered({ actor: adminActor(ctx), shipmentId: s.shipment.id, idempotencyKey: makeId("d") });
  return { shipmentId: s.shipment.id, itemId: items[0].id, delivered };
}

/** Removes the only non-deterministic fields (timestamps) so two computations can be compared exactly. */
export function stripVolatile<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, v) => (key === "computedAt" || key === "checkedAt" ? undefined : v)),
  );
}

export async function readinessService(h: Harness) {
  const { SettlementReadinessService } = await import("../../src/modules/settlement-readiness/settlement-readiness.service");
  return h.app.get(SettlementReadinessService);
}

export function blockerCodes(readiness: any): string[] {
  return readiness.blockers.map((b: any) => b.code).sort();
}
