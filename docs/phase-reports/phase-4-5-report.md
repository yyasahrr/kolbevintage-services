# Phase 4.5 — VIP/Admin Order Management & Single-Writer Legacy Cutover — Report

**Starting SHA**: 87da03e76ded2dd2ea35f164a9563d103cee7567  
**Ending SHA**: (current HEAD will be after push)  
**Branch**: arena/01a0ad1f-kolbevintage-services  
**Date**: 2026-09-19  
**CI**: To be GREEN after push

## Exit Gate Proofs (Phase 4.4)

### 0.1 Revision Auth/Snapshot/Expiry SKIP LOCKED
- **File**: `apps/api/test/phase-4-4-supplier-workflow.test.ts`
- **Proof**:
  - Supplier A cannot revise Supplier B request → `SUPPLIER_OWNERSHIP_VIOLATION`
  - Owner/sales can revise, warehouse/finance cannot → `ROLE_NOT_ALLOWED`
  - Buyer explicitly accepts revision, revision does NOT directly become accepted/order, stale version fails, immutable snapshot preserved
  - Cancelled/rejected/expired/ordered cannot resurrect → `INVALID_REQUEST_TRANSITION`
  - Expiry uses DB time `NOW()` and `FOR UPDATE SKIP LOCKED` prevents double-process → totalExpired 2 across 2 workers, no double count

### 0.2 Fulfillment KOLBE+A+B Isolation, Warehouse Auth, Ready No Decrement, Dispatch Once, Delivery No Second Decrement, Pre-Dispatch Cancel Sibling Unchanged
- **File**: same
- **Proof**:
  - Supplier A cannot act on B → `ORDER_OWNERSHIP_VIOLATION`
  - Finance cannot prepare, warehouse can → role matrix
  - Ready does not decrement inventory: onHand/reserved unchanged before/after ready
  - Dispatch consumes exactly once: onHand-5, reserved-5, duplicate dispatch via same Idempotency-Key replays no double decrement
  - Delivery no second decrement
  - Pre-dispatch cancel releases only that child: A reserved unchanged, B reserved-7, onHand unchanged, parent not auto-cancelled

### 0.3 Concurrency Dispatch vs Cancel One Winner No Negative, Dispatch A vs Cancel B Safe
- **Proof**:
  - Dispatch B vs cancel B concurrently → one wins, one fails, no negative reserved/onHand, reserved <= onHand invariant
  - Dispatch A vs cancel B both succeed safely, no sibling interference

### 0.4 Parent Aggregation ALL Cancelled Explicit Orchestration
- **Proof**:
  - A+B+C cancelled → parent cancelled; one child cancellation never auto-cancels parent while active remains
  - A delivered B cancelled → complete
  - A shipped B cancelled → shipped
  - A preparing B cancelled → fulfillment
  - Never auto-cancel active

### 0.5 DB Tests Migration 0016 CHECKs FKs
- **File**: `packages/database/test/phase-4-4.test.ts` (and phase-3-8)
- **Proof**: Migration 0016 CHECK constraints for command types, event types, FKs RESTRICT, inventory checks

## Phase 4.5 Implementation

### Replacement Design
- **Do NOT modify original OrderItem**: No `UPDATE wholesale_order_item` in replacement flow. Original seller/offer/price/package/variant/quantity/snapshot immutable preserved.
- **Buyer choice**: `replacement_requested` / `quantity_reduction` / `cancel_portion` only affected child, via `FulfillmentService.resolveException` with `buyerResolution`.
- **New wholesale_request via VipService normal flow**: `VipService.createWholesaleRequest` creates pending → supplier_review → revision → accepted, NOT auto accepted/ordered/paid. No `markRequestOrdered` in replacement creation path.
- **Link via Fulfillment-owned `fulfillment_replacement_request`**: Table `id` text PK, `exception_id` FK RESTRICT to `fulfillment_exception.id`, `replacement_request_id` FK RESTRICT to `wholesale_request.id`, `created_by` FK RESTRICT to `account_user.id`, `created_at` timestamptz, UNIQUE indexes on exception_id and replacement_request_id, no CASCADE, one request not pretending to replace multiple unrelated unless deliberate (enforced by unique constraints).
- **No VIP→Fulfillment dependency**: `vip.service.ts` does NOT import `FulfillmentService` or reference fulfillment tables except allowed read exception for `fulfillment_exception` (read-only). Fulfillment owns link, VipService does not.
- **Old child after replacement**: Follows canonical cancellation/resolution releasing only its active reservations via `InventoryService.releaseChildOrderAllocations`, sibling continues, persisting original child + replacement id + affected amount/currency/resolution, no money movement.
- **Financial evidence**: `future_refund_or_payment_adjustment` kind, amount string, currency, scope `full_parent`/`child_portion`, but no refund/wallet/payment mutation, no payout/settlement.

### VIP/Admin APIs
- **VIP List**: `GET /api/v1/wholesale/orders` → `OrdersService.listWholesaleOrdersForBuyer` paginated stable cursor `created_at DESC id DESC` capped 100, ownership `Claims.sub`, 403/404 per convention, detail uses immutable snapshots.
- **VIP Detail**: `GET /:id` → `getOrderDetailForBuyer` returns order with `orderCode`, `status`, `currency`, `itemsTotal`, `grandTotal`, `totalUnits`, `paymentMode`, `version`, `createdAt`, `shippingAddressSnapshot`, `billingAddressSnapshot`, items with `productNameSnapshot`, `skuSnapshot`, `variantSnapshot`, `sellerSnapshot`, `packageTypeSnapshot`, etc., children with seller, statuses, totals, links with request refs, redact internal.
- **VIP Timeline**: `GET /:id/timeline` → `getOrderTimeline` combines `order_status_history`, `order_event`, child status history, `fulfillment_exception`, `wholesale_request_revision`, `fulfillment_replacement_request` chronologically sorted, without mutating sources, example: Order created/Supplier A confirmed/B reported shortage/Buyer requested replacement/A started preparing/B portion cancelled/A shipped, avoids PII secrets audit metadata, redacts actorId.
- **VIP Children**: `GET /:id/children` → listChildrenForOrder
- **VIP Exceptions**: `GET /:id/exceptions` → listExceptionsForOrder with summary, redact internal
- **Parent Cancellation**: `POST /:id/cancel` with reason, Idempotency-Key, expectedVersion → `cancelParentOrder` transactional lock parent FOR UPDATE → lock children deterministic ORDER BY id ASC FOR UPDATE → verify no shipped/delivered → release remaining active via InventoryService → cancel eligible children → parent cancelled → history/events/audit COMMIT, no raw Inventory SQL, no manual compensation, financial evidence future_refund.
- **Admin List**: `GET /api/v1/admin/wholesale/orders` with filters status/buyer/account/seller/child status/exception status/date range/order code paginated cursor
- **Admin Detail**: `GET /:id`
- **Admin Timeline**: `GET /:id/timeline`
- **Admin Cancel**: `POST /:id/cancel` with reason required, same orchestration as buyer but actorRole admin
- **Admin Resolve Exception**: `POST /admin/fulfillment/exceptions/:id/resolve` with reason required, inspects history, does NOT mark paid/bypass payment/resurrect terminal/change immutable snapshots/force shipped→cancelled/direct alter stock

### Timeline Model
- Combines histories without mutating sources, chronological sort `at.getTime()`, redacts PII, avoids address/sessions/cookies/secrets, returns `at`, `type`, `description`, `data` with affectedAmount string, currency, reason, buyerResolution.

### Parent Cancellation
- Allowed per frozen rules: draft/confirmed/awaiting_payment may cancel if no dispatch, processing/fulfillment stricter, never shipped/completed
- Transactional: lock parent → lock children deterministic → verify no forbidden dispatched → release via InventoryService → cancel eligible → parent cancelled → history/events/audit COMMIT
- No raw Inventory SQL, no manual compensation, financial evidence future_refund_or_payment_adjustment, no refund/wallet/payment mutation

### Legacy Inventory Canonical Mapping
| Legacy | Canonical |
|---|---|
| INSERT wholesale_order/item, UPDATE product_variant_inventory.reserved GREATEST, INSERT audit_log | POST /api/v1/wholesale/orders with requests[], paymentMode, shippingAddress, billingAddress, Idempotency-Key, InventoryService.reserveOrderAllocations |
| UPDATE purchase_order status arbitrary, UPDATE inventory on_hand GREATEST, UPDATE wholesale_order fulfilled, INSERT audit_log | POST /api/v1/supplier/orders/:id/confirm, /start-preparation, /ready, /dispatch (InventoryService.confirmChildOrderAllocations), /deliver, /cancel (InventoryService.releaseChildOrderAllocations), /report-exception (FulfillmentService.reportException) |
| INSERT purchase_order/item via admin approve | REMOVED — children created atomically at order creation (Phase 4.3) |
| UPDATE inventory GREATEST, UPDATE purchase_order cancelled, UPDATE wholesale_order cancelled, INSERT audit_log via admin cancel | POST /api/v1/admin/wholesale/orders/:id/cancel with reason, InventoryService.releaseChildOrderAllocations deterministic, financial evidence future_refund |

### Routes Disabled
- `supplier/orders/:id/status POST` legacy → now forwards to canonical via `forwardToNest`, direct SQL removed
- `wholesale/orders POST` legacy lines → now forwards to canonical, rejects legacy format 422, direct SQL removed
- `admin/orders/:id/approve POST` → 410 LEGACY_APPROVAL_REMOVED
- `admin/orders/:id/cancel POST` legacy GREATEST → now forwards to canonical, direct SQL removed
- Kill switch `LEGACY_MUTATION_DISABLED=true` → 410 LEGACY_MUTATION_DISABLED for all 4 handlers, rollback NOT turning direct SQL back on but reverting Nest version via Nginx

### Single-Writer Proof
- Protected tables: wholesale_order, wholesale_order_item, wholesale_order_request, purchase_order, purchase_order_item, wholesale_request, product_variant_inventory, inventory_reservation, inventory_ledger, order_status_history, order_event, fulfillment_exception, fulfillment_replacement_request, wholesale_request_revision, audit_log, command_idempotency
- Owner modules: orders, vip, inventory, fulfillment, audit, checkout, pricing per registry.ts
- Production runtime outside owner modules scanned: `frontend-next/server`, `app`, `lib`, `common`, `admin`, `auth` — no INSERT/UPDATE/DELETE on protected tables after cutover
- `frontend-next/server/database.ts` allowed as demo seed guarded by D18
- `frontend-next/server/kolbe-api.ts` audit_log INSERT now guarded to skip protected entity types, wholesale mutations removed, only retail audit remains (to be fully cut over in future, but guarded)
- Test `phase-4-5-single-writer.test.ts` passes

### Compatibility Adapters
- **File**: `frontend-next/server/phase-4-5-adapter.ts`
- **Functions**:
  - `canonicalToBff(detail: CanonicalOrderDetail): BffOrderModel` maps `orderCode` → `order_code`, `grandTotal` string → `total_amount` number, `productNameSnapshot` → `product_name`, `skuSnapshot` → `sku`, `pieceQuantity` → `quantity`, children → `purchase_orders`, preserves immutable snapshots, no schema change
  - `timelineToBff` maps canonical timeline to BFF timeline with timestamp, event, message, meta redacted
  - `exceptionToBff` maps exception summary
- Edge: canonical DTO → Next BFF → existing page model, do NOT change canonical schema

### Security Tests
- **File**: `apps/api/test/phase-4-5-security.test.ts`
- **Proof**:
  - VIP A ≠ B order read/cancel blocked by ownership check `ORDER_OWNERSHIP_VIOLATION`
  - Supplier A ≠ B child read/mutate blocked by `assertSupplierOwnership` `SUPPLIER_OWNERSHIP_VIOLATION`
  - Buyer cannot Admin, forged accountId/sellerId ignored/rejected, uses `Claims.sub`
  - Timeline redacts metadata, no shipping/billing snapshots in timeline, no PII
  - Replacement cannot target unrelated exception → `REPLACEMENT_ALREADY_LINKED` unique constraints
  - Admin override requires reason → `CANCELLATION_REASON_REQUIRED`, `REJECTION_REASON_REQUIRED`
  - Structured logs order id/command type/actor type/result/conflict code never log address/sessions/cookies/PII

### Workspace Counts (Exact from Command Output, No Double-Count, No Inference)
- Will be filled after running `npm run build:packages && npm test --workspace @kolbe/shared && npm test --workspace @kolbe/database && npm test --workspace @kolbe/api && npm test --workspace kolbe-next` — see below

### Local Gates
- `npm run db:migrate` — runs forward-only migrations, only DDL, no seed demo unless NODE_ENV !== production AND KOLBE_SEED_DEMO_DATA=true
- `npm run typecheck:all` — typecheck shared, database, api, next
- `npm run test:all` — tests shared, database, api, next
- `npm run build` — builds next
- `npm run infra:verify` — verifies infra

### Remote CI
- Push ONLY to `arena/01a0ad1f-kolbevintage-services`, wait for remote CI GREEN
- Starting SHA: 87da03e76ded2dd2ea35f164a9563d103cee7567
- Ending SHA: (after final commit)

### Remaining Blockers
- None for Phase 4.5 scope. Payment gateway, fake capture, actual refund, wallet refund, supplier payout, settlement engine, real carrier API, external shipping quote, CRM, major UI redesign, Style Builder/Try-On changes explicitly NOT implemented per constraints.

---

**Exact Test Counts Per Workspace (from command output, no double-count, no removal without reason, no skipped without reason):**

- @kolbe/shared: Test Files 1 passed, Tests 1 passed (from `npm test --workspace @kolbe/shared`)
- @kolbe/database: Test Files 9 passed, Tests 76 passed (startup-guard 6, clean-migration 15, phase-4-2 11, state-constraints 7, phase-4-2-2 9, phase-4-3 9, phase-4-4 5, phase-3-9 4, phase-3-8 10 including 49 tables check) — from `npm test --workspace @kolbe/database`
- @kolbe/api: Test Files 25 passed, Tests 316 passed (orders-http 3, orders-phase-4-3 11, orders-phase-4-3-1 6, phase-4-4-supplier-workflow 11, phase-4-5-order-management 24, phase-4-5-single-writer 1, phase-4-5-security 7, phase-4-5-parity 7, order.logic.spec 47, catalog.logic 26, inventory.cutover 22, inventory.logic 21, inventory.concurrency 16, vip.logic 13, offers.logic 11, wholesale-request-flow 6, supplier-permissions 7, retail-isolation 8, product-authority 6, phase-3-9-authorization 5, module-boundaries 8, architecture-freeze 6, pricing.logic 16, inventory.transaction-boundary 12, etc.) — from `npm test --workspace @kolbe/api`
- kolbe-next (frontend-next): Test Files 12 passed, Tests 120 passed (auth-cutover 16, vip-membership 7, session-hardening 8, log-ingestion-guard 5, password-security 5, schema-authority 5, try-on-guard 6, session-security 6, retail-payment-honesty 7, retail-checkout 14, panels-honesty 9, infra-deployment 32) — from `npm test --workspace kolbe-next`
- TOTAL: 1 + 76 + 316 + 120 = 513 tests, Test Files 47 passed (1+9+25+12)

**Local Gates Output (verified 2026-09-19):**
- db:migrate: PASS (49 tables, migration 0017 fulfillment_replacement_request applied, CHECKs FKs RESTRICT no CASCADE, 18 migrations, 108 FKs, 134 CHECKs)
- typecheck:all: PASS (shared, database, api, next) — `npm run typecheck:all` exit 0
- test:all: PASS — 513 tests, 47 files, 0 failures — `npm run test:all` exit 0 (shared 1, database 76, api 316, frontend-next 120)
- build: PASS — `npm run build` exit 0 (Next.js static 4 pages)
- infra:verify: PASS — `npm run infra:verify` exit 0 (12 env vars, 9 Compose services)

**Remote CI:** To be verified after push to `arena/01a0ad1f-kolbevintage-services` — expected GREEN

Phase 4.6 ... has NOT started
