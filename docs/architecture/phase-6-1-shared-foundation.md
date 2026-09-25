# Phase 6.1 — Shared Frontend Boundary + Design System Foundation

**Status:** Complete
**Branch:** `arena/01a0d8a4-kolbevintage-services`
**Start SHA:** `125fd8af465b6f97c3ec0d143d20913a6cd40a2c` (Phase 6.0 closing)

## Purpose

Phase 6.1 creates **one** typed boundary that every later portal cutover (6.2 Supplier →
6.7 removal) builds on. It deliberately migrates **no portal feature**, changes no visual
appearance and invents no backend ownership.

```
Canonical Nest API
        ↓
Shared Typed Frontend Boundary   ← frontend-next/shared/**
        ↓
Auth / Session · Errors · Pagination · Money · Permissions · Design tokens
        ↓
Portal feature adapters (6.2 – 6.6)
        ↓
UI
```

## Module map (`frontend-next/shared/`)

| Module | Responsibility | Browser-independent |
|---|---|---|
| `http/errors.ts` | One `ApiError` taxonomy mapped onto the Phase 6.0 `UI_STATES` vocabulary | yes |
| `http/client.ts` | The single transport: base URL, credentials, headers, JSON, abort, timeout, results | yes |
| `http/url.ts` | Pure URL/query building and SSR-safe base-URL resolution | yes |
| `http/clients.ts` | Canonical `/api/v1` + the two registered compatibility bases | yes |
| `session/*` | Session contract parsing, auth client, store, presentation-only cache, React binding | yes (React binding is a 3-line wrapper) |
| `ui/async-state.ts` | `AsyncState<T>` on the registered state vocabulary | yes |
| `pagination/*` | NONE / OFFSET / KEYSET / CURSOR normalization | yes |
| `money/*` | Decimal-string money + quantity helpers | yes |
| `permissions/*` | Server-derived capability model | yes |
| `design/*` | Semantic design tokens, generated CSS, RTL-safe foundation | yes (except `foundation.css`) |

Import aliases: `@shared/*` (tsconfig + vitest).

## Rules encoded in the boundary

### 1. One HTTP boundary

`createApiClient()` is the only place that calls `fetch` (enforced by
`test/phase-6-1-boundary-guard.test.ts`). It provides three call styles:

| Style | Behaviour |
|---|---|
| `request<T>()` | throws `ApiError` on failure |
| `requestResult<T>()` | returns `ApiResult<T>` — **a failure carries no `data`** |
| `requestWithMeta<T>()` | data + canonical response metadata |

Every failure is classified into one of:
`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
`RATE_LIMITED`, `SERVER_ERROR`, `NETWORK_ERROR`, `PROVIDER_UNAVAILABLE`, plus two
transport-only kinds: `MALFORMED_RESPONSE` (mapped to `SERVER_ERROR` in the UI) and
`ABORTED` (mapped to `LOADING` — a cancelled request must never paint a stale error).

500-family rules: `502`/`504` are always provider/gateway unavailability; `503` is
provider unavailability **only** when the server code names an upstream dependency
(`PROVIDER | UNAVAILABLE | UPSTREAM | GATEWAY | CANONICAL_API | NOT_CONFIGURED |
TIMEOUT | CIRCUIT`), otherwise it is a server error.

### 2. Empty ≠ Error

`stateFromResult(result, isEmpty)` evaluates `isEmpty` **only** on successful data.
There is no code path from a network/server failure to `READY_EMPTY`. This is the
direct fix for the Phase 6.0 finding “some compatibility clients convert
network/server failures into empty arrays” (`catch { return [] }`).

### 3. Session authority

- `POST /auth/login` → `GET /auth/me`. The login body is **never** the identity source.
- `401`/`403` on `me` is a valid *anonymous* answer, not a failure.
- The same status coming from the permission loader **is** a failure: the user exists but
  the capability contract is unavailable, so reporting “anonymous” would be a lie.
- Roles, supplier tenant, VIP status and permissions come only from the server.
- `localStorage` holds a **presentation cache** (`kolbe-session-presentation-v1`) with
  display-only fields; it can never construct a `Session` and can be invalidated against
  the server with `isPresentationCacheConsistent()`.

### 4. Pagination

`normalizePage(raw, mode)` preserves canonical backend metadata. When the server does not
say whether more data exists, the model returns `hasMore: null` and `complete: false`
(explicit *unknown*) instead of assuming the dataset is complete. `nextRequestQuery()`
builds the next request; there is no load-all behaviour anywhere in the boundary.

### 5. Money and quantity

- Authoritative money is a **decimal string**. `assertMoneyString()` rejects anything else.
- Conversion to minor units uses `BigInt`; no `parseFloat`, no `Number()` on money
  (enforced by a source scan test).
- `sumMoneyForDisplay()` is named for what it is: a display total, never a commercial truth.
- Quantities keep their API precision (`parseQuantity` → `{ value: string, scale }`);
  integer-only contracts can request `maxScale: 0`.

### 6. Permissions

- `hasPermission()` reads **only** the server-supplied permission list. The `admin` role
  grants nothing by itself.
- Group wildcards (`crm:*`, `*`) are supported; plain prefixes are not (`crm` does not
  grant `crm:view`).
- `canUseProduction()` requires an explicit supplier capability — “Supplier” is not a
  synonym for “Manufacturer”.
- `controlState()` returns `visible | hidden | enabled | disabled`; backend authorization
  stays authoritative (a 403 can still arrive).

## Design token foundation (6.1-G/H/I)

### Model

```
ThemeConfig
  modes: { light: ThemeTokenSet, dark: ThemeTokenSet }
  responsive?: { [breakpoint]: { light?: Partial override, dark?: Partial override } }
```

`ThemeTokenSet` is a pure serializable object grouped as
`color | typography | layout | shape | control`. That shape is what the Phase 6.4 visual
editor needs:

```
Global Theme → Page Template → Section → Block → Responsive Override
```

No theme value is baked into component source; components consume CSS variables.

### Output

- `shared/design/tokens.css` — generated by `npm run tokens:build --workspace kolbe-next`
  from `tokens.ts` (committed so the Next build needs no extra tooling). A drift test
  (`phase-6-1-design-tokens.test.ts`) fails if the committed file diverges.
- `shared/design/foundation.css` — opt-in RTL-safe utilities: logical properties only,
  `.kolbe-shell`, `.kolbe-grid`, `.kolbe-table-scroll`, `.kolbe-ltr` (email/SKU isolation),
  `.kolbe-min-0` (the real fix for horizontal overflow in grid/flex children).

### Visual preservation

- Default token values are the approved identity: the `heritage` theme
  (`#0b2a46` navy, `#f7f5f0` warm off-white, `#c9654d` terracotta, `0.625rem` control
  radius, `1rem` surface radius, Vazirmatn).
- The new `--kolbe-*` layer is **additive**: no existing selector, rule or `--kv-*` value
  was changed. Legacy variables keep their literal defaults, so the first paint is
  byte-identical.
- `storefront/designSystem.ts` now also pushes the legacy theme onto the semantic
  variables (`semanticColorVariablesFromLegacy`), so the two systems cannot drift apart
  when the design center switches themes. No new value is imposed on current CSS.

### Known contrast exception (documented, not silently changed)

`accent` (`#c9654d`) with `accentText` (`#ffffff`) reaches ≈3.85:1 — acceptable for
large text and UI components, below AA for body text. The colour is part of the approved
brand identity, so it is recorded here rather than changed; the Phase 6.4 visual editor
is the right place for the client to decide.

## Migration rules for 6.2+

1. Portal adapters live in the portal’s own folder and import from `@shared/*`;
   `shared/**` must never import portal code (guard test).
2. A portal is “cut over” only when reads, writes, session, error mapping, pagination,
   empty states and permission states are all covered by tests.
3. Compatibility routes (`/store/kolbe/*`, `/admin/kolbe/*`) may be removed only after
   the portal’s E2E + visual parity gate (6.7).
4. Never add a second transport. If the shared client is missing something, extend it.

## Known remaining seams (unchanged in 6.1)

| Legacy helper | Portals served | Replacement |
|---|---|---|
| `storefront/lib/api.ts` | storefront, VIP, admin | `createApiClient()` (`@shared/http`) |
| `storefront/lib/siteAuthApi.ts` | retail customer | `createSessionClient()` |
| `storefront/lib/wholesaleApi.ts` | admin/wholesale | portal adapter over `@shared/http` + `@shared/permissions` |
| `storefront/lib/wholesaleVipApi.ts` | VIP | portal adapter over `@shared/http` + `@shared/session` |
| `supplier-src/api.ts` | supplier | portal adapter over `@shared/http` (6.2) |

These files were intentionally left untouched in 6.1: they still back live features, and
rewiring them would migrate portals ahead of their checkpoint.
