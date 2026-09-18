# Phase 4.1 Readiness Audit — Pre-Order Engine

Date: 2026-09-17. Branch: `arena/01a0ad1f-kolbevintage-services`. Commit: `e68f1fa` (feat inventory Phase 4.1 hardening).

This audit verifies readiness to start Order Engine (Phase 4.2/4.3) after inventory hardening. No code modifications were made unless critical blocker found (none found requiring immediate fix). Assessment is based on repository state after e68f1fa, including migration 0011.

## 1. No remaining direct inventory writes outside InventoryService (NestJS)

**Method:** `grep -R product_variant_inventory|inventory_reservation|inventory_ledger|command_idempotency` filtered by `insert|update|delete` outside `apps/api/src/modules/inventory`, excluding tests/specs.

**Result:** 0 direct writes in NestJS modules outside inventory.

- `apps/api/src/modules/offers/offers.service.ts` only has comment about deprecated inventoryOnHand.
- `apps/api/src/modules/vip`, `catalog`, `suppliers`, `admin` have no inventory writes.
- Registry: `inventory` owns `product_variant_inventory`, `inventory_reservation`, `inventory_ledger`, `command_idempotency` (4 tables).

**Legacy exception:** `frontend-next/server/kolbe-api.ts` and `frontend-next/server/database.ts` still contain direct SQL:
- `UPDATE product_variant_inventory SET reserved=...`, `on_hand=GREATEST(0, ...)`, `INSERT INTO product_variant_inventory`
- These are documented as I-04 (legacy bypass) in `pre-phase4-legacy-audit.md` and `inventory-risk-register.md`. They remain active because Next.js handler still serves traffic during strangler (PROMPT 1.2). This is a known blocker for cutover, not a new violation introduced in 4.1.

**Verdict:** PASS for NestJS canonical path; legacy bypass remains as documented debt (I-04).

## 2. No legacy supplier_inventory mutation paths remain active (NestJS)

**Method:** Search for `supplier_inventory`, `supplier_product`, `supplier_variant`, `legacy_product_mapping`, `legacy_variant_mapping`, `product_match_queue`.

**Result:**
- `packages/database/src/schema/tables.ts` comment confirms removal in Phase 3.8.
- No active mutation code in `apps/api/src`.
- Only references are in docs, tests asserting absence, and `cutover.service.ts` comment stating "No legacy supplier_inventory".
- Database tests: `phase-3-8.test.ts` asserts those 6 tables do not exist, and passes.
- `phase-3-9.test.ts` asserts only `supplier_product_submission` exists.

**Verdict:** PASS — legacy tables absent, no active mutation paths in NestJS.

## 3. InventoryService is the only inventory writer

**Method:** Registry ownership + module-boundaries test.

**Evidence:**
- `registry.ts`: inventory tables owned solely by `inventory`.
- `test/module-boundaries.test.ts`: 8 tests PASS, including "no module references table outside ownership" with READ_EXCEPTIONS updated to include `wholesale_account` and `command_idempotency` for inventory.
- `test/architecture-freeze.test.ts`: 6 tests PASS, including `inventory has no Orders dependency or order-table access` and `vip cannot directly access inventory tables`.
- Direct write count outside inventory module = 0 (see section 1).

**Verdict:** PASS — InventoryService is sole writer in NestJS canonical code.

## 4. AuditService boundary is respected

**Method:** Check for direct `audit_log`/`auditLog` inserts outside `audit` module; verify inventory uses `auditService.record(entry, tx)`.

**Result:**
- `grep audit_log outside audit module`: only `registry.ts` ownership entry, no inserts.
- `inventory.service.ts`: 7 calls to `auditService.record` with `tx as any` executor, same transaction as inventory mutation. No direct `auditLog` table inserts, no try/catch swallowing.
- `audit.service.ts`: sole owner, accepts executor param, defaults to root db only for standalone, but inventory passes tx explicitly.
- Legacy: `frontend-next/server/kolbe-api.ts` still does `INSERT INTO audit_log` directly (legacy adapter). Documented in `audit-contract.md` as temporary.

**Closure of I-08, I-09:**
- I-08 (system actor FK): fixed — uses `null` actorId + metadata `system:true`, no literal 'system' FK.
- I-09 (direct audit insert, swallowed errors): fixed — uses AuditService same-tx, failure rolls back.

**Verdict:** PASS for NestJS; legacy direct audit insert remains as documented debt to be removed in 4.3/4.5.

## 5. All Phase 3.10 frozen invariants still hold

**Frozen invariants from `domain-ownership-freeze.md`:**

- Retail is KOLBE-only. Suppliers cannot set retail price or become retail seller.
  - Verified by `retail-isolation.spec.ts` (8 tests) and `catalog.logic.spec.ts` (26 tests) — PASS.
- Wholesale supports KOLBE and SUPPLIER; exclusive KOLBE products reject supplier offers.
  - Same tests — PASS.
- Supplier proposes via `supplier_product_submission`, admin review mandatory, no auto-merge.
  - `product-authority.spec.ts` (6 tests) and catalog logic — PASS.
- Migration 0010 and commercial separation intact.
  - `phase-3-9.test.ts` (4 tests) and `phase-3-8.test.ts` (10 tests) — PASS. Commercial separation test in catalog logic — PASS.
- Inventory keyed by `(seller_id, variant_id)` and one writer.
  - Unique index `product_variant_inventory_variant_seller_unique` exists; registry single owner; module-boundaries PASS.
- Subscription selection pending; client payment references cannot grant access.
  - `vip.logic.spec.ts` (13 tests) — PASS, subscription pending.
- Historical order quantities, seller, prices, package composition immutable from creation.
  - Design frozen in `order-boundary.md`, no code yet mutating history; no tests violated.
- Order, inventory ledger, financial ledger, payment, invoice, shipment separate concepts.
  - Registry shows separate ownership; no cross-writes detected.

**Architecture freeze tests:**
- `architecture-freeze.test.ts`: 6 tests PASS (no cycles, inventory/catalog no Orders dependency, vip cannot access inventory tables, etc.)

**Verdict:** PASS — all frozen invariants preserved, no weakening.

## 6. Existing tests count did not decrease

**Phase 3.10 report baseline (329 tests):**
- shared 21, database 42, API 146, frontend 120

**Current after e68f1fa:**
- `npm run test --workspace @kolbe/shared`: 2 files, 21 tests — same
- `npm run test --workspace @kolbe/database`: 5 files, 42 tests — same
- `npm run test --workspace @kolbe/api`: 14 files, 162 tests — +16 (new `inventory.concurrency.spec.ts` with 16 tests, 21 logic + 22 cutover + others)
- `npm run test:all` frontend: 12 files, 120 tests — same
- Total: 21+42+162+120 = 345 tests

**Method:** No tests were removed, skipped, or weakened. New tests only added.

**Verdict:** PASS — test count increased from 329 to 345, no decrease.

## 7. Remaining blockers before Order Engine

### Critical blockers for Order Engine (must be addressed in 4.2/4.3)

| ID | Description | Current State | Required Action |
|---|---|---|---|
| I-04 | Legacy direct inventory writes in `frontend-next/server/kolbe-api.ts` (variant_id without seller_id, GREATEST clamps, bypasses InventoryService) | Still active, serves traffic during strangler. Verified 3 locations: wholesale creation `reserved=reserved+$2`, cancel `GREATEST(0,reserved-$2)`, delivery `on_hand/reserved` decrement. | Cutover in Phase 4.5: route switch to single writer (Orders → Inventory), disable legacy mutations, keep readers only until clients migrate. |
| I-12 | VIP request acceptance isn't stock evidence; role-only transition lacks supplier ownership and lock | `vip.service.ts` still uses `available=Number.MAX_SAFE_INTEGER` placeholder, transitionRequest role-only | Phase 4.3: seller-scoped confirmation, lock request aggregate, atomic conversion via Orders. |
| I-13 | `CurrentUser` returns Claims with `sub`, but several controllers used `user.id` (identity mismatch) | Fixed in inventory controller (uses `claims.sub`), but needs full sweep for Orders controllers | Before 4.3: real Claims controller integration tests, ensure `Claims.sub` everywhere. |
| Orders foundation | Missing `order_status_history`, `order_events`, `wholesale_order_item` immutable snapshots, `purchase_order_item.product_id` required but legacy omits, KOLBE grouping null `supplier_id` vs NOT NULL | Tables not yet evolved; migration 0011 only added idempotency | Phase 4.2: evolve existing order tables, add history/events, enforce KOLBE nullable supplier, seller consistency, positive qty, exact totals, request conversion uniqueness. |
| Transaction executor sharing | InventoryService currently always owns transaction (`db.transaction`), does not accept external executor | Phase 4.1 standalone works, but Orders needs to pass same executor for atomic order+holds+VIP+audit | Phase 4.3: refactor InventoryService methods to accept optional `executor: DbOrTx` param; if provided, use it, else create transaction. Same for AuditService already supports it. |
| Allocation linkage | `inventory_reservation.allocation_id` exists with partial unique, but no FK to order items yet; `request_id` still nullable | Partial I-06 closure; allocation uniqueness implemented | Phase 4.2: add order-item linkage table or columns, enforce one active allocation generation per order component. |
| Scheduler | Expiry batch uses `FOR UPDATE SKIP LOCKED` and DB-time `NOW()`, but no running scheduler | Batch proof implemented, scheduler rollout deferred per plan | Before live holds: enable scheduler with metrics, oldest-expiry ordering, lag monitoring (I-18). |

### High/Medium remaining (not blocking 4.2 start, but must close before 4.3/4.4)

- I-14: inventory_ledger append-only trigger missing (only audit_log has trigger)
- I-15: `resolveSellerIdFromUserId` does not check supplier active status and member action roles
- I-16: No stock observation version/freshness/source for external sync
- I-17: Arithmetic/role tests do not exercise service transaction rollback or concurrency — partially addressed by new concurrency spec, but real DB concurrency tests still needed (final-stock contest, shared-variant packages, failure after each write, two expiry workers, etc.) as listed in inventory-contract acceptance evidence
- I-18: expiry `.limit(limit)` without operational metrics
- I-19: timestamp/random ID construction vs shared UUID generation

### No critical blocker found requiring immediate code change

- All Phase 4.1 goals from `phase-4-plan.md` are met:
  - Transactions, row locks (`FOR UPDATE` stable order, reservation before balance)
  - Safe quantity validation, exact ledger reconciliation, no `Math.max` clamp
  - AuditService same-transaction writes
  - Idempotent terminal commands, persistent idempotency with `request_hash` 409
  - Atomic package reservation with aggregated shared variants
  - Worker-safe expiration batch preparation with `SKIP LOCKED` and DB-time check
  - System actor FK fix, buyer ownership check (VIP)
- Gates: `typecheck:all` PASS, `test:all` PASS (345 tests), `build` PASS, `infra:verify` PASS
- No new direct inventory writes introduced outside InventoryService

## Recommendation

**Ready to start Phase 4.2 — Order database foundation.** Phase 4.1 exit criteria satisfied.

Before enabling Order Engine writes (Phase 4.3), must:
1. Implement executor-sharing refactor for InventoryService
2. Evolve order tables with immutable snapshots and history/events
3. Close I-04 by planning cutover and ensuring legacy inventory mutations are disabled after route switch
4. Add real PostgreSQL concurrency/failure-injection tests as required by inventory-contract (final stock contest, shared-variant packages, rollback after each write, duplicate reserve, release vs consume vs expiry, two expiry workers, audit failure, cross-seller access, wrong VIP owner, stale external adjustment, invalid quantities)

No production order rollout authorized yet. Do not start Order implementation in this audit — proceed to Phase 4.2 planning.

---
Audit performed by automated repository scan and test execution after e68f1fa. No code modifications made during audit.
