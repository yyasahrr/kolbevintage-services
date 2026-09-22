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
