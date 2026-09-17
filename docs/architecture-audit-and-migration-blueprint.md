# Kolbe Vintage — Architecture Audit & Migration Blueprint

**Phase:** PROMPT 1 (Repository Audit & Migration Blueprint) · **Date:** 2026-09-17 ·
**Audited tree:** `main` @ `31d1bec` (“feat(platform): migrate to standalone Next PostgreSQL stack”)
**Auditor mode:** read-only audit + live behavioral probes. **No production code was modified in this phase.**

Companion documents: `docs/system-architecture-audit.md` (design-system audit), `docs/roadmap.md`,
`docs/adr/ADR-003-standalone-next-postgres.md`, and the three client requirements
questionnaires (`docs/requirements-*.md`). This document supersedes the “current state”
section of the older audit: **the platform is no longer Supabase-backed** — the Supabase
runtime was removed in `31d1bec`.

---

## 1. Executive summary

| Finding | Detail |
|---|---|
| Strangler stage | The project already completed a big-bang **Supabase → Next.js + PostgreSQL** migration. Supabase code, deps and `supabase/` dir are gone; only naming remnants survive. |
| New chokepoint | The entire backend is one **840-line Next.js route handler** (`frontend-next/server/kolbe-api.ts`) with an inline `CREATE TABLE IF NOT EXISTS` schema (18 tables) and dev seed run idempotently on first request. There is **no NestJS, no Drizzle, no migrations, no Redis/queues, no object storage, no tests, no CI**. |
| Data truth is split | Wholesale/supplier/RFQ/tickets/auth = **real backend**. Retail catalog, retail admin orders, CRM, campaigns, coupons, blog/journal, VIP plans, supplier inventory UI, support tickets (retail side) = **localStorage on the admin’s browser**. Business data that should be central exists only in one person’s browser. |
| Critical bugs found live | ① **Retail checkout API is broken** — every order POST returns HTTP 500 (`pg` serializes the JS `lines` array as a Postgres array literal for the `jsonb` column). ② **VIP membership self-approves** — `POST wholesale/apply` grants `status='approved'` + `role='vip'` with only a free-text “payment reference”. ③ **Retail order totals are client-supplied and stored verbatim** (price-tampering). ④ Retail orders never touch inventory, payments or fulfillment state. |
| Rule violations vs. master architecture | Tokens in `localStorage` (not HttpOnly cookies); float arithmetic in bulk price updates; no append-only ledger; no audit log of admin mutations (only client error logs); no idempotency keys anywhere; uploads stored as Base64 data-URLs in DB/localStorage instead of S3; `/api/v1` REST + OpenAPI absent. |
| Recommended posture | **Phase 0 hot-fix the current Next.js API** (it is the live product), then **build the NestJS modular monolith alongside it** and strangle domain-by-domain behind Nginx path routing. Do **not** attempt to build new features into `kolbe-api.ts` beyond hot-fixes. |

---

## 2. Current architecture map (verified, not assumed)

### 2.1 Runtime topology (today)

```
Browser
└── Next.js 15 app (frontend-next, :3000, single deployment)
    ├── /*                    → SPA storefront (storefront/, hash-router, CSR only,
    │                            SSR disabled; includes /#/admin, /#/vip, /#/wholesale-admin)
    ├── /supplier             → supplier SPA (supplier-src/, CSS injected from public/supplier-portal)
    ├── /api/health           → Route handler: DB ping
    ├── /store/kolbe/[[...path]] → handleKolbeRequest()  ← the entire backend
    ├── /admin/kolbe/[[...path]] → same handler with “admin/” prefix (legacy alias)
    └── server/
        ├── kolbe-api.ts   840 lines: routing, auth, roles, all domain logic
        ├── database.ts    232 lines: pg Pool + inline schema DDL + dev seed
        └── perfect-corp.ts 174 lines: virtual try-on proxy (the only external integration)
                │
                ▼
        PostgreSQL (dev: embedded-postgres on :55432 via scripts/pg.mjs, data dir /home/user/pg)
```

* Legacy Vite apps `frontend-kolbe/` (12.9k LOC) and `frontend-supplier/` are **stale forks** of
  `storefront/` / `supplier-src/`; they proxy API to :3000 and are kept “for maintenance only” per README.
  `apps/supplier/` contains **only committed build artifacts** (`vite.config.js`, `.tsbuildinfo`) — dead.
* `tsconfig` has `"strict": true`; **`tsc --noEmit` passes today** (verified), but `next.config.ts`
  sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`.
* Deployment: none scripted. No Dockerfile, no compose, no nginx config, no `.github/`. `npm run dev`
  is the only runbook.

### 2.2 Backend inventory — the “modular monolith” that isn’t modular

Single function chain in `kolbe-api.ts`: `handleRequest` → `handleAuth` / `handleSupplier` /
`handleWholesale` / `handleAdmin` + top-level (health, site settings, media streaming, retail orders,
client logs, try-on). **41 endpoints** (see §8 parity checklist). No DI, no module boundaries, no DTO
validation library, no OpenAPI.

**Database (18 tables, created by string DDL, zero foreign keys, zero domain indexes):**

`account_user`, `supplier`, `supplier_application`, `supplier_member`, `supplier_product`,
`supplier_variant`, `supplier_inventory`, `wholesale_account`, `wholesale_order`,
`wholesale_order_item`, `purchase_order`, `purchase_order_item`, `rfq`, `quote`,
`support_ticket`, `retail_order`, `system_log`, `site_setting`.

Money columns are `bigint` (IRR) — **correct choice** — but see float findings in §6.
`retail_order.lines/address` are opaque `jsonb` blobs (no item table → no per-line state,
no supplier split, no snapshot guarantees beyond the blob).

**Auth/session model:** custom HMAC token `base64url({sub,role,exp}).HMAC-SHA256`, 14-day expiry,
default secret `kolbe-dev-secret-change-me` if env unset (fails open in prod). Passwords: `scrypt`
+ per-user salt (good). No refresh/rotation, no server-side revocation, no logout endpoint, no
2FA, no rate limiting, no lockout. Login accepts an optional `role` claim filter only.
`requireRole` is exact-match (`customer` ≠ `vip` token can’t hit admin routes — verified live).

### 2.3 Frontend inventory

| App | Location | State |
|---|---|---|
| Storefront + all portals | `frontend-next/storefront/` (30 pages, ~15.9k LOC) | Hash-router SPA, fully CSR. Retail shop = hardcoded `data/catalog.ts` (12 products) + localStorage editor layer. Wholesale/VIP + admin-operations screens call the real API. |
| Supplier portal | `frontend-next/supplier-src/` (~1.7k LOC) | **Hybrid**: session/products/orders/RFQ-tickets via API (mock arrays `data.ts` are *overwritten* by API results); finance, analytics, QC, production, campaigns, holidays, settings = mock/localStorage. |
| Legacy twins | `frontend-kolbe/`, `frontend-supplier/` | Dev-time shells proxying to Next; `frontend-kolbe/.env.example` still advertises `VITE_SUPABASE_URL` (stale). |

### 2.4 Live behavioral verification performed during this audit

Executed against the real stack (`npm ci` → embedded PG → Next dev → HTTP probes):

| # | Probe | Result |
|---|---|---|
| 1 | `npm run typecheck` (kolbe-next, strict) | ✅ passes |
| 2 | `/api/health` with DB ping | ✅ `{ok:true, database.status:"up"}` |
| 3 | admin/supplier/VIP login; unauthorized & forged-token access to `admin/orders`, `supplier/products` | ✅ correct 401s |
| 4 | **Retail order POST** (frontend’s exact payload, 1 and 2 lines) | ❌ **HTTP 500 `invalid input syntax for type json`** — `body.lines` (JS array) is passed raw to a `jsonb` param → `pg` renders a Postgres array literal. One-line fix: `JSON.stringify(body.lines)`. Retail checkout is non-functional at API level end-to-end. |
| 5 | VIP wholesale order with tampered `unitPrice:1` | ✅ server recomputed `10,680,000` IRR from DB prices; MOQ (12 units) enforced; `FOR UPDATE` row lock + reservation applied inside a transaction |
| 6 | Full chain order→admin approve→PO split per supplier→supplier confirm→(ship blocked without tracking)→prepare→ship→deliver | ✅ state machine enforced (`INVALID_STATUS_TRANSITION` 409), inventory `60→48 on_hand`, `reserved` released, parent order auto-`fulfilled` |
| 7 | Unauthenticated admin write attempts | ✅ 401 |

*(probes 5–6 mutated the local dev DB only; DB lives in `/home/user/pg`, not in git.)*

### 2.5 Claims vs. reality (docs drift)

| Claim (docs/roadmap/requirements) | Reality |
|---|---|
| “Retail checkout is real now (module retail)” | Broken — probe #4; also no inventory/payment link |
| “زیرین‌پال sandbox payment provider” | **No payment provider code exists anywhere** (client picks `gateway|cod`; server just stores a status string) |
| “order_events backend exists” (req. docs #18/#48) | **No `order_events` table**; `system_log` is error-tracking, not domain audit |
| “CSV inventory sync for supplier” | Frontend-only — no inventory write endpoint exists in API |
| “VIP admission = admin approval workflow” | `wholesale/apply` **self-approves instantly** |

---

## 3. Feature classification matrix

Legend — **RB**: real backend (Postgres via Next API) · **SB**: Supabase · **LS**: localStorage
(truth lives in browser) · **HK**: hardcoded/mock in bundle · **HY**: hybrid (local-first + async API) · **MI**: missing

| Feature | Class | Where it lives | Notes |
|---|---|---|---|
| Auth (register/login/session) | RB (+LS token) | `auth/*`, `storefront/lib/api.ts` | Tokens in `localStorage` (rule violation); no refresh/revocation/2FA/reset |
| Customer account (`me`) | RB (read-only) | `/store/kolbe/me` | Identity also mirrored in `kv_customer_identity` |
| **Retail catalog (public shop)** | **HK→LS** | `data/catalog.ts` + `kv_admin_products_v2` splice | 12 hardcoded products; “publish” only visible in the editor’s browser; **no retail product API at all** |
| Admin Retail: products editor | LS | `adminProducts.ts` | Full editor (variants, media, specs) — never persisted server-side; trash list LS |
| Admin Retail: orders view/ops | LS + HK | `Admin.tsx` (`kv_admin_orders`) | Fake seed orders (KV-482885…); status changes local only; not the real `retail_order` table |
| Admin Retail: dashboard KPIs | HK | `Admin.tsx` | “۲۳ today / ۱۳۱ week / ۵۴۸ month” static strings |
| Admin Retail: CRM/segments/notes/outbox | LS | `AdminCRM.tsx` (`kv_admin_crm_v1/v2`) | Full UX, zero persistence |
| Wallet balances (customer) | LS | `Admin.tsx` `kv_wallet_<phone>` | No wallet domain server-side |
| Customer blocking | LS | `kv_admin_customers` | Enforced nowhere at checkout |
| Campaigns / coupons / promos | LS | `CampaignCenter.tsx` (`kv_campaign_center_v1`, `kv_coupon_center_v1`) | Discount engine client-side |
| Retail policies / returns | LS | `RetailPolicyCenter.tsx`, `kv_admin_returns` | No returns/refunds domain |
| Blog/journal | LS | `journalSettings.ts` (`kv_admin_articles`, pins) | |
| Site builder (hero/banner/footer/theme) | **HY** | `siteSettings.ts` — LS first, debounced PUT `admin/site-settings`, public GET | Works, but concurrent edits clobber (last-write-wins blob) |
| Hero/banner video | LS→DB blob | `site_setting` rows store **Base64 data URLs**; streamed with Range support | Must move to S3/ParsPack |
| Cart / wishlist / compare | LS (correct) | `store.tsx` `kv_cart|kv_wish|kv_compare` | Acceptable as ephemeral UX state |
| Checkout (retail) | RB (broken) | POST `retail/orders` | 500 bug; client-computed totals stored; no stock, no payment, no email/SMS |
| Wholesale catalog (Kolbe first-party) | LS | `WholesaleCatalogManager.tsx` (`kv_kolbe_wholesale_catalog_v1`) | “Kolbe’s own products” do not reach the backend |
| Wholesale catalog (supplier) | RB | `supplier_product/variant/inventory` via `/wholesale/products` | Price recalc server-side ✅ |
| VIP membership application | RB | `wholesale/apply` | Self-approval flaw |
| VIP plans manager | LS | `kv_vip_plans_v1` | Discounts/early-access not enforced anywhere |
| VIP orders (customer) | RB (+LS mirror) | `wholesale/orders` GET/POST | Server txn: stock lock, reservation, MOQ; draft list LS |
| Wholesale admin ops (approve→PO split→cancel) | RB | `admin/orders/*` | State machine + inventory release verified live |
| RFQ → Quote | RB (partial) | `admin/rfqs`, `supplier/rfqs/*/quote` | No quote-acceptance → no production order |
| Supplier onboarding | RB | `supplier/apply` + admin approval + login creation | Solid |
| Supplier products/PO updates | RB | `supplier/products`, `supplier/orders/*/status` | |
| Supplier inventory edit / CSV | **LS only** | supplier portal inventory screens | No endpoint — “sync” is aspirational |
| Supplier finance/settlement/ledger/payout | HK+LS | supplier `features.tsx` | **No settlement/ledger/payout/wallet domain exists** |
| Supplier performance/analytics funnel | HK | `data.ts` mocks | |
| Support tickets (supplier) | RB | `support_ticket` | Retail-side tickets: LS (`kv_support_conversations_v1`) |
| Notifications / SMS / email | LS mocks | `kv_sms_*`, outbox | **Missing** (provider integration absent) |
| Payments & refunds & BNPL | MI | — | BNPL target must be retail-only per rules; nothing today |
| Shipping/shipments/tracking | RB (thin) | `purchase_order.tracking_code` | No shipment entity, no multi-parcel |
| Moderation of supplier products | RB | `admin/catalog/*/status` | draft/submitted/approved flow exists |
| Analytics events | LS | `kv_commerce_events_v1` (5k cap) | Not sent anywhere |
| Error/system logging | RB | `system_log` + `admin/logs` UI | Fingerprint dedupe — genuinely good |
| Try-on (Perfect Corp) | RB proxy | `try-on/*`, server-side key, MIME/size validation | Best-engineered integration in repo |
| Style suggestions / size advisor | HK (client heuristic) | `styleIntelligence.ts`, `SizeAdvisor.tsx` | OK to remain client-side, but “style builder” is demo |
| Audit of admin actions | MI | — | Required by rules |
| Files/uploads | LS/DB Base64 | `imageUpload.ts` (client resize→dataURL) | No S3, no server validation |

---

## 4. Supabase dependency map

**Runtime dependency: none.** Verified by: `grep -r "@supabase"` in all package.jsons → empty;
no `supabase/` dir; no client code. Remnants to sweep in the monorepo phase:

1. `frontend-kolbe/.env.example` — advertises `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. `frontend-kolbe/.gitignore` entry `supabase/.temp/`.
3. Misleading identifiers: `isSupabaseConfigured` (actually `isBackendConfigured`), error strings
   mentioning Supabase, docs prose. **Rename during portal extraction, never as risky mass-rename now.**

Migration status: the Supabase→Postgres data migration is effectively “done” because the new schema
was seeded fresh (no legacy rows were ported — there is **no production data to migrate**; that is a
gift we must exploit by freezing schema evolution until the real migration tooling lands).

---

## 5. localStorage dependency map

Full inventory (grep `kv_`/`STORAGE_KEY` across `frontend-next`), with disposition for the target platform.
Rule: **UI-preference keys may stay LS; business-data keys must move to API.**

| Key(s) | Owner | Data | Class today | Disposition |
|---|---|---|---|---|
| `kv_customer`,`kv_vip`,`kv_admin`,`kv_supplier` | all | session tokens | LS — violates security rule | **Replace with HttpOnly Secure SameSite cookies** (API phase A) |
| `kv_customer_identity` | storefront | cached profile | mirror | delete after cookie/me() refactor |
| `kv_cart`,`kv_wish`,`kv_compare`,`kv_promo_seen` | storefront | ephemeral UX | acceptable | keep LS + later optional server cart |
| `kv_admin_products_v2`, `kv_admin_product_trash` | admin retail | **entire retail catalog incl. publish state** | truth in browser | → `products`/`variants` tables (Phase 1). One-time import tool needed |
| `kv_admin_orders` | admin retail | retail order list + status | fake | replaced by real retail orders/shipments |
| `kv_admin_customers`, `kv_admin_crm_v1/v2`, `kv_crm_focus_customer` | admin | customers, notes, tasks, messages | LS-only | → `customers`/CRM module (Phase 4) |
| `kv_wallet_<phone>` | admin | wallet balance | LS-only | → `ledger`/`wallet` (Phase 5) — append-only |
| `kv_price_history_*`, `kv_min_stock` | admin | per-product data | LS-only | → `pricing.price_history`, `inventory.alert_threshold` |
| `kv_campaign_center_v1`,`kv_coupon_center_v1`,`kv_marketing_*` | admin | campaigns, coupons, outbox | LS-only | → `promotions` (Phase 4) |
| `kv_retail_policies_v1`,`kv_admin_returns` | admin | policies, returns cases | LS-only | → `returns/claims` (Phase 5) |
| `kv_admin_articles`,`kv_homepage_journal_pins`,`kv_page_*` | admin | blog + page content | LS-only (builder→DB for some) | → `content` (Phase 4) |
| `kv_admin_warehouses`,`kv_admin_roles`,`kv_admin_2fa`,`kv_admin_system`,`kv_admin_integrations`,`kv_tax_integration`,`kv_sms_provider_v1`,`kv_sms_templates_v1`,`kv_support_*`,`kv_discrepancies`,`kv_disputes`,`kv_quality_docs`,`kv_settlement_config` | admin | “Phase-2” admin consoles | LS mocks | → respective modules (warehouses, RBAC, integrations, notifications, claims, settlements) |
| `kv_wholesale_draft` | VIP | draft order | acceptable | keep LS, add server-side quote/draft later |
| `kv_wholesale_orders` | VIP | local mirror of orders | duplicate | drop; read from API |
| `kv_wholesale_tickets`,`kv_wholesale_membership` | VIP | tickets, membership card | LS-only | → support + wholesale_account |
| `kv_vip_plans_v1` | wholesale admin | VIP plan config | LS-only | → `pricing` plans (Phase 3) |
| `kv_kolbe_wholesale_catalog_v1` | wholesale admin | **Kolbe first-party wholesale products** | LS-only | → `products` with `owner_type='kolbe'` (Phase 1) |
| `kv_admin_wholesale_requests` | wholesale admin | supplier/wholesale leads | hybrid | replaced by supplier_application + vip applications tables |
| `kv_supplier_holidays`,`kv_supplier_roles`,`kv_supplier_notif_prefs`,`kv_supplier_campaigns` | supplier | team/settings | LS-only | → supplier-team, notifications (Phase 4) |
| `kolbe-site-content-v3` | storefront+admin | site-builder JSON (mirrors server `site_setting.storefront`) | **hybrid** | keep as cache; server becomes source (Phase 1 content ops) |
| `kv_commerce_events_v1` | storefront | analytics buffer | LS | → event API + queue (Phase 5) |
| storefront theme key | all | theme pref | acceptable | keep |

**~161 `localStorage.*` call sites across 55 files.** None of these are “wrong” in isolation; the
failure mode is that *cross-user business state* (catalog, orders, CRM, finance) lives per-browser.

---

## 6. Rules compliance check (PROMPT 0 vs. code)

| Master rule | Status today | Evidence / gap |
|---|---|---|
| No new features on Supabase | ✅ | §4 |
| No localStorage as business truth | ❌ | §5 — retail catalog, orders, CRM, wallet, plans… |
| No client-supplied supplier IDs as ownership | ✅ | `supplierContext(claims.sub)` derives supplier id from membership — good pattern to preserve |
| Frontend never → Postgres | ✅ | all SQL in `server/` |
| Tokens not in localStorage | ❌ | `kv_*` token keys; fix = cookie auth |
| Money not float | 🟡 | bigint columns ✅; but bulk price `ROUND(price*(1+%; 100.0))` float math; retail totals are client floats |
| Orders/Payments/Shipments/Ledger/Wallet/Settlement/Payout separate domains | ❌ | only `retail_order`, `wholesale_order`, `purchase_order` exist; everything else missing |
| No direct balance edits | n/a (no balances) | will apply at Phase 5 |
| No direct status overwrites | 🟡 | PO state machine validated ✅ (`transitions` map, 409) — extend to wholesale/retail/shipments |
| Webhook idempotency | ❌ | no webhooks exist yet; design must include (Phase 5) |
| Server-side upload validation | 🟡 | try-on ✅; images/videos are Base64 blobs with **no server-side size/type check** on `admin/site-settings` |
| Admin operations auditable | ❌ | `system_log` = error tracking only |
| Historical snapshots immutable | 🟡 | wholesale line items copy name/sku/price ✅; retail = jsonb blob ✅/❌ (no structure); supplier cost vs PO price not snapshotted per PO |
| Retail vs wholesale rules separated | 🟡 | separate tables ✅, but same catalog source conflated with LS |
| BNPL retail-only | n/a | not implemented; encode in `payments` domain spec |
| Module contracts, no cross-module table writes | ❌ | one file writes every table |

---

## 7. Target architecture map

```
                    ┌────────────────────────── Nginx (ParsPack VM, TLS, rate-limit, gzip) ──────────────────────────┐
browser ──►  /            → Next.js 15 Storefront (SSR/ISR)                    apps/storefront
           /supplier      → React+Vite Supplier Portal (static)                apps/supplier-portal
           /admin         → React+Vite Admin Portal (static)                    apps/admin-portal
           /api/v1/*       → NestJS modular monolith :4000  ─── all business APIs, cookies, RBAC, OpenAPI
           /uploads/*      → S3-compatible (ParsPack Object Storage) presigned flows
                                     │
              ┌──────────────────────┼──────────────────────────┐
              ▼                      ▼                          ▼
        PostgreSQL 16         Redis (cache + BullMQ)      S3 (media, invoices, exports)
     (Drizzle migrations,       jobs: notifications,      (bucket per environment)
      append-only ledger,      settlement, moderation,
      row locks for money)     reconciliation, exports
```

**NestJS module ownership** (one module = one folder = owns its tables; cross-module access only via
exported services/commands; HTTP controllers stay thin):

```
auth, users, customers, vip, suppliers, supplier-team, catalog, products, offers,
pricing, promotions, inventory, warehouses, carts, checkout, orders, fulfillment,
shipments, shipping, payments, payment-providers, refunds, ledger, wallet,
settlements, withdrawals, payouts, claims, support, notifications, integrations,
style-builder, try-on, analytics, audit, admin, files
```

Conventions: `/api/v1` prefix; DTO validation via `class-validator`/zod; state machines as pure
domain services; every financial/inventory mutation inside one `SELECT … FOR UPDATE` + insert-ledger
transaction; Outbox table → BullMQ → consumers; idempotency-key middleware for all POST money paths.

---

## 8. Data migration map (current 18 tables → target schema)

Fresh seeded DB ⇒ schema evolution can be breaking until Phase 2 freeze; after Phase 2 (Drizzle
baseline) all changes become additive migrations.

| Current | → Target (module) | Transform |
|---|---|---|
| `account_user` | `users` + `user_roles` (auth/users) | role → membership rows; add `password_updated_at`, `totp_secret`, `failed_attempts` |
| `supplier`,`supplier_application`,`supplier_member` | `suppliers`, `supplier_applications`, `supplier_members` (suppliers/supplier-team) | keep ids; add documents(jsonb→files), rating, sla |
| `supplier_product`,`supplier_variant`,`supplier_inventory` | `products`, `product_variants`, `inventory_levels` + new `inventory_movements` (catalog/inventory) | supplier-owned vs first-party via `owner_type`; price from `offers`/`pricing`; stock changes only via movements |
| — (localStorage `kv_admin_products_v2`) | import tool → `products` (retail, owner_type=kolbe_retail) | one-time browser→API export/import (admin “Publish everything” action) |
| — (`kv_kolbe_wholesale_catalog_v1`) | → `products` + `pricing.wholesale_price_lists` | same importer |
| `wholesale_account` | `vip_accounts` (vip) | enforce admin-approval state machine; documents, credit limit fields reserved |
| `wholesale_order(+item)`, `retail_order` | unified `orders` + `order_lines` + `order_events` (append-only) with `channel='retail'|'wholesale'` (orders) | jsonb lines → real rows; snapshot columns (name/sku/price) kept; retail order gains lines table + payment link |
| `purchase_order(+item)` | `child_orders` (orders/fulfillment) — supplier-scoped | matches master rule “parent → supplier child orders”; add per-child fulfillment status & independent tracking (already 1 PO per supplier ✅) |
| — | `shipments`, `shipment_items`, `tracking_events` (shipments/shipping) | new — multi-shipment per child order |
| — | `payments`, `payment_attempts`, `provider_webhook_events` (idempotent) (payments/payment-providers) | new; retail+vip; BNPL retail-only |
| — | `refunds`, `return_requests`, `return_items` (refunds/claims) | new (returns UI is LS today) |
| — | `ledger_accounts`, `ledger_entries` (append-only), `wallets`, `wallet_entries` (ledger/wallet) | new |
| — | `settlements`, `settlement_lines`, `withdrawals`, `payouts` (settlements/withdrawals/payouts) | supplier finance screens are mock today |
| `rfq`,`quote` | `rfqs`, `quotes`, + `production_orders` from quote-accept (offers/claims) | add acceptance transition |
| `support_ticket` | `support_tickets` + `ticket_messages` (support) | unify with retail-side LS conversations |
| `system_log` | keep as `system_logs`; **new** `audit_logs` (actor, action, entity, before/after jsonb, hash-chain optional) (audit) | admin ops currently unaudited |
| `site_setting` | `content_blocks`, `site_settings` split per key, versioned (`content_versions`) (admin/content) | data-URL video → S3 key; concurrent-edit ETag |
| — | `notifications`, `notification_templates` (notifications) | replaces SMS/marketing LS mocks |
| — | `files` (S3 metadata, checksums, MIME, scan status) (files) | replaces Base64 |

---

## 9. Technical debt register (ranked)

| ID | Debt | Severity | Notes |
|---|---|---|---|
| D1 | **Retail checkout 500** (`jsonb` array param) — public sales broken | 🔴 P0 | one-line fix, needs test; keep storefront unblocked |
| D2 | **VIP self-approval** on `wholesale/apply` (auto role elevation) | 🔴 P0 | gate to `pending` + admin approve (endpoint exists) |
| D3 | Retail totals & lines from client, stored unvalidated; no payment/inventory/fulfillment | 🔴 P0 | recompute server-side; link payments when Phase 5 |
| D4 | No auth hardening: default HMAC secret fallback, LS tokens, no revocation/2FA/rate-limit | 🔴 P0 | cookies + secret required in prod; deny-list via Redis |
| D5 | No migrations/versioned schema (DDL in code, `IF NOT EXISTS`) | 🟠 P1 | blocks safe evolution; Drizzle baseline first |
| D6 | No FKs/indexes beyond uniques; bigint↔text joins unindexed at scale | 🟠 P1 | add during Drizzle baseline |
| D7 | Business data in browser localStorage (retail catalog is the painful one) | 🟠 P1 | §5; importer tooling needed |
| D8 | Monolithic 840-line handler; no module boundaries; `any` JSON types | 🟠 P1 | frozen for new features; strangler extracts |
| D9 | Base64 media in DB (videos) + LS (images); no S3, no server-side upload validation | 🟠 P1 | ParsPack Object Storage + presigned uploads |
| D10 | No tests, no CI, build ignores TS/ESLint errors | 🟠 P1 | test harness from Phase 0 onward |
| D11 | Float in `bulk-price`; no price history table | 🟡 P2 | integer-cent math + `price_history` |
| D12 | Site settings last-write-wins blob; builder cache/DB drift | 🟡 P2 | version + ETag |
| D13 | No idempotency on any POST (double-click = double order) | 🟡 P2 | middleware at Phase 2 |
| D14 | No audit trail of admin mutations | 🟡 P2 | `audit` module |
| D15 | Dual legacy apps (`frontend-kolbe`, `frontend-supplier`) + `apps/supplier` artifact dir | 🟡 P2 | delete after parity checklists; never edit them |
| D16 | Dev-only PG script hardcodes `/home/user/pg`; no prod deploy story; CORS `*`; `console.error` only | 🟡 P2 | Docker/compose/nginx + structured logger (Phase 6) |
| D17 | No email/SMS/notifications, analytics not persisted, try-on key single-tenant | ⚪ P3 | feature backlog |

---

## 10. Risk-ranked strangler migration plan

Philosophy: **keep the Next.js app serving 100% of traffic at all times**; each phase moves one
domain behind `/api/v1` in NestJS; Nginx routes flip per-path; the old handler keeps a thin shim
until its domain is at parity, then its code (not the UI) is deleted. Rollback per phase = flip
route back (data is forward-migrated once, additive).

| Phase | Work | Risk | Rollback | Exit criteria |
|---|---|---|---|---|
| **0. Stop-the-bleed** (this repo, Next.js) | D1 fix + regression test; D2 approval gate; D3 server-side recompute of retail totals from a new `retail_product` source **or** temporarily price-freeze flag; require `KOLBE_SESSION_SECRET` (fail boot if dev fallback in prod); structured errors; Vitest + Supertest harness; CI (typecheck+test+build) | 🟢 low | git revert | checkout creates order w/ server totals; VIP pending; CI green |
| **1. Foundations** | Monorepo scaffold (pnpm workspaces + turbo); `packages/database` = **Drizzle schema mirroring current 18 tables + baseline migration** (single source of truth); Dockerize (api, pg, redis, minio-dev), Nginx + envs (dev/stage/prod on ParsPack); CI matrix; OpenAPI bootstrap | 🟢 low | none (additive) | `drizzle-kit` migrate = parity with `database.ts`; docker compose runs whole stack; seeded data round-trip |
| **2. Auth + users + audit** | Nest `auth` module: argon2/scrypt, **HttpOnly+Secure+SameSite=Lax cookies**, Redis session deny-list, RBAC guards, refresh rotation, rate-limit, TOTP hooks; `audit` module recording admin mutations; parity tests replaying current 41 endpoints; **frontend token plumbing switched to cookies** (storefront + supplier) | 🔴 highest user-visible | Nginx flips auth paths back to Next (Next keeps old login until portals cut) | e2e login for 4 roles; stolen-token revocation test; audit rows verified |
| **3. Catalog & pricing (unified)** | `catalog/products/pricing/inventory/warehouses` modules: first-party (retail + wholesale) **and** supplier products under moderation; variants/stock with `inventory_movements`; price history; CSV import/export; **localStorage importer endpoint** (one-time `kv_admin_products_v2` + `kv_kolbe_wholesale_catalog_v1` upload from admin browser); storefront/Shop/Home/ProductPage read DB via `/api/v1/catalog` (Next SSR) | 🟠 | Next catalog routes stay until parity flag off | retail publish visible cross-device; moderation flow e2e; snapshot immutability test |
| **4. Orders & fulfillment** | unified orders/child orders/shipments + retail checkout (cart on API, stock reservation with TTL via Redis/BullMQ, order_events); VIP wholesale order hardening; RFQ→quote→PO; supplier portal screens repoint; returns/claims start | 🟠 | per-channel flag (`retail|wholesale`) | master-rule chain verified: parent→children→shipments independent statuses; double-submit idempotent |
| **5. Money** | `payments`+`payment-providers` (Zarinpal adapter, **idempotent webhooks**, amount re-verification), `ledger` append-only, `wallet`, `refunds`, `settlements/withdrawals/payouts` for suppliers; BNPL spec (**retail-only**, own ledger accounts) | 🔴 | provider sandbox kill-switch | reconciliation test incl. duplicate/late webhooks; ledger invariants (`sum=0`) property-tested |
| **6. File/media/content/notifications** | `files` (S3 presign, server-side MIME+size+magic validation, dedupe hash); migrate hero/banner videos & product images out of base64; content modules (site builder, blog, policies) versioned; `notifications` via BullMQ (email/SMS Kavenegar-style adapters), analytics ingest + ClickHouse-later | 🟡 | keep dual-read on media keys | no data-URLs in DB > 1MB; presigned upload e2e |
| **7. Portals cut-over & deprecation** | `apps/admin-portal` & `apps/supplier-portal` (Vite) built on extracted APIs, reusing existing components/visual system; VIP workspace on Next `/(vip)`; **retire** `/store/kolbe` + `/admin/kolbe` shims; delete legacy apps + `apps/supplier` artifacts; rename `isSupabase*` remnants; runbook + load test at 100k users target | 🟡 | static redirects kept 1 release | zero callers of legacy prefix in logs for 14 days |

---

## 11. Proposed monorepo structure

```
kolbevintage-services/
├── apps/
│   ├── storefront/        # Next.js 15 + Tailwind (public shop, VIP workspace, SEO)
│   ├── supplier-portal/   # React + Vite + TS (extract supplier-src, preserve CSS/UX)
│   ├── admin-portal/      # React + Vite + TS (extract admin pages from storefront SPA)
│   └── api/               # NestJS modular monolith — modules listed in §7
├── packages/
│   ├── database/          # Drizzle schema, migrations, seed, integrity tests
│   ├── shared/            # zod schemas, domain types, money utils, state machines
│   ├── ui/                # design tokens + shared primitives (from both design systems)
│   └── config/            # tsconfig/eslint/prettier shared presets
├── infra/
│   ├── docker/            # Dockerfiles per app
│   ├── compose/           # dev.yml (pg+redis+minio), prod.yml
│   └── nginx/             # routing, TLS, rate limits, /api/v1 upstream
├── scripts/               # codemods, importers (localStorage→API), deploy helpers
├── docs/                  # this audit, ADRs, API parity checklist, runbooks
├── test/                  # cross-app e2e (Playwright): role journeys
└── package.json           # pnpm workspaces + turbo
```

Rules enforced mechanically: `apps/*` never import each other; only `apps/api` may read packages
`database`; portals/storefront talk to `/api/v1` + `NEXT_PUBLIC_*` config only; ESLint boundaries
plugin guards module-to-module imports inside `apps/api/src/modules/*`.

---

## 12. Recommended implementation order (first ten increments)

1. **0.1** Fix D1 (`JSON.stringify(body.lines)`) + supertest regression for retail order 201; add Vitest harness + CI (typecheck, unit, build).
2. **0.2** D2: `wholesale/apply` → `pending`; reuse admin status endpoint; VIP UI shows “waiting for review”.
3. **0.3** D3: recompute retail totals server-side from DB prices (new `retail_product` seed mirroring current catalog is *deferred to Phase 3* — interim: server clamps client lines against `data/catalog` copy compiled into API? No — interim decision: store lines but **recompute totals from price list constant + shipping rules**, flag `amount_source='server'`; full fix at Phase 3).
4. **0.4** D4-lite: hard-fail boot when `KOLBE_SESSION_SECRET` missing in production; `Set-Cookie` issuance alongside Bearer (dual-read) so 0.5 can flip; `Secure`/`HttpOnly` for new cookie; lock CORS to same origin for `/store/kolbe/*`.
5. **0.5** Idempotency header support on `retail/orders` + `wholesale/orders` (Redis-free: DB unique key on `Idempotency-Key`).
6. **1.1** pnpm+turbo monorepo scaffold; move `frontend-next/storefront`→`apps/storefront` etc. **preserving component styles**; `apps/supplier/*` artifacts & `frontend-*` marked deprecated in README (deleted at 7.x).
7. **1.2** `packages/database`: Drizzle schema 1:1 with live DB, `drizzle-kit generate` as baseline migration; replace runtime DDL with migration check (fail fast if schema version mismatch); add FKs+indexes additively.
8. **1.3** Docker compose (pg16, redis, minio, api, next), Nginx config with `/api/v1` upstream placeholder; ParsPack deploy doc.
9. **2.1** Nest bootstrap with `auth` module replicating the 41 endpoints contract test (each legacy endpoint has a parity test hitting both Next and Nest against same DB fixture).
10. **2.2** Cookie session cutover + `audit` module; only then start extracting domain modules in Phase 3+ order: catalog → inventory → orders → payments.

Each increment: feature branch → PR against this branch → CI green (typecheck/build/tests) → report debt deltas here.

---

## Appendix A — Evidence commands used

```bash
npm ci && npm run typecheck --workspace kolbe-next        # ✅ exit 0
node scripts/pg.mjs ensure && npm run dev                  # embedded PG :55432, next :3000
curl /api/health                                            # ✅ DB up
POST /store/kolbe/retail/orders (frontend payload)          # ❌ 500 — D1 reproduced twice (1 & 2 lines)
POST /store/kolbe/wholesale/orders {unitPrice:1,qty:12}     # ✅ server price 10,680,000; MOQ 422 path exists
approve → PO split → ship-without-tracking 409 → delivered  # ✅ state machine + inventory 60→48, reserved 0
GET admin/orders (no token) / supplier (forged token)       # ✅ 401
grep @supabase **/package.json                              # ✅ none
grep -rc localStorage storefront supplier-src               # 161 sites / 55 files
```

## Appendix B — API parity checklist (current → `/api/v1`)

`auth/register, auth/login, me, health, site/settings, site/hero-video, site/banner-video,
logs/client, retail/orders, wholesale/apply, wholesale/account, wholesale/products,
wholesale/orders (GET/POST), supplier/apply, supplier/auth/login, supplier/session,
supplier/products (GET/POST), supplier/orders, supplier/orders/:id/status, supplier/rfqs,
supplier/rfqs/:id/quote, supplier/tickets (GET/POST), try-on/* (5 Perfect-Corp proxy routes),
admin/site-settings, admin/accounts, admin/accounts/:id/status, admin/supplier-applications,
admin/supplier-applications/:id, admin/suppliers, admin/catalog, admin/catalog/:id/status,
admin/catalog/bulk-price, admin/purchase-orders, admin/purchase-orders/:id/status,
admin/orders, admin/orders/:id/approve, admin/orders/:id/cancel, admin/rfqs (GET/POST),
admin/tickets, admin/tickets/:id, admin/logs, admin/logs/:id` — every route needs a parity
test before its Nginx flip.
