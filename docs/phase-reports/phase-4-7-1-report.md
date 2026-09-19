# Phase 4.7.1 — Payment & Shipping Correctness, Concurrency & Verification Hardening — Report

**Requested branch:** `arena/01a0ad1f-kolbevintage-services` (HEAD `a870bce4c92fc7a18c8ef7e69c482c1e87fbe783`, CI 35431312317 SUCCESS)
**Actual branch:** `arena/01a0b926-kolbevintage-services` — this Arena session is pinned to that branch name; it was created from the very same HEAD `a870bce4…` and every 4.7.1 commit was pushed there. The remote has **no** `arena/01a0ad1f-kolbevintage-services` branch (it was never pushed), so nothing on it was bypassed. No `main` interaction, no history rewrite, no force push, no PR.
**Starting SHA:** `a870bce4c92fc7a18c8ef7e69c482c1e87fbe783` (phase 4.7 GREEN: 21 migrations, 61 tables, 140 FKs, 174 CHECKs, 608 tests)
**Ending SHA (code):** `09fe78da65d11c28a6209451bc6384792a373383` (+ this report commit)
**Date:** 2026-09-19
**Migration:** `packages/database/migrations/0021_phase_4_7_1_provider_shipping_hardening.sql` forward-only; 22 migrations, 63 tables (+2), 144 FKs (+4), 181 CHECKs (+7); 0020 untouched
**Location:** Falkenstein, Saxony, DE — no Iranian gateway/carrier credentials, no real payment/refund/carrier call was made or claimed

Phase 4.7 shipped the provider abstraction. 4.7.1 is a correctness pass over that
foundation: it makes the payment and shipping paths canonical, exactly-once under
real PostgreSQL concurrency, and verifiable end-to-end over HTTP. It is not a new
feature phase; `docs/phase-reports/phase-4-7-report.md` is left unchanged.

## Commits (all on `arena/01a0b926-kolbevintage-services`)

| Stage | SHA | Message | CI run | Conclusion |
|---|---|---|---|---|
| A | `121e47ac087f1bca7f6b6932c2fbb6c2cade09fc` | `feat(phase-4-7-1-a): harden payment provider correctness` | 35440620740 | success |
| B | `e664edf704280f78cb80c4564f645a4be5c7cf65` | `feat(phase-4-7-1-b): shipping correctness hardening` | 35442257737 | success |
| C | `93a398487554f248d82497c2cd5d97aed5f4b9fc` | `feat(phase-4-7-1-c): inventory exactness and concurrency hardening` | 35442611393 | success |
| D | `09fe78da65d11c28a6209451bc6384792a373383` | `feat(phase-4-7-1-d): cross-domain regression over HTTP` | 35442916138 | success |
| report | (this commit) | `docs: phase 4.7.1 report` | — | see final section |

## Test totals (local, real embedded PostgreSQL, `NODE_ENV=test`)

| Workspace | Files | Passed | Skipped | Failed | Baseline (4.7) |
|---|---|---|---|---|---|
| `@kolbe/shared` | 2 | 21 | 0 | 0 | 21 |
| `@kolbe/database` | 10 | 84 | 0 | 0 | 84 |
| `kolbe-api` | 32 | **450** | 0 | 0 | 383 |
| `kolbe-next` | 12 | 120 | 0 | 0 | 120 |
| **Total** | 56 | **675** | **0** | **0** | 608 |

+67 tests, all in `apps/api/test/phase-4-7-1-*.test.ts`, all against real PostgreSQL,
none skipped, none conditional on CI. `npm run typecheck:all` exit 0. `npm run db:migrate`
from an empty database applies 22/22 migrations. No existing test was deleted or weakened;
`packages/database/test/phase-3-8.test.ts` (table count 61→63), `apps/api/src/modules/registry.ts`
and `apps/api/test/module-boundaries.test.ts` (table ownership lists) were extended for the
two new tables only.

New test files:

| File | Tests | What it proves |
|---|---|---|
| `apps/api/test/phase-4-7-1-payment-provider.test.ts` | 20 | A1–A14, D5, D6 (webhook canonical path, deterministic identity, atomic claim, provider-authoritative state, mismatch rejection, callback never verifies, prod guard, refund mapping/basis/evidence/exactly-once) |
| `apps/api/test/phase-4-7-1-shipping.test.ts` | 26 | B1–B19, D1–D3, C4–C8 groundwork, static architecture guards (B4/B5/B6/B19/A2), prod guard for fake shipping |
| `apps/api/test/phase-4-7-1-concurrency.test.ts` | 15 | C2/C3/C4/C6 inventory exactness + the 12 mandatory real-PG races |
| `apps/api/test/phase-4-7-1-cross-domain.test.ts` | 6 | full buyer/supplier/admin lifecycle over HTTP with DB invariants; B12 over HTTP; D7/D8/migration/no-real-carrier static guards |
| `apps/api/test/helpers/phase-4-7-1.harness.ts` | — | boots the real Nest app on a dedicated database per file (`kolbe_phase_4_7_1_*_test`), seeds two suppliers/sellers, exposes services, fake providers and signed webhook helpers |

Each race test inspects database state (row counts of `payment_provider_event`,
`payment_allocation`, `order_ledger`, `order_financial_release`, `inventory_ledger`,
`inventory_reservation.consumed_quantity`, `shipment`, `order_status_history`,
`order_event`, `command_idempotency`) — mock call counts are never the oracle.

## The 12 mandatory concurrency tests (`phase-4-7-1-concurrency.test.ts`, real PostgreSQL)

1. duplicate payment webhook ×8 in parallel ⇒ one inbox row, one verification, one ledger IN, one release, one `processing` transition
2. payment webhook vs reconciliation on the same payment ⇒ exactly one verification and one release
3. duplicate provider success for the same provider reference (distinct event ids) ⇒ one verification, the second is `already_final`
4. duplicate refund completion ×6 ⇒ exactly one OUT ledger entry, one `refund.completed` event
5. two shipments racing for the final quantity ⇒ one wins, the other `409 SHIPMENT_QUANTITY_EXCEEDED`; `SUM(active) == ordered`
6. duplicate handoff (same key ×3 and different keys ×3, all parallel) ⇒ inventory consumed exactly once
7. handoff vs cancel on the same ready shipment ⇒ exactly one wins, inventory consistent with the winner
8. duplicate carrier `delivered` ×5 (distinct ids) ⇒ one delivered transition, one child history row
9. carrier webhook vs shipping reconciliation ⇒ one delivered transition
10. two sellers shipping the same order in parallel ⇒ independent reservations, inventories, child states
11. duplicate quote selection ×4 (two keys) ⇒ one supersede, one selected quote, `shipping_total` applied once
12. late shipping fee vs payment verification in parallel ⇒ allocations never exceed the payment, old allocation immutable, exactly the delta stays payable

The concurrency and shipping files were run 3× back-to-back before the Stage C commit
(41/41 each run) to check for flakiness; none observed.

## PART A — Payment correctness

**Canonical webhook path** (`apps/api/src/modules/finance/payment-provider.orchestrator.ts`,
`apps/api/src/modules/payments/payment-provider-event.service.ts`):

1. adapter authenticates the raw request (`x-fake-signature` for the fake provider); an
   unauthenticated payload is rejected `403 WEBHOOK_SIGNATURE_INVALID` and **not persisted**
   (a forged payload must not be able to shadow the real event's identity);
2. identity is normalized: the provider's own event id, otherwise a `sha256` fingerprint of
   the canonical payload — never `evt_${Date.now()}`, never random;
3. the event is persisted (`payment_provider_event`, unique on provider + external event id);
4. atomic claim `UPDATE … SET status='processing' WHERE status IN ('received','failed') RETURNING`
   — losers see the row and return the current status without touching anything;
5. provider `queryStatus` is called **outside** any row lock — the provider's answer is
   authoritative, the webhook body is only a trigger;
6. payment is resolved by `(provider, provider_reference)`; provider/reference/amount/currency
   and final state are validated (`PAYMENT_PROVIDER_REFERENCE_MISMATCH`, `PAYMENT_PROVIDER_AMOUNT_MISMATCH`,
   `PAYMENT_PROVIDER_CURRENCY_MISMATCH`, all 409);
7. inside one transaction: `PaymentsService.verify` → allocations (per-proforma cap, smallest
   issued proforma first) → ledger IN → per-active-proforma coverage → financial release
   (only when every active proforma is covered) → `OrdersService` payment-gate transition →
   event `processed`.

Any exception leaves the event `failed` (retryable by webhook redelivery or reconciliation);
a non-final provider state (`pending`) marks it `ignored` with reason `provider_state_not_final:<state>`;
a payment that cannot be resolved is `failed` with `PAYMENT_NOT_FOUND`. `processed` is only ever
written after the verify chain committed in the same transaction (A1/A4).

**Reconciliation** reuses the same path with deterministic keys `reconcile:<paymentId>:<providerReference>`
(`:reject` suffix for rejections) and reclaims stale `processing` rows (A8/A9).
**Callback** (`GET/POST …/callback`) is a redirect target only; it never verifies and writes nothing (A7).
**Uniqueness:** partial unique index `payment_provider_reference_unique (provider, provider_reference) WHERE provider_reference IS NOT NULL` (A5, migration 0021).
**Production guard:** both registries reject fake providers at the resolve boundary when
`NODE_ENV=production` (`403 PROVIDER_NOT_ALLOWED`), independent of `PAYMENT_PROVIDER_MODE` / `SHIPPING_PROVIDER_MODE` (A10).

**Refunds** (`apps/api/src/modules/payments/payments.service.ts`):

- provider-executed refund: claim → provider call (no lock) → completion with the provider's reference; the manual provider reports `refund_unsupported` and the refund stays `processing` until an operator completes it with real evidence — the adapter never fabricates a reference (A11);
- `assertRealRefundEvidence` rejects short or synthetic references (`provider-`, `REF-MANUAL-`, `auto-`, `generated-`, `placeholder`…) with `REFUND_EVIDENCE_INVALID` (A11);
- completion is exactly-once: refund row `FOR UPDATE` + persistent `command_idempotency`, replays return the committed result (A12);
- `refund_allocation` maps every refund onto its verified source payment(s), `SUM(refund_allocation.amount) == refund.amount`, over-refund and foreign payments rejected (`REFUND_EXCEEDS_ALLOCATED`, `REFUND_SOURCE_PAYMENT_INVALID`) (A13);
- `refund_line` records the exact proforma-line basis for item/quantity refunds; `line_total = unit_price × quantity` is a DB CHECK and a wrong amount or excess quantity is rejected (`REFUND_LINE_BASIS_MISMATCH`) (A14).

## PART B — Shipping correctness

`apps/api/src/modules/shipping/shipping.orchestrator.ts` is a **tableless** orchestrator (B4):
it coordinates `ShippingService` (quotes/shipments/events), `InventoryService`,
`PaymentsService`/`WholesaleFinanceOrchestrator` (fee/gate) and `OrdersService`, and owns no
tables. Finance no longer imports Shipping, and the Finance↔Shipping `forwardRef` from 4.7 is gone.

- **B1/B2/B3** — quote and shipment creation follow **TxA (claim command + pending row, no provider I/O) → provider call → TxB (finalize)**. Retry with the same key replays the provider result; a provider outage after TxA leaves a `pending` shipment that either the retry or admin reconciliation finalizes — never a second external shipment.
- **B5** — Shipping reads order facts only through `OrdersService.getChildOrderShippingContext` and writes them through `recordShipmentHandedOver` / `transitionChildToShipped` / `transitionChildToDelivered` in the same transaction; no direct `purchase_order` / `wholesale_order_item` access.
- **B6** — resource-based supplier authorization against the child's seller (`403 SHIPMENT_ACCESS_DENIED` for another supplier, `403 SUPPLIER_MEMBERSHIP_REQUIRED` without membership, `403 ROLE_NOT_ALLOWED` for finance members); `memberships[0]` is gone.
- **B7/B8/B9** — parent order, address snapshot and shipping responsibility are server-derived; client claims that disagree are rejected (`409 SHIPMENT_ORDER_MISMATCH`, `400 SHIPMENT_ADDRESS_NOT_ALLOWED`, `409 SHIPMENT_RESPONSIBILITY_MISMATCH`).
- **B10** — `awaiting_payment` orders cannot ship (`409 FINANCIAL_GATE_BLOCKED`) unless a financial release exists (credit/COD); a paid child that is not yet `preparing` is `409 CHILD_ORDER_NOT_SHIPPABLE`.
- **B11** — `SUM(active shipment allocations) ≤ ordered` checked under the child row lock (`409 SHIPMENT_QUANTITY_EXCEEDED`).
- **B12** — every shipping mutation requires `Idempotency-Key` → `400 IDEMPOTENCY_KEY_REQUIRED` before any side effect (verified at service and HTTP level).
- **B13** — state machine `pending→ready|cancelled`, `ready→handed_over|cancelled`, `handed_over→in_transit|delivered`, `in_transit→delivered`; no cancel after handoff (`409 INVALID_SHIPMENT_TRANSITION`).
- **B14** — pre-handoff provider failure: shipment stays `pending`, nothing transitions; post-handoff carrier failure: shipment `failed` with `failure_reason`, an order event is written, inventory is **not** resurrected.
- **B15** — order events are written in the same transaction by `OrdersService` (the swallowed `executor: undefined` from 4.7 is gone).
- **B16/B17** — `POST /api/v1/shipping/providers/:provider/webhook`: adapter-authenticated (`x-fake-shipping-signature`), deterministic identity, atomic claim; `shipment_event` states `received/processing/processed/ignored/failed`; unmapped references are persisted as `ignored` with `shipment_id NULL` (0021 relaxes the NOT NULL); duplicates collapse.
- **B18** — admin reconciliation (`POST /api/v1/admin/shipping/reconcile`) re-drives `failed` events, finalizes `pending` shipments and pulls carrier state for in-flight shipments; idempotent on rerun.
- **B19** — the buyer endpoint returns the real `trackingCode`/`trackingUrl`, never placeholders, and never address/provider internals or secrets.

## PART C — Inventory exactness

- A shipment **links a portion of the order reservation** (`inventory_reservation.consumed_quantity`, CHECK `0 ≤ consumed ≤ quantity`); no second reservation is created (C1/C2).
- Handoff consumes exactly `pieceQuantity` per item, once (C5/C6); underflow throws `RESERVATION_NOT_AVAILABLE` and the whole handoff rolls back — shipment stays `ready`, no ledger row, no order event (C3/C4). No clamping anywhere.
- Delivery is an inventory no-op (C7). Cancelling a `ready` shipment frees only its own allocation and never touches the reservation (C8).
- Legacy `dispatchChildOrder` after a partial shipment consumes only the remainder (5 = 3 via shipment + 2 via dispatch).
- Two sellers on the same order operate on disjoint reservations, inventories and child states (C10).

## PART D — Cross-domain rules

- **D1** `shipping_total = 0` means NOT QUOTED; the parent's `shipping_total`/`grand_total` are projected absolutely from the selected quotes.
- **D2/D3/D4** a quote selected after payment creates a **delta-only** obligation: the issued proforma is superseded by a new one (`total = old + delta`), the old proforma stays as history, existing allocations are never modified, and `currentPayable` equals exactly the delta. Replacement of a selected quote is an explicit delta as well.
- **D5** per-proforma cap allocation, smallest issued proforma first; unallocated overpayment stays `unallocatedPaid` (no wallet, no auto-move) and never counts toward another proforma.
- **D6** cancelling a child before payment voids its proforma and recomputes the payable **without** writing a `manual_authorized_release` row — that release type is reserved for real gate authorization.
- **D7/D8** static guards confirm no wallet/settlement/payout/IBAN and no legal/KYC/tax-invoice logic entered with 4.7.1.

## Defects found and fixed (all confirmed by a failing test first)

Latent in Phase 4.7 (never reachable because no 4.7 test drove the real path):

1. `payment_provider_event` inbox referenced a nonexistent column `external_payment_ref` — every webhook insert would have failed.
2. Online intents wrote `method='online'`, rejected by CHECK `payment_method_allowed` — 0021 extends the CHECK.
3. Webhook/reconciliation wrote system actor *strings* into FK columns (`actor_id`, `admin_user_id`) — now `NULL` + `actorRole: "system"`.
4. `PaymentsService.supersedeProformaForShipping` inserted the new `issued` proforma before superseding the old one, always violating `wholesale_proforma_child_issued_unique` (23505) — selecting a quote with a fee could never work.
5. Allocation order depended on random child ids — now deterministic (smallest issued proforma first).
6. Shipping wrote order facts with `executor: undefined`, silently swallowing order events (B15).
7. Provider event identity used `evt_${Date.now()}` (A2).
8. Controllers returned raw Drizzle rows with `bigint` money columns; `JSON.stringify` threw, so the supplier child lifecycle endpoints (`confirm`, `start-preparation`, …) and the new shipping endpoints answered **500** over HTTP. Fixed with `apps/api/src/common/api-json.ts` (BigInt → decimal string) in the supplier-orders and shipping controllers — found only because Stage D drives the real HTTP surface.

Introduced by the 4.7.1 rewrite and caught by the race tests before commit:

9. `claimCommand` same-key races surfaced a raw `23505` — now `ON CONFLICT DO NOTHING` + `FOR UPDATE` on the winner.
10. Parent fulfillment projection read sibling children before locking `wholesale_order` — two children shipped in parallel projected `fulfillment` instead of `shipped`; the parent is now locked first.
11. `submitTransfer` rejected a positive outstanding delta on an already released order (late shipping fee) — same rule as the online intent path now.

## Migration 0021 (`0021_phase_4_7_1_provider_shipping_hardening.sql`)

Forward-only, additive; 0020 untouched; Drizzle snapshot `meta/0021_snapshot.json` regenerated
(`prevId` = 0020 snapshot id) and `_journal.json` extended with idx 21.

- `payment.payment_method_allowed` CHECK re-created with `'online'`
- partial `UNIQUE payment (provider, provider_reference) WHERE provider_reference IS NOT NULL`
- `inventory_reservation.consumed_quantity integer NOT NULL DEFAULT 0` + CHECK `0 ≤ consumed_quantity ≤ quantity`
- `shipment.failure_reason text`
- `shipment_event.shipment_id` → nullable (unmapped carrier events are persisted as `ignored`)
- new tables `refund_allocation` (refund→payment mapping, unique per pair, amount CHECK) and `refund_line` (exact item basis, `line_total = unit_price × quantity` CHECK)

All timestamps default to PostgreSQL `now()`; all money is `bigint` IRR.

## Documented deviations / interpretations

- **D5 wording.** The 4.6.1 report's literal example "A=10M, B=20M, pay 30M → A10/B10, unallocated 10" is not reproducible under correct per-proforma allocation (30M covers both fully). 4.7.1 implements and tests the rule the example is meant to protect: allocation is capped per proforma, never spills across proformas, and the order stays `awaiting_payment` until every active proforma is covered (tested with a 20M payment → A10/B10, then +10M releases). Overpayment stays `unallocatedPaid`.
- **Allocation order** is deterministic (smallest issued proforma first), replacing the previous dependence on random child ids.
- **System actors** are `NULL` with `actorRole = "system"` because the actor columns are FKs to `app_user`; no synthetic system user is seeded.
- **Manual carrier**: handoff requires a real tracking code (`400 TRACKING_CODE_REQUIRED`); no webhook channel (`403 PROVIDER_NOT_ALLOWED`).
- **Duplicate webhook while the winner is still processing** returns the current status (`processing`) — the loser never waits on the lock and never reports `processed` for work it did not do.
- **Fake providers** remain dev/test only and are refused in production at resolve time regardless of env flags.
- No `forwardRef` was added; the Finance↔Shipping one was removed. Module boundary allowlists were not widened (only the two new tables were registered to their owners).

## Out of scope (unchanged from 4.7)

- No real Iranian payment gateway or carrier (NextPay/Vandar/ZarinPal/IDPay/Post/Tipax) integration, credentials, schemas or claims of verification. Provider adapters make no external HTTP calls (statically asserted).
- No wallet, settlement, payout, IBAN (Phase 4.8); no Terms/Privacy/KYC/eNAMAD/tax invoice/AML (Phase 4.7.5).
- Shipping reconciliation is admin-triggered, not scheduled.

## Final verification

- `npm run typecheck:all` — exit 0
- `npm run db:migrate` from an empty database — 22/22, 63 tables, 144 FKs, 181 CHECKs
- `npm run test:all` — shared 21 / database 84 / api 450 / next 120 = **675 passed, 0 skipped, 0 failed** (baseline 608)
- CI conclusions for every 4.7.1 commit are recorded in the commit table above; the run for the
  final HEAD (this report commit) is recorded in the closing message of the session.
