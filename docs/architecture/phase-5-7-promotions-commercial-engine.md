# Phase 5.7 — Promotions / Campaign / Commercial Engine

Status: Checkpoint A (backend foundation). No frontend cutover.
Owner: `promotions` module (`apps/api/src/modules/promotions/`).
Migration: `0031_phase_5_7_promotions_commercial_engine.sql`.

This document is the A1 architecture audit. It freezes the commercial
boundary: Promotions decides **eligibility + benefit**, nothing else.

---

## 1. Current state audit (what exists today)

### 1.1 `CampaignCenter.tsx` — browser-local commercial authority (the debt)

File: `frontend-next/storefront/pages/CampaignCenter.tsx` (single-file admin UI).

Three localStorage keys act as a fake commercial backend:

| Key | Content | Problem |
|---|---|---|
| `kv_campaign_center_v1` | campaigns: name, status (`draft/active/ended`), `discount` (float percent), `targetType` (`all/category/collection/product`), `targetValue`, `startsAt/endsAt`, `coupon` (free-text string) | Discount math, targeting, scheduling and activation all happen in the browser. Any user can forge them. Activation also rewrites homepage mode + countdown automatically. |
| `kv_coupon_center_v1` | coupons: `code`, `kind` (`percent/amount`), `value` (float), `minBasket`, `usageLimit/used`, `enabled` | Usage counters are browser state (`used` increments nowhere authoritative). No normalization, no concurrency control, no expiry enforcement. |
| `kv_marketing_messages_v1` | message templates: event, channel (`sms/push/email`), text with `{name}/{coupon}/{cart_link}` | Marketing automation templates mixed into the same screen as pricing. Sending is not wired to any backend. |

Additional violations:

- `discount` is a JS `number` (float percent) — violates the integer-money rule.
- Activating a campaign calls `saveSiteSettings(...)` and flips
  `builder.homepage.mode` to `"festival"`, i.e. **commercial state drives
  presentation state** with no backend record.
- There is no revisioning: editing a campaign silently rewrites the only copy,
  so historical orders cannot reference the terms they were priced with.
- Coupon `code` is a mutable string field; duplicates, case variants and races
  are all possible.

**Verdict: none of this is authoritative. Checkpoint A builds the backend and
leaves the frontend untouched (A16 freeze).**

### 1.2 Retail pricing path (transition logic, still legacy)

File: `frontend-next/server/retail-pricing.ts`.

- Server-side price book built from the hardcoded catalog
  (`storefront/data/catalog.ts`) — explicitly documented as transition debt (D7).
- `priceRetailOrder()` re-prices every line from the server book, ignores
  browser-submitted unit prices (records divergence in `adjusted`), computes
  totals with `bigint`, enforces payment-method/channel separation
  (BNPL is retail-only), and versions the book (`PRICE_BOOK_VERSION`).
- Shipping: `SHIPPING_METHODS` + `FREE_SHIPPING_THRESHOLD`; COD ships free.
- Money is `bigint` internally, decimal strings on the wire (`moneyToJson`).

What it does **not** do: coupons, campaigns, percent promotions, stacking, or
any usage accounting. Phase 5.7 inserts promotions **after** this step:

```
retail price book → base line totals → Promotions evaluation → order snapshot
```

The retail price book remains the base-price authority; promotions only ever
produce non-negative adjustments on top of server-resolved totals.

### 1.3 Wholesale `PricingService` (tableless, authoritative)

Files: `apps/api/src/modules/pricing/{pricing.module,pricing.service,pricing.logic}.ts`.

- `PricingService` owns **no tables** (`tables: []` in the registry). It
  resolves price from `seller_offer` + `wholesale_pricing_tier` + package
  composition read through the Offers public surface.
- Pure core (`pricing.logic.ts`): `resolvePrice()` is deterministic,
  `bigint` money, integer quantities, explicit tier selection with
  ambiguity rejection, `MAX_MONEY` overflow guard.
- `hashAcceptedTerms()` / `validateMultiRequestBatch()` freeze accepted
  commercial terms with a sha256 over canonical JSON — the exact pattern
  Phase 5.7 reuses for promotion attribution (`evaluation_hash`).

Wholesale flow with promotions:

```
Offers → PricingService base price → Promotions commercial adjustment
       → accepted terms / order snapshot
```

Promotions never re-resolves unit price and never accepts a
browser-submitted unit price.

### 1.4 CMS promotional-content boundary

Module: `apps/api/src/modules/cms/`. CMS owns versioned editorial content,
publication workflow and media metadata — including *campaign presentation*
(hero, festival sections, countdown copy).

Boundary (frozen):

- CMS may **display** a campaign (reference a promotion by stable id/key and
  render editorial content around it).
- CMS must never compute eligibility, discounts, usage, or stacking.
- No promotion calculation, coupon validation, or commercial rule lives in
  CMS tables or services. The CMS import/validation files mention
  "promotion" only to forbid embedding promotion rules in documents.
- The `CmsPublicationService` claim-based schedule worker
  (`cms_publication_schedule` + `JobLockService` session lock + stale-claim
  recovery) is the durable-scheduling pattern that `promotion_schedule`
  copies — pattern reuse, not code coupling.

### 1.5 CRM segmentation boundary

Module: `apps/api/src/modules/crm/`. CRM owns contacts, identity links,
stages, tags and activities.

Boundary (frozen):

- CRM defines customer segments (modelled as tags on linked contacts).
- Promotions **reads** segment membership through the CRM public service
  surface (`CUSTOMER_SEGMENT` targets carry a tag id; the engine resolves
  membership server-side). Promotions never writes CRM rows and never
  embeds contact PII in promotion tables (`customer_key` is an opaque
  `user:<id>` / `account:<id>` reference).
- Segment ids coming from the browser are untrusted input and are always
  re-resolved.

### 1.6 Notifications boundary

Module: `apps/api/src/modules/notifications/`. Owns events, templates,
preferences, outbox delivery and provider receipts.

Boundary (frozen):

- Notifications may **send** campaign messages (a future marketing
  orchestration may reference a promotion id when rendering a template).
- Promotions never sends SMS/email/push, never renders templates, and never
  stores message copy. `kv_marketing_messages_v1` therefore maps to the
  Notifications/Marketing orchestration boundary, not to Promotions.
- Checkpoint A adds no notification events and no templates.

### 1.7 Orders snapshot requirements

Orders (`orders` module, wholesale; `retail_order` transition path) remain
the order authority. When checkout adopts promotions (Phase 5.7-B or later),
each applied promotion must snapshot **at commit time**:

```
promotion_id, promotion_revision_id, coupon_id (nullable),
base_amount, discount_amount, final_amount, evaluation_hash,
evaluation_version
```

Properties:

- The snapshot references an **immutable revision** — later campaign edits
  create new revisions and never rewrite history.
- `evaluation_hash` lets any reader re-verify the committed numbers against
  the revision terms without re-running checkout.
- Money is `bigint` in storage, decimal strings on JSON.
- The attribution shape is defined in
  `apps/api/src/modules/promotions/promotions.contract.ts`
  (`PromotionAttribution`) so Orders can adopt it without importing
  promotion internals. Checkpoint A changes **no** Orders code.

### 1.8 Module registry

`promotions` was `planned` with `tables: []`. Checkpoint A flips it to a
real owner (tables listed in §3) with `status: "live"` only after the
implementation, migration, and tests below are functional.

---

## 2. Domain ownership (frozen)

Promotions **owns**:

- promotion identity + internal key
- immutable versioned commercial terms (revisions)
- campaign lifecycle (DRAFT → … → ARCHIVED)
- structured eligibility targets (allowlisted dimensions only)
- benefit definitions (validated catalog, integer money)
- coupon/voucher codes (normalized, unique, usage-limited)
- redemption + usage records (append-only)
- stacking/exclusivity policy + deterministic evaluation order
- commercial evaluation result + attribution hash

Promotions **does not own** (reads only, through owner services):

| Fact | Owner | Read surface |
|---|---|---|
| product / category identity | catalog | `CatalogService.getOrderEligibleProduct` |
| offer existence | offers | `OffersService.getOfferEligibility` |
| VIP account / plan / membership | vip | `VipService` + `WholesaleMembershipService` reads |
| customer segment membership | crm | contact tags via CRM services |
| base unit price / line total | pricing (wholesale) / retail price book | evaluation input carries server-resolved totals |
| order lifecycle, payment, shipping state, settlement | orders / payments / shipping / settlement | not touched by evaluation (read-only proof in tests) |
| presentation | cms | CMS references promotion by id only |
| delivery | notifications | no coupling in Checkpoint A |

---

## 3. Data model (migration 0031)

All tables are owned by `promotions`. All FKs are `ON DELETE RESTRICT`.
Money is `bigint`; percents are integer basis points (15% = 1500).

```
promotion                        identity: key, channel, lifecycle status,
                                 current_published_revision_id
promotion_revision               immutable terms: stacking, priority,
  ├─ promotion_target            coupon_required, window, usage limits,
  └─ promotion_benefit           terms_hash, maker/checker link
promotion_coupon                 code (normalized unique), pinned-or-floating
                                 revision link, window, limits, counter
promotion_coupon_redemption      append-only coupon applications
promotion_usage                  append-only codeless applications
promotion_schedule               durable ACTIVATE/DEACTIVATE jobs
```

Key decisions:

- **Identity ≠ terms.** `promotion` carries lifecycle; `promotion_revision`
  carries commercial terms. Publishing supersedes the previous revision;
  the old row is frozen by a trigger. Redemption/usage rows point at the
  exact revision applied, so history never shifts.
- **Coupon link is pinned-or-floating.** `promotion_coupon.revision_id` may
  be `NULL` (follows the promotion's current published revision) or pinned
  to one revision (a pinned code stops working when a newer revision
  publishes — recorded as `STALE_REVISION`, never silently re-terms).
- **No executable rules.** Targets are `(type, reference_id | scalar)`
  rows over a 10-member allowlist; there is no expression column, no
  template evaluation, no `eval`-shaped anything.
- **Concurrency is row-lock based.** Commits lock the `promotion` row
  (then the `promotion_coupon` row for coded paths) with
  `SELECT … FOR UPDATE` inside one transaction, then re-check limits with
  `COUNT(*)` before inserting the ledger row. Two concurrent checkouts
  cannot both pass a `usage_limit = 1` gate.
- **Scheduling reuses the CMS pattern.** `promotion_schedule` rows are
  claimed (`SCHEDULED → PROCESSING`) under a `JobLockService` session
  lock, executed inside a transaction, and stale `PROCESSING` claims are
  recovered — the same shape as `cms_publication_schedule`.

---

## 4. Lifecycle

### 4.1 Promotion (campaign) lifecycle

```
DRAFT ─┬─→ IN_REVIEW ─┬─→ SCHEDULED ─→ ACTIVE ⇄ PAUSED ─→ ENDED ─→ ARCHIVED
       │              │       │            ↑        │
       │              │       └─→ DRAFT ←──┘        │
       ├─→ ACTIVE (atomic publish+activate)         │
       └─→ ARCHIVED                                 └─→ (terminal: ARCHIVED only)
```

Legal transitions (explicit map in `promotions.logic.ts`,
`PROMOTION_TRANSITIONS`):

- `DRAFT → IN_REVIEW | ACTIVE | ARCHIVED`
- `IN_REVIEW → DRAFT | SCHEDULED | ACTIVE | ARCHIVED`
- `SCHEDULED → ACTIVE | DRAFT | ARCHIVED`
- `ACTIVE → PAUSED | ENDED`
- `PAUSED → ACTIVE | ENDED`
- `ENDED → ARCHIVED`
- `ARCHIVED → (none)`

Rules:

- Entering `ACTIVE`/`SCHEDULED` requires a published revision; the
  publish and the activation happen in **one transaction** (no window in
  which a promotion is ACTIVE with no terms).
- There is no arbitrary status update — every transition goes through
  `PromotionService.transition()` which validates the map above.
- `SCHEDULED` promotions flip via `promotion_schedule` (durable worker),
  never via wall-clock checks in request handlers.

### 4.2 Revision editorial state

`DRAFT → IN_REVIEW → PUBLISHED → SUPERSEDED`, with `ARCHIVED` as a side
terminal. Editing a `PUBLISHED`/`SUPERSEDED` revision is impossible at both
layers: the service refuses, and a trigger
(`phase_5_7_reject_published_revision_mutation`) rejects any commercial
column change or delete. Editing an active campaign therefore always
creates a **new draft revision** (copy-on-write helper provided).

---

## 5. Eligibility model

Allowlisted target types (and only these):

```
CHANNEL, PRODUCT, CATEGORY, OFFER, VIP_PLAN, VIP_ACCOUNT,
CUSTOMER_SEGMENT, MIN_SUBTOTAL, MIN_QUANTITY, DATE_WINDOW
```

- All targets on a revision combine with AND.
- `PRODUCT`/`CATEGORY`/`OFFER` are **line-scoped**: they select which
  lines a benefit can touch. Everything else gates the whole promotion.
- `CHANNEL` must equal the promotion's own channel (defence in depth:
  a retail promotion can never apply to a wholesale evaluation even if a
  target row is mis-authored — the engine checks both).
- `MIN_SUBTOTAL` is `bigint` IRR compared against the server-resolved
  subtotal. `MIN_QUANTITY` is an integer compared against total units.
- `DATE_WINDOW` is an extra window inside the revision window.
- Reference ids are opaque strings validated for shape
  (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`); existence is re-checked
  against the owner domain at evaluation time. SQL/JS-shaped input is
  rejected by shape validation before any query is built.

---

## 6. Benefit catalog + scope

| Benefit | Allowed scopes | Stored as |
|---|---|---|
| `PERCENT_DISCOUNT` | `LINE`, `ORDER` | `percent_bps` 1..10000 |
| `FIXED_AMOUNT_DISCOUNT` | `ORDER` | `amount` bigint IRR, 1..MAX_MONEY |
| `FREE_SHIPPING` | `SHIPPING` | no amount (covers the full shipping total) |

Scope pairing is enforced by a DB `CHECK`, not just by the service.

Allocation semantics (deterministic, integer-only):

- `LINE` percent: `floor(line_total × bps / 10000)` per eligible line.
- `ORDER` percent/fixed: compute the order-level discount, then allocate
  across eligible lines with largest-remainder apportionment, ties broken
  by `line_id` ascending — the allocated parts always sum **exactly** to
  the order discount.
- Every line discount is capped at its line total; an order discount is
  capped at the eligible subtotal. **A discount can never make any amount
  negative.**
- `SHIPPING`: covers `min(shipping_total, shipping_total)` = the full
  server-resolved shipping total (never a browser number).

---

## 7. Stacking / exclusivity

- Each revision declares `EXCLUSIVE` or `STACKABLE` plus an integer
  `priority` (lower first; ties by `promotion_id` ascending — total order,
  no randomness, no timestamps in the ordering).
- If any applicable promotion is `EXCLUSIVE`, the first one (in that
  order) applies **alone**; every other candidate is rejected with
  `EXCLUSIVE_CONFLICT`. Multiple applicable exclusives do NOT combine and
  the engine does NOT silently pick the "best" one — first-in-order wins,
  deterministically.
- Otherwise all applicable `STACKABLE` promotions apply. Each is computed
  independently against base totals and summed per line, capped at the
  line total — so the result does not depend on application order.
- Free-shipping benefits stack by idempotent coverage (shipping is either
  covered or not; two free-shipping promotions do not double-pay).

---

## 8. Evaluation contract

Pure core: `evaluatePromotionTerms()` in `promotions.logic.ts`.
Orchestration: `PromotionEvaluationService` (loads candidates, resolves
facts, takes a consistent usage snapshot, calls the pure core).

Input (conceptual):

```ts
{
  channel,                       // RETAIL | WHOLESALE
  actor: { userId, vipAccountId? },
  lines: [{ lineId, productId, offerId?, quantity,
            unitPrice, lineTotal }],   // server-resolved base prices
  shippingTotal,                 // server-resolved
  couponCodes: string[],         // raw browser input, normalized server-side
  now
}
```

The service **re-resolves** every identity: product/category via Catalog,
offer via Offers, VIP plan/account via VIP, segments via CRM. Caller-
supplied `categoryIds`/`segments`/`planId` are ignored for decisions.

Output (conceptual):

```ts
{
  evaluationVersion: "promo-eval-v1",
  baseSubtotal, baseShipping,
  lineDiscounts: [{ lineId, discount }],
  orderDiscount, shippingDiscount, totalDiscount,
  finalSubtotal, finalShipping, finalTotal,
  appliedPromotions: [{ promotionId, revisionId, couponId?,
                        baseAmount, discountAmount, finalAmount,
                        evaluationHash }],
  rejectedPromotions: [{ promotionId, revisionId?, reason }],
  termsHash
}
```

Guarantees:

- `bigint` internally; decimal strings at the JSON boundary.
- **Read-only**: evaluation opens no write transaction and touches no
  order/payment/inventory/settlement state (proven by tests that snapshot
  those tables around evaluation).
- Deterministic: same input + same committed rows ⇒ byte-identical output
  (canonical JSON + sha256 `evaluation_hash`).

---

## 9. Retail vs wholesale semantics

| Aspect | RETAIL | WHOLESALE |
|---|---|---|
| Buyer identity | `user:<id>` customer key | `account:<id>` VIP account key |
| Base price | retail price book (transition) → future retail authority | `PricingService` over offers/tiers |
| Typical benefits | percent/fixed coupons, category campaigns, free shipping | plan/account-targeted percents, package-aware incentives |
| VIP targets | not applicable (rejected if present without VIP context) | `VIP_PLAN` / `VIP_ACCOUNT` resolved via VIP |
| Channel enforcement | `promotion.channel` + `CHANNEL` targets + evaluation gate | same, mirrored |

Supplier-funded campaigns are **not** modelled in Checkpoint A: no
settlement economics are invented. A future phase may add an explicit
`funder` dimension with full settlement modelling.

---

## 10. Security properties (tested, real PostgreSQL)

- Published terms immutable (service + trigger).
- Illegal lifecycle transitions rejected.
- Basis-points percent, `bigint` money, no negative amounts, overflow
  guarded (`MAX_MONEY`), malformed money rejected.
- Allowlisted targets only; SQL/JS-shaped rules impossible (shape
  validation + no expression storage/evaluation).
- Channel isolation both directions.
- Coupon normalization (`trim` + uppercase), global unique, window and
  status enforced, usage + per-customer limits enforced, concurrent
  redemption race covered (exactly one winner at limit 1).
- Deterministic stacking; exclusivity conflicts explicit.
- Server base price authoritative (browser unit prices ignored).
- Evaluation mutates nothing outside `promotions` reads.
- Historical revisions preserved and referenced by ledger rows.
- Cross-VIP targeting cannot be spoofed (account id comes from the
  authenticated actor, membership re-checked via VIP).
- Admin RBAC: `promotion:view/create/edit/publish/pause/coupon:manage`
  through the existing `AdminPermissionGuard`; publish/activation can
  ride the maker/checker approval flow (`PROMOTION_PUBLISH`).

---

## 11. Frontend mapping (Phase 6, not started)

| Legacy localStorage | Authoritative backend |
|---|---|
| `kv_campaign_center_v1` | `promotion` + `promotion_revision` + targets/benefits (admin API) |
| `kv_coupon_center_v1` | `promotion_coupon` + redemption ledger |
| `kv_marketing_messages_v1` | Notifications/Marketing orchestration (NOT promotions) |
| homepage festival visuals + countdown | CMS presentation referencing `promotion_key` (display only) |

No `CampaignCenter.tsx`, SiteBuilder, or CMS visual changes in this
checkpoint.

---

## 12. What Checkpoint A explicitly does NOT do

- No checkout/order-flow rewrite (retail or wholesale).
- No public evaluation endpoint for shoppers (admin-only evaluate for
  verification; checkout wiring comes later).
- No SMS/email sending, no templates in Promotions.
- No supplier funding / settlement economics.
- No new executable pricing rules (benefit catalog is closed and small).
