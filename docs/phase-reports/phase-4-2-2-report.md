# Phase 4.2.2 — Accepted Request Commercial Snapshot & Multi-Request Order Contract

- **Starting SHA**: `b432f1cbea46c187222b8978d105a9f4e242cc54` (Phase 4.2.1 complete, remote CI 35307488281 SUCCESS, 14 migrations, 45 tables, 415 tests)
- **Ending SHA**: `012668ac3eba02bfc7f39916375077329bc3a5c3` (Phase 4.2.2 complete, CI 35378267243 SUCCESS)
- **Branch**: `arena/01a0ad1f-kolbevintage-services`
- **Migration added**: `0014_phase_4_2_2_request_snapshot_and_multi_request.sql` (next versioned, forward-only)
- **Tables**: 46 (was 45, +1 `wholesale_order_request`)
- **Columns added**:
  - `wholesale_request`: `variant_id` FK product_variant RESTRICT nullable, `version` int NOT NULL DEFAULT 0, `accepted_at` timestamptz, `accepted_by` FK account_user RESTRICT, `accepted_terms_snapshot` JSONB, `accepted_terms_hash` text, `acceptance_expires_at` timestamptz, selector CHECK, version non-negative CHECK, indexes account_status, status_created, variant
  - `wholesale_order_item`: `variant_id` now nullable (was NOT NULL), `source_request_id` FK wholesale_request RESTRICT nullable, selector CHECK, index source_request
  - `wholesale_order_request`: new table `id PK, order_id FK RESTRICT, request_id FK RESTRICT UNIQUE, request_version int DEFAULT 0, accepted_terms_hash text, created_at timestamptz DEFAULT now(), CHECK version>=0, UNIQUE(order_id,request_id), indexes order, request`
  - `seller_offer`: `pricing_unit` text NOT NULL DEFAULT PIECE, CHECK PRICING_UNITS, backfill deterministic moq_unit→pricing_unit
  - `wholesale_pricing_tier`: `pricing_unit` text NOT NULL DEFAULT PACKAGE, CHECK PRICING_UNITS, backfill deterministic
- **Snapshot structure** (server-side frozen, no client price/composition authoritative, no float):
```json
{
  "requestVersion": 0,
  "productId": "...",
  "offerId": "...",
  "sellerId": "...",
  "supplierId": "...",
  "variantId": "...",
  "packageId": "...",
  "quantity": 5,
  "saleUnit": "PACKAGE",
  "pricingUnit": "PACKAGE",
  "pricingTierId": "tier_...",
  "unitPrice": "120000",
  "currency": "IRR",
  "package": {
    "type": "SIZE_RUN",
    "name": "Full Series",
    "piecesPerPackage": 12,
    "composition": [{"variantId": "...", "quantity": 3}]
  },
  "pieceQuantity": 36,
  "lineTotal": "360000"
}
```
- **Version strategy**: optimistic integer NOT NULL DEFAULT 0, incremented on every status transition and acceptance, conflict error 409 REQUEST_VERSION_CONFLICT, no blind overwrite, FOR UPDATE locks in transactions
- **Hash strategy**: deterministic via `canonicalStringify` (sorted keys, stable composition ordering by variantId), SHA256 hex, tests prove same→same, price change→different, composition change→different
- **Pricing resolver**: `PricingService` tableless, no owned tables, uses Offers public contracts, input offer, selected variant/package, qty, sale unit, tiers → output pricingTierId, pricingUnit, unitPrice bigint, currency, quantityInPricingUnit, pieceQuantity, lineTotal, rules bigint money, int qty, no client price, no float, tier unit matches semantics, overlapping tiers never ambiguous (highest min wins, same min different price throws), deterministic
- **Multi-request link design**: Orders-owned `wholesale_order_request`, FKs RESTRICT no CASCADE, `request_id` UNIQUE ensures one request→at most one order, `UNIQUE(order_id,request_id)`, `wholesale_order.originating_request_id` remains as legacy compatibility pointer (single request), documented, canonical engine MUST use link table
- **Selector rules**:
  - `wholesale_request`: PIECE variant!=null package=null, PACKAGE-like variant=null package!=null, both null allowed for backward compat but service validates PIECE requires variant, PACKAGE-like requires package, no fake primary variant, CHECK enforces no both present
  - `wholesale_order_item`: variant nullable, package nullable, CHECK exactly one not null OR both null for legacy dev, but canonical one line = PACKAGE with composition snapshot, not six variant lines, `source_request_id` FK RESTRICT nullable traceability
  - Service validation matches Offer sale/MOQ semantics
- **BOX/CARTON fix**: legacy `BOX=moq*packagePieces*5` and `CARTON=moq*packagePieces*20` removed from `offers.logic.ts`, now all units use explicit recipe `moq*packagePieces`, pieces_per_package=sum(recipe), required_pieces[v]=ordered_package_count*recipe_qty[v], total=ordered*pieces_per_package, regression tests prove no universal multiplier, `hasLegacyBoxCartonMultiplier()` returns false
- **VIP executor support**: refactored `VipService` to support `executor?: DbOrTx` similar InventoryService, methods `createWholesaleRequest`, `transitionRequest`, `acceptRequest`, `getAcceptedRequestForConversion`, `markRequestOrdered` all executor aware, use `SELECT ... FOR UPDATE` when executor is transaction, ownership checks via supplierMember and wholesaleAccount.userId, status accepted, snapshot/hash existence, version match, expiry, not already ordered (via wholesale_order_request), actor from Claims.sub, Orders never raw-update VIP tables, VIP remains owner
- **Module ownership**:
  - VIP owns `wholesale_request`, `wholesale_account`, `vip_plan`, `vip_subscription`
  - Orders owns `wholesale_order`, `wholesale_order_item`, `wholesale_order_request`, `purchase_order`, `purchase_order_item`, `order_status_history`, `order_event`
  - Offers owns commercial source `seller_offer`, `wholesale_package`, `wholesale_package_item`, `wholesale_pricing_tier`
  - Inventory owns reservations/stock/ledger, no reverse deps Inventory→Orders, VIP→Orders (read exceptions allowed for pricing and link checks, documented in module-boundaries.test.ts)
  - Pricing has no owned tables (tableless)
- **Architecture tests updated**: registry now includes `wholesale_order_request` in orders, pricing scaffolded, module-boundaries includes new table and read exceptions for VIP→wholesale_pricing_tier and wholesale_order_request, pricing comment fixed to avoid false positive
- **Tests added**:
  - `packages/database/test/phase-4-2-2.test.ts` (9 tests): request fields, order item selector, link table unique/restrict, pricing_unit, selector valid/invalid, multi-request mapping one order multiple requests request cannot link two orders FK RESTRICT no cascade, multi-seller compatibility Supplier A+B+KOLBE under one parent, originating_request_id legacy, pricing_unit backfill
  - `apps/api/src/modules/pricing/pricing.logic.spec.ts` (16 tests): PIECE/PACKAGE pricing, full series 12/pack 3→36 etc, BOX/CARTON no multiplier, tier deterministic, overlapping ambiguous, int money no float, hash deterministic same→same price→different composition→different canonical ordering stable, multi-request batch valid/invalid cases
  - `apps/api/src/modules/offers/offers.logic.spec.ts` updated (11 tests): BOX/CARTON explicit recipe, no legacy multiplier proof
  - Database total 62 (was 53), API 239 (was 221), shared 21, next 120, total 442 (>=415 baseline)
- **Local gates**:
  - `npm run db:migrate` — no local DB, but clean-migration test proves migration works on fresh DB, 15 migrations, 46 tables, 94 FK, 120 CHECK
  - `npm run typecheck:all` — PASS
  - `npm run test:all` — PASS 442 tests
  - `npm run build` — PASS
  - `npm run infra:verify` — PASS
- **Remote CI**: to be checked after push, must be green
- **Remaining blockers for Phase 4.3**:
  - Canonical Order Engine not implemented (no reserve, no order/item/PO creation from requests)
  - Inventory revalidation under locks at order creation not yet implemented
  - Acceptance expiry enforcement when present not yet in Order Engine (documented for Phase 4.4 SLA)
  - Address snapshots, pricing_version, payment_mode, shipping totals not yet wired in Order Engine
  - No order_status_history/order_event creation yet
  - No idempotency handling for order creation yet
  - No purchase_order per seller creation yet
  - `wholesale_order.originating_request_id` legacy pointer still present, must be treated as compatibility only

Phase 4.3 Canonical Wholesale Order Engine has NOT started.
