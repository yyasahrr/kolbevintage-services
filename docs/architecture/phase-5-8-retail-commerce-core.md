# Phase 5.8 — Retail Commerce Core Backend

Status: Checkpoint A in progress. This document is the 5.8-A recon +
canonicalization record. It describes the audited current state, the
Checkpoint A target, and the explicit B/C/D + 5.9 boundaries. Nothing in
this phase redesigns the storefront or starts Phase 5.9.

Final Retail commerce flow (target):

```
Catalog -> Authoritative Retail Pricing -> Promotions -> Inventory
  -> Checkout -> Retail Order -> Payment -> Shipment -> Delivery
```

Non-negotiable channel rule: the Retail seller is Kolbe. Retail sells the
KOLBE Retail Catalog from KOLBE-owned Retail inventory. Wholesale is the
KOLBE + Supplier marketplace. A product being available wholesale never
makes it Retail-eligible; a Supplier offer never becomes a Retail offer.

## 1. Current Retail writer path (audited)

`POST /store/kolbe/retail/orders` in `frontend-next/server/kolbe-api.ts`
is the current Retail writer. Next.js is therefore still a Retail
business writer, which the target architecture forbids.

Current flow, in order:

1. Parse customer contact (`parseCustomerContact`: name required, Iranian
   mobile regex, optional email) and delivery address
   (`parseDeliveryAddress`: province/city/address required; plaque, unit,
   postal (digits only), note optional).
2. Server-side pricing via `priceRetailOrder` (see section 2). Browser
   totals are ignored; browser unit prices are compared and flagged
   (`adjusted`).
3. One database transaction:
   - idempotency replay: `SELECT ... WHERE idempotency_key=$1` (global,
     NOT customer-scoped; same key + different payload today replays the
     old order instead of conflicting - real debt, fixed in section 8);
   - `INSERT INTO retail_order` (guest allowed: `customer_id` is
     `claims?.sub ?? null`, audit actor falls back to `"guest"`);
   - `INSERT INTO retail_order_item` per priced line (server-resolved
     name/sku/price snapshot);
   - legal gate: HTTP call to Nest `POST legal/retail/checkout-binding`
     (only when `KOLBE_RETAIL_LEGAL_GATE=enforce`; any failure rolls the
     order back - fail closed);
   - `appendAudit` (`retail_order.created`, totals + price-book version +
     legal mode/snapshot; no full address in the audit payload).
4. Response (frozen compatibility contract, see section 12).

## 2. Current Retail pricing authority (transitional debt)

`frontend-next/server/retail-pricing.ts` is the transitional authority:

- Price book built from hardcoded `storefront/data/catalog.ts`
  (`product.price` -> BigInt, per-product sizes/colours allowlists).
  An editable copy lives in the admin browser localStorage - explicitly
  NOT authority.
- `PRICE_BOOK_VERSION`: sha256 (truncated to 16 hex) over the sorted
  price book; stored per order.
- Shipping: `post` 59,000 / `pishtaz` 89,000 / `tipax` 145,000 IRR;
  free shipping when `payMethod === "cod"` OR `itemsTotal >= 3,000,000`
  (the COD-free-shipping coupling is deliberate per D19a: with COD-only
  the shipping revenue would be zero, so provider-backed methods stay
  selectable with honest `unpaid` status).
- Payment honesty (D19a): `paymentSettlementStatus` maps `cod ->
  pending_cod`, everything else -> `unpaid`; `paymentCollected` is always
  `false`; `requiresManualSettlement` is true for provider-backed
  methods (`gateway`, `installment`, `wallet`). No fake `pending_gateway`.
- Validation: non-empty cart (max 50 lines), quantity 1..100 per line,
  unknown product -> `PRODUCT_UNAVAILABLE`, unknown size -> reject,
  unknown colour / price mismatch -> `adjusted: true` (order still
  created at server price).

Checkpoint A target: this module stops being the pricing authority.
Canonical pricing moves to Nest `RetailPricingService`. The Next module
is reduced to translation helpers for the compat proxy, and
`priceRetailOrder` + the TS-catalog price book are deleted (no second
authority may survive).

## 3. retail_order / retail_order_item schema debt (audited)

Current `retail_order` columns: `id`, `order_code` (unique), nullable
`customer_id` (FK -> account_user, RESTRICT), `customer_name`, `phone`,
`email`, `lines` JSONB, `address` JSONB, `shipping_method`
(CHECK: post/pishtaz/tipax), `shipping_price` BIGINT, `pay_method` (CHECK:
gateway/installment/cod/wallet), `total_amount` BIGINT, `payment_status`
(CHECK: unpaid/pending_cod), free-text `fulfillment_status` (default
`'processing'`, zero readers in the repo), `items_total` BIGINT,
`currency` (CHECK, IRR), nullable `price_book_version`, nullable
`payment_method` (duplicate of `pay_method`, same CHECK), `amount_source`
(default `'server'`), `order_status` (CHECK = RETAIL_ORDER_STATUSES),
nullable `idempotency_key` (global UNIQUE), `created_at`, `updated_at`.

Current `retail_order_item` columns: `id`, `order_id` (FK -> retail_order,
RESTRICT), `product_id`, `sku`, `product_name`, nullable `colour`/`size`,
`quantity` (CHECK: non-negative - allows 0), `unit_price` BIGINT,
`line_total` BIGINT, nullable `image_url`. No variant reference, no
promotion columns.

Debt summary: no promotion attribution columns, no legal-evidence
reference, no request fingerprint, no optimistic-locking version, no
status-history table, unscoped idempotency replay, quantity CHECK allows
0, and a dead `fulfillment_status` column. Section 8 resolves every
field without dropping history.

## 4. Catalog truth (audited)

Canonical tables: `product` (id, sku, name, slug, owner_type
KOLBE/SUPPLIER, status, brand/category, counters) and `productVariant`
(id, productId, unique sku, attributes JSONB, status
draft/active/archived). Neither table carries a price. The Retail price
authority column is `seller_offer.retail_price` (nullable BIGINT, IRR)
on the KOLBE seller's offer for the product/variant.

- `CatalogService`: `assertRetailIsolation` (ownerType must be KOLBE),
  `getOrderEligibleProduct` (+executor), `getVariantForOrder`
  (+executor, product-mismatch guard), `listRetailProducts`,
  `searchProducts(query, channel)` with KOLBE-priority ranking.
- `OffersService.ensureSeller(type="KOLBE")` resolves-or-creates the
  canonical KOLBE `seller` row (`displayName: "Kolbe Vintage"`).
- Offer statuses: draft / pending_review / approved / published /
  suspended / archived. Retail eligibility requires an approved-or-
  published KOLBE offer with a non-null `retail_price`.

Checkpoint A target: Nest resolves every Retail line from
product + variant + KOLBE offer. Browser-submitted name/sku/price/size/
colour/image/eligibility are never authority; the browser submits
identifiers + quantity and the server resolves truth (section 8).

## 5. Retail isolation rules + KOLBE seller rule (audited)

Enforced today in read paths; Checkpoint A enforces them in the write
path too:

- Retail purchasable = `product.ownerType = 'KOLBE'` AND
  `product.status = 'published'` AND variant `status = 'active'` AND a
  live KOLBE `seller_offer` with `retail_price` set. Everything else
  (supplier products, drafts, suspended/archived, missing offer, NULL
  price) is rejected with explicit codes.
- The Retail seller is always the KOLBE seller row. A Supplier offer -
  even for a KOLBE product, even cheaper - can never satisfy a Retail
  line. `assertRetailIsolation` is the service-level gate; tests pin the
  negatives (wholesale-only product, supplier offer, archived product,
  variant/product mismatch).
- Inventory mirrors the rule: availability is read from
  `product_variant_inventory` for `(variantId, KOLBE sellerId)` only.
  Supplier stock rows never satisfy Retail, silently or otherwise.

## 6. Promotion integration seam (audited, Phase 5.7)

- `PromotionEvaluationService.evaluate`: pure-read evaluation,
  `channel: "RETAIL"`, actor `RETAIL_CUSTOMER`, lines carry
  server-resolved `unitPrice` (decimal-string BIGINT) +
  `priceBasis: { kind: "SERVER_RESOLVED", resolvedBy, reference }`.
  Today retail results are stamped
  `priceAuthority: "CALLER_ATTESTED_RETAIL_TRANSITION"` (hardcoded by
  channel in `resolveEvaluationRequest`) - the honest marker that
  Checkpoint A flips to `OWNER_RESOLVED` once `RetailPricingService` is
  the resolver.
- `PromotionUsageService.recordRedemption`: re-validates under
  `FOR UPDATE` locks (promotion, revision, coupon + usage increment),
  writes the full attribution snapshot (`evaluationVersion` + `termsHash`
  required). It runs its own transaction and takes no executor -
  Checkpoint A adds an optional executor parameter (additive, default
  path unchanged) so the Retail checkout transaction can own redemption
  atomically. The evaluate-to-record gap is safe because record
  re-checks caps under lock and fails closed, rolling the whole order
  back.
- `getOrderAttribution(orderRef)` reads snapshots back per order.

Checkout order is fixed: Base Retail Price -> PromotionEvaluationService
-> Final commercial totals -> Retail Order snapshot. The browser may
submit coupon codes only - never amounts, percentages, or trusted
promotion IDs.

## 7. Inventory reservation capability (audited)

- `product_variant_inventory(variantId, sellerId, on_hand, reserved)`
  with `reserved <= on_hand`; `inventory_reservation` with
  `createReservation` / `releaseReservation` / `confirmReservation`,
  idempotent claims (`command_idempotency`), executor support, and an
  expiry reaper (`releaseExpiredReservations`).
- Constraint: `inventory_reservation.order_id` / `order_item_id` FK to
  wholesale tables, and `request_id` FKs to `wholesale_request`. Retail
  therefore links reservations via the free-text `allocationId`
  (= retail order id, documented convention), never via the wholesale
  FK columns. No inventory schema change is needed in Checkpoint A.
- Checkpoint A implements: KOLBE-seller availability check (fail closed
  on insufficient stock) + `createReservation` inside the checkout
  transaction (idempotent on the order key, TTL-bounded). Confirm-on-
  payment/shipment and release-on-cancel are Checkpoint B lifecycle
  work; the existing expiry reaper is the safety net. Retail never
  UPDATEs inventory tables directly and never keeps stock counters.

## 8. Checkpoint A canonical design (target)

Owner. Orders owns both aggregates. `retail_order`,
`retail_order_item`, and the new `retail_order_event` move from the
`checkout` registry entry (status `planned`, retired) to `orders`;
`RetailOrdersService` / `RetailOrdersRepository` /
`RetailOrdersController` live under `apps/api/src/modules/orders/`
(`retail/` submodule). No second retail data layer.

Legacy field classification (A3). KEEP: id, order_code, customer_id,
customer_name/phone/email (contact snapshot), shipping_method,
shipping_price (= shipping total), pay_method (= payment intent),
total_amount (= grand total, analytics GMV preserved),
payment_status (honest unpaid/pending_cod), items_total (= base items
subtotal), currency, price_book_version (now the Retail pricing
authority version), amount_source ('server'), order_status, global
idempotency_key (+ service-level same-customer + same-hash replay
check), created_at/updated_at; item id/order_id/product_id/sku/
product_name/colour/size/quantity/unit_price (= base unit)/
line_total (= FINAL line total)/image_url. NORMALIZE: `address` JSONB
(same shape, strict typed writer). DEPRECATE (freeze, keep writing for
rollback safety, no new readers): `lines` JSONB,
`fulfillment_status` ('processing'), `payment_method` (= pay_method).
ADD: `promotion_discount_total` (BIGINT, default 0),
`legal_snapshot_id` (nullable), `creation_request_hash` (nullable),
`version` (int, optimistic locking, default 0); item `variant_id`
(nullable - legacy rows keep truthful NULL), `base_line_total`,
`promotion_discount`. Backfill: `base_line_total = line_total`,
`promotion_discount = 0` (legacy had no promotions, so base == final
is provable, not manufactured); totals equation CHECKs cover all rows.

Pricing (A5). `RetailPricingService`: resolves lines from Catalog +
KOLBE offer `retail_price` (BIGINT, deterministic), emits a pricing
authority version (hash over resolved unit prices + shipping rules),
never trusts browser money, never recomputes history. Shipping rules
(methods/prices/threshold/COD-free) move verbatim into a versioned Nest
table documented as transitional until Shipping owns retail quotes
(Checkpoint C). Wholesale `PricingService` semantics untouched.

Order creation (A17). `POST /api/v1/retail/orders` (session:
`customer`/`vip`; guests only via the compat proxy + internal token,
section 12; `customer_id` NULL for guests, contact snapshot preserved):
authenticate -> validate identifiers -> resolve Catalog -> resolve base
price -> evaluate Promotions -> validate address -> bind Compliance
(in-process, same tx) -> check + reserve Inventory (same tx) -> insert
immutable order/item snapshot -> recordRedemption (same tx, shared
executor) -> status-history event + `order_event` fact + audit (same
tx) -> idempotent response. `GET /api/v1/retail/orders/:id` is
customer-scoped (owner or admin only).

Idempotency (A8). `Idempotency-Key` required. Same key + same
normalized hash -> replay same order. Same key + different payload ->
409 conflict. Same key + different customer -> 409. No duplicate
order/coupon usage/reservation on retry (all three keyed/claimed in
the one transaction).

State machine (A12). Adopt `RETAIL_ORDER_STATUSES` +
`RETAIL_ORDER_TRANSITIONS` from `@kolbe/shared` unchanged
(placed -> confirmed -> packed -> shipped -> delivered;
cancelled/returned terminals). New orders start `placed`. Order state
never implies payment or shipment state. History: new
`retail_order_event` table generalizing the `order_status_history`
pattern (the wholesale table FKs to `wholesale_order`, so reuse is
impossible); `order_event` carries the `retail_order.created` fact.

Total equations (A20, DB CHECKs + service).
`promotion_discount_total >= 0 AND <= items_total`;
`total_amount = items_total - promotion_discount_total + shipping_price`;
per item `base_line_total = unit_price * quantity` and
`line_total = base_line_total - promotion_discount`; quantity > 0 is
service-enforced (the legacy `non_negative` CHECK stays so no
historical row can block migration); all money BIGINT within MAX_MONEY.

## 9. Payment capabilities already implemented (audited)

Payments is wholesale-shaped: proforma issue/void/supersede, online
intent (`createOnlinePaymentIntent`), manual transfer submit/verify/
reject, COD release, refunds, allocation/coverage accounting. Provider
registry: `manual` default, `fake` allowed only in non-production;
no real gateway provider exists. There is no retail payment-intent
model.

Checkpoint A boundary (A15): Retail creates NO payment rows and NO
fake success. It stores payment-method intent + the honest status
(`cod -> pending_cod`, else `unpaid`, logic moved to Nest verbatim)
and derives `requiresManualSettlement`. COD is never conflated with
collected payment. Provider orchestration is Checkpoint B.

## 10. Shipping capabilities already implemented (audited)

Shipping is wholesale-child-shaped: quotes per child order, shipment
create/transition/tracking per wholesale order, provider registry.
Zero retail references. Checkpoint A creates no shipment rows and
wires no carrier; the documented retail integration shape is:
retail order -> (Checkpoint C) retail shipment aggregate referencing
the immutable order snapshot + a Shipping-owned retail quote.
Until then, shipping totals come from the transitional versioned
table in Nest (section 8), with rules byte-identical to the legacy
ones.

## 11. Compliance legal checkout binding (audited)

`ComplianceService.bindRetailCheckout(input, executor?)` is the
in-process gate: requires the published RETAIL policy bundle versions
(claimed ids must match Nest-published documents; browser can never
self-assert acceptance), builds the pre-contract disclosure, records
acceptances + a `transaction_compliance_snapshot` keyed by
`retailOrderRef` (= order code). Mode comes from
`KOLBE_RETAIL_LEGAL_GATE` (`off` default / `enforce`), checked by the
caller; `KOLBE_RETAIL_DISCLOSURE_STRICT=1` optionally hardens
disclosure gaps. Current Next flow calls it over HTTP
(`legal/retail/checkout-binding`, public route + `x-kolbe-internal-
token`); Checkpoint A calls it in-process inside the checkout
transaction. Enforce-mode failure (rejection, outage, malformed
response) fails closed - no order row survives. The resulting
snapshot id is stored on `retail_order.legal_snapshot_id`.

## 12. Current frontend compatibility contract (audited)

Request (`POST /store/kolbe/retail/orders`, header `idempotency-key`
optional client-generated `rt-<ts>-<rand>`): `customer{name,phone,
email}`, `lines[{id,name,colour,size,price,qty,img}]` (only `id`+`qty`
are authority inputs; the rest are display hints), `address{province,
city,address,plaque,unit,postal,note}`, `shipping{id,...}`,
`payMethod`, `totals` (browser-computed, ALWAYS ignored),
`acceptedPolicyDocumentIds` (optional; the current Checkout UI does not
send it, so enforce-mode gates fail closed until the UI presents
policies - unchanged behavior).

Response (frozen): `{orderCode, status, replayed, currency: "IRR",
totals: {items, shipping, total} (Numbers), adjusted,
payment: {method, status, collected: false, requiresManualSettlement}}`;
201 on create, 200 on replay; legacy 422 codes for validation failures.

Checkpoint A compat strategy (A18, transitional - NOT the Phase 6
cutover): the Next handler becomes a proxy. It translates the legacy
body to the Nest DTO, forwards cookie + idempotency key + internal
token via the existing `forwardToNest` helper, and translates the Nest
response/error back to the legacy shape. After cutover, `kolbe-api.ts`
MUST NOT INSERT/UPDATE `retail_order`/`retail_order_item` for new
orders. No visual change; no UI file touched. Guest checkout keeps
working through the proxy (Nest accepts proxied guest contact with a
valid internal token and NULL customer_id); direct anonymous Nest calls
stay 401. Frontend tests are re-homed: proxy translation stays in
`frontend-next/test` (fetch-mocked, real DB asserting no local writes
+ exact legacy shape); row-level assertions move to the canonical Nest
suites (relocation, not weakening).

## 13. Target writer ownership (Checkpoint A)

```
Browser -> Next.js compat proxy -> NestJS RetailOrdersService
  -> PostgreSQL (retail_order / retail_order_item / retail_order_event)
```

Orders is the single canonical owner of both Retail and Wholesale
aggregates with explicit service separation. The `checkout` registry
entry is retired; `retail_order*` tables move to `orders` with
`dependsOn` extended by `promotions`, `compliance`, and `payments`
(read-only intent constants - no payment writes in A).

## 14. Later Phase 5.9 boundaries (explicit non-goals)

Phase 5.9 owns: persistent customer address-book management (5.8 only
snapshots), customer accounts/profiles, wishlist, product reviews,
search experience, returns/RMA + after-sales flows, guest-to-account
order linking, and any storefront visual evolution. Phase 5.8 MUST NOT
create address-book tables, review tables, wishlist tables, or account
mutations - the checkout snapshot + account FK are the only identity
touchpoints.

## 15. Deferred Checkpoint B/C/D items (Checkpoint A exit)

- B: inventory confirm/release lifecycle (payment/shipment/cancel
  hooks) + expiry-reaper scheduling; retail payment orchestration
  (provider-backed intents, manual settlement flow, COD collection
  evidence); notification relay mapping for retail events.
- C: retail shipment aggregate + Shipping-owned retail quotes;
  tracking/delivery lifecycle; transitional Nest shipping table
  retired.
- D: admin retail operations surface (confirm/pack/ship/cancel with
  maker/checker where justified); retail analytics metric versioning
  if new columns change semantics; guest coupon-abuse hardening
  (guest actorRef is per-order in A - rate/cap policy is B/C work).
- Cross-cutting: quantity positivity CHECK at DB level (service-
  enforced in A); `lines`/`payment_method`/`fulfillment_status`
  column removal (REMOVE-LATER, only after the compat proxy is gone).

## 16. Checkpoint A as-built (filled at A26)

**Writer ownership (A1/A17).** The single canonical Retail writer is
`RetailOrdersService.createRetailOrder`
(`apps/api/src/modules/orders/retail/retail-orders.service.ts`), housed in
the bounded `RetailOrdersModule` (`orders/retail/retail-orders.module.ts`)
so wholesale `OrdersModule` keeps its shape and no
Orders→Promotions→Recovery→Shipping→Orders cycle is introduced. Routes
are `POST /api/v1/retail/orders` (201 create, 200 customer-scoped replay)
and `GET /api/v1/retail/orders/:id`
(`orders/retail/retail-orders.controller.ts`). Dual-auth guard
(`orders/retail/retail-checkout.guard.ts`): customer/vip session OR
internal token + guest actor; admin/supplier sessions are rejected.

**Pricing (A4/A5).** `RetailPricingService`
(`apps/api/src/modules/pricing/retail-pricing.service.ts`) resolves every
line from the canonical Catalog (KOLBE seller only, strict variant
resolution — no size-only fallback, no colour guessing) and computes
BIGINT totals in-process. Browser money is never forwarded and never
trusted (`presentedUnitPrice` is a display hint for the `adjusted` flag
only). Shipping in A is the transitional `RETAIL_SHIPPING_RULES` table
(byte-identical to legacy, COD ⇒ free); Shipping-module quotes and the
shipment aggregate are Checkpoint C work.

**Schema (A2/A3/A19/A20).** Migration
`0033_phase_5_8_retail_commerce_core.sql` (0000–0032 frozen) adds the
canonical order columns (immutable BIGINT `items_total` /
`promotion_discount_total` / `shipping_total` / `total_amount`,
`order_status`, `price_book_version`, `legal_snapshot_id`,
`creation_request_hash`, `version`), the item variant/base/discount
columns, and `retail_order_event`. The totals equation
(`total = items − promo + shipping`, discount ≤ items) is a DB CHECK on
both tables. Legacy classification: `lines` / `payment_method` /
`fulfillment_status` columns are REMOVE-LATER (kept until the compat
proxy is gone); nothing was blind-dropped.

**Promotions (A6/A7).** Checkout evaluates the Phase 5.7 engine at
product level (no `variantId` on retail lines) and records redemption
**in the same transaction** (`PromotionUsageService.recordRedemption`,
idempotency `${key}:redeem:${promotionId}`) — a coupon failure voids the
order and an order failure consumes nothing (closes the deferred 5.7
item). ORDER-scope discounts live at order level (line discounts stay
`0` by 5.7 semantics). An exhausted coupon fails closed: `409
PROMOTION_COUPON_EXHAUSTED` with full rollback.

**Keys / identity / address / legal (A8–A11).** Idempotency keys are
customer-scoped with an advisory lock and race resolution
(`RETAIL_IDEMPOTENCY_CONFLICT` on key reuse across owners). No invented
guest checkout: guests authenticate via the internal-token path with a
system-principal inventory requester (satisfies the
`inventory_reservation.created_by` FK). Addresses are typed snapshots on
the order. The compliance gate binds in-transaction
(`ComplianceService.bindRetailCheckout`, gate mode + snapshot id on the
order and audit row); any rejection/outage rolls back (fail closed).

**State machine / events / audit (A12/A13/A21).** Transitions live in
`packages/shared/src/order-status.ts`: placed→confirmed/cancelled,
confirmed→packed/cancelled, packed→shipped/cancelled,
shipped→delivered, delivered→returned; every transition appends a
versioned `retail_order_event` row plus a
`retail_order.status_changed` audit row. Checkout additionally emits the
cross-aggregate `retail_order.created` event and audit row. Analytics
stays read-only; notifications are not wired (Checkpoint B mapping).

**Inventory / payment / shipping contracts (A14–A16, foundation
only).** Each line is availability-checked against KOLBE stock
(`RETAIL_INSUFFICIENT_STOCK` otherwise) and reserved in-transaction via
`InventoryService.reserveRetail` with a TTL; `releaseRetail` /
`confirmRetail` wrappers exist but are uncalled in A (the expiry reaper
is the safety net). Payment is an honesty-only block: `cod` ⇒
`pending_cod`, anything else ⇒ `unpaid`, always `collected: false` —
no provider, no intent, no fake success. No shipment rows are created.

**Compat proxy (A18/A25).** `POST /store/kolbe/retail/orders` is
proxy-only: translate legacy body → `forwardToNest` (cookie + key +
internal token) → translate back to the frozen legacy shape
(`frontend-next/server/kolbe-api.ts`, `retail-pricing.ts` now
translation-only — `priceRetailOrder`, the TS price book, settlement
helpers and parsers deleted). A static test pins zero
`retail_order(_item)` references outside comments in the compat server.

**Coverage (A24).** 90 tests: Nest pricing 12 / promotions 9 / order 20
/ security 8, DB migration 4, Next checkout 14 / legal-gate 5 /
payment-honesty 7 / proxy 11 (incl. the static no-touch pin).

**Debts carried into B/C/D** (§15): `seller_offer.retail_price` has no
DB range CHECK; quantity positivity is service-enforced; REMOVE-LATER
columns stay; no release/confirm lifecycle or reaper scheduling yet; no
payment orchestration; no shipment aggregate; no admin retail surface;
guest coupon-abuse hardening is per-order only.
