# Phase 3.10 — Marketplace architecture freeze

Date: 2026-09-17. Branch: `arena/01a0ad1f-kolbevintage-services`.
Starting SHA: `ef5c4124f2aaf436c89472bf4f1f1526802e805c`.

## Delivered

The [freeze index](../architecture/domain-ownership-freeze.md) links ten new
architecture/plan documents: domain ownership, order boundary, quantity/package
model, inventory contract, inventory risk register, audit contract, status machines,
idempotency rules, pre-Phase 4 legacy audit and Phase 4 execution plan.
The master rules now link this measured checkpoint and qualify historical atomicity claims.

Orders owns parent wholesale orders and existing purchase-order seller children;
no competing order model is introduced. InventoryService is the sole target writer;
local reservation accounting is distinct from supplier external physical stock.
Integer package recipes, exact price allocation and immutable order snapshots are
frozen. Owner services share a transaction executor, AuditService writes in that
same transaction, and lifecycle commands require scoped durable idempotency.
Orders calls VIP/Inventory, never the reverse; Fulfillment calls Orders.

## Verification

All commands completed successfully locally:

| Command | Result |
| --- | --- |
| `npm run typecheck:all` | PASS, all four workspaces |
| `npm run test:all` | PASS, 329 tests: shared 21, database 42, API 146, frontend 120 |
| `npm run build` | PASS, production Next.js build |
| `npm run infra:verify` | PASS, static validation only |

Six new architecture tests cover registry cycles, Catalog/Inventory independence
from Orders, VIP/Inventory and Suppliers/Offers table boundaries, and scanner
fixtures. Existing tests were not removed, skipped or weakened. These are source
guards, not complete taint analysis or proof of runtime transaction correctness.
Build skips types by existing configuration; the separate typecheck gate passed.
Infrastructure verification does not prove Docker image/Compose/nginx operation.

## Open risks and Phase 4 gates

All I-01–I-19 in the risk register remain open. Blocking issues include missing
inventory transactions/locks, partial package rollback, expiry/consume races,
legacy direct inventory writes, audit failures being swallowed, system actor FK
failures and missing buyer ownership checks. Claims.sub/user.id mismatch, legacy
child-order insert/schema incompatibilities and missing immutable snapshots must
also be addressed in the planned implementation phases.

Freeze completion authorizes no production order rollout. Harden Inventory first,
prove PostgreSQL concurrency/failure rollback and actual endpoint authorization,
then evolve existing order tables and cut over to a single writer.

Only documentation and a new architecture test file changed. No runtime business
logic, schemas, migrations, UI, payments or fulfillment were implemented.

Phase 4 implementation has NOT started.
