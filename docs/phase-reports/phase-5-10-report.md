# Phase 5.10 report — Search / Discovery / Ratings Backend

## Executive result

Phase 5.10 built the server side of product search, catalog
discovery, and product ratings on NestJS: trigram search with
deterministic relevance tiers (Checkpoint A), faceted browse
with hardened detail and taxonomy reads (Checkpoint B),
verified-purchase reviews with moderation (Checkpoint C), and
authority audits with failure/concurrency/security convergence
plus static guards (Checkpoint D). Every checkpoint committed
and went CI green independently (C and D share one push after
a mid-session GitHub token expiry — both commits have green
CI); full `test:all` is green at closeout (23 shared + 136
database + 1264 api + 155 frontend = 1578, 0 FAIL).
Feature/test regression is zero: no behavioral coverage was
removed at any checkpoint, and every moved assertion is mapped
in the architecture doc (§3 A3, §5 B2).

## Checkpoint A — search backend

Server-side search replaced the in-memory JS `.includes()` stub:
migration 0040 enables `pg_trgm` with four trigram GIN indexes
and a channel-fence btree (index-only, tables stay 198).
Queries normalize (trim, Arabic→Persian Yeh/Kaf fold, 200-char
cap), candidates match by containment or explicit `similarity
> 0.18`, and a deterministic tier score orders results (exact
1000 / prefix 500+ / contains 100+ / slug-brand-category 10+,
`score DESC, id ASC`). Retail sees KOLBE-published only;
wholesale sees all published. Keyset pagination, clamped
limits, parameterized everything. A genuine finding: under a C
CTYPE, pg_trgm extracts zero Persian trigrams — 0040
`RAISE WARNING`s on a failing self-test, suites pin C.utf8,
and Unicode CTYPE is a recorded deployment requirement. The
response shape changed array → `{ results, nextCursor }`
(zero consumers, documented). 16 new tests; A gates 1513/1513.
Two in-place pin replacements (adversarial search shape, the
withdraw/approve race order bug — a 5.9-D test bug, not a
product bug).

## Checkpoint B — discovery backend

Faceted browse (`GET /catalog/browse`): channel fence,
category subtree, brand, BIGINT price window, inStock, sorts
newest/price_asc/price_desc with per-sort keysets, and facet
counts over the sibling-filtered set. Prices come from
published channel offers over active variants (unpriced
products excluded from browse, detailed with nulls);
availability sums sellable shelf where a priced offer can
sell. Detail (`GET /catalog/products/:id`) hardened: gate +
view bump in one UPDATE so drafts 404 identically to missing
rows, with breadcrumb, variants, channel offers, ordered
media, priceFrom, and an honestly-labeled hit counter. Public
taxonomy reads: active-only category tree (orphans dropped,
cycles cut) and approved-active brands. Cursor errors use
`DomainError` with explicit codes (the status-less
`CatalogDomainError` would 500 client errors — A's decoder
was switched, same code). Migration 0041 (two filter
btrees, index-only). 18 new tests; B gates 1531/1531.

## Checkpoint C — product ratings

Verified-purchase reviews: a review exists iff its rater owns
a delivered retail order or a completed wholesale order
containing the product, and the proving order id is stored
(XOR, restrict FKs — migration 0042, columns-only). Staff
cannot file; one review per (product, rater) with
owner-only updates; flags queue for staff without taking
down; hide/unhide is admin-only, idempotent, and audit-logged
on change. Public list (visible + flagged, keyset) and
summary; detail embeds the rating block; browse gains the
`rating` sort (unrated sink). Architecture is freeze-driven:
verification reads live in ratings/ (READ_EXCEPTIONS,
read-only), catalog aggregates via SQL, and NO import edge
joins the two — review HTTP is served by a ratings-side
controller on `/catalog` paths. 16 new tests; C gates
1547/1547.

## Checkpoint D — audits, convergence, hardenings, guards

D froze the A/B/C surface: write authorities confined
(D1–D5), races and failures proven convergent (D6 failure
injection, D7 concurrency), the trust boundary attacked (D8
security), legacy ruled untouched (D9 — the storefront stays
hardcoded, out of backend scope), no namespace migration
justified (D11), verdicts pinned as executable guards (D10).
One surgical hardening: detail re-checks `published` on its
read (the unpublish micro-race). Final deferrals: supplier/
transaction ratings (product-only scope), `sales_count`
wiring (would touch the money path), brand-duplicate
pre-check race (not a 5.10 surface). 31 new tests (8 failure
+ 7 concurrency + 8 security + 8 guards). D gates 1578/1578.

## Migration and schema result

Three migrations, zero new tables (194 → 198 in 5.9, still
198): 0040 (pg_trgm + 4 GIN + channel btree + locale
warning), 0041 (browse filter btrees), 0042 (review proof
columns + XOR + unique). Journal 40 → 43 entries / idx 42.
Every migration carries its own proof suite. Deployment
requirement: Persian databases MUST use a Unicode CTYPE
(C.utf8), or trigram recall silently disables (substring
search survives; 0040 warns loudly).

## Money, honesty, and ranking rules

No money moves in 5.10 (read + review surfaces), but the
honesty rules hold: prices are BIGINT-as-string from priced
offers only (never fabricated for unpriced products);
availability is exact sellable shelf; review eligibility is
order-proven with the proof stored; aggregates exclude
hidden; averages round to 2dp; ranking inputs are
relevance (A), explicit sorts (B), and real reviews (C) —
the phase-3 weighted rank's conversion/response signals
were NOT implemented because they don't exist, and
`search_rank` stays dormant and unconsulted (pinned).

## RBAC and trust boundary

Reviews are buyer-only writes (customer/vip + identity) with
verified purchase; staff filing refused; moderation admin-only
with audit; the public reads search/browse/detail/reviews/
summary/taxonomy anonymously. Cursors fail closed with
per-surface codes (400, never 500); hostile sort/bound input
degrades to defaults; LIKE wildcards are escaped; every
query is parameterized. Drafts 404 identically to missing
rows in search, browse, and detail (no oracles); review ids
are not enumerable across raters; public rows carry no PII.

## Verification evidence

### Local verification (fresh, this closeout)

- `typecheck:all` clean (4 workspaces).
- `test:all` 1578/1578 = 1547 (C head) + 31 new D tests:
  shared 23, database 136, api 1264 (+8 failure, +7
  concurrency, +8 security, +8 guards), frontend 155.
  (An earlier draft of this section said 1581/database 139;
  the independently re-run closeout log settles it at
  1578/database 136.)
- New suites: `phase-5-10-d-failure-injection`,
  `-concurrency`, `-security`, `-static-guards`.
- Standing invariant: zero file deletions across the phase;
  the only edits to existing suites are in-place replacements
  mapped in §3/§5.

### GitHub Actions (implementation checkpoints)

- Checkpoint A (`19f0eef`): CI green (`35756867215` SUCCESS).
- Checkpoint B (`bc01058`): CI green (`35759336244` SUCCESS).
- Checkpoint C (`01a4b21`): pushed with D after the GitHub
  token reconnect; CI evidence below.
- Checkpoint D: this closeout — commit, push, and CI evidence
  below.

## Explicit deferred items

- Storefront rewiring onto the new backend (5.10 is backend
  only; `storefront/data/catalog.ts` stays hardcoded).
- Supplier and transaction ratings (tables dormant, verdict
  final for this phase).
- `sales_count` wiring (needs a commerce touch; popularity is
  views + ratings).
- Review helpfulness votes, review photos, and seller
  responses (no schema exists for any of them).
- `rating` sort churn warts: keyset pagination assumes a
  stable sort; concurrent hides can resurface rows across
  pages (pinned as terminating + valid, not dupe-free).
- Brand-duplicate pre-check race (phase-3 surface, untouched).

## Truth table

| Claim | Proof |
|---|---|
| Search ranks deterministically server-side | A suite: tiers, keyset, determinism |
| Persian recall needs Unicode CTYPE | 0040 warning + C.utf8-pinned suites |
| Browse prices/availability are offer-truthful | B suite: channel scoping, unpriced exclusion |
| Detail never leaks drafts | B + D suites: 404 identity, re-check hardening |
| Reviews are purchase-proven | C suite: retail + wholesale proofs, stored ids |
| Staff cannot file reviews | C + D suites: role matrix incl. HTTP |
| Moderation converges + audits | C + D suites: idempotency, trail-last == row |
| Races converge honestly | D7: 409 collapse, +50 bumps, no-dupe walks |
| Trust boundary holds | D8: 404/401/403 matrix, injection degradation, no PII |
| Authorities confined, edges absent | D10 static guards (8) |
| 1578/1578 green, zero regressions | `test:all` log, this closeout |

## Closeout CI evidence

The C+D push (`01a4b21..dbc62b8`) went CI green
(`35764903629` SUCCESS, covering both commits); the count
correction above was committed as `docs: record phase 5.10
final CI`, pushed, and its own CI run was awaited to SUCCESS
before closeout.

Phase 5.10 DONE; the next phase has NOT been scoped.
