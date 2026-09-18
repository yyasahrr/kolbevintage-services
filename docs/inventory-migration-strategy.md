# Inventory Migration Strategy — Phase 3.8 Clean (No Legacy)

## Current State (Phase 3.8)

- **Removed:** `supplier_product`, `supplier_variant`, `supplier_inventory`, `legacy_product_mapping`, `legacy_variant_mapping`, `product_match_queue` — DROP TABLE CASCADE in migration 0008
- **Canonical only:** `product`, `product_variant` (flexible attributes JSON), `seller`, `seller_offer`, `product_variant_inventory`, `inventory_reservation`, `inventory_ledger`
- **No deprecated columns:** `seller_offer.inventory_on_hand`, `inventory_reserved` dropped
- **No bridge:** `LegacyInventoryAdapter`, `legacy-mapping.service.ts`, `legacy-mapping.logic.ts` deleted
- **No production data:** per scope, clean architecture preferred — no data migration script needed, no rollback tables

## Final Canonical Model

```
Supplier → Create Product (owner_type=SUPPLIER, status=draft, slug unique)
       → Create Product Variant (sku unique, attributes: {size:S|42, color:black, material:leather, ...})
       → Ensure Seller (type=SUPPLIER, supplier_id FK, displayName)
       → Create Seller Offer (product_id FK product, variant_id FK product_variant NULLABLE, seller_id FK seller, sku unique, wholesale_price bigint, moq, moqUnit, packageType, status)
       → Admin Review → Publish (status published)
       → Create Product Variant Inventory (variant_id FK product_variant, seller_id FK seller, onHand, reserved, status active, UNIQUE(variant_id,seller_id))
       → Reservation (inventory_reservation: variantId, sellerId, quantity, status pending→active→confirmed/released/expired, expires_at)
       → Ledger (inventory_ledger: change_type INCREASE|DECREASE|RESERVE|RELEASE|ADJUSTMENT, reason, actor)
       → Order Engine Phase 4 uses InventoryService + InventoryCutoverService only
```

### Product Variant Flexible Attributes

- Clothing: `{size:"S", color:"black"}`
- Shoes: `{size:"42", color:"white"}`
- Accessories: `{material:"leather"}`
- No hardcoded clothing columns — `attributes` JSONB

### Supplier Rules Preserved

- No retail: `assertRetailIsolation` — retail ONLY owner_type=KOLBE + status=published
- No Kolbe exclusive for supplier: `assertProductOwnership` — supplier cannot create owner_type=KOLBE + isKolbeExclusive=true
- Wholesale only: `assertOfferAllowedForProduct` — SUPPLIER cannot set retailPrice, only wholesalePrice, moq validation

### Inventory Authority

- **Only** `InventoryService` mutates inventory: `increase`, `decrease`, `reserve`, `release`, `confirm`, `adjustment`
- `product_variant_inventory` is supplier-owned, variant-level, with CHECK `reserved <= on_hand`
- `inventory_reservation` has expiration: `pending→active` with `expires_at`, `releaseExpiredReservations` for BullMQ worker
- `wholesale_package` + `wholesale_package_item` enable atomic package reservation: either ALL variants reserved or reject
- `InventoryCutoverService` is now canonical boundary for Order Engine (no legacy)

## FK Dependencies After Clean

- `wholesale_order_item.product_id FK product RESTRICT`, `variant_id FK product_variant RESTRICT`, `seller_offer_id FK seller_offer RESTRICT`, `order_id FK wholesale_order RESTRICT`
- `purchase_order_item.product_id FK product RESTRICT`, `variant_id FK product_variant RESTRICT`, `seller_offer_id FK seller_offer RESTRICT`, `purchase_order_id FK purchase_order RESTRICT`
- `rfq.product_id FK product RESTRICT`, `seller_offer_id FK seller_offer RESTRICT`, `supplier_id FK supplier RESTRICT`
- `quote.product_id FK product RESTRICT`, `variant_id FK product_variant RESTRICT`, `seller_offer_id FK seller_offer RESTRICT`, `rfq_id FK rfq RESTRICT`, `supplier_id FK supplier RESTRICT`
- `product_variant.product_id FK product RESTRICT`
- `product_variant_inventory.variant_id FK product_variant RESTRICT`, `seller_id FK seller RESTRICT`, UNIQUE(variant_id,seller_id)
- `seller.supplier_id FK supplier RESTRICT`, UNIQUE(supplier_id)

## Migration 0008

- Forward-only, idempotent: DROP CONSTRAINT IF EXISTS, DROP COLUMN IF EXISTS, DROP TABLE IF EXISTS CASCADE, ADD COLUMN IF NOT EXISTS
- Drops: `legacy_product_mapping`, `legacy_variant_mapping`, `product_match_queue`, `supplier_inventory`, `supplier_variant`, `supplier_product`
- Drops columns: `wholesale_order_item.canonical_*`, `purchase_order_item.canonical_*`, `rfq.canonical_*`, `quote.canonical_*`, `seller_offer.inventory_on_hand`, `inventory_reserved`
- Adds canonical NOT NULL columns: `wholesale_order_item.product_id`, `variant_id`, `seller_offer_id`, `purchase_order_item.product_id`, `variant_id`, `seller_offer_id`, `rfq.product_id`, `quote.product_id`, `variant_id`
- Re-adds final FKs with RESTRICT
- Snapshot 0008: 41 tables (was 47)

## Verification

- `npm run db:migrate` — 9 migrations (0-8), 41 tables
- `clean-migration.test.ts` — 41 tables
- `state-constraints.test.ts` — canonical FKs, no legacy checks, money checks, inventory invariant `reserved <= on_hand` on `product_variant_inventory`
- `phase-3-8.test.ts` — legacy tables DO NOT exist, wholesale_order_item/purchase_order_item/rfq/quote only canonical FKs, seller_offer no inventory columns, inventory tables only 3, attributes JSONB, flexible examples
- `module-boundaries.test.ts` — final ownership: catalog [brand,category,product,product_media,product_variant,product_variant_media], offers [seller_offer,offer_media,wholesale_package,wholesale_package_item,wholesale_pricing_tier,rfq,quote], inventory [product_variant_inventory,inventory_reservation,inventory_ledger], suppliers [supplier,supplier_application,seller,supplier_permission_config], etc.
- `typecheck:all`, `test:all`, `build`, `infra:verify`

## Blockers Before Phase 4 Order Engine

- BullMQ worker for `releaseExpiredReservations`
- Transactional Order Engine using `InventoryCutoverService.checkCanFulfillPackage` + `reservePackageForOrder` + `confirmReservationsForOrder`
- Carts, checkout, orders modules implementation
- Pricing tier integration with package reservation
- No legacy data migration needed — clean start
