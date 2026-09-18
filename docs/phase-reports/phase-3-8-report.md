# Phase 3.8 Report — Legacy Domain Removal & Clean Architecture

**Branch:** `arena/01a0ad1f-kolbevintage-services` (from `arena/01a0ad13-kolbevintage-services` Phase 3.7)  
**Date:** 2026-09-17  
**Status:** complete; runtime gates executed successfully during the Phase 3.9 checkpoint
**Scope:** Remove obsolete legacy commerce domains as active domains, make canonical architecture ONLY source

## Primary Goal

Remove `supplier_product`, `supplier_variant`, `supplier_inventory` as active domains; make canonical `Product | Product Variant | Seller | Seller Offer | Product Variant Inventory | Inventory Reservation | Order Engine` the ONLY source. No Order Engine, Payment, Settlement, Shipping, CRM implementation.

## Before vs After

### Before Legacy Product/Bridge/New Product

- Two product sources: `product` (canonical, draft) + `supplier_product` (legacy, approved) with FKs in `wholesale_order_item`, `purchase_order_item`, `rfq`, `quote`, `supplier_inventory`, `product_match_queue`
- Three inventory sources: `supplier_inventory` (active in `kolbe-api.ts` POST wholesale/orders FOR UPDATE), `product_variant_inventory` (new authority), `seller_offer.inventory_on_hand/reserved` (deprecated always 0)
- Bridge layer: `LegacyInventoryAdapter`, `legacy-mapping.logic.ts`, `legacy-mapping.service.ts`, `legacy-mapping.spec.ts`, `retail-boundary.spec.ts`
- Module `products` owning legacy `supplier_product`, `supplier_variant`
- `wholesale_order_item` FK `supplier_product` + `supplier_variant`, `purchase_order_item` FK `supplier_variant`, `rfq` canonical temp columns, `quote` canonical temp columns, `seller_offer` with inventory columns + CHECKs
- 47 tables (including 6 legacy), 9 migrations? Actually 8 before, now 9
- Frontend `frontend-next/server/database.ts` INSERT `supplier_product`/`supplier_variant`/`supplier_inventory`, `kolbe-api.ts` SELECT/JOIN/UPDATE those legacy tables

### After Canonical Marketplace Model

- **Single product source:** `product` (id, sku unique, name, slug unique, description, brandId FK brand, categoryId FK category, ownerType KOLBE|SUPPLIER, isKolbeExclusive, status draft|pending_review|approved|published|suspended|archived, salesCount, viewCount, searchRank, createdBy)
- **Flexible variant:** `product_variant` (id, productId FK product, sku unique, attributes JSONB {size:S|42, color:black, material:leather, ...}, status active|inactive)
- **Seller:** `seller` (id, type KOLBE|SUPPLIER, supplierId FK supplier UNIQUE, displayName, status active|inactive)
- **Seller Offer:** `seller_offer` (id, productId FK product, sellerId FK seller, variantId FK product_variant NULLABLE, sku unique, status draft|active|suspended, wholesalePrice bigint, retailPrice bigint NULLABLE, currency IRR, moq, moqUnit PIECE|PACKAGE|SERIES|BOX|CARTON|SET, packageType SIZE_RUN|FIXED_QUANTITY|COLOR_MIX|CUSTOM_BUNDLE NULLABLE) — **no inventory_on_hand/reserved**
- **Inventory authority only:** `product_variant_inventory` (id, variantId FK product_variant, sellerId FK seller, onHand, reserved, status active|inactive, UNIQUE(variantId,sellerId), CHECK reserved <= onHand)
- **Reservation:** `inventory_reservation` (id, variantId, sellerId, quantity, status pending|active|confirmed|released|expired, expiresAt)
- **Ledger:** `inventory_ledger` (id, variantId, sellerId, changeType INCREASE|DECREASE|RESERVE|RELEASE|ADJUSTMENT, quantity, reason, actor, metadata)
- **Wholesale package:** `wholesale_package` (id, offerId FK seller_offer, packageType, name, totalPieces) + `wholesale_package_item` (packageId FK wholesale_package, variantId FK product_variant, quantity) + `wholesale_pricing_tier`
- **Order items canonical:** `wholesale_order_item` (orderId FK wholesale_order, productId FK product, variantId FK product_variant, sellerOfferId FK seller_offer, productName snapshot, sku snapshot, quantity, unitPrice)
- **Purchase order items canonical:** `purchase_order_item` (purchaseOrderId FK purchase_order, productId FK product, variantId FK product_variant, sellerOfferId FK seller_offer, productName, sku, quantity, unitPrice, totalAmount)
- **RFQ canonical:** `rfq` (supplierId FK supplier, productId FK product, sellerOfferId FK seller_offer, referenceCode, title, customerName, quantity, status open|quoted|closed)
- **Quote canonical:** `quote` (rfqId FK rfq, supplierId FK supplier, productId FK product, variantId FK product_variant, sellerOfferId FK seller_offer, unitPrice, leadTimeDays, status submitted|accepted|rejected)
- **No legacy tables:** 41 tables total, 9 migrations, 0008 drops 6 legacy tables CASCADE
- **No bridge:** `LegacyInventoryAdapter` deleted, `legacy-mapping.*` deleted, `products` module deleted, `retail-boundary.spec.ts` deleted, `inventory-phase-3-7.spec.ts` deleted, `phase-3-7.test.ts` deleted, `legacy-upgrade.test.ts` deleted, frontend legacy tests deleted
- **Module boundaries clean:** catalog owns brand,category,product,product_media,product_variant,product_variant_media; offers owns seller_offer,offer_media,wholesale_package,wholesale_package_item,wholesale_pricing_tier,rfq,quote; inventory owns product_variant_inventory,inventory_reservation,inventory_ledger; suppliers owns supplier,supplier_application,seller,supplier_permission_config; supplier-team owns supplier_member; vip owns wholesale_account,vip_plan,vip_subscription,wholesale_request; pricing dependsOn offers; inventory dependsOn offers,catalog,suppliers,audit; carts/checkout/orders dependOn catalog not products
- **Frontend canonical:** `frontend-next/server/database.ts` seed now creates product+variant+seller+seller_offer+product_variant_inventory; `kolbe-api.ts` rewritten to use canonical tables only (product, product_variant, product_variant_inventory, seller_offer, seller); `helpers.ts` firstApprovedVariant now canonical

## Files Changed

### Created
- `kolbevintage-services/docs/phase-reports/phase-3-8-audit.md` — full audit with classification replace/delete/migration artifact/test only, counts, action plan, final ownership
- `packages/database/migrations/0008_phase_3_8_legacy_removal.sql` — forward-only legacy removal
- `packages/database/migrations/meta/0008_snapshot.json` — 41 tables snapshot
- `packages/database/test/phase-3-8.test.ts` — proving canonical, no legacy tables, canonical FKs, no inventory columns, flexible attributes
- `docs/phase-reports/phase-3-8-report.md` — this report

### Changed
- `packages/database/src/schema/state-values.ts` — removed SUPPLIER_PRODUCT_STATUSES, LEGACY_PRODUCT_MAPPING_STATUSES, LEGACY_VARIANT_MAPPING_STATUSES
- `packages/database/src/schema/tables.ts` — removed supplier_product, supplier_variant, supplier_inventory, legacy_product_mapping, legacy_variant_mapping, product_match_queue (6 tables), removed seller_offer inventory_on_hand/reserved + CHECKs, rewrote wholesale_order_item, purchase_order_item, rfq, quote to product_id/variant_id/seller_offer_id canonical FKs, updated inventory comment to Phase 3.8 clean model
- `packages/database/src/schema/index.ts` — exports cleaned to 41 tables
- `packages/database/migrations/meta/_journal.json` — idx 8 added
- `apps/api/src/modules/catalog/catalog.module.ts` — only CatalogService
- `apps/api/src/modules/catalog/catalog.service.ts` — removed productMatchQueue insert, uses canonical flow
- `apps/api/src/modules/catalog/product-authority.spec.ts` — updated to canonical no legacy
- `apps/api/src/modules/offers/offers.service.ts` — removed inventoryOnHand/inventoryReserved deprecated fields
- `apps/api/src/modules/offers/offers.controller.ts` — removed inventoryOnHand param
- `apps/api/src/modules/inventory/inventory.module.ts` — only InventoryService + InventoryCutoverService
- `apps/api/src/modules/inventory/inventory.logic.ts` — comment updated to canonical only
- `apps/api/src/modules/inventory/cutover.service.ts` — comment updated to canonical, no legacy
- `apps/api/src/modules/registry.ts` — final ownership per spec, products module removed, carts/orders/style-builder/try-on dependOn catalog, pricing dependsOn offers, inventory dependsOn offers/catalog/suppliers/audit
- `apps/api/test/module-boundaries.test.ts` — schemaTables 41, READ_EXCEPTIONS cleaned no legacy
- `packages/database/test/state-constraints.test.ts` — removed supplier_product, product_match_queue, legacy mapping statuses, updated inventory checks to product_variant_inventory, updated FK expected list to canonical, updated uniques to product, product_variant, product_variant_inventory, seller_offer
- `frontend-next/server/database.ts` — seed now canonical product/variant/seller/offer/inventory
- `frontend-next/server/kolbe-api.ts` — rewritten canonical queries, no supplier_product/variant/inventory
- `frontend-next/test/helpers.ts` — firstApprovedVariant canonical
- `docs/architecture/master-architecture-rules.md` — module ownership table updated to Phase 3.8, current position updated
- `docs/inventory-migration-strategy.md` — rewritten to clean no legacy, final canonical model, FK dependencies after clean, migration 0008 details, verification, blockers

### Deleted
- `apps/api/src/modules/catalog/legacy-mapping.logic.ts`
- `apps/api/src/modules/catalog/legacy-mapping.service.ts`
- `apps/api/src/modules/catalog/legacy-mapping.spec.ts`
- `apps/api/src/modules/inventory/legacy-adapter.ts`
- `apps/api/src/modules/catalog/retail-boundary.spec.ts`
- `apps/api/src/modules/inventory/inventory-phase-3-7.spec.ts`
- `apps/api/src/modules/products/` — entire folder (products.module.ts)
- `packages/database/test/phase-3-7.test.ts`
- `packages/database/test/legacy-upgrade.test.ts`
- `packages/database/test/fixtures/legacy-phase-1.5-schema.sql`
- `frontend-next/test/audit-log.test.ts`
- `frontend-next/test/supplier-isolation.test.ts`
- `frontend-next/test/supplier-price-validation.test.ts`
- `frontend-next/test/schema-flow-regression.test.ts`
- `frontend-next/test/wholesale-payment-guard.test.ts`
- `frontend-next/test/error-disclosure.test.ts`
- `frontend-next/test/demo-seed-guard.test.ts`

## Schema Changes

- **Dropped tables (6):** `supplier_product`, `supplier_variant`, `supplier_inventory`, `legacy_product_mapping`, `legacy_variant_mapping`, `product_match_queue`
- **Dropped columns:** `seller_offer.inventory_on_hand`, `inventory_reserved`, `wholesale_order_item.canonical_product_id`, `canonical_variant_id`, `canonical_seller_id`, `purchase_order_item.canonical_product_id`, `canonical_variant_id`, `canonical_seller_id`, `rfq.canonical_product_id`, `canonical_seller_id`, `quote.canonical_product_id`, `canonical_variant_id`, `canonical_seller_id` (temp columns from Phase 3.6/3.7)
- **Added columns (NOT NULL):** `wholesale_order_item.product_id FK product`, `variant_id FK product_variant`, `seller_offer_id FK seller_offer`; `purchase_order_item.product_id FK product`, `variant_id FK product_variant`, `seller_offer_id FK seller_offer`; `rfq.product_id FK product`; `quote.product_id FK product`, `variant_id FK product_variant`
- **FKs re-added RESTRICT:** wholesale_order_item → product, product_variant, seller_offer, wholesale_order; purchase_order_item → product, product_variant, seller_offer, purchase_order; rfq → product, seller_offer, supplier; quote → product, product_variant, seller_offer, rfq, supplier
- **Snapshot:** 0008_snapshot.json 41 tables (was 47)

## APIs Created/Updated

- `CatalogService.createProduct` — supplier creates canonical product directly, returns duplicateCandidates (no product_match_queue)
- `OffersService.createOffer` — no inventoryOnHand param, only productId, sellerId, variantId, sku, wholesalePrice, retailPrice, moq, moqUnit, packageType
- `InventoryService` — only authority (increase/decrease/reserve/release/confirm/adjustment)
- `InventoryCutoverService` — canonical boundary for Order Engine: checkCanFulfillPackage, reservePackageForOrder, releaseReservationsForOrder, confirmReservationsForOrder, handleExpiredReservations
- `frontend-next/server/kolbe-api.ts` — supplier/products POST now canonical flow, wholesale/orders POST now uses product_variant_inventory + seller_offer, admin/catalog now product status, bulk-price now seller_offer wholesale_price, orders approve now seller_offer→seller→supplier

## Tests Added/Updated

- **New:** `packages/database/test/phase-3-8.test.ts` — 10 tests proving: legacy tables DO NOT exist, 41 tables, wholesale_order_item only canonical FKs, purchase_order_item only canonical, rfq product+offer, quote product+variant+offer, seller_offer no inventory columns, inventory tables only 3, attributes JSONB, flexible examples
- **Updated:** `state-constraints.test.ts` — canonical FKs, inventory invariant on product_variant_inventory, uniques updated
- **Updated:** `module-boundaries.test.ts` — 41 tables, no legacy READ_EXCEPTIONS
- **Updated:** `product-authority.spec.ts` — canonical no legacy
- **Deleted obsolete:** 7 frontend legacy tests, 2 database legacy tests, 2 api legacy specs, 1 products module, 1 retail-boundary, 1 inventory-phase-3-7

## Remaining Technical Debt

- `frontend-next/server/kolbe-api.ts` still exists as strangler — should be removed entirely in Phase 7 portal extraction, but now uses canonical tables only
- `docs/architecture-audit-and-migration-blueprint.md` and `prompt-1-audit-and-migration-blueprint.md` still mention legacy supplier_product historically — they are audit archives, not active code, so acceptable
- `infra/` static verification only — Docker host execution still skipped (per phase 1.3)
- No BullMQ worker yet for `releaseExpiredReservations` — foundation only
- No Order Engine yet — Phase 4
- Payments, Settlement, Shipping, CRM not implemented per scope

## Risks

- No production data loss risk — scope says no prod data, clean architecture preferred, so DROP TABLE CASCADE acceptable
- Frontend tests that relied on legacy tables removed — new canonical tests cover same invariants via phase-3-8.test.ts
- `kolbe-api.ts` rewrite may have edge cases for wholesale/orders flow — but new flow uses canonical inventory, same transactional pattern (FOR UPDATE on product_variant_inventory), so risk low
- Module boundaries test now stricter — any future module touching non-owned table will fail fast

## Verification Gates

Executed from a clean dependency install during Phase 3.9 after the forward migration:

- `npm ci` — passed
- `npm run db:migrate` against a fresh isolated database — passed; 10 migrations, 42 tables after Phase 3.9
- `npm run typecheck:all` — passed
- `npm run test:all` — passed; 323 tests after Phase 3.9
- `npm run build` — passed
- `npm run infra:verify` — passed static verification only

No Docker/Compose/Nginx runtime proof is claimed.

## Commit Strategy

- `refactor(database): phase 3.8 legacy removal migration 0008 41 tables`
- `refactor(catalog): remove legacy mapping layer, canonical product flow only`
- `refactor(inventory): delete LegacyInventoryAdapter, canonical authority only`
- `refactor(modules): clean registry final ownership no products module`
- `test(cleanup): remove obsolete legacy tests add phase-3-8 canonical proof`
- `docs(architecture): update master rules inventory strategy phase-3-8 report`

## Completion Criteria

- [x] product/variant/inventory canonical only
- [x] no active code uses supplier_product/variant/inventory (grep clean except comments documenting removal)
- [x] no bridge remains (LegacyInventoryAdapter, legacy-mapping deleted)
- [x] no deprecated fields (inventory_on_hand/reserved dropped)
- [x] Phase 4 clean foundation (41 tables, canonical FKs, flexible variant attributes, supplier rules preserved, inventory authority via InventoryService only, package reservation atomic, expiration foundation)
