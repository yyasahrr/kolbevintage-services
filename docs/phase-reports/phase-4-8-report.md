# Phase 4.8 — Supplier Financial Account, Settlement Subledger & Payout Engine — Report

**Branch:** `arena/01a0bac3-kolbevintage-services` (strictly working branch; no `main` interaction, no history rewrite, no force push, no PR)
**Starting SHA:** `86131b89ed5fc94f42946d13c146ba8ff0833899` (docs: record phase 4.7.6 final CI — CI run **35454980078 SUCCESS**)
**Baseline re-verified locally before any change:** 23 migrations / 85 tables / 194 FKs / 266 CHECKs; `npm run test:all` = shared 23 / database 84 / api 544 / next 125 = **776 passed, 0 skipped, 0 failed**
**Ending SHA (code):** `0a08d4dce6caca912c96c6f9e6740017a2baa321` (Checkpoint D); this report is Checkpoint Report
**Date:** 2026-09-19
**Migration:** Migration 0023 (`0023_phase_4_8_settlement_ledger.sql`) applied; adds 15 settlement tables. Database shape: **24 migrations / 100 tables / 231 FKs / 325 CHECK constraints**
**Location:** Falkenstein, Saxony, DE — no Iranian payment provider, carrier, tax-authority, or payout provider credential exists in this repository; no real external banking or payment call was made or claimed.

> **Phase 4.9 Production Launch Hardening has NOT started.** Phase 4.8 implements the supplier settlement subledger, earnings lifecycle engine, supplier financial account APIs, withdrawal request pipeline, payout provider abstraction with crash-safe transaction boundaries, and adversarial invariant protections.

---

## Commits (all on `arena/01a0bac3-kolbevintage-services`)

| Stage | SHA | Message | CI run | Conclusion |
|---|---|---|---|---|
| Baseline | `86131b89ed5fc94f42946d13c146ba8ff0833899` | `docs: record phase 4.7.6 final CI` | 35454980078 | success |
| A | `7b816d1104383482bce730f76e5a6c318aebb2c4` | `feat(phase-4-8-a): add balanced supplier settlement subledger` | pending | — |
| B & C | `c4b2b67cac3ab7e73c4e92af0f52462ce92dca08` | `feat(phase-4-8-b-c): supplier earnings engine, financial accounts, payouts and reconciliation` | pending | — |
| D | `0a08d4dce6caca912c96c6f9e6740017a2baa321` | `test(phase-4-8-d): adversarial invariant verification and double-spend hardening` | pending | — |
| Report | (this commit) | `docs: phase 4.8 comprehensive report` | pending | — |

---

## Test Totals (local, real embedded PostgreSQL, `NODE_ENV=test`, `npm run test:all`)

| Workspace | Files | Passed | Skipped | Failed | Baseline (4.7.6) |
|---|---|---|---|---|---|
| `@kolbe/shared` | 2 | 23 | 0 | 0 | 23 |
| `@kolbe/database` | 10 | 84 | 0 | 0 | 84 |
| `@kolbe/api` | 45 | 571 | 0 | 0 | 544 |
| `kolbe-next` | 13 | 125 | 0 | 0 | 125 |
| **Total** | **70** | **803** | **0** | **0** | **776** |

Net change: **+4 test suites, +27 tests**, all passing with real PostgreSQL database constraints, zero mock-only tests, and zero skipped tests.

### New Test Suites in Phase 4.8

| File | Tests | Covers |
|---|---|---|
| `apps/api/test/phase-4-8-settlement-ledger.test.ts` | 8 | A1-A12: Balanced double-entry postings engine (`SUM(debit) == SUM(credit)`), derived balance calculations without mutable balance column, deterministic source-event idempotency, single-writer domain boundaries, Kolbe first-party exclusion, currency consistency. |
| `apps/api/test/phase-4-8-earnings-lifecycle.test.ts` | 7 | B1-B8: Cash coverage precondition and partial delivery attribution, commission terms snapshotting at first delivery with basis-points precision, explicit shipping economics policy (uncredited by default), tax non-crediting by default, hold application and release lifecycle, settlement evaluation and release batching (`settlement_batch`). |
| `apps/api/test/phase-4-8-payouts-withdrawals.test.ts` | 8 | C1-C8: Supplier financial account summaries and statement lines, withdrawal request validation and ledger reservation (`WITHDRAWAL_RESERVED`), Payout entity state machine, FakePayoutProvider with production fail-closed safeguard, ManualPayoutProvider requiring verified external bank reference, TxA -> Provider call -> TxB crash recovery and reconciliation. |
| `apps/api/test/phase-4-8-adversarial.test.ts` | 4 | D1-D4: Double-spend / concurrency race condition resistance under parallel withdrawal requests, post-payout refund negative carry-forward (`SUPPLIER_RECOVERY`) with subsequent batch earnings offset, HTTP IDOR and role boundary enforcement (`owner`/`finance` vs `sales`), BigInt JSON HTTP serialization hygiene (integer string format). |

---

## Checkpoint A — Balanced Settlement Subledger Architecture

1. **Migration 0023 (`0023_phase_4_8_settlement_ledger.sql`)**:
   - 15 new tables: `settlement_account`, `settlement_journal`, `settlement_posting`, `commission_policy`, `commission_snapshot`, `shipping_economics_policy`, `settlement_hold_policy`, `settlement_hold`, `settlement_batch`, `settlement_batch_item`, `withdrawal_request`, `payout`, `payout_provider_event`, `settlement_reconciliation_run`, `settlement_adjustment`.
   - Forward-only, chained cleanly to migration 0022.
   - DB totals: 24 migrations, 100 tables, 231 FKs, 325 CHECK constraints.
2. **Double-Entry Money Conservation**:
   - Every completed journal entry enforces `SUM(debits) == SUM(credits)`.
   - Integer IRR (`BIGINT`) exclusively; floating-point money is completely prohibited.
   - Derived balances only: no mutable `balance` column exists. Account balances are strictly computed via `SUM(credit) - SUM(debit)` (or `SUM(debit) - SUM(credit)` for debit-normal recovery accounts).
   - Postings and journals are append-only and trigger/invariant immutable once completed.
3. **Account Taxonomy**:
   - `SUPPLIER_PENDING`: Supplier earnings awaiting fulfillment/hold clearing.
   - `SUPPLIER_AVAILABLE`: Cleared supplier funds eligible for withdrawal.
   - `SUPPLIER_RECOVERY`: Negative carry-forward liability account for post-payout refunds.
   - `PLATFORM_COMMISSION_UNEARNED`: Platform commission held pending finalization.
   - `PLATFORM_COMMISSION_EARNED`: Recognized platform commission revenue.
   - `PLATFORM_SHIPPING_HOLDING`: Logistics funds held for carrier settlement.
   - `SETTLEMENT_CLEARING`: Intermediate double-entry balancing clearing account.
   - `WITHDRAWAL_RESERVED`: Funds earmarked during active withdrawal requests.
   - `PAYOUT_TRANSIT`: Funds in transit to external banking rail.
   - `BANK_SETTLED`: Platform bank account payout counterparty.
4. **Kolbe First-Party Exclusion**:
   - Kolbe is first-party (`purchase_order.supplier_id IS NULL`, `seller_id = 'seller_kolbe'`).
   - 1P merchandise has payable = 0, payout = N/A, and commission = 0.
   - Enforced by database schema checks and domain services; Kolbe first-party is never assigned an external supplier settlement account.
5. **No General-Purpose Wallet**:
   - The platform strictly implements "Supplier Financial Accounts / Settlement Accounts".
   - Arbitrary buyer/supplier stored value, wallet top-ups, and user-to-user transfers are prohibited by architecture and verified by static checks.

---

## Checkpoint B — Supplier Earnings & Lifecycle Engine

1. **Deterministic Event Processing**:
   - Processes four canonical events: `ChildPaymentCovered`, `ChildQuantityDelivered`, `ChildQuantityRefunded`, and `ShippingChargeFinalized`.
   - Deterministic `source_event_id` ensures replay safety and idempotent processing across retries.
2. **Cash Coverage & Delivery Attribution**:
   - Cash coverage precondition: verifies that buyer payments have been received and allocated to the child order before earnings can be posted.
   - Delivery attribution: credit is based strictly on delivered piece quantity multiplied by snapshot unit price.
3. **Commission Terms Snapshotting**:
   - Commission policy is snapshotted upon the first delivered quantity event into `commission_snapshot`.
   - Subsequent changes to global commission policy do not alter historical orders.
4. **Explicit Shipping Economics**:
   - Default policy uncredits shipping fees to the supplier (`SHIPPING_UNCREDITED_TO_SUPPLIER`).
   - Shipping fees are credited to the supplier only when explicitly designated with `shippingResponsibility = SUPPLIER`.
5. **Tax Non-Crediting by Default**:
   - Compliant with Iranian tax regulations: platform does not credit tax obligations into supplier settlement balances by default. Tax liability is reported and held on the supplier directly.
6. **Financial Holds & Pending-to-Available Lifecycle**:
   - Settlement hold policies: `DISPUTE`, `COMPLIANCE`, `TAX`, `FRAUD`, and `MANUAL`.
   - Batch release engine (`evaluateAndReleaseSettlementBatch`) evaluates matured earnings, inspects active holds and compliance eligibility, and moves eligible funds from `SUPPLIER_PENDING` to `SUPPLIER_AVAILABLE`.
7. **Negative Carry-Forward & Post-Payout Refund Recovery**:
   - If a refund occurs after funds have already been withdrawn, the supplier's available balance cannot cover the reversal.
   - The remaining reversal is posted to `SUPPLIER_RECOVERY`.
   - Subsequent settlement releases automatically offset against `SUPPLIER_RECOVERY` before crediting `SUPPLIER_AVAILABLE`.

---

## Checkpoint C — Supplier Financial Accounts, Withdrawals & Payouts

1. **Supplier Financial Account APIs**:
   - `GET /api/v1/supplier/financial-account/summary`: Returns pending, available, recovery, and reserved balances (as integer strings).
   - `GET /api/v1/supplier/financial-account/statement`: Returns paginated ledger statement lines with debit, credit, running balance, and event context.
   - `POST /api/v1/supplier/financial-account/withdrawals`: Submits a withdrawal request.
   - `GET /api/v1/supplier/financial-account/withdrawals`: Lists historical withdrawal requests.
2. **Security & Role Boundaries**:
   - Access strictly restricted to supplier users with `owner` or `finance` roles.
   - Users with `sales` role are rejected with `403 Forbidden`.
   - Suppliers cannot view or withdraw funds from other suppliers (cross-supplier isolation returning 404/403).
   - Mandatory `Idempotency-Key` header on all mutation endpoints; missing keys reject with `400 Bad Request`.
3. **Ledger Reservation**:
   - Creating a withdrawal request immediately creates a balanced double-entry journal reserving the requested amount:
     - Debit: `SUPPLIER_AVAILABLE`
     - Credit: `WITHDRAWAL_RESERVED`
   - Rejection or cancellation cleanly reverses the reservation.
4. **Payout Transaction Isolation (TxA -> Provider -> TxB)**:
   - External banking rail calls are strictly executed **outside** database transactions and row locks:
     - **TxA**: Validates compliance and bank destination; creates `payout` in `initiating` state; transitions withdrawal request.
     - **External Call**: Invokes payout provider outside database locks.
     - **TxB**: Updates payout to `processing`, `completed`, or `failed` based on provider response; records journals upon completion.
5. **Payout Providers**:
   - `FakePayoutProvider`: Used strictly in development and testing environments. Protected by an explicit fail-closed guard that throws `ILLEGAL_PROVIDER_STATE` if invoked in `NODE_ENV=production` without explicit bypass configuration.
   - `ManualPayoutProvider`: Requires genuine external bank reference, destination account details, and operator notes. Rejects placeholders, empty values, or synthetic timestamps.
6. **Crash Recovery & Reconciliation**:
   - `processProviderWebhook`: Ingests and deduplicates async provider events via `payout_provider_event` inbox.
   - `reconcileStuckPayouts`: Periodic reconciliation engine identifies payouts pending past timeout thresholds, queries the provider, and completes or fails the payout accordingly.

---

## Checkpoint D — Adversarial Invariant Verification

1. **Double-Spend & Concurrency Race Resistance (D1)**:
   - Tested under concurrent parallel withdrawal requests attempting to overdraw the available balance.
   - Database row locking on the supplier's financial account ensures serialization.
   - Exactly one request succeeds; subsequent requests are rejected with `INSUFFICIENT_AVAILABLE_BALANCE`.
   - Ledger integrity and balance conservation (`SUM(debit) == SUM(credit)`) remain 100% intact.
2. **Post-Payout Refund & Negative Carry-Forward (D2)**:
   - Verified that a post-payout refund properly creates a `SUPPLIER_RECOVERY` debit position when available funds are insufficient.
   - A subsequent earnings batch release automatically offsets the recovery balance first, crediting only the net surplus to `SUPPLIER_AVAILABLE`.
3. **HTTP IDOR & Role Permissions (D3)**:
   - Tested role permissions on `/supplier/financial-account/*`: `owner` and `finance` succeed, `sales` is denied with `403 Forbidden`.
   - Verified cross-supplier isolation: supplier B cannot query or withdraw against supplier A's account.
4. **BigInt HTTP Response Hygiene (D4)**:
   - Audited all financial HTTP responses: all money amounts and balances are serialized as integer strings (e.g., `"10000000"`), never raw numbers or floating-point decimals.

---

## Verification Gates Summary

| Gate | Result |
|---|---|
| `npm run db:migrate:verify` | OK — 24 migrations, 100 tables, 231 FKs, 325 CHECK constraints |
| `npm run typecheck:all` | OK — clean compilation across shared, database, api, next |
| `npm run build:packages && npm run build:api && npm run build` | OK — production builds succeed |
| `npm test --workspace @kolbe/shared` | OK — 2 test files, 23 passed, 0 failed |
| `npm test --workspace @kolbe/database` | OK — 10 test files, 84 passed, 0 failed |
| `npm test --workspace @kolbe/api` | OK — 45 test files, 571 passed, 0 failed |
| `npm test --workspace kolbe-next` | OK — 13 test files, 125 passed, 0 failed |
| **All Test Suites Combined** | **803 passed, 0 skipped, 0 failed** |

---

## Explicit Disclosures & Production Caveats

1. **No External Credentials in Repository**:
   - In accordance with repository policy, no production Iranian banking certificates (e.g., PayPing, Zarinpal, Sheba Paya/Satna APIs) are stored in this workspace. All integration tests use `FakePayoutProvider` or `ManualPayoutProvider`.
2. **Production Deployment Prerequisites**:
   - Live rollout requires configuring real banking provider adapters implementing `PayoutProvider`, mutual TLS certificates, and dual-operator approval workflows for manual payouts.
   - Scheduled cron jobs for `evaluateAndReleaseSettlementBatch` and `reconcileStuckPayouts` must be wired to the production task scheduler (e.g., BullMQ / Kubernetes CronJob).

Phase 4.9 Production Launch Hardening has NOT started.
