# Phase 1.5 report — closing the actively harmful production holes

Date: 2026-09-17 · Branch: `arena/01a0ad1f-kolbevintage-services` · Base: `68cacb6`
Scope authority: [blueprint §9](../architecture/prompt-1-audit-and-migration-blueprint.md#9-risk-ranked-migration-plan-strangler)
(gap-fix list) and [charter](../architecture/master-architecture-rules.md) rules A1–A20.

> **Status statement.** Everything claimed below was executed in this environment
> (`npm run typecheck:all`, `npm run test:all`, `npm run infra:verify`, `npm run build`).
> What is **not** claimed: Docker/Compose/Nginx were still not executed (no Docker on this host),
> so `infra/` remains *written but unproven*. No production-readiness claim is made for any
> domain that is not listed as green in §5.

---

## 1. What phase 1.5 was

Ten small, local, testable fixes to holes that were *actively exploitable or misleading in
production today*, ordered by risk ÷ effort. Nothing else: no payment/ledger domain, no schema
cut-over (1.2), no deployability proof (1.3), no auth migration (2), no broad rewrite.

| # | Item | Intent | Result |
|---|---|---|---|
| 1 | **D18** demo seed | Demo accounts existed in every environment, admin password in the repo | ✅ fixed + tested + replacement tool |
| 2 | **D26** SQLSTATE leak | DB error codes were part of the public API contract | ✅ fixed + tested |
| 3 | **D21** `logs/client` | Unauthenticated, unlimited write primitive into `system_log` | ✅ fixed + tested |
| 4 | **D20** Try-On | Paid third-party calls reachable without a session, no caps | ✅ fixed + tested |
| 5 | **D25** supplier prices | Negative price accepted (201), decimal price → 500 | ✅ fixed + tested |
| 6 | **D23** wholesale payment method | `paymentMethod` was read and ignored | ✅ fixed + tested |
| 7 | **D22** BNPL | Installment advertised inside the wholesale (VIP) portal | ✅ fixed + tested |
| 8 | **D24/D38** fake controls | Wallet/roles/2FA/integrations wrote only to `localStorage` | ✅ fixed + tested |
| 9 | **D29** `previewMode.ts` | Dead bypass of both panel logins shipped in the bundle | ✅ deleted + tested |
| 10 | **D19a** retail payment honesty | Orders claimed "awaiting gateway" with no gateway existing | ✅ fixed + tested |

Test count: **73 → 127** (`frontend-next` 31 → 85, `packages/shared` 21, `packages/database` 4,
`apps/api` 17). No test was deleted, skipped or renamed into a weaker form.

---

## 2. Item-by-item: what changed and why

### ① D18 — the demo seed no longer runs in production

**Was:** `initialize()` ran `seed()` unconditionally in every environment, creating
`admin@kolbe.ir` / `KolbeAdmin1404!`, `vip@boutique.ir`, `nilgoon@kolbe.ir` plus an approved
supplier, an approved VIP account and three products. The password is written in this repository.

**Now:** `frontend-next/server/database.ts`

- `demoSeedDecision(env)` — planting happens **only** when `NODE_ENV !== "production"` **and**
  `KOLBE_SEED_DEMO_DATA === "true"`. Default is *off*: forgetting the flag leaves an empty database
  (recoverable), not a public admin account (not recoverable).
- `prepareDatabase(client, env)` — split out of `initialize()` so a test can pass an explicit
  environment against a real database. It logs a loud warning when planting.
- `seedDemoData(client)` — the old `seed()`, still idempotent. It was also hardened: the fixed-id
  VIP membership insert now carries `ON CONFLICT (id) DO NOTHING`, so a re-seed can no longer break
  on the primary key (found by the new test).
- `scripts/create-admin.mjs` — **the replacement for the only thing the seed legitimately provided.**
  Operator-run, password from the environment, no default, rejects < 12 characters, writes the same
  scrypt record (`passwordRecord`) the app verifies, idempotent, prints the password nowhere.
- Harness/ops plumbing: `frontend-next/test/setup.ts` sets the flag (existing tests log in as the
  demo admin), `restartable dev` (`scripts/dev-all.mjs`) sets it for local development,
  `infra/ci/ci.yml` sets it for CI, `infra/.env.example` documents it and ships `false`.

**Regression test:** `frontend-next/test/demo-seed-guard.test.ts` (7 tests) — the decision matrix
(4 combinations incl. *production + flag true*), and real-database proof inside a rolled-back
transaction: production → zero accounts, no flag → zero accounts, both conditions → three accounts,
double seed → no duplicates.

**Residual:** the seeded passwords are still in the repository *as demo data*; that is acceptable
only because planting can no longer occur in production. Rotating them is pointless; deleting them
happens when the seed itself is deleted (phase 7).

### ② D26 — no database error code reaches a client

**Was:** the public error code came from `error.code`. `pg` errors also carry `code`, and theirs is
a SQLSTATE, so a decimal supplier price returned
`500 {"error":"22P02","message":"خطای داخلی سرور"}` — Postgres internals became part of the API
contract (and `23505`/`23503` leak schema structure).

**Now:** `publicError()` in `frontend-next/server/kolbe-api.ts` classifies explicitly:
domain errors (`HttpError`) keep their code; Try-On provider codes are preserved (the UI maps them to
Persian messages and they are not secrets); **everything else** becomes
`500 INTERNAL_ERROR / "خطای داخلی سرور"` with the real error logged server-side only.
Exported for direct testing with synthetic driver errors.

**Regression test:** `frontend-next/test/error-disclosure.test.ts` (6 tests) — driver errors with
`22P02`, `23505`, `23503`, `42703`, `42P01` never surface their code, and six malformed price
payloads over the real API all answer `< 500` with a domain-shaped code (`^[A-Z][A-Z_]*$`).

### ③ D21 — `logs/client` requires a session and has a quota

**Was:** `POST logs/client` inserted a `system_log` row with no authentication at all (probe: 202).
A free, attacker-controlled write primitive (disk exhaustion, poisoning the error dashboard).

**Now:** `handleClientLog()` runs **before** `await database()` so noise never reaches the database:
session required (`customer|vip|admin|supplier`), 60 events/hour per user (decision by
`signed user id`, not by `x-forwarded-for`, which is spoofable at this layer), fields truncated
(message 2000, stack 12000, url 512), rows attributed to `actor_id`/`actor_role`, plus the existing
fingerprint dedupe. `storefront/lib/clientLogger.ts` now sends `credentials: "same-origin"` so a
logged-in browser still delivers telemetry (the API is same-origin).

**Regression test:** `frontend-next/test/log-ingestion-guard.test.ts` (5 tests) — anonymous 401;
authenticated 202 with the correct actor; message truncation at exactly 2000; 429 on the 61st event;
per-user isolation.

**Residual (named, not hidden):** errors from *anonymous* visitors are no longer recorded. Restoring
that needs a quota-limited, signed public endpoint (phase 6), not an unbounded insert.
Also: `claimsFrom()` does not auto-login expired HttpOnly sessions for API calls, so browser
telemetry pauses between session expiry and the next login. That is session semantics and belongs to
the phase-2 auth migration — it is not changed here.

### ④ D20 — Try-On needs a session and has usage caps

**Was:** `try-on/*` was handled *before* the auth chain and before the database was touched. Any
anonymous visitor or bot could spend Kolbe's paid Perfect Corp quota; no per-user record existed.

**Now:** `handleTryOn()` in `kolbe-api.ts` demands a `customer|vip` session **before** the provider
is reached, and the billable operations (`try-on/files`, `try-on/tasks`) consume quota from the new
`frontend-next/server/try-on-guard.ts`: 6 task creations/hour and 20/day, 20 uploads/hour, per
signed user id. Status polling and result download stay unlimited for the session holder so the
browser's polling cannot burn its own quota. `429 TRY_ON_QUOTA_EXCEEDED` is the new contract.

**Regression test:** `frontend-next/test/try-on-guard.test.ts` (6 tests) — hourly boundary, daily cap
independent of the hourly one, per-user isolation; anonymous POST/GET are 401; with a customer
session the first six requests reach the provider and the 7th/8th are 429; an `admin` session is not
silently accepted on a customer surface.

**Residual:** the counters live in process memory (`rate-limit.ts`), so they reset on restart and are
not shared across containers. That is enough for today's single Next.js instance and is the documented
ceiling of phase 1.5; phase 6 replaces them with Redis. Documented in the module header.

### ⑤ D25 — money and quantity inputs are validated

**Was:** `Number(body.wholesalePrice ?? 0)` went straight into a `bigint` column: `-999999` → **201**
with a negative price, `1234.56` → **500** `22P02`, `"abc"` → **500** `22P02`. `stock` had the same
shape via `Number("abc")`. Rule A10 ("no float money") was enforced everywhere except at the door.

**Now:** `frontend-next/server/money-input.ts` (`parseMoneyInput`, `parseNonNegativeInteger`) is the
single transitional validator (the shared equivalent lives in `packages/shared/src/money.ts` and takes
over at the phase-3 cut-over). Validation happens **before** the transaction opens, so no row is
written and no driver error can occur. `422 INVALID_WHOLESALE_PRICE` / `422 INVALID_STOCK`.

**Regression test:** `frontend-next/test/supplier-price-validation.test.ts` (8 tests) — 4 unit tests
over the parser (integer/string/bigint accepted; float, negative, non-numeric, out-of-range rejected;
custom code propagated; quantity ceiling) and 4 API tests including *the negative price creates no
row* and the accepted path storing `987654321` on product, variant `cost` and inventory.

### ⑥ D23 — the wholesale payment-method guard is real

**Was:** `POST wholesale/orders` never read `paymentMethod`. A VIP member could send `installment`
(BNPL) and the order was created — a shipped policy violation, and `WHOLESALE_PAYMENT_METHODS` was
decorative.

**Now:** `paymentMethod` is required (`422 PAYMENT_METHOD_REQUIRED`) and validated
(`assertPaymentMethodAllowed("wholesale", …)` → `422 PAYMENT_METHOD_NOT_ALLOWED`) before any
inventory is resolved, so a rejected order cannot reserve stock.

**Regression test:** `frontend-next/test/wholesale-payment-guard.test.ts` (6 tests) — `installment`
and `wallet` rejected, empty/missing/unknown rejected, `transfer` creates the order **and** reserves
inventory, a rejected payment reserves nothing, MOQ still enforced.

### ⑦ D22 — BNPL is retail-only in the UI

**Was:** `ProductPage` and `ProductCard` rendered the installment banner with no channel condition,
and `VIPPortal` mounts the retail `ProductPage` at `/vip/product/:id` — so wholesale members were
advertised retail instalments.

**Now:** `storefront/lib/purchaseChannel.ts` holds the client-side rule
(`isInstallmentAvailable(channel)`; `RETAIL_CHECKOUT_METHODS`). `ProductPage` and `ProductCard` take
`channel` (default `"retail"`, so wholesale reuse must be explicit), and `VIPPortal` passes
`channel="wholesale"`. The server rule is independent and remains authoritative.

**Regression test:** in `frontend-next/test/panels-honesty.test.ts` — the rule itself plus source
assertions that both components gate on the channel and the VIP portal is explicitly wholesale.

### ⑧ D24/D38 — the fake controls are gone

**Was:** the admin "customer wallet" editor wrote `kv_wallet_<phone>`; roles (`kv_admin_roles`),
2FA (`kv_admin_2fa`) and integrations (`kv_admin_integrations`) were checkboxes persisted in the
browser only. The harm is not "missing feature" but **false assurance**: a manager ticks 2FA and
believes logins are protected.

**Now:** `Admin.tsx` loses the wallet editor and shows an explicit statement that the wallet/ledger is
a phase-5 domain, where balances will be append-only and never editable. `AdminOperations.tsx`
`AccessSecurity` and `IntegrationsAutomation` are replaced with a reusable `NotAvailableYet` notice
naming the module and the phase (`auth`, phase 2; `payments/notifications`, phases 5–6). The
`InventoryOperations`/`CommerceOperations`/`SystemCenter` panels are untouched — they are still
localStorage-backed and are recorded as debt below.

**Regression test:** `frontend-next/test/panels-honesty.test.ts` scans the storefront sources
(comments stripped) for the four removed key families, asserts the wallet editor symbols are gone,
and asserts the "not implemented" notice is used.

### ⑨ D29 — `previewMode.ts` deleted

**Was:** `PANELS_PREVIEW_MODE = false` short-circuited admin authentication state, disabled logout and
rendered preview banners; `DEMO_VIP_MEMBERSHIP` supplied a fake VIP identity. Dead code, but one
boolean flip from being an auth bypass.

**Now:** the file is deleted; every reference is removed from `AdminPortal.tsx` (initial
`authenticated=false`, session restore always runs, logout always signs out) and `VIPPortal.tsx`
(no demo membership, no preview banner). Session restore is now the only path to an authenticated
panel. Behaviour for users is unchanged because the flag was already `false`.

**Regression test:** `panels-honesty.test.ts` asserts the file does not exist and that no source
mentions the symbols.

### ⑩ D19a — retail payment status stops lying

**Was:** every non-COD retail order was stored as `payment_status = 'pending_gateway'`
("awaiting bank gateway") while **no payment provider of any kind exists** (no gateway, no
SnappPay/DigiPay, no wallet — the `payments` domain is phase 5). The system claimed money was coming
in and kept no record for reconciliation (audit BLOCKER D19).

**Now:**
- `retail-pricing.ts`: `paymentSettlementStatus(method)` → `pending_cod` for COD (the one method that
  is genuinely fulfilled) and `unpaid` otherwise; `requiresPaymentProvider()` /
  `PROVIDER_BACKED_PAYMENT_METHODS`; `PricedRetailOrder` carries explicit `paymentCollected: false`
  and `requiresManualSettlement`.
- `POST retail/orders` returns `payment: { method, status, collected, requiresManualSettlement }`
  read from the stored row (including on idempotent replay), so no client can infer "paid" from a 201.
- `Checkout.tsx`: the method list is the three fulfilable options; the fake "wallet — balance: ۰"
  option is gone; notes say what actually happens ("we contact you to arrange payment"), and the
  success message prints the server's real status.

**Why the methods were not restricted to COD** (the alternative reading of item ⑩, tested and
rejected with evidence): the pricing rule "COD ⇒ shipping total 0"
(`retail-pricing.ts:281-284`) means COD-only would make **every** order pay zero shipping (zero
shipping revenue) and make orders from provinces outside COD coverage impossible. So the methods
remain available, but nothing in the system claims the money arrived. The wallet, which cannot be
fulfilled at all, was removed from the UI.

**New API shape** (additive, non-breaking): `payment.collected === false` until phase 5.

**Regression test:** `frontend-next/test/retail-payment-honesty.test.ts` (7 tests) — status mapping
per method; the API field for gateway and COD; all four methods stored without any `pending_gateway`;
idempotent replay returns the stored status; an unknown method is still 422.

**Residual:** `payment_status`'s column **default** is still `pending_gateway` in the legacy DDL and
in `packages/database`. No code path relies on it any more (every insert writes the value
explicitly); changing it must be done together with the Drizzle migrations, i.e. with D27 in 1.2.
Both definitions now carry a comment saying exactly this.

---

## 3. Files changed

| Area | Files |
|---|---|
| Server guards (new) | `server/rate-limit.ts`, `server/try-on-guard.ts`, `server/money-input.ts` |
| Server (changed) | `server/database.ts`, `server/kolbe-api.ts`, `server/retail-pricing.ts` |
| Storefront (changed) | `pages/Admin.tsx`, `pages/AdminOperations.tsx`, `pages/AdminPortal.tsx`, `pages/Checkout.tsx`, `pages/ProductPage.tsx`, `pages/VIPPortal.tsx`, `components/ProductCard.tsx`, `lib/clientLogger.ts` |
| Storefront (new) | `lib/purchaseChannel.ts` |
| Storefront (deleted) | `previewMode.ts` |
| Operator tool (new) | `scripts/create-admin.mjs` |
| Ops/dev plumbing | `scripts/dev-all.mjs`, `scripts/pg.mjs`, `infra/.env.example`, `infra/ci/ci.yml` |
| Tests (new) | `test/demo-seed-guard.test.ts`, `test/error-disclosure.test.ts`, `test/log-ingestion-guard.test.ts`, `test/try-on-guard.test.ts`, `test/supplier-price-validation.test.ts`, `test/wholesale-payment-guard.test.ts`, `test/retail-payment-honesty.test.ts`, `test/panels-honesty.test.ts` |
| Tests (changed) | `test/setup.ts` (flag), `test/helpers.ts` (`approvedVip()`) |
| Schema comment only | `packages/database/src/schema/tables.ts` |

No API route was removed. Two behaviours changed in a client-visible way: `logs/client` now answers
401/429 instead of 202, and retail order responses gained a `payment` object.

---

## 4. Verification — what was actually run

| Command | Result |
|---|---|
| `npm run typecheck:all` | ✅ clean (shared, database, api, frontend-next) |
| `npm run test:all` | ✅ **127 passed** — shared 21, database 4, api 17, frontend-next 85 |
| `npm run infra:verify` | ✅ 12 env vars, 9 Compose services, static review only |
| `npm run build` (Next.js production build) | ✅ builds and prerenders all routes |

Not run, and therefore not claimed: any Docker/Compose/Nginx execution, any real deployment, any
provider-backed payment or Try-On call with live credentials, and any multi-instance rate-limit
behaviour.

---

## 5. Green list after phase 1.5

Green = has a regression test that fails if the behaviour is removed.

| Contract | Test |
|---|---|
| Demo data can never be planted in production (even with the flag set) | `demo-seed-guard` |
| Only domain error codes are public; no SQLSTATE, table or column name leaks | `error-disclosure` |
| Client log ingestion requires a session, is attributed and quota-limited | `log-ingestion-guard` |
| Try-On requires a session and is capped per user per hour and per day | `try-on-guard` |
| Money/quantity inputs are integers in range before they reach the database | `supplier-price-validation`, `error-disclosure` |
| Wholesale orders require an allowed (non-BNPL) payment method, before stock is reserved | `wholesale-payment-guard` |
| BNPL is retail-only in the UI and the rule is server-enforced | `panels-honesty`, `retail-payment-honesty` |
| No fake wallet/roles/2FA/integrations control exists in the storefront | `panels-honesty` |
| The panel preview bypass (`previewMode`) is gone | `panels-honesty` |
| A retail order never claims money was collected, and its stored status matches its method | `retail-payment-honesty` |

Still red (unchanged by this phase): D19 (no payment/ledger domain), D27 (0 foreign keys,
0 CHECK constraints, status/role columns as free text), D28 (wholesale totals computed in JS floats),
D30 (no per-variant assets), D31 (three unsynchronised catalogue sources), D32 (CMS silent save),
D33 (`frontend-kolbe` fork), D35 (no CSRF/Origin validation), D36 (CORS frozen at import),
D19's UI-side "installment banner promises a provider that does not exist yet".

---

## 6. Debt added or discovered in this phase

| ID | Item | Where it goes |
|---|---|---|
| N1 | Rate-limit counters are per-process (reset on restart, not shared across instances) | phase 6 (Redis) |
| N2 | Anonymous browser telemetry is accepted as a trade-off for closing the write primitive | phase 6 (signed, quota-limited endpoint) |
| N3 | Browser telemetry pauses after HttpOnly session expiry until the next login (no silent renewal on API calls) | phase 2 (auth migration) |
| N4 | `payment_status` column default is still `pending_gateway` (unused by code, commented in both definitions) | phase 1.2 with D27 |
| N5 | `InventoryOperations`, `CommerceOperations` and `SystemCenter` panels are still `localStorage`-backed (`kv_admin_warehouses`, `kv_admin_returns`, `kv_admin_system`) — same class as D24/D38, not in the 1.5 list | phase 3 (inventory) + phase 4/6 (admin surfaces) |
| N6 | `logs/client` quota is counted before the row is written, so rejected requests still cost a request (intended), and the log table has no retention policy | phase 6 |
| N7 | The seed still contains plaintext demo passwords (harmless only because planting cannot happen in production) | phase 7 (delete the seed) |

---

## 7. Next phase

The blueprint's order is unchanged; the next schedulable work is **1.2 (single schema authority)**
together with the D27 constraint migration, since both touch the DDL and the Drizzle migrations in the
same edit — then **1.3 (deployability proof)** which requires a Docker host.

Before phase 3, the two unresolved design items from the charter still stand: the
`retail_order`-ownership conflict (`checkout` vs `orders`) and the per-variant flat-lay asset workflow
(D30), which must be designed alongside product/media work.
