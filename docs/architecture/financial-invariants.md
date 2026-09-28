# Financial Invariants (machine-testable) — Phase 4.7.6

Each invariant names its enforcement (DB / service / read-model) and the executable test that proves
it on a real PostgreSQL. "DB" means a constraint or trigger; "service" means the owner service rejects
the violating command; "read" means the settlement-readiness reconstruction reports it as a blocker.
Nothing below depends on Phase 4.8 code.

| Id | Invariant | Enforcement | Verified by |
|----|-----------|-------------|-------------|
| FI-1 | Seller identity is server-side: `purchase_order.seller_id` comes from the accepted terms; `supplier_id IS NULL` ⇔ Kolbe first-party; `seller` has exactly one `KOLBE` row and `KOLBE ⇔ supplier_id IS NULL`. No API accepts an external-supplier flag. | DB (CHECK + unique index) | `phase-4-7-6-financial-invariants` › FI-1 |
| FI-2 | Commercial terms are immutable once issued: issued proforma financial fields cannot be updated; lines, allocations, refund lines and shipment items have no update path. | DB (trigger for proforma) + convention | FI-9 currency test (P0001 on proforma), code review (matrix §3) |
| FI-3 | For every proforma line: `unit_price × quantity = line_total`, with `quantity` in the pricing unit (pieces for PIECE/PER_PIECE). Issuance fails closed otherwise (`PROFORMA_LINE_BASIS_INCONSISTENT`). | service | FI-3 (three tests) |
| FI-4 | Cash is order-level; a child is cash-covered iff Σ verified active allocations to its proforma lineage ≥ active proforma total. Σ allocations of a payment ≤ payment amount; the remainder is unallocated and never child-bound. | service (allocation) + read | FI-4/FI-5, S6, S15 |
| FI-5 | `financial_ledger_entry` is append-only; IN rows are order-level (`child_order_id NULL`); `SUM(IN) − SUM(OUT)` per order = verified − completed refunds; it is never used as a seller balance. | DB (triggers) + read (`ledgerMeaning`) | FI-4/FI-5, S1 |
| FI-6 | Delivered quantity per item = Σ `shipment_item.piece_quantity` over `delivered` shipments; a shipment cannot allocate more pieces than ordered (`SHIPMENT_QUANTITY_EXCEEDED`). | service (row locks at creation) | FI-6/FI-7 |
| FI-7 | Delivery is idempotent: replaying `markDelivered` (sequentially or concurrently) creates no additional evidence and exactly one `delivered` history row. | service (`applyDeliveredInTx`) | FI-6/FI-7, S18/S19 |
| FI-8 | Financial release ≠ cash: `credit_approved` / `cod_policy_approved` / `manual_authorized_release` create no payment, allocation or ledger row; a refund against them is impossible. | service | FI-8, S7/S8 |
| FI-9 | Refunds leave through the exact slice: child-scoped refunds ≤ child allocations − live child refunds; refund lines priced from the active proforma line and capped by ordered quantity; order-scoped refunds ≤ unallocated verified money − live order-scoped refunds (`REFUND_SCOPE_REQUIRED`). Currency must match (`CURRENCY_MISMATCH`; DB CHECK `IRR`). | service + DB | FI-9 (five tests), S20 |
| FI-10 | A refund citing a fulfillment exception cites an exception of the same child (`REFUND_EXCEPTION_CHILD_MISMATCH`), or none. | service (Finance orchestrator) | FI-9 |
| FI-11 | Sibling isolation: delivering/refunding child B changes nothing in child A's allocations, refunds, delivery evidence or readiness (except the parent status projection). | read | FI-11, S2/S5 |
| FI-12 | Kolbe first-party children are never settlement candidates: readiness returns no basis, `commission.amount = null`, `defaultBeforeConfiguration = "0"`, blocker `KOLBE_FIRST_PARTY`. | read | S1 |
| FI-13 | Entitlement preview is quantity-level and never negative: `entitledUnits = max(0, min(deliveredUnits, orderedUnits − refundedUndelivered) − refundedDelivered)`; exception-linked refund lines are undelivered quantity. | read | S3, S4/S13, S13b |
| FI-14 | Status-only delivery (`orders.child_deliver`) is not settlement evidence: `deliveryEvidence = STATUS_ONLY`, blocker `DELIVERY_EVIDENCE_MISSING`, preview 0. | read | FI-6/FI-7 (history), readiness status-only test |
| FI-15 | Shipping charged to the buyer is reported separately with `shippingEconomicOwner = UNDEFINED` and never enters the merchandise entitlement. | read | S9/S10 |
| FI-16 | Tax is never supplier cash: invoice `tax_total` is excluded from the basis; an active verified VAT rate or assessed tax raises `TAX_TREATMENT_UNVERIFIED`. | read | S11 |
| FI-17 | Readiness is computed from snapshots only: changing live offer prices, tiers or environment after the order does not change the result (`commission` stays `{amount:null, default "0"}`). | read | S12 |
| FI-18 | Replacement never transfers money or entitlement: the linked replacement order starts with zero allocations while the original keeps its cash facts. | service + read | S14 |
| FI-19 | Cancellation is not a financial event: a child cancelled before payment has a voided proforma, no payment, no release, no refund and no basis. | service + read | S17 |
| FI-20 | Readiness payloads never contain `supplierBalance`, `walletBalance`, `withdrawableBalance`, `availableBalance`, `pendingBalance`, `payoutAmount`, never contain float numbers, and always carry the label `NOT A SETTLEMENT BALANCE`. Reads write nothing. | read (defensive assertion in service) | hygiene assertions in every readiness test; "writes nothing" test |
| FI-21 | Readiness is admin-only over HTTP: supplier/buyer → 403, anonymous → 401, no supplier route; a forged `finance` claim is rejected (no such account role). | HTTP guard | HTTP security test |
| FI-22 | Money arithmetic is integer-only: `basisPoints(amount, bps, "half-up"|"down")` and `allocateProportionally(amount, weights)` (largest remainder, Σ parts = amount) reject floats and out-of-range bps. | shared library | `packages/shared/test/money.test.ts` |
| FI-23 | Cross-domain money conservation: for a multi-seller order, Σ child allocations + unallocated = Σ verified payments; Σ child refunds + order-scoped refunds = ledger OUT (completed) + pending; no child basis includes another child's amounts. | read | `phase-4-7-6-cross-domain-money-flow` |

## Invariants deliberately **not** claimed

- Legality of marketplace payouts, tax remittance or commission — LEGAL/TAX review items, never asserted from code.
- That the current ledger is balanced (it is single-entry cash evidence).
- That status-only delivered children are economically delivered (they are not, by FI-14).
- Any hold duration, minimum payout, cadence, commission rate or shipping policy value.
