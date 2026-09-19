# Marketplace Money Flow — current (4.7.x) vs Phase 4.8 target

Phase 4.8 has **NOT** started. Section 1 describes the repository as it is; section 2 is the frozen
target the Phase 4.8 ADR must implement; section 3 is a worked example run against the real code by
`apps/api/test/phase-4-7-6-settlement-readiness.test.ts` (S1) and
`apps/api/test/phase-4-7-6-cross-domain-money-flow.test.ts`.

## 1. Current flow (what the code does today)

```
buyer accepts VIP terms ──► wholesale_request.accepted_terms_snapshot (price, unit, quantity, pieces)
        │
        ▼ OrdersService.createWholesaleOrder (one tx, idempotent)
wholesale_order (buyer transaction, grand_total)  ─┬─ purchase_order (child, seller_id/supplier_id)
                                                   │     └─ purchase_order_item → wholesale_order_item (immutable line snapshot)
                                                   └─ inventory reservations (Inventory)
        │
        ▼ buyer confirm  (WholesaleFinanceOrchestrator.confirmOrder)
wholesale_proforma (one `issued` per child) + wholesale_proforma_line   ← COMMERCIAL TERMS SNAPSHOT
        │
        ▼ buyer pays the PARENT (transfer / online intent)          payment (order-level, pending)
        ▼ admin verify | provider webhook/reconciliation (TxA→provider→TxB)
payment.status = verified
   ├─ payment_allocation rows (payment → proforma, deterministic, capped; remainder = unallocated)
   ├─ financial_ledger_entry IN `payment_verified` (order-level, child NULL)
   └─ order_financial_release `payment_verified` when every issued proforma is covered  ⇒ parent `processing`
        │                        (alternatives: credit_approved / cod_policy_approved / manual — NO cash)
        ▼ supplier accepts, prepares; requests carrier quote; admin/finance selects
wholesale_proforma v2 (superseded v1 → issued v2 with shipping_total)  ⇒ delta obligation for the buyer
        ▼ supplier creates shipment (items with piece_quantity ≤ ordered) → handoff (inventory consumed once)
        ▼ carrier delivered (webhook/reconciliation/admin)  ⇒ shipment.status = delivered
shipment_item.piece_quantity  ← QUANTITY EVIDENCE per wholesale_order_item; child `delivered` when complete
        │
        ▼ admin/finance refund (child + lines)  ⇒ refund + refund_allocation (source payments) + refund_line
refund completed ⇒ financial_ledger_entry OUT `refund_completed`
        │
        ▼ admin issues commercial_invoice per child (subtotal, shipping, tax if a VERIFIED rate is active)
```

What does **not** exist: supplier wallet, supplier balance, settlement batch, withdrawal, payout,
commission policy, hold policy, shipping economic owner, chargeback/reversal fact, discount.

### 1.1 Who economically owns what today (facts, not policy)

| Money | Owner today | Evidence |
|-------|-------------|----------|
| Verified payment | Kolbe holds buyer cash for the **order**; attribution to children only through `payment_allocation` | FI-4 test |
| Unallocated paid | Buyer's money held by Kolbe (overpayment / voided lineage); refundable order-scoped only | FI-9, S6 |
| Allocated to a supplier child | Buyer cash earmarked for that child's terms — **not yet** a supplier payable (no delivery/hold/commission logic exists) | S3, S7 |
| Allocated to a Kolbe child | Kolbe first-party revenue; excluded from any supplier settlement | S1 |
| Shipping fee | Buyer charge; economic recipient/cost bearer **undefined** | S9 |
| Tax on invoice | Not collected from the buyer today (obligation excludes it); never supplier cash | S11 |
| Completed refund | Returned to the buyer from the exact slice (child/item/quantity) or from unallocated money | FI-9, S4 |

## 2. Phase 4.8 target flow (frozen shape; details in the ADR / event contract / decisions log)

```
Immutable facts (owned by Payments / Shipping / Compliance / Orders)         Settlement subledger (4.8, balanced)
──────────────────────────────────────────────────────────────────         ─────────────────────────────────────
ChildPaymentCovered(childId, proformaId, coveredAt)          ─┐
ChildQuantityDelivered(childId, itemId, pieces, shipmentId)  ─┼─► entitlement recorder ─► postings:
ChildQuantityRefunded(childId, itemId, units, refundId)      ─┤     buyer_funds_held  → supplier_pending_earnings   (unit_price × entitledUnits)
ShippingChargeFinalized(childId, amount, policy snapshot)    ─┤     supplier_pending_earnings → kolbe_commission_revenue (basisPoints(…, snapshot bps))
ComplianceEligibilityChanged(supplierId, eligible, reasons)  ─┤     supplier_pending_earnings → supplier_available   (after configurable hold)
FinancialHoldPlaced/Released(supplierId|childId, reason)     ─┤     supplier_available → supplier_on_hold           (holds, negative carry-forward)
PayoutProviderResult(payoutId, status, reference)            ─┘     supplier_available → payout_in_transit → settled (TxA→provider→TxB)
Post-settlement refund  ⇒ adjustment posting (debit supplier_available / carry-forward negative), history immutable
```

Rules that are already frozen (see `phase-4-8-decisions.md`): parent = buyer transaction; entitlement at
seller/child/item/quantity from immutable snapshots; Kolbe first-party ⇒ no payable, commission 0;
commission default 0 until configured and snapshotted; payment ≠ entitlement; release ≠ cash;
milestone = cash covered **and** quantity-evidenced delivered ⇒ pending, available after a
configurable hold; refunds reduce only the exact slice; post-settlement refunds are adjustments;
replacement is an explicitly linked new order; cancellation is not a financial event; unallocated
money is never supplier money; the current ledger `IN − OUT` is never a supplier balance; withdrawal
= payout request; deterministic integer bps rounding; currency mismatch rejected; no FX.

## 3. Worked example — Parent 100,000,000 IRR = Kolbe 40M + Supplier A 35M + Supplier B 25M

Executed by test S1 (`phase-4-7-6-settlement-readiness.test.ts`) with real rows: Kolbe offer
10,000,000 × 4 pieces, A 7,000,000 × 5, B 5,000,000 × 5, paid through the fake provider webhook.

### 3.1 After payment verification (today)

| Row / fact | Value |
|------------|-------|
| `wholesale_order.grand_total` | 100,000,000 (buyer transaction) |
| `payment` (verified, order-level) | 100,000,000 |
| `payment_allocation` → Kolbe child proforma | 40,000,000 |
| `payment_allocation` → A proforma | 35,000,000 |
| `payment_allocation` → B proforma | 25,000,000 |
| unallocated | 0 |
| `financial_ledger_entry` | one IN 100,000,000, `child_order_id NULL` |
| `order_financial_release` | one `payment_verified` |
| Readiness Kolbe child | `settlementCandidate=false`, blocker `KOLBE_FIRST_PARTY`, basis "0", commission `{amount:null, defaultBeforeConfiguration:"0"}` — but `cashCoverage.childPayable=allocatedVerified=40,000,000` (the buyer did pay it) |
| Readiness A | candidate, `merchandiseOrdered=35,000,000`, covered, blockers `CHILD_NOT_DELIVERED`, `COMMISSION_POLICY_UNDEFINED`, `HOLD_POLICY_UNDEFINED`, compliance reasons for the fixture supplier |
| Readiness B | candidate, `merchandiseOrdered=25,000,000`, same blockers |

Nothing is owed to A or B yet: cash is covered but no quantity is delivered.

### 3.2 Partial fulfilment (cross-domain test)

| Event | A (5 × 7M) | B (5 × 5M) | Kolbe |
|-------|------------|------------|-------|
| A delivers 5 pieces (shipment → handoff → carrier delivered) | delivered 35,000,000; `entitledPreview=35,000,000`; `PARTIAL_FULFILLMENT` absent | unchanged | excluded |
| B delivers 3 of 5 | — | delivered 15,000,000; `entitledPreview=15,000,000`; `PARTIAL_FULFILLMENT` | excluded |
| Refund B 1 piece (no exception ⇒ post-delivery basis), completed | unchanged (S2 proves byte-equality) | refunded 5,000,000; `entitledPreview=10,000,000` | excluded |
| Ledger | IN 100,000,000 / OUT 5,000,000 — order-level, **not** a per-seller balance | | |

### 3.3 What Phase 4.8 would post for the same facts (illustrative, commission rate NOT decided)

With a hypothetical snapshotted commission of *X* bps (default 0 until configured):

```
A: supplier_pending_earnings  +35,000,000 ; kolbe_commission_revenue +basisPoints(35,000,000, X) ; A pending −that
B: supplier_pending_earnings  +15,000,000 (3 pieces) ; later refund adjustment −5,000,000 (exact slice)
Kolbe child: no supplier account touched (first-party revenue is not a marketplace settlement)
Shipping fee (if any): posted to the account named by the snapshotted shipping policy — never inferred
Tax: never posted to a supplier account
Σ debits == Σ credits for every journal; buyer_funds_held decreases only by postings that name a child/item/quantity or a refund
```

No number in 3.3 is a business commitment; rate, hold and shipping policy are open decisions.
