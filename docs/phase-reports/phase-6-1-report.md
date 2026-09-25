# Phase 6.1 — Shared Frontend Foundation + Design System Foundation

**Status:** Complete
**Branch:** `arena/01a0d8a4-kolbevintage-services`
**Start SHA:** `125fd8af465b6f97c3ec0d143d20913a6cd40a2c` (Phase 6.0 closing)
**End SHA:** see final section — updated after the last checkpoint commit
**Architecture doc:** [`docs/architecture/phase-6-1-shared-foundation.md`](../architecture/phase-6-1-shared-foundation.md)

---

## 1. Scope delivered

Phase 6.1 builds **one** typed shared boundary for all portals and the design-token
foundation that the future visual editor (6.4) can consume. It migrates **no portal
feature**, removes **no compatibility route**, adds **no database migration** and invents
**no backend ownership**.

| Checkpoint | Delivered |
|---|---|
| 6.1-A | `shared/http` — one typed transport: errors, results, base URL, abort/timeout, query building |
| 6.1-B | `shared/session` — auth client, store, presentation-only cache, React binding |
| 6.1-C | `shared/ui` — `AsyncState<T>` over the Phase 6.0 `UI_STATES` vocabulary |
| 6.1-D | `shared/pagination` — NONE / OFFSET / KEYSET / CURSOR + `shared/money` (decimal strings) |
| 6.1-E | `shared/permissions` — server-derived capability model |
| 6.1-F | `shared/design` — semantic tokens, generated CSS, RTL-safe foundation |
| 6.1-G | 109 tests + documentation + full regression verification |

---

## 2. Registry delta

`frontend-next/truth-registry.ts` remains the authoritative source and was updated in
three evidence-based ways (no classification, owner or cutover decision changed):

| Change | Detail |
|---|---|
| New entry | `shared-frontend-boundary` (portal `SHARED`, `CANONICAL_API`, `businessTruth: false`, cutover `6.1`, `visualFreeze: true`) — registry total 49 → 50, `SHARED` 3 → 4 |
| `shared-auth-session` | `planned:phase-6-1-auth-client` replaced by the delivered test files |
| `retail-account-identity`, `admin-shell-permissions` | Phase 6.1 test files added as parity evidence; portal wiring remains `planned:` for 6.6 / 6.4 |

Portal breakdown after 6.1: ADMIN 16 · CMS_EDITOR 1 · PUBLIC_STOREFRONT 9 ·
RETAIL_CUSTOMER 5 · **SHARED 4** · SUPPLIER 10 · VIP_WHOLESALE 5 = **50**.
Compatibility routes remain **47**. Feature deletions: **0**.

---

## 3. Architecture implemented

```
Canonical Nest API  (/api/v1)
        ↓
frontend-next/shared/**
   http/        one fetch call site, ApiError taxonomy, ApiResult<T>
   session/     server-owned identity, store, presentation cache, React binding
   ui/          AsyncState<T>  (EMPTY ≠ ERROR)
   pagination/  NONE | OFFSET | KEYSET | CURSOR
   money/       decimal-string money + quantity
   permissions/ capability set from the server
   design/      semantic tokens → tokens.css + foundation.css
        ↓
(6.2 – 6.6) portal feature adapters — not built in 6.1
        ↓
UI (unchanged)
```

Hard invariants enforced by tests:

1. **One transport.** `shared/http/client.ts` is the only `fetch` call site in `shared/**`.
2. **No empty-failure conversion.** A failure result has no `data` property at all.
3. **Session authority.** Login is followed by `GET /auth/me`; the login body is never
   identity. `401`/`403` on `me` ⇒ valid *anonymous*; the same status from the permission
   loader ⇒ a real failure.
4. **No browser authority.** `shared/**` contains no `window`, `document` or
   `window.localStorage` access.
5. **Money is a decimal string**; conversion uses `BigInt`; `parseFloat`/`Number()` on
   money are banned by a source scan.
6. **`admin` role grants nothing**; `supplier` does not imply `manufacturer`.

---

## 4. Existing duplicated helpers — audit result

Phase 6.0 recorded “four duplicated API/session helpers”. Confirmed and now **prepared
for replacement** (deliberately left live so no portal migrates early):

| Legacy helper | Serves | Behavioural defect it still has | Replacement available now |
|---|---|---|---|
| `storefront/lib/api.ts` | storefront, VIP, admin | `ApiError` with string codes; `apiOrNull()` turns `NETWORK` into `null` | `createApiClient()` |
| `storefront/lib/siteAuthApi.ts` | retail customer | swallows every error into `null`; maps unknown errors to “wrong email/password” | `createSessionClient()` |
| `storefront/lib/wholesaleApi.ts` | admin/wholesale | `catch { return [] }` on every list; role taken from the login response | adapter over `@shared/http` + `@shared/permissions` |
| `storefront/lib/wholesaleVipApi.ts` | VIP | network failure becomes `null` membership; money typed as `number` | adapter over `@shared/http` + `@shared/session` + `@shared/money` |
| `supplier-src/api.ts` | supplier | own `ApiError` class; `catch { return [] }` on products/orders/RFQs | adapter over `@shared/http` (6.2) |

None was modified in 6.1.

---

## 5. Exact remaining compatibility seams

| Seam | Count / detail |
|---|---|
| Compatibility routes | **47** (42 Next→Nest proxies, 2 deprecated, 3 static/mock) — untouched |
| Compatibility API bases | `/store/kolbe` and `/admin/kolbe` — exported as constants in `shared/http/clients.ts` |
| Legacy CSS variables | `--kv-*` and `--site-*` keep their literal defaults; the new `--kolbe-*` layer is additive only |
| Legacy theme bridge | `LEGACY_VARIABLE_ALIASES` (20 mappings) + `semanticColorVariablesFromLegacy()` keep both systems in sync |
| LocalStorage business truth | 7 features (unchanged — 6.5/6.6/6.7) |
| Static fixture business truth | 4 features (unchanged — 6.6) |
| Hardcoded runtime business truth | 8 features (unchanged — 6.4/6.5) |
| Frontend money typed as `number` | still present in the legacy view models; the shared boundary now carries the correct type — fixed per-portal in 6.2–6.6 |

---

## 6. Test evidence

### New Phase 6.1 suites (`npm run test:phase-6-1 --workspace kolbe-next`)

| Suite | Tests | Covers |
|---|---:|---|
| `phase-6-1-api-client.test.ts` | 25 | success, malformed 2xx, 400/422, 401, 403, 404, 409, 429, 500, 502, 503, network, provider-unavailable, abort, timeout, retry-after, requestId/errorId, void/text shapes, URL building, base-URL resolution |
| `phase-6-1-auth-session.test.ts` | 16 | server-owned identity, login→me re-read, no invented identity, 401 vs 500, malformed payload, unknown role, supplier tenant, permission merge, permission-loader failure, presentation cache not authority, store lifecycle, React SSR snapshot |
| `phase-6-1-design-tokens.test.ts` | 18 | token completeness, light/dark parity, CSS drift guard, contrast (both modes), accent exception, responsive overrides, legacy bridge, RTL/logical properties, viewport matrix, additive-only CSS |
| `phase-6-1-pagination.test.ts` | 12 | offset/cursor/keyset canonical metadata, unknown metadata, ambiguous payload rejection, explicit `itemsPath`, no invented totals |
| `phase-6-1-permissions.test.ts` | 9 | admin ≠ unlimited, wildcards, supplier ≠ manufacturer, control states |
| `phase-6-1-ui-state.test.ts` | 10 | EMPTY ≠ ERROR, every kind mapped, abort non-terminal, unknown exceptions |
| `phase-6-1-money.test.ts` | 8 | decimal-string authority, BigInt conversion, `fa`/`en` formatting, quantity precision, source scan for `parseFloat` |
| `phase-6-1-boundary-guard.test.ts` | 6 | no portal dependency, no DOM in shared core, single fetch site, no business words in transport, vocabulary reuse |
| `phase-6-1-live-contract.test.ts` | 5 | real Nest API: health 200, `/auth/me` ⇒ `UNAUTHORIZED`, anonymous restore, invalid login, unknown route ⇒ `NOT_FOUND` (skipped without the DB harness) |

Focused suite: **104 passed, 5 skipped (9 files)** — no database required.

### Full repository verification

| Workspace / command | Files | Tests | Result |
|---|---:|---:|---|
| `npm test --workspace @kolbe/shared` | 2 | 23 | ✅ |
| `npm test --workspace @kolbe/database` | 26 | 147 | ✅ |
| `npm test --workspace @kolbe/api` | 131 | 1 399 | ✅ |
| `npm test --workspace kolbe-next` | 30 | 323 | ✅ (baseline was 21 / 214) |
| `npm run test:phase-6-0 --workspace kolbe-next` | 1 | 13 | ✅ |
| **Total automated tests** | **190** | **1 905** | ✅ |

Commands also executed and green:

```
npm run typecheck --workspace kolbe-next      # strict TS, no errors
npm run typecheck:all                          # shared + database + api + next
npm run tokens:build --workspace kolbe-next    # regenerates tokens.css (drift-free)
npm run build --workspace kolbe-next           # Next 15.5.25 production build ✓
npm run build:api                              # Nest build ✓
npm run infra:verify                           # 12 env vars, 9 compose services ✓
```

Migrations: **47/47**, tables: **199** (unchanged — Phase 6.1 added no migration).

---

## 7. Visual differences

**None.** Evidence and rationale:

- `shared/design/tokens.css` only declares custom properties on `:root` /
  `[data-theme="dark"]`; it redefines no existing selector (asserted by test).
- `shared/design/foundation.css` only adds **opt-in** classes (`.kolbe-shell`,
  `.kolbe-grid`, `.kolbe-table-scroll`, `.kolbe-ltr`, `.kolbe-min-0`, …); no current
  component uses them.
- Legacy `--kv-*` / `--site-*` defaults keep their exact literal values, so the first
  paint is unchanged.
- `storefront/designSystem.ts` gained one extra statement that mirrors the legacy theme
  onto the new semantic variables; those variables have no consumer yet, so rendering is
  byte-identical.
- Default token values equal the approved identity: navy `#0b2a46`, warm off-white
  `#f7f5f0`, terracotta `#c9654d`, control radius `0.625rem`, surface radius `1rem`,
  Vazirmatn, Persian RTL.

---

## 8. Unresolved blockers

**None.** No backend, schema, ownership or provider blocker was found.

---

## 9. Discovered technical debt (recorded, not fixed)

1. **Accent contrast.** `accent #c9654d` with `accentText #ffffff` = **≈3.85:1** — passes
   AA for large text / UI components, fails AA for body text. The colour is part of the
   approved brand identity, so it is documented rather than changed. The 6.4 visual
   editor is the right place for the client to decide.
2. **Legacy `catch { return [] }`** in `wholesaleApi.ts`, `wholesaleVipApi.ts` and
   `supplier-src/api.ts` is still live; it can now be removed per-portal without
   redesigning anything (6.2 for Supplier).
3. **Frontend money still typed `number`** in legacy view models
   (`wholesalePrice`, `totalAmount`, …). The shared boundary carries the correct
   decimal-string type; the view models change with each portal cutover.
4. **No “my permissions” canonical endpoint.** `GET /api/v1/auth/me` returns role and
   supplier context but not granular permissions; Admin granular permissions come from
   RBAC tables (`adminRolePermission`). The session client therefore accepts an injected
   `permissionsLoader` rather than assuming an endpoint. Admin wiring (6.4) should
   confirm whether a session-scoped permission contract should be added server-side.
5. **Local theme port.** The local PostgreSQL port workaround (55400 vs 55432) is a
   developer-environment concern only; no production code references a port.
   `test/global-setup.ts` / `test/setup.ts` still default to 55432 (pre-existing).

---

## 10. Phase 6.2 readiness

**Phase 6.2 Supplier Cutover is ready to start.**

Ready because:
- one typed HTTP boundary exists and is tested against the real Nest API;
- session, capability and error primitives are in place, so Supplier can restore its
  tenant from `GET /api/v1/auth/me` instead of `/store/kolbe/supplier/session`;
- KEYSET/CURSOR/OFFSET normalization covers the Supplier list contracts;
- money/quantity helpers remove the float-authority risk in products, RFQs and finance;
- capability gating (`canUseProduction`) already distinguishes Supplier from Manufacturer.

Exact next step for 6.2 (in order):
1. Add `frontend-next/shared/supplier/` adapters over `@shared/http` + `@shared/session`
   (products, RFQs, orders, inventory, finance, support, team, compliance, production).
2. Replace `supplier-src/api.ts` call sites with those adapters — starting with the three
   `catch { return [] }` lists (products, orders, RFQs), which must surface
   `SERVER_ERROR` / `NETWORK_ERROR` instead of a fake empty state.
3. Keep `/store/kolbe/supplier/*` compatibility routes until the Supplier E2E + visual
   parity gate in 6.7.

---

## 11. File inventory

### Added (48 files)

| Area | Files |
|---|---|
| Shared HTTP | `shared/http/{errors,client,clients,url,types,index}.ts` |
| Shared session | `shared/session/{roles,types,auth-client,store,presentation-cache,react,index}.ts` |
| Shared UI | `shared/ui/{async-state,index}.ts` |
| Pagination | `shared/pagination/{pagination,index}.ts` |
| Money | `shared/money/{money,quantity,index}.ts` |
| Permissions | `shared/permissions/{capabilities,index}.ts` |
| Design | `shared/design/{tokens,css,legacy-bridge,index}.ts`, `generate-tokens.mts`, `tokens.css`, `foundation.css` |
| Boundary barrel | `shared/index.ts` |
| Tests | 9 × `test/phase-6-1-*.test.ts`, `test/fixtures/viewports.ts`, `vitest.phase-6-1.config.ts` |
| Docs | `docs/architecture/phase-6-1-shared-foundation.md`, this report |

### Changed (8 files)

| File | Change |
|---|---|
| `frontend-next/app/layout.tsx` | imports `tokens.css` + `foundation.css` (additive) |
| `frontend-next/storefront/designSystem.ts` | also emits semantic variables from the legacy theme |
| `frontend-next/tsconfig.json` | `@shared/*` path alias, `allowImportingTsExtensions`, include `shared/**` |
| `frontend-next/vitest.config.ts` | `@shared` alias for the default suite |
| `frontend-next/package.json` | `test:phase-6-0`, `test:phase-6-1`, `tokens:build` scripts |
| `frontend-next/truth-registry.ts` | new `shared-frontend-boundary` entry + delivered parity evidence |
| `frontend-next/shared/money/money.ts` | (post-commit fix) scale-aligned `compareMoney` |
| `frontend-next/shared/pagination/pagination.ts` | (post-commit fix) read metadata from nested `pagination` |
| `frontend-next/shared/session/auth-client.ts` | (post-commit fix) permission-loader failures are not downgraded to anonymous |
