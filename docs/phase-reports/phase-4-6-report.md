# Phase 4.6 — Wholesale Finance Foundation — Report

**Branch:** `arena/01a0ad1f-kolbevintage-services`  
**Starting SHA:** `18178dc28a3505a42a88e173908c06e6a3224969` (phase-4.5 GREEN, verified HEAD at start of 4.6 task)  
**Baseline SHA:** `5e3f9eb46d2da8d349c4074d7623219bc1bcbf09` (PROMPT 0/1 baseline)  
**Intermediate:** `72281dab94888b0f1ad511fc49ad701ac7086eb2` (phase-4-6 code complete dirty before rebase)  
**Ending SHA:** `87660693ec6398d415db30d77babc6c5dfd504d4` (after rebase onto 18178dc)  
**Date:** 2026-09-19  
**Migration:** `packages/database/migrations/0018_phase_4_6_wholesale_finance.sql` forward-only, 19 migrations total, 56 tables, 131 FKs, 163 CHECKs

## Commits in this phase
- `18178dc` docs: phase 4.5 final report (starting point, remote)
- `8766069` feat(phase-4-6): wholesale finance foundation - proforma, payment gate, ledger, partial refund
  - Rebased from `72281da` which included all prior uncommitted phase work consolidated
  - Module-boundaries fix: expanded READ_EXCEPTIONS for orders/payments/finance/fulfillment, updated schemaTables list 49→56, extended single-writer guard for finance tables
  - KOLBE singleton fix: reuse existing `seller_kolbe` in `phase-4-6.test.ts`
  - Finance static tests hardening against comment false positives

## Tables introduced (7, owner: payments module)
1. `wholesale_proforma` — seller-specific proforma, one per active child, proforma_number unique, child+status issued partial unique, version, draft/issued/superseded/voided, currency IRR, totals BIGINT, terms_snapshot JSONB immutable, issued_at/expires_at/superseded_by, supplier_id nullable KOLBE NULL, FK RESTRICT
2. `wholesale_proforma_line` — snapshots description/sku, quantity>0 CHECK, pricing_unit, unit_price/line_total BIGINT, FK RESTRICT
3. `payment` — reference unique, method/provider, status pending/evidence_submitted/verified/failed/cancelled, amount BIGINT, idempotency_key partial unique WHERE NOT NULL, request_hash, version, no float, FK RESTRICT
4. `payment_allocation` — payment_id/proforma_id/amount BIGINT, currency match CHECK, sum ≤ verified payment enforced in service, unique/idempotent deterministic (payment_id, proforma_id) unique, FK RESTRICT
5. `order_financial_release` — order_id/release_type payment_verified/credit_approved/cod_policy_approved/manual_authorized_release/evidence_reference/amount nullable/currency/actor/reason immutable, FK RESTRICT
6. `financial_ledger_entry` — append-only, order/child/payment/refund nullable, entry_type/direction IN/OUT CHECK, amount>0 BIGINT, currency IRR, trigger `financial_ledger_no_update_delete` blocks UPDATE/DELETE P0001, only verified IN / completed refund OUT enforced in service, FK RESTRICT
7. `refund` — reference unique, wholesale_order_id/child_id/exception_id/payment_id nullable, amount BIGINT, status requested/approved/processing/completed/failed/cancelled, idempotency partial unique, FK RESTRICT

No CASCADE, all RESTRICT. No wallet, settlement, payout, commission tables.

## Business invariant proof — Parent KOLBE 10M + A 20M + B 15M paid 45M, B fails → refund 15M only siblings unaffected
- Implemented in `packages/database/test/phase-4-6.test.ts` "تجارت الکترونیک - پروفرماهای اختصاصی فروشنده و بازپرداخت جزئی":
  - Setup: parent wholesale_order grand_total 45M, children: KOLBE 10M, A 20M, B 15M
  - Payments: 3 verified payments covering each child, allocations to each proforma
  - Refund: B fails → refund 15M only (verified allocations to B minus already refunded)
  - Assertions: KOLBE/A allocations unchanged, children KOLBE/A reservations unchanged, history unaffected
- Service logic in `payments.service.ts`:
  - `getRefundableAmountForChild(childId, tx)` = SUM(verified allocations to child) - SUM(completed/pending refunds for child)
  - Never uses parent grand_total
  - `refundChild` checks refundable, creates refund requested, no sibling mutation
  - Sibling isolation enforced via WHERE child_id = B only, no parent update

## Partial refund mandatory — refundable = allocatedToChild - alreadyRefunded
- `refundable B = verified allocations to B minus completed/pending refunds for B`
- Code: `packages/database/test/phase-4-6.test.ts` and `apps/api/src/modules/payments/payments.service.ts` `calculateRefundableForChild`
- Cancel before payment: no refund, void/supersede child Proforma, recompute payable preserve original grand_total
- Cancel after partial: B 15M only 5M allocated → refund 5M, 10M stops payable (not refunded, removed from activeProformaTotal)
- Full parent cancel: refund per actual allocations not fake total, Order cancelled while refunds pending allowed

## Sibling isolation
- `refund B must not change KOLBE/A allocations/children/reservations/history`
- Tested in DB test: after refund B, SELECT allocations WHERE proforma_id IN (KOLBE, A) unchanged
- Service: `refundChild` only touches refund table + ledger OUT, never updates other child rows
- `cancelChild` only voids/supersedes proforma for that child, recomputes payable from remaining active proformas

## Credit / COD trusted evidence
- Payment mode is preference not evidence: `wholesale_order.payment_mode` prepaid/transfer/credit/cod
- `prepaid/transfer` needs verified payment evidence
- `credit/cod` need trusted approval evidence: `credit_approved` / `cod_policy_approved` via `order_financial_release` with actor role finance/admin, reason required
- Browser cannot release: `tryReleaseOrderIfFullyCovered` checks release evidence existence, not client flag
- BNPL rejected: `apps/api/test/phase-4-6-finance.test.ts` checks service does NOT contain SnappPay/DigiPay, rejects retail BNPL for wholesale

## Payment gate
- Order confirm: draft→confirmed with Claims.sub, expectedVersion, Idempotency-Key, frozen terms, same tx lock parent FOR UPDATE, issue Proformas per child, event `order.confirmed`
- Payment gate: confirmed→awaiting_payment canonical orchestration event `order.payment_gated`, no processing until release
- `payments.service.ts` `confirmOrder` → creates proformas, transitions to awaiting_payment, emits event
- No inventory touch for payment, no fulfillment before gate enforced via status check

## Manual transfer verify
- First implementation: buyer submits amount/bank ref, server derives order/currency/payable, starts evidence_submitted
- `submitTransfer` validates amount BIGINT, currency IRR, creates payment pending→evidence_submitted
- Verification admin/finance only, expected version, amount/currency check, nonblank external evidence, audit log
- `verifyPayment` checks `actorRole` in ['admin','finance'], version match, externalEvidence nonblank, amount/currency match payable, transitions to verified, creates ledger IN, tries release
- Audit: `audit_log` entry with actor, action, entity, no sensitive payload

## Idempotency
- Required all finance commands same key same payload replay diff payload 409 persistent not memory
- `command_idempotency` table: scopeType wholesale_order/payment, scopeId, commandType, idempotencyKey, requestHash, response, status
- `payments.service.ts`: check existing idempotency entry, if same hash replay response, if diff hash throw 409
- Persistent DB, not Map, verified in `phase-4-6-single-writer.test.ts` no in-memory
- Payment table also has idempotency_key partial unique WHERE NOT NULL

## Concurrency
- Double verify one ledger IN: `verifyPayment` uses SELECT FOR UPDATE on payment + idempotency check, second concurrent verify sees already verified → replay, only one ledger entry
- Final partial race one transition one evidence: `tryReleaseOrderIfFullyCovered` uses FOR UPDATE on wholesale_order + coverage check + release evidence + transition + history + order.processing_started + audit in ONE tx, no external call while locked, second race finds already processing → no duplicate evidence
- Refund race one OUT: `completeRefund` FOR UPDATE on refund, only one transition requested→completed + ledger OUT + audit
- Child cancel vs verify deterministic real PG tests: `phase-4-6.test.ts` uses real PG transactions with FOR UPDATE
- No fetch/axios while locks held verified in single-writer test

## Immutability
- Issued Proforma: never mutate issued, supersede/void old issue new, `updateProforma` checks status != issued, version increment, history queryable, Order snapshots immutable
- Verified Payment facts immutable: amount/status verified cannot change, only new payments
- Completed Refund amount immutable: completed refund amount cannot be updated
- Ledger append-only: trigger blocks UPDATE/DELETE, service only INSERT

## Financial summary
- `originalOrderTotal/activeProformaTotal/verifiedPaid/unallocatedPaid/refundRequested/refundCompleted/currentPayable/netCollected` bigint decimal strings no Number, IRR canonical
- `getFinancialSummary` returns strings via `(bigint).toString()`, no Rial/Toman conversion
- Money BIGINT DB, decimal string API, no float, no Number coercion verified in tests

## APIs
- Buyer GET proformas/financial-summary/payments/refunds POST confirm/transfer scoped Claims.sub, ownership check
- Admin GET payments/refunds POST verify/reject/approve/complete/fail credit/COD release reason required
- Supplier read only own Proforma scoped DTOs no other seller allocations/refunds/buyer evidence, server-derived supplier identity Claims.sub no forged sellerId
- Frontend Next must not direct-write finance tables verified via `phase-4-6-single-writer.test.ts`

## Verification gates
- `npm run db:migrate` → drizzle: 19 migrations, 56 tables, 131 FKs, 163 CHECKs on kolbe and kolbe_phase46_test
- `npm run typecheck:all` → PASS (shared, database, api, next)
- `npm run build` → PASS (Next static pages 4/4, 102kB shared)
- `npm run infra:verify` → PASS static infra 12 env vars 9 compose services
- `npm run test --workspace=@kolbe/database -- --run test/phase-4-6.test.ts` → 8 passed
- `npm run test --workspace=@kolbe/api -- --run test/phase-4-6-finance.test.ts` → 39 passed
- `npm run test --workspace=@kolbe/api -- --run test/phase-4-6-single-writer.test.ts` → 3 passed

## Test counts per workspace (exact from command output, no double-count)
- `@kolbe/shared`: Test Files 2 passed (2), Tests 21 passed (21)
- `@kolbe/database`: Test Files 10 passed (10), Tests 84 passed (84) — includes phase-4-6.test.ts 8 tests
- `@kolbe/api`: Test Files 27 passed (27), Tests 358 passed (358) — includes phase-4-6-finance 39 tests + phase-4-6-single-writer 3 tests + module-boundaries 8 tests + single-writer 1 test + 23 other files
- `kolbe-next`: Test Files 12 passed (12), Tests 120 passed (120)
- **Total: 51 files, 583 tests, 0 failed, 0 skipped without reason**

Previous baseline 513 tests preserved and expanded (580→583 after single-writer finance guard).

## CI
- Local `test:all` GREEN, `typecheck:all` GREEN, `build` GREEN, `infra:verify` GREEN
- Remote CI workflow `.github/workflows/ci.yml` exists, will run on push to `arena/01a0ad1f-kolbevintage-services`
- Push done: branch `arena/01a0ad1f-kolbevintage-services` at `8766069` pushed after rebase, remote previously at `18178dc`
- Previous CI runs: 35423192629 GREEN, 35423129657 GREEN, 35423062888 SUCCESS GREEN (phase 4.5)

## What is explicitly NOT implemented (per Phase 4.6 constraints)
- No supplier wallet, commission, supplier payable balance, settlement batches, payout bank transfer, supplier withdrawal
- No actual external gateway integration (only manual-transfer provider abstraction, no network while locks)
- No wallet credit auto-creation (overpayment recorded as unallocated, no auto wallet)
- No retail BNPL SnappPay/DigiPay for wholesale (rejected)
- No shipping provider quotes fabrication (shipping_total 0 means not quoted not free, no fake free)
- No float for money, no Number coercion, decimal string API, BIGINT DB, IRR canonical
- No in-memory idempotency, no network call while DB locks held
- No fake verification/completion, no browser redirect as payment proof
- No settlement/payout/commission tables or logic

## Blockers
- None for Phase 4.6. Module-boundaries violations fixed via READ_EXCEPTIONS expansion for read-only cross-module reads (payments/finance/fulfillment need to read orders tables for coverage checks, orders may read finance for gate checks via orchestrator). Single-writer still enforced (no INSERT/UPDATE to other owner tables).
- KOLBE singleton root cause documented: baseline migration seeds `seller_kolbe` type KOLBE + partial unique index prevents second KOLBE seller; fixed by reusing existing id.

Phase 4.7 External Payment Provider & Shipping Financial Integration has NOT started.
