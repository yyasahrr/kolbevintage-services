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
