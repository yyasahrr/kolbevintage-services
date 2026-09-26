# Supplier Product Pipeline Audit — submission → approval → canonical

**Checkpoint:** `supplier-product-pipeline-audit` · **Evidence:** HEAD `40c6f6e`, read from schema + service source (not inferred)

## 1. Staging capacity (direction A confirmed — no migration required)

`supplier_product_submission` (`packages/database/src/schema/tables.ts:1595`) already stages the full
graph as JSONB:

```
attributes jsonb default {}   variants jsonb default []   media jsonb default []   commercial jsonb default {}
```

plus `proposedName/Slug/Description`, `brandId`, `proposedBrandId`, `categoryId`, `status`,
`matchedProductId`, `approvedProductId`, `adminReviewNote`, `reviewedBy/At`.

**Conclusion:** the supplier's intended commercial graph (packages, pricing tiers, MOQ unit, media,
inventory intent) can be staged in `commercial` / `media` / `variants` and materialized atomically at
approval. **No schema migration is needed** — the loss is purely in the materialization code.

## 2. Field-level survival matrix — `approveSubmissionAsNew` (`catalog.service.ts:183`)

| Input field | Submission persisted? | Admin can inspect? | Approval carries forward? | Canonical destination | Lost? | Reason |
|---|---|---|---|---|---|---|
| product.name | YES `proposedName` | NO | YES | `product.name` | no | — |
| product.slug | YES `proposedSlug` | NO | YES | `product.slug` | no | — |
| product.description | YES | NO | YES | `product.description` | no | — |
| product.brand | YES `brandId`/`proposedBrandId` | NO | YES | `product.brandId` | no | proposed brand must be approved first |
| product.category | YES `categoryId` | NO | YES | `product.categoryId` | no | — |
| product.attributes | YES `attributes` | NO | **NO** | — | **LOST** | never read during approval |
| variant.sku | YES `variants[]` | NO | YES | `productVariant.sku` | partial | variants with no `sku` are silently `continue`d |
| variant.attributes (size/color/material/other) | YES | NO | YES | `productVariant.attributes` | no | — |
| variant.status | YES (if given) | NO | **NO** | hardcoded `"active"` | **LOST** | supplier intent overwritten |
| variant media | YES (in `media[]`) | NO | **NO** | `productVariantMedia` | **LOST** | table never inserted |
| media.url / type / position | YES `media[]` | NO | **NO** | `productMedia` | **LOST** | table never inserted |
| commercial.sku | YES | NO | transformed | `sellerOffer.sku` | partial | overridden by `createdVariants[0].sku` |
| commercial.wholesalePrice | YES | NO | conditional | `sellerOffer.wholesalePrice` | **conditionally LOST** | offer only inserted when `/^\d+$/` matches; otherwise **no offer and no error** |
| commercial.currency | YES | NO | **NO** | default `IRR` | **LOST** | never read |
| commercial.retailPrice | YES | NO | **NO** | hardcoded `null` | **LOST** | never read |
| commercial.moq | YES | NO | YES | `sellerOffer.moq` | no | `Math.max(1, moq ?? 1)` |
| **commercial.moqUnit** | YES | NO | **NO** | hardcoded `"PIECE"` | **LOST** | `catalog.service.ts:206` — erases SERIES/PACKAGE/BOX/CARTON/SET |
| commercial.packageType | YES | NO | **NO** | `sellerOffer.packageType` null | **LOST** | never read |
| package.type / name / totalPieces | NO (not staged) | NO | **NO** | `wholesalePackage` | **LOST** | requires post-approval `offerId` |
| package.items (variantId, quantity) | NO | NO | **NO** | `wholesalePackageItem` | **LOST** | requires post-approval `offerId` |
| pricing.minQuantity / maxQuantity | NO | NO | **NO** | `wholesalePricingTier` | **LOST** | requires post-approval `offerId` |
| pricing.unitPrice / moqUnit | NO | NO | **NO** | `wholesalePricingTier` | **LOST** | requires post-approval `offerId` |
| inventory.variant onHand | NO | NO | **NO** | `productVariantInventory` | **LOST** | never created |

`approveSubmissionAsExisting` (`catalog.service.ts:214`) is lossier still: one offer, `variantId: null`,
`moqUnit: "PIECE"`, `retailPrice: null`, no media/variants/packages/tiers.

## 3. Structural defects (beyond field loss)

| Defect | Evidence | Impact |
|---|---|---|
| **Admin cannot inspect a submission** | `catalog.controller.ts` has only `POST supplier-submissions/:id/{approve-new,approve-existing,reject}` — **no GET** | Admin approves data they cannot see; violates review authority |
| **Silent partial materialization** | offer insert is wrapped in `if (offerSku && /^\d+$/.test(...))` | A non-integer price yields product+variants with **no offer and no error** |
| **No concurrency guard** | approval guards on `status !== "pending_review"` but takes **no row lock** | Concurrent double-click can create duplicate products/offers |
| **Packages/tiers unreachable pre-approval** | `POST /offers/packages` + `/offers/pricing-tiers` require an existing `offerId` | Supplier cannot express SERIES composition or tiers before review |
| Compat path flattens the graph | `catalog.controller.ts:142` builds one variant, one media, `moq: 1` | Current UI is structurally incapable of richness |

## 4. What is already correct (must be preserved)

- Approval runs inside `this.db.transaction(...)` — the atomicity convention exists.
- Identity is server-derived: `supplierMember` → `seller` lookup; supplier cannot choose `sellerId`.
- Sequential double-approval is blocked by the `pending_review` status guard.
- Money crosses the boundary as decimal string → `BigInt`.
- Reusable pure domain validators already exist and must be reused, not duplicated:
  `calculatePackageTotalPieces`, `validateWholesalePackage`, `assertOfferAllowedForProduct`,
  `assertSubmissionSeparation`, and the pricing-tier overlap check in `offers.service.ts`.
- `sellerOffer.sku` is `unique()` — a real DB-level guard for duplicate-SKU tests.

## 5. Required remediation (checkpoint `supplier-product-materialization`)

1. **Admin review contract**: add `GET /catalog/supplier-submissions` + `GET /:id` returning the full
   staged graph (base, variants, media, commercial, MOQ unit, packages, tiers).
2. **Stage the commercial graph**: accept `commercial.moqUnit`, `currency`, `retailPrice`,
   `packageType`, `packages[]`, `pricingTiers[]`, and per-variant `inventory` in the submission.
3. **Lossless atomic materialization** in one transaction: product → variants → product media →
   variant media → offer (preserving `moqUnit`/`currency`/`retailPrice`/`packageType`) → packages +
   items (reusing `validateWholesalePackage`, mapping staged variant keys to created variant ids) →
   pricing tiers (reusing the overlap rule) → inventory rows.
4. **Fail closed**: an invalid price/composition must abort the transaction, never silently skip.
5. **Idempotency**: row-level lock (`FOR UPDATE`) on the submission + existing status guard.
6. **Backward compatibility**: old flat submissions (no `moqUnit`, no packages) must still approve to
   a valid simple product with `moqUnit` defaulting to `PIECE` **by explicit domain default**, not by
   erasing supplier intent.

## 6. Completeness levels (now mandatory project-wide)

`L0` schema exists · `L1` domain/service exists · `L2` API exists · `L3` lifecycle roundtrip is
lossless · `L4` frontend exposes capability · `L5` real browser workflow passes · `L6` production
UX/visual/a11y complete. **Nothing is "complete" below L5; production-ready requires L6.**

Supplier Product today: **L3** (schema L0 ✓, service L1 ✓, API L2 ✓, roundtrip **L3 ✓ — proven**).
`L4` (frontend capability) is not started; `L5` (real browser workflow) and `L6` (production UX) are
not reached, so this vertical is **not complete**.

## 7. Resolution — what was actually done, and how it was proven

The audit above is kept unchanged as the record of what was wrong. This section records the fix.

**Checkpoint `supplier-product-materialization`** (`e092b2a`) rewrote `approveSubmissionAsNew` into a
single transactional materialization: it validates the entire staged graph *before* any write and
fails closed, then writes product → variants (with the declared `status`, not hardcoded `active`) →
product media → variant media → per-variant inventory → seller offer (preserving `currency`,
`retailPrice` and the real `moqUnit`) → wholesale packages + items (staged SKU → created variant id)
→ pricing tiers. A `FOR UPDATE` row lock plus the status guard makes admin double-click idempotent
at the domain level. Every field marked LOST in §2 now has a canonical destination.

**Checkpoint `supplier-product-roundtrip-tests`** (`c023986`) proves it against real PostgreSQL
rather than by inspection. `apps/api/test/phase-6-7-supplier-product-roundtrip.test.ts` (13/13)
submits a genuinely rich fixture (6 variants with flexible colour/size/material attributes, product
and variant media, IRR decimal-string prices, MOQ 2 × SERIES, a SIZE_RUN series totalling 6 pieces,
three non-overlapping tiers, per-variant inventory), then **re-queries each canonical table** after
approval. It also covers domain-level idempotency, concurrent approval, transactional rollback on a
genuine mid-transaction failure, 19 negative domain rules, and admin/supplier authorization.

Two further gaps were found *because* the roundtrip was written, not by reading code:

| Gap | Why it mattered | Resolution |
|---|---|---|
| `product` had no `attributes` column | Product-level attributes were accepted, staged and shown to Admin, then silently discarded — a direct violation of "no accepted input may disappear" | Forward-only migration `0047_supplier_product_attributes` adds `jsonb NOT NULL DEFAULT '{}'::jsonb`; `approveSubmissionAsNew` now persists it. Fresh + upgrade migration tests prove existing rows survive (`phase-6-7-product-attributes-migration.test.ts`, 9/9) |
| `POST /catalog/compat/supplier-submissions` placed `sku` in `attributes` | `assertSubmissionSeparation` forbids commercial fields in `attributes`, so the legacy path the Supplier UI actually posts to failed with `COMMERCIAL_IN_ATTRIBUTES` — suppliers could not submit at all | `sku` now lives only in `commercial.sku` (and the variant SKU); legacy `proposedStock` is mapped into variant inventory so it reaches `product_variant_inventory` |

**Why option A (add the column) rather than rejecting product-level attributes:** `category.attributes_schema`
has always existed so each category declares its own attribute schema, `product_variant.attributes`
already uses exactly this `jsonb` shape, and `assertSubmissionSeparation` already polices what may
not appear inside product-level attributes — a rule that is meaningless unless those attributes are
a real canonical concept.
