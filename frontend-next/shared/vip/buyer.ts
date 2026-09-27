import type { ApiClient } from "../http/types";

export type BuyerOrder = { id: string; orderCode: string; status: string; currency: string; grandTotal: string; totalUnits: number; createdAt: string; version?: number; itemsTotal?: string; shippingTotal?: string; paymentMode?: string };
export type BuyerOrderDetail = { order: BuyerOrder; items: Array<{ id: string; productNameSnapshot?: string; skuSnapshot?: string; quantity: number; pieceQuantity?: number; unitPrice: string; lineTotal: string; currency: string }>; children: Array<{ id: string; orderCode: string; status: string; grandTotal: string; shippingResponsibility?: string }>; exceptions: Array<Record<string, unknown>>; links: Array<Record<string, unknown>> };
export type BuyerShipment = { id: string; shipmentCode: string; status: string; carrierDisplayName?: string | null; trackingCode?: string | null; trackingUrl?: string | null; shippedAt?: string | null; deliveredAt?: string | null; items?: Array<{ wholesaleOrderItemId: string; pieceQuantity: number }> };
export type BuyerInvoice = { id: string; invoiceNumber: string; status: string; currency: string; grandTotal: string; issuedAt?: string | null; voidedAt?: string | null; lines?: Array<{ lineNo: number; description: string; quantity: number; unitPrice: string; lineTotal: string; currency: string }> };
export type BuyerAddress = { id: string; label: string; recipientName: string; recipientPhone: string; province: string; city: string; addressLine: string; plaque?: string | null; unit?: string | null; postalCode: string; isDefault: boolean; version: number; createdAt: string; updatedAt: string };
export type AddressInput = Omit<BuyerAddress, "id" | "version" | "createdAt" | "updatedAt">;
export type BuyerSupportCase = { id: string; publicReference: string; subject: string; category: string; priority: string; status: string; createdAt: string; updatedAt: string };
export type SupportMessage = { id: string; body: string; authorType: string; authorDisplayName?: string | null; createdAt: string };
export type BuyerRequest = { id: string; productId: string; offerId: string; variantId?: string | null; packageId?: string | null; quantity: number; status: string; rejectionReason?: string | null; version: number; acceptedAt?: string | null; acceptanceExpiresAt?: string | null; createdAt: string; updatedAt: string };
export type BuyerRequestRevision = { id: string; requestId: string; revisionNumber: number; proposedQuantity?: number | null; proposedVariantId?: string | null; proposedPackageId?: string | null; proposedUnitPrice?: string | null; pricingUnit?: string | null; currency?: string; reason?: string | null; buyerResponse?: string | null; buyerRespondedAt?: string | null; createdAt: string };
export type VipPlan = { id: string; name: string; slug?: string; price: string; durationDays: number; features?: unknown; limits?: unknown; status: string };

const money = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "0";
const key = () => globalThis.crypto.randomUUID();

export function buyerApi(client: ApiClient) {
  return {
    async orders(cursor?: string) { const data = await client.request<{ orders: BuyerOrder[]; nextCursor: string | null; hasMore: boolean }>("/wholesale/orders", { query: { limit: 20, ...(cursor ? { cursor } : {}) } }); return { ...data, orders: data.orders.map((o) => ({ ...o, grandTotal: money(o.grandTotal) })) }; },
    order(id: string) { return client.request<BuyerOrderDetail>(`/wholesale/orders/${encodeURIComponent(id)}`); },
    timeline(id: string) { return client.request<{ orderId: string; timeline: Array<{ id?: string; type: string; occurredAt?: string; createdAt?: string; title?: string; description?: string }> }>(`/wholesale/orders/${encodeURIComponent(id)}/timeline`); },
    shipments(id: string) { return client.request<{ shipments: BuyerShipment[] }>(`/wholesale/orders/${encodeURIComponent(id)}/shipments`); },
    invoices(id: string) { return client.request<{ invoices: BuyerInvoice[] }>(`/invoicing/wholesale/${encodeURIComponent(id)}`); },
    invoice(id: string) { return client.request<{ invoice: BuyerInvoice }>(`/invoicing/invoices/${encodeURIComponent(id)}`); },
    cancelOrder(id: string, reason: string, expectedVersion?: number, idempotencyKey = key()) { return client.request<{ order: BuyerOrder; replayed: boolean }>(`/wholesale/orders/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: { reason, expectedVersion } }); },
    createOrder(request: BuyerRequest, address: BuyerAddress, paymentMode: string, idempotencyKey = key()) { const snapshot = { name: address.recipientName, phone: address.recipientPhone, province: address.province, city: address.city, addressLine: address.addressLine, plaque: address.plaque, unit: address.unit, postalCode: address.postalCode }; return client.request<{ order: BuyerOrder; replayed: boolean }>("/wholesale/orders", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: { requests: [{ requestId: request.id, expectedVersion: request.version }], paymentMode, shippingAddress: snapshot, billingAddress: snapshot } }); },
    addresses() { return client.request<{ addresses: BuyerAddress[] }>("/customer/addresses"); },
    createAddress(input: AddressInput) { return client.request<BuyerAddress>("/customer/addresses", { method: "POST", body: input }); },
    updateAddress(id: string, input: AddressInput, version: number) { return client.request<BuyerAddress>(`/customer/addresses/${encodeURIComponent(id)}`, { method: "PATCH", body: { ...input, version } }); },
    defaultAddress(id: string) { return client.request<BuyerAddress>(`/customer/addresses/${encodeURIComponent(id)}/make-default`, { method: "POST" }); },
    deleteAddress(id: string) { return client.request<void>(`/customer/addresses/${encodeURIComponent(id)}`, { method: "DELETE", response: "void" }); },
    supportCases(offset = 0) { return client.request<{ cases: BuyerSupportCase[]; total: number }>("/vip/support/cases", { query: { limit: 20, offset } }); },
    supportCase(id: string) { return client.request<{ case: BuyerSupportCase; messages: SupportMessage[]; relations: Array<Record<string, unknown>> }>(`/vip/support/cases/${encodeURIComponent(id)}`); },
    createSupportCase(input: { category: string; subject: string; priority: string; initialMessage?: string }) { return client.request<BuyerSupportCase>("/vip/support/cases", { method: "POST", body: input }); },
    addSupportMessage(id: string, body: string, idempotencyKey = key()) { return client.request<SupportMessage>(`/vip/support/cases/${encodeURIComponent(id)}/messages`, { method: "POST", body: { body, idempotencyKey } }); },
    requests(offset = 0) { return client.request<{ requests: BuyerRequest[]; total: number }>("/wholesale/requests", { query: { limit: 20, offset } }); },
    requestRevisions(id: string) { return client.request<{ revisions: BuyerRequestRevision[] }>(`/wholesale/requests/${encodeURIComponent(id)}/revisions`); },
    acceptRevision(request: BuyerRequest, revisionId: string, idempotencyKey = key()) { return client.request(`/wholesale/requests/${encodeURIComponent(request.id)}/revisions/${encodeURIComponent(revisionId)}/accept`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: { expectedVersion: request.version } }); },
    rejectRevision(request: BuyerRequest, revisionId: string, reason: string, idempotencyKey = key()) { return client.request(`/wholesale/requests/${encodeURIComponent(request.id)}/revisions/${encodeURIComponent(revisionId)}/reject`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: { reason } }); },
    cancelRequest(id: string, reason: string, expectedVersion: number, idempotencyKey = key()) { return client.request(`/wholesale/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: { reason, expectedVersion } }); },
    plans() { return client.request<VipPlan[]>("/vip/plans"); },
    subscribe(planId: string) { return client.request<{ id: string; status: string; planId: string }>("/vip/subscribe", { method: "POST", body: { planId } }); },
  };
}
