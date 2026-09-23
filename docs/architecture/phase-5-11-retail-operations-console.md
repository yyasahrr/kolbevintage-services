# Phase 5.11 — Retail Operations Console Backend (historical tranche record)

> This is the preserved record for the first Phase 5.11 operations tranche.
> For the reconciled, canonical architecture covering both tranches, see
> [Retail Admin & Operations Backend](phase-5-11-retail-admin-operations.md).

Backend-only staff HTTP for the retail seams. Checkouts A–D:
fulfillment ops routes (A), after-sales ops routes (B), staff
reads/queues (C), audits + convergence + guards (D).

## 1. Authority map (recon, Checkpoint A)

Every retail staff action already exists as a proven service seam
with RBAC (`assertStaff` / `assertRefundStaff` / owner checks)
and D-level convergence proofs (5.8-D, 5.9-D). What does NOT exist
is HTTP: `RetailOrdersController` serves exactly three routes
(`POST /retail/orders`, `GET :id`, `GET :id/shipment`). The full
gap inventory (all verified seam-only by route grep):

| Seam | Service method | HTTP |
|---|---|---|
| confirm / pack | `confirmRetailOrder` / `packRetailOrder` | none |
| staff cancel | `cancelRetailOrder` | none |
| verify payment | `verifyPayment` | none |
| create shipment | `createRetailShipment` | none |
| handoff | `markRetailShipmentHandoff` | none |
| manual tracking | `recordRetailManualTracking` | none |
| refund file/approve/complete/fail | `request/approve/complete/failRetailRefund` | none (B) |
| return transitions | `transitionRetailReturn` | none (B) |
| guest revocation | staff seam, no HTTP | none (B) |
| staff order list/search/queues | does not exist (C builds reads) | none (C) |

Covered elsewhere (NOT in 5.11 scope): carrier webhooks
(`POST /shipping/providers/:provider/webhook`, B16, public +
signature-verified) and wholesale/supplier ops (`supplier/orders`
confirm→deliver, `admin/wholesale/orders` reads + cancel). 5.11
closes the retail side only; wholesale behavior is untouched.

## 2. Route namespace (Checkpoint A lock)

New controller `admin-retail-ops.controller.ts` (retail module),
prefix `admin/retail`, mirroring the `admin/wholesale/orders`
convention:

- `POST admin/retail/orders/:id/confirm`
- `POST admin/retail/orders/:id/pack`
- `POST admin/retail/orders/:id/cancel` (`{ reason? }`)
- `POST admin/retail/orders/:id/shipments`
  (`{ idempotencyKey?, providerName?, items? }`)
- `POST admin/retail/shipments/:id/handoff` (`{ idempotencyKey? }`)
- `POST admin/retail/shipments/:id/manual-tracking`
  (`{ state, idempotencyKey?, note? }`)
- `POST admin/retail/payments/:id/verify`
  (`{ externalReference, idempotencyKey, expectedVersion?, reason? }`)

Class-level `@Roles("admin")`. Idempotency keys ride the
`idempotency-key` header with the checkout body fallback, via one
private helper; keys are never fabricated (missing keys fail
closed in `parseIdempotencyKey` at the seam).

## 3. Trust boundary (Checkpoint A lock)

- HTTP admits admins only. The session guard re-checks the token
  role against the live `account_user` row (`user.role !==
  claims.role` → 401), and the account role CHECK has no
  `finance` value — so finance acts stay service-seam-only BY
  CONSTRUCTION. The `verify` route is `@Roles("admin")` while
  its seam still permits finance: HTTP narrows, the seam stays
  the authority. Pinned by test.
- The controller forwards `{ actorId: claims.sub, actorRole:
  claims.role }` untouched — no role translation, no privilege
  invention (the 5.8-D deferred-items contract: "the future
  routes only need to forward the authenticated actor").
- Error codes cross the wire unchanged: the global domain-error
  filter already maps seam codes to statuses (customer routes
  prove it). No new error vocabulary in 5.11-A.

## 4. Response-code + replay conventions (Checkpoint A lock)

- Replayable POSTs mirror the checkout precedent: the service
  returns `replayed`, and the route answers 201 on first effect
  / 200 on replay (shipments, handoff, verify).
- Transition POSTs (confirm/pack/cancel/manual-tracking) answer
  200 via explicit `@HttpCode(200)`; their bodies are the seam
  views verbatim (no reshaping, no field filtering).
- No migration in A (routes only): tables stay 198, journal
  untouched, all count pins hold.

## 5. Checkpoint A design (routes + tests)

Implementation: the §2 controller + module wiring (no new
providers; the controller consumes `RetailOrdersService` in its
own module, so no boundary-map change). Tests
(`phase-5-11-a-retail-ops.test.ts`, supertest over real PG):

1. confirm over HTTP (admin 200 + advanced view; customer 403;
   anonymous 401).
2. pack sequencing (confirm→pack 200; pack-before-confirm 409).
3. staff cancel of a paid order (cancelled + `refundPending`,
   money untouched).
4. payment verify (customer evidence → admin verify → paid;
   double verify converges).
5. shipment create (201 new / 200 same-key replay; customer 403).
6. handoff (200 / same-key 200; pre-ready refusal honest).
7. manual tracking (delivered attestation; backward scan ignored;
   missing key fails closed 4xx).
8. finance-hat token refused at HTTP (401 — seam-only by
   construction) while the seam still accepts finance.
9. View parity: HTTP bodies equal the seam views field-for-field
   on one full drive (confirm→pack→ship→handoff→delivered).

## 6. Checkpoint A as-built (fulfillment ops routes)

Shipped the §2 controller verbatim: 7 routes, class-level
`@Roles("admin")`, actor forwarded untouched, replayable trio
(shipments/handoff/verify) on 201-new/200-replay, transitions on
explicit 200, all bodies via `toApiJson`. No migration, no new
providers, no boundary-map change (same-module consumer).

Findings while pinning (all test-locked, none required seam
changes): the error wire shape is `{ error, message }` (code in
`error`, not `code`); order views carry `status` (not
`orderStatus`); manual-tracking `status` is the outcome
(`processed`), the parcel state rides `shipmentStatus`;
unpaid confirm refuses `RETAIL_FULFILLMENT_NOT_READY` (422);
shipment creation on a confirmed order is legal with handoff
fenced to packed (`RETAIL_SHIPMENT_NOT_READY`, 422).

Gates: `typecheck:all` clean; `test:all` 1587/1587 = 1578 (5.10
closeout) + 9 new (`phase-5-11-a-retail-ops.test.ts`), zero
regressions. Tables stay 198; all count pins hold.

## 7. Checkpoint B design (after-sales ops routes)

Same controller, same prefix, same conventions. Ten routes:

Refunds (all return `{ replayed }` → 201-new/200-replay):
- `POST admin/retail/orders/:id/refunds`
  (`{ amount, lines?, reason?, idempotencyKey? }`)
- `POST admin/retail/refunds/:id/approve`
  (`{ idempotencyKey?, reason? }`)
- `POST admin/retail/refunds/:id/complete`
  (`{ externalReference, idempotencyKey? }`)
- `POST admin/retail/refunds/:id/fail`
  (`{ reason, idempotencyKey? }`)

Returns (explicit per-action routes mirroring the wholesale
`supplier/orders` style; transitions answer 200):
- `POST admin/retail/returns/:id/approve` / `receive`
  (`{ reason? }`)
- `POST admin/retail/returns/:id/inspect`
  (`{ inspectionDecision, reason? }`)
- `POST admin/retail/returns/:id/restock` (`{ reason? }`)
- `POST admin/retail/returns/:id/reject` (`{ reason }`)

Revocation:
- `POST admin/retail/orders/:id/guest-capability/revoke` → 200
  `{ revoked }` (idempotent: false when no live hash, covering
  customer orders and double revoke; audit-logged on change).

Locks: no `withdraw` route exists (404 by construction) and the
seam refuses staff WITHDRAWN regardless ("WITHDRAWN is
customer-only"); finance stays seam-only on refunds (same
narrowing as `verify`, pinned once). `RetailReturnsService` is
already a same-module provider — no module edit. No migration.

## 8. Checkpoint B as-built (after-sales ops routes)

Shipped the §7 routes verbatim: 4 refund routes (201/200 replay),
5 explicit return routes (200), revocation (200, idempotent).
`RetailReturnsService` injected from the same module — no module
edit, no boundary-map change. No migration.

Pinned behaviors: finance-hat 401 on refund filing (money-act
narrowing, same as `verify`); no withdraw route (404) with the
seam backstop untouched; reject requires a reason (400);
revocation flips guest reads to 403 `REVOKED` and is honestly
false on customer orders and double revoke.

Gates: `typecheck:all` clean; `test:all` 1596/1596 = 1587 (A) + 9
new (`phase-5-11-b-after-sales-ops.test.ts`), zero regressions.
One run hit the known transient `phase-4-7-1-cross-domain`
flake (random hex hash containing 13 consecutive digits trips a
no-wall-clock-key assertion); it passes standalone and the
re-run board is fully green. Tables stay 198.

## 9. Checkpoint C design (staff reads + queue indexes)

Reads complete the console. Six routes on the same controller
(all `@Roles("admin")`, all 200):

- `GET admin/retail/orders` — filters `status`,
  `paymentStatus`, `orderCode` (exact), `customerId`,
  `dateFrom`/`dateTo`; slim rows newest-first.
- `GET admin/retail/orders/:id` — full view (forwards
  `getRetailOrder` as admin; 404/403 unchanged).
- `GET admin/retail/orders/:id/timeline` — version-ordered
  `retail_order_event` rows; 404 when the order is missing
  (never an ambiguous empty list).
- `GET admin/retail/returns?status?` — slim queue rows.
- `GET admin/retail/returns/:id` — full view (forwards
  `getRetailReturn` as admin).
- `GET admin/retail/refunds?status?` — slim queue rows,
  retail-side only (payments-owned reader, mirroring
  `getRefundsForAdmin`).

Conventions mirrored from `admin/wholesale/orders` (same
consumer): cursor is base64url `{ createdAt, id }`; a bad
cursor degrades to the first page; `limit` clamps 1–100,
default 20; unknown status strings match nothing (pass-through,
no new error vocabulary); envelopes are
`{ <rows>, nextCursor, hasMore }`. Money leaves as decimal
strings; `toApiJson` serializes.

Reads live with their owners: order list + timeline in the
retail repo/service, return queue in the returns repo/service,
refund queue as a new `PaymentsService` reader (registry: the
writer stays in payments; the D10 guards pin it). RBAC is
`assertStaff` at the seams (admin/system; HTTP admits admin).

Migration 0043 (index-only, hand-written SQL + snapshot +
journal — `drizzle-kit generate` cannot diff the hand-made
0035–0042 snapshots): `retail_order_status_created`,
`retail_order_payment_created`,
`retail_return_request_status_created`, and the partial
`refund_retail_status_created WHERE retail_order_id IS NOT
NULL`. Tables stay 198; journal 44 entries / idx 43.

## 10. Checkpoint C as-built (staff reads + queue indexes)

Shipped the §9 surface verbatim: order list (6 filters) +
detail + timeline, return queue + detail, refund queue —
all keyset `{ rows, nextCursor, hasMore }` on the wholesale
pagination mirror (bad cursors degrade, limit clamps 1–100,
unknown filters match nothing). Timeline 404s on missing
orders; detail routes forward the admin viewer.

Reads live with their owners (order/return in retail,
refunds in `PaymentsService.listRetailRefundsForStaff`,
payments-convention no-actor reader behind the admin gate).
Migration 0043 added the 4 queue indexes only; tables stay
198, journal 44 entries / idx 43. Count-only pin updates in
3 suites (5-3 string, 5-7 journal, 5.10-D10.8 guard).

Gates: `typecheck:all` clean; `test:all` 1610/1610 = 1596 (B)
+ 14 new (4 migration + 10 reads), zero regressions.

## 11. Checkpoint D as-built (audits + convergence + guards)

**Verdict: no migration, no new routes, one genuine hardening.**
D froze the A/B/C surface by auditing every authority (D1–D5),
proving races and failures converge over HTTP (D6–D7), attacking
the trust boundary (D8), ruling legacy untouched (D9) and the
schema frozen (D11), and pinning the verdicts as executable
static guards (D10).

**Authority audits (all confined, zero code change).** D1:
`retail_order` writes live only in the retail-orders repository;
the controller performs none. D2: all six new readers are
SELECT-only (0 write calls each). D3: `refund` rows are read only
inside the payments module. D4: `paymentStatus` is written only
by the `markPaid` path. D5: no new shipment-write edge (retail →
shipping `claimCommand` is pre-existing). D9: zero legacy diffs
in 5.11. D11: 0043 stays the head (index-only, tables 198).

**Hardening found by D (1, regression-free).** Hostile cursors
500'd: a well-shaped cursor with a garbage `createdAt` reached PG
as `('...'::timestamptz)`. A bare `isNaN(Date.parse())` check was
tried first and PROVEN insufficient by the D8 test — V8 leniently
parses digit-bearing garbage (`"not-a-date' OR '1'='1"` becomes
2001-01-01). The shipped fix requires strict ISO-8601 (the only
shape our encoder emits); anything else degrades to page one.
Pinned by D8 test 4 + D10.6. The wholesale console shares the
older lenient shape — pre-existing, out of 5.11 scope, recorded
here and untouched.

**Failure injection (D6, 8 tests).** Double verify on different
keys (201→200 replayed); same-key different-request shipment
conflict (409); idempotent recancel; confirm-after-cancel (400);
unpaid refund filing (422); out-of-order return transition (400);
revocation on missing orders (404); completion before approval
(409).

**Concurrency (D7, 7 tests).** Racing confirms (one 200, loser
400); same-key double filing (201+200, one row); racing
approve+fail (both orders end failed, honestly); racing
approve+reject (both orders end REJECTED — APPROVED→REJECTED is
legal, the first version of this test wrongly assumed mutual
exclusion); keyset walks under concurrent inserts (terminate,
seeds seen exactly once, prepends skipped-never-duped); same-key
double handoff (201+200); racing whole-filings (one 201, loser
409 `REFUND_EXCEEDS_ALLOCATED`, one row).

**Security (D8, 8 tests).** Full role matrix (admin 200;
customer/vip/supplier 403; anonymous/garbage/finance-hat 401);
guard-before-existence (no oracles); filter injection inertness
(incl. a DROP TABLE attempt with the table surviving); hostile
cursors degrade (the hardening); no transition/withdraw routes
(404); inspection requires a decision (400); malformed keys 400
(control chars, over-long); refund rows retail-only with string
money and no wholesale keys.

**Coverage.** New `phase-5-11-d-failure-injection.test.ts` (8),
`phase-5-11-d-concurrency.test.ts` (7),
`phase-5-11-d-security.test.ts` (8), and
`phase-5-11-d-static-guards.test.ts` (8: shell purity, admin
gate, no new vocabulary, payments-owned refund reads, timeline
ordering, strict ISO cursors, schema shape, queue indexes).
A/B/C regression: zero — full `test:all` green, counts pinned
below.
