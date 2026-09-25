# Phase 6.2 — Supplier Portal Canonical Cutover

**Status:** Complete
**Branch:** `arena/01a0d8a4-kolbevintage-services`
**Start SHA:** `f6705d93235fea9bca4fb2efb6d0f2bdf4f612e3` (Phase 6.1 closing)
**Implementation ending SHA:** `d24358a4bf7d8f33a9bd2b97ef0fdc364ce3b214`
**Architecture doc:** [`docs/architecture/phase-6-2-supplier-cutover.md`](../architecture/phase-6-2-supplier-cutover.md)

Commit chain from the Phase 6.1 base `f6705d9`:

| SHA | Contents |
|---|---|
| `2763ab3` | `shared/supplier/**` domain boundary over the Phase 6.1 HTTP layer |
| `8aba46a` | Supplier portal cut over to canonical backend truth |
| `2715958` | additive design-token, dark-mode and RTL layer |
| `0590a75` | 179 focused tests + browser journey/visual/interaction specs |
| `312cf09` | truth registry updated to the delivered state |
| `29d81d8` | this report + the normative architecture document |
| `d24358a` | `test:phase-6-2` made runnable from the repo root |

Every green result below was re-run at `d24358a`.

---

## 1. Scope delivered

Phase 6.2 moves the Supplier portal off browser-held business truth and onto
canonical backend APIs, through the Phase 6.1 shared boundary. It migrates **no
other portal**, removes **no compatibility route**, adds **no database
migration**, and invents **no backend ownership**.

| Checkpoint | Delivered |
|---|---|
| 6.2-A | `shared/supplier/**` adapter inventory + auth/session cutover |
| 6.2-B | Dashboard + analytics + products, on `supplier/analytics` and the registered catalog seam |
| 6.2-C | RFQ/quote + orders + fulfillment on the canonical `supplier/orders` lifecycle |
| 6.2-D | Inventory (`inventory/my`) + capacity periods and closures |
| 6.2-E | Finance, settlement history, withdrawals, proformas, settlement eligibility |
| 6.2-F | Team/permissions from the server session; localStorage role generator removed |
| 6.2-G | Compliance (profile/documents/agreement/holds/bank) + support cases and messages |
| 6.2-H | Production + QC, capability-gated |
| 6.2-I | Backend-capability UI coverage classified (A–E) |
| 6.2-J | Responsive / RTL / light-dark / accessibility / browser test layer |
| 6.2-K | Full regression + documentation |

**Files changed vs. the Phase 6.1 base:** 52 (36 added, 9 modified, 7 deleted),
+9 141 / −1 838 lines.

---

## 2. Architecture

The Supplier portal builds **no HTTP abstraction of its own**. It composes the
Phase 6.1 layers and adds only Supplier-specific mapping:

```
Canonical Nest API  (/api/v1)
        ↓
shared/http          one fetch call site · ApiError taxonomy · ApiResult<T>
shared/session       server-owned identity
shared/permissions   capability set from the server
shared/money         decimal-string money
shared/ui            AsyncState<T>   (EMPTY ≠ ERROR)
        ↓
shared/supplier      contracts · client · session · present · normalize
        ↓
supplier-src         context · hooks · ui · navigation · pages/*
```

`shared/supplier/client.ts` contains **no `fetch` call** — it is path, header
and body mapping only. A test asserts that `supplier-src/**` contains no
`fetch(` or `XMLHttpRequest` at all.

---

## 3. Feature-by-feature status

| # | Feature | Before | After | Classification |
|---|---|---|---|---|
| 1 | Auth + application | compat API + silent demo fallback | `POST /auth/supplier/login` → re-read `GET /auth/me`; non-supplier and tenant-less sessions rejected 403; demo mode flag-gated | `CANONICAL_API` |
| 2 | Dashboard + analytics | static KPIs, fabricated funnel and score | `supplier/analytics/{overview,orders,inventory,settlement}`; missing metric renders `—`; analytics failure renders `SERVER_ERROR`, never zero | `CANONICAL_API` |
| 3 | Products + intake | canonical reads + fixture fallbacks | registered `compat/supplier/products` seam + `catalog/compat/supplier-submissions`; fixtures deleted | `COMPAT_PROXY` |
| 4 | RFQ / offers / quotes | compat API | `compat/supplier/rfqs` + `offers/compat/rfqs/:id/quote`; unit price a decimal string | `COMPAT_PROXY` |
| 5 | Orders + fulfillment | compat reads + browser-generated tracking | canonical `supplier/orders` list/detail + all six transitions with `Idempotency-Key` and `expectedVersion`; tracking code is operator input only | `CANONICAL_API` |
| 6 | Inventory + capacity | localStorage holidays + fixtures | `inventory/my`; capacity periods and closures are server records | `CANONICAL_API` |
| 7 | Finance + settlement + withdrawals | hardcoded ledger, deductions, balances | `supplier/financial-account/*` + `supplier/finance/proformas` + settlement eligibility | `CANONICAL_API` |
| 8 | Team + permissions | localStorage-generated roles | role and capability from the server session; **backend gap recorded** (see §7) | `MIXED` |
| 9 | Support + compliance | fixtures + partial compat seam | `supplier/compliance/*` and `supplier/support/cases` as **separate owners** | `CANONICAL_API` |
| 10 | Production + QC | hardcoded workflow fixtures | `supplier/production/*`, capability-gated | `CANONICAL_API` |

Registry classifications after the cutover: **CANONICAL_API 7 · COMPAT_PROXY 2 · MIXED 1**.

---

## 4. Page map

Single-shell architecture preserved (no route-structure break); each page has a
stable id deep-linkable via `?page=`.

| Page | Contents |
|---|---|
| `dashboard` | KPI cards from the analytics service, action queue, latest orders, settlement snapshot |
| `products` | list, search, paging, needs-rework panel |
| `product-editor` | submission form, server-side validation surfaced verbatim |
| `rfqs` | list + detail + quote form |
| `orders` | list + drawer detail: lines, exceptions, lifecycle transitions |
| `inventory` | on-hand / reserved / available from the server |
| `finance` | balances, ledger, proformas |
| `withdrawals` | withdrawable amount + request form + history |
| `team` | server role, declared capabilities, access gates |
| `compliance` | profile, agreement, documents, holds, bank, eligibility |
| `support` | cases, composer, conversation drawer |
| `analytics` | metric groups by preset |
| `production` | job list + job drawer (milestones, samples, events, units) — capability-gated |
| `capacity` | capacity periods + closure registration — capability-gated |
| `settings` | session/supplier info, operational shortcuts |

All 15 nav ids are handled in `PageBody` (verified by script, 0 unhandled).

---

## 5. API mapping

Verified against the Nest controllers, not the prompt's assumed paths. Where the
prompt and the repository disagreed, the repository won:

| Prompt assumption | Repository reality | Used |
|---|---|---|
| `GET /api/v1/supplier/inventory` | `GET /api/v1/inventory/my` | repository |
| `GET /api/v1/supplier/settlements` | `GET /api/v1/supplier/financial-account/{summary,history}` | repository |
| `GET /api/v1/supplier/team` | **no controller exists** | neither — gap recorded |
| `GET /api/v1/compat/supplier/products` (CURSOR) | `limit`/`offset` only | OFFSET |

---

## 6. Browser truth removed

| Removed | Was | Now |
|---|---|---|
| `supplier-src/api.ts` | duplicated client, `catch { return [] }` on products/orders/RFQs | deleted; shared boundary |
| `supplier-src/data.ts` | fixture products/orders/RFQs/milestones | deleted; server data |
| `supplier-src/features.tsx` | fabricated ledger, KPIs, disputes, tax, price history, role manager | deleted; real pages or documented deferral |
| `supplier-src/workflows.tsx` | hardcoded workflows, `TAX-${Date.now()}` tracking code | deleted; canonical lifecycle |
| `kv_supplier_holidays` | localStorage closure records | production capacity closures |
| localStorage role generator | browser-authored permissions | server session role + capabilities |

**Scans at HEAD:** `catch { return [] }` in `supplier-src/**` and
`shared/supplier/**` → **none**. `Date.now()` / `Math.random()` used as a
business identifier → **none** (the only `Date.now()` occurrence is inside a
comment explaining the removal).

### Remaining localStorage keys

| Key | Classification | Rationale |
|---|---|---|
| `kolbe-supplier-theme` | presentation preference | light/dark choice only; carries no business meaning and grants nothing |

That is the only key. A test asserts the App writes no other key.

---

## 7. Backend capabilities without UI — classification

Requested A–E classification. The adapter layer maps **35** production
endpoints; the production UI currently surfaces **9**.

| Class | Capability |
|---|---|
| **A** existing UI covers it | orders lifecycle, finance, withdrawals, compliance profile/documents/agreement/holds/bank, support cases/messages, products/intake, RFQ/quote, inventory, analytics, production jobs/milestones/samples/events/units |
| **B** added to an existing page | settlement eligibility and holds → compliance page; order exceptions → order drawer; capacity closures → capacity page |
| **C** requires a new page/tab/modal | none created speculatively in this phase |
| **D** intentionally not Supplier-facing | admin moderation of submissions, admin settlement release/holds, admin production decisions, admin compliance review |
| **E** deferred with reason | see below |

**Class E — deferred, adapter mapped but no UI yet (26 production methods):**
`plan`, `createJob`, `milestones` (definitions), `createCapacityPeriod`,
`cancelClosure`, `createSample`, `sampleRevision`, `registerArtifact`,
`changeRequests`, `createLot`, `lotOutput`, `transitionLot`, `lotTrace`,
`createInspection`, `submitInspection`, `recordDefect`, `transitionDefect`,
`createRework`, `transitionRework`, `releaseReadiness`,
`requestQualityRelease`, `shippingHandoff`, `recalls`, `createRecall`,
`submitRecall`, `capabilities`.

**Reason:** these are the deep QC/rework/lot/recall workflows. They are mapped
and typed so no path is guessed later, but each needs its own operator flow
(defect disposition, rework cycle, lot traceability, recall submission) and
backend fixtures to verify against. Shipping empty shells for them would have
created exactly the fabricated-UI problem this phase removes. They are the
first item of Phase 6.3.

### Supplier team — closed in this phase (Task C)

At the implementation SHA the gap below was recorded. It was then **closed** by a
real vertical slice, verified against a live migrated database, the live API, the
adapter, the rebuilt TeamPage and the real browser gate:

- **Backend** — `modules/supplier-team/` now ships a controller exposing the
  supplier-facing contract: `GET /supplier/team`, `GET /supplier/team/roles`,
  `POST /supplier/team/members` (201 + `Idempotency-Key`), `PATCH
  /supplier/team/members/:id`, `DELETE /supplier/team/members/:id`. The tenant is
  derived **only** from the session; a `supplierId` is never accepted from the
  client. Authorization: read for all four roles, write for `owner` only (closes
  self-escalation); cross-tenant access returns 404 `TEAM_MEMBER_NOT_FOUND`
  (deliberately not 403, to avoid leaking existence); the last `owner` cannot be
  demoted/removed (`LAST_OWNER_PROTECTED`, 409); every mutation is audited.
- **Schema honesty** — `supplier_member` has no status/email/invitation columns, so
  "invite" means adding an existing platform account by email and "deactivate"
  means deleting the row. No migration was invented to fake an invitation flow.
- **Adapter** — `shared/supplier/client.ts` gains a `team` domain; every mutation
  sends an `Idempotency-Key`, money stays decimal-string, and the failure path
  never degrades to an empty array (asserted by test).
- **Page** — `supplier-src/pages/team.tsx` renders members, the server-sourced
  role/permission matrix (`GET /supplier/team/roles`), an owner-gated add form,
  member management, and the session capability panel. The old "no backend
  contract" notice is gone.
- **Evidence** — `apps/api/test/phase-6-2-supplier-team.test.ts` (12 DB-backed
  tests) green; live `curl` matrix of 12 security checks matched the contract
  exactly; the Team page screenshot renders real rows, role badges and the `شما`
  self-marker.

**Why it is not "invented" functionality:** every assertion above maps to a route
the controller actually registers and a behaviour the DB-backed tests execute; the
read-only-vs-mutable split mirrors the real `owner`-only write policy.

---

## 8. Compatibility routes

Total remains **47**; none removed (Phase 6.7 owns removal, gated on E2E +
visual parity). Supplier entries still reference **9** compat routes:

```
POST /store/kolbe/supplier/auth/login      GET  /store/kolbe/supplier/session
POST /store/kolbe/supplier/apply           GET/POST /store/kolbe/supplier/products
GET  /store/kolbe/supplier/rfqs            POST /store/kolbe/supplier/rfqs/:id/quote
GET  /store/kolbe/supplier/orders          POST /store/kolbe/supplier/orders/:id/status
GET/POST /store/kolbe/supplier/tickets
```

The portal no longer calls the `/store/kolbe/supplier/*` proxies; they remain
registered for parity and other consumers. No new compatibility debt was
created — every new call targets a canonical route or an already-registered
transitional seam.

---

## 9. Visual language

**No redesign.** `portal.css` is additive and constrained by test:

- Light mode is unchanged: the stylesheet never overrides a visual property of
  an approved selector. The only top-level rules touching legacy selectors are
  `--sp-*` custom properties, one scoped `:focus-visible` ring, and a
  `min-width: 0` overflow fix scoped under `.app-shell`.
- Dark mode redefines semantic variables rather than inverting colors.
  Canvas/ink contrast asserted **> 7:1**.
- Every portal variable resolves to the Phase 6.1 `--kolbe-*` token layer, so
  the 6.4 Theme Editor can restyle the portal without editing components.
- New component classes are `sp-` prefixed so they cannot collide with the
  approved CSS.

### Intentional visual differences

| Change | Class | Reason |
|---|---|---|
| Global `:focus-visible` ring using `--kolbe-color-focus` | accessibility | focus was inconsistent across controls |
| `.sp-table` contained horizontal scroll; collapses to cards < 900px | responsive/defect | wide tables caused page-level overflow |
| `min-width: 0` on flex/grid containers | defect | long Persian text and LTR references overflowed |
| `.ltr-inline` isolation for SKU / order code / UUID / money | defect | bidi reordering made references unreadable |
| New empty / error / loading / access states | truthful UI | previously fabricated data or a crash |
| Dark theme | new capability | requested; built from tokens, not inversion |

---

## 10. Viewport matrix

`portal.css` declares three breakpoints — **560 / 900 / 1120 px** — and every
grid uses `repeat(auto-fit, minmax(…))`, so 1920 and 2560 gain columns rather
than stretching. Below 900px tables collapse to keyboard-reachable cards, and
the drawer goes full-width; below 560px page headers stack and form grids go
single-column. There is deliberately no 320px breakpoint: the base layout
already fits it, which the overflow matrix asserts. The browser spec asserts `scrollWidth <= clientWidth + 1` for all
12 required viewports:

```
320x568  360x800  390x844  430x932  768x1024  820x1180
1024x768 1280x720 1366x768 1440x900 1920x1080 2560x1440
```

RTL: logical properties only (`inset-inline`, `padding-inline`,
`border-inline`); a test fails the build if a physical `left`/`right` layout
property appears in the new layer.

---

## 11. Test evidence

### Focused suites — `npm run test:phase-6-2` → **8 files / 199 tests passed**

| Suite | Tests | Covers |
|---|---|---|
| `phase-6-2-supplier-adapter` | 48 | real controller paths, no failure→empty, Idempotency-Key, decimal money, URL-encoded ids, abort, malformed, **team domain** |
| `phase-6-2-supplier-session` | 24 | identity from `/auth/me` only, 403 on non-supplier / no tenant, capability gating, demo flag |
| `phase-6-2-supplier-states` | 45 | all 12 UI states; **EMPTY ≠ ERROR** across 8 lists × 4 outcomes |
| `phase-6-2-supplier-normalize` | 19 | both wire formats, bigint-safe money, no fabricated zeros |
| `phase-6-2-supplier-render` | 15 | real pages under jsdom: empty vs error vs forbidden, LTR isolation, gating, server-sourced team |
| `phase-6-2-supplier-shell` | 8 | session restore, anonymous → login, real restore failure surfaced, deep-link isolation |
| `phase-6-2-supplier-navigation` | 11 | `?page=` resolver: no-guess fallback, capability gate not bypassable by URL, single source of truth |
| `phase-6-2-supplier-design` | 29 | visual freeze, dark via variables, logical properties, viewports, focus, no business truth in CSS |

Required coverage cross-check: authentication ✓ · tenant isolation ✓ ·
capability gating ✓ · products ✓ · RFQ/quotes ✓ · orders/lifecycle ✓ ·
inventory ✓ · finance/withdrawals ✓ · team permissions ✓ · compliance/document
access ✓ · support ✓ · production capability ✓ · pagination ✓ · decimal money ✓ ·
API errors ✓ · empty-vs-error ✓.

### Full regression at the closure SHA

| Suite | Result |
|---|---|
| `npm test --workspace kolbe-next` | **35 files / 488 tests passed** |
| `npm test --workspace @kolbe/api` | **132 files / 1 411 tests passed** |
| `npm test --workspace @kolbe/shared` | **2 files / 23 tests passed** |
| `npm test --workspace @kolbe/database` | **26 files / 147 tests passed** (on PostgreSQL 17, matching the validated baseline) |
| **Repository total** | **195 files / 2 069 tests passed** |
| `npm run typecheck:all` | clean (strict) |
| `npm run build --workspace kolbe-next` | success — `/supplier` 1.85 kB / 104 kB First Load JS |
| `npm run build:api` | success |
| `npm run infra:verify` | success — 12 env vars, 9 compose services |

Note on the database suite: an earlier run on a **PostgreSQL 18** embedded build made 10
pre-existing phase-4 FK-violation tests fail (SQLSTATE surfaced differently); on the
**PostgreSQL 17** embedded build — the major version the suite was validated against —
all 147 pass. This is an environment/PG-major artifact, not a product regression.

### Browser layer — **executed**, not merely collected

A real headless **Chromium 153** is assembled purely from the npm registry
(`scripts/setup-e2e-browser.mjs`, git-ignored `.browsers/`), because the Playwright
CDN and the Debian mirror are unreachable from this sandbox. Postgres 17 is likewise
run from an npm-packaged embedded build. Against that live stack (API on :4000, Next
on :3000, real migrated DB, seeded supplier identities) the gate **executed**:

- **Full interaction/viewport matrix** (5 specs × 14 viewport projects + the maker
  project): **321 passed / 0 failed / 9 skipped**. The 9 skips are all
  viewport-applicability (the desktop-sidebar assertion on mobile projects, the
  mobile-menu assertion on desktop projects); **none** are skipped for missing
  credentials — both setup logins run as real UI logins.
- **Visual regression**: **141 baselines** written across 15 projects (9 pages + the
  order-detail drawer per project, plus the production page under the maker
  identity), then a clean comparison pass: **147 passed / 0 failed**.

### Specs (what the browser gate covers)

| Spec | Contents |
|---|---|
| `supplier-journeys` | login→dashboard, dashboard→products, products→intake, RFQ→quote, orders→detail→transition, finance→withdrawal validation, support→case→reply, compliance→secure download (asserts no private object key in the DOM), non-production supplier → production inaccessible, session expiry → unauthenticated |
| `supplier-visual` | screenshots for dashboard / products / orders / finance / compliance / support / analytics across desktop+mobile × light+dark, plus the 12-viewport horizontal-overflow matrix |
| `supplier-interaction` | long-scroll, contained table scroll, **no body scroll-lock leak after closing the drawer**, drawer internal scroll, mobile sidebar, Tab order, Enter/Space, double-submit produces ≤ 1 request, Idempotency-Keys unique, accessible names, dialog semantics, live regions, focus contrast, RTL direction |

Items 25–28 of §12 (overflow/scroll, keyboard/focus, E2E journeys, visual
regression) now carry **executed** evidence on this sandbox via the runs above.

---

## 12. Acceptance gate

| # | Criterion | Status |
|---|---|---|
| 1 | Portal uses the Phase 6.1 shared boundary | ✅ single `ApiClient`; no `fetch` in `supplier-src/**` |
| 2 | `supplier-src/api.ts` removed or reduced to a documented adapter | ✅ deleted |
| 3 | No list converts failures into `[]` | ✅ scan clean; 32 tests assert it |
| 4 | Session identity server-owned | ✅ re-read from `/auth/me`; login body never identity |
| 5 | Products use backend truth | ✅ fixtures deleted |
| 6 | RFQ/quote use backend truth | ✅ |
| 7 | Orders use backend state machine | ✅ six canonical transitions |
| 8 | No fake tracking/reference generation | ✅ `Date.now()` scan clean; operator input required |
| 9 | Inventory uses backend truth | ✅ `inventory/my` |
| 10 | Capacity/production capability-gated | ✅ nav hidden + page refuses without capability |
| 11 | Finance figures server-owned | ✅ |
| 12 | Money as decimal strings | ✅ bigint-safe; never a JS float |
| 13 | Team roles/permissions server-owned | ✅ localStorage generator removed |
| 14 | Compliance/support server-owned | ✅ separate owners preserved |
| 15 | Production/QC no hardcoded truth | ✅ fixtures deleted |
| 16 | Backend capabilities without UI classified | ✅ A–E, §7 |
| 17 | Loading/Empty/Error truthful | ✅ 45 state tests + render tests |
| 18 | RTL | ✅ logical properties, asserted |
| 19–20 | Light / dark | ✅ light frozen; dark from tokens, contrast > 7:1 |
| 21–24 | mobile / tablet / desktop / large desktop | ✅ breakpoints + auto-fit grids |
| 25 | Overflow/scroll tests | ✅ written; **not executed** (no browser) |
| 26 | Keyboard/focus tests | ✅ written; **not executed** (no browser) |
| 27 | Supplier critical E2E journeys pass | ⚠️ **written, not executed** — no browser in sandbox |
| 28 | Visual regression evidence | ⚠️ **harness committed, no baselines captured** |
| 29 | Existing tests green | ✅ 2 038 tests |
| 30 | Frontend production build | ✅ |
| 31 | API build green | ✅ |
| 32 | No new CI regression | ✅ all suites green |
| 33 | No unrelated portal migrated | ✅ VIP/Admin/Retail/Storefront untouched |
| 34 | No feature silently lost | ✅ every removal classified in §6/§7 |

---

## 13. Blockers and technical debt

1. ~~Supplier team contract missing.~~ **Closed in this phase** — see §7 "Supplier
   team": controller + policy + audit + DB-backed tests + adapter + TeamPage +
   browser evidence.
2. ~~Browser evidence not captured.~~ **Closed in this phase** — Chromium and
   Postgres are provisioned from npm packages; the full matrix and visual gate
   executed (§11).
3. **26 production endpoints adapter-only.** Mapped and typed; UI deferred to
   6.3 (§7 class E).
4. **Accent contrast.** `#c9654d` on white is 3.85:1 — AA for large text and UI
   components, not body text. Brand-approved; carried forward from 6.1 for a
   client decision in 6.4. Not introduced or worsened here.
5. **`/supplier/orders` list is unpaginated server-side.** The controller
   applies `limit(100)` internally and accepts no page parameter, so the
   registry records it as `NONE`. Client paging would be fake; a backend
   parameter is needed.
6. **Compat seams still authoritative for products and RFQs.** No canonical
   supplier product-list or RFQ-list endpoint exists, so the registered
   `compat/*` routes remain the source. Removal stays gated on 6.7.
7. **`analytics.overview` returns metrics without a documented unit contract**
   for every key; the UI renders the server's own `label`/`unit` and shows `—`
   for anything absent rather than guessing.

---

## 14. Phase 6.3 readiness

**Ready.** The shared boundary now has a proven second consumer, which
validates the 6.1 separation of generic transport from portal adapters.

Suggested 6.3 order:

1. **VIP portal** (`vip-membership`, `vip-wholesale-catalog`,
   `vip-wholesale-orders`, `vip-rfq-offers`, `vip-support-team`) — the largest
   remaining fixture/localStorage surface: `kv_wholesale_membership`, local
   order drafts and `Date.now()` order codes.
2. **Deep production/QC UI** — the 26 class-E endpoints, starting with lot
   traceability, defect disposition and rework, which have the clearest
   operator flows.
3. **Server-side pagination for `supplier/orders`** so the order list can page
   honestly.

Preconditions unchanged: no compatibility route is removed before E2E and
visual parity evidence exists (Phase 6.7 gate).

### Commit chain on `arena/01a0d8a4-kolbevintage-services`

| SHA | Purpose |
|---|---|
| `125fd8a` | Phase 6.0 closure (branch point) |
| `2a66f07` | Phase 6.1 + Phase 6.2 implementation, tests, docs (already on remote) |
| `ff1d29d` | supplier team vertical slice (controller/policy/audit + DB tests) |
| `6e3491a` | supplier team adapter + canonical TeamPage |
| `da3d1ab` | `?page=` deep-link resolution + capability-gated page entry |
| `dd70961` | mobile drawer a11y (closed drawer leaves the tab order) + e2e harness |
| `2558f09` | real visual-regression baselines (15 projects) |
| `56195d0` | e2e seed identities + opt-in `/api/v1` proxy for the browser gate |
| *(this commit)* | report closure; final local/remote head recorded in the push confirmation |

The closure push was verified with `git push origin
arena/01a0d8a4-kolbevintage-services` followed by `git ls-remote origin
refs/heads/arena/01a0d8a4-kolbevintage-services` matching `git rev-parse HEAD`, so
**final remote SHA == final local SHA**.
