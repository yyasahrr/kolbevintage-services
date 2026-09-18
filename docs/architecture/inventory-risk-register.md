# Inventory risk register — baseline ef5c412

All entries below are OPEN at Phase 3.10. They are source-level findings, not newly reproduced runtime incidents. No inventory fixes are part of this phase. Paths below are relative to the repository root.

## Critical — block enabling canonical order mutations

| ID | Evidence | Failure mode | Owner / closure gate |
| --- | --- | --- | --- |
| I-01 | `apps/api/src/modules/inventory/inventory.service.ts`, createReservation/upsertVariantInventory | Read/check/absolute update without transaction or row locks loses concurrent updates; reservation count can exceed recorded reserved even if DB CHECK passes | Inventory, 4.1: two-client final-stock and concurrent-adjustment tests |
| I-02 | Same file, reservePackage catch block | Sequential commits; failure inside createReservation can occur before its ID enters the rollback list; release errors are ignored | Inventory, 4.1: failure after each package-component write leaves zero partial effects |
| I-03 | Same file, releaseReservation/confirmReservation/releaseExpiredReservations | Concurrent terminal actions double-release/decrement; ledger/audit/status can diverge after partial failure | Inventory, 4.1: locked terminal transition and repeated/concurrent action tests |
| I-04 | `frontend-next/server/kolbe-api.ts`, wholesale/orders POST, updatePurchaseOrder, admin cancel | Inventory updates use variant_id without seller_id; creation joins inventory and offers only by variant, may select unrelated seller; bypasses InventoryService/holds/ledger | Orders + Inventory, 4.3 cutover: two sellers sharing variant remain isolated |
| I-05 | `inventory.controller.ts` release route; `inventory.logic.ts` assertReservationMutationAllowed | VIP allowed to release but no buyer/request ownership comparison | Inventory/VIP, 4.1: real authenticated VIP A cannot release VIP B hold |

## High — close before dependent Phase 4 capability

| ID | Evidence | Failure mode | Owner / closure gate |
| --- | --- | --- | --- |
| I-06 | `tables.ts` inventoryReservation | No allocation/order-item uniqueness; optional request/expiry; DB permits zero quantity | Inventory, 4.1/4.2: unique command/allocation, positive quantity and durable linkage |
| I-07 | inventory.service.ts findExpiredReservations/confirmReservation | No worker claim lock; pending leftovers not scanned; confirm does not check expiry; no running worker | Inventory, 4.1: DB-time validation and retry-safe grouped expiry batch; scheduler rollout before live holds |
| I-08 | inventory.service.ts default actorId='system'; reservePackage rollback | Ledger actor_id references account_user; unprovisioned system string can fail after balance changed; catches hide failure | Inventory/Audit, 4.1: valid service actor/null metadata and atomic failure test |
| I-09 | inventory.service.ts recordAudit | Direct audit table insert, separate transaction, swallowed errors | Audit/Inventory, 4.1: same-executor AuditService call, audit failure rolls back |
| I-10 | inventory.service.ts checkPackageAvailability/reservePackage | No package-offer-seller match; archived stock counted in preview; no whole-order shared-variant aggregation | Inventory/Offers, 4.1: seller-bound snapshot and aggregate quantities |
| I-11 | inventory.service.ts Math.max balance updates; inventory.logic.ts quantity checks | Clamps conceal shortages; missing finite safe-integer/TTL validation; negative package count may pass preview | Inventory, 4.1: reject invalid input, exact ledger deltas, no silent clamp |
| I-12 | `vip.service.ts` available=Number.MAX_SAFE_INTEGER, transitionRequest | Request acceptance isn't stock evidence; role-only transition lacks supplier ownership and lock | VIP/Orders, 4.3: seller-scoped confirmation and atomic conversion |
| I-13 | `common/guards/session.guard.ts` CurrentUser returns Claims; VIP/Offers/Catalog controllers use user.id | Runtime identity is sub, not id; compile-time object annotation hides undefined identity on newly wired flows | Auth/domain controllers, before 4.3: real Claims controller integration tests; no fix in 3.10 |

## Medium

| ID | Evidence | Risk / future action |
| --- | --- | --- |
| I-14 | inventory_ledger schema/migrations | No dedicated append-only trigger found for inventory ledger; audit trigger does not protect it. Add appropriate DB protection and event/allocation correlation in 4.1/4.2 |
| I-15 | resolveSellerIdFromUserId | Seller/supplier active status and member action roles not checked here; harmonize identity query contract in 4.1 |
| I-16 | product_variant_inventory and sync input | No stock observation version/freshness/source; outside sales can stale local availability. Add explicit reconciliation policy before external sync integration |
| I-17 | inventory.logic.spec.ts, inventory.cutover.spec.ts | Arithmetic/role tests and descriptive fixtures do not exercise service transaction rollback or concurrency. Add real DB tests, retain existing suites |

## Low

| ID | Evidence | Future action |
| --- | --- | --- |
| I-18 | expiry `.limit(limit)` without operational metrics | Add bounded pagination, oldest-expiry ordering, lag/error metrics and reconciliation dashboard after correctness |
| I-19 | timestamp/random ID construction | Prefer shared UUID generation and trace correlation when hardening; DB primary keys alone do not make commands idempotent |

## Historical claim corrections

Phase 3.6/3.8 reports and `cutover.service.ts` describe reservations as atomic/safe. The current code explicitly uses manual rollback; that claim is superseded by I-01–I-03. Package *creation* in Offers is transactional; package *reservation* is not. `product_variant_inventory` being the sole table authority does not mean InventoryService is currently the sole runtime writer. Legacy bypass I-04 remains.
