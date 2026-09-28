# Phase 4.8 — Concurrency Model (frozen in Phase 4.7.6)

The current system already resolves the races that produce facts (payment webhook vs reconciliation,
duplicate delivery, duplicate handoff, duplicate refund completion — `phase-4-7-1-concurrency.test.ts`,
15 races). Phase 4.8 adds races between **fact consumption**, **settlement computation**, **withdrawal**
and **payout execution**. This document fixes how each is resolved. Mechanisms available today:
PostgreSQL row locks (`FOR UPDATE`), unique constraints as idempotency keys, `command_idempotency`
claims (TxA → provider → TxB), append-only triggers.

## 1. Race matrix

| # | Race | Resolution (frozen) | Guarantee | Verified today by |
|---|------|---------------------|-----------|-------------------|
| 1 | **Delivery vs refund** on the same item | Both are facts with independent identities (`shipmentId+itemId`, `refundId`). Settlement posts entitlement from `entitledUnits = max(0, min(delivered, ordered − refundedUndelivered) − refundedDelivered)` computed **inside the consumer transaction that holds the child's `settlement_account` row lock**; the two journals serialize on that lock, so the second one sees the first's postings and posts only the delta. | Σ postings for the item never exceed `unit_price × ordered` and never go below the exact slice | Facts side: FI-6/FI-7 (delivery idempotent), FI-9 (refund caps) |
| 2 | **Two deliveries** (two shipments, or one replayed) | Shipping: `applyDeliveredInTx` locks shipment + child; a second transition on the same shipment is a replay (`replayed: true`), emitting nothing. Two different shipments emit two events with different identities; the consumer posts cumulative delta under the child lock. | one event per (shipment, item); cumulative units ≤ ordered (createShipment caps pieces ≤ ordered under child lock) | FI-6/FI-7, S18/S19, race #8 of 4.7.1 |
| 3 | **Refund vs settlement calculation** | Settlement never "calculates" from mutable totals; it consumes `ChildQuantityRefunded` (emitted in `completeRefund`'s transaction). If the refund completes after entitlement was posted, the consumer posts a `refund_adjustment`; if before, it reduces `buyer_funds_held`. Both paths hold the child account lock. A refund *requested* but not completed does not move settlement money; readiness shows `REFUND_PENDING` and payout for that child's slice is blocked. | no double reduction; no lost reduction | S4 (pending vs completed) |
| 4 | **Two withdrawals** for one supplier | `SELECT … FOR UPDATE` on the supplier's `supplier_available` account row; available = derived balance computed **inside** the lock; second request sees the first's `payout_request` journal and fails with `INSUFFICIENT_AVAILABLE`. `withdrawal_request` has UNIQUE `(supplier_id, idempotency_key)`. | Σ in-flight + settled payouts ≤ Σ available credits | pattern identical to refund creation locking verified payments (`FOR UPDATE`) — FI-9 |
| 5 | **Withdrawal vs compliance hold** | Hold placement and withdrawal acceptance both take the supplier account lock; the hold posts `available → on_hold` first-come-first-served. A withdrawal accepted before the hold is not clawed back automatically (payout in transit) — the hold blocks *future* availability and readiness flags `DISPUTE_OR_CHARGEBACK_HOLD`/compliance blockers; provider result still settles or reverses the in-flight payout. | never a negative available balance caused by the hold; in-flight payouts finish deterministically | Compliance holds append-only + release-only triggers (0022) |
| 6 | **Payout retry vs reconciliation** | TxA: claim `command_idempotency` (scope payout, state pending) + post `payout_request` (available → in_transit) and persist `provider_reference` before calling the provider. Provider call outside any lock. TxB: post result by `PayoutProviderResult` identity; the inbox UNIQUE `(provider, external_event_id)` and `already_final` on the payout row make callback vs reconciliation vs retry converge to one result. A retry after a crash between TxA and provider **resumes** the same claim (idempotent provider call keyed by our `payout.id`), never creates a second payout. | exactly one provider transfer per payout id; exactly one settled/reversed posting | mirrors payment intent flow (TxA→provider→TxB) and reconciliation tests (4.7.1 race #2, shipping #11) |
| 7 | **Payout success vs refund** (refund completes while payout in transit or after settled) | Refund is never blocked by a payout; it posts a `post_settlement_adjustment` debiting `supplier_available`, which may go negative ⇒ carry-forward that future entitlements offset first (decision log: recovery policy). No payout is reversed by the refund. | supplier history immutable; buyer refund never delayed by settlement state | S4/S13 (preview floors at 0; refunds recorded regardless) |
| 8 | **Settlement calculation vs commission config change** | Commission bps and basis are **snapshotted per child** at the moment the first entitlement journal for that child is posted (`commission_snapshot`); later config changes create a new policy version that applies only to children first entitled after `effective_at`. The posting reads the snapshot, never the live policy. | not retroactive; deterministic replays | S12 (live price/env changes do not alter readiness) |
| 9 | Duplicate `ChildPaymentCovered` (webhook + reconciliation verify the same payment) | Payments already guarantees one verification (inbox + `already_final`); the event identity includes the allocation ids ⇒ UNIQUE `source_event_id`. | one coverage journal | 4.7.1 races #1/#2 |
| 10 | Order-scoped refund vs child refund | Both lock the order's verified payments `FOR UPDATE` (existing); ceilings are disjoint by construction (unallocated vs allocated) — 4.7.6 fix. | no over-refund across scopes | FI-9 |

## 2. Payout execution: TxA → provider → TxB with crash recovery

```
TxA (one transaction, supplier account row locked)
  1. claim command_idempotency(scope=payout, key)          → pending (replay ⇒ resume/return)
  2. assert available ≥ amount (derived inside the lock), compliance eligible, no hold
  3. insert payout(id, status=processing, provider_reference=payout.id-derived, amount)
  4. post journal payout_request: supplier_available → payout_in_transit
COMMIT
Provider call (no DB lock held): transfer(payout.id, amount, destination)  — idempotent on payout.id
TxB
  5. lock payout row; if status already final ⇒ return (already_final)
  6. insert payout_provider_event (UNIQUE provider+event id)  — from callback, poll or reconciliation
  7. post payout_settled (in_transit → settled) or payout_reversal (in_transit → available)
  8. complete command_idempotency
COMMIT
```

Crash points and recovery:

| Crash after | State | Recovery |
|-------------|-------|----------|
| step 1–4 before COMMIT | nothing persisted | retry starts fresh |
| TxA committed, before provider call | payout `processing`, money `in_transit` | reconciliation job (or retry with same key) resumes: asks provider by `payout.id`; if unknown ⇒ call it now; if known ⇒ go to TxB |
| provider call done, before TxB | provider has transferred; DB says `processing` | reconciliation queries provider status by `payout.id` and runs TxB; the callback, if it arrives, does the same and the second one is `already_final` |
| TxB partially | atomic — either all of 5–8 or none | retry TxB |

The pattern is the same one used for payment intents and shipment creation today (`claimCommand`,
`resumePending`, `failCommand`), so no new concurrency primitive is needed.

## 3. Three separate reconciliations (never merged into one job)

| Reconciliation | Compares | Owner | Outcome on mismatch |
|----------------|----------|-------|---------------------|
| **Cash reconciliation** | provider statements / bank evidence vs `payment` (verified) and `refund` (completed); ledger `IN − OUT` per order | Payments | operator task; never auto-adjusts settlement |
| **Settlement reconciliation** | Σ settlement postings per child vs the read-only readiness projection (`merchandiseEntitledPreview` at policy 0 + snapshotted commission) and Σ `buyer_funds_held` vs Σ verified allocations − refunds | Settlement | blocks payout for the affected supplier (`FinancialHoldPlaced(reason=manual)`) until an explicit adjustment journal explains the difference |
| **Payout reconciliation** | `payout` rows in `processing` vs provider status by `payout.id`; `payout_provider_event` inbox | Settlement (provider adapter) | resumes TxB (success/failed); stale `processing` beyond a configurable window ⇒ operator alert (no auto-reversal) |

All three are read-only until an operator or an explicit journal acts; none of them mutates a
verified payment, a completed refund, a delivered shipment or a posted journal.

## 4. Locks and ordering discipline (to avoid deadlocks)

Lock order inside any settlement transaction: `supplier settlement account` → `child settlement
account` → `payout` row. Owner-side locks (order/child/shipment/payment) are taken only by owner
services in their own transactions; settlement consumers never lock Payments/Orders/Shipping rows.
