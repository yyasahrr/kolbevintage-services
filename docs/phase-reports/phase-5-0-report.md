# Phase 5.0 — Business Management & Admin Control Plane Foundation — Report

**Branch:** `arena/01a0bac3-kolbevintage-services` (strictly working branch; no `main` interaction, no history rewrite, no force push, no PR)
**Starting SHA:** `e826d5419db4bcbbf7fa8fe09cfbb1d4c6d76543` (docs: finalize phase 4.9.1 CI record — CI run **35510550057 SUCCESS**)
**Baseline re-verified locally before any change:** 24 migrations / 100 tables / 231 FKs / 325 CHECKs; `npm run test:all` = shared 23 / database 84 / api 680 / next 125 = **912 passed, 0 skipped, 0 failed**
**Ending SHA (code):** `2eca603` (feat(phase-5-0-d): add wholesale admin control tower read models)
**Date:** 2026-09-20
**Database Status:** 25 migrations / 113 tables / 253 FKs / 348 CHECK constraints (zero runtime DDL; migrations 0001–0023 untouched; forward-only migration `0024_phase_5_business_control_plane.sql`)
**Location:** Falkenstein, Saxony, DE — no Iranian payment provider, carrier, tax-authority, or payout provider credential exists in this repository; no real external banking or payment call was made or claimed.

> **Phase 5.1 CRM & Customer Operations Backend has NOT started.** Phase 5.0 establishes the foundation for business management and admin control plane operations without mutating or compromising the single-writer domain boundaries of Catalog, Suppliers, Orders, Inventory, Fulfillment, Payments, Shipping, Settlement, and Audit.

---

## Exact Phase 5.0 Truth Table

| Subsystem / Capability | Checkpoint | Status | Authoritative Storage / Architecture | Evidence / Invariant |
|---|---|---|---|---|
| Domain Audit & Architecture Doc | A | VERIFIED | `docs/architecture/phase-5-business-control-plane.md` | Formal architecture specification; zero god-service; strict single-writer rules. |
| Versioned Wholesale Plan Identity | A | VERIFIED | `wholesale_plan` | Immutable plan code, display name, tier level, status, sort order. |
| Immutable Plan Versions | A | VERIFIED | `wholesale_plan_version` | Separate plan identity from versions; versioning prevents mutating historical terms. |
| Plan Feature Matrix | A | VERIFIED | `wholesale_plan_feature` | Stable feature keys (`catalog.vip_pricing`, `order.rfq_access`), typed flags/JSON. |
| Plan Commercial Limits | A | VERIFIED | `wholesale_plan_limit` | BIGINT IRR money amounts (`min_order_amount`, `max_order_amount`), unit caps, branch limits. |
| Database Safety & Migration | A | VERIFIED | Migration `0024`, Drizzle schema snapshot | 13 new tables (total 113), 22 new FKs (total 253), 23 new CHECKs (total 348), zero float money. |
| Plan-to-Account Connection | B | VERIFIED | `wholesale_account` + `wholesale_membership` | Accounts link to published versions; draft versions rejected. |
| Membership Lifecycle Engine | B | VERIFIED | `wholesale_membership`, `wholesale_membership_history` | Explicit states: `pending`, `active`, `suspended`, `cancelled`, `expired`. |
| Version Freeze Snapshots | B | VERIFIED | `snapshot_features`, `snapshot_limits` | Membership activation freezes plan features and limits permanently against future plan edits. |
| Membership Commands | B | VERIFIED | `WholesaleMembershipService` | `activate`, `renew`, `schedulePlanChange`, `upgrade`, `downgrade`, `suspend`, `resume`, `cancel`, `expire`. |
| Entitlement Resolver | B | VERIFIED | `EntitlementResolver` | Server-side enforcement of `hasFeature`, `getLimit`, and `assertCanPlaceOrder` order boundary caps. |
| Granular Admin RBAC | C | VERIFIED | `admin_role`, `admin_user_role`, `admin_role_permission` | Layered on top of `@Roles("admin")`; system roles (`super_admin`, `commercial_ops`, `approver`). |
| Maker/Checker Approval Engine | C | VERIFIED | `approval_request`, `AdminApprovalsService` | Two-person rule enforced (`checker_id !== maker_id`); deterministic command dispatch. |
| Business Settings Registry | C | VERIFIED | `business_setting`, `business_setting_history` | Typed, validated (`string`, `number`, `boolean`, `json`, `money_irr`), versioned, secret-masked. |
| Internal Admin Notes | C | VERIFIED | `admin_internal_note`, `InternalNotesService` | Pinned notes, audit trails, and actor attribution across accounts, orders, suppliers, requests. |
| Wholesale Control Tower | D | VERIFIED | `ControlTowerService`, `ControlTowerController` | Authoritative aggregated counts; no synthetic/fabricated numbers; live SQL aggregation. |
| Operational Queues & Search | D | VERIFIED | FIFO Queues, Audit Feed, Directory Search | Oldest-first pending approvals, pending accounts review, expiring memberships watch, SQLi safety. |
| Admin HTTP API Security | B, C, D | VERIFIED | NestJS Guards (`SessionGuard`, `AdminPermissionGuard`) | 401 unauthenticated, 403 non-admin, 403 unauthorized permission, clean BigInt serialization. |

---

## Commits & Remote CI Verification (all on `arena/01a0bac3-kolbevintage-services`)

| Stage | SHA | Message | CI run | Conclusion |
|---|---|---|---|---|
| Baseline | `e826d54` | `docs: finalize phase 4.9.1 CI record` | 35510550057 | success |
| Checkpoint A | `db70ae1` | `feat(phase-5-0-a): add versioned wholesale business control plane` | 35514656632 | failure (AuditEntry requires actorRole) |
| Checkpoint A (Fix) | `eeef7f3` | `fix(phase-5-0-a): supply actorRole for audit log in wholesale plan service` | 35514770720 | success |
| Checkpoint B | `95ee14a` | `feat(phase-5-0-b): add wholesale plan and membership lifecycle` | 35515100174 | success |
| Checkpoint C | `37dff2c` | `feat(phase-5-0-c): add admin permissions approvals and business settings` | 35515533140 | success |
| Checkpoint D | `2eca603` | `feat(phase-5-0-d): add wholesale admin control tower read models` | 35516443186 | success |

---

## Test Totals (local & remote CI, PostgreSQL 55432, `NODE_ENV=test`)

| Workspace | Files | Passed | Skipped | Failed | Baseline (4.9.1) |
|---|---|---|---|---|---|
| `@kolbe/shared` | 2 | 23 | 0 | 0 | 23 |
| `@kolbe/database` | 10 | 84 | 0 | 0 | 84 |
| `@kolbe/api` | 55 | 723 | 0 | 0 | 680 |
| `kolbe-next` | 13 | 125 | 0 | 0 | 125 |
| **Total** | **80** | **955** | **0** | **0** | **912** |

Net change: **+4 test suites, +43 tests**, 100% passing across local runs and remote GitHub Actions CI pipelines with real database constraints and zero skipped tests.

### New Test Suites in Phase 5.0

| File | Tests | Covers |
|---|---|---|
| `apps/api/test/phase-5-0-business-control-plane.test.ts` | 12 | Checkpoint A: Plan identity creation, versioning immutability, feature matrices with stable keys, commercial limit definitions, publishing draft versions, superseding active versions, database check constraints, and BigInt IRR integrity. |
| `apps/api/test/phase-5-0-membership.test.ts` | 12 | Checkpoint B: Connecting wholesale accounts to published plans, snapshot freezing upon activation, freeze immutability across subsequent plan version changes, full lifecycle state machine (`suspend`, `resume`, `renew`, `schedule-change`, `upgrade`, `downgrade`, `cancel`, `expire-sweep`), entitlement resolver enforcement (`hasFeature`, `getLimit`, `assertCanPlaceOrder`), and admin membership APIs. |
| `apps/api/test/phase-5-0-admin-permissions.test.ts` | 10 | Checkpoint C: Granular admin operational permissions and system roles (`super_admin`, `commercial_ops`, `approver`), mandatory Two-Person Rule enforcement (`TwoPersonRuleViolationError`), deterministic command dispatch, business settings validation/versioning/masking/read-only locks, internal admin notes with pinning, and RBAC guard rejection. |
| `apps/api/test/phase-5-0-control-tower.test.ts` | 9 | Checkpoint D: Authoritative control tower metrics aggregated directly from live database tables (zero fabricated metrics), FIFO pending approvals queue, searchable pending accounts queue, expiring memberships queue with threshold days, real audit log activity feed, directory search, adversarial SQL injection resistance, and bounded limit clamping. |

---

## Checkpoint A — Business Control Plane Schema & Ownership

### A1: Domain Audit & Architectural Specification
- **Specification**: Documented in `docs/architecture/phase-5-business-control-plane.md`.
- **Architectural Rules**:
  - Rule 1: No second writer to domain-owned tables (Orders, Catalog, Suppliers, Inventory, Fulfillment, Payments, Shipping, Settlement, Audit).
  - Rule 2: Explicit separation of plan identity and immutable plan versions.
  - Rule 3: Historical membership immutability through frozen snapshots (`snapshotFeatures`, `snapshotLimits`).
  - Rule 4: Stable feature keys and typed entitlement representations.
  - Rule 5: No raw float money; all monetary thresholds stored as `BIGINT` IRR integers.
  - Rule 6: Two-person rule on high-risk admin actions (`checkerId !== makerId`).
  - Rule 7: Authoritative control tower metrics derived exclusively from live database tables.

### A2: Versioned Wholesale Plan Model
- **Plan Identity** (`wholesale_plan`): Stable code, tier level, name, description, status (`active`, `archived`).
- **Plan Versions** (`wholesale_plan_version`): Version number, base fee (BIGINT), deposit requirement (BIGINT), duration in days, billing period, status (`draft`, `published`, `superseded`, `archived`). Editing a live plan creates a new draft version; historical terms remain unaffected.
- **Feature Matrix** (`wholesale_plan_feature`): Keyed entitlements (`catalog.vip_pricing`, `order.rfq_access`, `shipping.free_standard`, `support.dedicated_rep`, `settlement.cheque_allowed`) with boolean and JSON representations.
- **Commercial Limits** (`wholesale_plan_limit`): Keyed boundaries (`min_order_amount`, `max_order_amount`, `max_order_units`, `max_branches`, `max_team_members`, `max_monthly_rfqs`) with period enforcement (`order`, `monthly`, `annual`).

### A3: Database Safety & Migration
- **Migration**: Forward-only migration `packages/database/migrations/0024_phase_5_business_control_plane.sql`.
- **Database Totals**: 25 migrations, 113 tables, 253 foreign keys (all `ON DELETE RESTRICT`), 348 CHECK constraints.
- **Untouched Baseline**: Migrations 0001–0023 untouched; existing table structures preserved.

---

## Checkpoint B — VIP Membership Lifecycle & Entitlement Engine

### B1: Connecting Plans to Wholesale Accounts
- **Account Association**: Wholesale accounts link to published plan versions. Linking unpublished draft versions is rejected with `PLAN_VERSION_NOT_PUBLISHED`.
- **Dual Compatibility**: Maintains backward compatibility with existing `wholesale_account` table by synchronizing `status`, `plan_name`, `activated_at`, and `expires_at` without mutating foreign schema ownership.

### B2: Membership Lifecycle States & Historical Freeze Snapshots
- **Explicit Lifecycle**: States include `pending`, `active`, `suspended`, `cancelled`, and `expired`.
- **Immutable Snapshot Freezing**: Upon membership activation, the active plan version's features and limits are frozen into JSONB snapshots (`snapshotFeatures`, `snapshotLimits`). Subsequent modifications or publications of newer plan versions do not alter the active member's frozen entitlements.
- **Audit Logging**: Every state transition records an entry in `wholesale_membership_history` and `audit_log`.

### B3: Lifecycle Commands
- `activateMembership`: Transitions `pending` -> `active`, freezes snapshots, synchronizes account.
- `renewMembership`: Extends `expiresAt` by specified duration days; applies any pending scheduled plan changes.
- `schedulePlanChange`: Queues a target plan version to be applied seamlessly at the next renewal cycle.
- `upgradeMembership` / `downgradeMembership`: Executes immediate transition to target plan version and refreezes snapshots.
- `suspendMembership` / `resumeMembership`: Safely pauses and resumes membership privileges with recorded operational reasons.
- `cancelMembership`: Terminates active membership upon buyer request or compliance decree.
- `expireMembershipsSweep`: Automated sweep querying past-due active memberships and transitioning them to `expired`.

### B4: Server-Side Entitlement Resolver
- `hasFeature(accountId, featureKey)`: Evaluates boolean and typed features from active frozen snapshots.
- `getLimit(accountId, limitKey)`: Retrieves commercial limit values (BIGINT IRR / unit counts).
- `assertCanPlaceOrder(accountId, orderTotal, totalUnits)`: Enforces `min_order_amount`, `max_order_amount`, and `max_order_units` before order placement, failing closed with `WholesaleOrderLimitViolationError` on breach.

---

## Checkpoint C — Admin RBAC, Maker/Checker Approvals & Business Settings

### C1: Granular Admin Operational Permissions & Roles
- **Granular Actions**: `wholesale:plan:view`, `wholesale:plan:manage`, `wholesale:membership:view`, `wholesale:membership:manage`, `wholesale:membership:override`, `wholesale:approval:view`, `wholesale:approval:create`, `wholesale:approval:decide`, `wholesale:settings:view`, `wholesale:settings:manage`, `wholesale:notes:view`, `wholesale:notes:create`, `wholesale:control_tower:view`.
- **Pre-seeded System Roles**: `super_admin` (full permissions), `commercial_ops` (plans, memberships, requests, notes), `approver` (decide approvals).
- **Admin RBAC Guard**: `AdminPermissionGuard` layered on top of `@Roles("admin")` enforcing granular `@RequireAdminPermission("...")`.

### C2: Constrained Maker/Checker Approval Workflow
- **Two-Person Rule**: Strictly enforced via database check constraint `maker_checker_distinct` (`checker_id IS NULL OR checker_id <> maker_id`) and application service validation. A maker attempting to approve or decide their own request throws `TwoPersonRuleViolationError`.
- **Deterministic Command Dispatch**: No arbitrary eval or JSON injection. Dispatches strictly registered actions: `PLAN_VERSION_PUBLISH`, `MEMBERSHIP_MANUAL_ACTIVATE`, `MEMBERSHIP_PLAN_CHANGE`, `MEMBERSHIP_TERMINATE`, and `BUSINESS_SETTING_CHANGE`.
- **Safe Execution Failure**: Catches and records command failure details in `execution_result` with status `failed` without crashing background workers.

### C3: Business Settings Registry
- **Typed & Validated**: Validates inputs against `string`, `number`, `boolean`, `json`, and `money_irr` types. Negative numbers or invalid formats throw `BusinessSettingValidationError`.
- **Versioning & History**: Every modification increments version and records an immutable before/after snapshot in `business_setting_history`.
- **Read-Only & Secrets**: Read-only settings reject updates with `BusinessSettingReadOnlyError`. Secret settings are masked (`********`) by default across query endpoints.

### C4: Internal Admin Notes
- **Entities**: Supports `wholesale_account`, `wholesale_membership`, `wholesale_order`, `wholesale_request`, `supplier`.
- **Features**: Pinned notes prioritized at top of list, soft archiving, author attribution, and audit logging.

---

## Checkpoint D — Wholesale Admin Control Tower Read Models

### D1: Authoritative Real-Time Metrics
- **Strict Data Truth**: Zero synthetic, mock, or fabricated counts. All metrics are aggregated directly via SQL queries against authoritative database tables.
- **Overview Metrics**:
  - Accounts breakdown by status (`pending`, `approved`, `rejected`, `suspended`, `expired`, `total`).
  - Memberships breakdown by status (`pending`, `active`, `suspended`, `cancelled`, `expired`, `total`).
  - Approvals breakdown by status (`pending`, `approved`, `rejected`, `executed`, `failed`, `cancelled`, `total`).
  - Plan counts (`published`, `total`).
  - Open wholesale requests count.
  - Expiring memberships watch count (expiring within next 14 days).

### D2: Operational Queues
- **Pending Approvals Queue**: Returns pending approval requests requiring checker decision, ordered oldest first (FIFO).
- **Pending Accounts Queue**: Returns wholesale accounts awaiting review with keyword search support.
- **Expiring Memberships Queue**: Returns active memberships nearing expiration within configurable threshold days.
- **Activity Feed**: Real admin operational audit trail filtered to control plane entity types.
- **Directory Search**: Search across member names, store names, phones, and account IDs with status filtering.

### D3: Admin API Security & Adversarial Defense
- **RBAC Enforcement**: All control tower endpoints protected by `@Roles("admin")` and `@RequireAdminPermission("wholesale:control_tower:view")`.
- **IDOR & SQLi Defense**: Query parameters parameterized through Drizzle ORM; malicious SQL injections (e.g. `'; DROP TABLE...`) sanitized safely.
- **Denial-of-Service Defense**: Pagination limits bounded and clamped (maximum 100 items per request).
- **BigInt Serialization**: All monetary and big numeric values cleanly serialized to strings via `toApiJson`.

---

## Architectural Invariants Verified

1. **No Microservices (A1)**: Monolithic NestJS application in `apps/api` with structured modules.
2. **Module Ownership (A2/A3)**: Verified by `test/module-boundaries.test.ts` (8/8 passed). `vip` owns wholesale plans and memberships; `admin` owns roles, permissions, approvals, settings, and notes. No cross-module direct table writes.
3. **Database Integrity**: 25 migrations, 113 tables, 253 foreign keys, 348 check constraints. Zero raw float money.
4. **Historical Immutability**: Modifying plan terms or publishing new plan versions leaves active membership snapshot features and limits completely intact.
5. **Two-Person Rule**: High-risk approval requests cannot be approved by their maker under any circumstances.
6. **No Fabricated Control Tower Metrics**: Every metric returned by the control tower is derived from live database table rows.

Phase 5.1 CRM & Customer Operations Backend has NOT started.
