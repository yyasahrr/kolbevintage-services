# Master Architecture & Engineering Rules — Kolbe Vintage Platform

Phase 3.10 checkpoint: [domain ownership freeze](domain-ownership-freeze.md) and
[inventory risk register](inventory-risk-register.md) distinguish the binding target
from measured runtime behavior. Historical completion notes below do not prove
transactional safety: package reservations are not currently atomic and legacy
inventory writers remain. See the [Phase 4 plan](../phase-plans/phase-4-plan.md).

**Status:** binding · **Owner:** Engineering · **Established:** 2026-09-17 (PROMPT 0)
**Scope:** every repository, module, migration and pull request in `kolbevintage-services`
**Companions:** [`prompt-1-audit-and-migration-blueprint.md`](./prompt-1-audit-and-migration-blueprint.md) (current audit; supersedes [the earlier blueprint](../architecture-audit-and-migration-blueprint.md))
(what the system *is* today) · [`../adr/ADR-004-strangler-nestjs-modular-monolith.md`](../adr/ADR-004-strangler-nestjs-modular-monolith.md)
(why we migrate this way)

This document is the constitution. Where it conflicts with an older ADR, this document wins —
ADR-004 records the conflict it creates with ADR-003 and how it is resolved.

---

## 1. Target stack

| Layer | Technology | Workspace | Status |
|---|---|---|---|
| Public storefront | Next.js · React · TypeScript · Tailwind | `apps/storefront` (today `frontend-next`) | **live** |
| Supplier portal | React · Vite · TypeScript | `apps/supplier-portal` (today `frontend-next/supplier-src`) | live (embedded) |
| Admin portal | React · Vite · TypeScript | `apps/admin-portal` (today `/#/admin` inside the storefront SPA) | not extracted |
| Backend | **NestJS** · TypeScript · modular monolith | `apps/api` | **scaffolded, not serving traffic** |
| Database | PostgreSQL 16 | `packages/database` | live (legacy inline DDL) |
| DB access | Drizzle ORM where appropriate; **raw SQL/transactions for money and inventory** | `packages/database` | not adopted |
| Cache / queue | Redis · BullMQ | `infra/compose` | not deployed |
| Object storage | S3-compatible — **ParsPack Object Storage** | `infra/compose`, `apps/api/modules/files` | not adopted |
| Infrastructure | Docker · Docker Compose · Nginx · ParsPack Cloud Server | `infra/` | **statically verified (phase 1.3), not executed on Docker host** |
| API | REST · OpenAPI/Swagger · `/api/v1` | `apps/api` | `/api/v1/health` only |

**Technically justified exceptions** (recorded so they are not re-litigated):

1. **npm workspaces, not pnpm+turbo** (decision 2026-09-17). The repository already ships a single
   `package-lock.json` and npm workspaces; the cost of a package-manager migration during a live
   strangler outweighs the caching benefit at the current repository size. Revisit if CI build times
   exceed 10 minutes or workspace count exceeds 12.
2. **The legacy Next.js route handler keeps serving all live traffic during the strangler**
   (see ADR-004). It is frozen for *new features* but is the correct place for P0 fixes until the
   owning NestJS module reaches parity.

---

## 2. Non-negotiable architecture rules

Each rule names the mechanism that makes it true. A rule with no mechanism is a wish.

| # | Rule | Enforcement mechanism |
|---|---|---|
| A1 | **No microservices.** One deployable backend, a modular monolith. | module registry + boundary test (§3) |
| A2 | Explicit module ownership; a module owns its tables. | `apps/api/src/modules/registry.ts` + `module-boundaries.test.ts` |
| A3 | No module mutates another module's tables. Cross-module access only via exported services/commands and explicit contracts. | boundary test (table references resolved against the registry) |
| A4 | No new production features against Supabase. Supabase is legacy and must disappear. | Supabase runtime already removed (`31d1bec`); PR review + §6 sweep list |
| A5 | No `localStorage` as the source of truth for business data. Cart/wishlist/compare/theme are the only accepted client-owned state. | §6 localStorage register; every migration phase shrinks this list |
| A6 | Client-supplied supplier IDs are never ownership authority. Ownership is derived server-side from the session. | `supplierContext(claims.sub)` pattern; regression test in `frontend-next/test` |
| A7 | The frontend never connects to PostgreSQL. All data access goes through the API. | architectural rule; schema/DDL lives only in `packages/database` (§A21). The legacy Next.js handler imports the **read-only** verifier from that package and nothing else |
| A8 | All sensitive operations go through the backend (NestJS after cutover). | none — review |
| A9 | No auth/session tokens in `localStorage`. Prefer `Secure; HttpOnly; SameSite` cookies. | `session-security.test.ts` (cookie issuance + dual-read + forged/expired rejection) |
| A10 | Monetary values are never floats. Integer minor units + `bigint`. | `packages/shared/money.ts` (bigint-only API) + `bulk-price` integer basis points + tests |
| A11 | Order, Payment, Shipment, Ledger, Wallet, Settlement and Payout are **separate domains** with separate tables. | registry ownership; consolidation is a review-blocking defect |
| A12 | Balances are never edited directly — only via append-only ledger entries. | `ledger` module contract; ledger entry tables are insert-only |
| A13 | Financial history is append-only. | `audit_log` append-only trigger today (proven by test); ledger tables get the same trigger |
| A14 | State-machine statuses are never overwritten directly; every critical transition is validated server-side. | `packages/shared/order-status.ts` transition tables; 409 `INVALID_STATUS_TRANSITION` |
| A15 | Every external callback/webhook is idempotent. | `Idempotency-Key` on money paths today; unique provider-event keys in the `payment-providers` module |
| A16 | All uploads are validated server-side (type, size, magic bytes). | `validateEmbeddedVideo` today; presigned-upload validation in `files` module |
| A17 | Admin operations are auditable. | `audit_log` + `appendAudit()` in the same transaction as the mutation |
| A18 | Product/order/financial snapshots do not change when current configuration changes. | snapshot columns (`product_name`, `sku`, `unit_price`, `line_total`, `price_book_version`) |
| A19 | Retail and Wholesale business rules stay separated where required. | separate tables and endpoints; no shared price path |
| A20 | **BNPL is retail-only.** | `assertPaymentMethodAllowed(channel, method)` in `server/retail-pricing.ts`; tested |
| A21 | **The database schema has exactly one authority: `packages/database` migrations.** Runtime code never creates, alters or repairs schema objects; at boot it verifies compatibility and fails closed. | `npm run db:migrate` is the only DDL path; `assertDatabaseReady()` guard (Next.js → `503`, NestJS → boot failure); static no-DDL scan + guard tests; [`docs/database-migrations.md`](../database-migrations.md) |

---

## 3. Module ownership registry

Backend domains are the 37 below. **A module owns the tables it writes and nothing else.**
The registry is authored in code (`apps/api/src/modules/registry.ts`) so a test can fail when a
module touches a table it does not own.

| Module | Owned tables (target) | Depends on | Phase |
|---|---|---|---|
| `auth` | `users`, `user_roles`, `credentials`, `sessions`, `login_attempts` | audit, notifications | 2 |
| `users` | `user_profiles` | auth, audit | 2 |
| `customers` | `customer_profiles`, `customer_addresses`, `customer_notes` | auth, audit | 4 |
| `vip` | `wholesale_account`, `vip_plan`, `vip_subscription`, `wholesale_request` | customers, pricing, audit | 3 |
| `suppliers` | `supplier`, `supplier_application`, `seller`, `supplier_permission_config` | auth, audit, files | 3 |
| `supplier-team` | `supplier_member` | suppliers, auth | 4 |
| `catalog` | `brand`, `category`, `product`, `product_media`, `product_variant`, `product_variant_media` | audit | 3.8 |
| `offers` | `seller_offer`, `offer_media`, `wholesale_package`, `wholesale_package_item`, `wholesale_pricing_tier`, `rfq`, `quote` | catalog, suppliers | 3.8 |
| `pricing` | `price_lists`, `price_list_items`, `price_history` | offers | 3.8 |
| `promotions` | `campaigns`, `coupons`, `coupon_redemptions`, `promotion_rules` | pricing, orders | 4 |
| `inventory` | `product_variant_inventory`, `inventory_reservation`, `inventory_ledger` | catalog, offers, suppliers, audit | 3.8 |
| `warehouses` | `warehouses`, `warehouse_locations`, `stock_transfers` | suppliers | 3 |
| `carts` | `carts`, `cart_lines` | products, pricing | 4 |
| `checkout` | `checkout_sessions` | carts, pricing, promotions, inventory | 4 |
| `orders` | `orders`, `order_lines`, `order_events` (append-only), `child_orders` | checkout, products, audit | 4 |
| `fulfillment` | `fulfillment_plans`, `fulfillment_allocations` | orders, inventory | 4 |
| `shipments` | `shipments`, `shipment_items`, `tracking_events` | orders, shipping | 4 |
| `shipping` | `shipping_methods`, `shipping_rates`, `carriers` | warehouses | 4 |
| `payments` | `payments`, `payment_attempts`, `payment_allocations` | orders, payment-providers | 5 |
| `payment-providers` | `provider_accounts`, `provider_webhook_events` (idempotent) | payments | 5 |
| `refunds` | `refunds`, `refund_lines`, `return_requests` | payments, orders, claims | 5 |
| `ledger` | `ledger_accounts`, `ledger_entries` (append-only) | — | 5 |
| `wallet` | `wallets`, `wallet_entries` (append-only) | ledger, customers | 5 |
| `settlements` | `settlements`, `settlement_lines` | ledger, suppliers, orders | 5 |
| `withdrawals` | `withdrawals`, `withdrawal_requests` | wallet, ledger | 5 |
| `payouts` | `payouts`, `payout_batches` | settlements, payment-providers | 5 |
| `claims` | `claims`, `claim_messages`, `claim_resolutions` | orders, refunds, support | 5 |
| `support` | `support_tickets`, `ticket_messages`, `support_categories` | users, orders | 4 |
| `notifications` | `notifications`, `notification_templates`, `notification_deliveries` | BullMQ | 6 |
| `integrations` | `integrations`, `integration_credentials`, `webhook_subscriptions` | audit | 6 |
| `style-builder` | `style_boards`, `style_board_items`, `style_products` | products, customers | 6 |
| `try-on` | `try_on_sessions`, `try_on_assets` | files, products | 6 |
| `analytics` | `analytics_events`, `analytics_daily_rollups` | — | 6 |
| `audit` | `audit_log` (append-only, trigger-enforced) | — | **done (legacy API)** |
| `admin` | *no tables* — orchestration, RBAC guards, admin read models only | all | 2 |
| `files` | `files`, `file_variants`, `upload_sessions` | S3 | 6 |

**Cross-module rules**

1. A module exposes exactly one public surface: its Nest `*.module.ts` plus an exported service.
   Other modules import the *service*, never the repository, entity or table.
2. Reads across domains go through the owning module's query service or a read model — never a join
   written from the outside.
3. Write chains that span domains (order → payment → ledger) are orchestrated by the domain that
   owns the *transaction boundary* (`checkout`, `payments`), with explicit commands to the others.
4. No circular module dependencies. If two modules need each other, the shared concept belongs in a
   third module or in `packages/shared`.

---

## 4. Engineering conventions

### 4.1 API

- Base path `/api/v1`; OpenAPI served at `/api/v1/docs`; DTO validation on every input.
- Error body is stable: `{ "error": "<STABLE_CODE>", "message": "<human text>" }`.
  `error` is a contract (clients branch on it); `message` is presentation.
- No internal detail (stack, SQL, driver message) ever crosses the boundary.
- Pagination is explicit (`limit`, `page`/`cursor`), never unbounded.

### 4.2 Money

- Integers only, `bigint` in the domain, string over the wire, `bigint`/`numeric` in the database.
- No `parseFloat`, no `/ 100.0`, no `Number` arithmetic on prices. Percentages use integer basis points.
- Every monetary row carries a currency; IRR has no minor unit.

### 4.3 State machines

- Transition tables live in `packages/shared/order-status.ts` and are pure functions.
- A transition is applied inside a transaction that re-reads the row `FOR UPDATE`; an illegal
  transition is `409 INVALID_STATUS_TRANSITION`, never a silent write.
- Unshipped transitions require their preconditions (`shipped` requires a tracking code).

### 4.4 Idempotency

- Every POST that creates money/order state accepts `Idempotency-Key` (`[A-Za-z0-9._:-]{8,128}`).
- A repeat returns the original result with `200` + `replayed: true`; `201` means "newly created".
- Provider callbacks are keyed on the provider's own event id and stored before processing.

### 4.5 Audit

- Every admin/supplier mutation writes `audit_log` **inside the same transaction** as the mutation,
  with actor, action, entity, before/after and request metadata.
- Never log secrets, tokens, password material or full request bodies.

### 4.6 Frontend

- The storefront is server-rendered where SEO matters (product, collection, journal) and
  client-rendered only for genuinely interactive surfaces.
- Portals (supplier, admin) are static Vite builds served by Nginx; they talk only to `/api/v1`.
- Reuse the existing visual components and CSS; extraction moves files, it does not redesign them.

---

## 5. Working method (per phase)

1. Inspect the current behaviour before changing it; document what is being replaced.
2. Create the smallest safe architecture increment.
3. Do not break unrelated UI; preserve usable visual components; reuse existing components.
4. Remove dead code only **after** the replacement is verified.
5. Add tests; update documentation; run typecheck, build and tests.
6. Report honestly — including failures.
7. Feature branch; small, logically grouped commits; never push to `main`.

**Phase exit report format:** files created · files changed · schema changes · APIs created ·
tests added · remaining technical debt · risks · next recommended phase.

**A phase is not "production ready" unless its tests actually pass.** No exceptions.

**Verification gates.** A phase exit report may only quote these commands' output:

| Gate | Command | Covers |
|---|---|---|
| Types | `npm run typecheck:all` | all four workspaces |
| Tests | `npm run test:all` | shared · database · api · storefront |
| Build | `npm run build` | storefront production build |
| Infra | `npm run infra:verify` | Compose/Nginx structure (not image builds) |

The Infra gate is a static check — it parses the Compose files, resolves every Nginx upstream
against a Compose service, and compares Compose `${VAR}` references against `infra/.env.example`.
It does **not** build images, run Compose or execute `nginx -t`; those require a Docker host and
must be reported as unverified until someone runs them. `infra:verify` exists because it already
caught one config that would have stopped Nginx from starting at all.

**Partial `tsc` coverage warning.** `frontend-next/next.config.ts` sets
`typescript.ignoreBuildErrors`, so a successful `next build` proves nothing about types. The
explicit `tsc --noEmit` in the Types gate is the real check.

---

## 6. Legacy registers (shrink every phase)

**The registers below are the measured truth as of the 2026-09-17 audit
([`prompt-1-audit-and-migration-blueprint.md`](./prompt-1-audit-and-migration-blueprint.md)).
The authoritative, itemised versions with owners and phases are §4, §5 and §8 of that document.
These four lines are the short form to check a diff against.**

- **Supabase sweep list — code is clean, naming is not.** Zero runtime references, zero packages.
  What remains: `frontend-supplier/.env.example` advertising `VITE_SUPABASE_*`, the
  `supabase/.temp/` ignore rule, the `isBackendConfigured as isSupabaseConfigured` alias in
  `AdminPortal.tsx` and `WholesaleAdmin.tsx`, and one user-facing message that says "ثبت وضعیت تیکت
  در Supabase انجام نشد." Fix those five while already touching those files — never as a mass rename.
- **localStorage register:** 43 key names measured in the audit; **four families were removed in
  phase 1.5** — `kv_wallet_*` (a wallet balance that only existed in one browser), `kv_admin_roles`
  (permissions), `kv_admin_2fa` (2FA) and `kv_admin_integrations` (integration switches). Verified
  zero code usages remain; the few textual mentions left are the explanatory comments in the code
  that removed them.
  Acceptable by rule A5 and therefore *not* debt: `kv_cart`, `kv_wish`, `kv_compare`,
  `kolbe-storefront-theme`, `kv_promo_seen`, `kv_crm_focus_customer`, `kv_wholesale_draft`.
  **Everything else is still debt, and still load-bearing on trust:**
  `kv_customer`/`kv_vip`/`kv_admin`/`kv_supplier` (session tokens, rule A9) and
  `kv_admin_products_v2` (products **and variants**) — next in line, with the auth migration.
- **Fake admin surfaces (remove or label; never trust):** phase 1.5 removed the roles/2FA and
  integration switches and the customer-wallet editor from `AdminOperations.tsx`/`Admin.tsx` and
  replaced them with an explicit "not implemented yet" notice (`NotAvailableYet`). Still fake and
  still to be handled: `InventoryOperations` + `CommerceOperations` + `SystemCenter` in the same file
  (`kv_admin_warehouses`, `kv_admin_returns`, `kv_admin_system`), `AdminCRM.tsx`, the
  `kv_admin_orders` retail order board, `AdminSupportCenter.tsx`, `MessagingAutomationCenter.tsx`,
  `CampaignCenter.tsx`. Only `AdminLogs` (system logs) and `admin/audit-logs` are database-backed.
- **Schema-authority register (rule A21, closed in 1.2):** the 11.6 KB inline DDL block that the
  Next.js handler ran on every boot is gone; the schema is created only by
  `packages/database/migrations/*`. The database now carries **21 foreign keys (all
  `ON DELETE RESTRICT`) and 40 CHECK constraints** where the audit measured 0/0, plus the
  `system_log` partial unique index that the error-upsert path always needed. What remains open is
  named in phase-report N8–N12: two admin status endpoints still rely on the database CHECK instead
  of returning `422`, `system_log.status` is still free text, client type unions still advertise two
  statuses the server rejects, and index *direction* differences on adopted databases are accepted
  on purpose. Rollback is forward-only; there is no `down` migration by design.
- **Legacy Vite forks — one is a real fork, not a shell:** `frontend-kolbe/` is 13,026 LOC and **48
  files differ** from `frontend-next/storefront`; `frontend-supplier/` duplicates
  `frontend-next/supplier-src` (7 files differ); `apps/supplier/*.js|*.tsbuildinfo` are dead build
  artifacts. Never edit them; stop advertising `dev:kolbe`/`build:legacy`; delete at phase 7.

---

## 7. Phase plan

The authoritative phase table, risk ranking and rollback strategy live in
[blueprint §9](./prompt-1-audit-and-migration-blueprint.md#9-risk-ranked-migration-plan-strangler).
Summary: **0** stop the bleed · **1** foundations · **1.5** close the actively harmful holes ·
**1.2** single schema authority · **1.3** deployability proof · **2** auth + admin hardening ·
**3** catalog/products/pricing/inventory · **4** orders/fulfilment/shipments/customers ·
**5** money · **6** files/content/notifications/style-builder/try-on · **7** portal extraction.

Current position: **phase 0-1.3 complete; phase 2 auth complete; phase 3.0-3.7 marketplace foundation complete; phase 3.8 clean architecture complete (static)** —
see the [phase 3.8](../phase-reports/phase-3-8-report.md) report. `packages/database` is now the single
schema authority (rule A21): 41 tables, no legacy `supplier_product`/`supplier_variant`/`supplier_inventory`/`legacy_product_mapping`/`legacy_variant_mapping`/`product_match_queue`.
Canonical model: Product → Product Variant (flexible attributes) → Seller → Seller Offer → Product Variant Inventory (only authority) → Inventory Reservation → Inventory Ledger → Order Engine (Phase 4).
`seller_offer` no longer has `inventory_on_hand`/`inventory_reserved` — inventory is via `product_variant_inventory` (variantId+sellerId, supplier-owned). `wholesale_order_item`, `purchase_order_item`, `rfq`, `quote` now use `product_id`, `variant_id`, `seller_offer_id` only (FK to canonical). No bridge `LegacyInventoryAdapter` or `legacy-mapping` remains.

The blockers that phase 1.5 was created for are **closed and regression-tested**: D18, D26, D20, D21, D27 (FK/CHECK). Phase 2 auth (A9, D35, D36, Supabase naming) closed. Phase 3 catalog/inventory: retail only Kolbe published, wholesale Kolbe+Supplier, supplier cannot retail, no Kolbe exclusive for suppliers, inventory authority via InventoryService only, package reservation atomic, expiration foundation, supplier isolation, brand/category validation. Phase 3.8 removes legacy product model entirely — supplier flow is now Supplier→Create Product→Variant→Seller Offer→Admin Review→Publish, with duplicate detection (no auto-merge).

Next in order: **phase 4** Order Engine (carts, checkout, orders, fulfillment, shipments) using `InventoryCutoverService` (now canonical only). Payments, Settlement, Shipping, CRM remain not implemented per scope.
