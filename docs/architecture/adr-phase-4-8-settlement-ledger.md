# ADR — Phase 4.8 Settlement Ledger Architecture

**Status:** ACCEPTED as the frozen design for Phase 4.8 (decided in Phase 4.7.6; Phase 4.8 has NOT
started and no code from this ADR exists yet).
**Deciders:** Phase 4.7.6 architecture freeze.
**Inputs:** `phase-4-7-6-financial-audit-matrix.md`, `financial-invariants.md`, `marketplace-money-flow.md`.

## Context

Kolbe Vintage is a marketplace: a buyer pays a **parent** wholesale order whose **children** belong to
different sellers (Kolbe first-party or external suppliers). Today the repository has:

- immutable commercial terms per child (`wholesale_proforma_line`),
- order-level cash evidence (`payment`, `payment_allocation`, append-only single-entry
  `financial_ledger_entry`),
- quantity-evidenced delivery (`shipment_item.piece_quantity` on `delivered` shipments),
- exact-slice refunds (`refund_line`),
- compliance eligibility (`getSupplierSettlementEligibility`),
- **no** supplier balance, wallet, settlement, withdrawal, payout, commission or hold policy.

Phase 4.8 must record what each supplier has *earned*, what is *available*, what was *paid out*, and
must survive refunds after settlement, provider retries, and concurrent operations — without ever
turning the existing cash-evidence journal into something it is not.

## Options considered

### Option A — Mutable balance column (`supplier_account.balance`)

`UPDATE supplier_account SET balance = balance + x` on each event; withdrawals subtract.

- ✅ trivial reads.
- ❌ no audit trail without a parallel log; history rewritten by every update.
- ❌ lost-update and double-credit risks under concurrency (delivery replay, refund vs payout) unless
  every path locks the same row; still no proof of conservation.
- ❌ negative positions, post-settlement refunds and reconciliation cannot be explained from the
  column alone.
- ❌ violates the frozen rule "admin overrides only as explicit adjustments" (there is nothing explicit).

**Rejected.**

### Option B — Single-entry supplier ledger (extend `financial_ledger_entry` with a supplier dimension)

Add `supplier_id`/`entry_type` values (`earning`, `commission`, `payout`) to the existing journal and
compute balances as `SUM(IN) − SUM(OUT)` per supplier.

- ✅ append-only already enforced by triggers.
- ❌ the existing journal is **buyer-cash evidence of an order** (IN = verified payment, OUT = completed
  refund). Mixing supplier earnings into it makes `IN − OUT` meaningless for both purposes.
- ❌ single-entry cannot prove conservation: nothing forces "buyer funds held − supplier earnings −
  Kolbe commission − refunds = 0".
- ❌ retrofitting a "GL" onto a journal that was explicitly documented as *not* a GL contradicts the
  4.7.6 glossary and would be read as a general ledger by finance staff.

**Rejected** (the frozen rule: do not retrofit the payment ledger; do not use its `IN − OUT` as a
supplier balance).

### Option C — Separate balanced double-entry **settlement subledger** ✅

New tables owned by a new `settlement` module (Phase 4.8):

```
settlement_account  (id, kind, owner_type, owner_id, currency 'IRR', status)
                    kinds: buyer_funds_held(order|child), supplier_pending_earnings(supplier),
                           supplier_available(supplier), supplier_on_hold(supplier),
                           kolbe_commission_revenue, kolbe_first_party_revenue(optional, out of settlement),
                           shipping_<policy-named>, payout_in_transit(supplier), payout_settled(supplier),
                           rounding_residue, adjustments_clearing
settlement_journal  (id, journal_type, source_event_id UNIQUE, source_ref{child,item,qty,refund,payout…},
                     snapshot{unit_price, commission_bps, policy refs}, posted_at, posted_by, reason)
settlement_posting  (id, journal_id, account_id, direction DEBIT|CREDIT, amount BIGINT > 0, currency)
```

Invariants (DB-enforced where possible, tested always):

1. For every journal: `SUM(debits) = SUM(credits)` (deferred constraint trigger).
2. Postings and journals are **append-only** (triggers, like the compliance evidence tables).
3. `source_event_id` is UNIQUE ⇒ replaying `ChildQuantityDelivered` or a provider callback cannot post
   twice (idempotency by deterministic event identity, see the event contract).
4. Amounts are integer IRR > 0; direction carries the sign; currency of all postings in a journal is
   equal and equals the account currency (`CURRENCY_MISMATCH` otherwise).
5. Balances are **derived views** (`SUM(credit) − SUM(debit)` per account) — never stored as a mutable
   column. A materialised snapshot table may cache them with the last journal id, rebuildable at any
   time.
6. The subledger is **not** the statutory general ledger and is not a substitute for the accounting
   system; it is the marketplace settlement position. It never reads `financial_ledger_entry` as a
   balance; it consumes *events* derived from immutable facts.

Reads for the user-facing terms: *Pending earnings* = balance of `supplier_pending_earnings`;
*Available for settlement* = `supplier_available`; *Amount on hold* = `supplier_on_hold` (+ negative
carry-forward); *Settlement pending* = `payout_in_transit`; *Settled* = `payout_settled`.

## Decision

**Option C.** Phase 4.8 implements a separate, balanced, append-only settlement subledger
(`settlement_account` / `settlement_journal` / `settlement_posting`) owned by a new `settlement`
module; the existing `financial_ledger_entry` stays exactly what it is (order cash evidence).

### Posting rules frozen by this ADR

| Fact (event) | Journal | Debit | Credit | Amount |
|--------------|---------|-------|--------|--------|
| `ChildPaymentCovered` | `funds_held` | buyer cash clearing (evidence only, optional) | `buyer_funds_held(child)` | Σ verified allocations to the child (from Payments facts; never re-derived from parent paid amount) |
| `ChildQuantityDelivered` (supplier child, cash covered) | `entitlement` | `buyer_funds_held(child)` | `supplier_pending_earnings(supplier)` | `unit_price × entitledUnitsDelta` (proforma line snapshot) |
| same, commission | `commission` | `supplier_pending_earnings` | `kolbe_commission_revenue` | `basisPoints(entitledValueDelta, snapshotted bps, snapshotted rounding)` — default 0 |
| `ChildQuantityDelivered` (Kolbe child) | — | — | — | **no posting** (first-party revenue is not a marketplace settlement) |
| `ChildQuantityRefunded` before entitlement | `refund_release` | `buyer_funds_held(child)` | buyer refund clearing | exact slice |
| `ChildQuantityRefunded` after entitlement, before payout | `refund_adjustment` | `supplier_pending_earnings` / `supplier_available` | buyer refund clearing (+ reverse commission if policy says so — BUSINESS_DECISION_REQUIRED) | exact slice |
| `ChildQuantityRefunded` after payout | `post_settlement_adjustment` | `supplier_available` (may go negative ⇒ carry-forward) | buyer refund clearing | exact slice; history untouched |
| Hold elapsed (configurable) | `availability` | `supplier_pending_earnings` | `supplier_available` | per journal that matured |
| `FinancialHoldPlaced/Released` | `hold` | `supplier_available` ↔ `supplier_on_hold` | | amount named by the hold |
| Withdrawal accepted | `payout_request` | `supplier_available` | `payout_in_transit` | requested amount ≤ available |
| `PayoutProviderResult(success)` | `payout_settled` | `payout_in_transit` | `payout_settled` | provider-confirmed amount |
| `PayoutProviderResult(failed)` | `payout_reversal` | `payout_in_transit` | `supplier_available` | same amount |
| Rounding residue | `rounding` | `rounding_residue` | (or reverse) | ≤ 1 IRR per split (largest remainder makes this rare) |
| Admin override | `manual_adjustment` | explicit accounts | | reason + actor mandatory; never edits prior journals |

### Non-goals restated

No wallet top-up, no customer wallet, no supplier-to-supplier transfer, no provider split payment,
no scheduler-driven automatic settlement, no FX, no float arithmetic, no statutory GL.

## Consequences

- Payments, Orders, Shipping, Compliance keep their tables; the settlement module **consumes** their
  facts through the event contract and owns only its three tables (+ policy/config tables).
- Every number shown to a supplier is a derived balance of an append-only journal and can be audited
  back to a child/item/quantity, a refund or a payout reference.
- Concurrency is handled by deterministic event identities (uniqueness) plus per-supplier account
  locking for withdrawal (see `phase-4-8-concurrency-model.md`), not by row-level balance updates.
- The readiness computation of 4.7.6 becomes the *replayable projection* Phase 4.8 tests against:
  Σ postings for a child must equal the readiness `merchandiseEntitledPreview` when policies are 0.

## Rejected retrofits (explicitly)

- Renaming `financial_ledger_entry` to "general ledger".
- Adding `supplier_id`/`balance` columns to `payment`, `refund` or `financial_ledger_entry`.
- Deriving a payout from `commercial_invoice.grand_total` or `wholesale_order.grand_total`.
