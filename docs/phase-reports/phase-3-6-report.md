# فاز ۳.۶ — آماده‌سازی گذار مالکیت موجودی — گزارش

**شاخه:** `arena/01a0ad1f-kolbevintage-services`  
**SHA شروع:** `5870b86` (پایان فاز ۳.۵)  
**SHA پایان:** (پس از کامیت‌های فاز ۳.۶)  
**تاریخ:** 2026-09-17

## خلاصهٔ اجرایی

فاز ۳.۶ گذار از `supplier_inventory` legacy به `product_variant_inventory` را برای جریان‌های تراکنشی آینده آماده می‌کند، بدون حذف legacy و بدون شروع موتور سفارش (Phase 4).

**اهداف:**

- مرز گذار (Cutover Boundary) — جریان‌های آینده فقط `InventoryService` استفاده کنند
- اجرای مالکیت — هویت تأمین‌کننده از `JWT/session → supplier_member → supplier → seller`، هرگز `sellerId` از کلاینت
- کنترلر احراز هویت‌دار — InventoryController با `@Roles`, `assertInventoryMutationAllowed`, `audit actor propagation`
- پایهٔ انقضای رزرو — `findExpiredReservations`, `releaseExpiredReservations` با ledger RELEASE، آماده برای BullMQ worker
- ایمنی رزرو بسته — `SIZE_RUN`/`COLOR_MIX`/`CUSTOM_BUNDLE` همه یا هیچ (all-or-nothing), بدون موفقیت جزئی
- منسوخ‌سازی `seller_offer.inventory_on_hand/reserved` — دیگر از ورودی خارجی پذیرفته نمی‌شود، همیشه 0، منبع حقیقت `product_variant_inventory`
- آماده‌سازی موتور سفارش — شناسایی نیازهای مهاجرت `wholesale_order_item`, `purchase_order_item`, `rfq`, `quote` از `supplier_product/variant` به `product/product_variant`
- یکپارچه‌سازی حسابرسی — `actor_id`, `reason`, `request/order reference` در همهٔ عملیات موجودی

## Task 1 — Inventory Cutover Boundary

**وضعیت قبل:**

```
frontend-next/server/kolbe-api.ts POST wholesale/orders
  ↓
supplier_inventory (SELECT FOR UPDATE, reserved++)
  ↓
wholesale_order + wholesale_order_item
```

فعال، بدون ledger، بدون مالکیت واریانت-level، بدون انقضا.

**مرز جدید:**

```
Supplier owns inventory
  ↓
product_variant_inventory (variant_id+seller_id UNIQUE, on_hand, reserved, available, status)
  ↓
InventoryService (source of truth)
  ↓
inventory_reservation (pending→active, expires_at, request_id)
  ↓
inventory_ledger (INCREASE/DECREASE/RESERVE/RELEASE/ADJUSTMENT)
  ↓
InventoryCutoverService (boundary for future Order Engine)
  ↓
Order Engine (Phase 4)
```

**پیاده‌سازی:**

- `apps/api/src/modules/inventory/cutover.service.ts` — `InventoryCutoverService`:
  - `checkCanFulfillPackage` — uses `product_variant_inventory` variant-level
  - `reservePackageForOrder` — all-or-nothing package reservation
  - `releaseReservationsForOrder` / `confirmReservationsForOrder` — for cancel/fulfill
  - `handleExpiredReservations` — for future BullMQ worker
- Legacy `kolbe-api.ts` همچنان کار می‌کند — حذف نشده، فقط ایزوله شده
- `InventoryModule` exports `InventoryService` + `InventoryCutoverService` — future Order Engine must import these, not `supplier_inventory` directly

## Task 2 — Inventory Ownership Enforcement

**شکاف قبل:**

- `upsertVariantInventory`, `createReservation`, `releaseReservation`, `confirmReservation` فقط `sellerId` از پارامتر می‌گرفتند، بدون چک مالکیت
- هویت تأمین‌کننده از کلاینت قابل جعل

**اصلاح:**

- `inventory.logic.ts`:
  - `assertInventoryMutationAllowed(role, requesterSellerId, targetSellerId)` — customer/vip forbidden, supplier requires `requesterSellerId` from auth and must equal target, admin/system allow all
  - `assertReservationMutationAllowed(role, requesterSellerId, reservationSellerId)` — customer forbidden, supplier must own reservation
  - `assertSupplierOwnsInventory` — existing, used for reads

- `inventory.service.ts`:
  - `resolveSellerIdFromUserId(userId)` — `supplier_member.user_id → supplier_id → seller.id` — ONLY secure way
  - All write methods now require `requester: {userId, role, sellerId}` and call `assertInventoryMutationAllowed`
  - `getVariantInventory`, `listInventoriesForSeller`, `checkPackageAvailability` also check ownership for supplier role
  - `releaseReservation`, `confirmReservation` check reservation ownership

- Tests:
  - Supplier A cannot modify Supplier B inventory
  - Null sellerId from auth rejected (`SUPPLIER_IDENTITY_REQUIRED`)
  - Customer/VIP cannot mutate inventory
  - Admin/system can modify any
  - Reservation ownership enforced

**نتیجه:** هویت تأمین‌کننده از `JWT/session → supplier_member → supplier → seller ownership check → inventory operation`, هرگز از `sellerId` ورودی کلاینت.

## Task 3 — Inventory Controller Boundary

**قبل:** Inventory فاقد کنترلر احراز هویت‌دار

**بعد:** `inventory.controller.ts`:

- `@Controller("inventory")` with `SessionGuard` globally
- `@Roles("supplier","admin")` for upsert, get, list, my, package availability/reserve
- `@Roles("supplier","admin","vip")` for release (vip can release own reservation via transition logic)
- `@Roles("supplier","admin")` for confirm
- `@Roles("admin")` for expired query/release (future worker)
- `resolveRequester(claims)` — resolves `sellerId` from `supplier_member` via `resolveSellerIdFromUserId`, throws `SUPPLIER_IDENTITY_REQUIRED` if missing
- **Security:** if `role=supplier` and client provides `sellerId` different from auth → `FORBIDDEN CLIENT_CANNOT_CHOOSE_SELLER_ID`
- **Audit actor propagation:** `actorId = claims.sub` passed to all service methods, stored in `inventory_ledger.actor_id` and `inventory_reservation.created_by`

**Endpoints:**

- `POST /inventory/variant` — upsert variant inventory (supplier own, admin any)
- `GET /inventory/variant/:variantId?sellerId=` — get (supplier own enforced)
- `GET /inventory/seller/:sellerId` — list for seller (isolation)
- `GET /inventory/my` — list own
- `POST /inventory/reservation` — create reservation (supplier own)
- `POST /inventory/reservation/:id/release` — release
- `POST /inventory/reservation/:id/confirm` — confirm
- `GET /inventory/reservation/expired?limit=` — find expired (admin)
- `POST /inventory/reservation/expired/release` — release expired (admin)
- `GET /inventory/package/:packageId/availability?sellerId=` — check package availability
- `POST /inventory/package/:packageId/reserve` — reserve package all-or-nothing

No raw mutation without authorization.

## Task 4 — Reservation Expiration Foundation

**قبل:** `inventory_reservation.expires_at` exists but no handling

**بعد:**

- `inventory.service.ts`:
  - `findExpiredReservations(limit)` — `SELECT WHERE status='active' AND expires_at < now()`
  - `releaseExpiredReservations(limit, actorId)` — for each expired: `UPDATE product_variant_inventory SET reserved=GREATEST(0,reserved-quantity)`, `INSERT ledger RELEASE` with reason `expired release reservation ${id} (expires_at ...)`, `UPDATE reservation SET status='expired'`, safe — continues on error, idempotent
  - `isReservationExpired` + `transitionReservation` with `system` role for `active→expired`

- **Prepared for BullMQ worker, not full worker yet:**
  - Future worker will call `handleExpiredReservations` every minute
  - Service boundary ready, no full worker system in Phase 3.6

- **Ledger RELEASE entry:** always created on expiration with `before/after reserved`, `actor_id=system`, `reason` with reservation id and expires_at

## Task 5 — Package Reservation Safety

**Review:** `SIZE_RUN`, `COLOR_MIX`, `CUSTOM_BUNDLE`

**Example:**

```
Requested: 1 Series S2 M2 L2
Either: Reserve all or Reject, No partial success
```

**پیاده‌سازی:**

- `checkPackageAvailability` — variant-level check, returns `items: {variantId, requiredQty, available, inventory}` and `packageAvailable = min(floor(available/requiredQty))`
- `reservePackage` — all-or-nothing:
  1. Check `packageAvailable >= quantity` → else reject `موجودی بسته کافی نیست`
  2. For each variant: check individual `available >= requiredQty*quantity` → else reject
  3. Sequential reservation via `createReservation` for each variant
  4. On any failure: rollback all created reservations via `releaseReservation` with `system` role and reason `rollback package ${packageId}`
  5. No partial success

- **Tests:** reserve all variants sufficient, reject insufficient package inventory, no partial when one variant 0, COLOR_MIX variant-level

**Result:** Inventory check happens on variant level, reservation covers all required variants, partial reservation impossible.

## Task 6 — seller_offer Inventory Deprecation

**قبل:** `seller_offer.inventory_on_hand/reserved` duplicated source, written from client input in `offers.controller.ts:21` and `offers.service.ts:76-77`

**بعد:**

- `offers.controller.ts`:
  - `inventoryOnHand` param marked `@deprecated`, ignored, logs warning `[offers] inventoryOnHand from client ignored — source is product_variant_inventory`
  - No longer passed to service

- `offers.service.ts`:
  - Input type no longer has `inventoryOnHand`
  - Values always `inventoryOnHand: 0, inventoryReserved: 0` with comment `DEPRECATED: source of truth is product_variant_inventory (supplier-owned, variant-level), remain for compatibility but always 0 and NOT used`
  - No longer accepts external inventory values

- `tables.ts`:
  - Comment added: `DEPRECATED Phase 3.6: source of truth is product_variant_inventory, remain for compatibility but always 0 and NOT used for stock checks`

- **Do NOT drop columns** — remain for compatibility until Phase 5

- **Documentation:** source of truth is `product_variant_inventory`

## Task 7 — Order Engine Preparation (No Implementation)

**Review:** `wholesale_order_item`, `purchase_order_item`, `rfq`, `quote`

**Current FKs:**

- `wholesale_order_item.product_id FK supplier_product`, `variant_id FK supplier_variant`
- `purchase_order_item.variant_id FK supplier_variant`, `purchase_order_id FK purchase_order`
- `rfq.supplier_id FK supplier`, `quote.rfq_id FK rfq`, `quote.supplier_id FK supplier`
- `supplier_inventory.variant_id FK supplier_variant`
- `product_match_queue.supplier_product_id FK supplier_product`, `candidate_product_id FK product`

**Future migration needs from `supplier_product/supplier_variant` to `product/product_variant`:**

1. **Canonical mapping:**
   - `supplier_product` → `product` (owner_type=SUPPLIER, status draft, brand/category mapping)
   - `supplier_variant` → `product_variant` (attributes {color,size} JSON, sku preserved)
   - `supplier` → `seller` (type=SUPPLIER)
   - `seller` + `product` → `seller_offer` (wholesale_price from supplier_product)
   - `supplier_inventory` → `product_variant_inventory` (variant_id new + seller_id, on_hand/reserved)

2. **Wholesale order item migration:**
   - Add nullable columns `canonical_product_id FK product`, `canonical_variant_id FK product_variant` to `wholesale_order_item`
   - Backfill from `supplier_product`→`product` mapping and `supplier_variant`→`product_variant`
   - Dual-write in new Order Engine: write both old and new FKs
   - Phase 5: switch reads to canonical, drop old FKs

3. **Purchase order item migration:**
   - Similar: add `canonical_variant_id FK product_variant`
   - Backfill
   - Dual-write

4. **RFQ/Quote migration:**
   - `rfq` currently supplier-centric, not product-centric — future should have `product_id FK product` or remain supplier-centric? Document as supplier-centric for now, but quote should reference `seller_offer` instead of `rfq`? Keep for Phase 4 discussion
   - `quote` should eventually reference `seller_offer` + `product_variant_inventory` for availability

5. **Supplier inventory migration:**
   - Already done in Phase 3.5: `supplier_inventory` → `product_variant_inventory` via `upsertVariantInventory`
   - Need script `migrate-legacy-to-canonical.ts` to run once

6. **Product match queue:**
   - Already uses `candidate_product_id FK product` — good
   - `supplier_product_id` should eventually be `product_variant_id` or remain for legacy matching until admin flow complete

**Documented in:** this report + `docs/inventory-cutover-3-6.md` (planned)

**No Order Engine implemented in Phase 3.6** — only preparation.

## Task 8 — Audit Integration

**Inventory changes traceable:**

- All `inventory.service.ts` methods now require `requester: {userId, role, sellerId}` and propagate `actorId = requester.userId` to `inventory_ledger.actor_id`
- `reason` always includes request/order reference when available: `reservation ${id} for request ${requestId}`, `package ${packageId} x${quantity} for request ${requestId}`, `release reservation ${id} by ${role} ${userId}`, `confirm reservation ${id} -> order by ${userId}`, `expired release reservation ${id} (expires_at ...)`, `rollback package ${packageId}`
- `inventory_reservation.created_by = requester.userId`
- `inventory_ledger` has `before_on_hand/after_on_hand`, `before_reserved/after_reserved`, `quantity_delta`, `change_type`, `reason`, `actor_id`, `created_at`

**Prepared integration with audit_log:**

- `audit_log` module owned by `audit` — not redesigned
- Future: `InventoryService` could call `AuditService.record` with `action: inventory.*`, `entityType: product_variant_inventory/inventory_reservation/inventory_ledger`, `entityId`, `before/after`, `metadata: {ip, seller_id, variant_id, reason}`
- Currently ledger is append-only and provides audit trail; central audit_log integration prepared but not yet wired to avoid redesigning audit module in Phase 3.6

## Tests Required — Added

**File:** `apps/api/src/modules/inventory/inventory.cutover.spec.ts` (22 tests)

### Ownership

- supplier isolation — Supplier A cannot modify Supplier B inventory (`INVENTORY_OWNERSHIP_VIOLATION`)
- unauthorized mutation rejected — null sellerId from auth rejected (`SUPPLIER_IDENTITY_REQUIRED`), customer/vip forbidden (`INVENTORY_MUTATION_FORBIDDEN`), admin/system allow any, read isolation, reservation ownership

### Reservation

- reserve all variants — sufficient inventory → `packageAvailable >= requested`
- reject insufficient package inventory — `packageAvailable < requested` → reject
- release expired reservation — `findExpiredReservations` exists, safe release with ledger RELEASE, prepared for BullMQ, no partial success for `S:0 M:10 L:10`

### Deprecation

- seller_offer inventory not used as source — source is `product_variant_inventory`, deprecated fields always 0, client input ignored

### Security

- client cannot choose sellerId — secure flow `JWT/session → supplier_member → supplier → seller ownership check → inventory operation`, controller throws `CLIENT_CANNOT_CHOOSE_SELLER_ID` if client provides different sellerId, admin can specify sellerId, supplier cannot

**Existing tests updated:**

- `inventory.logic.spec.ts` 21 tests still pass — added new `assertInventoryMutationAllowed`, `assertReservationMutationAllowed`
- `module-boundaries.test.ts` — updated READ_EXCEPTIONS for inventory: added `supplier_member`, `seller`, `wholesale_order`, `wholesale_order_item`, `account_user`

## Verification Gates

### Before (Phase 3.5)

- db:migrate: 7 migrations, 45 tables, 63 FK, 91 CHECK
- typecheck:all: green
- test:all: 160+36+113+21=330 (frontend-next 160, database 36, api 113, shared 21)
- build: green
- infra:verify: green

### After (Phase 3.6)

- db:migrate: **7 migrations, 45 tables, 63 FK, 91 CHECK** — no new migrations (cutover preparation only, no DDL)
- typecheck:all: **green**
- test:all: **160+36+135+21=352** — +22 new cutover tests (api 113→135)
- build: **green** (Next + packages + api)
- infra:verify: **green**

### Files Changed

- `apps/api/src/modules/inventory/inventory.logic.ts` — added `assertInventoryMutationAllowed`, `assertReservationMutationAllowed`
- `apps/api/src/modules/inventory/inventory.service.ts` — ownership enforcement, `resolveSellerIdFromUserId`, expiration foundation `findExpiredReservations`, `releaseExpiredReservations`, package safety `reservePackage` all-or-nothing, audit actor propagation
- `apps/api/src/modules/inventory/inventory.controller.ts` — NEW — authenticated boundary, role validation, supplier ownership validation, audit actor propagation, client cannot choose sellerId
- `apps/api/src/modules/inventory/cutover.service.ts` — NEW — cutover boundary for future Order Engine, `checkCanFulfillPackage`, `reservePackageForOrder`, `releaseReservationsForOrder`, `confirmReservationsForOrder`, `handleExpiredReservations`
- `apps/api/src/modules/inventory/inventory.module.ts` — added controller, cutover service
- `apps/api/src/modules/inventory/inventory.cutover.spec.ts` — NEW — 22 regression tests
- `apps/api/src/modules/offers/offers.controller.ts` — deprecate `inventoryOnHand` input, ignore client value, warn
- `apps/api/src/modules/offers/offers.service.ts` — deprecate `inventoryOnHand`, always 0, comment source is `product_variant_inventory`
- `packages/database/src/schema/tables.ts` — mark `inventory_on_hand/reserved` deprecated comment
- `apps/api/test/module-boundaries.test.ts` — update READ_EXCEPTIONS for inventory (supplier_member, wholesale_order, wholesale_order_item, account_user)

### Migrations Added

- **None** — Phase 3.6 is cutover preparation only, no DDL, no deletion of legacy tables

### Inventory Authority Status

- **New inventory is the only planned authority for Order Engine:** YES — `InventoryService` + `InventoryCutoverService` provide all needed methods, `product_variant_inventory` is documented source of truth, `seller_offer` inventory deprecated, legacy `supplier_inventory` isolated but still working
- **Inventory writes require authorization:** YES — all writes require `requester` with `userId, role, sellerId` from auth context, `assertInventoryMutationAllowed` enforced, controller requires authentication and `@Roles`, client cannot choose sellerId
- **Supplier ownership enforced:** YES — `resolveSellerIdFromUserId` via `supplier_member`, `assertSupplierOwnsInventory` for reads, `assertInventoryMutationAllowed` for writes, `assertReservationMutationAllowed` for reservations, tests prove Supplier A cannot modify Supplier B
- **Reservation lifecycle safe:** YES — variant-level check, all-or-nothing package reservation with rollback, expiration foundation with safe RELEASE ledger, transition checks with roles, no partial success
- **Legacy tables remain but isolated:** YES — `supplier_product`, `supplier_variant`, `supplier_inventory` still exist and active in `frontend-next/server/kolbe-api.ts`, but new flows use `InventoryService` boundary; `InventoryModule` does not depend on legacy tables except via READ_EXCEPTIONS for cutover docs
- **Phase 4 can build orders without using supplier_inventory directly:** YES — `InventoryCutoverService` provides `checkCanFulfillPackage`, `reservePackageForOrder`, `releaseReservationsForOrder`, `confirmReservationsForOrder`, `handleExpiredReservations` — Order Engine can depend only on `product_variant_inventory` + `inventory_reservation` + `inventory_ledger`

### Remaining Legacy Dependencies

- `supplier_product` — active in `kolbe-api.ts`: product list, create, admin moderation, bulk-price, order approval grouping; FK for `wholesale_order_item.product_id`, `rfq`, `quote`, `product_match_queue`
- `supplier_variant` — active: variant list with inventory, wholesale stock check FOR UPDATE, FK for `supplier_inventory`, `wholesale_order_item.variant_id`, `purchase_order_item.variant_id`
- `supplier_inventory` — active: reservation on wholesale order create, release on cancel, decrement on PO delivered; only path used by current production wholesale flow
- `seller_offer.inventory_on_hand/reserved` — deprecated, always 0, not used for stock, remains for compatibility

### Blockers Before Phase 4

1. **Data migration script needed:** `supplier_inventory` → `product_variant_inventory` backfill for existing variants (map via sku or explicit mapping table), with ledger INCREASE reason `legacy migration`
2. **Wholesale order item FK migration:** add `canonical_variant_id FK product_variant` nullable, dual-write, then switch reads — currently FK to `supplier_variant`
3. **Purchase order item FK migration:** similar — add canonical variant FK
4. **Expiration cron worker:** BullMQ worker calling `releaseExpiredReservations` every minute — foundation exists, worker not yet implemented
5. **Transactional package creation:** `createWholesalePackage` inserts package + items without transaction — needs transaction for Phase 4
6. **Seller singleton partial index:** `seller_supplier_unique` on nullable `supplier_id` allows multiple KOLBE — needs partial unique index `WHERE type='KOLBE'` or `WHERE supplier_id IS NOT NULL`
7. **Package_type CHECK workaround:** `seller_offer.package_type` CHECK includes `""` for null — should be `CHECK (package_type IS NULL OR package_type IN (...))`
8. **Audit_log integration:** wire `AuditService.record` for inventory mutations with `actor_id`, `seller_id`, `variant_id`, `reason`
9. **InventoryController e2e tests:** add e2e tests for ownership enforcement with real JWT and supplier_member setup
10. **Legacy kolbe-api.ts cutover:** replace `supplier_inventory` reads/writes in `POST wholesale/orders`, `purchase_order` status, cancel with calls to `InventoryService` via internal API or direct DB via new service — currently still uses legacy

## Commit Strategy

- `feat(inventory): add ownership enforcement boundary`
- `feat(inventory): add reservation expiration foundation`
- `refactor(inventory): deprecate offer inventory fields`
- `test(inventory): add cutover regression tests`
- `docs(inventory): document phase 3.6 cutover`

## Completion Criteria

- [x] New inventory is the only planned authority for Order Engine
- [x] Inventory writes require authorization (JWT/session → supplier_member → seller)
- [x] Supplier ownership is enforced (Supplier A cannot modify Supplier B, customer cannot mutate, admin behavior defined)
- [x] Reservation lifecycle is safe (variant-level, all-or-nothing package, expiration foundation with RELEASE ledger, no partial)
- [x] Legacy tables remain but are isolated (still working in kolbe-api.ts, not deleted, new flows use InventoryService)
- [x] Phase 4 can build orders without using supplier_inventory directly (InventoryCutoverService boundary ready)

STOP after completion. Next: PHASE 4 — Wholesale Request, Order Lifecycle & Fulfillment Foundation
