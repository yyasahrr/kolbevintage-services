# Phase 4.5 — Legacy Writer Audit

Starting SHA: 87da03e76ded2dd2ea35f164a9563d103cee7567
Date: 2026-09-19
Scope: Enumerate ALL runtime wholesale mutations in `frontend-next/server/kolbe-api.ts` and map to canonical Nest APIs.

## 1. Inventory of Legacy Mutations

### 1.1 Wholesale Order Creation
- **Location**: `handleWholesale` POST `wholesale/orders`
- **Legacy SQL**:
  - `INSERT INTO wholesale_order (id,order_code,account_id,total_amount,total_units,idempotency_key) VALUES (...)`
  - `UPDATE product_variant_inventory SET reserved=reserved+$2 WHERE variant_id=$1`
  - `INSERT INTO wholesale_order_item (id,order_id,product_id,variant_id,seller_offer_id,product_name,sku,quantity,unit_price) VALUES (...)`
  - `INSERT INTO audit_log (...)`
- **Issues**:
  - Direct inventory reserve without `FOR UPDATE` deterministic lock, no ledger, no expiration, no allocation traceability.
  - Uses `product_variant_inventory` directly, bypasses `InventoryService.reserveOrderAllocations` which aggregates by seller+variant ASC, locks deterministically, creates `inventory_reservation` with `order_id`, `order_item_id`, `allocation_id`, `child_order_id`.
  - No `commandIdempotency` check for idempotency payload hash, only checks existence of order_code by idempotency_key, allows payload mismatch.
  - No pricing version, no currency split totals, no immutable snapshots, no `wholesale_order_request` link.
  - Direct `audit_log` insert bypasses `AuditService` transactional guarantee.
- **Canonical Replacement**:
  - `POST /api/v1/wholesale/orders` via Nest `OrdersService.createWholesaleOrder`
  - Headers: `Idempotency-Key` required, server derives `buyerUserId` from `Claims.sub`, never trust body `accountId`.
  - Service: locks requests `FOR UPDATE`, validates accepted terms hash, aggregates allocations by seller+variant ASC, calls `InventoryService.reserveOrderAllocations` with same tx, creates `wholesale_order` with `order_code KV-W-*`, `currency IRR`, `items_total`, `shipping_total`, `grand_total`, `version 0`, `pricing_version`, `payment_mode`, `shipping_address_snapshot`, `billing_address_snapshot`, `idempotency_key`, `creation_request_hash`, `buyer_user_id`, `account_id`, `originating_request_id` (or multi-request link via `wholesale_order_request`), `order_status_history` from ABSENT→draft, `order_event order.created`, `audit_log` via `AuditService` same tx, `commandIdempotency` with requestHash.
  - No direct `product_variant_inventory` SQL.

### 1.2 Supplier Child Order Status Updates
- **Location**: `updatePurchaseOrder` function and `handleSupplier` POST `supplier/orders/:id/status`
- **Legacy SQL**:
  - `SELECT * FROM purchase_order WHERE id=$1 FOR UPDATE` (good)
  - `UPDATE purchase_order SET status=$2, tracking_code=CASE WHEN $2='shipped' THEN $3 ELSE tracking_code END, shipped_at=CASE WHEN $2='shipped' THEN now() ELSE shipped_at END, delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END, updated_at=now() WHERE id=$1`
  - For delivered: `SELECT * FROM purchase_order_item WHERE purchase_order_id=$1`
  - `UPDATE product_variant_inventory SET on_hand=GREATEST(0,on_hand-$2), reserved=GREATEST(0,reserved-$2) WHERE variant_id=$1` — uses GREATEST clamping, no ledger, no reservation release tracking, no `inventory_reservation` status transition, no `order_status_history`, no `order_event`, no parent aggregation.
  - `SELECT 1 FROM purchase_order WHERE wholesale_order_id=$1 AND id<>$2 AND status NOT IN ('delivered','cancelled') LIMIT 1` and `UPDATE wholesale_order SET status='fulfilled'` — wrong status (should be `shipped`/`completed` per state machine, not `fulfilled`), no version increment, no history.
  - `INSERT INTO audit_log`
- **Issues**:
  - Arbitrary status body (`body.status`) without role checks, without idempotency, without `commandIdempotency`.
  - Finance role could dispatch, warehouse could confirm commercial — violates Phase 4.4 role matrix.
  - No `fulfillment_exception` blocking check.
  - Inventory decrement on delivery instead of on dispatch via `InventoryService.confirmChildOrderAllocations`, and uses GREATEST clamping hiding underflow.
  - No `order_status_history` for child, no parent aggregation with version increment.
  - Direct `product_variant_inventory` mutation.
- **Canonical Replacement**:
  - Supplier APIs via Nest:
    - `POST /api/v1/supplier/orders/:id/confirm` → `OrdersService.confirmChildOrder` with `actorUserId=Claims.sub`, `supplierRole` from `supplierMember.role`, checks `ORDER_OWNERSHIP_VIOLATION`, `ROLE_NOT_ALLOWED` (owner/sales only), `EXCEPTION_BLOCKING`, parent not cancelled/completed, `commandIdempotency` with `orders.child_confirm`, `order_status_history` childVersion+1, `order_event child.confirmed`.
    - `POST /:id/start-preparation` → `startChildPreparation` (owner/sales/warehouse, finance forbidden, parent payment gate processing/fulfillment/shipped/completed)
    - `POST /:id/ready` → `markChildReady` (owner/warehouse, idempotent ready_at, no inventory decrement)
    - `POST /:id/dispatch` → `dispatchChildOrder` (owner/warehouse/sales, inventory confirm via `InventoryService.confirmChildOrderAllocations` deterministic, parent aggregation shipped/fulfillment, `commandIdempotency` replay before status check, no double decrement)
    - `POST /:id/deliver` → `deliverChildOrder` (no second decrement)
    - `POST /:id/cancel` → `cancelChildOrder` (owner/sales, releases only that child's active reservations via `InventoryService.releaseChildOrderAllocations`, sibling unchanged, parent aggregation ALL cancelled explicit)
    - `POST /:id/report-exception` → `FulfillmentService.reportException` (owner/sales, freeze affected items snapshot, no mutation of original OrderItem)
  - No arbitrary status body, only canonical transitions.

### 1.3 Admin Approve Order → Create Purchase Orders
- **Location**: `handleAdmin` POST `admin/orders/:id/approve`
- **Legacy SQL**:
  - `SELECT * FROM wholesale_order WHERE id=$1 FOR UPDATE`
  - `SELECT wi.*, s.supplier_id FROM wholesale_order_item wi JOIN seller_offer so ON so.id=wi.seller_offer_id JOIN seller s ON s.id=so.seller_id WHERE wi.order_id=$1`
  - Groups by supplier_id, then `INSERT INTO purchase_order (id,order_code,supplier_id,wholesale_order_id,due_date,total_amount)` and `INSERT INTO purchase_order_item (id,purchase_order_id,product_name,sku,variant_id,quantity,unit_price,total_amount)`
  - `UPDATE wholesale_order SET status='approved'`
  - `INSERT INTO audit_log`
- **Issues**:
  - Phase 4.3 already creates children atomically during `createWholesaleOrder`. This legacy path creates duplicate children, violates single-writer, no versioning, no `order_status_history`, no `order_event child.created`, no `wholesale_order_request` link, uses deprecated `approved` status (not in Phase 4.2 state machine), no inventory reservation linkage.
  - No idempotency, no `commandIdempotency`.
  - Direct `purchase_order` insert bypasses `OrdersService`.
- **Canonical Replacement**:
  - Remove this route entirely. Canonical creation already creates children.
  - If admin needs to inspect, use `GET /api/v1/admin/wholesale/orders/:id` which returns parent + children from `OrdersService.getOrderWithItems`.
  - No duplicate children.

### 1.4 Admin Cancel Order (Parent)
- **Location**: `handleAdmin` POST `admin/orders/:id/cancel`
- **Legacy SQL**:
  - `SELECT * FROM wholesale_order WHERE id=$1 FOR UPDATE`
  - `SELECT * FROM wholesale_order_item WHERE order_id=$1`
  - `UPDATE product_variant_inventory SET reserved=GREATEST(0,reserved-$2) WHERE variant_id=$1` — GREATEST clamping, no ledger, no `inventory_reservation` release, no deterministic lock.
  - `UPDATE purchase_order SET status='cancelled' WHERE wholesale_order_id=$1 AND status IN ('pending','confirmed','preparing')`
  - `UPDATE wholesale_order SET status='cancelled'`
  - `INSERT INTO audit_log`
- **Issues**:
  - No check for shipped/delivered children (should block if any dispatched), violates frozen rules.
  - No transactional lock of children deterministic, no version increment for parent or children, no `order_status_history`, no `order_event order.parent_cancelled`, no financial evidence `future_refund_or_payment_adjustment`.
  - Direct inventory SQL, manual compensation, no `InventoryService`.
  - No reason required, no idempotency.
  - Uses `GREATEST(0,...)` hiding underflow.
- **Canonical Replacement**:
  - `POST /api/v1/admin/wholesale/orders/:id/cancel` → `OrdersService.cancelParentOrder` (or admin-specific wrapper)
  - Transaction: lock parent FOR UPDATE → lock children deterministic id ASC → verify no child shipped/delivered → release remaining active via `InventoryService.releaseChildOrderAllocations` with same tx → cancel eligible children (status pending/confirmed/preparing/ready) → parent cancelled with version+1, cancelledAt, cancellationReason, cancelledBy=Claims.sub → `order_status_history` for parent and each child with reason, `order_event order.parent_cancelled` + `child.cancelled` per child, `audit_log` via `AuditService`, `commandIdempotency` with `orders.parent_cancel` or `admin.wholesale_cancel`, financial evidence payload kind `future_refund_or_payment_adjustment` amount currency scope `full_parent` but no refund/wallet/payment mutation.
  - Every override reason required.

### 1.5 Direct Audit Log Inserts
- **Location**: Multiple `appendAudit` calls in `kolbe-api.ts` that directly `INSERT INTO audit_log`
- **Issues**:
  - Bypasses `AuditService` which ensures same-transaction audit and redaction of PII, structured logs.
  - No guarantee of rollback if domain mutation fails.
- **Canonical Replacement**:
  - All Nest services use `AuditService.record` with same tx executor, which writes `audit_log` with actorId, actorRole, action, entityType, entityId, before/after, metadata, requestId, and ensures no PII (address, sessions, cookies) logged.

### 1.6 Other Direct Inventory Mutations
- **Location**: `frontend-next/server/database.ts` `INSERT INTO product_variant_inventory` during legacy inventory bootstrap (not runtime order flow, but still direct).
- **Canonical**: `InventoryService.upsertVariantInventory` with `FOR UPDATE`, ledger, audit, idempotency.

## 2. Kill Switch

- Env var `LEGACY_MUTATION_DISABLED=true` disables all legacy wholesale mutation routes in `frontend-next/server/kolbe-api.ts`.
- Implementation: at top of `handleWholesale` and `handleAdmin` and `handleSupplier` order status routes, check `process.env.LEGACY_MUTATION_DISABLED === 'true'` → throw `HttpError(410, 'LEGACY_MUTATION_DISABLED')` with message "Legacy wholesale mutations disabled — use Nest canonical APIs".
- Alternatively route removal: delete `wholesale/orders` POST and `admin/orders/:id/approve` and `admin/orders/:id/cancel` and `supplier/orders/:id/status` legacy handlers, leaving only read-only paths or forwarding to Nest.
- No hidden fallback: rollback strategy must NOT be turning direct SQL back on. Rollback = revert to previous Nest version via Nginx, not re-enable legacy SQL.

## 3. Frontend/BFF Cutover Mapping

- **Secure Cookie Forwarding**: Frontend Next.js `server` layer must forward `kolbe_session` HttpOnly cookie to Nest API via `fetch` with `credentials: 'include'` or explicit `Cookie` header from incoming request, server-side only, no `localStorage` bearer, no fake internal admin token, no user-controlled identity forwarding. Nest remains authority via `Claims.sub`.
- **Order Creation**: `POST /api/wholesale/orders` in Next BFF → `POST https://nest/api/v1/wholesale/orders` with `Idempotency-Key` from client, body `requests[]`, `paymentMode`, `shippingAddress`, `billingAddress`, cookie forwarded.
- **Supplier Status**: Map legacy arbitrary status body to canonical:
  - `pending→confirmed` via `/supplier/orders/:id/confirm`
  - `confirmed→preparing` via `/start-preparation`
  - `preparing→ready` via `/ready` (idempotent)
  - `ready→shipped` via `/dispatch` with trackingCode
  - `shipped→delivered` via `/deliver`
  - `report-exception` via `/report-exception`
  - `cancel` via `/cancel` with reason
- **No Duplicate Children**: Remove `admin/orders/:id/approve` that inserts `purchase_order`. Phase 4.3 already creates children atomically.
- **Cancellation**: Map to canonical parent cancellation `POST /admin/wholesale/orders/:id/cancel` with reason, no `GREATEST` clamping.
- **Audit Log**: Remove direct `audit_log` inserts, rely on Nest `AuditService`.
- **Compatibility Adapter**: Canonical DTO → Next BFF → existing page model, do NOT change canonical schema. Example: Nest returns `itemsTotal` bigint string, BFF maps to `total_amount` number for legacy UI, but keeps immutable snapshots.

## 4. Single-Writer Proof

- Protected tables: `wholesale_order`, `wholesale_order_item`, `wholesale_order_request`, `purchase_order`, `purchase_order_item`, `wholesale_request`, `product_variant_inventory`, `inventory_reservation`, `inventory_ledger`, `order_status_history`, `order_event`, `fulfillment_exception`, `fulfillment_replacement_request`, `wholesale_request_revision`, `audit_log`, `command_idempotency`
- Owner modules: `orders`, `inventory`, `vip`, `fulfillment`, `audit`, `checkout` (retail only), etc. per `registry.ts`.
- Production runtime outside owner modules (e.g., `frontend-next/server/kolbe-api.ts`, `frontend-next/app/api`, etc.) must NOT contain `INSERT INTO wholesale_order`, `UPDATE purchase_order SET status`, `UPDATE product_variant_inventory`, etc. Test `phase-4-5-single-writer.test.ts` scans repo and fails CI if found.
- Migrations, tests, and approved owner modules excluded.

## 5. Kill Switch Implementation Proof (Phase 4.5 Done)

- **Function**: `assertLegacyMutationsEnabled()` in `frontend-next/server/kolbe-api.ts` lines ~805-810
  ```ts
  function assertLegacyMutationsEnabled(){
    if(process.env.LEGACY_MUTATION_DISABLED==="true")
      throw new HttpError(410,"LEGACY_MUTATION_DISABLED");
  }
  ```
- **Patched handlers**:
  - `supplier/orders/:id/status POST` (line ~907) → now calls `forwardToNest` to canonical `supplier/orders/:id/{confirm,start-preparation,ready,dispatch,deliver,cancel}` via secure HttpOnly cookie forwarding, no direct SQL, no GREATEST, no audit_log direct
  - `wholesale/orders POST` (line ~1057) → now forwards to Nest `POST /api/v1/wholesale/orders` with Idempotency-Key, rejects legacy `lines` format with 422 LEGACY_ORDER_FORMAT_DEPRECATED, no direct INSERT wholesale_order/item/inventory/audit
  - `admin/orders/:id/approve POST` (line ~1444) → now returns 410 LEGACY_APPROVAL_REMOVED, duplicate children creation removed (Phase 4.3 already creates atomically)
  - `admin/orders/:id/cancel POST` (line ~1498) → now forwards to Nest `POST /api/v1/admin/wholesale/orders/:id/cancel` or `wholesale/orders/:id/cancel` with reason required, no GREATEST clamping, no direct inventory/audit
- **BFF Forwarding**: `forwardToNest` function reads `KOLBE_API_INTERNAL_URL` or `http://localhost:4000/api/v1`, forwards `cookie` header (kolbe_session HttpOnly), `idempotency-key`, `x-request-id`, server-side only, no localStorage bearer, no fake token, no user-controlled identity
- **Rollback strategy**: NOT turning direct SQL back on. Rollback = revert Nest version via Nginx, keep kill switch enabled. Documented in code comments.
- **Single-writer test**: `apps/api/test/phase-4-5-single-writer.test.ts` scans `frontend-next/server`, `app`, `lib`, `common`, `admin`, `auth` for INSERT/UPDATE/DELETE on protected tables, fails CI if found outside owner modules. Now passes after removing `updatePurchaseOrder` direct SQL and guarding `audit_log`.
- **Compatibility Adapter**: `frontend-next/server/phase-4-5-adapter.ts` maps canonical DTO → BFF model → existing page model, immutable snapshots preserved, no schema change.

## 6. Remaining Blockers (Post-Implementation)

- All core blockers implemented. Remaining: final report, local gates, remote CI GREEN.
- No payment/refund/wallet/payout tables added, no money movement, financial evidence only `future_refund_or_payment_adjustment`.
- No VIP→Fulfillment dependency: VipService does not import FulfillmentService, Fulfillment owns `fulfillment_replacement_request` link table RESTRICT no CASCADE, unique indexes prevent multiple unrelated replacement.

## 7. Canonical Mapping Summary

| Legacy Route | Legacy SQL | Canonical Nest Route | Idempotency | Auth |
|---|---|---|---|---|
| POST wholesale/orders (lines) | INSERT wholesale_order/item, UPDATE inventory, INSERT audit_log | POST /api/v1/wholesale/orders (requests[], paymentMode, shippingAddress, billingAddress) | Idempotency-Key required, requestHash payload check, 409 if reused diff payload | Claims.sub from kolbe_session HttpOnly cookie, no body accountId |
| POST supplier/orders/:id/status (arbitrary status) | UPDATE purchase_order status, UPDATE inventory GREATEST, UPDATE wholesale_order fulfilled, INSERT audit_log | POST /api/v1/supplier/orders/:id/confirm, /start-preparation, /ready, /dispatch, /deliver, /cancel, /report-exception | Idempotency-Key, command_idempotency scope child_order, replay before status check | Supplier member owner/sales/warehouse/finance matrix, server-derived sellerId from Claims.sub |
| POST admin/orders/:id/approve | INSERT purchase_order/item, UPDATE wholesale_order approved, INSERT audit_log | REMOVED — children created atomically at order creation (Phase 4.3) | N/A | Admin role but not exempt invariants |
| POST admin/orders/:id/cancel | UPDATE inventory GREATEST, UPDATE purchase_order cancelled, UPDATE wholesale_order cancelled, INSERT audit_log | POST /api/v1/admin/wholesale/orders/:id/cancel with reason | Idempotency-Key, command_idempotency scope wholesale_order, deterministic child lock ASC, InventoryService release | Admin role, reason required, blocks if shipped/delivered, financial evidence future_refund_or_payment_adjustment, no money movement |


