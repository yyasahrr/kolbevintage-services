# Phase 5.10 — Search / Discovery / Ratings Backend

Backend for retail + wholesale product search, catalog discovery,
and product ratings. The storefront catalog is still hardcoded
(`frontend-next/storefront/data/catalog.ts`); 5.10 builds the
server side only — no storefront rewiring, no new frontend
surface. Checkpoints: A search backend, B discovery/browse, C
ratings, D audits + convergence + guards + report.

Scope locks (user-skipped recon questions, decided by agent):

- Ratings cover **product reviews only**. `supplier_rating` and
  `transaction_rating` stay dormant (documented deferral, §D).
- Review eligibility is **verified purchase only**: the rater
  must own a delivered order containing the product. No fake
  signals.
- Ranking is **text relevance + honestly-maintained popularity**.
  The phase-3 weighted spec's conversion/response signals do not
  exist anywhere in the schema, so they are NOT implemented; A
  ranks by relevance alone, B/C add view counts and rating
  aggregates maintained by real writes.

## 1. Authority map (recon, read-only)

- `catalog` owns `product`, `brand`, `category`,
  `product_variant`, `product_media`, `product_variant_media`
  (registry + module-boundaries). `offers` owns `seller_offer`
  (price per channel). `inventory` owns stock. The `ratings`
  module is a 7-line shell owning `product_rating`,
  `supplier_rating`, `transaction_rating` — zero readers, zero
  writers; the three tables are referenced only in `registry.ts`.
- Current "search" (`CatalogService.searchProducts`, reached via
  `GET /catalog/products?q=`): loads ≤100 published rows into
  memory and filters with JS `.includes()` on name/slug. No
  pagination, no index, rank column unmaintained. **Zero
  consumers**: the storefront is hardcoded, no test pins the
  method, nothing else calls the route. Safe to reshape the
  response (documented below).
- Listings (`listRetailProducts` / `listWholesaleProducts`) are
  `select * limit 100` with no filters; `getProductById`
  enforces no status gate (drafts fetchable — fixed in B).
- `product` carries `search_rank`, `view_count`, `sales_count`
  (all default 0, nothing maintains them),
  `owner_type` (`KOLBE`/`SUPPLIER`, CHECK),
  `status` (`draft/pending_review/approved/published/suspended/archived`,
  CHECK). Retail visibility = `KOLBE` + `published`;
  wholesale visibility = `published` (both owners).
- No FTS / trigram / extension anywhere in SQL or code. Stock
  PostgreSQL ships no Persian stemmer, so trigram similarity —
  script-agnostic and typo-tolerant — is the honest engine.
  PG 17.5 in this repo; `pg_trgm 1.6` available.

## 2. Checkpoint A design (search backend)

### A0 scope locks

- Server-side search only: rewrite `searchProducts` internals;
  listings, detail, and ratings untouched. No new tables.
- One migration (0040): `pg_trgm` + search indexes. Tables stay
  198; journal 40→41 entries / idx 40.
- Response shape changes from bare array to
  `{ results, nextCursor }` — justified: zero consumers (see
  §1). Documented here, not hidden.

### A1 engine

- Normalization (app code, before SQL): trim, collapse inner
  whitespace, fold Arabic Yeh/Kaf to Persian (`ي→ی`,
  `ك→ک`), truncate to 200 chars. Blank after normalize → empty
  result (no full-table scan).
- Candidates (SQL): `name ILIKE %q%` OR `slug ILIKE %q%` OR
  `similarity(name, q) > 0.18` OR trigram match on the joined
  brand/category name. Threshold is explicit in SQL, never the
  server setting. Bound parameters only.
- Deterministic tier score (SQL `CASE`, documented in code):
  exact name = 1000; name prefix = 500 + 100·sim;
  name contains/similar = 100 + 100·sim; slug/brand/category =
  10 + 100·sim. Order `score DESC, id ASC` — total, stable,
  explainable. `searchRank` is deliberately NOT consulted: the
  column is unmaintained and consulting it would launder stale
  zeros as signal.
- Channel fence in SQL: retail → `owner_type = KOLBE` AND
  `published`; wholesale → `published`. Unknown channel defaults
  to wholesale (current behavior, kept).
- Keyset pagination: cursor = base64url `[score, id]`,
  `limit` clamped 1–50 (default 20). Next page: `score < s OR
  (score = s AND id > i)`. Opaque cursor fails closed.

### A2 test plan

- `packages/database/test/phase-5-10-a-migration.test.ts`:
  extension present, GIN opclass on the trigram indexes,
  channel-fence index present, tables still 198.
- `apps/api/test/phase-5-10-a-search.test.ts`: exact-first,
  prefix-before-substring, typo tolerance, Persian query +
  Yeh/Kaf fold, retail hides supplier + drafts, wholesale shows
  both owners but no drafts, keyset has no dupes/skips,
  limit clamp, blank query → empty, injection string safe,
  deterministic order across runs.
- Count-only updates (no weakening): journal 40→41 / idx 40 in
  the 5.7 promotions suite.

## 3. Checkpoint A as-built (search backend)

### A1 implementation record

- Migration 0040: `pg_trgm` + 4 trigram GIN indexes
  (`product_name_trgm`, `product_slug_trgm`, `brand_name_trgm`,
  `category_name_trgm`, all `gin_trgm_ops`) + the channel-fence
  btree `product_status_owner_channel`. Index-only: tables stay
  198, journal 40→41 entries / idx 40. TS schema, snapshot, and
  journal updated in the same commit.
- `searchProducts` rewritten server-side: normalization (trim,
  collapse, Arabic→Persian Yeh/Kaf fold, 200-char cap), explicit
  `similarity > 0.18` candidates over name/slug/brand/category,
  deterministic tier score (exact 1000 / prefix 500+ / contains
  100+ / slug-brand-category 10+), `score DESC, id ASC` order,
  keyset cursor (`[score, id]`, malformed → throws), limit
  clamped 1–50 (default 20). Response is now
  `{ results, nextCursor }` — zero consumers, documented in §1.
- **Locale finding (real, fixed, pinned).** Under a C CTYPE,
  `show_trgm('کتری')` is empty and every Persian similarity is
  0: trigram recall silently dies while substring search keeps
  working. Fix: 5.10 suites create their databases with
  `TEMPLATE template0 LC_COLLATE 'C.utf8' LC_CTYPE 'C.utf8'`,
  and 0040 carries a `DO` block that `RAISE WARNING`s when the
  Persian self-similarity probe returns 0. Deployment
  requirement: any Persian deployment MUST use a Unicode CTYPE;
  warning text says so verbatim.

### A2 gates

- NEW `packages/database/test/phase-5-10-a-migration.test.ts`
  (4: extension, GIN opclass ×4, channel btree, Persian
  self-similarity) and
  `apps/api/test/phase-5-10-a-search.test.ts` (12: exact-first,
  tier order, typo recall, Yeh/Kaf fold, brand tier, channel
  fence both ways, keyset walk 25+25+10 with termination,
  limit clamp/heal, blank queries, injection + wildcard safety,
  determinism + cursor refusal, public HTTP shape).
- Count-only updates (no weakening): journal 40→41 / idx 40 in
  the 5.7 promotions suite; "through 0040" title + comment in
  the 5.3 integrity test.
- `typecheck:all` clean; full `test:all` **1513/1513** green
  (23 shared + 131 database + 1204 api + 155 frontend).

### A3 replaced pins (standing-invariant map, all in-place, zero deletions)

1. 4-9-d-adversarial "SQL injection strings in search queries…"
   `Array.isArray(res.body)` → pins the new `{ results,
   nextCursor }` shape (`results` is an array, `nextCursor` key
   present). The anti-crash intent (HTTP 200 on hostile input)
   is preserved verbatim; the A suite additionally proves the
   table survives.
2. 5-9-d-concurrency "racing customer withdraw + staff approve"
   `[fulfilled] × 1` → `fulfilled ∈ {1, 2}` with end state
   pinned `WITHDRAWN` (was: either state). Pre-existing test
   bug, not a product bug: withdraw is legal from APPROVED by
   design, so approve-first yields two fulfilled and the D
   assertion was order-lucky. The replacement pins both honest
   outcomes (single-winner ⟹ approve refused with
   `RETAIL_RETURN_TRANSITION_INVALID`) and the always-WITHDRAWN
   end state — strictly stronger.

## 4. Checkpoint B design (discovery backend)

### B0 scope locks

- Browse + detail + category/brand reads + view counter. No
  rating surface (C), no search changes (A untouched).
- One migration (0041): browse filter indexes only. Tables stay
  198; journal 41→42 entries / idx 41.
- `calculateSearchRank` (catalog.logic, pinned by its spec)
  stays untouched AND unused: its conversion/response inputs
  are fabricated defaults, so resurrecting it would launder
  fake signal. Browse sorts are explicit instead.
- `sales_count` wiring deferred (documented): bumping it means
  touching the 5.8 money path (`verifyPayment`); popularity in
  this phase is views (B, real detail hits) + ratings (C, real
  reviews). Revisit in D.

### B1 browse (`GET /catalog/browse`, public)

- Filters: `channel` (retail = KOLBE published / wholesale =
  published, same fence as A), `category` (subtree included,
  descendants collected in app with a cycle-guard; uncapped —
  truncating the subtree would silently drop results),
  `brand`, `minPrice`/`maxPrice` (on channel `priceFrom`,
  non-numeric → ignored, min > max → empty), `inStock=true`
  (availability > 0).
- Sorts: `newest` (default), `price_asc`, `price_desc`. No
  `rating` sort until C aggregates exist — the key would sort
  NULLs and lie. Keyset per sort, `limit` 1–50 default 20,
  opaque cursor failing closed (`SEARCH_CURSOR_INVALID` reuse:
  new code `BROWSE_CURSOR_INVALID` — distinct vocabulary per
  surface).
- Price: `priceFrom` = min over published channel offers with
  an active variant (retail: KOLBE seller offers,
  `retail_price`; wholesale: all sellers, `wholesale_price`),
  BIGINT-as-string + currency. Products with no priced offer
  are EXCLUDED from browse (a listing without a price is a
  lie; detail of such a product shows `priceFrom: null`).
- Availability: Σ max(0, on_hand − reserved) over the
  channel's inventory rows for active variants. Exact number
  exposed (own-retail + B2B buyers need real quantities).
- Facets: category + brand counts over the filtered set minus
  the facet's own filter (standard). Counts respect channel +
  price + stock filters.

### B2 detail (`GET /catalog/products/:id`, public)

- Hardened: non-published (or missing) → 404 `PRODUCT_NOT_FOUND`
  (no draft oracle; the old route leaked drafts). Same shape
  for missing and hidden.
- Returns product + brand + category breadcrumb (root→leaf via
  parent chain) + active variants with their published channel
  offers (price, currency) + media + `priceFrom` + availability
  + `viewCount` (post-increment value).
- View counter: single atomic
  `UPDATE … SET view_count = view_count + 1` in-request before
  read. Documented honest label: counts detail hits, not unique
  visitors; no dedup, no bot filtering.

### B3 taxonomy reads (public)

- `GET /catalog/categories`: active-only tree built in app
  (parent_id links, orphans dropped, cycle-guard by visited
  set; uncapped — taxonomy tables are operationally small,
  revisit past ~1000 nodes).
- `GET /catalog/brands`: `verification_status = approved` AND
  `status = active`, name order, uncapped (same reasoning).
  Pending/suspended brands never surface publicly.

### B4 test plan

- `packages/database/test/phase-5-10-b-migration.test.ts`:
  the two filter indexes exist (btree, right columns), tables
  still 198.
- `apps/api/test/phase-5-10-b-discovery.test.ts`: category
  subtree inclusion, brand filter, price window both bounds +
  min>max empty + garbage ignored, inStock true/false,
  retail/wholesale price + availability scoping, unpriced
  excluded from browse but detailed with null, sorts +
  keysets (3 sorts, no dupes/skips), facets respect sibling
  filters, detail 404s drafts identically to missing,
  breadcrumb chain, view counter increments (+concurrent ×10
  = +10), categories tree shape + orphan/cycle safety,
  brands hide pending/suspended.
- Count-only updates: journal 41→42 entries / idx 41 in the
  5.7 promotions suite.

## 5. Checkpoint B as-built (discovery backend)

### B1 implementation record

- Migration 0041: `product_status_category` + `product_status_brand`
  btrees. Index-only: tables stay 198, journal 41→42 / idx 41.
- `browseProducts`: channel fence (same as A), category subtree
  (app-collected, cycle-guarded, uncapped — truncating would
  silently drop results), brand id match, BIGINT price window
  (garbage ignored, min > max → honest empty), `inStock` on
  sellable shelf, sorts newest/price_asc/price_desc with
  per-sort keysets (cursor carries its sort; cross-sort reuse
  refused). Newest keys on SQL-computed epoch microseconds —
  exact in both worlds, immune to JS Date's millisecond
  truncation. Facets count the sibling-filtered set minus the
  facet's own filter.
- Price honesty: `priceFrom` = min over published channel
  offers with an active variant and a non-null channel price;
  currency rides with the cheapest row. Products without a
  priced offer are excluded from browse; detail shows them
  with `priceFrom: null`. Availability sums
  max(0, on_hand − reserved) over (variant, seller) pairs a
  priced offer can actually sell.
- `getProductDetail` replaced `getProductById` on the public
  route: gate + view bump are one UPDATE … WHERE
  status = 'published', so drafts 404 (`PRODUCT_NOT_FOUND`)
  identically to missing rows. Detail carries breadcrumb,
  active variants, channel offers, ordered media, priceFrom,
  availability, and the post-increment viewCount.
- `listCategories` (active-only tree, dangling parents
  dropped, cycles cut) and `listBrands` (approved + active,
  name order); both uncapped with the revisit note in §4.
- Cursor errors use `DomainError` with explicit codes
  (`BROWSE_CURSOR_INVALID`, 400): `CatalogDomainError` carries
  no HTTP status and would 500 a client error. A's
  `decodeSearchCursor` was switched to the same form (its
  `.code` is unchanged, so the A suite passes verbatim; HTTP
  now 400s instead of 500ing — pinned in the B suite).

### B2 replaced pins (standing-invariant map, all in-place, zero deletions)

1. The public detail route's draft leak is closed by
   construction (gate in SQL); no existing test pinned the
   leak, so nothing was replaced — the B suite pins the 404
   identity instead.

### B3 gates

- NEW `packages/database/test/phase-5-10-b-migration.test.ts`
  (2) and `apps/api/test/phase-5-10-b-discovery.test.ts` (16:
  subtree, brand, price window ×5, channel scoping, unpriced
  exclusion + null detail, inStock, price_asc keyset walk,
  price_desc top + newest termination, cursor refusals,
  facets, detail shape both channels, 404 identity incl.
  HTTP, serial + concurrent ×10 view bumps, tree, brands,
  public HTTP + 400 cursors).
- Count-only updates: journal 41→42 / idx 41 in the 5.7
  promotions suite; "through 0041" title + comment in 5.3.
- `typecheck:all` clean; full `test:all` **1531/1531** green
  (23 shared + 133 database + 1220 api + 155 frontend).

## 6. Checkpoint C design (product ratings)

### C0 scope locks

- Product reviews only: `supplier_rating` / `transaction_rating`
  stay dormant (final verdict in D).
- Verified purchase only: the rater must own a delivered retail
  order or a completed wholesale order containing the product.
  Staff cannot file (an insider review is a fake signal).
- One migration (0042): verify-linkage columns + integrity
  CHECKs + the one-review-per-rater unique. Tables stay 198;
  journal 42→43 entries / idx 42.

### C1 architecture (freeze-test-driven)

- The architecture-freeze guard forbids `catalog` any Orders
  dependency or order-table token, transitively. Verification
  therefore lives in `ratings/` (which the freeze test does
  not list): `RatingsService` reads the four order tables
  (added to `READ_EXCEPTIONS`, read-only by convention, pinned
  write-free-for-others in D10) and owns all `product_rating`
  writes.
- There is deliberately NO import edge between catalog and
  ratings in either direction (an edge would drag order tokens
  into catalog's transitive closure). Catalog aggregates
  ratings via SQL (`product_rating` added to its
  `READ_EXCEPTIONS`, read-only); review HTTP lives on a
  `RatingsController` declaring `@Controller("catalog")`
  paths — distinct full paths, no collision with the catalog
  controller.
- Registry: ratings `scaffolded` → `live` (dependsOn
  unchanged, still acyclic).

### C2 verification

- Retail proof: newest `retail_order` with `customer_id` =
  rater AND `order_status` = 'delivered' AND an item with the
  product id. Wholesale proof: newest `wholesale_order` with
  `buyer_user_id` = rater AND `status` = 'completed' AND an
  item with the product id. Retail checked first (documented
  order); the stored order id is the audit proof.
- No proof → 403 `REVIEW_NOT_VERIFIED`. A later delivery
  unblocks a retry (no wedge: nothing is persisted on refusal).

### C3 writes

- File (customer/vip, self): rating 1–5 (`REVIEW_RATING_INVALID`
  on garbage), review text trimmed, `<>` stripped, 2000-char
  cap, empty → NULL (rating-only reviews are legitimate).
  Product must exist (404 `PRODUCT_NOT_FOUND`, same code as
  detail). Duplicate (rater, product) → 409
  `REVIEW_ALREADY_EXISTS` (23505 translation). Status starts
  `visible`.
- Update (owner only): rating/text, keeps status + proof.
  Stranger update → 404 (no id oracle: the id space is not
  enumerable by role — same code as missing).
- Flag (any signed-in customer/vip, not own): visible →
  flagged, idempotent; flagging own review → 409
  `REVIEW_FLAG_OWN`; flagging hidden → no-op success.
- Hide/unhide (admin): → hidden / hidden → visible,
  idempotent, audit-logged (staff speech acts leave a trail;
  customer acts are trailed by the row itself).
- Public reads show visible + flagged (a flag is a staff
  queue, not a takedown); hidden excluded everywhere
  including aggregates.

### C4 reads

- `GET /catalog/products/:id/reviews` (public): newest-first
  keyset (epoch-micros + id, same exactness argument as B),
  rows carry rating, review, status, verified channel
  (retail/wholesale), raterId (opaque, no PII), createdAt.
- Summary `{ average, count }` over visible + flagged
  (average ROUND 2dp as number, null when unrated).
- Detail gains `rating: { average, count }` via a catalog-side
  subquery (no import edge).
- Browse gains the B-deferred `rating` sort: COALESCE(avg, 0)
  DESC, count DESC, id ASC (unrated sink naturally; cursor
  `[sort, avg, count, id]`, numerics validated).

### C5 test plan

- `packages/database/test/phase-5-10-c-migration.test.ts`:
  XOR exactly-one-proof both ways, FKs, rating CHECK,
  status CHECK, the (product, rater) unique, tables 198.
- `apps/api/test/phase-5-10-c-ratings.test.ts`: retail +
  wholesale verified filing, unverified 403 (undelivered,
  foreign product, stranger), staff filing refused, duplicate
  409, owner update + stranger 404, flag flow + own-flag 409,
  hide/unhide + idempotency, hidden excluded from list +
  summary, review listing keyset, summary math, detail
  rating block, browse rating sort + keyset, text
  sanitization + length cap, HTTP RBAC matrix (anon 401,
  customer files, admin hides).
- Count-only updates: journal 42→43 / idx 42 in the 5.7
  promotions suite.

## 7. Checkpoint C as-built (product ratings)

### C1 implementation record

- Migration 0042: `verified_retail_order_id` /
  `verified_wholesale_order_id` (XOR CHECK, restrict FKs),
  `updated_at`, unique (product_id, rater_id). Columns-only:
  tables stay 198, journal 42→43 / idx 42. (First draft also
  re-added the rating/status CHECKs — migration 0005 already
  owns them; snapshots record no CHECKs, which misled the
  first read. Dropped before commit; the C migration test
  pins the real 0005 names.)
- `RatingsService` + `RatingsController` (paths under
  `/catalog`, code in ratings/ — §6 explains why): file
  (customer/vip, verified, 409 on duplicate), update
  (owner-only, stranger → 404), flag (non-owner, idempotent,
  flagged stays public), hide/show (admin, idempotent,
  audit-logged only on change), public list (visible +
  flagged, micros keyset) + summary.
- Verification: newest delivered retail order, else newest
  completed wholesale order, containing the product; the
  proving id is stored. Refusals persist nothing, so a later
  delivery unblocks a clean retry.
- Catalog integration without an import edge: detail gains
  `rating: { average, count }` via subquery; browse gains the
  `rating` sort (COALESCE(avg, 0) DESC, count DESC, id ASC —
  unrated sink; cursor `[sort, avg, count, id]`).
- Boundaries: `product_rating` → catalog READ_EXCEPTIONS
  (aggregates), four order tables → ratings READ_EXCEPTIONS
  (verification); registry ratings → live. Both directions
  pinned write-confined in D10.

### C2 gates

- NEW `packages/database/test/phase-5-10-c-migration.test.ts`
  (3: 198 tables, XOR both ways + both FKs, 0005 CHECKs +
  the unique) and
  `apps/api/test/phase-5-10-c-ratings.test.ts` (13: retail
  filing + stored proof, wholesale + rating-only VIP,
  unverified trio with persistence proof, staff/bad-rating/
  ghost refusals, duplicate + owner-update + stranger 404s,
  flag flow, hide/show + audit + idempotency, summary math,
  review keyset, detail block + browse card, rating sort +
  keyset walk, sanitization + cap, HTTP RBAC matrix).
- Count-only updates: journal 42→43 / idx 42 in the 5.7
  promotions suite; "through 0042" title in 5.3.
- `typecheck:all` clean; full `test:all` **1547/1547** green
  (23 shared + 136 database + 1233 api + 155 frontend).
