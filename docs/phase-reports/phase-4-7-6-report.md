# Phase 4.7.6 — Financial Architecture Audit & Settlement-Readiness Freeze — Report

**Branch:** `arena/01a0b926-kolbevintage-services` (only branch touched; no `main` interaction, no history rewrite, no force push, no PR)
**Starting SHA:** `1d6de56f77156834a4853bb671b1d88751734938` (Phase 4.7.5 closeout — CI run **35452393985 SUCCESS**, recorded here as promised by the 4.7.5 report)
**Baseline re-verified locally before any change:** 23 migrations / 85 tables / 194 FKs / 266 CHECKs; `npm run test:all` = shared 21 / database 84 / api 507 / next 125 = **737 passed, 0 skipped, 0 failed**
**Ending SHA (code):** `70f6bb4dff1b2b13bf344a58ad92a2dc9f796e9a` (Checkpoint B); this report is Checkpoint C
**Date:** 2026-09-19
**Migration:** **Phase 4.7.6 required no schema migration.** 0018–0022 untouched; DB shape unchanged (23 / 85 / 194 / 266)
**Location:** Falkenstein, Saxony, DE — no Iranian payment provider, carrier, tax-authority or payout provider credential exists in this repository; no real external call was made or claimed

> **Phase 4.8 Supplier Wallet, Settlement & Payout has NOT started.** This phase audited the money
> model, fixed three confirmed defects with regression tests, added a read-only settlement-readiness
> primitive and froze the Phase 4.8 architecture in documents. No wallet, mutable balance, settlement
> batch, withdrawal, payout, provider payout adapter, scheduler, customer wallet or top-up exists.

## Commits (all on `arena/01a0b926-kolbevintage-services`)

| Stage | SHA | Message | CI run | Conclusion |
|---|---|---|---|---|
| Part 0 (4.7.5 closeout, verified) | `1d6de56f77156834a4853bb671b1d88751734938` | `docs: record phase 4.7.5 final CI` | 35452393985 | success |
| A | `b9fdbc266dc9179d1414f9dc01ff9a286451c861` | `feat(phase-4-7-6-a): audit financial invariants and settlement readiness` | 35454492294 | success |
| B | `70f6bb4dff1b2b13bf344a58ad92a2dc9f796e9a` | `feat(phase-4-7-6-b): freeze settlement architecture for phase 4.8` | 35454864085 | success |
| C / report | `7db29abf91eaaf9aeddb99eccf07d84e5f603f9f` | `docs: phase 4.7.6 report` | 35454980078 | success |
| closeout | (this commit) | `docs: record phase 4.7.6 final CI` | — | its own run id can only be recorded by a later commit |

## Test totals (local, real embedded PostgreSQL, `NODE_ENV=test`, `npm run test:all` on `70f6bb4`)

| Workspace | Files | Passed | Skipped | Failed | Baseline (4.7.5) |
|---|---|---|---|---|---|
| `@kolbe/shared` | 2 | 23 | 0 | 0 | 21 |
| `@kolbe/database` | 10 | 84 | 0 | 0 | 84 |
| `@kolbe/api` | 41 | 544 | 0 | 0 | 507 |
| `kolbe-next` | 13 | 125 | 0 | 0 | 125 |
| **Total** | **66** | **776** | **0** | **0** | 737 |

New tests (all real PostgreSQL through the 4.7.1 harness — orders, payments, shipments, refunds and
invoices are created through the real services/HTTP and the database rows are asserted; none are
source-text scans):

| File | Tests | Covers |
|---|---|---|
| `apps/api/test/phase-4-7-6-financial-invariants.test.ts` | 16 | FI-1 seller identity (DB singleton, server-side supplier id); FI-3 proforma line basis incl. package-sold/piece-priced regression and fail-closed issuance; FI-4/5 order-level cash, allocations, ledger meaning; FI-9 refund ceilings (order-scoped vs child-scoped, overpayment, line caps, exception/child mismatch, currency CHECKs + `CURRENCY_MISMATCH`); FI-6/7 quantity-evidenced, idempotent delivery (sequential + concurrent replays), shipment cap, status-only delivery evidence; FI-8 release ≠ cash; FI-11 sibling isolation |
| `apps/api/test/phase-4-7-6-settlement-readiness.test.ts` | 19 | S1 Kolbe child excluded (100M = 40M + 35M + 25M), S2/S5 cross-seller isolation (byte-equal), S3 partial delivery attribution, S4/S13 exact-slice refund & non-negative preview, S13b exception-linked refunds, S18/S19 delivery replay/concurrency, status-only delivery ⇒ `DELIVERY_EVIDENCE_MISSING`, S6 overpayment ⇒ 0, S7/S8 credit/COD release ≠ payment, S15/S16 multi-payment determinism & superseded proforma not double counted, S9/S10 late shipping fee separate & not supplier, S11 tax not supplier (VAT fixture, invoice gap shown), S12 config/price changes not retroactive, S14 replacement no transfer, S17 pre-fulfilment cancellation ⇒ none, S20 currency mismatch, 404s, HTTP 200/403/401 matrix (+ forged `finance` claim rejected), reads write nothing |
| `apps/api/test/phase-4-7-6-cross-domain-money-flow.test.ts` | 2 | the worked example end-to-end over HTTP + services with money conservation (FI-23) asserted after every step; supplier surfaces vs admin readiness |
| `packages/shared/test/money.test.ts` (+2) | 2 | `basisPoints` (integer bps, half-up/down, range guards) and `allocateProportionally` (largest remainder, Σ parts = amount) |

Pre-existing tests: none deleted, none skipped. One pre-existing **flaky** assertion in
`phase-4-7-1-concurrency.test.ts` race #1 was corrected: it allowed only `processed|processing` outcomes
for 8 concurrent duplicate webhooks, but a late duplicate that arrives after the worker finished
legitimately reports `duplicate/already_processed` (the test's own comment described exactly that).
The flake reproduced on the untouched baseline (1 of 3 runs). The exactly-once assertions (one inbox
row, one verification, one ledger IN, one release, one `processing` transition, 7 duplicates) are
unchanged and the `processed` count is now asserted to be **exactly 1** (stricter than before).

## Verification gates

| Gate | Result |
|---|---|
| `npm run db:migrate` | OK — 23 migrations, 85 tables, 194 FKs, 266 CHECKs (unchanged; no 0023 needed) |
| `npm run typecheck:all` | OK (shared, database, api, next) |
| `npm run test:all` | OK — 776 passed / 0 skipped / 0 failed |
| `npm run build` | OK |
| `npm run infra:verify` | OK (structure only — Docker/Nginx were **not** runtime-executed in this sandbox; no runtime infra verification is claimed) |
| Architecture suites (`module-boundaries`, `architecture-freeze`, `phase-4-5-single-writer`, `phase-4-7-5-security-boundaries`) | OK with the new `settlement-readiness` module registered (no cycle, no foreign table names, no widened allowlists) |
| CI | A 35454492294 SUCCESS · B 35454864085 SUCCESS · C (report) 35454980078 SUCCESS |

## Part 1 — Audit results (what the code actually does)

Full matrix: `docs/architecture/phase-4-7-6-financial-audit-matrix.md`. Key verified facts:

* **Kolbe identity** is DB-enforced: `seller` CHECK `KOLBE ⇔ supplier_id IS NULL`, unique KOLBE singleton `seller_kolbe` (seeded in 0005); `purchase_order.supplier_id IS NULL` ⇒ Kolbe first-party. No API accepts an external-supplier flag.
* **Commercial terms** = one `issued` proforma per child with lines; issued financial fields are trigger-immutable (0019).
* **Cash is order-level**: `payment` has no child; seller attribution exists only through `payment_allocation → wholesale_proforma → purchase_order`. Allocation is deterministic and lineage-capped; the remainder is `unallocatedPaid` (never seller money).
* **Release ≠ cash**: credit/COD/manual releases write no payment, allocation or ledger row.
* **Ledger** `financial_ledger_entry` is an append-only **single-entry cash-evidence journal** of the order (`IN` verified payment with `child_order_id NULL`, `OUT` completed refund). It is not double-entry, not a GL, never a supplier balance.
* **Delivery evidence is quantity-level**: `shipment_item.piece_quantity` on `delivered` shipments; `applyDeliveredInTx` is idempotent under locks; `createShipment` caps pieces ≤ ordered. Status-only delivery (`orders.child_deliver`) carries no quantity.
* **Refunds** carry exact lines priced from the active proforma line, capped by ordered quantity, mapped to source payments.
* **Not modelled today**: commission, hold policy, shipping economic owner (only physical `shipping_responsibility`), discount, chargeback/reversal/dispute provider events, supplier payable, payout.
* **Tax**: invoice adds `tax_total` on top of the subtotal only when a VERIFIED `VAT_RATE_PERCENT` is active, while the proforma/payment obligation never includes tax ⇒ classified **TAX_REVIEW_REQUIRED** (demonstrated by test S11; no rate is active in production data; nothing guessed).

## Part 2 — Confirmed defects fixed (regression tests in `phase-4-7-6-financial-invariants`)

| Id | Defect (as found) | Fix |
|---|---|---|
| D1 | `OrdersService.getOrderFinancialSnapshot` copied `wholesale_order_item.quantity` (selector count) into the proforma line even for per-piece pricing, so a package-sold, piece-priced line had `unit_price × quantity ≠ line_total`; a refund line for it would refund one *piece* per package. Reachable because a selected tier's `pricingUnit` overrides the offer unit in `resolvePrice`; the test harness only built PIECE offers so it was never exercised. | Line quantity is now in the pricing unit (`piece_quantity` for PIECE/PER_PIECE, `quantity` otherwise), matching `calculateLineTotal`; `PaymentsService.issueProformasFromSnapshot` fails closed with `PROFORMA_LINE_BASIS_INCONSISTENT` (422) when `unit_price × quantity ≠ line_total`. |
| D2 | An **order-scoped** refund (no `childOrderId`) was capped by *total verified − all refunds*, i.e. it could return money already allocated to a child's proforma — a non-attributable movement of seller-attributable cash. | Order-scoped ceiling = unallocated verified money − live order-scoped refunds; larger requests get `REFUND_SCOPE_REQUIRED` (409) and must name the child (and lines). Source-payment capacity for order-scoped refunds is the payment's unallocated part. Child-scoped ceilings unchanged. |
| D3 | `refund.fulfillment_exception_id` was only an FK: a refund on child A could cite child B's exception, mis-classifying quantity as never-delivered and mixing sellers. | `WholesaleFinanceOrchestrator.createRefund` loads the exception through `FulfillmentService` and rejects `REFUND_EXCEPTION_CHILD_MISMATCH` (409) / `EXCEPTION_NOT_FOUND` (404). `FinanceModule` imports `FulfillmentModule` (the registry already declared `finance → fulfillment`; no cycle). |
| D4 (found by the cross-domain test) | `GET /api/v1/supplier/orders/:id` returned 500 for suppliers (BigInt serialisation) and ownership failures surfaced as 500 instead of 404/403. | `toApiJson` on the response; ownership helper throws `DomainError` 404/403 with the same codes. Regression asserted in `phase-4-7-6-cross-domain-money-flow`. |

## Part 3 — Settlement-readiness primitive (read-only)

`apps/api/src/modules/settlement-readiness/` — `SettlementReadinessService` (+ contract, controller,
module), registered in `registry.ts` with `dependsOn: orders, payments, shipping, compliance, invoicing`,
owning **no tables** and writing nothing (proved by the "reads write nothing" test).

* Endpoints (admin-only; `@Roles("admin","finance")` — note `finance` is a claim-level role with no
  `account_user.role` behind it, so a forged finance claim is rejected 401 by the session guard):
  `GET /api/v1/admin/settlement-readiness/orders/:orderId`,
  `GET /api/v1/admin/settlement-readiness/children/:childOrderId`.
* Payload: `participant` (server-side seller type, `settlementCandidate`), `commercialTerms` (active
  proforma, history, per-item ordered/delivered/refunded/entitled units), `fulfillment` (evidence class
  NONE / PARTIAL_QUANTITY_EVIDENCED / QUANTITY_EVIDENCED / STATUS_ONLY, history with trigger),
  `economicBasis` (labelled **NOT A SETTLEMENT BALANCE**: ordered, delivered, refunded completed/pending/
  without-lines, `merchandiseEntitledPreview`, shipping charged with `shippingEconomicOwner`
  NOT_CHARGED/UNDEFINED, `taxExcluded`, `taxTreatment`), `cashCoverage` (verified active allocations vs
  child payable, `unallocatedOrderMoney`, releases, `financialReleaseWithoutCash`), `refunds`,
  `commission` (`amount: null`, `defaultBeforeConfiguration: "0"`), `compliance` (reuses
  `SupplierComplianceService.getSupplierSettlementEligibility`), `capabilities`
  (`chargebackFactsAvailable: false`, …), `blockers` classified **economic / configuration / compliance /
  payout**, `notices`, `sourceDataSufficient`, `readyForSettlementEngine`.
* Blocker codes: `KOLBE_FIRST_PARTY`, `CHILD_CANCELLED`, `COMMERCIAL_TERMS_NOT_SNAPSHOTTED`,
  `CURRENCY_MISMATCH`, `PAYMENT_NOT_COLLECTED`, `CHILD_NOT_DELIVERED`, `DELIVERY_EVIDENCE_MISSING`,
  `REFUND_NOT_ATTRIBUTABLE` (economic); `COMMISSION_POLICY_UNDEFINED`, `HOLD_POLICY_UNDEFINED`,
  `SHIPPING_ECONOMIC_OWNER_UNDEFINED`, `TAX_TREATMENT_UNVERIFIED` (configuration);
  `SUPPLIER_COMPLIANCE_BLOCKED`, `BANK_DESTINATION_NOT_VERIFIED` (compliance); `PARTIAL_FULFILLMENT`,
  `REFUND_PENDING`, `DISPUTE_OR_CHARGEBACK_HOLD` (payout — the last is defined but never raised: no
  dispute fact exists).
* Never exposes `supplierBalance`, `walletBalance`, `withdrawableBalance`, `availableBalance`,
  `pendingBalance`, `payoutAmount` (defensive assertion in the service + tests); all amounts are integer
  strings.
* Frozen technical rules encoded: `deliveredUnits = floor(deliveredPieces / piecesPerUnit)`;
  `entitledUnits = max(0, min(deliveredUnits, orderedUnits − refundedUndelivered) − refundedDelivered)`;
  exception-linked refund lines are undelivered quantity, unlinked lines are post-delivery reductions
  (conservative; never over-credits a supplier).
* Owner read methods added (no locks, no writes): `OrdersService.getChildOrderEconomicContext`,
  `OrdersService.listChildOrderIdsForOrder`, `PaymentsService.getChildSettlementFacts`,
  `InvoicingService.getTaxFactsForChild`.

Shared money primitives (`packages/shared/src/money.ts`): `basisPoints(amount, bps, "half-up"|"down")`
and `allocateProportionally(amount, weights)` — integer only, deterministic, tested. They carry **no
rates**.

## Part 4 — Phase 4.8 architecture freeze (documents)

| Document | Content |
|---|---|
| `docs/architecture/phase-4-7-6-financial-audit-matrix.md` | 23 concepts × owner/source/formula/trigger/properties/defect/fix/4.8 responsibility; attribution chain; DB enforcement inventory; migration statement |
| `docs/architecture/financial-glossary.md` | order total → wallet terms as they exist; current ledger = append-only single-entry cash-evidence journal (not double-entry, not GL); 4.8 user-facing terms |
| `docs/architecture/marketplace-money-flow.md` | current vs 4.8 flow; worked example 100M = 40M + 35M + 25M with real rows and the illustrative 4.8 postings (no rate committed) |
| `docs/architecture/financial-invariants.md` | FI-1 … FI-23, each mapped to an executable test; invariants deliberately not claimed |
| `docs/architecture/adr-phase-4-8-settlement-ledger.md` | Options A/B rejected; Option C accepted — separate balanced double-entry subledger `settlement_account/journal/posting`, Σ debits = Σ credits, integer IRR, UNIQUE `source_event_id`, derived balances, not statutory GL, not a retrofit of the payment ledger; posting rules per event |
| `docs/architecture/phase-4-8-domain-ownership.md` | ownership today (verified against `registry.ts`) and in 4.8; Finance orchestrator owns no tables; Settlement owns only its tables; server-side supplier identity |
| `docs/architecture/phase-4-8-financial-event-contract.md` | `ChildPaymentCovered`, `ChildQuantityDelivered`, `ChildQuantityRefunded`, `ShippingChargeFinalized`, `ComplianceEligibilityChanged`, `FinancialHoldPlaced/Released`, `PayoutProviderResult`, `PaymentReversed` (documented readiness) with deterministic identities, emitters, consumers, ordering/idempotency |
| `docs/architecture/phase-4-8-concurrency-model.md` | race matrix (10 races incl. all eight mandated), payout TxA → provider → TxB with crash recovery table, three separate reconciliations, lock ordering |
| `docs/architecture/phase-4-8-decisions.md` | 26 FROZEN rules with evidence, 11 CONFIGURABLE items with safe defaults (commission 0), 14 decisions classified BUSINESS / LEGAL / TAX / PROVIDER review (collection model = LEGAL + PROVIDER) |

## Known limitations / follow-ups (not hidden)

* Status-only delivery is accepted for order status but is **not** settlement evidence; whether an admin-marked delivery may ever count needs a business decision and an explicit adjustment path (decisions C12).
* Shipping economics (`shipping_charge_to_buyer / economic_recipient / cost_bearer / provider`) are documented, not modelled; Phase 4.8 migration work (forward-only, never touching 0018–0022).
* No DB CHECK exists yet on `wholesale_proforma_line (unit_price × quantity = line_total)`; the service fails closed and the check is recommended for the 4.8 migration.
* `payment_allocation`, `refund_line`, `refund_allocation`, `shipment_item`, `wholesale_proforma_line` immutability is by code convention (no triggers) — candidate for 4.8 triggers.
* Chargeback / reversal / dispute provider events do not exist; readiness reports `chargebackFactsAvailable: false`.
* `CatalogDomainError` thrown from other supplier-order controller paths (e.g. missing Idempotency-Key) still maps to 500; only the ownership/read path was corrected in this phase (out of financial scope otherwise).
* `finance` HTTP role cannot be issued today (`account_user.role` CHECK); the readiness endpoint is admin-only in practice.

## Explicit disclosures

* Supplier wallet / mutable balance / settlement batch / withdrawal / payout / IBAN transfer / provider payout adapter / scheduler / provider split payment / supplier-to-supplier transfer / customer wallet / top-up / cashout: **NOT implemented** (Phase 4.8 has NOT started).
* Real Iranian payment provider, carrier, tax API or payout provider integration: **NO** (fake providers only, refused in production).
* Legality of marketplace payouts, tax treatment, commission rates, hold durations, provider fees: **not asserted**; classified for BUSINESS / LEGAL / TAX / PROVIDER review in `phase-4-8-decisions.md`.
* Docker / Nginx: **not runtime-executed** here (`infra:verify` is structural only).
* Old phase reports were not used as proof; every claim in this report maps to code, DB constraints or an executable test.

## Final Phase 4.7.6 verification record

| Item | Value |
|---|---|
| Final code SHA | `70f6bb4dff1b2b13bf344a58ad92a2dc9f796e9a` — CI run 35454864085 — **SUCCESS** |
| Report commit SHA | `7db29abf91eaaf9aeddb99eccf07d84e5f603f9f` (`docs: phase 4.7.6 report`) — CI run **35454980078** — **SUCCESS** (workflow `.github/workflows/ci.yml`, branch `arena/01a0b926-kolbevintage-services`) |
| Remote state | `7db29ab` pushed to `origin/arena/01a0b926-kolbevintage-services` on 2026-09-19 (fast-forward; no force push) |
| Closeout | this commit (`docs: record phase 4.7.6 final CI`) changes only this file; its own CI run id is reported in the session summary and can be recorded by the next phase's report |

Phase 4.8 Supplier Wallet, Settlement & Payout has NOT started.
