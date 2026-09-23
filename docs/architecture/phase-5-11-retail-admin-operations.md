# Phase 5.11 — Retail Admin & Operations Backend Architecture

> **Canonical final architecture.** This document reconciles both completed
> Phase 5.11 tranches. The earlier
> [operations-console record](phase-5-11-retail-operations-console.md) is
> retained as historical implementation evidence; this document is the
> authoritative architecture and capability matrix.

**Status:** ACTIVE (Checkpoint A)
**Branch:** `arena/01a0c5f5-kolbevintage-services`
**Date:** September 2026
**Ownership:** `admin` orchestration over retail owner domains (no second writers)

---

## 0. Tranche note (read first)

The pasted Phase 5.11 work order expects start HEAD `6b54da8`
("5.11 has NOT started"). That premise is stale: `6b54da8` is an
ancestor of HEAD, and a console tranche (`f68f528` A /
`8c91bd1` B / `9db651d` C / `3f4cde0` D / `b066d6b` docs, all CI
green) already shipped 23 staff routes under
`/api/v1/admin/retail/*` plus migration 0043. Published history
is immutable, so this work order executes **on top of HEAD**
(`b066d6b`, CI `35833402061` SUCCESS) as the admin-operations
tranche of the same phase. Mechanical adaptations, all
documented:

- Checkpoints re-run as `feat(phase-5-11-a/b/c/d)` per the work
  order's exact messages (prior tranche used `Phase 5.11-A: …`
  style, so the two series stay distinguishable in `git log`).
- Next migration is **0044** (0043 taken; 0000–0042 untouched).
- This arch doc is a new file; the phase report file is
  extended into the single authoritative 5.11 record at
  closeout (D6), ending with the work order's exact sentinel.
- Already-shipped seams map to IMPLEMENTED / PARTIALLY
  IMPLEMENTED below; only genuinely new capabilities are built.

---

## 1. Current admin capabilities (pre-tranche inventory)

| Capability | Where | Notes |
|---|---|---|
| Granular RBAC | `AdminRbacService`, `AdminPermissionGuard`, `ADMIN_PERMISSION_ACTIONS` (65 actions pre-tranche: wholesale/crm/support/notification/cms/analytics/production/promotion; +18 retail = 83) | System roles `super_admin` / `commercial_ops` / `approver` seeded idempotently; coarse `role=admin` fallback preserved (§7) |
| Maker/checker approvals | `AdminApprovalsService` + `admin-approvals.controller` | High-risk wholesale/commercial execution gate; reused, never duplicated |
| Business settings | `BusinessSettingsService` | Versioned registry |
| Internal notes | `InternalNotesService`, targets `ADMIN_NOTE_TARGET_TYPES` (5 wholesale-only values, DB CHECK) | Retail targets need a C-checkpoint CHECK extension |
| Control tower | `ControlTowerService` (`admin/wholesale/control-tower`) | Read-model precedent: direct read-only aggregation, `@Roles("admin")` + `@UseGuards(AdminPermissionGuard)` + per-route `@RequireAdminPermission` |
| Audit | `AuditService` → append-only `audit_log` | Every seam records actor/action/entity/before/after |
| CRM / Customer 360 | `Customer360Service`, `GET admin/crm/contacts/:id/360` | Contact-keyed; identity select is already secret-free |
| Retail staff HTTP (console tranche) | `AdminRetailOpsController` (`admin/retail`, 23 routes) | Coarse `@Roles("admin")` only — this tranche adds granular gates in place; paths unchanged |

## 2. Existing retail owner services and their seams

| Domain | Owner service | Seams this tranche calls (all pre-existing) |
|---|---|---|
| Retail orders | `RetailOrdersService` | `listRetailOrdersForStaff`, `getRetailOrder`, `getRetailOrderTimeline`, `confirmRetailOrder`, `packRetailOrder`, `cancelRetailOrder`, `createRetailShipment`, `markRetailShipmentHandoff`, `recordRetailManualTracking`, `verifyPayment`, `revokeRetailGuestCapability` |
| Retail returns | `RetailReturnsService` | `listRetailReturnsForStaff`, `getRetailReturn`, `transitionRetailReturn` (APPROVED/RECEIVED/INSPECTED/RESTOCKED/REJECTED; no WITHDRAW over HTTP) |
| Refunds / money | `RetailOrdersService` (retail refund mutators) + `PaymentsService.listRetailRefundsForStaff` | `requestRetailRefund`, `approveRetailRefund`, `completeRetailRefund`, `failRetailRefund` (generic engine, journal-first) |
| Reviews | `RatingsService` | `setReviewVisibility` (idempotent, audited); `listReviews` is per-product public — moderation queue seam is new in A7 |
| Customer account | `CustomerAccountService` → `AuthService` (single writer of `account_user`) | `getCustomerProfile` (already redacted); staff retail view seam is new in A8 |
| Inventory | `InventoryService` | KOLBE sellable/on-hand/reserved reads (B3) |
| Analytics | `analytics.contract` presets + query/report services | TODAY/YESTERDAY/LAST_7_DAYS/LAST_30_DAYS/MONTH_TO_DATE/CUSTOM reused verbatim (B2) |
| Shipping / payments (reads) | `ShippingService`, `PaymentsService` | Exception queues read owner state only (B4); no gateway reconciliation is claimed |
| Support | support case services | Return filing opens cases in-transaction (5.9); case reads compose into A8 |
| Promotions / CMS | 5.7 engine, 5.4 CMS | Admin-owned already (`promotion:*`, `cms:*`); no 5.11 duplication |

## 3. Approved requirement mapping

Source: `docs/requirements-retail-admin.md` (employer-approved;
answers immutable, statuses updated factually at D5). Verdicts
reflect **backend** reality, not the storefront panel the
questionnaire statuses describe.

### IMPLEMENTED (no 5.11 work)

- **#10 manual price basis** — prices are stored per offer
  (`seller_offer.retailPrice`, BIGINT); no auto-pricing engine.
- **#17 cancel without reason form** — `POST
  admin/retail/orders/:id/cancel` takes an optional reason.
- **#37 admin-only staff accounts** — `AuthService.register`
  fixes public role to `customer`; any other role requires
  `requesterRole=admin` at the seam.

### PARTIALLY IMPLEMENTED (no 5.11 work unless noted)

- **#5/#6 product approval + scheduling** — CMS revision flow
  (`DRAFT→IN_REVIEW→…→PUBLISHED`) and schedule states exist;
  retail role workflow and editor wiring deferred.
- **#7/#8 catalog/price editing** — owner tables and single-row
  seams exist; admin bulk/excel price ops deferred.
- **#11 per-product minimum** — browser-only thresholds today;
  B3 explicitly defers an authoritative model (dashboard reports
  exact quantities + zero-stock, never fabricated bands).
- **#12 shortage alerts** — in-panel data via B3; message
  wiring deferred; no live SMS/email claimed.
- **#15/#16 order authority** — console routes exist; the
  permission dimension lands in A2/A4. → completed in A.
- **#28 taxonomy** — active-only reads exist (5.10-B); admin
  manage HTTP deferred.
- **#33 segmentation** — CRM tags exist; no segment engine.
- **#35 complaint routing** — manual assign/priority/SLA exist;
  auto subject+priority rules deferred.
- **#36 agent metrics** — `support:report:view` exists; a
  retail agent dashboard deferred.
- **#45 tax rules** — `tax_configuration` exists; retail tax
  computation unchanged, out of scope.
- **#46/#47 shipping cost/zones** — server-side quotes from
  the shared rules (5.8); explicit zone matrix deferred.
- **#48 notification priority** — channels exist; two-level
  priority semantics as implemented in 5.3, unchanged.

### PHASE 5.11 (this tranche)

- **#1 retail dashboard** (B1), **#2 date windows** (B2),
  **#19 suspicious-order flag** (C3), **#20 returns** (A5 gates;
  transitions exist), **#21/#34 refunds gateway/manual**
  (A6 gates; wallet stays deferred — no canonical wallet
  table exists and A6 forbids inventing one), **#29/#30
  review moderation + manual queue** (A7; seller replies
  deferred — no schema), **#31 retail customer view** (A8),
  **#38 permission dimension** (A2; branch dimension
  deferred — no branch domain), **#39 admin 2FA policy**
  (C1/C2), **#40 audit coverage** (inherited at seams,
  proven in D), **#41–#43 defined retail metrics** (B1;
  report-builder deferred), **#44 mismatch queues** (B4;
  live gateway reconciliation deferred — no provider).

### DEFERRED WITH REASON

- **#3/#4/#13/#14/#38-branch branch scope** — no branch
  domain exists anywhere; a role+branch model is a new
  domain, not a 5.11 seam.
- **#9 price history** — no `price_history` table; unlimited
  retention is a ledger-grade feature, out of scope.
- **#18 manual order entry** — checkout is buyer-driven;
  no staff order-entry seam exists (not invented here).
- **#21/#34 wallet** — no wallet ledger exists (only a
  pay-method label); inventing money storage is forbidden.
- **#29 seller replies** — no schema (carried from 5.10).
- **#32 blocking with reason/expiry** — statuses
  (`active/suspended/locked`) + login enforcement exist,
  but no canonical admin block flow; frontend-only today.
- **#49 instant backup** — production infrastructure, not
  application scope.
- **#50 unified panel** — north star; this tranche ships
  the retail control plane toward it.

## 4. Missing operator seams (built by this tranche)

| Checkpoint | Seam | Owner module (new code lives here) |
|---|---|---|
| A7 | `listReviewsForModeration` (cross-product, status filter, keyset) | ratings |
| A8 | `getRetailCustomerForStaff` (safe identity + orders + returns/refunds/support) | customer-account |
| A2/A4–A6 | 18 `retail:*` permission actions + DB CHECK | database (state-values + migration 0044) |
| B1/B3/B4 | Retail dashboard read-model (KPIs, inventory view, exception queues) | admin (read-only composition, control-tower precedent) |
| C2 | High-risk gate (RBAC + TOTP-enrolled) | admin (guard) |
| C3 | Suspicious-flag model (flag/clear/reason/actor/time/audit) | admin (new table, migration 0045) |
| C4 | Retail note targets (`retail_order`, `retail_customer`) | database (CHECK extension, migration 0045) |

## 5. Existing TOTP behavior (C1 audit input)

- `TotpService`: dependency-free RFC 6238 (HMAC-SHA1, 30s,
  6-digit, ±1 window); test seam `generateCode(secret, step)`.
- `accountUser.totpSecret` (nullable) / `totpEnabled` /
  `totpEnrolledAt`. `enrollTotp` returns the secret +
  `otpauthUrl` exactly once; `verifyTotp` flips enabled;
  `disableTotp` requires a live code when enabled.
- Login enforces a code **iff** `totpEnabled` (401
  `TOTP_REQUIRED` / `INVALID_TOTP`); unenrolled accounts log
  in with password alone — so a "high-risk requires
  enrolled" policy cannot lock out bootstrap (C1): the
  bootstrap admin logs in normally, enrolls, then acts.
- Plaintext secret never leaves the enrollment response; no
  ordinary endpoint returns it (pinned by test in C).

## 6. Existing Admin RBAC bootstrap behavior (A2 input)

- `getUserPermissions`: assigned roles → union of granted
  actions; **no assignments + `account_user.role=admin` →
  all `ADMIN_PERMISSION_ACTIONS`** (backward-compatible
  bootstrap); everyone else → empty set.
- Consequence: adding `AdminPermissionGuard` to existing
  routes is green-safe — suite admins are direct-inserted
  `role=admin` rows with no assignments, so they keep full
  power; least-privilege tests assign a granular role and
  assert denial elsewhere.
- `super_admin` is re-granted the full catalog on every
  `ensureSystemRoles` (idempotent); `commercial_ops` and
  `approver` keep their existing grants (retail power is
  granted explicitly, never by role-name inference).

## 7. Frontend admin legacy/local/mock writers (untouched)

5.11 is API-only. The storefront admin keeps its browser-truth
writers; no 5.11 route reads them and no suite depends on them:

`kv_admin_orders`, `kv_admin_customers`, `kv_admin_returns`,
`kv_admin_warehouses`, `kv_admin_articles`,
`kv_admin_wholesale_requests`, `kv_wallet_<phone>`,
`kv_page_*`, `kv_crm_focus_customer`, CRM customer/outbox keys
(`Admin.tsx`, `AdminCRM.tsx`, `AdminOperations.tsx`,
`AdminSupportCenter.tsx`). No `MOCK` markers in Admin pages.

## 8. Target control-plane architecture

```
                    /api/v1/admin/retail/*
  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐
  │Ops (exists,│  │Reviews (new) │  │Customers (new)│  │Dashboard (B) │
  │+granular   │  │queue/hide/   │  │operator view  │  │KPIs/queues/  │
  │gates in A) │  │show          │  │               │  │exceptions    │
  └──────┬──────┘  └──────┬───────┘  └──────┬────────┘  └──────┬───────┘
         │  @Roles("admin") + AdminPermissionGuard + retail:* │
         └──────────────────────┬────────────────────────────┘
                    owner services (RetailOrders / RetailReturns /
                    Payments / Ratings / CustomerAccount / Inventory /
                    Analytics / Shipping / Support) — sole writers
```

- **Controllers are shells**: actor forward, replay→status,
  serialize. Zero SQL writes outside owner services; the two
  C-checkpoint exceptions (suspicious-flag table, note rows)
  are admin-owned tables by design.
- **Reads live with owners** where a seam exists (orders /
  returns / refunds / reviews / customer); the B dashboard
  composes read-only aggregates admin-side (control-tower
  precedent) reusing analytics date semantics.
- **High-risk gate (C2)**: route permission + actor
  `totpEnabled`, enforced by a guard; maker/checker reused
  where it already governs, never re-implemented.
- **Errors**: no new vocabulary — `DomainError` codes cross
  with existing statuses (401 anonymous, 403 role/permission,
  404 missing, 409 conflict, 422 semantic).

## 9. Checkpoint B as-built (dashboard / queues)

- `RetailDashboardService` lives in the **analytics module**
  (not admin): the dashboard reuses the in-module engine, the
  module already imports AdminModule for the guards, and the
  freeze/boundary guards stay green with **zero new module
  edges**. Routes stay on `/api/v1/admin/retail/*`
  (`dashboard`, `inventory`, `exceptions`) — path namespace
  does not dictate module (ratings-on-`catalog/` precedent).
- Sales KPIs are the five canonical `retail.*` metrics via
  `AnalyticsQueryService.run` (scope RETAIL); the B suite
  proves dashboard == direct engine run on the same range
  (T6), so the dashboard adds no math and 5.5 semantics are
  unchanged.
- Operational queues are now-scoped, read-only, drizzle-style
  (control-tower precedent): awaiting-payment (unpaid /
  pending_cod, uncancelled), fulfillment backlog (paid +
  confirmed/packed), shipment backlog (retail-side,
  pre-delivery), returns/refunds by status, flagged reviews,
  KOLBE stock counts, recent-exception sample with full
  bucket counts.
- Inventory isolation predicate is stock-side:
  `seller.type = 'KOLBE'` (supplier-held rows never appear,
  even for KOLBE products). Quantities are exact; the only
  derived bit is zero-stock. The authoritative per-product
  threshold model is **explicitly deferred** (browser-only
  thresholds stand; nothing fabricated).
- Exceptions are real stored states only: payments
  pending/evidence_submitted/failed, shipments
  pending/ready/handed_over/in_transit/failed, with
  provider/method truth and failure reasons. No synthetic
  stalled/reconciliation flags; no gateway states claimed.
- Bad ranges and cursors refuse with
  `ANALYTICS_INVALID_REQUEST` (400, existing vocabulary).
- No migration in B (read-only; tables 198, journal idx 44).

## 10. Checkpoint plan and invariants

- A: this doc, 18-action catalog + migration 0044, granular
  gates on the 23 existing routes, reviews + customers
  controllers, A suites. B: dashboard, dates, inventory,
  exceptions, B suites. C: TOTP policy, high-risk gate,
  suspicious flag + migration 0045, retail note targets,
  C suites. D: D1–D6 per the work order, report extension,
  full verification, two-push closeout.
- Standing invariants: zero file deletions; zero behavioral
  coverage removed (obsolete-by-move assertions re-homed
  stronger and mapped here); count-only pin updates mapped
  here:
  - *(A) journal 44→45 entries / idx 43→44 / tag 0044 in:
    `phase-5-7-promotions-migration`, 5.10 `D10.8`, 5.11
    `D10.7` — 0044 is CHECK-only, tables stay 198.*
  - *(C) head 45→46 entries / idx 44→45 / tag 0045 /
    tables 198→199 (0045 adds `retail_order_suspicious_flag`)
    in: `phase-5-7-promotions-migration`, 5.10 `D10.8`, 5.11
    `D10.7` (snapshot path 0043→0045), 5.11
    `phase-5-11-admin-a-migration` (0044 repointed to a
    positional idx-44 pin), `phase-5-3-templates-preferences`,
    `phase-4-9-1-b-operational`, db `phase-3-8`,
    `phase-5-10-{a,b,c}-migration`, `phase-5-11-c-migration`,
    B-suite T8. Setup-only TOTP enrollments (zero assertion
    changes) in 12 suites: 5.9-C, 5.9-D ×3, 5.11-A/B/C,
    5.11-D failure/concurrency/security, A-suite (adminFull +
    adminOrderCancel), B-suite (adminFull).*

## 11. Checkpoint C as-built (TOTP gate / flags / notes)

- TOTP policy (C1, exact). WHO: any staff actor (role admin/
  finance) driving a high-risk act. WHICH ACTS: refund
  approve/complete/fail over HTTP (unconditional) and paid
  order cancel (conditional on paymentStatus == paid, checked
  in-transaction). FAILURE: 401 `TOTP_REQUIRED` (existing
  auth-domain code), nothing mutates, nothing leaks
  (unknown-perm actors still get 403 first — A:318 is the
  order canary). BOOTSTRAP: login is password-only until
  `totp_enabled`, so enrollment can always start; no lockout
  by construction (C-suite T2). RECOVERY: no self-service
  device-loss flow exists — disable needs a live code and no
  admin-reset route was introduced (new privileged surface);
  recovery today is a manual second-operator DB reset, a
  documented gap, not a new flow. No SMS, no bootstrap
  codes, no plaintext introduced (the phase-2
  `totp_secret` column predates 5.11; its phase-6
  crypto/rotation note in `totp.service.ts` stands).
- Gate mechanics (C2). Two choke points, one source of truth
  (`account_user.totp_enabled`): `AdminTotpGuard` +
  `@RequireTotpEnrolled()` on the three refund routes
  (stateless; service seams stay policy-free so the 5.9
  service-level refund suites run untouched), and an
  in-transaction seam read in `cancelRetailOrder` (stateful:
  paid + staff + unenrolled refuses before the first write;
  race-proof, rollback-clean). Guard order is structural:
  global session → controller perm → method TOTP. Customers
  (own orders), unpaid cancels, `system` (non-interactive,
  unreachable via HTTP claims), and refund FILING
  (non-terminal — money moves only on approve/complete) are
  explicitly ungated. An early flag-passing sketch was
  replaced by seam-side reads: no caller-passed flags, no
  TOCTOU, fail-closed on missing rows.
- Explicitly NOT gated (no seam, no gate): manual inventory
  adjustment (no canonical writer exists — B3 confirmed
  read-only), sensitive customer-account state changes (no
  admin block seam exists). Maker/checker is not required by
  the work order; single-enrolled-actor acts plus the full
  audit trail are the control. All three are D-matrix
  deferreds, not silent gaps.
- Suspicious flags (C3). Admin-owned
  `retail_order_suspicious_flag`, one row per order (unique
  index), reason/actor/timestamp + clear columns, FKs to
  retail_order (restrict) and account_user (restrict). All three
  FKs are RESTRICT per the repo-wide `clean-migration`
  invariant (no CASCADE anywhere); retail orders are
  commercial records and are never deleted, so the flag
  lifecycle needs no cascade.
  Flag = atomic upsert (201 create / 200 re-flag, cleared
  columns nulled); clear = conditional update (idempotent
  success, no-op clears unaudited); get = 200 always.
  Convergent under races (last-writer-wins, winners
  audited). Flag ≠ enforcement: the order row is never
  touched (C-suite T5 `toEqual(before)`). Errors reuse
  existing vocabulary: ghost order → 404
  `RETAIL_ORDER_NOT_FOUND`, bad reason → 422 shared
  `VALIDATION_FAILED` (seam-level: vitest/esbuild emits no
  decorator metadata, so DTO validation cannot fire in
  tests — the console convention of seam-owned validation
  keeps the envelope uniform in every environment).
  Audits follow the dotted convention
  (`retail_order.suspicious_flagged/cleared`). No flags queue
  route was built (C3 lists flag/clear/audit only; queue =
  D-matrix deferred).
- Notes (C4). `ADMIN_NOTE_TARGET_TYPES` + CHECK gain
  `retail_order` + `retail_customer`; zero service or
  controller changes (the DB CHECK is the only gate; the
  seam takes any cataloged target). Existing
  `wholesale:notes:*` permissions gate retail notes
  (documented: notes are one cross-domain staff tool; no
  new permission actions).
- Migration 0045 (table + note CHECK) verified on scratch:
  46 migrations / 199 tables / 461 FKs / 589 CHECKs, plus
  live proofs (duplicate flag 23505, empty reason 23514,
  ghost order 23503, retail targets admitted, bogus target
  23514). Snapshot id chained (prevId = 0044 id); registry +
  module-boundaries table list extended (drizzle reads need
  no exceptions; scanner covers raw SQL only).
- C suites: `phase-5-11-admin-c-migration` (3: head/counts,
  flag constraints, note targets) and
  `phase-5-11-admin-c-security` (10: T1 block→ceremony→
  unlock over real HTTP, T2 bootstrap login semantics, T3
  TOTP-free paths, T4 perm-first + non-admin, T5 flag
  lifecycle without mutation, T6 misuse + idempotent clear,
  T7 flag/clear race, T8 notes perms, T9 high-risk + flag
  audits, T10 secret hygiene). 12 existing suites adapted
  setup-only (TOTP enrollments; helpers and call sites
  untouched — the seam reads the DB); the only assertion
  edit is B-suite T8's 198→199 count pin.
