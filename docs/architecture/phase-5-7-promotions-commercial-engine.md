# Phase 5.7 — Promotions / Campaign / Commercial Engine

Status: Checkpoint A — authoritative backend foundation (no frontend cutover)

## 1. Pre-design audit (what exists today)

### 1.1 CampaignCenter localStorage behavior (the debt)

`frontend-next/storefront/pages/CampaignCenter.tsx` is a single-file, browser-state
promotion system built on three localStorage keys:

| Key | Content | Authority problem |
| --- | --- | --- |
| `kv_campaign_center_v1` | campaigns: name, status (`draft`/`active`/`ended`), float `discount` %, target type/value, `startsAt`/`endsAt` strings, coupon string | Discount %, targeting, scheduling decided in the browser; no server validation, no revisioning, float money. |
| `kv_coupon_center_v1` | coupons: code, kind (`percent`/`amount`), float `value`, `minBasket`, `usageLimit`/`used` counters, `enabled` | Usage counters mutated client-side (`used: 84` is fiction); no concurrency control; codes editable live with immediate effect. |
| `kv_marketing_messages_v1` | message templates: event, channel (`sms`/`push`/`email`), text with `{name}`/`{coupon}`/`{cart_link}` placeholders | Commercial messaging fused with discount state; no template versioning, no consent/preference gate, no delivery record. |

Worse, `activate()`/`stop()` fuse commerce and presentation: activating a campaign
rewrites `siteSettings.builder.homepage` (`festival` mode), the hero countdown, and
the campaign banner in the same browser handler that flips the discount live.
There is no lifecycle (scheduled activation is a datetime string nobody enforces),
no stacking rule (activating one campaign ends the previous — implicit exclusivity
in UI code), and no audit trail.

**Checkpoint A verdict:** none of this is authoritative. It stays untouched
(frontend freeze, §10) and is mapped to backend owners for a later cutover.

### 1.2 Current retail pricing path

`frontend-next/server/retail-pricing.ts` is the transitional server-side retail
price authority: it rebuilds unit prices from the hardcoded catalog pricebook,
recomputes totals with `bigint`, rejects unknown products/sizes, and records
`submittedUnitPrice` mismatches (`adjusted` flag). Money leaves as decimal
strings. Known registered debt (D7): the retail catalog itself is still a
frontend data file, so retail has **server-side computation but not yet a
database-owned price authority**. Promotions therefore treats retail unit prices
as *caller-attested transition input*: product/category liveness is revalidated
against Catalog, money shape is enforced, the transition is flagged in the
evaluation output — but full price re-derivation for retail awaits the retail
price authority (Phase 6 scope, not 5.7).

### 1.3 Wholesale PricingService architecture

`apps/api/src/modules/pricing/` is tableless and authoritative: `resolvePrice`
maps `(offer, variant|package, quantity, tiers)` to `(unitPrice, lineTotal,
pricingTierId, pricingUnit)` with bigint money, integer quantities, explicit
piece/package semantics, deterministic tier selection, and `MAX_MONEY` overflow
protection. Accepted terms are snapshotted and hash-pinned
(`hashAcceptedTerms`), so wholesale orders carry tamper-evident base prices.

**Authority order (non-negotiable):** Offers → PricingService base price →
Promotions commercial adjustment → order snapshot. Promotions never derives a
base price and never accepts a browser-submitted unit price. For wholesale
lines, the facts provider re-runs `PricingService.resolvePrice` through the
new public offers read contract (`listPricingTiersForResolution`) and the
evaluation fails closed on any mismatch with the caller-supplied unit price.

### 1.4 CMS promotional-content boundary

CMS (`cms_page`, content documents, media, publication schedules) owns versioned
editorial content and *may display* a campaign (festival hero, countdown,
banner) by referencing a promotion's stable identity. CMS never stores discount
math, never decides eligibility, and never gates checkout. Any campaign visual
in SiteBuilder remains a presentation reference resolved against Promotions
state at render/serve time (5.7-B concern).

### 1.5 CRM segmentation boundary

CRM owns contacts, identity links, stages, and tags. A promotion may target
`CUSTOMER_SEGMENT` (`tag:<key>` or `stage:<STAGE>`), but the segment facts are
read live from CRM at evaluation time through `CrmContactService`
(`getContactByUserId`) and `CrmTagService`. The caller never supplies its own
segment/contact identity: retail actors are resolved `userId → contact`
server-side, so segment targeting cannot be spoofed from the browser.

### 1.6 Notifications boundary

Notifications owns templates, preferences, consent gating, outbox, providers,
and receipts. Campaign messaging (`kv_marketing_messages_v1` → templates like
`{coupon}` inserts) is a Notifications/Marketing orchestration concern.
Promotions never sends SMS/email/push, never renders message text, and adds no
notification event keys in Checkpoint A. A future 5.7-B orchestration may read
promotion state to *fill* a coupon code into an approved template; the send
decision stays with Notifications.

### 1.7 Orders snapshot requirements

Historical order totals must never change when campaign rules change. The
evaluation contract (`promotions.contract.ts`) therefore emits a
`PromotionAttributionSnapshot` per applied promotion carrying
`promotionId`, `promotionRevisionId`, `couponId`, `baseAmount`,
`discountAmount`, `finalAmount`, plus `evaluationVersion` and a `termsHash`.
Future order writes (5.7-B) snapshot these values; re-reading the live
promotion is for explanation only, never for recomputation.

### 1.8 Retail vs wholesale semantics

| Aspect | RETAIL | WHOLESALE |
| --- | --- | --- |
| Actor | `RETAIL_CUSTOMER { userId }` | `WHOLESALE_ACCOUNT { accountId, userId }` (userId must own the account) |
| Line anchor | `productId` (KOLBE-only via `assertRetailIsolation`) | `offerId` + exactly one of `variantId`/`packageId` |
| Base price | Caller-attested transition price + Catalog liveness revalidation (flagged) | Re-resolved via PricingService; mismatch fails closed |
| Typical benefits | percent/amount off, free shipping, coupon, category campaign | VIP-plan/account targeting, offer targeting, quantity thresholds |
| Customer segment | CRM tag/stage via identity link | CRM link type `wholesale_account` supported by the same lookup |

Channel mismatch fails closed in both directions: a RETAIL promotion never
applies to a wholesale evaluation and vice versa.

## 2. Checkpoint A design

### 2.1 Identity vs revision

`promotion` is identity (`code`, `channel`, lifecycle `status`,
`currentPublishedRevisionId`). `promotion_revision` snapshots commercial terms
(benefit, scope, value, stacking, priority, limits, window, targets). Publishing
is an atomic pointer swing (`DRAFT → PUBLISHED`, previous `PUBLISHED →
SUPERSEDED`); editing a live promotion creates a new draft revision. Immutability
is enforced in **two** layers: service transition guards plus PostgreSQL
triggers (`promotion_revision_immutable`, `promotion_target_revision_guard`)
that reject UPDATE/DELETE of non-draft terms. `currentPublishedRevisionId`
carries no database FK (same circularity rationale as CMS) — the triggers and
the transactional publish path are its integrity.

### 2.2 Lifecycle

Promotion identity: `DRAFT → IN_REVIEW → SCHEDULED → ACTIVE ⇄ PAUSED → ENDED →
ARCHIVED`, with `IN_REVIEW → DRAFT` (reject), `SCHEDULED → DRAFT` (unschedule),
`DRAFT|IN_REVIEW|SCHEDULED → ARCHIVED`, `ENDED → ARCHIVED`. No arbitrary status
PATCH exists — every edge is an explicit service method (submit, approve,
schedule, activate, pause, resume, end, archive) executed in a transaction with
an audit row. Activation requires a published revision; scheduled activation
goes through `promotion_schedule` + the advisory-locked worker with stale-claim
recovery (CMS/recovery pattern), never through a forgotten datetime string.

### 2.3 Targets (allowlisted, ANDed)

`PRODUCT, CATEGORY, OFFER, VIP_PLAN, VIP_ACCOUNT, CUSTOMER_SEGMENT,
MIN_SUBTOTAL, MIN_QUANTITY`. All targets on a revision must match (AND). There
is no expression language: `value_text` refs are validated (shape + existence
via owner services at creation, liveness at evaluation), `value_amount` is
BIGINT IRR, `value_quantity` is a positive integer. `DATE_WINDOW` is
deliberately **not** a target row: the commercial window is revision-level
(`starts_at`/`ends_at`, part of the terms hash) so there is exactly one
canonical window. Unknown/undeclared target input is rejected, never ignored.

### 2.4 Benefits and scope

`PERCENT_DISCOUNT` (integer basis points, 1–10000) on `LINE|ORDER`;
`FIXED_AMOUNT_DISCOUNT` (BIGINT IRR, `ORDER` only — per-line fixed allocation
is ambiguous and therefore forbidden); `FREE_SHIPPING` (`SHIPPING` only).
Percent math is `floor(base × bps / 10000)` per application unit; order-level
discounts are allocated across lines proportionally (floor + deterministic
remainder to lowest `lineId` first); a discount never drives any amount
negative (clamped + CHECK-backed). No floats anywhere; JSON carries decimal
strings.

### 2.5 Stacking (deterministic, no silent best-pick)

Each revision declares `EXCLUSIVE | STACKABLE` plus an integer `priority`.
Eligible promotions sort by `(priority ASC, promotionId ASC)`. If any eligible
promotion is `EXCLUSIVE`, exactly the first one applies and the rest are
rejected with `EXCLUSIVE_CONFLICT` — priority decides, not "biggest discount".
Otherwise all eligible `STACKABLE` promotions apply in order, each percent
applying to the remaining base. The rule is explicit, tested, and admin-visible.

### 2.6 Coupons and concurrency-safe redemption

Coupons are first-class rows bound to an exact revision, with normalized
globally-unique codes, enabled flag, window, `usage_limit`, `used_count`, and
optional `per_actor_limit`. Redemption is one transaction: promotion + revision
rows locked (`FOR UPDATE`, which serializes redemptions per revision), coupon
row locked and checked (enabled/window/terms binding), guarded atomic
`used_count` increment (`… WHERE used_count < usage_limit`), a revision-level
`max_total_uses` check across **all** coupons of the terms (one coupon counter
cannot enforce a shared cap), guarded per-actor `promotion_usage` upsert, and a
`promotion_coupon_redemption` insert with a globally-unique idempotency key.
Concurrent checkouts racing the last use serialize; exactly one wins. A coupon
from a superseded revision is rejected (`STALE_COUPON_REVISION` /
`PROMOTION_COUPON_REVISION_STALE`), never silently remapped. Automatic
(codeless) promotions redeem with a NULL `coupon_id`, deduped per
`(revision_id, order_reference)`; coupon redemptions dedupe per
`(coupon_id, order_reference)`. Because a failed statement aborts the whole
Postgres transaction, idempotency conflicts are resolved by re-reading the
winner **outside** the rolled-back transaction — never by querying inside it
(which would only yield `25P02`).

### 2.7 Evaluation contract (pure core, read-only service)

`evaluatePromotionSet` in `promotions.logic.ts` is pure/deterministic: resolved
facts in, contract out (`baseSubtotal`, `lineDiscounts`, `orderDiscount`,
`shippingDiscount`, `totalDiscount`, `finalSubtotal`, `appliedPromotions`,
`rejectedPromotions`, `evaluationVersion`, `termsHash`). Attribution is
disjoint by construction: `lineDiscounts` accumulates LINE-scope promos only,
while ORDER-scope promos attribute through their own per-promo
`allocatedLines` plus the `orderDiscount` memo — a shared `remaining` map still
drives every percent-on-remaining-base computation. Totals therefore cannot
double count (`totalDiscount = ΣlineDiscounts + orderDiscount +
shippingDiscount`), and the engine asserts no negative amount before
returning. The service layer
(`PromotionEvaluationService`) only loads candidates, resolves facts through
owner domains, and calls the pure core — it writes nothing (not orders,
inventory, payments, settlement, or usage). Usage recording is the separate,
explicit `recordRedemption` call the future checkout will make.

### 2.8 RBAC and maker/checker

New catalog actions: `promotion:view/create/edit/publish/pause/coupon:manage`,
enforced by the existing `AdminPermissionGuard` (`admin-promotions.controller.ts`)
and seeded to `super_admin`. `commercial_ops` receives view/create/edit (maker)
but **not** publish/pause (high-impact activation stays with super_admin until
maker/checker execution wiring lands in 5.7-B; no new RBAC framework, no new
approval request type in Checkpoint A).

## 3. Phase 6 frontend mapping (future, not implemented)

| Legacy browser state | Authoritative backend | Presentation residue |
| --- | --- | --- |
| `kv_campaign_center_v1` | `promotion` + `promotion_revision` + `promotion_target` + `promotion_schedule` | Admin CRUD UI only; no local math |
| `kv_coupon_center_v1` | `promotion_coupon` + `promotion_coupon_redemption` + `promotion_usage` | Admin coupon UI; usage shown from server |
| `kv_marketing_messages_v1` | Notifications templates + preferences + outbox | Message admin stays out of Promotions |
| Homepage festival visuals + countdown | CMS presentation referencing promotion identity | SiteBuilder renders server state |

## 4. Honest debt carried out of Checkpoint A

1. Retail base-price authority is still transitional (§1.2); evaluation flags it.
2. Maker/checker execution for publish/pause is designed, not wired (5.7-B).
3. First-purchase/recency rules need Orders history reads — dimension intentionally omitted.
4. Supplier-funded campaigns: no settlement economics invented (explicit non-goal).
5. No public evaluation/checkout endpoint yet — admin preview only, so no browser
   price can structurally reach the engine.
