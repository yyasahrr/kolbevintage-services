# Phase 5.6 report — Supplier Production / Samples / QC Backend

Date: 2026-09-22
Branch: `arena/01a0c422-kolbevintage-services`

## Executive result

Phase 5.6 is implemented as an authoritative backend extension of the canonical supplier child order (`purchase_order`). The implementation does not create a second commercial order, payment, inventory, shipment, settlement, support, compliance, notification-delivery, or analytics authority.

Production now owns operational jobs, milestones, supplier capacity, samples and immutable evidence metadata, controlled change requests, QC checklists and inspections, defects, rework, lots, traceability, quality releases, and the recall foundation. Orders, Offers, Inventory, Shipping, Settlement, Support, Notifications, Audit, and Analytics remain owners of their existing concerns and are reached through bounded contracts or read-only factual integrations.

No pull request was created, per the task constraint. The branch was pushed only to the fixed Arena branch.

## Starting-state and baseline accounting

The requested expected Phase 5.5 baseline SHA `a344e941ee625df3bf78ddaf9dcedfb964f783f8` was available in the checkout as the Phase 5.5 final-CI commit. The actual starting point for this session was not that commit directly: it was merge commit `2dc1c29` (`chore: integrate published Phase 5.6 baseline`) with the published Phase 5.6 A/B work already present and a dirty, uncommitted hardening workspace. That actual state was preserved; no reset, rebase, force-push, or fabricated baseline was used.

The resulting checkpoint history is:

| Checkpoint | Commit | Result |
| --- | --- | --- |
| A | `5580b6d` — `feat(phase-5-6-a): add supplier production jobs capacity and milestones` | Jobs, canonical child-order linkage, milestones, capacity periods, closures, and reservation authority |
| B | `f031c94` — `feat(phase-5-6-b): add production samples and controlled change workflows` | Samples, immutable revisions/evidence metadata, review gates, and controlled changes |
| C | `abfed50` — `feat(phase-5-6-c): add QC lot traceability and quality release controls` | QC arithmetic, lots, traceability, defects/rework, release gates, and PostgreSQL hardening |
| D | `4c7acdd` — `feat(phase-5-6-d): add recall APIs and production hardening` | Recall hardening, capacity tests, security tests, RBAC, Notifications relay, Analytics metrics, and integration hardening |

The current local HEAD and pushed HEAD are both `4c7acdd`.

## Canonical ownership and API behavior

- Job creation calls the Orders production-eligibility contract with a locked canonical child order. Supplier identity and seller linkage are server-derived; target units and order version are snapshotted from Orders.
- Production never mutates `purchase_order`, `purchase_order_item`, offers, inventory balances/reservations, shipments, settlement rows, support cases, compliance documents, or notification deliveries.
- Jobs use explicit legal transitions only: draft, planned, in progress, blocked, completed, or cancelled. There is no arbitrary status PATCH.
- Every command has a bounded idempotency claim and request hash. Reuse with a different payload is rejected.
- Milestone changes append durable history. Admin-only skipping requires a reason.
- Capacity separates declared, reserved, unavailable, available-derived, and actual units. Supplier advisory locking plus period row locks serialize reservation, release, closure, and actual-unit updates.
- Cancelling a planned job releases its still-reserved capacity in the same transaction, writes history, marks the reservation released, and emits the capacity-release fact.

## Samples, evidence, and change boundaries

- Sample revisions are new rows; reviews are append-only and approved evidence cannot be updated or deleted by PostgreSQL triggers.
- Artifact registration accepts metadata only: approved MIME, bounded byte size, lowercase SHA-256, safe `production/...` object key, basename filename, and private metadata marker. Raw bytes, base64/data URLs, executables, unsafe paths, and oversized declarations are rejected.
- No S3/object-storage integration is claimed. Compliance private-document storage and CMS public storage are not reused.
- Commercial changes require the Orders/Offers owner decision reference. Delivery changes require Shipping ownership. Production records requested fields and decisions but never mutates commercial terms or shipment state.
- Support-case references are accepted as references only; Production does not create a parallel conversation system.

## QC, lots, release, and recall controls

- Published checklist versions are snapshotted into inspection context. Submitted inspection evidence is immutable.
- Quantities are safe PostgreSQL integers. Submission enforces:

  `sample_size = accepted_units + defect_units + rework_units + rejected_units`

  and integer basis-point rate bounds from 0 through 10,000.
- Draft/in-progress inspection rows are permitted to carry zero provisional result counters; the arithmetic invariant is enforced for submitted/terminal inspection states.
- Lot disposition enforces `accepted + rejected + rework <= produced`; produced output cannot exceed planned output. Defect quantities cannot exceed lot output, and aggregate rework allocations cannot exceed the defect quantity.
- Lot codes are globally unique. Trace rows enforce exact target exclusivity and matching trace type; lots remain distinct from inventory reservations and shipments.
- Quality release readiness checks job completion, lot completion/output, accepted inspection, final sample approval when required, no open major/critical defect, complete rework, and no pending commercial/delivery change. Approval changes the lot to released and exposes only a read-only Shipping handoff contract.
- Recall scope rows require exactly one of lot, purchase-order item, or variant and reject unrelated target columns. Lot-scoped recall quantities cannot exceed produced/planned lot ceiling. Suppliers can propose and submit suspected recalls; Admin approval uses the existing two-person approval infrastructure and a distinct checker before activation. Active lot recalls move the affected lot to `recall_hold` without mutating Shipping or Inventory.

## Notifications and Analytics integration

### Notifications

`ProductionNotificationRelayService` reads committed `production_event` facts and invokes the existing `NotificationDispatcherService` for authoritative supplier-member recipients. It maps only factual production events to four additive event keys:

- `SUPPLIER_PRODUCTION_JOB_CREATED`
- `SUPPLIER_PRODUCTION_ACTION_REQUIRED`
- `SUPPLIER_PRODUCTION_QUALITY_UPDATED`
- `SUPPLIER_PRODUCTION_RECALL_ACTION_REQUIRED`

Relay and provider/template failures are best-effort and failure-isolated. Production event facts remain owned by Production; recipient resolution, preferences, templates, channels, delivery attempts, and provider interaction remain owned by Notifications. There is no direct email/SMS provider call and no claim of live provider connectivity.

### Analytics

The Phase 5.5 read-only metric dictionary now has source-backed production metrics for:

- job count;
- completed job count;
- actual production units;
- approved quality releases;
- defects;
- rework units; and
- recall proposals.

The query layer supports only Platform and Supplier scopes for these metrics and reads the authoritative production tables directly as Analytics read-only sources. No KPI is stored or manufactured by Production.

## RBAC and security

The existing session role guard, `AdminPermissionGuard`, `AdminRbacService`, supplier membership resolution, `AuditService`, and Admin approval service are reused. New Admin permission actions are registered in the existing state source and migration constraint:

- `production:jobs:view`
- `production:config:view`
- `production:config:manage`
- `production:quality:review`
- `production:release:decide`
- `production:recall:approve`

Supplier IDs in request bodies and query strings never grant authority. Supplier scope comes from `Claims.sub` and server-side memberships. Outsider access, ambiguous supplier context, IDOR, unsafe pagination/status input, SQL injection-shaped input, raw evidence attempts, cross-job sample evidence, maker/checker self-approval, and mixed recall targets are covered by tests.

## Migration and schema result

Only migration `0030_phase_5_6_supplier_production_quality.sql` was changed or added for this phase. Migrations `0000` through `0029` were not modified. Drizzle schema, state-values, snapshot, and journal/registry ownership are aligned.

A clean PostgreSQL migration run reports:

| Measure | Exact result |
| --- | ---: |
| Migrations applied | 31 / 31 |
| PostgreSQL tables | 186 |
| Pre-Phase-5.6 tables | 158 |
| Phase 5.6 production-owned tables added | 28 |
| Foreign-key constraints | 428 |
| CHECK constraints | 525 |

The 0030 migration also extends the existing owner-domain state constraints for `PRODUCTION_RECALL`, production Admin permissions, and production notification event keys. The final schema verification output was:

`drizzle: بررسی سازگاری موفق — 31 مهاجرت، 186 جدول، 428 کلید خارجی، 525 قید CHECK`

## Frontend preservation and cutover

No frontend visual redesign, navigation removal, or full wiring was performed. `frontend-next/supplier-src/App.tsx`, `features.tsx`, `workflows.tsx`, and `data.ts` remain preserved fixtures/UI concepts. The existing cutover map is `docs/architecture/phase-5-6-supplier-frontend-cutover.md`.

The later cutover must replace reads with relative server-proxied API calls, preserve empty states, use server-returned integer quantities/rates, submit explicit idempotent commands, keep artifact metadata private, and never trust a browser-selected supplier ID. Live dashboard wiring, upload/object-storage adapter, notification presentation/templates/providers, support case creation, and shipping-provider integration remain deferred.

## Verification evidence

### Local verification

| Command | Result |
| --- | --- |
| `npm run preflight:check` | PASS — 31/31 migrations, 186 tables |
| `npm run db:migrate:verify` | PASS — 31 migrations, 186 tables, 428 FKs, 525 CHECKs |
| `npm run infra:verify` | PASS — 12 environment checks, 9 Compose services; static verification only |
| `npm run typecheck:all` | PASS — shared, database, API, and frontend typechecks |
| `npm run test:all` | PASS — 23 shared tests, 95 database tests, 904 API tests across 81 files, 142 frontend tests across 15 files |
| `git diff --check` | PASS before checkpoint commits |

Phase 5.6 dedicated API coverage passed with 27 assertions across capacity, samples/changes, QC/lots, recall/security, service, and logic suites. The dedicated migration suite passed 5 tests. Real PostgreSQL coverage includes supplier ownership, IDOR, reservation races, cancellation release, sample gates/immutability, upload safety, change-owner boundaries, QC arithmetic, lot traceability, release gates, recall maker/checker, RBAC, idempotency, pagination, injection-shaped inputs, notification failure isolation, and Analytics source-backed reads.

### GitHub Actions

The pushed D checkpoint produced a real successful CI run:

- Workflow: `CI`
- Run: `35655802688`
- SHA: `4c7acdd9ad430d76aa33e0311c901509056b0bc1`
- URL: https://github.com/yyasahrr/kolbevintage-services/actions/runs/35655802688
- Jobs passed: `packages/shared`, `packages/database`, `apps/api`, `frontend-next`, and `infra`

The run passed the repository's package typechecks/builds, live PostgreSQL schema equivalence, full API suite, frontend regression/build, and infrastructure verification. GitHub emitted only the repository's existing Node.js 20 action deprecation / future Ubuntu image annotations; no job failed.

## Explicit non-claims and next phase boundary

- No real object storage, carrier, SMS, email, payment, or analytics provider integration was added.
- No browser localStorage value, static fixture, or fabricated KPI is an authority.
- Production does not create financial liability, inventory, shipment, settlement, support, or commercial-order mutations.
- Phase 5.7 was not started.

Phase 5.7 Promotions / Campaign / Commercial Engine Backend has NOT started.
