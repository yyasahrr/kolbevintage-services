# Quantity and package model

Normative Phase 3.10 target; current schema is retained. See [ownership](domain-ownership-freeze.md) and [order snapshots](order-boundary.md).

## Units and formulas

A piece is one stock unit of a canonical variant. A package is an indivisible, explicitly enumerated recipe for one offer and one seller. A package item is `(variant_id, pieces_per_package)`; each variant appears once. All counts are positive bounded safe integers and must fit database integer limits after multiplication. Reject fractions, NaN, infinity, overflow, empty recipes and duplicate variants; do not round silently.

For recipe quantities `r[v]`, ordered package count `n`, and available pieces `a[v]`:

```text
pieces_per_package = sum(r[v])
required_pieces[v] = n * r[v]
total_pieces = n * pieces_per_package
available_pieces[v] = on_hand[seller,v] - reserved[seller,v]
available_packages = min(floor(available_pieces[v] / r[v]))
```

Missing or archived inventory/variant, unpublished offer/product or inactive seller means not purchasable, not infinite availability. Validate before arithmetic; an empty recipe is invalid. Availability is advisory until rechecked under locks. Across multiple lines, aggregate required pieces by `(seller, variant)` before checking or reserving; two individually available packages can compete for the same stock.

## Examples

| Package | Explicit composition | Pieces per package | Example order |
| --- | --- | --- | --- |
| Clothing full series | S:2, M:2, L:2, XL:2, 2XL:2, 3XL:2 | 12 | 3 packages = 36 pieces, 6 per size |
| Clothing half series | S:1, M:1, L:1, XL:1, 2XL:1, 3XL:1 | 6 | 3 packages = 18 pieces, 3 per size |
| Shoes | 40:2, 41:2, 42:2, 43:2 | 8 | 2 packages = 16 pieces |
| Fixed accessories | black-belt:10 | 10 | 2 packages = 20 pieces |
| Custom color bundle | black-bag:3, white-bag:2 | 5 | 2 packages = 10 pieces |

For the full clothing series, available pieces `[10,8,7,6,5,4]` allow `min(5,4,3,3,2,2)=2` packages. Half series is its own recipe, never `0.5` of a full package.

`SIZE_RUN` requires distinct size descriptors in the category's sizing system. Shoes can use EU/UK/US descriptors without hardcoded clothing columns. `COLOR_MIX` requires distinct colors. `FIXED_QUANTITY` has exactly one variant. `CUSTOM_BUNDLE` permits variants of the offer's one canonical product; cross-product bundles are outside this freeze and must not be silently introduced.

## MOQ, sale unit and price basis

- `PIECE`: quantity means pieces of one variant. MOQ is tested against piece count.
- `PACKAGE`, `SERIES`, `BOX`, `CARTON`, `SET`: quantity means whole explicitly configured packages with that label. MOQ is tested in the offer's same sale unit. A package reference/recipe is required.
- **Phase 4.2.2 — BOX and CARTON have no universal multipliers (FIXED)**. The legacy `calculateMoqInPieces` assumptions of BOX=5 packages and CARTON=20 packages have been removed. All units now use explicit recipe: `required_pieces = ordered_count * pieces_per_package`, `total_pieces = ordered_count * sum(recipe)`. Regression tests prove no 5/20 multiplier remains.
- A quoted price has an explicit `pricing_unit`: per PIECE/PACKAGE/SERIES/BOX/CARTON/SET/PER_PIECE. Tier ranges are selected only in that unit and currency. Mixed tier units on one quote are rejected. Pricing resolution is deterministic: highest minQuantity wins, overlapping same min with different price throws.
- Package pricing is exact: `line_total = package_count * package_unit_price`; piece pricing is `piece_count * piece_unit_price`. Do not divide a package price into floating-point per-piece prices.
- If component price allocation is needed, distribute integer remainders by stable variant ID, store allocations, and verify their sum equals the package line total. Repeating/resuming the operation must yield identical allocation.

All money is bigint IRR and decimal string at API boundaries. Names, composition, dimensions, sale unit, price basis, tier and currency are snapshotted when the order is created. A later package edit cannot update existing requests' accepted terms or order items.

## Accepted request snapshot (Phase 4.2.2)

When `wholesale_request` transitions `supplier_review → accepted`, server must BEGIN, lock FOR UPDATE, verify actor/supplier ownership, verify version, load authoritative Offer/Seller/Package/Variant/composition, resolve pricing via PricingService (tableless, using Offers public contracts), validate MOQ, calculate piece quantity and line total, construct snapshot, calculate deterministic hash, persist `status=accepted, accepted_at/by/snapshot/hash, version+1`, audit same tx COMMIT.

Snapshot structure:
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
- No client-supplied price/composition authoritative, no float money.
- Terms hash deterministic via canonical serialization (sorted keys, stable composition ordering).
- Versioning optimistic integer NOT NULL DEFAULT 0, conflict 409 REQUEST_VERSION_CONFLICT.
- Acceptance expiry nullable, Phase 4.4 will configure SLA, Phase 4.3 must enforce when present, inventory revalidated under locks.

## Selector semantics (Phase 4.2.2)

- `wholesale_request`: `variant_id` nullable FK product_variant RESTRICT, `package_id` nullable FK wholesale_package RESTRICT, CHECK `((variant_id NOT NULL AND package_id IS NULL) OR (variant_id IS NULL AND package_id NOT NULL) OR (variant_id IS NULL AND package_id IS NULL))` for backward compat, but service validates PIECE requires variant, PACKAGE-like requires package, no fake primary variant.
- `wholesale_order_item`: `variant_id` nullable, `package_id` nullable, CHECK exactly one not null OR both null for legacy dev, but canonical requires one. One package request → one commercial line with `package_composition_snapshot`, multiple InventoryReservations later, do NOT repeat package as 6 lines.
- `source_request_id` FK wholesale_request RESTRICT nullable for traceability.

## Multi-request → one parent order (Phase 4.2.2)

- Link table `wholesale_order_request` Orders-owned: `id, order_id FK RESTRICT, request_id FK RESTRICT UNIQUE (one request→at most one order), request_version, accepted_terms_hash, created_at, UNIQUE(order_id,request_id), no CASCADE`.
- `wholesale_order.originating_request_id` remains as legacy compatibility pointer, canonical engine MUST use `wholesale_order_request` authoritative.
- Batch validation pure/service: same wholesale_account, same buyer_user, all status accepted, all snapshots, valid version/hash, none linked, currency compatible, unexpired, different sellers allowed (Supplier A+B+KOLBE under one parent valid, VIP A+VIP B invalid).

## Pricing unit (Phase 4.2.2)

- Explicit `pricing_unit` per PIECE/PACKAGE/SERIES/BOX/CARTON/SET/PER_PIECE in accepted terms.
- Added `pricing_unit` fields to `seller_offer` and `wholesale_pricing_tier` with deterministic backfill mapping existing MOQ/sale unit → same unit, no fractional per-piece allocation.
- PricingService tableless using Offers public query contracts: input offer, selected variant/package, qty, sale unit, tiers → output pricingTierId, pricingUnit, unitPrice bigint, currency, quantityInPricingUnit, pieceQuantity, lineTotal, rules bigint money, int qty, no client price, no float, tier unit matches semantics, overlapping tiers never ambiguous, deterministic.

## Current support and gaps after 4.2.2

`OffersService.createWholesalePackage` inserts package/items transactionally, validates same-product variants and duplicates. Database checks enforce positive counts and unique `(package_id,variant_id)`. BOX/CARTON legacy multiplier removed, pricing unit explicit, request selector enforced.

Remaining Phase 4.3 work: canonical Order Engine that locks accepted requests FOR UPDATE, validates accepted terms, creates wholesale_order + wholesale_order_item (one line per package with composition snapshot) + wholesale_order_request links + purchase_order per seller + purchase_order_item, marks requests ordered, all in one Orders-owned tx calling VIP methods via executor, inventory reservations deferred but revalidated under locks. No reserve yet, no order/item/PO creation in 4.2.2.
