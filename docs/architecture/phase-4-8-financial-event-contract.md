# Phase 4.8 — Financial Event Contract (frozen in Phase 4.7.6)

Settlement consumes **facts**, never mutable state. Every event below is derived from immutable rows
that already exist (or are named as a 4.8 addition), carries a **deterministic identity** so a replay
posts nothing twice, and names the owner that emits it. Amounts are integer IRR strings; quantities are
integers; currency is always present and must be `IRR` (mismatch ⇒ reject, no FX).

Event identity = `sha256(canonical JSON of the identity fields)`; it is also the `source_event_id`
that is UNIQUE on `settlement_journal` (ADR). Events are emitted **inside the owner's transaction**
(outbox table owned by the settlement module or the emitter — decided in 4.8) so a crash cannot lose
or duplicate them.

## Events

### `ChildPaymentCovered`
| Field | Source |
|-------|--------|
| identity | `{type, childOrderId, proformaId, coveredByAllocationIds[sorted]}` |
| orderId, childOrderId, sellerId, supplierId (null ⇒ Kolbe) | `purchase_order` |
| proformaId, proformaVersion, payableAmount | active `wholesale_proforma` |
| coveredAmount, allocations[{paymentId, allocationId, amount, method, provider, verifiedAt}] | `payment_allocation` (verified, active) |
| currency | `IRR` |
| Emitted by | Payments, when Σ verified active allocations to the child's lineage first reaches the active proforma total (re-emitted with a new identity after a supersede raises the payable and is covered again) |
| Consumers | Settlement: opens/increases `buyer_funds_held(child)`; marks the child cash-covered |
| Not emitted for | credit/cod/manual releases (release ≠ cash) |

### `ChildQuantityDelivered`
| Field | Source |
|-------|--------|
| identity | `{type, shipmentId, wholesaleOrderItemId}` |
| orderId, childOrderId, sellerId, supplierId | `purchase_order` |
| wholesaleOrderItemId, pricingUnit, piecesPerUnit, unitPrice, lineTotal | proforma line (basis) + `wholesale_order_item.piece_quantity` |
| deliveredPieces (this shipment), cumulativeDeliveredPieces, cumulativeDeliveredUnits = floor(pieces / piecesPerUnit) | `shipment_item` over `delivered` shipments |
| deliveredAt, trigger (`shipping.shipment_delivered` \| carrier webhook \| reconciliation \| admin) | `shipment`, `order_status_history.metadata.trigger` |
| Emitted by | Shipping, in `applyDeliveredInTx` (first transition to `delivered` only; replays emit nothing) |
| Consumers | Settlement: posts `unit_price × (newCumulativeUnits − previouslyPostedUnits)` when the child is cash-covered (else parks it until `ChildPaymentCovered`) |
| Never emitted for | status-only delivery (`orders.child_deliver`) — no quantity evidence exists; such children need a real shipment or an explicit adjustment |

### `ChildQuantityRefunded`
| Field | Source |
|-------|--------|
| identity | `{type, refundId}` (one event per completed refund; lines inside) |
| orderId, childOrderId (null ⇒ order-scoped: unallocated money only), sellerId, supplierId | `refund`, `purchase_order` |
| lines[{wholesaleOrderItemId, quantity, unitPrice, lineTotal}] | `refund_line` |
| amount, sourcePayments[{paymentId, amount}] | `refund`, `refund_allocation` |
| deliveryBasis: `UNDELIVERED` \| `DELIVERED` \| `UNSPECIFIED_AMOUNT_ONLY` | FROZEN convention until an RMA flow exists: `fulfillment_exception_id` set (and of the same child — 4.7.6 check) ⇒ `UNDELIVERED`; lines without exception ⇒ `DELIVERED`; child-scoped amount-only refund ⇒ `UNSPECIFIED_AMOUNT_ONLY` |
| completedAt, externalReference | `refund` |
| Emitted by | Payments, in `completeRefund` (status → `completed`; ledger OUT written in the same transaction) |
| Consumers | Settlement: reduces `buyer_funds_held` (pre-entitlement) or posts a refund/post-settlement adjustment (exact slice); `UNSPECIFIED_AMOUNT_ONLY` reduces the child position by amount and raises an operator notice |

### `ShippingChargeFinalized`
| Field | Source |
|-------|--------|
| identity | `{type, childOrderId, proformaId(version with the fee)}` |
| childOrderId, sellerId, supplierId, quoteId, provider, amountChargedToBuyer | `shipping_quote`, superseding `wholesale_proforma.shipping_total` |
| physicalResponsibility | `purchase_order.shipping_responsibility` (informational only) |
| economicPolicy snapshot: `{shipping_charge_to_buyer, shipping_economic_recipient, shipping_cost_bearer, shipping_provider}` with policy ∈ supplier-entitled \| kolbe-retained \| carrier-pass-through \| subsidized \| zero \| unquoted | **4.8 addition**; until it exists the event carries `policy: "UNDEFINED"` and settlement must not post the fee anywhere (blocker `SHIPPING_ECONOMIC_OWNER_UNDEFINED`) |
| Emitted by | Finance orchestrator (`applyShippingFeeForChild`) after the proforma supersede |
| Rule | economic owner is **never inferred** from physical responsibility |

### `ComplianceEligibilityChanged`
| Field | Source |
|-------|--------|
| identity | `{type, supplierId, checkedAt, eligible, reasons[sorted]}` |
| supplierId, eligible, reasons[], policy{bankVerificationRequired} | `SupplierComplianceService.getSupplierSettlementEligibility` |
| Emitted by | Compliance on approval/contract/verification/bank/hold changes (or polled by settlement before payout) |
| Consumers | Settlement payout gate (`SUPPLIER_COMPLIANCE_BLOCKED`, `BANK_DESTINATION_NOT_VERIFIED`); never moves money by itself |

### `FinancialHoldPlaced` / `FinancialHoldReleased`
| Field | Source |
|-------|--------|
| identity | `{type, holdId}` |
| scope: supplier \| child \| payout; reason: compliance \| legal \| dispute \| chargeback \| manual; amount (optional: null ⇒ whole scope) | Compliance holds (`supplier_compliance_hold`, `legal_hold`) or 4.8 settlement holds |
| Emitted by | owner of the hold (Compliance for compliance/legal; Settlement for dispute/manual) |
| Consumers | Settlement: `supplier_available ↔ supplier_on_hold` postings; readiness `DISPUTE_OR_CHARGEBACK_HOLD` |

### `PayoutProviderResult`
| Field | Source |
|-------|--------|
| identity | `{type, payoutId, providerReference, status}` |
| payoutId, supplierId, requestedAmount, providerAmount, status: success \| failed \| pending \| reversed, providerReference, providerEventId, receivedVia: callback \| reconciliation | 4.8 `payout_provider_event` (mirrors `payment_provider_event`: append-only inbox, unique `(provider, external_event_id)`) |
| Emitted by | Settlement provider adapter (fake provider blocked in production, like payments/shipping) |
| Consumers | Settlement: `payout_in_transit → payout_settled` or `→ supplier_available` (failure); bank fee handling per decision log |
| Rule | amount/currency/reference must match the payout request (`PAYOUT_PROVIDER_AMOUNT_MISMATCH` …); a final payout is never re-opened by a later event (`already_final`) |

### `PaymentReversed` (chargeback readiness — documented, not implemented)
| Field | Source |
|-------|--------|
| identity | `{type, paymentId, providerEventId}` |
| paymentId, orderId, amount, reason, providerReference | new `payment_provider_event.event_type` values (`chargeback`, `reversal`, `dispute_opened/closed`) — **4.8 addition**; today `payment_provider_event` has no such type and a verified payment answers `already_final` |
| Emitted by | Payments (never mutating the verified payment; a reversal is a new fact) |
| Consumers | Settlement: `FinancialHoldPlaced(reason=chargeback)` on the affected children, then post-settlement adjustments once resolved |

## Ordering and idempotency guarantees

- Each event is emitted at most once per identity; consumers must treat duplicates as no-ops
  (UNIQUE `source_event_id`).
- `ChildQuantityDelivered` may arrive before `ChildPaymentCovered` (COD-like flows or late fee
  deltas): settlement parks the quantity and posts when coverage arrives; ordering between different
  children is irrelevant.
- `ChildQuantityRefunded` after a payout produces a negative carry-forward, never a rewrite.
- Events carry the **snapshot** values they were computed from (unit price, bps, policy refs); a later
  configuration change never changes an emitted event.
