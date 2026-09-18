# Phase 3.8 — Legacy Dependency Audit

Date: 2026-09-17
Branch: arena/01a0ad1f-kolbevintage-services
Starting SHA: b80baf9 (Phase 3.7 complete)

## Search Terms
- supplier_product
- supplier_variant
- supplier_inventory
- LegacyInventoryAdapter
- legacy_product_mapping
- legacy_variant_mapping
- product_match_queue (depends on supplier_product)
- inventory_on_hand / inventory_reserved (deprecated)

## Classification Legend
- replace: move to canonical model
- delete: remove entirely, no replacement needed
- migration artifact: only in migrations/snapshots, will be cleaned via new migration
- test only: only in tests, can be removed after schema cleanup

---

### 1) Database Schema — `packages/database/src/schema/tables.ts`

| Reference | Purpose | Replacement | Classification |
|-----------|---------|-------------|----------------|
| `supplier_product` table | Legacy product model, supplier-owned | `product` + `seller_offer` | delete |
| `supplier_variant` table | Legacy variant, color/size/cost | `product_variant` with flexible attributes JSON | delete |
| `supplier_inventory` table | Legacy inventory onHand/reserved per variant | `product_variant_inventory` (variantId+sellerId) | delete |
| `legacy_product_mapping` table | Bridge supplier_product → product | None, no prod data | delete |
| `legacy_variant_mapping` table | Bridge supplier_variant → product_variant | None | delete |
| `product_match_queue` table | Queue for matching supplier_product drafts to canonical | None, supplier now creates canonical directly | delete |
| `seller_offer.inventory_on_hand` | Deprecated cache | `product_variant_inventory.on_hand` via InventoryService | delete |
| `seller_offer.inventory_reserved` | Deprecated cache | `product_variant_inventory.reserved` | delete |
| `wholesale_order_item.product_id` FK supplier_product | Old order item reference | `product_id` FK product | replace |
| `wholesale_order_item.variant_id` FK supplier_variant | Old variant ref | `variant_id` FK product_variant | replace |
| `wholesale_order_item.canonical_product_id` | Temporary bridge | Rename to `product_id` FK product | replace |
| `wholesale_order_item.canonical_variant_id` | Temporary bridge | Rename to `variant_id` | replace |
| `wholesale_order_item.seller_offer_id` | Already canonical | Keep | keep |
| `purchase_order_item.variant_id` FK supplier_variant | Old | `variant_id` FK product_variant | replace |
| `purchase_order_item.canonical_*` | Bridge | Rename to product_id/variant_id | replace |
| `rfq.canonical_product_id` | Bridge | Rename to product_id FK product | replace |
| `quote.canonical_*` | Bridge | Rename to product_id/variant_id | replace |
| `SUPPLIER_PRODUCT_STATUSES` | State values for legacy product | Remove | delete |
| `LEGACY_PRODUCT_MAPPING_STATUSES` | Bridge statuses | Remove | delete |
| `LEGACY_VARIANT_MAPPING_STATUSES` | Bridge statuses | Remove | delete |

### 2) State Values — `packages/database/src/schema/state-values.ts`

| Reference | Classification |
|-----------|----------------|
| `SUPPLIER_PRODUCT_STATUSES` | delete (legacy) |
| `LEGACY_PRODUCT_MAPPING_STATUSES` | delete |
| `LEGACY_VARIANT_MAPPING_STATUSES` | delete |

### 3) Modules — `apps/api/src/modules/`

| File | Reference | Purpose | Replacement | Classification |
|------|-----------|---------|-------------|----------------|
| `registry.ts` | `products` module owns `supplier_product`, `supplier_variant` | Legacy module | Remove module or reassign to catalog | delete |
| `registry.ts` | `catalog` owns `legacy_product_mapping`, `legacy_variant_mapping` | Bridge | Remove tables from ownership | delete |
| `registry.ts` | `offers` owns `product_match_queue` | Matching queue | Remove table, offers owns only seller_offer, packages, pricing | delete |
| `registry.ts` | `inventory` owns `supplier_inventory` | Legacy inventory | Remove, inventory owns only product_variant_inventory, reservation, ledger | delete |
| `catalog/catalog.service.ts` | Comment `supplierProductId: null // not legacy supplier_product` | Documentation | Remove comment | delete |
| `catalog/legacy-mapping.logic.ts` | Entire file — mapping logic | Bridge | Delete file | delete |
| `catalog/legacy-mapping.service.ts` | Service for mapping | Bridge | Delete | delete |
| `inventory/legacy-adapter.ts` | `LegacyInventoryAdapter` reads supplier_inventory | Bridge adapter | Delete, all code must use InventoryService | delete |
| `inventory/inventory.module.ts` | Provides LegacyInventoryAdapter | Bridge | Remove provider | replace |
| `inventory/cutover.service.ts` | Comments referencing supplier_inventory | Docs | Update comments to remove legacy refs | replace |
| `inventory/inventory.logic.ts` | Comment `supplier_inventory (legacy) همچنان` | Docs | Update comment | replace |
| `products/products.module.ts` | Empty module owning legacy tables | Legacy | Delete module or make empty | delete |
| `offers/offers.service.ts` | Uses `product_variant_inventory` already, but comment about deprecated inventory | Already clean | Keep, ensure no inventory_on_hand usage | keep |

### 4) Tests — `apps/api/test/` and `src/**/*.spec.ts`

| File | Reference | Classification |
|------|-----------|----------------|
| `test/module-boundaries.test.ts` | Lists supplier_product, supplier_variant, legacy mappings, supplier_inventory, product_match_queue | replace — update knownTables list |
| `catalog/product-authority.spec.ts` | Tests legacy supplier_product FK constraints | delete — obsolete, replace with canonical tests |
| `catalog/legacy-mapping.spec.ts` | Tests mapping layer | delete — bridge removed |
| `catalog/retail-isolation.spec.ts` | Already canonical | keep |
| `catalog/retail-boundary.spec.ts` | Canonical | keep |
| `inventory/inventory-phase-3-7.spec.ts` | Canonical reservation | keep |
| `inventory/inventory.logic.spec.ts` | Canonical | keep |
| `inventory/inventory.cutover.spec.ts` | Cutover logic | keep but update comments |

### 5) Database Tests — `packages/database/test/`

| File | Reference | Classification |
|------|-----------|----------------|
| `state-constraints.test.ts` | Checks for legacy_product_mapping, legacy_variant_mapping, supplier_product statuses | replace — remove legacy checks |
| `phase-3-7.test.ts` | Tests legacy mapping tables existence, canonical refs | delete — replaced by phase-3-8 test |
| `clean-migration.test.ts` | Tests migration on empty DB | keep |
| `legacy-upgrade.test.ts` | Tests adopt-legacy for old DBs | delete or keep? Since no prod data, can delete — but keep as migration artifact for now? Classify as migration artifact |
| `startup-guard.test.ts` | Guard | keep |

### 6) Frontend-Next — `frontend-next/server/`

| File | Reference | Purpose | Replacement | Classification |
|------|-----------|---------|-------------|----------------|
| `database.ts` | `INSERT INTO supplier_product` | Legacy DDL for dev | Delete file entirely? It's old DDL path, should be removed — project uses drizzle migrations now | delete |
| `kolbe-api.ts` | SELECT * FROM supplier_product, INSERT supplier_product, JOIN supplier_variant, SELECT supplier_inventory, UPDATE supplier_product status, wholesale_order_item JOIN supplier_product | Legacy wholesale flow | Replace with canonical product/product_variant/seller_offer via NestJS API, or delete if strangler complete | delete (since Phase 3.8 says clean architecture, no production data) |
| `test/*` | All tests referencing supplier_product/variant/inventory | Legacy tests | Delete or update to canonical | delete |

### 7) Docs

| File | Reference | Classification |
|------|-----------|----------------|
| `phase-3-7-report.md` | Mentions legacy tables | keep as historical, but update architecture docs |
| `master-architecture-rules.md` | May mention legacy | replace with canonical model |
| `inventory-migration-strategy.md` | Migration strategy | replace with final canonical model doc |

### 8) Migrations

| File | Reference | Classification |
|------|-----------|----------------|
| `0007_phase_3_7_legacy_bridge.sql` | Creates legacy_product_mapping, legacy_variant_mapping, canonical refs | migration artifact — will be superseded by 0008 clean migration that drops legacy |
| `meta/000*_snapshot.json` | Snapshots include legacy tables | migration artifact — new snapshot will not include them |

---

## Summary Counts

- Files referencing `supplier_product`: ~20 (mostly frontend-next + tests + schema)
- Files referencing `supplier_variant`: ~15
- Files referencing `supplier_inventory`: ~12
- Files referencing `LegacyInventoryAdapter`: 2 (adapter itself + module)
- Files referencing `legacy_product_mapping`: ~10
- Files referencing `legacy_variant_mapping`: ~10
- Files referencing `product_match_queue`: ~5
- Deprecated fields `inventory_on_hand/reserved`: 2 (schema + offers service comment)

## Action Plan

1. Delete legacy tables from `tables.ts` and state-values
2. Delete `legacy-mapping.*` services/logic
3. Delete `LegacyInventoryAdapter`
4. Delete `products` module (or empty)
5. Remove `product_match_queue`
6. Clean `seller_offer` deprecated columns
7. Update `wholesale_order_item`, `purchase_order_item`, `rfq`, `quote` to use canonical FKs only (product_id FK product, variant_id FK product_variant, seller_offer_id)
8. Update `registry.ts` ownership to final canonical
9. Update tests to verify no legacy tables exist
10. Update docs
11. Create migration 0008 that drops legacy tables and renames canonical columns
12. Remove frontend-next legacy DDL and API references (or mark as deleted)

---

## Final Canonical Ownership (Target)

- catalog: product, product_variant, product_media, product_variant_media, brand, category
- offers: seller_offer, offer_media, wholesale_package, wholesale_package_item, wholesale_pricing_tier
- inventory: product_variant_inventory, inventory_reservation, inventory_ledger
- suppliers: supplier, supplier_application, supplier_member, supplier_permission_config, seller
- vip: wholesale_account, vip_plan, vip_subscription, wholesale_request
- No supplier_product, supplier_variant, supplier_inventory, legacy mappings, product_match_queue

