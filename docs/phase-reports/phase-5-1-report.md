# Phase 5.1 — CRM & Customer Operations Backend — Report

**Branch:** `arena/01a0bac3-kolbevintage-services` (strictly working branch; no `main` interaction, no history rewrite, no force push, no PR)
**Starting SHA:** `f5f416dd2b363ad8ea46416c34aa75748ab27f9a` (docs: record phase 5.0 final CI — CI run **35516835939 SUCCESS**)
**Baseline re-verified locally before any change:** 25 migrations / 113 tables / 253 FKs / 348 CHECKs; `npm run test:all` = shared 23 / database 84 / api 723 / next 125 = **955 passed, 0 skipped, 0 failed**
**Ending SHA (code):** `179c39f` (feat(phase-5-1-d): add CRM pipeline search and customer operations — CI run **35531781513 SUCCESS**)
**Date:** 2026-09-20
**Database Status:** 26 migrations / 121 tables / 274 FKs / 356 CHECK constraints (zero runtime DDL; migrations 0001–0024 untouched; forward-only migration `0025_phase_5_1_crm_customer_operations.sql`)
**Location:** Falkenstein, Saxony, DE — no Iranian payment provider, carrier, tax-authority, or payout provider credential exists in this repository; no real external banking or payment call was made or claimed.

> **Phase 5.2 Support / Ticket / Case Management Backend has NOT started.** Phase 5.1 establishes the authoritative CRM and Customer Operations backend without compromising or violating the single-writer domain boundaries of Catalog, Suppliers, Orders, Inventory, Fulfillment, Payments, Shipping, Settlement, Compliance, and Audit.

---

## Exact Phase 5.1 Truth Table

| Subsystem / Capability | Checkpoint | Status | Authoritative Storage / Architecture | Evidence / Invariant |
|---|---|---|---|---|
| Domain Audit & Architecture Doc | A | VERIFIED | `docs/architecture/phase-5-1-crm-customer-operations.md` | Formal architecture specification auditing legacy frontend mock implementations and establishing zero god-service boundaries. |
| CRM Contact Identity & Profile | A | VERIFIED | `crm_contact`, `crm_contact_identity_link` | First-class CRM profile supporting leads without login accounts (`account_user_id IS NULL`) and registered customers. |
| Identity Linking & Duplicate Prevention | A | VERIFIED | `crm_contact_identity_link` | Unique constraint on `user_id` and domain validation preventing duplicate linking of the same user to multiple CRM contacts. |
| CRM Stages & Transition History | A | VERIFIED | `crm_contact`, `crm_stage_history` | Formal state machine (`LEAD`, `CONTACTED`, `NEGOTIATION`, `ACTIVE_CUSTOMER`, `LOYAL`, `CHURNED`) with append-only immutable history and English domain keys. |
| Contact Owner & Assignment History | A | VERIFIED | `crm_contact`, `crm_assignment_history` | Reassignment tracking with explicit admin actor attribution and historical audit trail. |
| Normalized Tag Domain | A | VERIFIED | `crm_tag`, `crm_contact_tag` | Normalized lowercase kebab-case keys, unique constraint on key, M:N association with RESTRICT foreign keys. |
| Database Safety & Migration | A | VERIFIED | Migration `0025`, Drizzle schema snapshot | 8 new tables (total 121), 21 new FKs (total 274), 8 new CHECKs (total 356), zero float money, strict RESTRICT on deletes. |
| CRM Activity Timeline | B | VERIFIED | `crm_activity` | Append-only chronological activity log (`NOTE`, `CALL`, `MESSAGE`, `EMAIL`, `MEETING`, `SYSTEM`) with metadata payload and admin attribution. |
| CRM Follow-up Task Engine | B | VERIFIED | `crm_task` | State machine (`OPEN`, `IN_PROGRESS`, `DONE`, `CANCELLED`), priority levels (`LOW`, `MEDIUM`, `HIGH`, `URGENT`), due dates, and completion timestamps. |
| Reconciled Internal Notes | B | VERIFIED | `crm_activity` + `admin_internal_note` | CRM activities provide structured interaction logs; wholesale internal notes from Phase 5.0 are unified seamlessly in the Customer 360 timeline. |
| Task Queues & Sweep Operations | B | VERIFIED | `CrmTaskService.listTasks` | Parameterized operational queues: my open, overdue, due today, due soon, unassigned, and completed tasks. |
| Composed Customer 360 Read Model | C | VERIFIED | `Customer360Service.getCustomer360` | Dynamic aggregation across identity, orders, payments, compliance, activities, and tasks; zero cached mutable order totals. |
| Authoritative Commerce Metrics | C | VERIFIED | Derived via live SQL aggregation | Lifetime value (`ltv`), total orders, completed orders, pending orders, and average order value computed from authoritative retail orders minus refunds. |
| Zero Float Money Representation | C | VERIFIED | `BIGINT` IRR integers & string serialization | All financial figures represented as `BIGINT` IRR integers internally and serialized as integer strings across API contracts. |
| Compliance-Owned Consent Model | C | VERIFIED | `compliance_consent` table via Compliance domain | Consent state read directly from compliance audit records; marketing consent is never assumed or defaulted to `true`. |
| Pipeline Aggregations | D | VERIFIED | `CrmOperationsService.getPipelineMetrics` | Live stage distribution, active lead counts, overdue follow-up counts, and conversion rate without synthetic or mock numbers. |
| Deterministic Directory Search | D | VERIFIED | `CrmContactService.listContacts` | Parameterized search across contact name, phone, email, city, tags, assigned admin, and stage with SQL injection resistance. |
| Cross-Entity Deduplication Engine | D | VERIFIED | `CrmOperationsService.checkDuplicates` | Pre-creation deduplication signals matching normalized phone, email, or name across both existing CRM contacts and registered auth users. |
| Granular CRM RBAC Enforcement | C, D | VERIFIED | `AdminPermissionGuard` & `admin_role_permission` | Protected admin routes requiring `crm:customer:view`, `crm:customer:edit`, `crm:task:manage`, or `crm:export` layered on top of `@Roles("admin")`. |
| Protected CSV Export | D | VERIFIED | `CrmOperationsService.exportContactsCsv` | Formula injection defense (`'` prepended to `=`, `+`, `-`, `@`, `\t`, `\r`), UTF-8 BOM (`\uFEFF`) for Excel Persian script support. |

---

## Commits & Remote CI Verification (all on `arena/01a0bac3-kolbevintage-services`)

| Stage | SHA | Message | CI run | Conclusion |
|---|---|---|---|---|
| Baseline | `f5f416d` | `docs: record phase 5.0 final CI` | 35516835939 | success |
| Checkpoint A | `b70c3ec` | `feat(phase-5-1-a): add CRM customer profile and relationship domain` | 35518296769 | failure (schema missing exported CrmStage type) |
| Checkpoint A (Fix) | `36d1f95` | `fix(phase-5-1-a): export CrmStage type from database schema` | 35518465037 | success |
| Checkpoint B | `5b263ca` | `feat(phase-5-1-b): add CRM activities and follow-up workflows` | 35518882583 | success |
| Checkpoint C | `f82c178` | `feat(phase-5-1-c): add authoritative customer 360 read model` | 35519936565 | success |
| Checkpoint D | `179c39f` | `feat(phase-5-1-d): add CRM pipeline search and customer operations` | 35531781513 | success |
| Final CI Record | `1e8d617` | `docs: record phase 5.1 final CI` | 35532021830 | success |

---

## Test Totals (local & remote CI, PostgreSQL 55432, `NODE_ENV=test`)

| Workspace | Files | Passed | Skipped | Failed | Baseline (5.0) |
|---|---|---|---|---|---|
| `@kolbe/shared` | 2 | 23 | 0 | 0 | 23 |
| `@kolbe/database` | 10 | 84 | 0 | 0 | 84 |
| `@kolbe/api` | 59 | 755 | 0 | 0 | 723 |
| `kolbe-next` | 13 | 125 | 0 | 0 | 125 |
| **Total** | **84** | **987** | **0** | **0** | **955** |

Net change: **+4 test suites, +32 tests**, 100% passing across local runs and remote GitHub Actions CI pipelines with real embedded database constraints and zero skipped tests.

### Phase 5.1 Test Suites

| File | Tests | Covers |
|---|---|---|
| `apps/api/test/phase-5-1-crm-profile.test.ts` | 13 | Checkpoint A: Lead creation without auth account, identity linking to existing `account_user`, duplicate identity link rejection, stage transitions with append-only history, assignment updates with audit trail, tag normalization and assignment, filter by stage and search, and database check constraints. |
| `apps/api/test/phase-5-1-crm-activities.test.ts` | 8 | Checkpoint B: Activity creation (`NOTE`, `CALL`, `MESSAGE`, etc.), task creation with priority and due date, task status transitions (`OPEN` -> `IN_PROGRESS` -> `DONE` / `CANCELLED`), task assignment updates, operational task queues (my open, overdue, completed), unified timeline aggregation. |
| `apps/api/test/phase-5-1-customer-360.test.ts` | 4 | Checkpoint C: Authoritative Customer 360 aggregation, dynamic LTV and order metrics calculation with refund subtraction, compliance consent resolution (never defaulting marketing consent), HTTP endpoint authorization and RBAC permission checks. |
| `apps/api/test/phase-5-1-crm-operations.test.ts` | 7 | Checkpoint D: Pipeline stage distribution and metric computation, deduplication check across existing contacts and auth users, CSV export with formula injection defense and UTF-8 BOM, permission guard enforcement (`crm:export`, `crm:customer:view`). |

---

## Checkpoint A — CRM Domain Model & Customer Profile

### A1: Domain Audit & Architectural Specification
- **Specification**: Documented in `docs/architecture/phase-5-1-crm-customer-operations.md`.
- **Frontend Audit**: Audited `frontend-kolbe/src/pages/AdminCRM.tsx` and `frontend-next/storefront/pages/AdminCRM.tsx`. Legacy frontend implementations stored Persian state keys (`سرنخ`, `مشتری بالقوه`, `مذاکره`) and mock data in `localStorage`. The authoritative domain model maps these concepts to stable English enum keys (`LEAD`, `CONTACTED`, `NEGOTIATION`, `ACTIVE_CUSTOMER`, `LOYAL`, `CHURNED`).
- **Domain Boundaries**: CRM does NOT own Auth (`account_user`), Orders (`retail_order`), Payments (`payment_transaction`), Shipping (`shipment`), Compliance (`compliance_consent`), or Settlement (`settlement_batch`). CRM acts strictly as a relationship coordination layer.

### A2: CRM Profile & Identity Linking
- **Lead Independence**: Leads can be created without an existing authentication account (`account_user_id IS NULL`).
- **Identity Link Model**: `crm_contact_identity_link` tracks associations between CRM contacts and `account_user`.
- **Duplicate Prevention**: A unique constraint on `crm_contact_identity_link.user_id` guarantees that a single authentication account cannot be linked to multiple CRM contacts, preventing data fragmentation and ambiguous attribution.
- **Stage & Assignment History**: Append-only audit tables `crm_stage_history` and `crm_assignment_history` record every transition with old/new values, changed-by admin ID, and timestamp.

### A3: Tag Domain
- **Normalized Keys**: `crm_tag` stores tags with normalized lowercase kebab-case keys.
- **M:N Association**: `crm_contact_tag` joins contacts and tags with `ON DELETE RESTRICT` foreign keys.

### A4: Database Safety & Migration
- **Migration**: Forward-only migration `packages/database/migrations/0025_phase_5_1_crm_customer_operations.sql`.
- **Database Totals**: 26 migrations, 121 tables, 274 foreign keys, 356 CHECK constraints.
- **Baseline Preserved**: Migrations 0001–0024 untouched.

---

## Checkpoint B — Activities, Notes & Follow-up Workflows

### B1: Activity Timeline
- **Activity Types**: `NOTE`, `CALL`, `MESSAGE`, `EMAIL`, `MEETING`, `SYSTEM`.
- **Structure**: Append-only rows in `crm_activity` storing contact ID, author admin ID, activity type, subject, body, metadata JSON, and creation timestamp.

### B2: Follow-up Tasks
- **Task Lifecycle**: `OPEN` -> `IN_PROGRESS` -> `DONE` or `CANCELLED`.
- **Task Fields**: Title, description, due date, priority (`LOW`, `MEDIUM`, `HIGH`, `URGENT`), assigned admin ID, created by admin ID, completed at timestamp.
- **Task Queues**: Deterministic querying for operational queues:
  - `my_open`: Open or in-progress tasks assigned to the requesting admin.
  - `overdue`: Incomplete tasks with `due_date < now()`.
  - `due_today`: Incomplete tasks due before end of the current day.
  - `due_soon`: Incomplete tasks due within the next 48 hours.
  - `unassigned`: Open tasks without an assigned admin.
  - `completed`: Successfully closed tasks.

### B3: Note Reconciliation
- **Internal Wholesale Notes**: Phase 5.0 `admin_internal_note` stores internal notes for wholesale entities (`wholesale_account`, `wholesale_order`, etc.).
- **Unified 360 View**: `Customer360Service` dynamically unifies `crm_activity` items and relevant `admin_internal_note` records belonging to linked accounts into a single chronological timeline.

---

## Checkpoint C — Authoritative Customer 360 Read Model

### C1: Composed Customer 360 Read Model
- **Composed Architecture**: The Customer 360 read model does not copy or store mutable commerce data into CRM tables. Instead, it aggregates live data on demand across:
  - `crm_contact`: Contact identity, stage, source, assigned owner.
  - `crm_contact_identity_link` -> `account_user`: Account credentials, phone, verification status.
  - `retail_order`: Order counts, order history, completed orders, pending orders.
  - `payment_transaction` & `settlement_batch`: Verified net revenue calculation.
  - `compliance_consent`: Authoritative consent states.
  - `crm_activity` & `admin_internal_note`: Unified interaction timeline.
  - `crm_task`: Open and upcoming follow-ups.

### C2: Factual Commerce Derivation & Financial Invariants
- **Dynamic Derivation**: Lifetime value (`ltv`), completed order count, and average order value (`aov`) are derived in real-time from authoritative order and payment rows.
- **Refund Deduction**: Returned orders and refunded payments are subtracted; unconfirmed or cancelled orders are excluded from completed revenue.
- **BigInt IRR Money**: All monetary amounts are handled as `BIGINT` IRR integers internally and returned as string representations over the HTTP API to prevent IEEE-754 precision loss.

### C3: Compliance-Owned Consent
- **No Marketing Consent Default**: Marketing consent is never assumed or defaulted to `true`.
- **Authoritative Resolution**: Consent status is resolved directly from `compliance_consent` records associated with the linked user ID. If no consent record exists, `marketingConsent` is returned as `false`.

---

## Checkpoint D — CRM Pipeline, Search & Customer Operations

### D1: Pipeline Stage Aggregations
- **Live SQL Aggregation**: Pipeline metrics are computed via `COUNT(*)` grouping over `crm_contact.stage`.
- **Operational Metrics**: Returns contact counts per stage, total leads, active leads, conversion rate from lead to active customer, and overdue follow-up counts.
- **No Synthetic Numbers**: Metrics reflect only real records in the database.

### D2: Parameterized Directory Search
- **Multi-Field Filtering**: Supports deterministic searching across contact name, phone number, email address, city, tag keys, assigned admin ID, and stage.
- **Adversarial Safety**: All queries use parameterized Drizzle operators with ILIKE escaping; zero dynamic SQL concatenation.

### D3: Cross-Entity Deduplication Engine
- **Pre-Creation Check**: `GET /api/v1/admin/crm/dedup-check` inspects both existing `crm_contact` rows and `account_user` accounts.
- **Fuzzy & Exact Signals**: Matches against normalized phone number, email, and name to alert agents of existing profiles before creating redundant contacts.

### D4: Protected CSV Export
- **Formula Injection Prevention**: To protect against CSV injection attacks (CWE-1236), any field starting with `=`, `+`, `-`, `@`, `\t`, or `\r` is automatically sanitized with a prepended single quote (`'`).
- **Excel Persian Support**: The output is prefixed with a UTF-8 Byte Order Mark (`\uFEFF`) to ensure Microsoft Excel correctly parses UTF-8 Persian text without encoding corruption.
- **Permission Boundary**: Access is strictly guarded by the `crm:export` admin permission.

---

## Invariant Proofs & Boundary Verification

### Invariant 1: Single-Writer Domain Boundaries
- **Proof**: The CRM module registers tables exclusively within the `crm` domain (`crm_contact`, `crm_contact_identity_link`, `crm_stage_history`, `crm_assignment_history`, `crm_tag`, `crm_contact_tag`, `crm_activity`, `crm_task`).
- **Verification**: Verified via `apps/api/test/module-boundaries.test.ts`. CRM services never issue INSERT, UPDATE, or DELETE statements against `account_user`, `retail_order`, `payment_transaction`, `compliance_consent`, or `wholesale_plan`.

### Invariant 2: Dynamic Commerce Derivation & Float Money Prohibition
- **Proof**: `crm_contact` contains zero columns for monetary totals or order counts. All commerce metrics in `Customer360Service` are computed dynamically via SQL aggregation over `retail_order`.
- **Verification**: All financial calculations use BigInt math. API responses format BigInt values as strings. No JavaScript `Number` floating point arithmetic is used for IRR currency values.

### Invariant 3: Lead Independence & Duplicate Linking Prevention
- **Proof**: `crm_contact.account_user_id` does not exist; identity linking is maintained in `crm_contact_identity_link` with a `UNIQUE (user_id)` constraint.
- **Verification**: Tested in `apps/api/test/phase-5-1-crm-profile.test.ts`. Attempting to link an already-linked `account_user` throws `CrmContactDuplicateLinkError` and returns HTTP 409 Conflict.

### Invariant 4: Compliance-Owned Consent
- **Proof**: CRM profile updates do not accept or modify consent flags. Consent is queried strictly from the `compliance_consent` table.
- **Verification**: Tested in `apps/api/test/phase-5-1-customer-360.test.ts`. Unconsented contacts return `marketingConsent: false`.

### Invariant 5: Formula Injection Sanitization
- **Proof**: `CrmOperationsService.sanitizeCsvCell` inspects every cell before serialization and escapes dangerous leading characters.
- **Verification**: Tested in `apps/api/test/phase-5-1-crm-operations.test.ts` with adversarial payloads (`=cmd|' /C calc'!A0`, `+cmd`, `@sum`). All dangerous cells are safely escaped.

### Invariant 6: Granular RBAC Permission Enforcement
- **Proof**: Every Admin CRM controller route is annotated with `@RequireAdminPermission(...)` and guarded by `SessionGuard` and `AdminPermissionGuard`.
- **Verification**: Tested in `apps/api/test/phase-5-1-customer-360.test.ts` and `apps/api/test/phase-5-1-crm-operations.test.ts`. Admin accounts lacking the required permissions receive HTTP 403 Forbidden.

---

## Architectural File Manifest

| Path | Purpose |
|---|---|
| `docs/architecture/phase-5-1-crm-customer-operations.md` | Formal architecture specification, frontend audit, and domain boundary contracts. |
| `packages/database/src/schema/tables.ts` | 8 CRM tables (`crm_contact`, `crm_contact_identity_link`, `crm_stage_history`, `crm_assignment_history`, `crm_tag`, `crm_contact_tag`, `crm_activity`, `crm_task`). |
| `packages/database/src/schema/state-values.ts` | CRM stages, activity types, task statuses, task priorities, and CRM admin permissions. |
| `packages/database/migrations/0025_phase_5_1_crm_customer_operations.sql` | Forward-only SQL migration. |
| `apps/api/src/modules/crm/crm.errors.ts` | Domain errors for CRM operations (`CrmContactNotFoundError`, `CrmContactDuplicateLinkError`, etc.). |
| `apps/api/src/modules/crm/crm-contact.service.ts` | Contact lifecycle, stage transitions, assignment history, identity linking, directory filtering. |
| `apps/api/src/modules/crm/crm-tag.service.ts` | Tag normalization, creation, contact association, and listing. |
| `apps/api/src/modules/crm/crm-activity.service.ts` | Append-only timeline activities (`NOTE`, `CALL`, `EMAIL`, etc.) and internal note unification. |
| `apps/api/src/modules/crm/crm-task.service.ts` | Follow-up task engine, status transitions, operational queues (my open, overdue, completed). |
| `apps/api/src/modules/crm/customer-360.service.ts` | Authoritative composed Customer 360 read model. |
| `apps/api/src/modules/crm/crm-operations.service.ts` | Pipeline stage metrics, cross-entity deduplication signals, sanitized CSV export. |
| `apps/api/src/modules/crm/admin-crm.controller.ts` | Admin CRM HTTP controller with granular RBAC permissions. |
| `apps/api/src/modules/crm/crm.module.ts` | CRM NestJS module registration and service exports. |
| `apps/api/test/phase-5-1-crm-profile.test.ts` | Checkpoint A test suite (13 tests). |
| `apps/api/test/phase-5-1-crm-activities.test.ts` | Checkpoint B test suite (8 tests). |
| `apps/api/test/phase-5-1-customer-360.test.ts` | Checkpoint C test suite (4 tests). |
| `apps/api/test/phase-5-1-crm-operations.test.ts` | Checkpoint D test suite (7 tests). |

---

Phase 5.2 Support / Ticket / Case Management Backend has NOT started.
