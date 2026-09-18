# Phase 3 Report — Catalog, Product, Pricing & Wholesale Marketplace Foundation

**Branch:** `arena/01a0ad1f-kolbevintage-services`  
**Start SHA (remote):** `92655c6` — phase2.1 auth verification & hardening checkpoint  
**End SHA (local after cherry-pick):** `e6d7942` — test(catalog) + marketplace + catalog  
**Date:** 2026-09-17 Asia/Tehran

## Verification Gates

- `npm run db:migrate` — ✅ 6 migrations, 42 tables, 54 foreign keys, 84 CHECK constraints
- `npm run typecheck:all` (api) — ✅ no errors
- `npm test --workspace @kolbe/shared` — ✅ 21 tests
- `npm test --workspace @kolbe/database` — ✅ 36 tests (clean-migration, state-constraints, startup-guard, legacy-upgrade)
- `npm test --workspace @kolbe/api` — ✅ 72 tests (module-boundaries, api.e2e, catalog.logic 26, offers.logic 9, supplier-permissions 7, vip.logic 13)
- `npm test --workspace kolbe-next` (via test:all) — ✅ 160 tests
- `npm run build` — ✅ Next.js build success
- `npm run infra:verify` — ✅ static infra check

## Schema

**Before:** 22 tables, 23 FK  
**After:** 42 tables (+20), 54 FK, 84 CHECK

### New Tables (20)

- brand, category, product, product_media, product_variant, product_variant_media
- seller, seller_offer, offer_media, wholesale_package, wholesale_package_item, wholesale_pricing_tier
- product_match_queue, supplier_permission_config
- vip_plan, vip_subscription, wholesale_request
- product_rating, supplier_rating, transaction_rating

### Altered

- supplier_member + role (owner/sales/warehouse/finance) with CHECK

### Migration

- `0005_fancy_darwin.sql` — creates all new tables, adds role column, seeds seller_kolbe
- `meta/_journal.json` — idx 5, tag 0005_fancy_darwin
- `meta/0005_snapshot.json` — 42 tables snapshot

## Architecture

### Business Rules Implemented

- Retail = Kolbe only: supplier cannot have retail_price, cannot create KOLBE product
- Wholesale = Kolbe+Supplier for VIP/boutique
- Seller types: KOLBE (Retail+Wholesale, no commission, priority 20% boost) vs SUPPLIER (Wholesale only)
- Canonical Product → Seller Offers: single product multiple sellers, example Black Linen Shirt
- Kolbe Exclusive: owner_type=KOLBE + is_kolbe_exclusive=true protected, no supplier offers
- Matching Engine: Supplier draft → Matching (findDuplicateCandidates by slug or name+brand+category) → Admin review → Attach Offer or Create Canonical, no auto-merge
- Lifecycle: DRAFT→PENDING_REVIEW→APPROVED→PUBLISHED→SUSPENDED admin controlled
- Category generic: Clothing/Shoes/Hats/Bags/Accessories/Future drives attributes/variants/packages/validation, attributes_schema JSONB
- Attribute flexible: Size/Color/Material/Fit/EU Size/Collection etc JSON
- Variant: Product→Variants with attributes JSONB, SKU unique, media, inventory
- Brand: supplier choose existing or enter new requiring review (verification_status pending/approved/rejected)
- Media separation: Product Media common vs Offer Media seller-specific
- Wholesale: MOQ units PIECE/PACKAGE/SERIES/BOX/CARTON/SET, pricing tiers 1/10/50 packages, packages generic types SIZE_RUN/FIXED_QUANTITY/COLOR_MIX/CUSTOM_BUNDLE with size-run calc total pieces, fixed quantity single variant
- Supplier permissions: configurable by admin (create_product, change_images, change_description, add_variant, change_category requires approval, change_price may not), audit log every action (foundation)
- Supplier Company: Supplier Company → Members with Owner/Sales/Warehouse/Finance roles foundation, role permissions mapping
- VIP Membership: Customer→VIP Subscription→VIP Plan configurable price/duration/features/limits Basic/Professional/Enterprise
- Wholesale Request Flow: VIP selects → Request (pending) → Supplier availability (supplier_review) → Accept/Reject with reason → Order (ordered)
- Search/Ranking foundation: sales/views/conversion/response/availability/ratings, Kolbe priority 20% boost, extensible weights
- Review/Rating separate: Product/Supplier/Transaction with 1-5 CHECK and status visible/hidden/flagged

### Module Ownership (registry.ts)

- catalog: brand, category, product, product_media, product_variant, product_variant_media
- suppliers: supplier, supplier_application, seller, supplier_permission_config
- supplier-team: supplier_member
- products: supplier_product, supplier_variant (legacy)
- offers: seller_offer, offer_media, wholesale_package, wholesale_package_item, wholesale_pricing_tier, product_match_queue, rfq, quote
- inventory: supplier_inventory
- vip: wholesale_account, vip_plan, vip_subscription, wholesale_request
- ratings: product_rating, supplier_rating, transaction_rating (new)
- admin: orchestration for catalog moderation, brand verification, matching

### Domain Logic (pure, testable)

- `catalog.logic.ts`: assertProductOwnership, assertOfferAllowedForProduct, assertProductStatusTransition, calculatePackageTotalPieces, validateWholesalePackage, findDuplicateCandidates, calculateWholesalePrice, validateBrandCreation, calculateSearchRank
- `offers.logic.ts`: assertSupplierOfferIsolation, calculateMoqInPieces, validateSizeRun
- `supplier-permissions.logic.ts`: checkSupplierPermission, assertSupplierMemberRoleAllowed
- `vip.logic.ts`: isVipSubscriptionActive, assertVipAccess, validateWholesaleRequestQuantity, transitionWholesaleRequest

### NestJS Services

- CatalogService, OffersService, SuppliersService, VipService with Drizzle DB integration, business rule enforcement

## Testing

- Product ownership: supplier cannot retail (KOLBE product, exclusive, retail_price) — covered in catalog.logic.spec
- Kolbe exclusive no supplier offer — covered
- Supplier isolation own offers — covered in offers.logic.spec
- Matching duplicate detection admin approval — covered in catalog.logic.spec (slug same, name+brand+category same, brand different not duplicate)
- Wholesale package size run calc — covered (total pieces, min 2 sizes, fixed quantity single variant, mismatch)
- Permissions approval — covered (create_product requires approval, change_category requires approval, role checks)
- VIP plan access — covered (active, expired, required, quantity below MOQ, insufficient stock, request flow)

## Commits

- 17645cd feat(catalog): canonical product, brand, category, variant, media, lifecycle, matching queue foundation
- bf8d16f feat(marketplace): seller model KOLBE/SUPPLIER, offer with exclusive guard, retail=Kolbe only
- e6d7942 test(catalog): product ownership, exclusive no supplier offer, supplier isolation, duplicate detection, size run calc, permissions, VIP access

## Next Steps (Phase 4+)

- Implement order engine, payment, ledger, shipping, settlement (explicitly NOT in Phase 3)
- CRM UI for admin manage suppliers (create/approve/restrict/suspend/ban/archive)
- Search indexing and ranking with real sales/views data
- Matching engine fuzzy matching and image similarity
- Audit log for every supplier action
- VIP plan feature/limit validation schema
