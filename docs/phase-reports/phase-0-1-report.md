# Phase report — PROMPT 0 (Master Architecture & Engineering Rules)

**Date:** 2026-09-17 · **Branch:** `arena/01a0ad1f-kolbevintage-services`
**Scope agreed with the product owner:** *foundations + live P0 hot-fixes*, strangler migration,
npm workspaces.
**Verification status:** typecheck ✅ · 73 tests ✅ · storefront build ✅ · API boot smoke test ✅ ·
infra static review ✅ (and it caught a real defect) · Docker images ⚠️ **not built or run**
(no Docker daemon in this environment).

---

## 1. Files created

### Governance

| File | Purpose |
|---|---|
| `docs/architecture/master-architecture-rules.md` | The binding charter: target stack, 20 non-negotiable rules each mapped to its enforcement mechanism, the 37-module ownership registry, conventions, legacy registers, phase plan. |
| `docs/adr/ADR-004-strangler-nestjs-modular-monolith.md` | Supersedes ADR-003's decision paragraph; records the strangler strategy, accepted costs and rollback. |
| `docs/phase-reports/phase-0-1-report.md` | This report. |

### Backend (NestJS modular monolith) — `apps/api`

| File | Purpose |
|---|---|
| `src/main.ts` | Bootstrap: `/api/v1` prefix, fail-closed config, CORS allow-list, OpenAPI, binds `0.0.0.0`. |
| `src/app.module.ts` | Root module; global exception filter, global session guard (closed by default), validation pipe. |
| `src/openapi.ts` | OpenAPI document shared by bootstrap and tests, so the spec cannot silently drift. |
| `src/config/configuration.ts` | Typed config + validation; production refuses to boot without a strong session secret, allowed origins and S3 settings. |
| `src/database/database.module.ts` | Single connection owner; pings the database on startup and fails fast. |
| `src/common/session.ts` | Legacy-compatible HMAC session verifier, cookie issuance, dual-read token extraction, role guard helpers. |
| `src/common/guards/session.guard.ts` | `@Public()` / `@Roles()` / `@CurrentUser()`; identity comes only from the signed token. |
| `src/common/filters/domain-exception.filter.ts` | Stable `{error, message, requestId}` contract; never leaks internals; logs 5xx. |
| `src/modules/registry.ts` | The 37 domains with owned tables, dependencies, status and phase — the machine-readable half of rules A1–A3. |
| `src/modules/health/*` | Public health endpoint that actually probes the database. |
| `src/modules/audit/*` | First live module: owns `audit_log`, writes inside the caller's transaction, read-only API for admins. |

### Shared packages

| File | Purpose |
|---|---|
| `packages/shared/src/money.ts` | bigint-only money arithmetic, integer basis-point percentages, string serialization, currency-aware summing. |
| `packages/shared/src/order-status.ts` | Transition tables for wholesale orders, supplier child orders, retail orders, payments, shipments, settlements, withdrawals + precondition helpers. |
| `packages/shared/src/idempotency.ts` | Key validation, provider-event key derivation, `withIdempotency`. |
| `packages/shared/src/errors.ts` | `DomainError` hierarchy, stable codes, `toPublicError`. |
| `packages/database/src/schema/tables.ts` | Drizzle schema mirroring the live database 1:1, with every money column `bigint`. |
| `packages/database/src/index.ts` | `createDatabase`, `withTransaction`. |
| `packages/database/migrations/0000_baseline.sql` | Generated baseline migration. |
| `packages/database/migrations/0001_audit_log_append_only.sql` | Database-level trigger making `audit_log` insert-only. |
| `packages/database/migrate.mjs` | Forward-only migration runner with `--status`. |

### Live API hot-fixes (`frontend-next`)

| File | Purpose |
|---|---|
| `server/retail-pricing.ts` | **Server-side pricing authority**: resolves every line from the catalogue, validates contact/address/size/payment method, computes totals in bigint, versions the price book. |
| `server/http-error.ts` | Shared `HttpError` + stable error codes used by the handler and the pricing authority. |

### Infrastructure

| File | Purpose |
|---|---|
| `infra/docker/api.Dockerfile`, `storefront.Dockerfile`, `portal.Dockerfile` | Multi-stage images with health checks and non-root users. |
| `infra/compose/docker-compose.dev.yml` | Postgres 16 / Redis 7 / MinIO for local development (ports do not clash with the embedded Postgres on 55432). |
| `infra/compose/docker-compose.prod.yml` | Production stack with a one-shot `migrate` job gating API startup. |
| `infra/nginx/kolbe.conf` | The migration control point: `/api/v1/*` → NestJS, legacy and portal routes → their upstreams, rate limits, security headers. |
| `infra/nginx/kolbe-proxy-params.conf`, `portal-spa.conf` | Shared proxy parameters and the static-portal server block. |
| `infra/.env.example` | Every variable the stack needs, with generation hints. |
| `scripts/verify-infra.mjs` | Static infrastructure review: parses every Compose file, resolves each Nginx upstream against a Compose service, checks `build.dockerfile`/`context`/`depends_on`/volume paths, verifies `include` targets exist, and compares Compose `${VAR}` references against `infra/.env.example`. Runnable and CI-safe without Docker. |
| `infra/ci/ci.yml` | Five jobs (infra, shared, database, api, storefront) running the verification gates. **Not in `.github/workflows/` yet** — see the note below. |

### Infrastructure defects found and fixed before commit

`infra/` could not be built here, so it was reviewed structurally instead — and that review found
three real defects in the draft configuration:

1. **Nginx would not have started at all.** The config declared an upstream
   `kolbe_supplier_portal → supplier_portal:8080`, but no such service exists in
   `docker-compose.prod.yml` (and none is needed today: the supplier portal is served by Next.js at
   `frontend-next/app/supplier/page.tsx`). Nginx resolves upstream hostnames at startup and aborts
   with *host not found in upstream* when it cannot. The first production deploy would have failed
   outright, and even if it had started, `/supplier` would have stopped serving the working portal.
   Fixed by routing `/supplier` to the storefront; the extracted-portal upstreams stay commented out
   with a note that phase 7 must add their Compose services first.
2. **Hardcoded `Connection: upgrade`.** `kolbe-proxy-params.conf` sent the upgrade header on every
   request, which corrupts keepalive to the upstreams. Now driven by
   `map $http_upgrade $kolbe_connection_upgrade`.
3. **The API runtime image could not install.** Root `package.json` declares `frontend-next`,
   `frontend-supplier` and `frontend-kolbe` as explicit workspace paths, but the runtime stage copied
   only the API and package manifests, so `npm ci` would have failed for missing workspaces. All
   manifests are now copied in every stage.

`scripts/verify-infra.mjs` encodes these checks. It is **proven** against defect 1: re-introducing
the broken upstream makes it exit 1 with an explanatory message, and reverting makes it pass.

#### CI cannot be committed to `.github/workflows/` from this session

GitHub rejected the push:

```
! [remote rejected] ... (refusing to allow a GitHub App to create or update
  workflow `.github/workflows/ci.yml` without `workflows` permission)
```

The workflow is therefore committed at `infra/ci/ci.yml`, whose header explains how to activate it
(move it to `.github/workflows/ci.yml`, or grant the GitHub App the `workflows` permission and let it
be moved). Its content is location-independent and needs no edits.

---

## 2. Files changed

| File | Change |
|---|---|
| `frontend-next/server/kolbe-api.ts` | D1/D2/D3 fixes; session cookies + `/auth/logout`; env-driven CORS; idempotency keys; audit writes on 10 mutation paths; new `GET admin/audit-logs`; status whitelists; integer basis-point bulk pricing; server-side video validation; rewritten error boundary. |
| `frontend-next/server/database.ts` | Lazy connection string and pool (testability); exported `schema`; Phase 0 DDL: new `retail_order` columns + partial unique idempotency indexes, `retail_order_item`, `audit_log` + append-only trigger. |
| `frontend-next/storefront/lib/api.ts` | `credentials: "same-origin"`, arbitrary headers (idempotency key). |
| `frontend-next/storefront/pages/Checkout.tsx` | Sends `Idempotency-Key`; uses server totals; surfaces price adjustments. |
| `frontend-next/storefront/lib/wholesaleVipApi.ts` | Membership status type; no local activation; accurate pending/rejected messages; read-only `loadWholesaleMembership()`. |
| `frontend-next/storefront/pages/Wholesale.tsx` | "Awaiting approval" state instead of locally granted wholesale access. |
| `package.json` | `apps/*` and `packages/*` workspaces; root `test`, `typecheck`, `test:all`, `typecheck:all`, `build:packages`, `build:api`, `dev:api`, `db:migrate`, `infra:dev`. |
| `.gitignore` | `packages/*/dist/`. |

---

## 3. Schema changes

All idempotent (`CREATE … IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) and mirrored 1:1 in
`packages/database`; the parity test proves the two definitions agree.

| Object | Change | Reason |
|---|---|---|
| `retail_order` | `+ items_total bigint`, `currency`, `price_book_version`, `payment_method`, `amount_source`, `customer_id`, `order_status`, `idempotency_key` | Server-computed totals, price-book provenance, attributable customer, explicit order status, duplicate-submit protection. |
| `retail_order` | `+ unique index retail_order_idempotency (idempotency_key) WHERE NOT NULL` | Idempotency without blocking legacy NULL rows. |
| `retail_order_item` **(new)** | Structured snapshot lines: product, sku, name, colour, size, quantity, `unit_price`, `line_total`, image | Orders stop being opaque jsonb blobs; per-line history is immutable. |
| `wholesale_order` | `+ idempotency_key` + partial unique index | Same guarantee for the wholesale checkout. |
| `audit_log` **(new)** | `id, actor_id, actor_role, actor_ip, action, entity_type, entity_id, before, after, metadata, request_id, created_at` + 3 indexes | Rule A17 (auditable admin operations) and A13 (append-only history). |
| `audit_log` trigger | `audit_log_append_only` BEFORE UPDATE/DELETE → raises | Append-only enforced by the database, not by convention. |

**No destructive change.** No column was dropped, renamed or retyped; every existing row remains valid.

---

## 4. APIs created / changed

### New (legacy handler)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/store/kolbe/auth/logout` | Clears the session cookie. |
| `GET` | `/store/kolbe/admin/audit-logs` | Admin-only; filter by `entityType`/`entityId`, limit ≤ 200. |

### New (NestJS, `/api/v1`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/health` | Public; real database probe, env/uptime/redis/storage status. |
| `GET` | `/api/v1/audit/logs` | Admin-only; same data as the legacy endpoint, proving identity parity. |
| `GET` | `/api/v1/docs`, `/api/v1/openapi.json` | OpenAPI document served by the running service. |

### Changed contracts

| Method | Path | Change |
|---|---|---|
| `POST` | `/store/kolbe/retail/orders` | **Was 500 for every request.** Now: 201 `{orderCode, status, replayed, currency, totals:{items,shipping,total}, adjusted}`; 200 with `replayed:true` on a repeated `Idempotency-Key`; server-priced; structured item rows. |
| `POST` | `/store/kolbe/wholesale/apply` | **Was self-approving.** Now always records `pending`, never escalates the role, returns the membership with its status. |
| `GET` | `/store/kolbe/wholesale/account` | Returns the latest membership plus `active`, so the UI can render "awaiting review" instead of a hard 403. |
| `POST` | `/store/kolbe/admin/accounts/:id/status` | Status whitelist; only path that grants/revokes the `vip` role; audited. |
| `POST` | `/store/kolbe/admin/catalog/bulk-price` | `mode` whitelist, ≤500 rows, integer basis-point percentage math; audited. |
| `POST` | `/store/kolbe/admin/catalog/:id/status` | Status whitelist, row lock, audited, 404 for unknown products. |
| `PUT` | `/store/kolbe/admin/site-settings` | Embedded videos validated (mp4/webm, ≤25 MB) before storage; audited. |
| `POST` | `/store/kolbe/auth/login`, `/store/kolbe/supplier/auth/login` | Additionally issue the `kolbe_session` HttpOnly cookie. Bearer tokens still returned, so existing clients keep working. |

---

## 5. Tests added

**73 tests, all passing** (`npm run test:all`). Typecheck clean on all four workspaces
(`npm run typecheck:all`); storefront production build succeeds.

| Workspace | File | Tests | What it locks down |
|---|---|---|---|
| `frontend-next` | `test/retail-checkout.test.ts` | 14 | Checkout returns 201 (regression for D1 — verified to fail with `500` when the fix is reverted); price tampering ignored and flagged; server totals persisted; structured item rows; unknown product/size/phone/address/cart rejected; one order per idempotency key; BNPL retail-only. |
| `frontend-next` | `test/vip-membership.test.ts` | 7 | Apply yields `pending` and does not escalate the role; no wholesale access before approval; only an admin can approve; repeated applications do not reset a pending one; rejection revokes access. |
| `frontend-next` | `test/audit-log.test.ts` | 4 | `audit_log` rejects UPDATE/DELETE; VIP approval and catalogue moderation write before/after records; bulk price uses integer math and round-trips. |
| `frontend-next` | `test/session-security.test.ts` | 6 | HttpOnly/SameSite cookie issued; Bearer and cookie both accepted; forged and expired tokens rejected; logout clears the cookie; CORS refuses unknown origins in production. |
| `packages/shared` | `test/money.test.ts` | 11 | Floats rejected; exact integer arithmetic; half-up rounding; string serialization; multi-currency summing. |
| `packages/shared` | `test/order-status.test.ts` | 10 | Legal/illegal transitions, no stage skipping, terminal states, tracking precondition, table self-consistency. |
| `packages/database` | `test/schema-parity.test.ts` | 4 | Legacy DDL and Drizzle migrations produce identical tables/columns/types/nullability; no money column is floating point; the append-only trigger exists on the migration path. |
| `apps/api` | `test/module-boundaries.test.ts` | 8 | Registry integrity, no duplicate table ownership, every module directory registered, no module references another module's tables, no deep cross-module imports. |
| `apps/api` | `test/api.e2e.test.ts` | 9 | Boots against a migrated database; health public; audit closed to anonymous/customer; forged token rejected; token issued by the legacy algorithm works (identity parity); append-only enforced; OpenAPI served; production config fails closed. |

---

## 6. Remaining technical debt

| ID | Debt | Where | Phase |
|---|---|---|---|
| T1 | The legacy `kolbe-api.ts` handler still owns every live domain; only `audit` and `health` exist in NestJS. | `frontend-next/server` | 2–4 |
| T2 | `PricingError`-style pricing lives in the transition layer; `retail_pricing` still reads the hardcoded catalogue, so an admin's `localStorage` price edit and the server price book can disagree. The `adjusted` flag surfaces this instead of hiding it. | `server/retail-pricing.ts` | 3 |
| T3 | Tokens remain in `localStorage` in the browser; the server now issues HttpOnly cookies but clients do not rely on them yet. | `storefront/lib/api.ts` | 2 |
| T4 | Sessions cannot be revoked and there is no refresh rotation, 2FA or rate limiting inside the app (Nginx limits login attempts). | `common/session.ts` | 2 |
| T5 | Retail catalogue, CRM, wallets, campaigns, policies and blog content still live in browser `localStorage`. | `storefront/**` | 3–4 |
| T6 | `audit_log` doubles as the order-event log. The target schema separates `order_events` (orders module, append-only) from `audit_logs` (audit module). | `apps/api/src/modules/registry.ts` | 4 |
| T7 | `rfq`, `quote`, `site_setting` have no owning module yet and are listed in `UNASSIGNED_TABLES`; the boundary test fails if a new table appears without an owner. | `apps/api/src/modules/registry.ts` | 3, 6 |
| T8 | `drizzle-kit` cannot express partial unique indexes, so the generated idempotency indexes drop the `WHERE idempotency_key IS NOT NULL` predicate. Functionally equivalent (Postgres treats NULLs as distinct) but a future `generate` will want to touch them. | `packages/database/src/schema/tables.ts` | 2 |
| T9 | Legacy inline DDL still runs at runtime; the migration path is proven equivalent but not yet the one serving traffic. | `frontend-next/server/database.ts` | 1.2 |
| T10 | Docker images, Compose stacks and the Nginx configuration have **never been executed** (no Docker daemon here). `npm run infra:verify` covers their structure and already caught three defects, but it cannot substitute for building the images and running `nginx -t`. Smoke-test on a Docker host before any deployment claim. | `infra/**` | 1.3 |
| T11 | No Redis/BullMQ consumers, no S3 upload path, no notifications; `health` reports both as `not_configured`. | `apps/api` | 5–6 |
| T12 | `frontend-kolbe/`, `frontend-supplier/` and `apps/supplier/` remain as deprecated Vite forks; never edit them. | repo root | 7 |
| T13 | The storefront still ships `typescript.ignoreBuildErrors`; CI compensates with an explicit `tsc --noEmit`, but the flag should be removed once the 19k-line SPA is fully typed. | `frontend-next/next.config.ts` | 7 |
| T14 | `next start` loads `next.config.ts`, while `typescript` is a devDependency excluded by `--omit=dev` in the storefront runtime image. Next is expected to transpile the config itself; the first real container run must confirm this, and the remedy is one line. | `infra/docker/storefront.Dockerfile` | 1.3 |

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Docker/Nginx/Compose are unverified configuration. | 🔴 high for deployment | A structural review found three defects, including one that would have prevented Nginx from starting; the review is now automated. Still no image has been built — treated as untested, and no deployment has been claimed. |
| The new server price book may reject a size or price that legacy clients send, whereas the old (broken) endpoint accepted anything. Sizes and products are validated against the same catalogue the UI renders, so drift is limited; the `adjusted` flag and explicit error codes make failures diagnosable rather than silent. | 🟠 medium | Monitor 4xx codes on `/retail/orders` after deploy; the catalogue import error path returns actionable codes. |
| VIP applicants now wait for an admin. Any pending application created before this change will show as "awaiting approval" and needs a decision. | 🟠 medium | `admin/accounts` already lists them; approval is one call. |
| The `adjusted` messaging appears only after the order is placed; a customer whose total changed sees the corrected figure on the confirmation screen. | 🟡 low | Pre-checkout total preview is a phase-3 catalogue task. |
| Two HTTP surfaces and two identity mechanisms during the strangler. | 🟡 low | Same verifier and same secret on both surfaces, proven by a test. |
| `node_modules` (707 MB) dominates the repository snapshot. | 🟡 low | Git-ignored; a 128 MB / 10 000 file patchset cap applies to generated artefacts, not to the working tree. |
| CI is committed but **not active**: the GitHub App token lacks the `workflows` permission, so the workflow sits at `infra/ci/ci.yml` and nothing runs on push. The gates were all executed manually and pass, but there is no automated enforcement until the file moves. | 🟠 medium | One move or one permission grant; the file's header documents both. |

---

## 8. Next recommended phase

**Phase 1.2 — make `packages/database` the single schema authority.**
Replace the runtime inline DDL with a migration check on boot (fail fast on version mismatch), then
delete the duplicated `schema` string. The parity test already proves equivalence, so this is a
low-risk, well-guarded step.

**Immediately after: phase 1.3 — deployability proof.**
Build the images, run the dev Compose stack, execute `migrate.mjs` inside it and hit
`/api/v1/health` through Nginx. Until that passes, no part of `infra/` should be treated as working.

**Then phase 2 — auth cut-over.** Port login, cookies, RBAC and revocation to `auth`, keep a parity
test against the legacy handler, and flip the Nginx location. That unblocks phase 3 (catalogue),
which is the dependency for removing the `localStorage` price book and closing T2 and T5.

---

### Honest summary

The three P0 defects found by the audit are fixed **and** regression-tested: retail checkout works,
VIP membership can no longer be self-approved, and order totals are computed server-side. The
foundations for the target architecture are in place and enforced by tests — module ownership,
money rules, state machines, schema parity and append-only history are now checked facts rather
than intentions.

What has **not** been proven: nothing in `infra/` has been executed, and the live product still runs
on the legacy handler for every domain except audit. No production-readiness claim is made for
either.
