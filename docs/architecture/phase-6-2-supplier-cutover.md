# Phase 6.2 — Supplier Portal Canonical Cutover (Architecture)

Companion to [`phase-6-1-shared-foundation.md`](./phase-6-1-shared-foundation.md)
and [`phase-6-frontend-truth-cutover.md`](./phase-6-frontend-truth-cutover.md).
Phase report: [`../phase-reports/phase-6-2-report.md`](../phase-reports/phase-6-2-report.md).

This document records the rules a future change to the Supplier portal must
respect. It is normative: where this file and an implementation detail disagree,
the rule wins and the implementation is the bug.

---

## 1. Layering

```
Canonical Nest API  (/api/v1)
        │
        ▼
shared/http          generic transport — the ONLY fetch call site
shared/session       server-owned identity
shared/permissions   capability set derived from the server
shared/money         decimal-string money + quantity
shared/ui            AsyncState<T> over the Phase 6.0 UI_STATES vocabulary
        │
        ▼
shared/supplier      Supplier domain mapping (no transport, no React)
   contracts.ts      typed domain shapes
   client.ts         path / header / body mapping → ApiResult<T>
   session.ts        supplier session + capability gate
   normalize.ts      wire format → contract
   present.ts        labels and formatting only
        │
        ▼
supplier-src         React portal
   context.tsx       one boundary instance for the whole portal
   hooks.ts          useSupplierResource / useSupplierMutation
   ui.tsx            presentational primitives
   navigation.ts     page ids and nav model
   pages/*.tsx       data-driven pages
```

**Rule 1 — one transport.** Nothing under `supplier-src/**` or
`shared/supplier/**` may call `fetch`, construct a `Request`, or use
`XMLHttpRequest`. A test enforces this by source scan.

**Rule 2 — generic stays generic.** `shared/http` must not learn Supplier
vocabulary. Supplier path mapping lives in `shared/supplier/client.ts`.

**Rule 3 — one boundary instance.** `SupplierPortalProvider` constructs the
`ApiClient` once. Pages receive it through context and never build their own.

---

## 2. Error and state contract

Every adapter call returns `ApiResult<T>`. The failure branch **carries no
`data` property at all**, which is what makes "failure became an empty list"
unrepresentable rather than merely discouraged.

| Server outcome | `ApiError.kind` | UI state |
|---|---|---|
| 400 / 422 with `VALIDATION_FAILED` | `VALIDATION_ERROR` | `VALIDATION_ERROR` (field issues parsed) |
| 401 | `UNAUTHORIZED` | `UNAUTHORIZED` — session expired |
| 403 | `FORBIDDEN` | `FORBIDDEN` — access state, not a generic error |
| 404 | `NOT_FOUND` | `NOT_FOUND` |
| 409 | `CONFLICT` | `CONFLICT` |
| 429 | `RATE_LIMITED` | `RATE_LIMITED` (+ `Retry-After`) |
| 502 / 504 | `PROVIDER_UNAVAILABLE` | `PROVIDER_UNAVAILABLE` |
| 503 with a provider-ish code | `PROVIDER_UNAVAILABLE` | `PROVIDER_UNAVAILABLE` |
| 503 otherwise / 5xx | `SERVER_ERROR` | `SERVER_ERROR` |
| throw / no response | `NETWORK_ERROR` | `NETWORK_ERROR` |
| non-JSON body | `MALFORMED_RESPONSE` | `SERVER_ERROR` |
| aborted | `ABORTED` | `LOADING` (no decision yet) |

**Rule 4 — EMPTY ≠ ERROR.** `READY_EMPTY` is reachable only from a *successful*
response whose payload the page itself declares empty. Every list resource
passes an explicit `isEmpty` predicate, because the server's empty payload is
an object (`{ products: [] }`), not an array — the default predicate would
never fire and an empty supplier would render an empty table instead of an
empty state.

**Rule 5 — no silent degradation.** A failed capability read is recorded on the
session as `capabilitiesError`; it is not swallowed into "no capabilities"
unless the server actually answered 401/403/404.

---

## 3. Identity and tenancy

`POST /auth/supplier/login` sets the cookie and **is not identity**. The client
then reads `GET /auth/me` and derives everything from that response.

- `role !== "supplier"` → `SupplierSessionError("NOT_SUPPLIER")` → 403
- `role === "supplier"` with no tenant → `SupplierSessionError("NO_SUPPLIER_TENANT")` → 403
- missing/invalid `supplierId` → the session stays `anonymous`; a tenant is
  never synthesised

**Rule 6 — no browser tenancy.** No adapter method accepts a `supplierId` from
a caller for the supplier's own data. Paths that need `:supplierId`
(compliance) take it from the session. Financial, support and order endpoints
do not send one at all; the server derives it from the cookie.

**Rule 7 — demo mode is a flag, not a session.** Demo state lives outside
`SupplierSession` so the session type can never assert a locally-sourced
identity. It is gated on `NEXT_PUBLIC_SUPPLIER_DEMO` and permanently labelled
in the UI. A failed login never falls back to it.

---

## 4. Capability gating

`supplier` is not `manufacturer`. Access to production requires a
server-declared capability obtained from `GET /supplier/production/capabilities`
and evaluated through `canUseProduction()` from `shared/permissions`.

Gating is applied twice, deliberately:

1. the nav item is not rendered without the capability;
2. the page itself refuses and shows an access state if reached directly.

**Rule 8 — UI gating is UX only.** It never substitutes for backend
authorization. A 403 from the server is always a valid outcome and must render.

---

## 5. Money and quantity

Money crosses the boundary as a **decimal string** and stays one.

- the adapter never calls `Number()` on a monetary field;
- `normalize.asMoney()` stringifies faithfully, including `bigint`, so values
  beyond float precision survive;
- totals, tax and commission are computed by the server; the client formats
  only;
- an absent amount is `null`, never `0` — a missing balance and a zero balance
  are different facts.

---

## 6. Mutations

**Rule 9 — every mutation carries an `Idempotency-Key`.** Generated per
attempt, so a double-submit cannot create two records. A browser test asserts
the keys are unique and that a double-click yields at most one request.

**Rule 10 — the server owns state machines.** Order and production transitions
POST to the canonical endpoint with `expectedVersion` when the server supplied
one; the UI re-reads afterwards rather than optimistically writing local state.
A 409 renders as `CONFLICT`.

**Rule 11 — no generated business identifiers.** Tracking codes, reference
numbers and order codes come from an operator or from the server. The
`Date.now()` tracking-code generation from the previous portal is deleted.

---

## 7. Wire-format normalization

Two Supplier endpoints legitimately return different key styles:

| Endpoint | Style |
|---|---|
| `GET /compat/supplier/{orders,products,rfqs}` | raw SQL → `order_code`, `total_amount`, `wholesale_price` |
| `GET /supplier/orders`, `GET /supplier/production/jobs` | Drizzle rows → `orderCode`, `totalAmount` |

`shared/supplier/normalize.ts` accepts both and produces one typed contract.

**Rule 12 — mapping lives in the adapter, never in a page.** A page must not
branch on `order.order_code ?? order.orderCode`. If a new endpoint introduces a
third style, extend `normalize.ts`.

**Rule 13 — normalization never fabricates.** A record without an id yields
`null` and is dropped; it is not completed with defaults. Booleans accept only
a literal `true`, so `1` does not silently become a feature flag.

---

## 8. Presentation

**Rule 14 — the approved visual language is frozen.** `portal.css` is additive.
It may not override a visual property of an approved selector. The permitted
exceptions are `--sp-*` custom properties, one scoped `:focus-visible` ring,
and a `.app-shell`-scoped `min-width: 0` overflow fix. A test fails the build
on any other override.

**Rule 15 — tokens, not literals.** Every `--sp-*` variable resolves to the
Phase 6.1 `--kolbe-*` layer. Dark mode redefines variables; it never inverts
colors. This is what lets the 6.4 Theme Editor restyle the portal without
touching components.

**Rule 16 — RTL by logical properties.** `inset-inline`, `padding-inline`,
`border-inline`. Physical `left`/`right` layout properties are rejected by
test. Mixed-direction content (SKU, order code, UUID, money, email) goes in
`.ltr-inline`.

**Rule 17 — new component classes are `sp-` prefixed** so they cannot collide
with the approved CSS.

---

## 9. Local storage

Exactly one key: `kolbe-supplier-theme`, a presentation preference.

**Rule 18 — no business truth in local storage.** Team, roles, capacity,
closures, financial values, orders, production state, compliance state and
support cases are server-owned. Unsaved form drafts would need an explicit
decision and a documented key; none exist today.

---

## 10. Compatibility routes

The `/store/kolbe/supplier/*` proxies are still registered (9 routes) but the
portal no longer calls them. Products and RFQs still read through the
registered `compat/*` seams because no canonical supplier-facing list endpoint
exists for them.

**Rule 19 — no new compatibility debt.** New calls target canonical routes or
an already-registered transitional seam. Removal stays gated on Phase 6.7 E2E
and visual parity evidence.

---

## 11. Known backend gaps

1. **Supplier team has no contract.** `modules/supplier-team` ships a Module
   with no controller; `GET /suppliers/:id/members` is admin-only. The Team
   page therefore shows server-sourced role/capability data and states the gap.
2. **`GET /supplier/orders` cannot page.** The controller applies an internal
   `limit(100)` and accepts no page parameter, so the registry records it as
   `NONE`. Client-side paging would be dishonest; a backend parameter is needed.
3. **26 production endpoints are adapter-only.** Mapped and typed, UI deferred
   to 6.3 — see the phase report §7 class E.
