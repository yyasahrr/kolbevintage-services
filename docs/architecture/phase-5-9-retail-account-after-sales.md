# Phase 5.9 — Retail Customer Account & After-sales Backend

## 1. Authority map (recon, Checkpoint A)

**Auth is the identity authority.** `account_user` (owned by the
`auth` module: `account_user`, `login_attempt`, `user_session`)
carries `email` (unique, login identity), `passwordHash`/`salt`,
`role`, `display_name`, `phone`, `status`, `tokenVersion`, and the
TOTP/security fields. Login is email-only; TOTP is
authenticator-secret based; the repository contains no
phone-based login, no SMS OTP, and no account-recovery flow.
Consequences for 5.9:

- `phone` participates in NO auth/security decision — it is safe
  for customer mutation with Iranian-mobile validation. Email
  stays read-only: no verified-email-change flow exists, and none
  is introduced casually.
- `role`, `status`, `tokenVersion`, password/TOTP fields are
  never customer-writable. The account update path is a strict
  whitelist (`displayName`, `phone`); anything else in the body
  is ignored, never applied.
- Profile writes go through `AuthService` (the table owner).
  The customer-account module names no auth tables; it delegates.

**CRM is NOT identity.** `crm_contact` +
`crm_contact_identity_link` (link types incl. `account_user`)
are the sales/360 overlay. 5.9 creates no contact/customer
identity store and links nothing new into CRM; the 360 service
keeps working on `user_id` as before.

**Orders own commerce truth.** `RetailOrdersService`
(`apps/api/src/modules/orders/retail/`) stays the single retail
writer: orders, items, events, payment rows (via Payments),
shipments (via Shipping). 5.9 reads commerce through its public
service surface (`getRetailOrder`, `getRetailShipment`, new
customer-scoped list / guest-capability resolution) and writes
nothing into `retail_*`, `payment*`, `shipment*`, or
`inventory_*` from customer-account code.

**Support owns conversation.** `support_case` + relations,
messages, notes, attachments, SLA, escalations. After-sales
(Checkpoint B) links via `SupportCaseService.addRelation` on
`support_case_relation`; it never builds tickets/chat.

**Notifications owns delivery.** Domains emit facts; the
dispatcher delivers best-effort and its failure never rolls back
commerce. 5.9-C facts (`return requested/approved/rejected`,
`refund requested/completed`) follow the retail-relay pattern.

**Compliance owns legal truth.** `legal_policy_document`
(versioned, immutable after publish) already reserves the
`RETAIL_RETURN_POLICY` type; checkout binds
`acceptedPolicyDocumentIds` and snapshots. Return windows (B5)
are configured policy, never hardcoded legal claims.

## 2. Customer account authority (Checkpoint A)

New bounded context `apps/api/src/modules/customer-account/`
(registered in `registry.ts`, leaf off `app.module`):

- `CustomerAccountService` — own profile read/update (delegates
  to `AuthService`).
- `CustomerAddressService` — owns `customer_address` (the only
  writer, enforced by registry + tests).
- `CustomerOrderHistoryService` — own order list/detail,
  aggregating the retail order view + shipment read model.
  Duplicates no commerce tables.
- `GuestOrderAccessService` — guest capability verification
  policy + operation scoping.

Routes (all under `/api/v1/customer`, session roles
`customer`/`vip` unless noted):

- `GET /account`, `PATCH /account` — own profile.
- `GET /addresses`, `POST /addresses`, `PATCH /addresses/:id`,
  `POST /addresses/:id/make-default`, `DELETE /addresses/:id`
  (archive, never destroy).
- `GET /orders` (cursor pagination), `GET /orders/:id`
  (order view + shipments).
- `GET /guest/orders/by-code/:orderCode` (`@Public` +
  capability guard, `X-Retail-Order-Token` header) — guest
  detail only.

Admins keep the existing retail operational reads; the
customer self-endpoints are strictly self-scoped (admin token →
403), and guests reach exactly one order via its capability.

## 3. Address ownership (Checkpoint A)

`customer_address`: `id`, `user_id` (server-derived from the
session, FK `account_user` restrict), `label`,
`recipient_name`, `recipient_phone`, `province`, `city`,
`address_line`, `plaque`, `unit`, `postal_code`, `is_default`,
`archived_at`, `created_at`, `updated_at`, `version`. No JSON
blob authority; every field is typed; free text is sanitized
(angle brackets stripped, same rule as retail contact fields).

- Exactly one active default per user, enforced by a partial
  unique index (`user_id WHERE is_default AND archived_at IS
  NULL`); default switches serialize on a per-user advisory
  lock (last-writer-wins, never two defaults).
- Edits carry optimistic `version` (`expectedVersion` →
  conflict on mismatch).
- Archive is soft: referenced history is untouched, and past
  retail orders keep their immutable address snapshots forever
  (editing a saved address never rewrites an order snapshot —
  pinned by test).

## 4. Guest capability model (Checkpoint A)

Phase 5.8 deferred guest capabilities; 5.9 resolves them without
any enumerable fallback:

- At NEW guest-order creation (and only there), Nest mints an
  opaque high-entropy token (`rgc_` + 128 bits, base64url),
  stores **SHA-256 hash only** (`guest_capability_hash`) with
  `guest_capability_issued_at`, and returns the plaintext
  **once** in the creation response (`guestCapability`). The
  plaintext is never persisted, never logged, never
  re-emitted: idempotent replays omit it (already delivered),
  and reads never include it.
- Guest APIs require the order code plus the secret in the
  `X-Retail-Order-Token` header (never query string).
  Verification is constant-time against the stored hash.
  `orderCode + phone` alone authenticates nothing.
- Legacy guest orders (NULL hash) receive NO fabricated
  secret: they resolve to an honest support/manual recovery
  path. Revocation clears the hash (with `revoked_at` kept for
  audit).
- Compat path: the frozen legacy body is byte-identical; the
  proxy echoes a Nest-issued capability as the
  `X-Retail-Order-Token` response header.

Capability scope in A is read-only (own order detail). B
extends the same capability to explicitly granted
cancel/return commands; the capability never grants
account/profile access.

## 5. After-sales future flow (Checkpoints B/C)

- **B — cancellation + returns.** Customer cancel commands
  gated on authoritative order/payment/shipment state
  (idempotent; paid cancel creates a truthful refund-required
  state; post-handoff cancel routes to returns). First-class
  `retail_return_request` / `retail_return_item` /
  `retail_return_event` with an explicit transition graph;
  received ≠ inspected ≠ restocked; restock calls the
  Inventory owner exactly once and only for justified
  `RESTOCKABLE` decisions. Staff seam is service-level only
  (no Admin UI; Phase 5.11 owns that).
- **C — retail refunds.** Evolve the generic `refund` model to
  exactly one order side (`wholesale_order_id` XOR
  `retail_order_id`, same for lines) — no second financial
  engine. Refund basis is immutable paid commercial truth
  (post-promotion line totals); only collected/verified money
  refunds; no live provider is claimed; fake stays banned in
  production. Wholesale regression must be zero.

## 6. Checkpoint A as-built (filled at A-commit)

### A1 locks carried into code
- Profile reads/writes delegate to `AuthService` (single writer of
  `account_user`); history and guest detail delegate to
  `RetailOrdersService` (single reader of commerce); `customer-account`
  owns only `customer_address` (registry + module-boundaries updated).
- Guest capability: `rgc_` + 128-bit base64url, SHA-256 hash-only
  storage + issued/revoked timestamps; plaintext crosses the wire
  exactly once (fresh guest creation, JSON body Nest-side, echoed as
  `X-Retail-Order-Token` by the Next proxy with the legacy body
  byte-identical); constant-time verify; legacy NULL-hash rows resolve
  to `RETAIL_GUEST_CAPABILITY_REQUIRED` (support recovery, no
  fabrication); revocation is a staff service seam (no HTTP in A).
- Address book: typed columns (`recipient_phone`, `address_line`,
  `plaque`, `unit`, normalized `postal_code`), server-derived
  `user_id`, `<>` sanitization, partial unique
  `customer_address_single_default`, advisory-locked default switches
  with 23505→409 translation, optimistic `version` (409 on stale),
  soft archive (default never auto-promoted), cap 20/customer.
- History: keyset cursor `(created_at DESC, id DESC)`, limit 1–100
  default 20, opaque base64url cursor failing closed; detail merges
  `getRetailOrder` + `getRetailShipment` (ownership enforced before
  shipments are touched).

### Deviations from §§1–5 (with reason)
- `customer_address.label` is nullable in DDL but the service always
  writes a label (default `"آدرس"`); reads coalesce defensively.
- `getRetailShipment` was refactored to a shared private
  `presentRetailShipments` so guest detail reuses the exact session
  mapping (no forked presenter); ownership stays in the callers.
- The guest guard's missing-header error is
  `RETAIL_GUEST_CAPABILITY_MISSING` (401), distinct from a wrong
  secret (`RETAIL_GUEST_CAPABILITY_INVALID`, 403).
- COD orders carry `shippingTotal "0"` (free COD shipment rule,
  pre-existing 5.8 behavior the guest test pins).

### A9 gates (all green, 1438/1438 total)
- NEW `packages/database/test/phase-5-9-a-migration.test.ts` (4),
  NEW `apps/api/test/phase-5-9-a-customer-account.test.ts` (9),
  NEW `apps/api/test/phase-5-9-a-guest-capability.test.ts` (4),
  NEW `frontend-next/test/phase-5-9-a-retail-capability-proxy.test.ts` (2).
- Count-only updates (no weakening): 194→195 tables in three suites,
  journal 37→38 entries / idx 37 in the 5.7 promotions suite.
- `typecheck:all` clean; `clean-migration` + `state-constraints` 22/22.

## 7. Checkpoint B design (cancel evolution + returns + support link)

### B0 scope locks
- Customer cancel: one evolved seam (`cancelRetailOrder`), new HTTP
  `POST /customer/orders/:id/cancel`. Guests stay read-only in B
  (capability = read; state-changing guest flows go through support
  recovery — deliberate, revisited only if 5.10+ demands it).
- Returns: first-class `retail_return_request` / `retail_return_item` /
  `retail_return_event` (migration 0038), owned by the orders module
  (retail slice); customer HTTP files/withdraws/lists through a
  `customer-account` façade; staff transitions are service-level only
  (no Admin UI — Phase 5.11 owns that surface).
- Support link: every filed return opens a `RETURN`-category support
  case (`RETAIL_CUSTOMER` requester) with `ORDER` + `ORDER_ITEM`
  relations; the request stores `support_case_id` as a LOOSE
  cross-module pointer (no FK — support owns its lifecycle; returns
  must survive case archival). No CHECK evolution needed
  (`RETURN` category and both relation types already exist).
- No return window in B: gates are delivered state + quantity math
  only. A window without a config surface would be an invented rule;
  deferred until policy config exists. Documented, not forgotten.

### B1 cancel evolution (old → new, per state)
| Order state | 5.8 behavior | B behavior |
|---|---|---|
| already `cancelled` | `RETAIL_TRANSITION_INVALID` | idempotent 200, view returned, zero side effects |
| paid, pre-handoff | `RETAIL_CANCEL_PAID_FORBIDDEN` | 200 `cancelled` + `payment.refundPending: true`; money untouched (payment row still verified); `retail_order.cancelled` event carries `refund_pending: true`; actual refund is Checkpoint C |
| unpaid, pre-handoff | 200 `cancelled` | unchanged (event now always carries explicit `refund_pending: false`) |
| `handed_over` / `in_transit` | `RETAIL_CANCEL_SHIPMENT_IN_PROGRESS` | UNCHANGED (freight in motion: neither cancellable nor returnable — honest wait) |
| `delivered` | `RETAIL_CANCEL_SHIPMENT_IN_PROGRESS` (shared branch) | SPLIT: new `RETAIL_CANCEL_ROUTES_TO_RETURN` (409) — the client files a return instead |
| `returned` | `RETAIL_TRANSITION_INVALID` | unchanged |

- The 5-8-d D6.6 pin (`handed_over` → `SHIPMENT_IN_PROGRESS`) stays
  green untouched. The two paid-cancel pins (5-8-b "refuses to cancel
  paid or already-cancelled orders", 5-8-c C23) are REPLACED in place
  with strictly stronger coverage (assertion map in §8):
  cancel-paid-succeeds + refundPending + money-untouched + audit/event
  payload + recancel-idempotent-with-zero-side-effects.
- `payment.refundPending` is additive on the Nest view only; the Next
  legacy translator maps fields explicitly so the frozen browser body
  cannot leak it. The 8 pre-existing `payment).toEqual` pins gain
  `refundPending: false` (all non-cancelled orders).

### B2 return aggregate
- Statuses: `REQUESTED → APPROVED → RECEIVED → INSPECTED →
  RESTOCKED`, with `REJECTED` from REQUESTED/APPROVED/INSPECTED and
  customer-only `WITHDRAWN` from REQUESTED/APPROVED. Terminal:
  RESTOCKED / REJECTED / WITHDRAWN.
- `received ≠ inspected ≠ restocked`: RECEIVED records parcel arrival;
  INSPECTED records a mandatory inspection decision
  (`RESTOCKABLE | DAMAGED | INCOMPLETE | NOT_AS_DESCRIBED`);
  RESTOCKED requires decision `RESTOCKABLE`, restocks each line qty
  through the Inventory owner exactly once
  (idempotency `${returnId}:restock:${itemId}`), and transitions the
  order `delivered → returned` (skipped if a sibling return already
  did — partial returns stay truthful in return detail).
- Filing gates: order must be `delivered` (pre-handoff → "cancel
  instead"; in-transit → wait; cancelled/returned → invalid); lines
  non-empty, each `order_item_id` in-order, qty ≥ 1; per-line
  `requested ≤ delivered − active-requested` where delivered =
  Σ pieceQuantity over `delivered` shipments and active-requested =
  Σ over non-terminal (non-REJECTED/WITHDRAWN) returns. Same-code
  rejection for foreign item ids (no cross-order oracle).
- Staff transitions require staff actor; REJECTED requires a reason;
  every transition is versioned + evented + audited.

### B3 registry / module treatment
- The 3 return tables join the coarse `orders` tables list (retail
  slice). The `RetailOrdersModule → SupportModule` Nest edge follows
  the 5.8 precedent comment (promotions/payments/notifications/
  shipping): deliberately NOT in coarse `dependsOn` (would assert a
  false cycle); `createCase` gains an additive optional executor so
  return + case commit atomically; SLA snapshot stays post-commit
  (same atomicity as the existing customer filing flow).

### B4 test plan
- NEW `packages/database/test/phase-5-9-b-migration.test.ts` (0038
  shape: tables/CHECKs/FKs/unique/indexes).
- NEW `apps/api/test/phase-5-9-b-retail-returns.test.ts`: cancel HTTP
  matrix (paid→refundPending + money untouched, recancel idempotent,
  delivered→routes-to-return, in-transit intact), return lifecycle
  (file→approve→receive→inspect→restock with order→returned +
  single restock proof; reject-with-reason; withdraw; ownership;
  qty-math over-delivery rejection; partial + second-return
  truthfulness; support case + relations + SLA linkage).
- Count-only updates: 195→198 tables, journal 38→39 entries / idx 38.

## 8. Checkpoint B as-built (cancel evolution + returns + support link)

### B1 implementation record
- Migration 0038: `retail_return_request` / `retail_return_item` /
  `retail_return_event` (198 tables, journal idx 38). CHECK-typed
  status/reason/decision, FKs `restrict`, unique
  (return_id, order_item_id) + (return_id, return_version), positive
  quantity. `support_case_id` is a loose pointer (no FK — §7 B0).
- Cancel evolution per the §7 table: idempotent recancel; paid
  pre-handoff → `cancelled` + `payment.refundPending` with money
  untouched + `retail_order.cancelled{refund_pending}` +
  `retail_order.cancel_pending_refund` audit; delivered →
  `RETAIL_CANCEL_ROUTES_TO_RETURN`; in-transit intact;
  `RETAIL_CANCEL_PAID_FORBIDDEN` retired (kept in the status map as a
  dead arm documenting its 409, thrown nowhere).
- Returns: `RetailReturnsService` (orders-owned) + `CustomerReturnService`
  façade + 5 HTTP routes (file/list/detail/withdraw/cancel are all under
  `/customer`, buyer roles, guests read-only per §7 B0). Support case
  opens in the filing transaction (`createCase` + optional executor);
  SLA snapshots post-commit with audited deferral on failure.
- One §7 refinement (found by test, recorded here): filing accepts
  `delivered` AND `returned` orders — `returned` means "has a completed
  return", and sibling filings for still-unreturned units are guarded
  by the per-line math, not the coarse status.

### B2 replaced pins (standing-invariant map, all in-place, zero deletions)
1. 5-8-b "refuses to cancel paid or already-cancelled orders" →
   "5.9-B: paid cancel lands refund-pending…" — old assertions (paid→
   409; recancel→409) replaced by: paid cancel 200 + refundPending +
   byte-identical payment rows + `refund_pending:true` fact +
   recancel 200 with zero new facts/stock movement + G5 same.
2. 5-8-c C23 "refuses paid cancel without money movement" → "C23
   (5.9-B) accepts paid cancel into refund-pending…" — the core
   "without money movement" assertions (1 payment, verified) are
   PRESERVED verbatim and strengthened (before/after identical,
   refund_pending fact, pending-refund audit).
3. 5-8-c C22 recancel `TRANSITION_INVALID` → idempotent success; all
   stability assertions (single fact, shipment cancelled, stock
   stable) preserved verbatim.
4. 5-8-d D7.6 concurrent cancels [fulfilled, rejected] → [fulfilled,
   fulfilled]; single-cancel/single-release/shelf-restored assertions
   preserved verbatim.
5. D10.7 static guard EXTENDED (not weakened): the returns file's 3
   mutators must each call a return gate (withdraw's inline check was
   extracted to `assertReturnCustomer` for scanability).
6. Untouched-and-green pins proving no regression: 5-8-d D6.6
   (`handed_over` → `SHIPMENT_IN_PROGRESS`), 5-8-d-security X2
   (foreign cancel → `FORBIDDEN`), all 8 `payment).toEqual` pins
   (each gained `refundPending: false`, all non-cancelled).
- Net: zero files deleted, zero assertions weakened; every retired
  rejection is replaced by end-to-end coverage of the accepted path
  with money-safety + idempotency proofs.

### B3 gates
- NEW `packages/database/test/phase-5-9-b-migration.test.ts` (4),
  NEW `apps/api/test/phase-5-9-b-retail-returns.test.ts` (11).
- Count-only updates: 195→198 tables (3 suites), journal 38→39/idx 38.
- `typecheck:all` clean; full `test:all` **1453/1453** green
  (23 shared + 123 database + 1152 api + 155 frontend).

## 9. Checkpoint C design (retail refunds on the generic engine)

### C0 scope locks
- ONE engine: the payments-owned `refund` / `refund_allocation` /
  `refund_line` tables + the `requested → approved → processing →
  completed` machine grow a retail side. No second refund model, no
  live provider claim, fake stays banned in production (refunds
  complete only on real external evidence, as today).
- Service seam only (staff file/approve/complete; no Admin UI — 5.11;
  no new customer HTTP in C). The one customer-visible change: the B
  `refundPending` flag resolves truthfully as refunds complete.
- Wholesale regression zero by construction (wholesale writer paths
  stay byte-identical; every C branch is side-conditional) + by proof
  (full suite green, wholesale finance suites untouched).

### C1 schema evolution (migration 0039, ALTERs only, zero new tables)
- `refund`: +`retail_order_id` nullable; `wholesale_order_id` →
  nullable (existing rows all valued); CHECK
  `refund_single_order_side` (boolean-XOR on IS NULL); FK
  `refund_retail_order_fk` → retail_order restrict; partial unique
  `refund_retail_order_idempotency_unique(retail_order_id,
  idempotency_key)`; index `refund_retail_order_created`. The old
  wholesale partial unique is untouched (NULL wholesale sides never
  collide under PG NULL semantics).
- `refund_line`: +`retail_order_item_id` nullable;
  `wholesale_order_item_id` → nullable; CHECK
  `refund_line_single_item_side`; FK → retail_order_item restrict;
  partial unique `refund_line_refund_retail_item_unique(refund_id,
  retail_order_item_id)`. Old wholesale unique untouched (same NULL
  argument).
- `financial_ledger_entry`: +`retail_order_id` nullable; `order_id` →
  nullable; CHECK `financial_ledger_single_order_side`; FK → retail
  order restrict; index. Rationale: the completion OUT is part of the
  refund; a retail OUT that must cite a wholesale FK would lie.
- `order_event`: CHECK evolution (DROP + re-ADD, the 5.8 precedent)
  appending `retail_order.refund_requested` /
  `retail_order.refund_completed` facts.

### C2 retail creation rules (new `createRetailRefund`, wholesale method untouched)
- Actors admin/finance; locks verified retail payments (`FOR UPDATE`).
- Basis = immutable `retail_order_item`: stored line rows carry
  (item, units, unitPrice=line.unit_price, lineTotal=unit×units) —
  integral by construction, CHECK-safe. Units guard per line
  (refunded units across live refunds ≤ ordered units).
- Amount honesty (the honesty window — recon correction: the first
  draft assumed per-line nets are stored; they are NOT for ORDER-scope
  promos, which live only at order level while `line_total` keeps the
  gross). Staff asserts the post-promotion header amount; the service
  requires `lower ≤ amount ≤ upper` with
  `lower = lineFloor − orderLevelDiscount` and
  `upper = lineCeil − (coversAll ? orderLevelDiscount : 0)`,
  where `lineFloor/lineCeil` are the per-line floored/ceiled unit
  pro-ratas of the stored post-line-promo nets and
  `orderLevelDiscount = promotion_discount_total − Σ line
  promotion_discount` (the unattributed slice the engine never assigns
  to lines, so any attribution summing to it is honest). Refunding
  every unit of every line pins the attribution exactly; anything
  partial leaves it to staff inside the bound. The human decides dust
  and attribution, the machine bounds both. Plus: amount ≤
  verified-paid − live-refunded (only collected/verified money; COD
  counts once its collection evidence verifies — verified rows exist
  for every rail).
- Journal ordering (deliberate retail/wholesale difference): the retail
  writer checks idempotency BEFORE the live-state checks (ceiling,
  units), so a replay returns the existing refund even though its own
  live row now consumes the ceiling/units. The wholesale writer checks
  money first (pre-existing behavior, kept byte-identical).
- No-lines (whole-order) refunds ONLY for `cancelled` orders, amount
  == ceiling exactly (nothing delivered; no double-refund possible).
  Delivered/returned orders REQUIRE lines.
- Allocations FIFO over locked verified payments (retail has no
  payment_allocation lineage; contributed = amount − drawn by live
  retail refunds); `REFUND_ALLOCATION_MISMATCH` when unmappable.
- Idempotency scope `rOrder` (scope_type is CHECK-free); replay
  returns the existing refund; key reuse with a different hash → 409.

### C3 machine + orchestration
- `approveRefund`/`failRefund`: side-agnostic (audit metadata orderId
  becomes `wholesale ?? retail` — identical for wholesale rows).
- `completeRefund`: same evidence + idempotency + versioning; ledger
  OUT branches on side (wholesale FK vs retail FK). Audit carries the
  side's order id.
- Retail orchestration on `RetailOrdersService` (mirrors the
  verifyPayment split: order-side policy here, money-side in
  PaymentsService): `requestRetailRefund` (gates: paid money exists,
  cancelled→whole-only, else lines), `approveRetailRefund`,
  `completeRetailRefund` (each emitting the §C1 cross-aggregate
  facts), + `sumCompletedRetailRefunds` seam in PaymentsService so
  `refundPending` resolves to `paid && cancelled &&
  (total − completedRefunded > 0)` without cross-module table reads.

### C4 test plan
- NEW `packages/database/test/phase-5-9-c-migration.test.ts` (0039:
  XOR CHECKs fire both ways, NULL-side uniques don't collide,
  ledger side, event CHECK evolution).
- NEW `apps/api/test/phase-5-9-c-retail-refunds.test.ts`: full
  cancel→refund→completed cycle (flag resolves, ledger OUT,
  allocations, facts); return→line-refund with promotion gap inside
  the dust window + outside rejected; over-ceiling/over-units/
  unpaid/COD-uncollected rejections; replay idempotency; key-reuse
  409; evidence-required completion; wholesale writer byte-identical
  (a wholesale refund filed in-suite passes through the old path
  untouched — plus the untouched wholesale suites).
- Count-only updates: tables stay 198 (ALTERs only), journal
  39→40 entries / idx 39.

## 10. Checkpoint C as-built (retail refunds on the generic engine)

### What shipped
- Migration 0039 (ALTER-only, zero new tables; 198 tables stand):
  `refund` / `refund_line` / `financial_ledger_entry` each carry a
  nullable wholesale side + a nullable retail side behind a
  boolean-XOR CHECK, with retail FKs (restrict), retail partial
  uniques and retail indexes; `order_event` gains
  `retail_order.refund_requested` / `retail_order.refund_completed`.
  Snapshot + journal idx 39 via `scripts/gen-0039-snapshot.mjs`
  (`--check` green).
- Money side (`PaymentsService`, single-writer preserved):
  new `createRetailRefund` (the wholesale `createRefund` is
  byte-identical), the `requested → approved → processing →
  completed` machine reused with a ledger-OUT side-branch + audit
  `orderId` null-coalesce (wholesale-identical values), and the
  `sumCompletedRetailRefunds` seam. Idempotency journals first (see
  §9-C2: deliberate retail/wholesale ordering difference).
- Retail side (`RetailOrdersService`): `requestRetailRefund` (state
  gates: cancelled→whole-only, delivered/returned→lines-required,
  placed/confirmed/packed→routes-to-cancel, shipped→not-ready;
  unpaid→refused; locked line basis + order merchandise context),
  `approveRetailRefund` / `completeRetailRefund` /
  `failRetailRefund` (retail-side gate + machine delegation; the two
  cross-aggregate facts commit atomically with filing/completion).
  `presentOrder.payment.refundPending` resolves truthfully
  (`paid && cancelled && total − completedRefunded > 0`, SUM skipped
  for uncancelled/unpaid views). New `RETAIL_REFUND_*` codes in the
  retail contract. No new customer HTTP; no relay change (refund
  facts are recorded, not notified — Admin/notification surface is
  5.11 scope).
- Design correction during build (§9-C2 updated in place): the
  first window draft assumed per-line nets are stored; ORDER-scope
  promos live only at order level, so the window is
  `[lineFloor − orderLevelDiscount,
  lineCeil − (coversAll ? orderLevelDiscount : 0)]`. The engine
  never attributes order discounts to lines, so partial refunds
  leave attribution to staff inside the bound while full-merchandise
  refunds pin it exactly.

### Gates
- `typecheck:all` clean (4 workspaces).
- `test:all` 1466/1466 = 1453 (B head) + 13 new, zero regressions:
  shared 23, database 127 (+4 migration C), api 1161 (+9 refunds),
  frontend 155.
- New suites: `packages/database/test/phase-5-9-c-migration.test.ts`
  (XOR both ways, retail FKs/uniques, append-only-aware ledger
  proofs, fact CHECK, restrict pins) and
  `apps/api/test/phase-5-9-c-retail-refunds.test.ts` (whole-order
  cycle, replay + key-reuse 409, honesty window in/out + exact
  full-merchandise pin, ceiling/exactness, unpaid + COD-uncollected
  vs COD-verified, state gates, evidence + machine order + once-ness,
  staff-only + retail-side gate, wholesale writer untouched incl.
  the surviving wholesale partial unique).
- Standing invariant: zero file deletions; the only edits to
  existing suites are count pins (tables stay 198; journal
  39→40 entries / idx 39) and their comments.

### Observed but deliberately untouched
- `wholesale_order.status` has a baseline DB default `'pending'`
  that its own status CHECK (from `WHOLESALE_ORDER_STATUSES`,
  `draft…`) rejects — status-less wholesale inserts always fail.
  Pre-existing, wholesale-owned, out of C scope; the C wholesale
  fixture passes `status: "draft"` explicitly. Not changed: C must
  not move wholesale behavior.
