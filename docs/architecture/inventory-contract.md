# Inventory contract

Phase 3.10 normative target. Implementation risks remain open in the [risk register](inventory-risk-register.md); this freeze is not transactional hardening.

## Authority and ownership

`product_variant_inventory` is the sole local balance authority, keyed by `(seller_id, variant_id)`. Suppliers own their external physical stock and can sell outside Kolbe. Kolbe owns its local hold accounting, not the supplier's warehouse. External stock sync/manual adjustments must enter through InventoryService with source/version and reason; stale stock requires fresh supplier confirmation before conversion. No sync may erase active reservations or overwrite `reserved`.

InventoryService is the only writer of `product_variant_inventory`, `inventory_reservation`, and `inventory_ledger`. OrderService, SupplierService, VIPService, controllers and legacy code may not write these tables. Internal Inventory repositories may execute SQL only under InventoryService commands. InventoryCutoverService delegates and must not become another writer.

Public target commands: queryAvailability, reserve, reservePackage, release, consume (current method name: confirmReservation), adjust and expireBatch. All mutations take verified actor/scope, immutable allocation quantities, operation/idempotency key and a transaction executor where part of a larger command. The names describe future contracts, not new methods implemented here.

## Required atomic transaction

```text
BEGIN (command owner)
  claim scoped idempotency key
  lock request/order aggregate when relevant
  lock existing reservations in stable ID order
  SELECT inventory rows FOR UPDATE in (seller_id, variant_id) order
  validate active identities, recipe version, expiry and aggregate availability
  create reservation(s)
  update inventory balances
  append inventory ledger entries
  call AuditService.record(entry, same transaction)
  persist owning domain changes/events and idempotent result
COMMIT (command owner only)
```

For existing-reservation operations always lock reservations before balances. All commands touching the same groups follow the same order. Never call an external supplier/carrier/payment API while holding locks. Deadlock/serialization retries restart the entire bounded transaction with the same idempotency key.

Standalone inventory commands own their transaction. When Orders calls Inventory within order creation, Inventory must use the supplied executor and must not open or commit an independent transaction. Failure of audit, ledger, item insertion or request conversion rolls back all local writes. Manual compensating release is not database rollback.

## Balance and lifecycle invariants

`on_hand >= reserved >= 0`; available is `on_hand - reserved`. Both are integer pieces. Each active hold contributes exactly once to `reserved`. Missing inventory may be initialized atomically only by a stock adjustment, never by a reservation.

| Operation | On hand | Reserved | Durable result |
| --- | --- | --- | --- |
| Reserve | unchanged | +q | active reservation, RESERVE ledger |
| Release/cancel/expire active hold | unchanged | -q | terminal reservation, RELEASE ledger |
| Consume at dispatch | -q | -q | confirmed reservation, DECREASE ledger |
| External sale/restock/adjustment | explicit delta | unchanged | validated balance, matching ledger |

No `Math.max`/`GREATEST` clamp may hide an underflow or discard outstanding holds. An external reduction below reserved is a shortage exception requiring reconciliation; it does not silently cancel reservations. Ledger before/after values and deltas must reconcile exactly.

Pending reservations have no reserved balance. Activation and balance increment are atomic and no partially-created pending row may survive a failed command. Confirm/release/expiration re-read the locked status; terminal repeats with the same operation return the prior result, conflicting terminal operations fail. Consumption rejects expired holds using database time, even if a worker has not run yet.

Reservations require a durable allocation key plus request/order-item linkage in Phase 4.2. Until order tables are extended, Phase 4.1 can harden the existing request scope without implementing Orders. The intended uniqueness is `(allocation_id, seller_id, variant_id)`; allocation generations permit explicit re-reservation after expiry without losing the prior history. One active allocation generation per order component is enforced.

## Packages, expiry and authorization

Expand immutable recipes according to [quantity rules](quantity-and-package-model.md); aggregate shared variants across all lines before taking locks. Verify package → offer → seller and variant → product relationships using owner query contracts. All required pieces are reserved in one transaction, or none are.

Uncommitted cart/request holds have a bounded expiry, with 30 minutes as the initial order hold policy. At processing entry, holds must still be valid and atomically become committed allocations with no cart TTL; cancellation can release them until dispatch. The deadline may be changed only by an authorized audited command, not client input. Accepted supplier terms have a distinct validity deadline.

Expiry workers claim eligible active holds with `FOR UPDATE SKIP LOCKED`, then lock balances consistently, recheck database-time expiry and release atomically. Whole-package/order allocation groups expire together. A worker must not lock the order after inventory; it emits a durable allocation-expired record and Orders reconciles through its own command, rechecking hold validity before any advance. Worker retries cannot double-release. Phase 4.1 prepares this transactional batch boundary; enabling a scheduler is a later explicit rollout gate.

Supplier actors are resolved through verified membership and active supplier/seller, with action-specific roles. Buyer cancellation is authorized against the owning request/order account; knowing a reservation ID grants no rights. System actor is trusted server context and uses a nullable audit/ledger actor FK with system metadata, or a provisioned service principal. The literal `system` must not be inserted into `account_user` FKs without such a principal.

## Acceptance evidence required in Phase 4.1

Real PostgreSQL concurrency and failure-injection tests: final stock contest, shared-variant packages, rollback after each write, duplicate reserve, release versus consume versus expiry, two expiry workers, audit failure, cross-seller access, wrong VIP owner, stale external adjustment and invalid quantities. Assert balances, reservation totals, ledger and audit together. Pure arithmetic tests alone cannot prove atomicity.
