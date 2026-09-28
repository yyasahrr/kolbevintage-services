# PROMPT 1 — Repository Audit & Migration Blueprint

**Repository:** `yyasahrr/kolbevintage-services` · **Branch:** `arena/01a0ad1f-kolbevintage-services`
**Audit date:** 2026-09-17 · **Governing document:** [`master-architecture-rules.md`](./master-architecture-rules.md)
(ADR-004: strangler, no big-bang rewrite)
**Strategy:** incremental / strangler — **no major feature changes, no hard rewrite, no working
functionality removed**.

> **This document supersedes [`architecture-audit-and-migration-blueprint.md`](../architecture-audit-and-migration-blueprint.md)**
> where the two disagree. That document was written before the phase-0 fixes and contains statements
> that are now false; §0.4 lists every one of them. It is kept for history, not as a source of truth.

---

## 0. How this audit was performed

### 0.1 Method

Every claim below is backed by one of: a file path with a line number, a measurement taken from a
live database, or an HTTP probe executed against the running handler. Nothing is inferred from how a
screen looks — several of the most serious findings are features that *look* complete.

### 0.2 Evidence actually executed during this audit

| # | Check | Command / probe | Result |
|---|---|---|---|
| 1 | Dependency install from lockfile | `npm install` | ✅ 344 packages, clean |
| 2 | Embedded PostgreSQL | `node scripts/pg.mjs ensure` | ✅ fresh cluster on 55432 |
| 3 | Migrations applied | `node packages/database/migrate.mjs` | ✅ 2 migrations, 20 tables |
| 4 | Schema measured (not read) | `pg_constraint`, `pg_indexes`, `information_schema` | 20 tables · 229 columns · 35 indexes · 9 unique · **0 FK · 0 CHECK** · 1 trigger |
| 5 | Test suite | `npm run test:all` | ✅ 73 passed (21+4+17+31) — **but only after `build:packages`; see D34** |
| 6 | Supplier price validation | `POST supplier/products` with `wholesalePrice: 1234.56` | ❌ **HTTP 500** `{"error":"22P02"}` (probes P1/P2) |
| 7 | Supplier negative price | `POST supplier/products` with `wholesalePrice: -999999` | ❌ **HTTP 201 created** (probe P3) |
| 8 | Try-On authorization | `POST try-on/files` **with no token** | ❌ reaches the paid provider handler (probe P5) |
| 9 | Log endpoint authorization | `POST logs/client` **with no token** | ❌ **202 accepted, row written** (probe P6) |
| 10 | VIP self-approval | `POST wholesale/apply` with `paymentReference:"VIP-FAKE-1"` | ✅ `201`, `status=pending`, `/me` role stays `customer` (probe P7) |
| 11 | Retail payment methods | `POST retail/orders` for `gateway`/`installment`/`wallet`/`cod` | ❌ **201 for all four, no payment processing** (probe PAY) |
| 12 | Invalid payment method | `POST retail/orders` with `payMethod:"snapppay_direct"` | ✅ 422 `PAYMENT_METHOD_NOT_ALLOWED` |
| 13 | Price tampering (retail) | `price: 1` + `shipping.price: 1` in body | ✅ server used 4,850,000 and free shipping; `adjusted:true` |
| 14 | Wholesale + BNPL method | `POST wholesale/orders` with `paymentMethod:"installment"` | ❌ **201, order created, payment method ignored** (probe W3) |
| 15 | Asset inventory | `ls frontend-next/public/images` vs catalogue colour entries | ❌ 8 image files for 43 colour entries |
| 16 | Fork divergence | `diff -rq frontend-kolbe/src frontend-next/storefront` | ❌ 48 differing files (~13k LOC fork) |

**Re-measured during phase 1.2 (2026-09-17), same probes, after the work:**

| # | Check | Command / probe | Result |
|---|---|---|---|
| 17 | Schema from zero | `npm run db:migrate` on an empty database | ✅ 3 migrations · 20 tables · 37 indexes · 1 trigger · **21 FK · 40 CHECK** · 12 non-PK uniques |
| 18 | Upgrade from the 1.5 runtime DDL | `npm run db:adopt-legacy` on a database built by the pre-1.2 inline DDL | ✅ adopted 0000/0001, applied 0002, data intact, shape verified, re-run is a no-op |
| 19 | Runtime DDL after removal | static scan of `frontend-next/{server,app,storefront,supplier-src}`, `apps/api/src`, `packages/shared/src` | ✅ 0 hits (asserted by `clean-migration.test.ts` **and** `frontend-next/test/schema-authority.test.ts`) |
| 20 | Test suite | `npm run test:all` | ✅ **166 passed** across 22 files (shared 21 · database 36 · api 17 · next 92) — was 127 |
| 21 | Fail-closed behaviour | guard against an empty database, a partially migrated database and a hand-modified column | ✅ all three refuse to serve; `503 SERVICE_UNAVAILABLE`, no schema detail in the body |

Probes were run through the project's own harness (`frontend-next/test/helpers.ts`) against a scratch
database and were **not committed** — they are measurement, not regression tests. §9 assigns the
permanent tests.

### 0.3 What is *not* verified

- **Docker/Compose/Nginx have not been executed on a Docker host.** `infra/` was statically verified
  and fixed in phase 1.3 (Dockerfiles corrected for `packages/database` copy, `--workspaces` flag,
  `USER` non-root, `HEALTHCHECK`; Compose fixed for minio healthcheck, migrate-env separation,
  `service_healthy`; Nginx fixed for `/healthz` liveness and proxy cache bypass). `npm run infra:verify`
  now covers 12 env vars, 9 services, upstream resolution, Dockerfile checks, and 32 deployment
  tests in `frontend-next/test/infra-deployment.test.ts`. **But** `docker compose config`,
  `docker compose build --no-cache`, `docker compose up`, and `nginx -t` have never been executed
  because this environment has no Docker daemon — they are reported as skipped in the phase 1.3 report
  and must be executed on a real host before any production readiness claim.
- **No browser/E2E test exists at all.** Every frontend claim below comes from reading the code.
- The Perfect Corp integration was probed only far enough to prove it is unauthenticated
  (`PERFECT_CORP_NOT_CONFIGURED`, no API key present). Its success path was never executed.
- No production database, no real traffic, no load testing.

### 0.4 Corrections to the previous blueprint

| Previous claim | Reality measured today |
|---|---|
| "Legacy twins `frontend-kolbe/`, `frontend-supplier/`: dev-time shells proxying to Next" | **False.** `frontend-kolbe/src` is a full divergent fork of the storefront: 13,026 LOC, **48 files differ**, no proxy. It is an active `npm run dev:kolbe` workspace. |
| "Retail checkout is non-functional (HTTP 500)" | **Fixed** in `f564fdf`. 201 with server-computed totals; regression-tested. |
| "VIP admission self-approves instantly" | **Fixed** in `c224714`. Probe P7 re-confirms: always `pending`, role unchanged. |
| "No idempotency on any POST" | **Partly fixed.** Retail and wholesale create endpoints are idempotent; 20 other endpoints are not. |
| "No tests, no CI" | **Partly fixed.** 73 tests exist and pass; the CI workflow is written but **cannot be activated** (§9, D34-adjacent). |
| "Float in `bulk-price`" | **Fixed** for `bulk-price` (integer basis points). **Still true** for wholesale totals — see D28. |

---

## 1. Current architecture map

### 1.1 Runtime topology (today, verified)

```
                         ┌──────────────────────────────────────────────┐
  browser ─── HTTP ───▶  │  Next.js 15  (frontend-next, port 3000)      │
                         │  ─ the only running server ─                 │
                         │                                              │
                         │  app/[[...slug]]/page.tsx   → CSR SPA shell   │
                         │  app/supplier/page.tsx      → supplier SPA    │
                         │  app/store/kolbe/[[...path]]/route.ts        │
                         │  app/admin/kolbe/[[...path]]/route.ts        │
                         │        └─▶ server/kolbe-api.ts (1,502 LOC)   │
                         │                 ├─▶ server/database.ts (pg)  │
                         │                 ├─▶ server/retail-pricing.ts │
                         │                 └─▶ server/perfect-corp.ts   │
                         └──────────────────┬───────────────────────────┘
                                            │ raw SQL (pg Pool)
                                            ▼
                                   PostgreSQL 16  ·  20 tables
                                   (schema created at RUNTIME)

  apps/api (NestJS, port 4000) — built, boots, serves /api/v1/health + /api/v1/audit/logs ONLY.
  It is NOT in the request path. No Nginx, no Docker, no reverse proxy in front of anything today.
```

**The single most important structural fact:** there is exactly one running backend, and it is a
1,502-line `if (path === "...")` chain inside a Next.js route handler. The NestJS modular monolith
exists and boots, but carries only two endpoints.

### 1.2 Backend inventory — 41 endpoints in one function

`frontend-next/server/kolbe-api.ts`. Route resolution is a linear `if` chain; there is no router, no
controller layer, no dependency injection, and no compile-time contract.

| Group | Endpoints | Auth |
|---|---|---|
| auth | `POST auth/register`, `POST auth/login`, `POST auth/logout` | @Public / cookie issue |
| supplier | `POST supplier/apply`, `POST supplier/auth/login`, `GET supplier/session`, `GET·POST supplier/products`, `GET supplier/orders`, `POST supplier/orders/:id/status`, `GET supplier/rfqs`, `POST supplier/rfqs/:id/quote`, `GET·POST supplier/tickets` | session + `supplierContext()` |
| wholesale/VIP | `POST wholesale/apply`, `GET wholesale/account`, `GET wholesale/products`, `GET·POST wholesale/orders` | `customer`/`vip` role |
| admin | `PUT admin/site-settings`, `GET admin/accounts`, `POST admin/accounts/:id/status`, `GET admin/supplier-applications`, `POST admin/supplier-applications/:id`, `GET admin/audit-logs`, `GET admin/suppliers`, `GET admin/catalog`, `POST admin/catalog/:id/status`, `POST admin/catalog/bulk-price`, `GET admin/purchase-orders`, `POST admin/purchase-orders/:id/status`, `GET admin/orders`, `POST admin/orders/:id/approve`, `POST admin/orders/:id/cancel`, `GET·POST admin/rfqs`, `GET admin/tickets`, `POST admin/tickets/:id`, `GET admin/logs`, `POST admin/logs/:id` | `requireRole(req,"admin")` |
| public | `GET health`, `GET site/hero-video`, `GET site/banner-video`, `GET site/settings`, `GET me`, `POST retail/orders`, `POST logs/client`, `try-on/*` | mixed — **see D20/D21** |

### 1.3 Frontend topology — four surfaces, one bundle

| Surface | Path | Route entry |
|---|---|---|
| Retail storefront | `/` | `app/[[...slug]]/page.tsx` → `storefront/App.tsx` (68 files, 21k LOC) |
| Admin panel | `/#/admin` (hash) | `AdminPortal.tsx` → `Admin` (retail) or `WholesaleAdmin` |
| VIP / wholesale portal | `/vip/*`, `/wholesale*`, `/wholesale-dashboard` | `VIPPortal.tsx` / `Wholesale.tsx` |
| Supplier portal | `/supplier` | `supplier-src/App.tsx` (7 files, 1.8k LOC) |

All four ship inside one Next.js bundle. There is no admin portal app and no supplier portal app in
the sense the target architecture means — §10 explains the extraction path.

### 1.4 Data topology — three parallel sources of truth

```
  (a) PostgreSQL (20 tables)          (b) browser localStorage (~43 kv_* keys)
      supplier_product / variant            kv_admin_products_v2   ← product editor + VARIANT
      supplier_inventory                    kv_admin_customers     ← CRM
      wholesale_* / purchase_order_*        kv_admin_crm_v2        ← CRM activities/tasks
      retail_order / retail_order_item      kv_admin_roles         ← ROLES & PERMISSIONS
      support_ticket / rfq / quote          kv_admin_2fa           ← TWO-FACTOR AUTH
      audit_log / system_log / site_setting kv_admin_integrations  ← PAYMENT GATEWAYS
      account_user / supplier*              kv_wallet_<phone>      ← WALLET BALANCE
                                            kv_admin_warehouses    ← WAREHOUSES
  (c) hardcoded TypeScript
      storefront/data/catalog.ts  12 products, 43 colour entries, 43 prices
      storefront/data/siteData.ts navigation, footer, static copy
      siteSettings.ts             site builder + CMS defaults (656 LOC)
      supplier-src/data.ts        supplier mock products/orders/RFQs
      AdminOperations.tsx         warehouses, returns, roles, integrations, system
      PreviewMode.ts              DEMO_VIP_MEMBERSHIP
```

**(a) and (b) overlap for the same entity.** The admin edits product variants in localStorage
(`kv_admin_products_v2`) while suppliers edit variants in PostgreSQL (`supplier_variant`). The two
never sync. This is the core data-integrity problem of the current system.

### 1.5 Authentication model

HMAC-SHA256 token `base64url({sub,role,exp}).sig`, 14-day TTL, secret from `KOLBE_SESSION_SECRET`
(fail-closed in production). Dual-read: `Authorization: Bearer` first, then the `kolbe_session`
HttpOnly cookie. **The client still stores the token in `localStorage`** (`TOKEN_KEYS` in
`lib/api.ts`) and sends it as a Bearer header, so the cookie is currently the fallback, not the
primary — the reverse of the target.

---

## 2. Target architecture map

```
                                   ┌─────────────────────────────────────────┐
        Internet ──▶  Nginx :443 ──┤  the strangler switch point             │
                                   │  /api/v1/*      → api:4000              │
                                   │  /admin/*       → admin:8080  (phase 7) │
                                   │  /supplier/*    → supplier:8080 (ph. 7) │
                                   │  /*             → storefront:3000       │
                                   └────────┬────────────────────────────────┘
                                            │
        ┌───────────────────────┬───────────┴────────────┬──────────────────────┐
        ▼                       ▼                        ▼                      ▼
  storefront (Next.js)   admin (Vite)            supplier (Vite)          api (NestJS)
  public catalogue       operations console      supplier workspace       modular monolith
  SEO, SSR, checkout UI  administration          own commercial data      /api/v1, OpenAPI
        │                       │                        │                      │
        └───────────────────────┴────────────┬───────────┴──────────────────────┘
                                             │
                       ┌─────────────────────┼──────────────────────┐
                       ▼                     ▼                      ▼
              PostgreSQL 16            Redis 7               ParsPack Object Storage
              (packages/database       (cache, BullMQ        (S3-compatible, presigned)
               = sole authority)        queues, session
                                        deny-list)
                                             │
                                             ▼
                                      worker (BullMQ consumers)
                                      notifications · try-on jobs · exports
```

**Non-negotiable properties of the target** (from the charter):

1. `packages/database` is the only schema authority; runtime DDL is deleted.
2. **No browser talks to PostgreSQL.** All four frontends speak `/api/v1` only.
3. Exactly one identity model: HttpOnly cookie sessions issued by `auth`, verified by one guard.
4. Money moves only through `payments` → `ledger` → (`wallet` | `settlements` → `payouts`).
5. Every external callback is idempotent on a persisted provider-event key.
6. Try-On runs as a queued job with per-user and per-day cost ceilings, key held server-side only.
7. Supplier/admin portals are separate bundles so the storefront never ships admin code.

---

## 3. Feature classification matrix

**Legend.** Source of truth: `PG` PostgreSQL · `LS` localStorage · `HC` hardcoded/mock · `—` none.
Maturity: `prod` operable · `partial` works with gaps · `fake` UI only · `missing`.
Maturity is derived from the *source of truth*, never from UI completeness.

**Every row whose source is `LS` or `HC` is non-production by definition**, regardless of how
finished the screen looks.

### 3.1 Storefront, catalogue, retail

| Feature | Current implementation | Truth | Maturity | Risk | Target owner |
|---|---|---|---|---|---|
| Product catalogue (12 SKUs) | `storefront/data/catalog.ts` (1,031 LOC) | HC | fake | 🔴 price change needs a deploy | `products` |
| Product variants | 4 sizes + 3–4 colours **inside the catalogue file**; no variant IDs | HC | fake | 🔴 cannot be addressed by id | `products` |
| Variant ↔ colour images | 43 colour entries → **8 shared image files** | HC | fake | 🔴 colour selection shows the wrong product photo | `products` + `files` |
| Flat-lay assets | **Do not exist.** One generic `flat.jpg` | — | missing | 🔴 blocks Style Builder §3.7 | `files` |
| Retail pricing | `server/retail-pricing.ts`, bigint, server-side | PG+HC | prod | 🟡 price book is a source file | `pricing` |
| Shipping methods & prices | Hardcoded **twice**: `Checkout.tsx:14` and `retail-pricing.ts:29` | HC | fake | 🟠 drift risk | `shipping` |
| Cart / wishlist / compare | `store.tsx`, `kv_cart`/`kv_wish`/`kv_compare` | LS | prod* | 🟢 allowed by charter A5 | `carts` (server cart for cross-device) |
| Checkout (totals, validation, idempotency) | `POST retail/orders` → `retail-pricing.ts` | PG | **prod** | 🟢 D1/D3 fixed and tested | `checkout` |
| Checkout payment | `gateway`/`installment`/`wallet`/`cod` — all just a stored string | HC | **fake** | 🔴 **D19: no money is ever collected** | `payments` |
| Retail order fulfilment / tracking | none — `order_status` stays `placed` | — | missing | 🔴 no shipment entity | `fulfillment` + `shipments` |
| Customer accounts | `account_user` + `/me`; no addresses, no profile edit | PG+LS | partial | 🟠 addresses are ad-hoc per order | `customers` |
| Order history for customers | **No endpoint.** `Admin.tsx` uses `kv_admin_orders` | — | missing | 🔴 a customer cannot see their own orders | `orders` |
| Try-On (Stage 2) | `server/perfect-corp.ts` proxy, 5 endpoints | PG- | partial | 🔴 **D20: unauthenticated** | `try-on` |
| Style Builder (Stage 1) | `/styles` lists pre-curated products by `style` slug | HC | **missing** | 🔴 no composer exists | `style-builder` |
| Blog / journal | `pages/Blog.tsx` + `siteData.ts` + `kv_admin_articles` | HC+LS | fake | 🟠 admin article edits are browser-local | `analytics`→`content` (new module) |
| Analytics events | `lib/analytics.ts` → `kv_commerce_events_v1` | LS | fake | 🟠 no measurement exists | `analytics` |
| Site CMS / builder | `siteSettings.ts`: localStorage first, server debounced 450 ms later | PG+LS | partial | 🔴 **D32: silent save failure + clobber race** | `integrations`→`content` |
| Storefront SEO | `seo.ts`, `app/layout.tsx`, per-route metadata | HC | partial | 🟡 CSR-only, no SSR metadata per product | `catalog` |

\* `prod` for cart because the charter explicitly permits client-owned cart state.

### 3.2 Customer account

| Feature | Implementation | Truth | Maturity | Risk |
|---|---|---|---|---|
| Login / session | `auth/login` + cookie + Bearer in LS | PG+LS | prod | 🟡 A9 violated by LS token |
| Profile | `/me` read-only (name, phone, email) | PG | partial | 🟡 no edit |
| Addresses | Captured per order; **no address book** | — | missing | 🟠 |
| Orders / shipments | **No customer endpoint.** Admin reads `kv_admin_orders` | — | missing | 🔴 |
| Returns | `AdminOperations.tsx` → `kv_admin_returns`, 3 hardcoded cases | HC+LS | fake | 🔴 looks like a returns system |
| Payments / installments | **Do not exist.** Installments are a display string | — | missing | 🔴 |
| Wishlist | `kv_wish` | LS | prod* | 🟢 |
| Wallet / store credit | `kv_wallet_<phone>`; `Admin.tsx:642` writes balances straight to LS | LS | **fake** | 🔴 **D24: A11/A12 violation** |
| Support | `kv_wholesale_tickets` (VIP only) | LS | fake | 🟠 |
| Security / 2FA | `kv_admin_2fa` boolean | LS | **fake** | 🔴 **D38: 2FA is a checkbox** |
| Customer identity | `customerIdentity.ts` → `kv_customer_identity`, id derived from the phone number | LS | fake | 🟠 |

### 3.3 VIP / Wholesale portal

| Feature | Implementation | Truth | Maturity | Risk |
|---|---|---|---|---|
| Access control | `restoreWholesaleVip()` → `GET wholesale/account`; `active` flag from server | PG | **prod** | 🟢 |
| Application flow | `POST wholesale/apply` → **always `pending`** | PG | **prod** | 🟢 verified by probe P7 |
| Cannot self-approve | Only `POST admin/accounts/:id/status` grants the `vip` role | PG | **prod** | 🟢 + regression test |
| Membership fee | `paymentReference` is free text, unverified, unpersisted | HC | **fake** | 🟠 **D37: no billing exists** |
| VIP plan catalogue | `VIP_PLANS` hardcoded in `Wholesale.tsx:28` with Persian-digit prices | HC | fake | 🟠 |
| Wholesale catalogue | `GET wholesale/products` — DB-backed, moderated | PG | prod | 🟢 |
| Wholesale orders | `POST wholesale/orders`, `FOR UPDATE OF i`, MOQ 12, idempotent | PG | prod | 🟠 **D28: JS float totals** |
| Buying lists / draft order | `kv_wholesale_draft` → `POST wholesale/orders` | LS→PG | prod* | 🟢 |
| Reorder | `/vip/reorder` reuses the draft store | LS | partial | 🟡 |
| Quick order | `CollectionQuickOrder` (pack sizes 12/24/48) | PG | partial | 🟢 |
| Orders / invoices | `/vip/orders` real; `/vip/invoices` is a **placeholder shell** | PG / — | partial | 🟠 |
| Issues / claims | `/vip/issues` **placeholder shell** | — | missing | 🔴 no claims domain |
| Addresses | `/vip/addresses` **placeholder shell** | — | missing | 🟠 |
| Team | `/vip/team` **placeholder shell** | — | missing | 🟠 |
| Support | `kv_wholesale_tickets` localStorage | LS | fake | 🟠 |
| **BNPL in VIP surface** | `VIPPortal.tsx:53` mounts the retail `ProductPage`; `ProductPage.tsx:954` renders the installment block whenever the site builder enables it; default is **`enabled:true, provider:"snappay", showOnProduct:true`** (`siteSettings.ts:336`) | HC | **leak** | 🔴 **D22** |

### 3.4 Retail admin (special focus)

Route: `/#/admin` → `AdminPortal.tsx` → `Admin` (`Admin.tsx`, 1,042 LOC) plus 7 sub-pages.

| Panel | Implementation | Truth | Maturity | Verdict |
|---|---|---|---|---|
| Dashboard | `Dashboard`, derived from `kv_admin_orders` | LS | fake | non-production |
| Products | `adminProducts.ts` + `AdminProductEditor.tsx` (485 LOC) | **LS** `kv_admin_products_v2` | **fake** | Full product editor — variants, media, specs, versions, hotspots — writing to the browser. Non-production. |
| Product variants | `AdminVariant[]` inside the LS record | **LS** | fake | Non-production; no relation to `supplier_variant` |
| Product media | `imageUpload.ts` → base64 data URL ≤ 1920 px | **LS** | fake | Non-production; images never reach the server |
| Product trash | `kv_admin_product_trash` | LS | fake | Non-production |
| Inventory / warehouses | `AdminOperations.tsx` `InventoryOperations` → `kv_admin_warehouses`, 3 hardcoded warehouses (684/208/94 units) | **HC+LS** | **fake** | Non-production |
| Orders (retail) | `OrdersPanel` → `kv_admin_orders` | **LS** | **fake** | Non-production; retail orders live in `retail_order` but the admin panel never reads it |
| Payments | `IntegrationsAutomation` lists "درگاه زرینپال · متصل" | **HC+LS** | **fake** | Non-production and misleading |
| Shipping | `CommerceOperations` marketing tiles; `SmartShipping` copy only | HC | fake | non-production |
| Returns | `CommerceOperations` → `kv_admin_returns`, 3 hardcoded cases with hardcoded amounts | **HC+LS** | **fake** | Non-production; touches money semantics ("credit to wallet") |
| Customers / CRM | `AdminCRM.tsx` (168 LOC) → `kv_admin_crm_v2`, 4 hardcoded seed customers with fabricated order counts and totals | **HC+LS** | **fake** | Non-production |
| VIP customers | `AdminCRM initialView="vip"`, reads LS membership | LS | fake | non-production |
| Content | `ContentPanel` → `kv_admin_articles` | LS | fake | non-production |
| Reports | `ReportsPanel`, derived from the fake panels above | LS | fake | non-production |
| Roles / permissions | `AccessSecurity` → `kv_admin_roles` | **LS** | **fake** | 🔴 **Security theatre** — role toggles have zero effect on authorization |
| 2FA | `kv_admin_2fa` boolean | **LS** | **fake** | 🔴 Security theatre |
| Integrations | `kv_admin_integrations` | LS | fake | non-production |
| System settings | `kv_admin_system` | LS | fake | non-production |
| Audit logs | `AdminLogs.tsx` → `GET admin/logs` (`system_log`) | **PG** | **prod** | ✅ real (error tracking, not domain audit) |
| Domain audit trail | `GET admin/audit-logs` (`audit_log`) | **PG** | **prod** | ✅ real, append-only, tested |
| Site builder / design | `SiteBuilder.tsx`, `SiteDesignCenter.tsx`, `HeroStudio.tsx` → `siteSettings.ts` | PG+LS | partial | real server save, but silently best-effort (D32) |
| Support centre | `AdminSupportCenter.tsx` → `kv_support_conversations_v1`, 3 hardcoded chats | **HC+LS** | **fake** | Non-production |
| Messaging / SMS | `MessagingAutomationCenter.tsx` + `kv_sms_provider_v1` | LS | fake | Non-production; no SMS provider exists |
| Campaigns | `CampaignCenter.tsx` + `kv_campaign_center_v1` | LS | fake | Non-production |

**Answer to "identify any feature that appears functional but only stores data in browser/localStorage":**
essentially the *entire* admin operations surface — products (incl. variants and media), inventory and
warehouses, retail orders, returns, CRM, roles, 2FA, integrations, payment-gateway status, warehouses,
system settings, support chat, SMS automation and campaigns. The only two admin panels backed by the
database are **audit logs** and **system/error logs**.

### 3.5 Wholesale / VIP admin (special focus)

Route: same admin shell, workspace switch to `WholesaleAdmin.tsx` (304 LOC).

| Area | Implementation | Truth | Maturity |
|---|---|---|---|
| VIP applications / leads | `kv_admin_wholesale_requests` (seeded with 3 fake applicants) **and** `listSupplierApplications()` for the DB side | HC+LS+PG | partial |
| VIP account approval | `POST admin/accounts/:id/status` — real, whitelisted, audited, row-locked | **PG** | **prod** |
| Wholesale catalogue | `GET admin/catalog`, moderation whitelist, audited | **PG** | **prod** |
| Bulk price | `POST admin/catalog/bulk-price`, integer basis points, ≤500 rows, audited | **PG** | **prod** |
| Wholesale orders | `GET admin/orders`, `POST …/approve`, `POST …/cancel` | **PG** | **prod** |
| Supplier child orders | `purchase_order` split per supplier on approve | **PG** | **prod** |
| Fulfilment | `listWholesaleFulfillmentOrders()`, PO status transitions with tracking precondition | **PG** | **prod** |
| Supplier management | `listSuppliers()`, `POST admin/supplier-applications/:id` | **PG** | **prod** |
| Settlement / payout | **No table, no endpoint. Zero code.** | — | **missing** |
| Claims | **No table, no endpoint.** `/vip/issues` is a shell. | — | **missing** |
| Support (supplier tickets) | `GET admin/tickets` reads `support_ticket` (PG) **but the UI list is seeded from `kv_wholesale_tickets` (LS)** | PG+LS | **hybrid, split-brain** |
| Plans | `kv_vip_plans_v1` | LS | fake |
| Fulfilment orders cache | `kv_wholesale_orders` | LS | fake |

**Duplicate workflows between Retail Admin and Wholesale Admin** (all four are the same job done twice):

| Duplicate | Retail Admin | Wholesale Admin | Problem |
|---|---|---|---|
| Order list & status | `kv_admin_orders` (LS) | `GET admin/orders` (PG) | Two order boards; the retail one is fake, the wholesale one is real. An operator cannot tell which is authoritative. |
| Returns | `kv_admin_returns` (LS) | PO status transitions (PG) | Same word, two mechanisms, neither connected to `refunds`. |
| Support inbox | `kv_support_conversations_v1` (LS) | `support_ticket` (PG) | Same job, two stores. |
| Applications | (VIP accounts, PG) | Supplier applications (PG) + LS leads | Overlapping review queues with different lifecycles. |

### 3.6 Supplier portal (special focus)

`frontend-next/supplier-src/` (7 files, 1,794 LOC) served at `/supplier`.

| Area | Implementation | Truth | Maturity |
|---|---|---|---|
| Authentication | `POST supplier/auth/login`, role-bound token, `supplierContext()` | **PG** | **prod** |
| Supplier ownership | `context.supplierId` from the session — **client `supplierId` is sent but ignored** | **PG** | **prod** ✅ |
| Supplier membership | `supplier_member` table | **PG** | **prod** (single member seeded) |
| Products | `GET·POST supplier/products`; moderation status `submitted` | **PG** | **prod** |
| Variants | `supplier_variant` created with the product | **PG** | prod (1 variant per product — the editor has no variant matrix) |
| Product creation atomicity | **Atomic** — product + variant + inventory in one `transaction()` | **PG** | **prod** ✅ |
| Inventory | `supplier_inventory` (on_hand/reserved) **but the page shows hardcoded 46/38/35/15** | PG+HC | **hybrid** |
| Orders | `GET supplier/orders` → `purchase_order` | **PG** | **prod** |
| Fulfilment | `POST supplier/orders/:id/status` with ownership check + audit + transition validation | **PG** | **prod** |
| Shipping / tracking | `purchase_order.tracking_code`; required before `shipped` | **PG** | partial (no shipment entity) |
| Finance | `Finance()` — **hardcoded ledger**: 32,400,000 settleable, 48,600,000 pending, 5% commission, 9% tax, 2% shipping | **HC** | **fake** 🔴 |
| Wallet | Does not exist | — | **missing** |
| Withdrawals / payouts | Do not exist | — | **missing** |
| RFQ | `GET supplier/rfqs`, `POST supplier/rfqs/:id/quote` | **PG** | **prod** |
| Production | `Production()` — hardcoded `PO-4827`, 42% progress, hardcoded milestones | **HC** | **fake** |
| QC | `Quality()` — hardcoded `PO-4813`, `QC-1128` | **HC** | **fake** |
| Analytics | `Analytics()` — chart-shaped, hardcoded | **HC** | **fake** |
| Team | Part of `Profile()` | HC | fake |
| Company profile | `Profile()` — hardcoded "نساجی و پوشاک نیلگون", capacity 12,000 | **HC** | **fake** |
| Campaigns / holidays / settings | `kv_supplier_holidays` + hardcoded | LS+HC | fake |
| Dashboard | Hardcoded greeting and date ("صبح بخیر، نیلگون", "سه‌شنبه، ۲۱ مرداد ۱۴۰۴") | HC | fake |

**Mechanism worth naming:** `App.tsx:64–70` **mutates the imported mock arrays in place**
(`products.splice(0, products.length, ...remoteProducts)`). Every page then reads from those module
arrays. A page is live only if the sync happens to populate the array it renders — the rest silently
display fixtures. This is why the supplier portal *feels* wired up while half of it is not.

**Answers to the two questions asked:**
- *Can the frontend provide an arbitrary supplier ID?* **Yes, it sends one** (`CreateSupplierProductInput.supplierId`, `loadSupplierProducts(supplierId)`), **but the server ignores it everywhere** and derives ownership from the session. The only endpoint reading `body.supplierId` is `POST admin/rfqs`, which is admin-gated and legitimately choosing a supplier. **No ownership bypass found** — rule A6 holds.
- *Is supplier product creation atomic?* **Yes.** One request, one transaction covering `supplier_product` + `supplier_variant` + `supplier_inventory`. Confirmed by reading the handler; the client sends a single POST.

### 3.7 Style Builder

#### Stage 1 — Outfit Composer: **does not exist**

| Required capability | Status |
|---|---|
| Manually prepared flat-lay PNG assets | ❌ **Not in the repository.** `public/images` has 8 files; exactly one is a flat shot. 43 catalogue colour entries all point at those 8 files. |
| Variant-specific flat-lay assets | ❌ No asset model, no per-variant image, no `flat_lay` column anywhere |
| Canvas composition | ❌ No canvas code in the codebase |
| Drag / resize / rotate / reorder layers | ❌ None |
| Saved outfits / outfit items | ❌ No table, no endpoint, no type |
| Add outfit to cart | ❌ No such action |
| Source of truth = selected variants | ❌ Nothing exists to be the source of truth |

`/styles` is a **curated style landing page**: `Styles.tsx` (90 LOC) filters the static catalogue by
`product.style`. It is not a composer and shares nothing with one.

> **Blocking dependency to state plainly.** The brief assumes "products already have manually prepared
> flat-lay PNG images". In this repository they do not. The composer cannot be built against existing
> assets: the asset pipeline (per-variant flat-lay upload → `files`/S3 → `product_media` rows) is a
> *prerequisite*, not part of the composer work. Per the brief, this is explicitly **not** a request
> for background removal or AI flat-lay generation — it is a request for a place to *put* flat-lays
> that a human prepares.

#### Stage 2 — Try On Me: **partially exists, unauthenticated**

| Required capability | Status |
|---|---|
| Customer image upload | ✅ browser → Perfect Corp signed URL |
| Private storage (own bucket) | ❌ customer images go **directly to the provider**, not to Kolbe storage |
| Temporary retention | ❌ nothing stored, nothing expires, nothing deletable |
| Provider abstraction | ❌ `perfect-corp.ts` is the only implementation, hardwired |
| Queue / job model | ❌ the browser polls 60 × 2 s (`TryOn.tsx:75`) |
| API key management | ✅ server-side only (`PERFECT_CORP_API_KEY`), never in the bundle |
| Fallback provider | ❌ none |
| Usage limits | ❌ **none** |
| Cost limits | ❌ **none** |
| Admin configuration | ❌ none |
| Generated-image separation from product assets | ✅ `/try-on/download` streams the result, never writes it as a product asset |
| **Authorization** | ❌ **handled before auth and before DB access** (`kolbe-api.ts:1224`) |

### 3.8 Payments (special focus)

| Aspect | State |
|---|---|
| Hardcoded payment methods | Yes — `RETAIL_PAYMENT_METHODS = ["gateway","installment","cod","wallet"]` |
| Fake/demo behaviour | **All of it.** Probes confirm all four methods return `201` and create an order marked `placed`; no provider is contacted, no intent is created, no callback is awaited |
| Client-trusted totals | ✅ **No longer** — server recomputes (probe: `price:1` → 4,850,000, `adjusted:true`) |
| Callback handling | ❌ **there is no callback endpoint at all** |
| Verification | ❌ no gateway verification, no amount re-check, no signature validation |
| Idempotency | ✅ on order creation (`Idempotency-Key`); ❌ no provider-event idempotency (no provider events exist) |
| Refund support | ❌ none |
| Reconciliation | ❌ none — no `payment` row exists to reconcile |
| BNPL / SnappPay / DigiPay | ❌ no provider. Only a **site-builder display setting** (`provider: "snappay"|"digipay"|"both"`) |
| BNPL retail-only enforcement | Guard exists (`assertPaymentMethodAllowed`) and rejects unknown methods ✅ — **but the wholesale order path never calls it (D23)**, and the VIP surface renders BNPL (D22) |

**Net:** money is now *priced* correctly and *never collected*. The distance to the target payment
architecture (standard online, SnappPay, DigiPay, future providers) is not "add an adapter" — it is
"build the domain".

### 3.9 Shipping (special focus)

| Aspect | State |
|---|---|
| Hardcoded shipping prices | Yes — **in two places**: `Checkout.tsx:14-17` and `retail-pricing.ts:29-32` (59,000 / 89,000 / 145,000 IRR) |
| Fixed providers | Post, Pishtaz, Tipax — three constants, no provider concept |
| COD interaction | `cod` forces shipping to 0 (`retail-pricing.ts`) — a pricing rule living in the pricing module |
| Tracking | `purchase_order.tracking_code` only; **no `shipment` table**, no event history |
| Shipment entity | ❌ missing |
| Provider abstraction | ❌ missing |
| Rule engine (weight, destination, SLA) | ❌ missing |
| Multiple shipments per order | ❌ missing (one PO = one implicit shipment) |
| Supplier-origin routing | ❌ missing (PO is per supplier but never becomes a shipment) |
| Target providers | Post · Tipax · local courier · Kolbe delivery · supplier delivery · external APIs — none integrated |

### 3.10 Integrations, notifications, content

| Feature | Implementation | Truth | Maturity |
|---|---|---|---|
| SMS | `kv_sms_provider_v1`, `kv_sms_templates_v1`, `kv_marketing_outbox_v1` | LS | fake — no provider |
| Email | none | — | missing |
| Webhooks (outbound) | a fake URL string in `AdminOperations.tsx` | HC | fake |
| Webhooks (inbound) | none | — | missing |
| Redis / BullMQ | none in application code; Redis exists only in Compose | — | missing |
| S3 / object storage | none; media is base64 in LS or a video data-URL in `site_setting` | — | missing |
| Error logging | `system_log` + `POST logs/client` + `AdminLogs.tsx` | PG | **prod** (but unauthenticated ingestion — D21) |
| Audit logging | `audit_log` (append-only trigger), 10 write paths, `appendAudit()` in-transaction | PG | **prod** |
| Perfect Corp | server proxy | PG- | partial (D20) |
| Payment gateways | none | — | missing |

---

## 4. Supabase dependency map

**There is no Supabase dependency left.** Measured:

- `grep -i supabase` over all source: **zero hits** in any runtime file.
- Zero `@supabase/*` packages in any `package.json`; nothing in `package-lock.json`.
- No `VITE_SUPABASE_*` outside documentation.
- No `supabase/` directory (only a stale `.gitignore` entry).

| # | File | Purpose | Nature | Target replacement | Phase |
|---|---|---|---|---|---|
| 1 | `frontend-supplier/.env.example` | advertises `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | stale config | delete with the duplicate fork | 7 |
| 2 | `frontend-kolbe/.gitignore` | `supabase/.temp/` | stale ignore rule | delete with the fork | 7 |
| 3 | `WholesaleAdmin.tsx:8,67,69` | `import { isBackendConfigured as isSupabaseConfigured }` — a **rename only**, plus one leftover user-facing string "ثبت وضعیت تیکت در Supabase انجام نشد." | misleading naming | rename to `isBackendConfigured`; fix the string | 2 |
| 4 | `AdminPortal.tsx:6,78,79` | same rename alias | misleading naming | same | 2 |
| 5 | `docs/*` | historical references | docs | already superseded in the charter §6 | — |
| 6 | `.gitignore` | `supabase/.temp/` | stale | remove | 7 |

**Conclusion:** rule A4 is satisfied in code. What remains is **naming debt and two user-facing
strings** that make readers and operators believe Supabase is still in play. Removing them is a
30-minute task in phase 2 — do it while touching those files, not as a mass rename.

---

## 5. localStorage dependency map

43 keys, measured. Sorted by business risk.

| Key | Feature | Risk | Target backend replacement | Phase |
|---|---|---|---|---|
| `kv_wallet_<phone>` | **Wallet balance** | 🔴 **A11/A12 violation** — a balance exists only in one browser | `wallet` + `ledger` (append-only) | 5 |
| `kv_admin_roles` | Roles & permissions | 🔴 fake security; toggles have no effect | `admin` module + `account_user.role` + permission tables | 2 |
| `kv_admin_2fa` | Two-factor auth | 🔴 fake security; "2FA on" means a checkbox | `auth` TOTP enrolment + recovery codes | 2 |
| `kv_customer` / `kv_vip` / `kv_admin` / `kv_supplier` | Session tokens | 🔴 **A9 violation** — tokens readable by any script | HttpOnly cookie (already issued; client must stop using LS) | 2 |
| `kv_admin_products_v2` | Product catalogue + **variants** + prices + media | 🔴 customer-facing catalogue diverges from DB | `products`/`offers`/`pricing`+ `files` | 3 |
| `kv_admin_product_trash` | Product soft-delete | 🟠 deletes exist in one browser | `products.deleted_at` | 3 |
| `kv_admin_customers` | Customer blocks | 🟠 "blocked customer" is not enforced | `customers` | 4 |
| `kv_admin_crm_v1` / `v2` | CRM | 🟠 fabricated customer records | `customers` + CRM module | 4 |
| `kv_admin_orders` | **Retail order board** | 🟠 operator sees orders that do not exist server-side | `orders` (read `retail_order`) | 4 |
| `kv_admin_returns` | Returns | 🟠 fake money movement | `refunds` + `claims` | 5 |
| `kv_admin_warehouses` | Warehouses + stock | 🟠 no real inventory location model | `warehouses` + `inventory` | 3 |
| `kv_admin_integrations` | Integrations incl. gateway status | 🟠 claims "زرینپال متصل" with no gateway | `integrations` | 6 |
| `kv_admin_system` | System settings | 🟡 | `integrations`/`admin` settings | 6 |
| `kv_admin_wholesale_requests` | VIP/supplier leads | 🟡 seeded with fake applicants | `vip`/`suppliers` | 3 |
| `kv_admin_articles` | Blog CMS | 🟡 | content module | 6 |
| `kv_wholesale_tickets` | VIP support tickets | 🟡 tickets vanish with the browser | `support` | 4 |
| `kv_support_conversations_v1` | Support chat | 🟡 fake realtime | `support` + WebSocket/SSE | 4 |
| `kv_support_websocket_url` | Chat transport | 🟡 arbitrary URL from LS | `integrations`-managed | 6 |
| `kv_campaign_center_v1` | Campaigns | 🟡 | `promotions` | 4 |
| `kv_coupon_center_v1` | Coupons | 🟡 | `promotions` | 4 |
| `kv_marketing_messages_v1` / `kv_marketing_outbox_v1` | SMS automation | 🟡 | `notifications` | 6 |
| `kv_sms_provider_v1` / `kv_sms_templates_v1` | SMS config | 🟡 provider credentials in a browser | `integrations` (server-side secrets) | 6 |
| `kv_catalog_taxonomy_v1` | Taxonomy | 🟡 | `catalog` | 3 |
| `kv_commerce_events_v1` | Analytics | 🟡 | `analytics` | 6 |
| `kv_kolbe_wholesale_catalog_v1` | Wholesale catalogue overrides | 🟠 price overrides invisible to the server | `offers` | 3 |
| `kv_retail_policies_v1` | Policy content | ⚪ | content module | 6 |
| `kv_vip_plans_v1` | VIP plans + prices | 🟠 pricing authority in a browser | `vip` + `pricing` | 3 |
| `kolbe-site-content-v3` | **Site CMS / builder** | 🟠 hybrid; server clobber race (D32) | content module | 6 |
| `kv_homepage_journal_pins` | Homepage curation | ⚪ | content module | 6 |
| `kv_customer_identity` | Customer identity | 🟠 id derived from the phone number | `customers` | 4 |
| `kv_wholesale_draft` | Wholesale draft order | 🟢 **allowed** (draft) | keep, or `carts` | — |
| `kv_wholesale_membership` | VIP membership mirror | 🟢 display cache only; access is server-decided | remove after phase 2 | 2 |
| `kv_crm_focus_customer` | UI focus | 🟢 **allowed** (UI state) | — | — |
| `kv_promo_seen` | Promo popup | 🟢 **allowed** | — | — |
| `kv_cart` / `kv_wish` / `kv_compare` | Cart, wishlist, compare | 🟢 **allowed by charter A5** | `carts` if cross-device is wanted | 4 |
| `kolbe-storefront-theme` | Theme | 🟢 **allowed** | — | — |
| `kv_page_*` | CMS page drafts | 🟡 | content module | 6 |

**Allowed client-owned keys (charter A5):** cart, wishlist, compare, theme, promo-seen, UI focus.
**Everything else in this table is debt** with the phase above.

---

## 6. Data migration map

Forward-only and additive: every phase adds tables and backfills; no existing table or column is
dropped until its replacement is verified in production (charter §5, rule 4).

| Existing entity (PostgreSQL) | Rows in dev | Target owner | Target shape | Phase |
|---|---|---|---|---|
| `account_user` | 3 | `auth` | same table; add `status`, `last_login_at`, token version; **role enum becomes a CHECK** | 2 |
| `supplier` | 1 | `suppliers` | same; add `status` CHECK, `settlement_cycle` | 3 |
| `supplier_application` | — | `suppliers` | unchanged; add audit columns | 3 |
| `supplier_member` | 1 | `supplier-team` | same; add `role` per member | 4 |
| `supplier_product` | 3 | `products` | keep as the **supplier offer**; add `kolbe_first_party` flag (Kolbe is also a first-party seller) | 3 |
| `supplier_variant` | 3 | `products` | becomes the canonical `product_variant`; add `flat_lay_asset_id`, `barcode` | 3 |
| `supplier_inventory` | 3 | `inventory` | split: stock per **warehouse** (`inventory_level`), reservations in their own table with expiry | 3 |
| `wholesale_account` | 1 | `vip` | same; add `plan_id` referencing a real `vip_plan`; the membership fee becomes a `payment` | 3 |
| `wholesale_order` | — | `orders` | same table, plus `payment_status`, `channel`; money stays bigint | 4 |
| `wholesale_order_item` | — | `orders` | unchanged (already has snapshots) | 4 |
| `purchase_order` | — | `orders` | **rename to `supplier_order`** (the name "purchase order" is wrong: Kolbe is not buying goods, it is routing a customer order to a supplier) | 4 |
| `purchase_order_item` | — | `orders` | same rename | 4 |
| `retail_order` | — | `orders` | same; `order_status` gains a CHECK; link `customer_id` to a real customer row | 4 |
| `retail_order_item` | — | `orders` | unchanged (snapshot columns already correct) | 4 |
| `rfq` | — | `offers` | same; `supplier_id` becomes a real FK | 3 |
| `quote` | — | `offers` | same; `unit_price` bigint, add `status` CHECK | 3 |
| `support_ticket` | — | `support` | same; add `customer_id`/`order_id`; `status` CHECK | 4 |
| `site_setting` | — | content (new) | becomes `content_document` with `version` + `updated_by`; keep the key/value row for the transitional period | 6 |
| `system_log` | — | `analytics` | unchanged | 6 |
| `audit_log` | — | `audit` | unchanged (append-only trigger proven) | done |

| New tables required (not present today) | Owner | Phase |
|---|---|---|
| `customer`, `customer_address` | `customers` | 4 |
| `cart`, `cart_line` | `carts` | 4 |
| `warehouse`, `inventory_level`, `inventory_reservation` | `warehouses` + `inventory` | 3 |
| `shipment`, `shipment_event`, `shipment_item` | `shipments` | 4 |
| `shipping_method`, `shipping_rate_rule` | `shipping` | 4 |
| `payment`, `payment_attempt`, `provider_webhook_event` | `payments` + `payment-providers` | 5 |
| `ledger_account`, `ledger_entry` (insert-only) | `ledger` | 5 |
| `wallet`, `wallet_transaction` | `wallet` | 5 |
| `refund`, `refund_line` | `refunds` | 5 |
| `settlement`, `settlement_line` | `settlements` | 5 |
| `withdrawal_request`, `payout` | `withdrawals` + `payouts` | 5 |
| `claim`, `claim_message` | `claims` | 5 |
| `vip_plan`, `vip_subscription` | `vip` | 3 |
| `product_media`, `file_object` | `files` | 6 |
| `try_on_job`, `try_on_usage` | `try-on` | 6 |
| `outfit`, `outfit_item` | `style-builder` | 6 |
| `promotion`, `coupon`, `coupon_redemption` | `promotions` | 4 |
| `notification`, `notification_template`, `delivery_attempt` | `notifications` | 6 |
| `order_event` (append-only) | `orders` | 4 |
| `price_history` | `pricing` | 3 |

**Media migration.** Two distinct problems, two different treatments:
1. **Base64 images in `kv_admin_products_v2` and video data-URLs in `site_setting`** — uploaded to
   object storage by an importer, rows written to `file_object`, LS blob deleted only after the
   import is verified against a checksum. Video data-URLs in `site_setting` need this first: they are
   already server-side and already hurting (a base64 video in a jsonb row).
2. **Per-variant flat-lay assets (do not exist)** — a new human workflow, not a migration.

---

## 7. Domain ownership map

The registry (`apps/api/src/modules/registry.ts`) is the authority and the boundary test enforces it.
This table adds the target tables and flags the problems.

| Module | Owns (today) | Owns (target adds) | Depends on |
|---|---|---|---|
| `health` | — | — | — |
| `auth` | `account_user` | `session`, `login_attempt`, `two_factor` | audit |
| `users` | — | admin/staff identities | auth, audit |
| `customers` | — | `customer`, `customer_address` | auth, audit |
| `vip` | `wholesale_account` | `vip_plan`, `vip_subscription` | customers, pricing, audit |
| `suppliers` | `supplier`, `supplier_application` | — | auth, audit |
| `supplier-team` | `supplier_member` | member roles | suppliers, auth |
| `catalog` | — | `category`, `collection`, taxonomy | — |
| `products` | `supplier_product`, `supplier_variant` | `product_media`, first-party flag | catalog, audit |
| `offers` | `rfq`, `quote` ⚠️ **currently unassigned** | supplier offers per product | products, suppliers |
| `pricing` | — | `price_book`, `price_history` | products |
| `promotions` | — | `promotion`, `coupon`, `coupon_redemption` | pricing, orders |
| `inventory` | `supplier_inventory` | `inventory_level`, `inventory_reservation` | products, warehouses |
| `warehouses` | — | `warehouse` | suppliers |
| `carts` | — | `cart`, `cart_line` | products, pricing |
| `checkout` | `retail_order`, `retail_order_item` ⚠️ | — (orchestrator only) | pricing, inventory, orders |
| `orders` | `wholesale_order`, `wholesale_order_item`, `purchase_order`, `purchase_order_item` | `order_event`, rename PO → `supplier_order` | products, audit |
| `fulfillment` | — | fulfilment orchestration (no tables) | orders, inventory |
| `shipments` | — | `shipment`, `shipment_event`, `shipment_item` | orders, shipping |
| `shipping` | — | `shipping_method`, `shipping_rate_rule` | warehouses |
| `payments` | — | `payment`, `payment_attempt` | orders, payment-providers |
| `payment-providers` | — | `provider_webhook_event` | — |
| `refunds` | — | `refund`, `refund_line` | payments, orders |
| `ledger` | — | `ledger_account`, `ledger_entry` | — |
| `wallet` | — | `wallet`, `wallet_transaction` | ledger, customers |
| `settlements` | — | `settlement`, `settlement_line` | ledger, suppliers |
| `withdrawals` | — | `withdrawal_request` | wallet, ledger |
| `payouts` | — | `payout` | settlements, payment-providers |
| `claims` | — | `claim`, `claim_message` | orders, support |
| `support` | `support_ticket` | ticket messages | auth, orders |
| `notifications` | — | `notification`, `notification_template`, `delivery_attempt` | — |
| `integrations` | — | integration config + secrets | audit |
| `style-builder` | — | `outfit`, `outfit_item` | products, customers |
| `try-on` | — | `try_on_job`, `try_on_usage` | files, products |
| `analytics` | `system_log` | — | — |
| `audit` | `audit_log` | — | — |
| `admin` | — | admin settings | auth, audit |
| `files` | — | `file_object` | — |
| `content` ⚠️ **not yet in the registry** | — | `content_document` | files, audit |

**Ownership conflicts to resolve before phase 3:**

1. **`retail_order` is owned by `checkout`, while `orders` owns the other three order tables.** Two
   modules own "an order". The order domain must be one module: `orders` owns every order table;
   `checkout` orchestrates pricing/inventory/creation through `orders` and owns no tables.
2. **`rfq` and `quote` belong to no module.** They are in `UNASSIGNED_TABLES`, where the boundary
   test tolerates them precisely so this cannot be forgotten. They are supplier-facing commercial
   negotiation → `offers`.
3. **`site_setting` belongs to no module.** It holds the entire storefront CMS blob and a base64
   video. Needs a `content` module (register it) before the CMS work in phase 6.
4. **`content` does not exist in the registry** even though CMS/media work is phase 6. Add the module
   in phase 3 so the ownership exists before the code.
5. `audit_log` vs `event history`: `audit_log` is the compliance trail; order state changes need
   their own append-only `order_event` so `audit` never becomes the domain event log (already noted
   as T6 in the phase report).

---

## 8. Technical debt register

Severity: **BLOCKER** (must not reach production) · **P0** (fix in the current phase) ·
**P1** · **P2** · **P3**. D-numbers continue the existing register so history is preserved.

### Closed since the last audit

| ID | Was | Now |
|---|---|---|
| D1 | Retail checkout HTTP 500 | ✅ fixed `f564fdf`, regression test |
| D2 | VIP self-approval | ✅ fixed `c224714`, re-verified by probe P7, 7 tests |
| D3 | Client-trusted retail totals | ✅ fixed, tamper test |
| D5 | No migrations | ✅ `packages/database` + 2 migrations, parity test |
| D11 | Float in `bulk-price` | ✅ integer basis points (`bulk-price` only — see D28) |
| D13 | No idempotency | ✅ on retail + wholesale creation; ❌ 20 other endpoints (D35-adjacent) |
| D14 | No audit trail | ✅ `audit_log`, append-only trigger, 10 write paths |
| D10 | No tests, no CI | 🟡 166 tests pass; CI written but **inactive** |
| D27 | 0 foreign keys, 0 CHECK constraints, 15 free-text status columns | ✅ **closed in phase 1.2** by migration `0002`: 21 FKs (`ON DELETE RESTRICT`), 40 CHECKs mirroring the code state machines, money ranges bounded by `MAX_MONEY`, `reserved <= on_hand`; asserted by `clean-migration`, `state-constraints` and `legacy-upgrade` suites |
| D46 | `MAX_MONEY` enforced only in application code | ✅ **closed in phase 1.2**: every money column carries `CHECK (col >= 0 AND col <= 1000000000000000)`; no float/real/double column exists in the schema |

### BLOCKER

| ID | Debt | Evidence | Impact | Fix |
|---|---|---|---|---|
| **D18** | **The demo seed runs in production and creates an admin account whose password is in this repository.** `database.ts:228-232` defines `admin@kolbe.ir` / `KolbeAdmin1404!`; `initialize():294-299` calls `seed()` on every boot with **no `NODE_ENV` guard**. | `sed -n '228,232p' frontend-next/server/database.ts`; `sed -n '294,299p'` | Anyone who can read this repository owns the admin panel of every deployment that booted a fresh database. Also seeds a VIP and a supplier account, a supplier, and three approved products. | Gate `seed()` behind `NODE_ENV !== "production"` **and** an explicit `KOLBE_SEED_DEMO_DATA=true`; add a production guard test. Requires credential rotation on any existing deployment. |
| **D19** | **No payment domain exists, yet orders are accepted as paid-placed for four payment methods.** `RETAIL_PAYMENT_METHODS` includes `gateway`, `installment`, `wallet`, `cod`; probes show all four return `201` and the order is written with no payment row, no provider call, no callback. There is **no `payment`, `ledger`, `wallet`, `refund`, `settlement`, `withdrawal` or `payout` table**, and no provider adapter anywhere in the repo. | Probes PAY ×4; `pg_constraint` shows 20 tables, none financial; `rg -i "zarinpal\|idpay\|shaparak"` → 0 hits outside docs | Every order is free. Revenue is not collected, not recorded, and not reconcilable. The supplier Finance screen shows hardcoded balances (32.4M/48.6M) that no system can pay out. | Phase 5 in full: `payments` + `payment-providers` (invoices, intent, callback with signature + amount re-verification, idempotent provider-event keys), then `ledger` (append-only, `sum = 0` invariant) and everything downstream. Until then, `gateway`/`installment`/`wallet` must **not** be offered: restrict to `cod` or mark orders `payment_pending`. |

### P0

| ID | Debt | Evidence | Impact | Fix |
|---|---|---|---|---|
| **D20** | **The Try-On provider proxy is completely unauthenticated.** `kolbe-api.ts:1224-1227` handles `try-on/*` **before** the auth chain and **before** `await database()`. Probe P5: `POST try-on/files` with no token reaches `perfectFetch`. No rate limit on `/store/kolbe/` in `infra/nginx/kolbe.conf`. | probe P5; `sed -n '1221,1228p'`; `infra/nginx/kolbe.conf` (`limit_req` only inside `/api/v1/`) | Anyone on the internet can drive Kolbe's paid Perfect Corp key: upload arbitrary images to the provider under Kolbe's account and burn its quota/cost. The provider also receives untrusted user images with no Kolbe-side retention control. | Require a customer session on all `try-on/*`; add per-user and per-day usage caps; add a rate-limit zone for `/store/kolbe/`; move the work to a BullMQ job. |
| **D21** | **`POST logs/client` is an unauthenticated, unbounded database insert.** `kolbe-api.ts:1452-1464`: no auth, writes one `system_log` row per distinct fingerprint with attacker-controlled `message`/`url`/`name`/`type`. Probe P6: `202 accepted` with no token. | probe P6 | Table growth to disk exhaustion; log-dashboard poisoning that can hide real incidents; a free write primitive. | Require a session (or a signed site token); cap body size; add a rate limit; drop rows above a per-IP hourly budget. |
| **D22** | **BNPL leaks into the VIP/wholesale surface.** `App.tsx:63` routes `/vip/*` to `VIPPortal`; `VIPPortal.tsx:53` renders the **retail** `ProductPage`; `ProductPage.tsx:954` renders the SnappPay/DigiPay installment block; `siteSettings.ts:336` defaults it to `enabled:true, provider:"snappay", showOnProduct:true`. | the four paths above | VIP/wholesale users are shown a retail BNPL offer they must not have. Violates the "BNPL is RETAIL ONLY" constraint in the live product, not just in docs. | Make the installment component channel-aware (`retail` only), and give the VIP shell its own product page instead of borrowing the retail one. |
| **D23** | **The wholesale order path ignores the payment method and never enforces the retail-only rule.** `POST wholesale/orders` (`kolbe-api.ts:720-789`) accepts a body with `paymentMethod` and creates a 10,680,000-order (`probe W3` → `201`) without calling `assertPaymentMethodAllowed("wholesale", …)`. The guard exists but is wired to nothing on this path. | probe W3; `rg -n "assertPaymentMethodAllowed" frontend-next/server/*.ts` → only `retail` paths | A VIP can create unlimited wholesale orders with any declared payment method and no payment at all. The A20 mechanism is decorative on this path. | Call the guard on the wholesale path; reject unknown fields; add a test asserting `installment` is rejected for channel `wholesale`. |
| **D24** | **Wallet balances are written directly from the admin UI into localStorage.** `Admin.tsx:642`: `localStorage.setItem(\`kv_wallet_${phone}\`, String(wallet))`. There is no `wallet` table, no ledger, no audit record. Meanwhile `wallet` is an accepted server payment method. | `sed -n '642p' frontend-next/storefront/pages/Admin.tsx`; probe PAY `wallet` → 201 | Directly violates A11 ("wallet is a separate domain") and A12 ("balances are never edited directly"). A capability that looks like crediting a customer does nothing, and the same word is a payable method on the server. | Remove the UI until phase 5; then `wallet` is a projection of `ledger_entry` and every change is an append-only ledger transaction with an audit record. |
| **D25** | **Supplier product creation accepts a negative, fractional or non-numeric price.** Probe P3: `wholesalePrice: -999999` → **201 created**. Probes P1/P2: `1234.56` and `"abc"` → **HTTP 500**. `kolbe-api.ts:545` passes `Number(body.wholesalePrice ?? 0)` straight into a `bigint` column. | probes P1/P2/P3 | A negative wholesale price makes `totalAmount` negative on a wholesale order. A fractional price is a hard 500 (a supplier-visible outage). | Validate with the shared `money()` helper: reject non-integers, negatives and values above `MAX_MONEY` with `422 INVALID_PRICE`. Add a DB `CHECK (wholesale_price >= 0)`. |
| **D26** | **Every database error leaks its SQLSTATE as the public error code.** `handleKolbeRequest` (`kolbe-api.ts:1479-1485`) uses `error.code` as the client-facing `error` value; `pg` errors carry `.code`. Probe P1 returned `{"error":"22P02"}`. | probe P1 | Internal error codes surface to clients, contradicting the stated error contract; the same mechanism can expose `23505`/`23503` and reveal schema structure. | Only map known `DomainError`/`HttpError` codes; everything else becomes `INTERNAL_ERROR` with the detail logged server-side only. |
| **D27** | ~~The schema has zero foreign keys and zero CHECK constraints.~~ | ✅ **Closed in phase 1.2** — see the closed-items table above and the [phase 1.2 report](../phase-reports/phase-1-2-report.md). Note the deviation: the constraint migration ran in **1.2**, not phase 3, because the runtime DDL had to be replaced by migration-owned DDL anyway. |

### P1

| ID | Debt | Evidence | Impact | Fix |
|---|---|---|---|---|
| **D28** | **Wholesale money is computed in JavaScript floats.** `kolbe-api.ts:757` `totalAmount += quantity * Number(item.wholesale_price)`; `:1097` the same pattern for `purchase_order.total_amount`. | the two lines | Violates A10 on a real money path (above 2^53 the totals silently lose precision). | Use `packages/shared/money.ts` bigint arithmetic; round only at display. |
| **D29** | **A compile-time switch bypasses admin and VIP authentication.** `previewMode.ts:8` `PANELS_PREVIEW_MODE = false`; when true, `AdminPortal.tsx:51` starts authenticated and `VIPPortal.tsx:37` injects `DEMO_VIP_MEMBERSHIP`. It is currently `false`, so the weakness is latent — but it ships in the bundle. | the three paths | One boolean flip grants the admin interface without credentials, at build time, with no runtime guard. | Delete `previewMode.ts` and both call sites. If a demo mode is needed, build it behind a server-issued flag with a real session. |
| **D30** | **There are no per-variant product assets.** 43 catalogue colour entries reference **8 image files**; four colours of one blazer all render `/images/model-front.jpg`. No flat-lay exists. | `rg -c "img:" data/catalog.ts` → 43; `ls public/images` → 8 | Colour selection shows the wrong garment. Style Builder Stage 1 is blocked on an asset pipeline that does not exist. | `files` module + S3 + `product_media`; per-variant flat-lay upload in the product editor; the composer then reads variant assets. |
| **D31** | **Three product sources with no synchronisation.** Static `catalog.ts` (12 SKUs, retail), `kv_admin_products_v2` (admin editor), `supplier_product`/`supplier_variant` (suppliers). The retail price book is a **source file**: changing a price requires a deploy. | `catalog.ts`; `adminProducts.ts:40`; `retail-pricing.ts:25-27` | Catalogue integrity cannot be maintained; retail and wholesale disagree about the same garment; no merchant can change a price without engineering. | Phase 3: catalogue + pricing in `packages/database`; retail reads the same catalogue as wholesale; the flat file survives only as seed data. |
| **D32** | **CMS saves can fail silently, and the server copy clobbers local edits on every page load.** `saveSiteSettings` (`siteSettings.ts:616-622`) fires `PUT admin/site-settings` in a 450 ms debounce with `.catch(() => undefined)`. `syncSiteSettingsFromServer` (`:626-644`) writes the server blob into localStorage unconditionally on each visitor load. | the two functions | An admin sees "saved" while the write failed; and an unsaved local draft is overwritten by the server copy without warning. | Surface save failures; add a `version`/`updated_at` precondition so a stale client cannot overwrite a newer server document. |
| **D33** | **`frontend-kolbe/` is a diverging full fork, not a shell.** `diff -rq frontend-kolbe/src frontend-next/storefront` → **48 files differ** (13,026 LOC vs 21,132). It is wired to `npm run dev:kolbe` and `npm run build:legacy`. | the diff; root `package.json` scripts | Two storefronts drift apart; a developer can spend a day editing dead code; the previous blueprint mis-describes it as a shell. | Stop advertising it (remove `dev:kolbe`/`build:legacy` in phase 2 and say so in the README); delete at phase 7 after the parity checklist. |
| **D34** | **The documented verification gate `npm run test:all` fails on a fresh checkout.** `apps/api` imports `@kolbe/database`/`@kolbe/shared`, which resolve to `dist/` (`package.json` `main`/`types`); `dist` is gitignored. Without `build:packages` first: `Failed to resolve entry for package "@kolbe/database"`. | observed in this audit before building | The gate the charter names is not reproducible in CI or on a new machine unless the build happens first — precisely the kind of gap that makes "tests pass" untrue. | `test:all` builds the packages first; verified below. |
| **D35** | **No CSRF protection and no Origin check on state-changing requests.** The session is a cookie with `SameSite=Lax`; there is no token, no `Origin`/`Referer` check, no double-submit. | `sessionCookie()` (`kolbe-api.ts:236-239`) | `SameSite=Lax` blocks cross-site POSTs, so exposure is limited to same-site/subdomain and older-browser cases — but the defence is one browser policy deep and there is no server-side check at all. | Add an `Origin` allow-list check on non-GET requests in phase 2, and a CSRF token where cross-origin is ever needed. |
| **D36** | **Cross-origin responses never carry `Access-Control-Allow-Origin`.** `response()` uses `CORS_HEADERS = corsHeadersFor(null)` (`kolbe-api.ts:48`), computed once with `origin=null`, which yields no ACAO header. | that line | A cross-origin client passes preflight then fails to read the response. Latent today (everything is same-origin) but a trap the moment the admin portal moves to its own origin in phase 7. | Compute CORS headers per request, as the `OPTIONS` branch already does. |

### P2

| ID | Debt | Evidence | Impact | Fix |
|---|---|---|---|---|
| **D37** | VIP membership accepts an unverified, unpersisted `paymentReference`. `wholesale/apply` stores no payment row; the string is echoed back and discarded (probe P7 used `VIP-FAKE-1`). The plan price is a hardcoded Persian-digit string in `Wholesale.tsx:28`. | probe P7; `sed -n '619,712p'` | A membership with no billing record; a fee that can never be reconciled or refunded. | `vip_plan` + `vip_subscription` + a real `payment` in phase 3/5. |
| **D38** | Admin roles, 2FA, integrations, gateway status, warehouses, returns, system settings are localStorage-only. The gateway row reads "درگاه زرینپال · متصل" with no gateway in existence. | `AdminOperations.tsx`; §5 keys | Operators make decisions on fabricated state; a security setting with no effect is worse than no setting. | Remove or clearly label as preview until each has a backend; never ship a security control that is a checkbox. |
| **D39** | Support is fake in three places: `AdminSupportCenter` (LS + `BroadcastChannel` pretending to be realtime, plus a user-supplied WebSocket URL), `kv_wholesale_tickets` (LS) for VIP, and the real `support_ticket` (PG) for suppliers. | `AdminSupportCenter.tsx:3-8`; §3.5 | A ticket can be answered in a UI that stores nothing; supplier tickets in the DB never appear beside VIP tickets in the browser. | One `support` domain; SSE/WebSocket with an authenticated server endpoint. |
| **D40** | No end-to-end test exists. Coverage gaps measured across the 73 tests: supplier authorization (0), inventory races (0), concurrent withdrawals (0 — no withdrawal code), duplicate payment callbacks (0 — no payment code), refund consistency (0), shipment transitions (0 — no shipment entity), Try-On provider failure (0), rate limiting (0), seed guard (0). | test-name inventory | The most dangerous paths are exactly the untested ones. | Add each alongside its phase; nothing financial ships without a concurrency test. |
| **D41** | Shipping prices duplicated in two files (`Checkout.tsx:14-17`, `retail-pricing.ts:29-32`); the COD rule (shipping = 0) lives inside the pricing module. | both paths | A price change in one place silently disagrees with the other. | `shipping_method` table; one authority; the COD rule becomes a shipping rule. |
| **D42** | No `order_event` table: order state changes are recorded only in `audit_log`. | registry note T6 | The compliance trail is doubling as the domain event log, so it cannot be queried by order without scanning audit rows. | Append-only `order_event` in phase 4. |
| **D43** | Retail orders cannot be viewed by the customer (`GET me` only) and the admin retail order board reads localStorage. | §3.1, §3.4 | The most ordinary feature in retail — "where is my order" — has no implementation on either side. | `GET /api/v1/orders` scoped to the session in phase 4. |

### P3

| ID | Debt | Evidence | Fix |
|---|---|---|---|
| **D44** | Dead build artifacts: `apps/supplier/{vite.config.js,vite.config.d.ts,tsconfig.tsbuildinfo,tsconfig.node.tsbuildinfo}`; the whole `frontend-supplier/` source tree duplicates `supplier-src` (7 differing files). | `find apps/supplier -type f`; the diff | Delete artifacts now (they are not a workspace); delete the fork at phase 7. |
| **D45** | Hardcoded fixture text in shipped UI: supplier dashboard greeting "صبح بخیر، نیلگون" and the date "سهشنبه، ۲۱ مرداد ۱۴۰۴"; supplier finance figures; QC/PO numbers in production/QC screens. | `App.tsx:183` and §3.6 | Replace with session-derived values or remove the screens. |
| **D46** | `MAX_MONEY` overflow is enforced only by the domain helper; the database accepts larger values. | phase-0 note | `CHECK (amount <= 1e15)` on every money column with D27. |
| **D47** | CORS in development falls back to `access-control-allow-origin: *`. | `kolbe-api.ts:44-45` | Acceptable for dev; assert in a test that production never reaches that branch (the branch already exists — add the assertion). |

### Discovered during phase 1.2 (N8–N12)

| ID | Debt | Evidence | Fix |
|---|---|---|---|
| **N8** | `POST admin/tickets/:id` and `POST admin/supplier-applications/:id` write `body.status` straight into the row. Now that the column has a CHECK, an out-of-set value returns `500` instead of `422`. Latent: the ticket write path has no UI caller and `updateSupplierApplication()` has none either. | `kolbe-api.ts` ticket/application status handlers | Validate against `packages/database/src/schema/state-values.ts` (one import path, no second list) in phase 2/4 when support and suppliers move. |
| **N9** | `admin/logs/:id` writes `system_log.status` with no CHECK and no validation — free text. | that handler | Keep or drop the endpoint when the observability surface moves; if it stays, add the value set + CHECK. |
| **N10** | Client type unions still advertise states the server rejects: `AdminSupplierProduct.status` includes `changes_requested`, `AdminWholesaleAccount.status` includes `financial_blocked` (and omits `expired`), leaving dead branches in `WholesaleAdmin.tsx`. | `storefront/lib/wholesaleApi.ts:32,184`; `WholesaleAdmin.tsx:112,195,202,211,235` | Align the unions with `state-values.ts` and delete the dead branches in phase 3 (UI cleanup, deliberately not done in 1.2 to keep the diff schema-scoped). |
| **N11** | An adopted database keeps the btree *direction* of its legacy `audit_log` indexes (`created_at DESC`) while a freshly migrated one has ascending indexes. The shape comparison ignores direction on purpose; both serve the same queries. | `test/legacy-upgrade.test.ts`; `verify.ts` | Normalize at phase 3 only if a measurement says it matters; rebuilding audit indexes on a large table is not worth a cosmetic win. |
| **N12** | Status columns with no code-defined state set stay unconstrained: `retail_order.fulfillment_status`, `system_log.status`, `audit_log.action`. | `tables.ts` | Constrain them when their domain (fulfilment, observability) is actually built; inventing values now would be a second source of state. |

---

## 9. Risk-ranked migration plan (strangler)

Unchanged philosophy from ADR-004: **Next.js keeps serving 100% of traffic at every step**; one domain
moves per phase; Nginx flips one `location`; rollback is the same one-line flip. No phase requires a
downtime window. No phase deletes a working feature before its replacement is verified.

Ordering principle: **stop active harm first, then establish the authority, then move domains in
dependency order.**

### Phase 0 — stop the bleed ✅ *complete*

D1, D2, D3 fixed and regression-tested; 73 tests pass.

### Phase 1 — foundations ✅ *mostly complete*

Registry + boundary tests, `packages/shared` (money, state machines, idempotency, errors),
`packages/database` (Drizzle + migrations + parity test), `apps/api` booting with `health` + `audit`,
OpenAPI, `infra/` written, CI written. Open items: D34 (gate reproducibility — fixed in this audit),
CI activation, and the 1.3 deployability proof.

### Phase 1.5 — close the actively harmful holes ✅ *complete*

Implemented and regression-tested; see
[`docs/phase-reports/phase-1-5-report.md`](../phase-reports/phase-1-5-report.md). Two deliberate
deviations from the wording below, both with evidence in that report:
**D19a** keeps all three fulfilable retail methods but records the *truth* (`unpaid` /
`pending_cod`) instead of restricting to COD — COD-only would zero every shipping charge under the
existing "COD ⇒ free shipping" rule — and **D20/D21** quotas are per-process in-memory (Redis is
phase 6).

Ordered by risk ÷ effort. These are small, local, testable changes, and every one is currently
exploitable or misleading in production:

| Order | Item | Size | Why now | Status |
|---|---|---|---|---|
| 1 | **D18** gate the seed behind an explicit flag | S | Highest consequence, smallest change; blocks any deployment | ✅ done — `demoSeedDecision` + `create-admin.mjs` |
| 2 | **D26** stop leaking SQLSTATE | S | Same file, makes every other error diagnosable | ✅ done — `publicError` |
| 3 | **D21** authorize + rate-limit `logs/client` | S | Free write primitive | ✅ done — session + 60/h per user |
| 4 | **D20** authorize Try-On + usage caps | M | Direct financial exposure | ✅ done — session + hourly/daily caps |
| 5 | **D25** validate supplier prices (int + ≥ 0) | S | 500s and negative prices today | ✅ done — `money-input.ts` |
| 6 | **D23** enforce the payment-method guard on wholesale | S | The rule is currently decorative | ✅ done — required + validated |
| 7 | **D22** make BNPL retail-only in the UI | S | Shipped policy violation | ✅ done — `purchaseChannel.ts` |
| 8 | **D24**, **D38** remove fake wallet/roles/2FA controls | S | Remove a security lie before it is trusted | ✅ done — `NotAvailableYet` |
| 9 | **D29** delete `previewMode.ts` | S | Remove an auth bypass from the bundle | ✅ done — file deleted |
| 10 | **D19a** restrict retail payment methods to what can actually be fulfilled | S | Until phase 5, only offer what exists | ✅ done — honest status, fake wallet removed from UI |

Exit criteria: each item has a regression test; `test:count` grows, not shrinks; the charter's green
list is updated. **D19 in full, D27 and D35 are explicitly *not* in this phase** — they are domains
and migrations, not hot-fixes.

Outcome: **73 → 127 tests** (frontend-next 31 → 85); `typecheck:all`, `test:all`, `infra:verify` and a
production Next.js build all pass. Six new debt items (N1–N7) are recorded in the phase report rather
than left implicit.

### Phase 1.2 — `packages/database` becomes the only schema authority ✅ *complete*

Delivered: the 11.6 KB inline DDL block in `frontend-next/server/database.ts` is deleted (the file
went from 400 to 253 lines and is now data-only); startup connects, runs the read-only
`assertDatabaseReady()` guard and fails closed (`503 SERVICE_UNAVAILABLE` in the Next.js handler,
boot failure in NestJS); `GET /api/health` answers `200`/`503` with a generic body; the integrity
constraints ship as migration `0002` (backfill → read-only precheck → 21 FKs → 40 CHECKs → the
missing `system_log` indexes); `npm run db:migrate` (+ `--status`, `--verify-only`, `--adopt-legacy`)
is the canonical, documented path, runbook in [`docs/database-migrations.md`](../database-migrations.md);
`schema-parity.test.ts` is replaced by `clean-migration`, `state-constraints`, `startup-guard` and
`legacy-upgrade` suites plus `frontend-next/test/schema-authority.test.ts`.

Two deviations, both with evidence in the [phase 1.2 report](../phase-reports/phase-1-2-report.md):
the D27 constraint migration ran here rather than in phase 3 (the runtime DDL had to be replaced by
migration-owned DDL anyway), and demo seeding stayed a separate step rather than moving into
migrations — D18's rule ("migrations never seed demo data") is now itself a test.

### Phase 1.3 — deployability proof ✅ *complete (static, Docker host still required)*

Build the images, run the dev Compose stack, run `migrate.mjs` inside it, hit `/api/v1/health`
through Nginx. **Until this passes, no part of `infra/` may be called working** (§0.3).

**Delivered in phase 1.3 (2026-09-17):** Dockerfiles fixed (storefront: `packages/database` copy,
`--workspaces`, migrations; api: src copy; portal: USER nginx + HEALTHCHECK), Compose fixed
(dev: minio healthcheck curl, prod: migrate-env separation, storefront-env with `:?`,
`service_healthy` for nginx, redis healthcheck), Nginx fixed (`/healthz` liveness,
`proxy_no_cache`/`proxy_cache_bypass`, `X-Request-ID`, no nested location),
`infra/.env.example` verified, root `.env.example` completed, `docs/deployment.md` and
`infra/README.md` created, `verify-infra.mjs` enhanced, `verify-deployment.mjs` and
`infra-deployment.test.ts` (32 tests) added. **Gates:** `typecheck:all`, `test:all` (198 tests),
`build`, `infra:verify` all green; `docker compose config/build/up` and `nginx -t` reported as
skipped because this environment has no Docker — see [phase 1.3 report](../phase-reports/phase-1-3-report.md).

### Phase 2 — auth + admin hardening (opens the cascade)

`auth` module: register/login/logout/refresh, HttpOnly cookie as the **only** client credential,
token versioning for revocation, `Origin` checks (D35), permission model (D38), TOTP enrolment.
Delete LS token storage (A9). Delete `previewMode.ts`. Rename the `isSupabaseConfigured` aliases.
Then `/api/v1/` flips from the legacy handler to NestJS for auth — the first real Nginx cut-over.
*Gate:* a parity test proving the legacy token and the NestJS token are interchangeable.

### Phase 3 — catalogue, products, pricing, inventory, suppliers

The largest data change: D31 (one catalogue), D30 + media to S3 (**first real use of `files`**), D27
(FKs + CHECKs + money checks), pricing authority, inventory per warehouse, VIP plans (D37). Retail
and wholesale finally read the same products. *Gate:* the storefront renders DB products with zero
regressions against the 12 known SKUs; `retail-pricing.ts` reads the DB and its tests still pass.

### Phase 4 — orders, fulfilment, shipments, customers

`order_event`, customer order history (D43), shipment entities (D41), the retail order board reading
`retail_order` (D31-adjacent), one support domain (D39). *Gate:* a full order lifecycle test
(retail + wholesale) identical to today's happy path, plus the first shipment-transition and
inventory-race tests (D40).

### Phase 5 — money (highest risk, lowest tolerance)

`payments` + `payment-providers` (real gateway, **idempotent callbacks with amount re-verification**),
`ledger` (append-only, `sum = 0`), `wallet` (D24 proper), `refunds`, `settlements`, `withdrawals`,
`payouts`, supplier finance replacing the hardcoded screen. SnappPay and DigiPay arrive as
`payment-providers` adapters, retail-only, now enforceable by construction because the channel is a
first-class dimension. *Gate:* duplicate-callback, late-callback, partial-refund and concurrent-
withdrawal tests; a reconciliation report that balances to the rial.

### Phase 6 — files, content, notifications, style-builder, try-on

`file_object` + presigned uploads with server-side validation; content module (**including removing
the base64 video from `site_setting`**); BullMQ + notifications; **Style Builder Stage 1** on top of
the real per-variant flat-lay assets from phase 3; **Try-On Stage 2** as a queued job with a provider
abstraction, key management, fallback and cost ceilings (D20's permanent fix).

### Phase 7 — portal extraction

`apps/admin` and `apps/supplier` as real Vite apps; delete `frontend-kolbe/`, `frontend-supplier/`,
`apps/supplier/`; the storefront bundle stops shipping admin and supplier code; Nginx routes each
portal to its own upstream.

**Rollback at every phase:** flip the Nginx `location` back to the storefront upstream. Data is
forward-migrated additively, so the legacy handler keeps working against the same database.
**Never** flip two domains in one phase.

---

## 10. Proposed monorepo structure

```text
apps/
├── storefront/        Next.js — public retail storefront (SEO, SSR catalogue, checkout UI)
├── admin/             Vite + React — operations console (retail + wholesale)
├── supplier/          Vite + React — supplier workspace
├── api/               NestJS modular monolith — the only server (/api/v1)
└── worker/            BullMQ consumers — notifications, try-on jobs, exports, reconciliation

packages/
├── database/          Drizzle schema + migrations. THE schema authority. Imported by api/worker only.
├── shared/            money (bigint), state machines, idempotency, error codes. CJS, no DOM, no node:pg.
├── types/             API DTO types shared by api and the three frontends (generated from OpenAPI)
├── validation/        zod/class-validator schemas shared by client and server (one definition, both sides)
├── config/            typed env loading + fail-closed validation for every app
├── auth/              session token sign/verify, cookie helpers, role/permission predicates
└── ui/                Kolbe design system — the only place Tailwind tokens and primitives live

infra/
├── docker/            one Dockerfile per app (api, storefront, admin, supplier, worker)
├── nginx/             edge config — the strangler switch point
├── compose/           dev (postgres+redis+minio) and prod (all services + migrate gate)
├── ci/                CI workflow (see the note in §11 about activation)
└── scripts/           ops scripts (migrate, backup, restore, smoke)
```

**Mapping from today to the target.**

| Today | Target | Notes |
|---|---|---|
| `frontend-next/storefront/**` (68 files) | `apps/storefront` | Next.js keeps SSR; the SPA is repackaged, not rewritten |
| `frontend-next/supplier-src/**` | `apps/supplier` | Vite; the CSS-in-JS bundle is already self-contained |
| `frontend-next/storefront/pages/Admin*` (8 files) | `apps/admin` | Extract after phase 4 so the panel has a real API to call |
| `frontend-next/server/**` | `apps/api/src/modules/**` | Domain by domain, per §9. `kolbe-api.ts` is deleted when the last domain flips |
| `frontend-next/app/api/health` | `apps/api` `/api/v1/health` | Then deleted |
| `packages/*` | unchanged | Already correct |
| `frontend-kolbe/`, `frontend-supplier/`, `apps/supplier/*.js` | **deleted** (phase 7) | 14.8k LOC + artifacts |
| `scripts/pg.mjs` | `infra/scripts/` | Embedded PG stays a **dev-only** convenience |

**New packages justify themselves only when a second consumer exists.** `packages/types` and
`packages/validation` should not be created empty in phase 2 — they are created in phase 2 *for
auth*, because the admin portal will need the same DTOs and the same validation, and duplicating a
login schema is how the two surfaces drift apart. `packages/ui` waits for phase 7, when the second
React app exists to share with.

---

## 11. Specific questions answered

**Q: Can VIP access be self-approved today?** **No.** Verified twice — by reading
`handleWholesale` (always writes `pending`) and by probe P7, which submitted a fabricated
`paymentReference` and received `201 status=pending` with `/me` still reporting `role: customer`.
Only `POST admin/accounts/:id/status` escalates the role, and rejection demotes it back.

**Q: Does VIP/Wholesale expose retail BNPL (SnappPay/DigiPay)?** **Yes — it does, by default.** D22:
`/vip/*` → `VIPPortal` → the retail `ProductPage` → the installment block, with `enabled:true,
provider:"snappay"` as the default. This contradicts the required constraint and must be fixed in
phase 1.5. Note the wholesale *store* view (`WholesaleStore`/`WholesaleCard`) is clean — the leak is
specifically through the shared retail product page mounted inside the VIP shell.

**Q: Can the frontend supply an arbitrary supplier ID?** It sends one, and the server ignores it in
every ownership-relevant place. The only endpoint that reads `body.supplierId` is admin-gated.
**No bypass found** — A6 holds today.

**Q: Is supplier product creation atomic?** **Yes** — product, variant and inventory rows are written
in a single transaction from one request.

**Q: Which feature looks real but stores only in the browser?** The admin operations surface: products
(including **variants** and media), inventory/warehouses, the retail order board, returns, CRM,
**roles**, **2FA**, integrations and payment-gateway status, warehouses, system settings, support
chat, SMS automation, campaigns. Also the customer wallet balance. Only two admin panels are
database-backed: audit logs and system logs.

**Q: Which schema system is authoritative right now?** Neither cleanly. There are **two live
definitions** of the same 20 tables — the runtime DDL string in `frontend-next/server/database.ts`
(which actually creates them at boot) and the Drizzle schema in `packages/database` (which the
migrations use). They agree exactly today, enforced by `schema-parity.test.ts`, and the target is for
Drizzle to be the only one. Until phase 1.2, **the runtime DDL is what runs** and Drizzle is what is
verified.

**Q: Are the frontends connected to PostgreSQL?** **No.** No browser-side code imports `pg` or
`packages/database`. A7 holds.

**Q: Is anything production-ready?** Per the charter's rule: retail ordering is (server-priced,
validated, idempotent, tested) provided the customer picks `cod`; audit logging is; VIP approval is;
supplier login/products/orders/fulfilment are. **Nothing else in this document is**, and no part of
`infra/` has been executed at all.

---

## 12. What this audit changed in the repository

Documentation and gate correctness only — per the brief, **no feature work and no rewrite**.

| Change | Reason |
|---|---|
| Added this document | The required deliverable |
| `docs/architecture-audit-and-migration-blueprint.md` — superseded banner | It described `frontend-kolbe` as a shell and checkout/VIP as broken; both are wrong now, and an audit that is wrong in one place is not trustworthy in another |
| `package.json` — `test:all` builds workspace packages first | D34: the gate the charter names did not work on a fresh checkout |
| `docs/architecture/master-architecture-rules.md` — §6 registers refreshed from this audit | The registers must be the measured truth, not a memory of it |

**Not changed, deliberately:** D18–D47 are recorded, not patched. They are phase 1.5, and several of
them (D27, D19) are domain work that would be a rewrite if attempted now — which the brief forbids.

---

## 13. Next recommended phase

**Phase 1.5, in the order listed in §9** — ten small, individually tested changes that close the
actively harmful holes, starting with D18 (the seeded production admin account) because it is the
highest-consequence, lowest-effort item in the repository.

Then 1.2 (single schema authority) and 1.3 (deployability proof) before any deployment claim, and
only then the auth cut-over that unblocks the rest.

**One thing to decide before phase 3:** D30 means the Style Builder's Stage 1 depends on a flat-lay
asset pipeline that does not exist. The composer is a phase-6 feature, but the *asset workflow* — how
a human prepares and uploads a per-variant flat-lay — must be designed in phase 3, when the product
editor and media storage are built. If it is deferred to phase 6, the composer starts blocked again.
