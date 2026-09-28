# Phase 5.7 report — Promotions / Campaign / Commercial Engine Backend

Date: 2026-09-22
Branch: `arena/01a0c5f5-kolbevintage-services`
Kind: documentation-only closeout. No application code, migration, frontend,
test, or behavior change is part of this report.

## Executive result

Phase 5.7 is implemented and CI-green as an authoritative backend commercial
engine: versioned promotion terms, a deterministic evaluation engine, a
concurrency-safe coupon redemption ledger, maker/checker execution for
publish/pause, a per-order attribution snapshot contract, and a display-safe
CMS reference seam. No pull request was created, per the task constraint. The
branch was pushed only to the fixed Arena branch.

Two implementation checkpoints were shipped on this branch:

| Checkpoint | Commit | CI | Result |
| --- | --- | --- | --- |
| Starting point | `74055213fbed4a110de723f82b61c9f38cb4fc40` (`docs(phase-5-6): add hardening CI evidence`) | — | Phase 5.6 close state; no promotions schema |
| A | `d6c067c5940917b5daa700f65a11657ed2050d4c` — `feat(phase-5-7-a): versioned promotions + deterministic commercial engine foundation` | `35663449411` — SUCCESS | 0031 schema, lifecycle, deterministic evaluation, coupons, scheduler, admin RBAC surface |
| B | `49988929b4bb041fdaad02cbfc91199bb4a0a03f` — `feat(phase-5-7-b): maker-checker execution, order attribution, CMS display seam` | `35687857921` — SUCCESS | 0032 schema, maker/checker execution, order attribution reads, CMS display seam |

Both CI runs completed with `success` conclusion on workflow `CI` against the
exact checkpoint SHAs (verified via the GitHub API during closeout).

## Migration and schema result

Only migrations `0031` and `0032` were added for this phase. Migrations `0000`
through `0030` were not modified. Drizzle schema, state-values, snapshot, and
journal ownership are aligned; the journal holds 33 entries at index 32 with
tag `0032_phase_5_7_promotions_checkpoint_b`.

- `0031_phase_5_7_promotions_commercial_engine.sql` adds 7 promotion-owned
  tables: `promotion`, `promotion_revision`, `promotion_target`,
  `promotion_coupon`, `promotion_coupon_redemption`, `promotion_usage`,
  `promotion_schedule`.
- `0032_phase_5_7_promotions_checkpoint_b.sql` adds no tables: it extends the
  approval-request-type CHECK (`PROMOTION_PUBLISH`, `PROMOTION_PAUSE`; 9 values
  total), adds two nullable redemption columns (`evaluation_version`,
  `terms_hash`), and adds one `terms_hash` format CHECK.

A fresh scratch-database verification (create empty DB, apply all migrations
via `packages/database/migrate.mjs`, count, drop DB) reports exactly:

| Measure | Exact result |
| --- | --- |
| Migrations applied | 33 / 33 (`0000`–`0032`) |
| PostgreSQL tables | 193 |
| Pre-Phase-5.7 tables | 186 |
| Phase 5.7 tables added | 7 (all in 0031; 0032 adds columns only) |
| Foreign-key constraints | 440 |
| CHECK constraints | 559 |

Constraint counts use the `pg_constraint` convention (`contype = 'f'` / `'c'`
in the `public` schema), matching prior phase reports: `information_schema`
additionally surfaces NOT NULL entries as CHECK rows and is not the reported
figure. Primary keys likewise count 193, one per table.

## Promotion ownership boundaries

Promotions owns campaign definitions, versioned terms, deterministic
evaluation, coupon issuance and the redemption ledger, and campaign schedules.
It never mutates orders, offers, inventory balances/reservations, shipments,
settlement rows, support cases, compliance documents, or notification
deliveries. Orders own their rows; the redemption ledger joins to them only
through the loose `order_reference` string, with no foreign key in either
direction. CMS owns editorial content and never stores discount math; CMS
reaches campaign state exclusively through the display seam (§CMS display
seam). Notifications own send/fill/preferences; Analytics may only read
promotion tables as a read-only source. These boundaries are enforced by
module-boundary tests, which pass.

## Immutable promotion revisions

Campaign terms live in `promotion_revision` rows that are never edited in
place: every terms change is a newly created revision. Publication binds the
revision to a content hash (`termsHash`), and lifecycle handoff is
forward-only — a superseded revision is never flipped back to published.
Historical redemptions therefore always trace to the exact revision (and hash)
that priced them, and later drafts cannot retroactively alter settled
attribution.

## Deterministic evaluation engine

The engine (`promotions.contract.ts` plus the evaluation service) is a pure
function of its inputs: promotion revision terms, order line facts supplied by
the caller, and coupon state. The same inputs always produce the same
`PromotionAttributionSnapshot` (`promotionId`, `promotionRevisionId`,
`couponId`, `baseAmount`, `discountAmount`, `finalAmount`,
`evaluationVersion`, `termsHash`). No wall-clock reads, no random draws, and
no ambient database state participate in the math; eligibility inputs are
explicit and versioned. Arbitrary SQL/JS pricing rules are not expressible:
benefit types, scopes, and target dimensions are closed enums enforced by the
database CHECKs.

## BIGINT / basis-point money rules

All monetary authority is integer minor units (`BIGINT`): `base_amount`,
`discount_amount`, and usage counters are exact. Percentage benefits are
integer basis points (`percentBps`, 0–10,000). Fixed-amount benefits travel as
decimal strings and are parsed into minor units before any arithmetic. There
is no floating-point monetary authority anywhere in the engine, the ledger, or
the display contract.

## Coupon concurrency and idempotency

Redemption is concurrency-safe: the coupon row is locked before the
availability check and the usage increment happens in the same transaction, so
oversubscription under concurrent checkouts is structurally impossible. Every
redemption carries an `idempotency_key` bound to its payload — replays return
the original row, reuse with a different payload is rejected — and actor-level
caps are enforced alongside global coupon caps. 16 evaluation tests and 9
coupon tests cover races, duplicate orders, cap exhaustion, and replay
shapes on real PostgreSQL.

## Stacking/exclusivity semantics

Each revision declares a `stackingPolicy`. Stackable promotions combine;
exclusive promotions block any other promotion on the same order scope, and
the engine resolves conflicts deterministically (exclusivity wins; ties break
by stable revision ordering, never by insertion timing). Mixed stackable /
exclusive baskets are covered by evaluation tests, including the rule that an
exclusive promotion applied later still voids the stackable set rather than
producing an order-dependent total.

## Maker/checker publish/pause flow

Since Checkpoint B, publish and pause execute exclusively through the existing
`approval_request` framework, following the production-recall domain-owned
pattern (the promotions domain executes; the approval dispatcher never
performs domain transitions):

1. A maker with `promotion:edit` requests `PROMOTION_PUBLISH` (binding
   `{promotionId, promotionCode, revisionNumber, termsHash}`) or
   `PROMOTION_PAUSE` (binding `{promotionId, promotionCode}`).
2. A different checker decides through the shared approvals API; self-approval
   is rejected by the framework's two-person rule, including for
   `super_admin`.
3. The deciding checker executes via the promotions execute endpoints, and the
   domain re-asserts the exact terms hash captured at request time before
   transitioning — a draft edited after review cannot publish under a stale
   approval (terms-drift fails closed).
4. Completion is recorded with `markApprovalExecuted`, which accepts only
   decided approvals; double execution and out-of-state transitions are
   rejected.

The direct publish/pause routes were removed from the admin controller.
Schedule/activate/resume/archive remain direct maker operations, and `end`
remains the direct super-admin kill-switch (break-glass). No new RBAC
framework was needed and no RBAC seed changed in Checkpoint B. Ten approval
tests cover both full flows, two-person rejection, terms drift, deferred
auto-execution, checker binding, duplicate guards, and the HTTP surface.

## Order attribution snapshot contract

`recordRedemption` requires the evaluation binding (`evaluationVersion`
matching `^[A-Za-z0-9_.-]{1,64}$`, `termsHash` a 64-char lowercase hex
string); missing or malformed bindings are rejected with
`PROMOTION_REDEMPTION_INVALID`, and the database independently enforces the
hash format. `getOrderAttribution(orderReference)` reads back the full
per-promotion snapshots for an order, ordered by `(created_at, id)`, deriving
`finalAmount = baseAmount − discountAmount` from stored values — never by
re-reading live promotion terms. Pre-0032 rows with NULL bindings read back
with null binding fields. Six attribution tests cover binding enforcement,
multi-promotion orders, snapshot-vs-later-revision immutability, unknown and
malformed order references, and legacy rows.

## CMS display seam

`getPromotionDisplayState(code)` serves a fixed-key, display-safe state:
identity (`code`, `title`, `channel`, `status`), `displayActive` (ACTIVE
status + published revision + in-window), the revision window, and the
benefit shape (`type`, `scope`, `percentBps`, decimal-string `amount`,
`couponRequired`, `inWindow`). Unknown codes return null; malformed codes
throw loudly. The key set is asserted by tests and leaks no eligibility
inputs, actor data, usage counters, or computed discounts.
`CmsPromotionReferenceService` wraps it as a total resolver for render paths:
unknown/malformed/non-string input resolves to `found:false` instead of
throwing, batches dedupe and are hard-capped at 20. Admin-only preview
endpoints (`display/:code`, `:id/attribution/:orderReference`, both
`promotion:view`) expose the seam; no public endpoint was rewired. Eight
display tests cover all of the above. Consuming the seam from public reads and
SiteBuilder is Phase 6 work.

## Admin RBAC

The admin surface enforces `promotion:view/create/edit/publish/pause` and
`coupon:manage` through the existing `AdminPermissionGuard`, seeded to
`super_admin`; `commercial_ops` receives the maker subset
(view/create/edit) but no execution authority. Approval execution reuses the
existing approval-decide permission; no new RBAC framework, role, or seed
row was introduced for Checkpoint B. Permission keys on every promotions
endpoint are asserted by tests.

## Security/adversarial coverage

Six dedicated security tests plus adversarial cases across the lifecycle,
coupon, approval, attribution, and display suites cover: injection-shaped
promotion codes (rejected with `PROMOTION_CODE_INVALID`), malformed
order references and terms hashes, terms-drift publish attempts, maker/checker
self-approval, cross-promotion attribution reads (promo-scoped filter),
duplicate approval requests, out-of-state transitions, double execution,
idempotency-key reuse with a changed payload, cap bypass attempts, and
oversized batch resolution. No raw SQL, no dynamic pricing code, and no
browser-supplied price is reachable by the engine.

## Frontend cutover mapping

No frontend cutover was performed in Phase 5.7 — this was an explicit
constraint, and no 5.7 cutover document was authored. No public evaluation or
checkout endpoint exists; the only HTTP surfaces are admin previews behind
`promotion:view`. The mapping below binds the future cutover; it claims
nothing as done:

- Admin CampaignCenter stays mock/compact: any future publish/pause buttons
  must call the approval request/execute endpoints, never a direct mutation
  (none exists).
- Any future storefront campaign visual must resolve through the CMS display
  seam at serve time; CMS must never receive eligibility inputs or computed
  discounts.
- No browser-supplied price, discount, or coupon outcome may ever reach the
  engine or the ledger; checkout totals remain server-computed from order
  facts plus engine snapshots.
- CampaignCenter redesign is explicitly out of scope for this phase.

## Verification evidence

### Local verification (fresh, this closeout)

| Command | Result |
| --- | --- |
| Scratch DB: create → migrate 33/33 → count → drop | PASS — 193 tables, 440 FKs, 559 CHECKs |
| `npm run test:all` | PASS — 23 shared (2 files), 102 database (14 files), 972 API (88 files), 142 frontend (15 files); 1239 total |
| `npm run typecheck:all` | PASS — shared, database, API, frontend |

Phase 5.7 dedicated coverage: 68 API tests across 7 files (evaluation 16,
lifecycle 13, coupons 9, B-approvals 10, B-attribution 6, B-display 8,
security 6) plus 7 database migration tests, all on real PostgreSQL. The
only `ERROR` lines in the run are expected negative-path logs from failure
injection tests (carrier outage, gateway reset, stale scheduled revision);
the suite exits 0.

### GitHub Actions (implementation checkpoints)

- Checkpoint A: run `35663449411`, SHA
  `d6c067c5940917b5daa700f65a11657ed2050d4c` — SUCCESS.
  URL: https://github.com/yyasahrr/kolbevintage-services/actions/runs/35663449411
- Checkpoint B: run `35687857921`, SHA
  `49988929b4bb041fdaad02cbfc91199bb4a0a03f` — SUCCESS.
  URL: https://github.com/yyasahrr/kolbevintage-services/actions/runs/35687857921

## Explicit deferred items

1. Live Retail order creation → `recordRedemption` wiring belongs to Phase 5.8.
2. CMS/SiteBuilder public consumption belongs to Phase 6.
3. Supplier-funded campaign settlement economics are not implemented.
4. No external marketing provider integration is claimed.

## Truth table

| Claim | Value |
| --- | --- |
| Promotions backend implemented | YES |
| Deterministic commercial evaluation | YES |
| Versioned promotion terms | YES |
| Coupon usage concurrency-safe | YES |
| Maker/checker publish/pause | YES |
| Order attribution contract | YES |
| CMS display reference seam | YES |
| Live Retail checkout wired to promotions | NO |
| Frontend cutover completed | NO |
| Supplier-funded settlement economics | NO |
| Arbitrary SQL/JS pricing rules allowed | NO |
| Floating-point monetary authority | NO |

## Closeout CI evidence

Report commit `062fb3f42cec6c9b1b0f99de97b4026e7635f4a0` (`docs: phase 5.7
comprehensive report`): run `35689349520` — SUCCESS.
URL: https://github.com/yyasahrr/kolbevintage-services/actions/runs/35689349520

This evidence was committed as `docs: record phase 5.7 final CI`, pushed,
and its own CI run was awaited to SUCCESS before closeout.

Phase 5.8 Retail Commerce Core Backend has NOT started.
