# Frontend Capability Parity Audit

**Status:** living document · **Owner:** phase 6.x capability-parity gate · **Last evidence pass:** repository HEAD `4bebab0`

## 1. Why this document exists

Migration phases 6.0–6.3 correctly replaced *fake/browser truth* with *backend truth*. That exposed a
second defect class: **a frontend can call a real API and still expose only a fraction of the
capability the backend already supports.**

A feature is therefore **not** complete because it calls a real API, dropped `localStorage`, returns
200, renders, or passes unit tests. It is complete only when **the user can actually perform the
important backend-supported workflow through the UI**.

Every significant feature must satisfy **both**:

1. **Data / truth parity** — server owns the truth.
2. **Capability / workflow parity** — the UI exposes the meaningful backend dimensions.

## 2. Completeness matrix dimensions

For each feature, each row is `YES` / `PARTIAL` / `NO` / `INTENTIONAL_DEFER`. Every `PARTIAL`/`NO`
carries **evidence**, a **responsible phase**, and **required remediation**.

`Backend model · Domain/service · API contract · Frontend adapter · Frontend UI · Permission ·
Validation · Error states · Pagination · Money semantics · Concurrency/idempotency · Cross-account
isolation · Real browser workflow · Responsive · Accessibility · Production UX`

### 2.1 Completeness levels (mandatory)

A schema table existing does **not** equal a working workflow. Three distinct claims must never be
conflated: **BACKEND MODEL EXISTS** ≠ **BACKEND WORKFLOW COMPLETE** ≠ **FRONTEND EXPOSES CAPABILITY**.

| Level | Meaning |
|---|---|
| `L0` | Schema exists |
| `L1` | Domain/service exists |
| `L2` | API exists |
| `L3` | **Lifecycle roundtrip is lossless** (no field silently disappears between domain stages) |
| `L4` | Frontend exposes the capability |
| `L5` | Real browser workflow passes |
| `L6` | Production UX / visual / accessibility complete |

**Do not call a feature complete below `L5`. Production-ready requires `L6`.** Apply across Supplier,
VIP, Admin and Storefront. The Supplier Product discovery (see
`supplier-product-pipeline-audit.md`) is the reference case: it reached `L2` while its approval path
silently discarded MOQ unit, media, packages, pricing tiers and inventory — i.e. **`L3` failed**.
That `L3` gap has since been closed and is covered by DB-backed tests; the model itself is unchanged.

The same roundtrip question must be asked of every domain: does VIP order creation preserve
package/variant semantics? Does admin publish preserve variant/media/offer truth? Does storefront
checkout preserve the exact selected variant? **A feature is not complete if data is lost between
domain stages.**

## 3. SUPPLIER — Product Management (proven incomplete; remediation owner: 6.2-hardening)

### 3.1 Backend capability (evidence)

Schema (`packages/database/src/schema/tables.ts`):

| Capability | Table | Line |
|---|---|---|
| Product | `product` | 1458 |
| Product media (gallery, ordered) | `productMedia` | 1506 |
| Variants | `productVariant` | 1526 |
| Variant-specific media | `productVariantMedia` | 1548 |
| Seller commercial offer | `sellerOffer` | 1636 |
| Offer media | `offerMedia` | 1683 |
| Wholesale package / series | `wholesalePackage` | 1702 |
| Package composition lines | `wholesalePackageItem` | 1725 |
| Per-variant inventory | `productVariantInventory` | 2006 |
| Inventory reservation / ledger | `inventoryReservation` 2038, `inventoryLedger` 2122 | — |

Enums (`packages/database/src/schema/state-values.ts`):

- `PACKAGE_TYPES = [SIZE_RUN, FIXED_QUANTITY, COLOR_MIX, CUSTOM_BUNDLE]` (line 99)
- `MOQ_UNITS = [PIECE, PACKAGE, SERIES, BOX, CARTON, SET]` (line 104)
- `PRICING_UNITS = [PIECE, PACKAGE, SERIES, BOX, CARTON, SET, PER_PIECE]` (line 394)

API contract (controllers):

| Capability | Endpoint | File |
|---|---|---|
| Create product | `POST /catalog/products` | `catalog.controller.ts:78` |
| Product status | `POST /catalog/products/:id/status` | `catalog.controller.ts:122` |
| Submit for review | `POST /catalog/supplier-submissions` | `catalog.controller.ts:130` |
| Admin approve/reject | `POST /catalog/supplier-submissions/:id/{approve-new,approve-existing,reject}` | `catalog.controller.ts:185,193,204` |
| Server taxonomy | `GET /catalog/categories`, `GET /catalog/brands` | `catalog.controller.ts:55,61` |
| Seller offer | `POST /offers` | `offers.controller.ts:11` |
| Offers for a product | `GET /offers/product/:productId` | `offers.controller.ts:61` |
| Wholesale package / series | `POST /offers/packages` | `offers.controller.ts:66` |
| Pricing tiers | `POST /offers/pricing-tiers` | `offers.controller.ts:82` |
| Variant inventory | `POST /inventory/variant`, `GET /inventory/variant/:variantId` | `inventory.controller.ts:49,72` |
| Package availability | `GET /inventory/package/:packageId/availability` | `inventory.controller.ts:169` |

### 3.2 Current frontend (evidence)

`frontend-next/supplier-src/pages/products.tsx` (218 lines). Editor form state is exactly:

```
{ name, sku, category, description, wholesalePrice, stock, size, color, imageUrl }
```

- `category` is a **hardcoded `CATEGORIES` list** (`products.tsx:185`), not `GET /catalog/categories`.
- **One** size, **one** color, **one** `imageUrl`, **one** price, **one** stock number.
- No variant builder, no media manager, no offer/MOQ, no package/series builder, no pricing tiers,
  no per-variant inventory matrix.

### 3.3 Capability matrix — Supplier Product

| Dimension | State | Evidence / remediation |
|---|---|---|
| Backend model | YES | Tables above |
| Domain/service | YES | `catalog.service.ts`, `offers`, `inventory` modules |
| API contract | YES | Endpoints above |
| Frontend adapter | **PARTIAL** | Only flat create-product; no variant/media/offer/package/tier/inventory adapters → **6.2-hardening** |
| Frontend UI | **NO** | Flat form; missing variant builder, media manager, offer/MOQ, series/package builder, pricing tiers, inventory matrix → **6.2-hardening** |
| Permission | PARTIAL | Supplier-owned create exists; admin moderation endpoints exist but UI review depth unverified → **6.2-hardening** |
| Validation | PARTIAL | Client min-length only; package composition / MOQ semantics not surfaced → **6.2-hardening** |
| Error states | PARTIAL | Generic; needs EMPTY/ERROR/FORBIDDEN/CONFLICT/RATE_LIMITED differentiation → **6.2-hardening** |
| Pagination | PARTIAL | Product list paginated; variant/inventory matrices unbounded → **6.2-hardening** |
| Money semantics | PARTIAL | Price sent as decimal string (good); tiers/MOQ totals must stay decimal-string, backend-authoritative → **6.2-hardening** |
| Concurrency/idempotency | **NO** | No idempotency/expectedVersion on product/offer/package mutations → **6.2-hardening** |
| Cross-account isolation | PARTIAL | Server derives supplierId; needs DB-backed denial tests → **6.2-hardening** |
| Real browser workflow | **NO** | No golden "Supplier Product Lifecycle" E2E → **6.2-hardening** |
| Responsive | PARTIAL | Current form responsive; new builders must be → **6.2-hardening** |
| Accessibility | PARTIAL | Flat form labelled; matrices/builders need keyboard + a11y → **6.2-hardening** |
| Production UX | **NO** | No draft/review/submit lifecycle surfacing → **6.2-hardening** |

**Classification: PARTIAL — capability mismatch.** Backend = full product graph; UI = single flat form.

**Level: `L3`** — schema `L0` ✓, domain/service `L1` ✓, API `L2` ✓, **lossless lifecycle `L3` ✓
(proven)**. `L4` (frontend capability) is not started; `L5`/`L6` are not reached, so this feature
must not be called complete.

`L3` was previously **FAILING**: approval discarded `moqUnit` (SERIES→PIECE), all media, variant
media, `retailPrice`, `currency`, `packageType`, packages, pricing tiers and inventory. That is
fixed and now backed by evidence rather than by reading the code:

| Evidence | Command | Result |
|---|---|---|
| Lossless rich roundtrip, DB-backed | `apps/api/test/phase-6-7-supplier-product-roundtrip.test.ts` | 13/13 |
| Supplier workflow regression | `apps/api/test/phase-4-4-supplier-workflow.test.ts` | 11/11 |
| Module ownership ledger | `apps/api/test/module-boundaries.test.ts` | 8/8 |
| Schema-shape pins | `phase-5-10-d` + `phase-5-11-d` static guards | 16/16 |
| Typecheck | `tsc -p apps/api/tsconfig.json --noEmit` | 0 errors |

The roundtrip test re-queries every canonical table after approval (product, variants, product and
variant media, inventory, seller offer, package, package items, pricing tiers), so it proves
persistence and not merely a success return value. It also proves domain-level idempotency
(second approval → `SUBMISSION_NOT_PENDING`, snapshot unchanged; two concurrent approvals → exactly
one product), transactional atomicity (a genuine mid-transaction unique-violation rolls back the
whole graph), 19 negative domain rules, and admin/supplier authorization.

Two backend gaps were found and closed while proving `L3`:

1. **`product.attributes` did not exist** — product-level attributes were accepted, staged and shown
   to Admin, then silently discarded. Added by forward-only migration `0047_supplier_product_attributes`
   (`jsonb NOT NULL DEFAULT '{}'::jsonb`), with fresh and upgrade migration tests proving existing
   rows survive. See `packages/database/test/phase-6-7-product-attributes-migration.test.ts` (9/9).
2. **`POST /catalog/compat/supplier-submissions` was broken** — it placed `sku` inside `attributes`,
   which `assertSubmissionSeparation` forbids, so the legacy path the current Supplier UI posts to
   failed with `COMMERCIAL_IN_ATTRIBUTES`. `sku` now lives only in `commercial.sku`, and the legacy
   `proposedStock` is mapped into variant inventory so it reaches `product_variant_inventory`.

### 3.3b Backend gaps discovered during contract tracing (must fix at the domain layer)

The frontend currently posts to `POST /catalog/compat/supplier-submissions`, which flattens the graph
to one variant / one media / `moq:1`. The canonical `POST /catalog/supplier-submissions` already
accepts `attributes`, `variants[]`, `media[]`, `commercial`. Tracing `catalog.service.ts` approval:

| Gap | Evidence | Fix (domain layer, phase 6.2-hardening) |
|---|---|---|
| MOQ unit lost on approval | `approveSubmissionAsNew` inserts `sellerOffer` with `moqUnit:"PIECE"` hardcoded (`catalog.service.ts:206`) | Persist `commercial.moqUnit` (PIECE/PACKAGE/SERIES/BOX/CARTON/SET) |
| Only one offer created | approval creates a single offer from `commercial` (`catalog.service.ts:203-206`) | Support the offer set, or create offers via `POST /offers` post-approval |
| Media not persisted on approval | approval inserts variants + offer; no `productMedia` insert observed | Persist `media[]` → `productMedia` on approve-new |
| Packages/tiers outside submission | `POST /offers/packages`, `POST /offers/pricing-tiers` need an existing `offerId` | Define the supplier sequence: submit → approve → offer → package/tier, or accept them in `commercial` |
| Inventory is delta-based | `POST /inventory/variant` takes `onHandDelta` + `idempotency-key`; server rejects client `sellerId` (`CLIENT_CANNOT_CHOOSE_SELLER_ID`) | UI must present an inventory matrix that posts deltas with idempotency keys |

Positive: identity is server-derived throughout (`resolveActorSeller`, `resolveRequester`); money is
decimal-string → `BigInt` at the boundary; `POST /inventory/variant` already supports idempotency.

### 3.4 Required remediation (execution order)

1. `supplier-product-contract` — typed contracts for product/media/variant/offer/package/tier/inventory.
2. `supplier-variant-builder` — multi-variant creation (size/color/material/fit + flexible attributes).
3. `supplier-media` — media manager (main/gallery/variant media, reorder, remove, preview) on real storage.
4. `supplier-commercial-offer` — offer with wholesale price (decimal string), currency, MOQ, MOQ unit (incl. SERIES).
5. `supplier-series-package` — SIZE_RUN / FIXED_QUANTITY / COLOR_MIX / CUSTOM_BUNDLE builder; backend validates composition + totals.
6. `supplier-pricing-tier` — tier editor via `POST /offers/pricing-tiers`; decimal strings; backend-authoritative totals.
7. `supplier-product-review` — draft → review → submit; server-owned status; show server reason on changes-requested.
8. `supplier-admin-product-moderation` — admin reviews variants/media/offer/MOQ/series/tiers/inventory; approve/reject.
9. `supplier-product-e2e` — golden workflow browser test (Supplier → Admin → wholesale catalog → VIP view).

## 4. VIP / WHOLESALE (phase 6.3, in progress)

| Feature | State | Evidence / note |
|---|---|---|
| VIP identity + membership | YES | `shared/vip/membership.ts`, `SessionProvider`, server `vip` context; gate browser-verified |
| Membership vs capability (RFQ) | YES | `entitlements{catalog,rfq,orders}`; `vip-catalog` identity proves approved-no-sub cannot RFQ |
| Wholesale catalog adapter | YES | `shared/wholesale/catalog.ts` — cursor, decimal-string price, seller preserved (11 tests) |
| Wholesale catalog **UI** capability | **PARTIAL** | UI renders a list only; must expose variants, MOQ + unit, packages/series + composition, pricing tiers, availability → **6.3-C** |
| RFQ / requests / offers | **NO** | `GET /vip/requests` + `/:id/offers` missing; frontend not cut over → **6.3-D** |
| Orders (package/variant semantics) | **NO** | Still `Date.now` codes + local history; must use real package/variant + server totals → **6.3-E** |
| Money / localStorage cleanup | PARTIAL | Catalog decimal-string done; orders/money pending → **6.3-F** |

## 5. ADMIN (phase 6.4 — capability gate applies before each page)

Control plane over real domains. Before implementing each page, inspect backend capability first.
Audit targets: catalog, supplier approval, product moderation, VIP membership, wholesale, retail
orders, finance, production, QC, CMS, settings, audit logs. Remove fake KPI authority,
`localStorage` operational state, hardcoded workflows. **State: not started (6.4).**

## 6. STOREFRONT / CUSTOMER (phase 6.6)

Capability parity for: catalog, variants, media, inventory availability, cart, checkout, account,
orders, returns, reviews, promotions, Try-On. Product Detail must understand the canonical
variant/media model — not fixtures behind API calls. **State: not started (6.6).**

## 7. Traceability rule

Every important frontend control traces to a backend capability; every important backend
user-facing capability traces `API → adapter → UI → browser test`. Avoid: backend capability with
no UI, UI control with no real backend, frontend-invented business state, fake calculations, dead
backend features.

## 8. Intentional omissions register

Any backend capability deliberately without public UI is recorded here with: capability · reason ·
phase · future UI owner. (None registered yet.)
