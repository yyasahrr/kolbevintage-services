# Phase 4 execution plan

Plan only, based on the [Phase 3.10 freeze](../architecture/domain-ownership-freeze.md). No Phase 4 implementation is included in the freeze commit. Each phase requires its own implementation instruction. Payments, invoices, carrier integrations, CRM, notifications and UI redesign remain separately scoped work.

## Phase 4.0 — Architecture preparation

- Goals: adopt the freeze documents, verify actual schema/runtime against historical reports, establish one writer and migration/cutover plan. Decide no parallel supplier_order table; retain Orders ownership of purchase_order as seller child aggregate.
- Tables: inspect existing order, request, offer, stock and audit tables only.
- Modules: Catalog, Offers, Suppliers, VIP, Inventory, Audit and planned Orders/Fulfillment.
- Tests: architecture dependency checks, baseline gate results; identify missing transaction and real endpoint coverage.
- Risks: old reports overstate atomicity, malformed historical migration snapshots, identity sub/id mismatch and legacy row compatibility. Preparation contracts delivered in 3.10; adoption does not mean Orders is implemented.

## Phase 4.1 — Inventory transaction hardening

- Goals: close critical I-01–I-05; shared executor transactions, row locks, safe quantity validation, exact ledger reconciliation, AuditService same-transaction writes, idempotent terminal commands, atomic package reservation and worker-safe expiration batch preparation. No Order Engine yet.
- Tables: product_variant_inventory, inventory_reservation, inventory_ledger, audit_log; minimal allocation/idempotency storage if needed with separately reviewed migrations.
- Modules: Inventory and Audit, owner query contracts for seller/package validation; no Inventory → Orders edge.
- Tests: real PostgreSQL concurrent final-stock reservations, overlapping packages, two expiry workers, release/consume/expire races, failure after every write, audit failure rollback, buyer/supplier isolation, valid system actor FK and expired confirmation.
- Risks: deadlocks, pending partial rows, stale external counts and legacy direct writers. Scheduler is not required for batch proof, but reliable scheduled expiry is a gate before live temporary holds. New writer cannot safely coexist with legacy bypasses on shared stock.
- Exit: all inventory effects are atomic/idempotent and measured risk tests pass. Existing reservations/legacy reserved balances have a reconciliation plan.

## Phase 4.2 — Order database foundation

- Goals: evolve existing parent/item/child tables, support KOLBE nullable supplier plus mandatory seller, immutable quantity/price/package snapshots, status history/events and request conversion uniqueness. Define exact sale/pricing units and eliminate implicit BOX/CARTON conversion from the future contract.
- Tables: wholesale_order/item, purchase_order/item, future order_status_history and order_events; conversion/allocation linkage; update CHECKs and shared status definitions together.
- Modules: Database, shared pure contracts, Orders registry ownership. No API activation before integration gates.
- Tests: clean migration and upgrade fixtures, KOLBE+supplier relationship constraints, positive quantity and exact totals, one conversion per request, snapshot immutability, event append-only, existing row mapping and old-reader compatibility.
- Risks: required product_id omitted by legacy code, nullable offer references, migration lineage, ambiguous old prices/units and non-evidenced status. Fail/quarantine invalid data; no destructive assumptions from pre-launch history.

## Phase 4.3 — Order service implementation

- Goals: concrete DTOs and verified Claims.sub, one eligibility policy, supplier-scoped request acceptance/revision, plan limit checks, server quote validation, atomic request → draft order conversion with seller children, holds, snapshots, audit/events and idempotency.
- Tables: Orders-owned tables and command records; VIP and Inventory writes only through owner commands on same executor.
- Modules: Orders service/repository/controller, VIP, Offers/Pricing, Suppliers queries, Inventory, Audit. Admin orchestrates supplier submission approval via Catalog + Offers to close cross-owner write debt before relying on it.
- Tests: actual HTTP Claims shape, forged IDs, wrong supplier/VIP, pending/expired entitlement, changed accepted terms, seller status, MOQ/tier units, large bigint totals, duplicate requests and concurrent conversion, rollback on any participant failure, KOLBE-only and mixed-seller orders.
- Risks: money Number coercion, stale terms, multiple active subscriptions, privileged status bypass, dual legacy writers. Gate route cutover behind parity and reconciled stock; no fake payment confirmation.

## Phase 4.4 — Supplier fulfillment workflow

- Goals: owner/sales/warehouse roles and seller-bound child order views; confirmation, preparation, readiness and explicit dispatch/delivery command boundaries. Aggregate parent state through Orders. Release on permitted cancellation; consume stock exactly once at handoff.
- Tables: existing seller child order tables and history/events; optional future fulfillment allocations with explicit owner. No shipment/invoice/payment tables as an accidental side effect.
- Modules: Fulfillment → Orders and Inventory; Supplier identity/roles; Audit. Orders never depends on Fulfillment.
- Tests: supplier A cannot act on B; KOLBE admin path; wrong team role, duplicate handoff, out-of-order transitions, parent aggregation, cancellation versus dispatch, expired allocation, payment gate cannot be bypassed.
- Risks: partial fulfillment, split shipments and paid-order cancellation need separate policies. This phase defines interfaces; no real carrier integration or unverified delivery/payment claims.

## Phase 4.5 — VIP/Admin order management and cutover

- Goals: scoped paginated history/detail/timeline APIs, cancellation and audited admin overrides, stable legacy response compatibility, single writer route switch. Reuse existing clients; any necessary portal changes require that phase's explicit scope, no redesign.
- Tables: read models over Orders/VIP/Audit plus their owner-controlled transitions; no CRM tables.
- Modules: Orders, VIP, Admin, Audit, compatibility routing/adapters.
- Tests: historical rendering after catalog/package edits, cross-account access, pagination, history redaction, original API contract scenarios, all regression gates and remote CI; assert legacy stock/order mutations are no longer reachable after cutover.
- Risks: old local/demo UI state, rolling deployments and rollback. Preserve historical data; do not re-enable legacy inventory writers as rollback.

## Release gates and deferred domains

Run typecheck:all, test:all, build and infra:verify per implementation phase; green CI is necessary but not proof of inventory concurrency or production deployment. Require the named DB concurrency and endpoint tests. Docker/Compose/nginx runtime proof is separate.

Invoices/proforma, actual payment release, shipping providers, customer CRM and notifications are separate future owners. Orders waiting for payment remains gated until a trusted implementation exists. No payment reference from the browser grants paid status or VIP access.

Phase 4 implementation has NOT started.
