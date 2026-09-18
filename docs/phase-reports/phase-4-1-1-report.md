# Phase 4.1.1 — Order Transaction Readiness Hardening

Branch: `arena/01a0ad1f-kolbevintage-services`
Commit: `3aaf321` (feat: Phase 4.1.1)
Date: 2026-09-17
Previous: `e68f1fa` (Phase 4.1 inventory hardening)

## Scope

Per task, DO NOT implement Order tables, Payments, Shipping, Fulfillment, UI. Only prepare boundaries for future Orders flow.

Read:
- `docs/phase-reports/phase-4-1-readiness-audit.md`
- `docs/architecture/order-boundary.md`
- `docs/architecture/inventory-contract.md`
- `docs/architecture/domain-ownership-freeze.md`

## Files Changed

| File | Change |
|---|---|
| `apps/api/src/modules/inventory/inventory.service.ts` | Transaction executor refactor: `withExecutor` helper, optional `executor?: DbOrTx` in all public methods, standalone vs external tx paths, releaseExpired supports external executor |
| `apps/api/src/modules/vip/vip.service.ts` | Remove `MAX_SAFE_INTEGER` placeholder, implement proper ownership validation (VIP account approved/not expired/owned, seller exists, supplier active, offer product/status/price, package belongs to offer/has items), add supplier/vip ownership checks in `transitionRequest` |
| `apps/api/src/modules/vip/vip.logic.ts` | `validateWholesaleRequestQuantity` makes `available` optional, removes stock check at request creation (deferred to order creation per inventory-contract), adds safe-integer validation |
| `apps/api/src/modules/vip/vip.controller.ts` | Identity fix: use `Claims` with `sub` instead of `{id}`, all methods now `claims.sub` |
| `apps/api/src/modules/catalog/catalog.controller.ts` | Identity fix: use `Claims` `sub` for `createdBy`, `creatorId`, role from `claims.role` |
| `apps/api/src/modules/offers/offers.controller.ts` | Identity fix: use `Claims` `sub`, cast role to any for `actorRole` |
| `apps/api/src/modules/registry.ts` | VIP dependencies expanded to `suppliers`, `supplier-team`, `offers`, `catalog` to reflect actual reads (no cycle with inventory) |
| `apps/api/test/module-boundaries.test.ts` | READ_EXCEPTIONS: add `supplier_member` to vip, add `command_idempotency` and `wholesale_account` already, update schemaTables list includes `command_idempotency` |
| `apps/api/src/modules/inventory/inventory.transaction-boundary.spec.ts` | New 12 tests for transaction boundaries |
| `docs/phase-reports/phase-4-1-readiness-audit.md` | Audit report from previous step (now committed) |

## 1. Transaction Executor Design

**Problem:** InventoryService previously always did `this.db.transaction(async tx => ...)`, creating its own transaction. Future Orders flow requires:
```
BEGIN (Orders)
  Orders mutation
  Inventory mutation (same tx)
  VIP conversion marker
  Audit
COMMIT (Orders only)
```

**Solution:** `withExecutor` helper:

```ts
private async withExecutor<T>(executor: DbOrTx|undefined, work: (tx: DbOrTx)=>Promise<T>): Promise<T> {
  if (executor) return work(executor); // use supplied tx, no BEGIN/COMMIT
  return this.db.transaction(async tx => work(tx as any)); // standalone
}
```

- All public methods now accept `executor?: DbOrTx` (or via input object).
- Inside, all DB operations use `tx` from helper, including `claimIdempotency`, `completeIdempotency`, `auditService.record(tx)`, ledger, inventory.
- Standalone path (controller) does not pass executor → creates own transaction (backward compatible).
- Orders future path passes `tx` from its own `db.transaction` → Inventory reuses same tx, does not open/commit.
- `releaseExpiredReservations`: if executor provided, uses it for whole batch including `SELECT ... FOR UPDATE SKIP LOCKED` and per-reservation releases; else uses existing worker-safe two-level transactions.

**Verification:**
- Unit test `external executor does NOT create new transaction`: mockDb.transaction spy not called when executor provided.
- `standalone mode creates its own transaction`: spy called when no executor.

## 2. Identity Fixes (I-13)

**Problem:** `CurrentUser` decorator returns `Claims { sub, role, exp }`, but `vip.controller`, `catalog.controller`, `offers.controller` typed as `{id:string}` and used `user.id`, which is `undefined` at runtime.

**Fix:**
- All controllers now import `Claims` and use `claims.sub` as database user identity.
- `vip.controller`: `subscribe`, `createRequest`, `activate` use `claims.sub`.
- `catalog.controller`: `createProduct`, `createBrand`, `submitSupplierProduct`, `approveSubmission*`, `rejectSubmission` use `claims.sub`.
- `offers.controller`: `createOffer`, `createPackage`, `createPricingTier` use `claims.sub`, role cast to any for `actorRole`.
- `inventory.controller` already correct (uses `claims.sub`).

**Regression tests added in `inventory.transaction-boundary.spec.ts`:**
- `CurrentUser decorator returns Claims with sub, not id`
- `controllers must use claims.sub, not user.id` — demonstrates broken pattern returns undefined
- `supplier identity resolved from userId via supplier_member → seller`

**Result:** `Claims.sub = database user identity` invariant now enforced across all marketplace controllers.

## 3. VIP Fixes (I-12)

**Placeholder removed:** `let available = Number.MAX_SAFE_INTEGER` removed.

**New validation in `createWholesaleRequest`:**
1. VIP subscription active via `assertVipAccess`
2. VIP account: `wholesale_account` where `userId == claims.sub` and `status=approved` and not expired
3. Product: exists and `status=published`
4. Offer: exists, `productId` matches, `status=published`, `wholesalePrice >=0`
5. Supplier ownership: seller exists for offer; if seller has `supplierId`, supplier exists and `status` active/approved
6. Package: if provided, exists, `offerId` matches, `totalPieces>0`, has items via `wholesale_package_item`
7. Quantity: validated against MOQ only via `validateWholesaleRequestQuantity(quantity, moq)` — stock check deferred to order creation under locks per `inventory-contract`

**Transition ownership checks added in `transitionRequest`:**
- Supplier role: must be member of seller's supplier via `supplier_member`
- VIP role: must own `wholesale_account` linked to request

**Logic change:** `validateWholesaleRequestQuantity` now `available?` optional, skips stock check if undefined, with comment referencing inventory-contract.

## 4. Tests Added

**New file `inventory.transaction-boundary.spec.ts` — 12 tests:**

- **External tx can call InventoryService:** verifies `withExecutor` uses supplied executor, `db.transaction` not called
- **Inventory rollback rolls back ledger:** simulates audit failure after inventory update, transaction rollback resets flags for inventory/ledger/reservation
- **Audit rollback follows transaction:** verifies `auditService.record` receives same `tx` executor
- **Failed order preparation does not reserve stock:** simulates Orders flow BEGIN→order insert→inventory reserve→failure→rollback, asserts no reservation remains
- **Identity consistency:** 3 tests proving `Claims.sub` vs `user.id` bug
- **VIP ownership:** 4 tests proving MAX_SAFE_INTEGER removed, VIP account ownership, supplier ownership, offer/package ownership

**Existing tests preserved:**
- `inventory.concurrency.spec.ts` 16 tests still PASS
- `inventory.logic.spec.ts` 21 tests PASS
- `inventory.cutover.spec.ts` 22 tests PASS
- `module-boundaries` 8 tests PASS (after adding `supplier_member` to vip READ_EXCEPTIONS)
- `architecture-freeze` 6 tests PASS

**Total counts after 4.1.1:**
- shared: 21
- database: 42
- api: 174 (was 162, +12 new boundary tests)
- frontend: 120
- Total: 357 (was 345, increased, no decrease)

## 5. Verification Results

| Gate | Result |
|---|---|
| `npm run typecheck:all` | PASS — 4 workspaces |
| `npm run test:all` | PASS — 357 tests (21+42+174+120) |
| `npm run build` | PASS — Next.js production build |
| `npm run infra:verify` | PASS — static infra validation |

**Phase 3.10 invariants verified:**
- Inventory one writer: registry owns 4 tables, module-boundaries PASS, 0 direct writes outside inventory in NestJS
- Retail KOLBE only: `retail-isolation.spec.ts` PASS
- Supplier wholesale only: `offers.logic.spec.ts`, `catalog.logic.spec.ts` PASS
- No Orders dependency inside Inventory: `architecture-freeze.test.ts` `inventory has no Orders dependency` PASS
- No legacy schema restoration: `phase-3-8.test.ts` asserts 6 legacy tables absent, `phase-3-9.test.ts` asserts only submission exists — PASS

**Remaining blockers (not fixed in 4.1.1, per plan):**
- I-04 legacy direct inventory writes in `frontend-next/server/kolbe-api.ts` — still active, cutover planned 4.5
- Orders tables evolution (history/events, immutable snapshots) — planned 4.2
- Real PostgreSQL concurrency/failure-injection tests (final-stock contest, two expiry workers, etc.) — acceptance evidence for 4.1 still partially pending, pure unit tests added but DB-level tests deferred
- Scheduler for expiry — batch proof done, scheduler rollout deferred

## End

Phase 4.2 Order Foundation has NOT started.
