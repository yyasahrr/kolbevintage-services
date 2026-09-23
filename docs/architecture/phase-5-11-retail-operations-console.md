# Phase 5.11 — Retail Operations Console Backend

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
