/**
 * Kolbe Vintage — B2B Wholesale Operations domain model.
 *
 * Golden rule:  VIP Customer <-> Kolbe Vintage <-> Supplier
 * The VIP customer NEVER interacts with a supplier directly.
 *
 *   Customer Order   !=  Supplier Fulfillment
 *   Customer Payment !=  Supplier Settlement
 *   Order Total      !=  Supplier Payable
 *
 *   1 Order -> N Fulfillment Requests -> N Supplier Settlements
 */

export type OrderStatus =
  | "created"
  | "paid"
  | "processing"
  | "partially_fulfilled"
  | "shipped"
  | "delivered"
  | "inspection"
  | "completed"
  | "disputed"
  | "cancelled";

export type FulfillmentStatus =
  | "requested"
  | "accepted"
  | "preparing"
  | "ready_to_ship"
  | "shipped"
  | "delivered"
  | "rejected"
  | "cancelled";

export type EscrowStatus =
  | "held"
  | "frozen"
  | "ready"
  | "partially_released"
  | "released"
  | "refunded";

export type SettlementStatus =
  | "pending"
  | "scheduled"
  | "processing"
  | "paid"
  | "failed"
  | "partially_paid";

export type DisputeStatus =
  | "open"
  | "waiting_customer"
  | "waiting_supplier"
  | "under_review"
  | "resolved";

export type DisputeResolution =
  | "full_supplier_payment"
  | "partial_settlement"
  | "refund"
  | "replacement";

export type ShipmentStatus =
  | "pending"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "delayed";

export type CustomerSegment = "new" | "active" | "high_value" | "at_risk" | "dormant";

export type TimelineActor = "customer" | "kolbe" | "system" | "supplier" | "finance";

export interface VIPCustomer {
  id: string;
  name: string;
  company: string;
  city: string;
  tier: "platinum" | "gold" | "silver";
  segment: CustomerSegment;
  joinedAt: string;
  contact: string;
}

export interface Catalogue {
  id: string;
  name: string;
  season: string;
  category: string;
  views: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  catalogueId: string;
  category: string;
  unitPrice: number;
  supplierId: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  size: string;
  colour: string;
}

export interface Supplier {
  id: string;
  name: string;
  city: string;
  specialty: string;
  onboardedAt: string;
  commissionTier: number; // percent taken by Kolbe Vintage
  reliability: number; // 0..1 internal generator seed for behaviour
}

export interface SupplierProductMapping {
  supplierId: string;
  productId: string;
  leadTimeHours: number;
  supplierCost: number;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  variantId: string;
  supplierId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  code: string;
  customerId: string;
  catalogueId: string;
  createdAt: string;
  status: OrderStatus;
  items: OrderItem[];
  itemCount: number;
  total: number;
  refundTotal: number;
  deliveredAt?: string;
  inspectionEndsAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  paidAt: string;
  method: "bank_transfer" | "corporate_card" | "credit_line";
  reference: string;
}

export interface EscrowTransaction {
  id: string;
  orderId: string;
  status: EscrowStatus;
  amountHeld: number;
  amountReleased: number;
  amountRefunded: number;
  heldAt: string;
  readyAt?: string;
  releasedAt?: string;
  frozenAt?: string;
}

export interface FulfillmentItem {
  id: string;
  fulfillmentId: string;
  orderItemId: string;
  productId: string;
  quantity: number;
  supplierCost: number;
}

export interface FulfillmentRequest {
  id: string;
  code: string;
  orderId: string;
  supplierId: string;
  status: FulfillmentStatus;
  items: FulfillmentItem[];
  /** merchandise value charged to the customer for this slice of the order */
  customerValue: number;
  /** what Kolbe Vintage owes the supplier before commission/adjustments */
  supplierCostTotal: number;
  requestedAt: string;
  acceptedAt?: string;
  preparingAt?: string;
  readyAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  rejectedAt?: string;
  slaAcceptHours: number;
  slaPrepareHours: number;
  slaShipHours: number;
  delayed: boolean;
}

export interface Shipment {
  id: string;
  fulfillmentId: string;
  orderId: string;
  supplierId: string;
  carrier: string;
  trackingCode: string;
  status: ShipmentStatus;
  shippedAt: string;
  etaAt: string;
  deliveredAt?: string;
}

export interface Dispute {
  id: string;
  code: string;
  orderId: string;
  customerId: string;
  supplierId: string;
  fulfillmentId: string;
  reason: string;
  amountFrozen: number;
  openedAt: string;
  status: DisputeStatus;
  resolution?: DisputeResolution;
  resolvedAt?: string;
  assignedAdmin: string;
}

export interface Commission {
  id: string;
  orderId: string;
  fulfillmentId: string;
  supplierId: string;
  rate: number;
  base: number;
  amount: number;
  calculatedAt: string;
}

export interface SettlementAdjustment {
  id: string;
  settlementId: string;
  type: "refund" | "damage" | "late_penalty" | "other";
  label: string;
  amount: number;
}

export interface SupplierSettlement {
  id: string;
  code: string;
  orderId: string;
  fulfillmentId: string;
  supplierId: string;
  status: SettlementStatus;
  fulfilledAmount: number;
  commissionAmount: number;
  refundAmount: number;
  adjustments: SettlementAdjustment[];
  adjustmentTotal: number;
  payableAmount: number;
  dueAt: string;
  paidAt?: string;
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  orderId: string;
  at: string;
  actor: TimelineActor;
  label: string;
  detail?: string;
}

export interface WholesaleDataset {
  suppliers: Supplier[];
  customers: VIPCustomer[];
  catalogues: Catalogue[];
  products: Product[];
  variants: ProductVariant[];
  mappings: SupplierProductMapping[];
  orders: Order[];
  payments: Payment[];
  escrows: EscrowTransaction[];
  fulfillments: FulfillmentRequest[];
  shipments: Shipment[];
  disputes: Dispute[];
  commissions: Commission[];
  settlements: SupplierSettlement[];
  timeline: TimelineEvent[];
  generatedAt: string;
}
