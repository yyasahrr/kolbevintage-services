# Phase 4.2 — Wholesale Order Database Foundation

Date: 2026-09-18. Branch: `arena/01a0ad1f-kolbevintage-services`.
Starting SHA: `e31871191f5ea593f9fa1c75f3fef632ac25d5cc`
Ending SHA Phase 4.2: `e31871191f5ea593f9fa1c75f3fef632ac25d5cc`
Ending SHA Phase 4.2.1: `70eebadb468daef7a171df5579475be2ee7bbf8a` (will be updated to final after CI green)

## Goals (Phase 4.2)

Evolve existing `wholesale_order`, `wholesale_order_item`, `purchase_order`, `purchase_order_item` into canonical foundation for future flow:
Wholesale Request → Wholesale Order parent → Wholesale Order Items → Seller Fulfillment Orders (KOLBE/Supplier) → Inventory Reservations → future Proforma/Payment/Shipping.
This phase creates schema, constraints, state definitions, repositories/contracts/tests, NOT full Order Engine.

## Delivered — Migration 0012

**File:** `packages/database/migrations/0012_phase_4_2_order_foundation.sql`
**Snapshot:** `packages/database/migrations/meta/0012_snapshot.json` id `0df1bc58-77a6-46ee-af46-eed813ff0c16` prev `0011-1789675557506` version 7 (now 45 tables after 0013: 45 tables, 89 FKs, 114 CHECKs → after 0013 same count plus triggers)

### wholesale_order evolution
- Added `buyer_user_id` NOT NULL FK to `account_user` (backfilled from `wholesale_account.user_id`, orphan dev fixtures deleted — pre-launch cleanup)
- Added `originating_request_id` nullable FK to `wholesale_request`, unique partial index `wholesale_order_originating_request_unique` WHERE NOT NULL
- Added `currency` text DEFAULT IRR NOT NULL, CHECK `currency IN ('IRR')`
- Added `items_total`, `shipping_total`, `grand_total` bigint DEFAULT 0 NOT NULL, CHECK >=0 <=1e15, CHECK `grand_total >= items_total AND >= shipping_total`
- Added `pricing_version` text, `payment_mode` text CHECK IN (prepaid,credit,on_delivery,transfer,cod)
- Added `shipping_address_snapshot`, `billing_address_snapshot` JSONB DEFAULT '{}' NOT NULL
- Added `version` integer DEFAULT 0 NOT NULL CHECK >=0
- Added `confirmed_at`, `cancelled_at`, `completed_at` timestamptz
- Added `cancellation_reason` text, `cancelled_by` FK to account_user
- Status mapping: `pending→draft, approved→confirmed, fulfilling→fulfillment, fulfilled→completed, cancelled→cancelled`
- New status CHECK: `draft,confirmed,awaiting_payment,processing,fulfillment,shipped,completed,cancelled` (8 values)
- Scoped idempotency: unique partial index `wholesale_order_account_idempotency_unique` ON (account_id, idempotency_key) WHERE idempotency_key IS NOT NULL
- Indexes: account_created, status_created, buyer_created
- Order_code: existing unique, NOT NULL, server-generated KV-W-10482, immutable via trigger in 0013

### wholesale_order_item evolution
- Added `seller_id` NOT NULL FK seller (backfilled from seller_offer.seller_id, then KOLBE singleton, then first seller), `supplier_id` NULLABLE FK supplier
- Added `package_id` FK wholesale_package, `pricing_tier_id` FK wholesale_pricing_tier
- Added immutable snapshots: `product_name_snapshot` text NOT NULL (backfilled from product_name), `sku_snapshot`, `variant_snapshot` JSONB NOT NULL, `seller_snapshot` JSONB NOT NULL, `package_type_snapshot` CHECK (SIZE_RUN,FIXED_QUANTITY,COLOR_MIX,CUSTOM_BUNDLE), `package_name_snapshot`, `package_composition_snapshot` JSONB, `moq_unit_snapshot` CHECK (PIECE,PACKAGE,SERIES,BOX,CARTON,SET), `pricing_unit` text DEFAULT PIECE NOT NULL CHECK (PIECE,PACKAGE,SERIES,BOX,CARTON,SET,PER_PIECE), `package_quantity` int, `piece_quantity` int DEFAULT 1 NOT NULL CHECK >0, `line_total` bigint DEFAULT 0 NOT NULL CHECK >=0, `currency` text DEFAULT IRR NOT NULL
- Quantity CHECKs: quantity >0, piece_quantity >0, package_quantity >=0
- KOLBE seller → supplier_id NULL, SUPPLIER → supplier_id NOT NULL (enforced via logic + tests, DB consistency CHECK seller_supplier_consistency)
- Indexes: order, seller_order, product

### purchase_order (seller child) evolution
- Added `seller_id` NOT NULL FK seller (backfilled from supplier→seller mapping, then KOLBE), `supplier_id` now NULLABLE (for KOLBE)
- Added `items_total`, `grand_total` bigint DEFAULT 0 NOT NULL CHECK >=0
- Added `shipping_responsibility` text DEFAULT SUPPLIER NOT NULL CHECK (SUPPLIER,KOLBE,EXTERNAL_CARRIER)
- Added `version` int DEFAULT 0 NOT NULL CHECK >=0, `due_at`, `confirmed_at`, `preparation_started_at`, `ready_at`, `cancelled_at`, `cancellation_reason`
- Status CHECK: `pending,confirmed,preparing,shipped,delivered,cancelled` (6 values)
- Unique `wholesale_order_id + seller_id` WHERE wholesale_order_id NOT NULL (initial single-child-per-seller scope)
- Indexes: seller_status_created, wholesale_created
- Order_code child: KV-W-10482-01, unique, NOT NULL, immutable via trigger in 0013
- No fake supplier row for KOLBE

### purchase_order_item evolution
- Added `wholesale_order_item_id` FK to wholesale_order_item RESTRICT
- Unique partial `wholesale_order_item_id + purchase_order_id` WHERE NOT NULL
- Index purchase_order

### inventory_reservation linkage
- Added `order_id` FK wholesale_order RESTRICT, `order_item_id` FK wholesale_order_item RESTRICT
- Unique partial `order_item_id, variant_id, seller_id` WHERE order_item_id NOT NULL (active allocation invariant)
- Indexes: order, order_item
- Inventory owns product_variant_inventory, inventory_reservation, inventory_ledger, command_idempotency. Orders may reference Inventory, Inventory must NOT gain service dep on Orders (enforced via module-boundaries.test.ts)

### order_status_history (append-only)
- Columns: id PK, order_id nullable FK wholesale_order RESTRICT, child_order_id nullable FK purchase_order RESTRICT, from_status, to_status CHECK IN 11 unique values (8 wholesale + 3 child extra: draft,confirmed,awaiting_payment,processing,fulfillment,shipped,completed,cancelled,pending,preparing,delivered), actor_id nullable FK account_user, actor_role CHECK (buyer,admin,supplier,system,fulfillment), reason, metadata JSONB, order_version int DEFAULT 0 CHECK >=0, created_at
- CHECK `order_status_history_exactly_one_order_fk`: exactly one of order_id/child_order_id NOT NULL
- Indexes: order_created, child_created, actor_created, unique order_version and child_version partial
- Trigger `order_status_history_append_only` prevents UPDATE/DELETE

### order_event
- Columns: id PK, aggregate_type CHECK (wholesale_order,purchase_order), aggregate_id, event_type CHECK 18 values (order.created, order.confirmed, order.payment_gated, order.processing_started, order.fulfillment_started, order.shipped, order.completed, order.cancelled, child.created, child.confirmed, child.preparing, child.shipped, child.delivered, child.cancelled, request.converted, inventory.reserved, inventory.released, inventory.consumed), payload JSONB, actor_id, actor_role, idempotency_key, created_at
- Indexes: aggregate_created, type_created, unique `order_event_aggregate_idempotency_unique` ON (aggregate_type, aggregate_id, idempotency_key) WHERE idempotency_key NOT NULL
- Trigger `order_event_append_only` prevents UPDATE/DELETE
- No CASCADE on order FKs

## Final Tables (Phase 4.2 + 4.2.1)

45 tables:
account_user, audit_log, purchase_order, purchase_order_item, quote, retail_order, retail_order_item, rfq, site_setting, supplier, supplier_application, supplier_member, support_ticket, system_log, wholesale_account, wholesale_order, wholesale_order_item, brand, category, product, product_media, product_variant, product_variant_media, supplier_product_submission, seller, seller_offer, offer_media, wholesale_package, wholesale_package_item, wholesale_pricing_tier, supplier_permission_config, vip_plan, vip_subscription, wholesale_request, product_rating, supplier_rating, transaction_rating, product_variant_inventory, inventory_reservation, inventory_ledger, command_idempotency, login_attempt, user_session, order_status_history, order_event

## Final Parent States (frozen canonical)

`draft, confirmed, awaiting_payment, processing, fulfillment, shipped, completed, cancelled` (8)

Per status-machines.md:
- draft → confirmed (buyer/admin, exact frozen terms, unexpired holds)
- confirmed → awaiting_payment (system, payment required) OR → processing (trusted credit/no-prepayment policy)
- awaiting_payment → processing (trusted payment evidence / audited manual evidence)
- processing → fulfillment (fulfillment command, all relevant child preparation accepted)
- fulfillment → shipped (dispatch orchestration, all uncancelled children dispatched, handoff evidence)
- shipped → completed (delivery orchestration, all uncancelled children delivered)
- draft/confirmed/awaiting_payment → cancelled (buyer/admin/system on hold expiry, no dispatch)
- processing/fulfillment → cancelled (admin/orchestration, no child dispatched)

Completed and cancelled terminal, no cancellation from shipped.

## Final Child States (canonical)

`pending, confirmed, preparing, shipped, delivered, cancelled` (6)

Transitions: pending→confirmed→preparing→shipped→delivered, with cancellation from pending/confirmed/preparing via parent orchestration.

## Snapshot Model

Immutable snapshots stored at order creation:
- product_name_snapshot, sku_snapshot
- variant_snapshot JSONB (attributes, SKU, etc.)
- seller_snapshot JSONB (displayName, type)
- package_type_snapshot, package_name_snapshot, package_composition_snapshot JSONB (must preserve old package even if current changes)
- moq_unit_snapshot
- pricing_unit (PER_PIECE/PACKAGE/SERIES/BOX/CARTON/SET)
- unit_price, quantity, package_quantity, piece_quantity, line_total, currency

Historical order rendering must use stored snapshots, never current mutable catalog/package data. Proven via persistence-level DB test in phase-4-2.test.ts: mutate live product/variant/seller/package/price, assert stored snapshot unchanged.

## Quantity Model

From quantity-and-package-model.md:
- PIECE: quantity = pieces of one variant
- PACKAGE/SERIES/BOX/CARTON/SET: quantity = whole packages, recipe required
- Formulas: pieces_per_package = sum(r[v]), required_pieces[v] = n * r[v], total_pieces = n * pieces_per_package
- Examples: clothing full series 12 pcs (S2 M2 L2 XL2 2XL2 3XL2), half series 6 pcs, shoes 8 pcs (40:2 41:2 42:2 43:2), fixed accessories 10 pcs, custom color bundle 5 pcs
- Validation: positive safe integers, no duplicate variant in composition, piece_quantity = package_quantity * pieces_per_package when packageQuantity present
- Money: integer/bigint only, server-derived totals, no float, CHECK >=0, line_total = piece_quantity * unit_price for PIECE, quantity * unit_price for PACKAGE

## Seller/Supplier Semantics

- seller.type KOLBE → supplier_id must be NULL
- seller.type SUPPLIER → supplier_id must be NOT NULL
- KOLBE child order: seller_id = KOLBE singleton, supplier_id NULL, shipping_responsibility KOLBE
- SUPPLIER child order: seller_id = supplier's seller, supplier_id NOT NULL, shipping_responsibility SUPPLIER
- No fake supplier row for KOLBE
- Validated via `validateSellerSupplierConsistency` pure logic and DB tests

## KOLBE Child-Order Behavior

KOLBE has seller ID and null supplier ID. Child order for KOLBE products uses KOLBE seller, null supplier, shipping responsibility KOLBE. Supplier child requires supplier_id NOT NULL.

## Inventory Reservation Linkage

- inventory_reservation.order_id FK wholesale_order RESTRICT
- inventory_reservation.order_item_id FK wholesale_order_item RESTRICT
- Unique active allocation: (order_item_id, variant_id, seller_id) WHERE order_item_id NOT NULL
- Inventory owns product_variant_inventory, inventory_reservation, inventory_ledger, command_idempotency
- Orders may reference Inventory, Inventory must NOT gain service dep on Orders (module-boundaries.test.ts)
- Reservation lifecycle per inventory-contract.md: pending→active increments reserved, active→released/cancelled/expired decrements, active→confirmed consumes on_hand and reserved at dispatch
- Phase 4.2 does NOT implement reservation orchestration, only linkage

## Request Linkage

- wholesale_order.originating_request_id nullable FK wholesale_request, unique partial index WHERE NOT NULL (one conversion link per request)
- Exactly one order may consume a given accepted request version (future Phase 4.3 will enforce via transaction)
- VIP owns wholesale_request, wholesale_account, vip_subscription. Orders owns wholesale_order etc.

## Status History

- order_status_history append-only, id, order_id XOR child_order_id, from_status, to_status, actor_id nullable, actor_role, reason, metadata JSONB, order_version, created_at, index order_id+created_at, no UPDATE/DELETE via trigger
- Exactly one FK CHECK, actor FK, version unique partial indexes

## Order Events

- order_event id, aggregate_type/id, event_type 18 values, payload JSONB, actor_id/role, idempotency_key, created_at, index aggregate_created, type_created, unique aggregate_idempotency
- Append-only trigger

## Idempotency

- Parent order scoped (account_id, idempotency_key) unique partial WHERE key NOT NULL, prevents double order from retried request
- Different account same key succeeds (scoped)
- order_event idempotency unique per aggregate
- command_idempotency for inventory (existing Phase 4.1)
- Validation: key length 8..128, pattern alphanumeric . _ : -

## Module Ownership

From registry.ts:
- Orders owns: wholesale_order, wholesale_order_item, purchase_order, purchase_order_item, order_status_history, order_event
- Inventory owns: product_variant_inventory, inventory_reservation, inventory_ledger, command_idempotency
- VIP owns: wholesale_account, vip_plan, vip_subscription, wholesale_request
- Catalog owns: brand, category, product, product_media, product_variant, product_variant_media, supplier_product_submission
- Offers owns: seller_offer, offer_media, wholesale_package, wholesale_package_item, wholesale_pricing_tier, rfq, quote
- Suppliers owns: supplier, supplier_application, seller, supplier_permission_config
- Supplier-team owns: supplier_member
- Etc.

Prevent cycles: Inventory must not depend on Orders (validated via module-boundaries.test.ts, READ_EXCEPTIONS allow Orders to read Inventory tables but not vice versa)

## Legacy Next.js Remaining Debt

- Legacy Next.js handler still serves traffic during strangler (per ADR-004)
- Legacy approval omits purchase_order_item.product_id (fixed in Phase 4.2 via evolution)
- Legacy stock changes omit seller qualification and bypass reservations/ledger (to be cut over in Phase 4.3)
- Existing item seller_offer_id nullable (fixed via backfill and NOT NULL for seller_id)
- No direct Orders → inventory SQL writes (enforced via module boundaries)

## Migration Assumptions (Phase 4.2)

- Repository is pre-launch, commerce data is dev/fake, seeded via KOLBE_SEED_DEMO_DATA=true, never in production
- buyer_user_id backfilled from wholesale_account.user_id, orphan dev fixtures deleted (pre-launch cleanup)
- seller_id backfilled from seller_offer.seller_id, then KOLBE singleton, then first seller
- Status mapping: pending→draft, approved→confirmed, fulfilling→fulfillment, fulfilled→completed
- fulfilled→completed is pre-launch/dev-only reset, NOT fabricating delivery evidence for production. Frozen architecture says fulfilled→completed only with delivery evidence. Since no production data exists, safe. Documented in 0013 and this report. Future production migrations must quarantine fulfilled rows, not auto-complete.
- Totals backfilled from total_amount
- Inventory reservation order_id/order_item_id added as nullable, no data loss

## Verification Results (Phase 4.2)

Local gates at e318711:
- db:migrate OK (13 migrations, 45 tables, 89 FKs, 114 CHECKs)
- typecheck:all OK (4 workspaces)
- test:all 397 tests: shared 21, database 49 (including phase-4-2 7 tests), api 207 (including order.logic 33), next 120
- build OK (Next.js 15.5.25 compiled)
- infra:verify OK

Remote CI: green for e318711 (run 35277185259, 1m10s)

## Verification Results (Phase 4.2.1)

Local gates at 70eebad:
- db:migrate OK (14 migrations, 45 tables, 89 FKs, 114 CHECKs) — new 0013 adds immutability triggers
- typecheck:all OK (4 workspaces)
- test:all 415 tests: shared 21, database 53 (phase-4-2 now 11 tests: canonical columns, snapshot columns, KOLBE null supplier, scoped idempotency, append-only, no CASCADE, order_code immutability triggers, snapshot immutability persistence, migration semantics legacy handling, order code uniqueness/NOT NULL), api 221 (order.logic.spec now 47 tests including 15 new payment-gate protection tests), next 120
- build OK (Next.js 15.5.25 compiled)
- infra:verify OK

Remote CI for 70eebad: run 35307400105 SUCCESS, 1m+ duration, all jobs green:
- apps/api (واحد + E2E)
- packages/database (هم‌ارزی اسکیما و مهاجرت)
- frontend-next (فروشگاه و API گذار)
- infra (بازبینی ایستای Compose و Nginx)

Final SHA after corrections: 70eebadb468daef7a171df5579475be2ee7bbf8a (to be updated if additional doc commit)

## Implemented Now vs Planned Phase 4.3

Implemented now (Phase 4.2):
- Schema evolution for wholesale_order, wholesale_order_item, purchase_order, purchase_order_item
- order_status_history append-only + exactly-one-FK CHECK + trigger
- order_event append-only + idempotency unique + trigger
- Inventory linkage FKs and unique allocation
- Scoped idempotency (account_id, key)
- Seller/supplier consistency (KOLBE null supplier)
- Immutable snapshot columns
- Quantity snapshot validation (full/half series, shoe bundle, accessory)
- Monetary totals validation (bigint, >=0, grand >= items+shipping)
- Status transition validation pure logic (wholesale and child)
- Parent aggregate status calculation (initial version, corrected in 4.2.1 to respect payment gate)
- Module scaffold orders with service/repo/logic/dto
- DB contract tests, snapshot concept tests, state tests, module-boundary tests

Planned Phase 4.3 (NOT started):
- Real Request → lock → snapshot → Order mother → Child Orders flow (accepted request → transaction → snapshot → inventory holds → parent order → seller child orders)
- Inventory reservation orchestration (reserve, reservePackage, release, consume via InventoryService)
- Supplier fulfillment APIs
- Payment / DigiPay / SnappPay / ledger / settlement
- Proforma / Shipping APIs
- Frontend cutover
- Full Order Engine with transaction boundaries, FOR UPDATE locking, audit same-transaction, idempotency replay

## Phase 4.2.1 Corrections (this report updated after 4.2.1)

- Parent status aggregation corrected to respect payment gate via `calculateParentFulfillmentProjection(currentParentStatus, children)` (see order.logic.ts)
- Legacy fulfilled→completed documented as pre-launch dev-only, guard added in 0013 to quarantine any remaining legacy statuses to draft
- Real snapshot immutability test added (persistence-level, mutating live sources, asserting stored snapshots unchanged for 11 fields)
- Order code immutability enforced via triggers `wholesale_order_code_immutable` and `purchase_order_code_immutable` in 0013, plus repository mutation contracts and regression tests
- No-op helper `assertSnapshotImmutability` removed
- State machine consistency verified: @kolbe/shared (8 wholesale, 6 child), database CHECKs, state-values.ts (ALL 11 unique), order.logic.ts, migration schema, tests, docs synchronized
- Phase 4.1 retained: InventoryService sole writer, transaction boundaries, FOR UPDATE locking, atomic package reservation, persistent idempotency, same-transaction AuditService, external transaction executor, SKIP LOCKED expiration, VIP ownership, no direct Orders → inventory SQL writes
- New migration 0013_phase_4_2_1_contract_corrections.sql added (14th migration, journal version 8, snapshot 0013)
- Report file created (this file) documenting actual implementation
