# Phase 5.5 — Analytics & Reporting Backend

## Executive summary

Phase 5.5 is implemented on `arena/01a0c422-kolbevintage-services`. The backend now exposes a read-only Analytics bounded context over authoritative repository domains. It does not create a second order ledger, payment ledger, settlement ledger, inventory writer, CRM store, support store, notification outbox, supplier authority, or VIP membership authority.

The implementation is deliberately live-source based. Analytics-owned rows are only validated report definitions and rebuildable operational execution/export metadata. Every metric query is fixed server-side SQL selected from an allowlisted semantic registry. The browser can select metric keys and validated range/scope values, but cannot provide SQL, table names, predicates, executable expressions, provider secrets, card data, tokens, or arbitrary PII fields.

## Checkpoint and CI evidence

| Checkpoint | Commit | GitHub Actions run | Result |
|---|---|---:|---|
| A — metric/reporting foundation and migration | `c8c98f1` | `35640283633` | All five CI jobs passed |
| B — commerce, marketplace, inventory, financial analytics | `f90ac03` | `35641384462` | All five CI jobs passed |
| C — CRM, support, notifications, reports, exports, controls | `9d1faf4` | `35642182564` | All five CI jobs passed |
| D — APIs, reconciliation, freshness, security, hardening | `764176d` | `35643462059` | All five CI jobs passed |

The migration preflight and live PostgreSQL checks at the foundation checkpoint reported 30 applied migrations, 158 public tables, 349 foreign keys, and 434 CHECK constraints. Migration files `0000` through `0028` were not changed; Phase 5.5 adds only `0029_phase_5_5_analytics_reporting.sql` and the corresponding Drizzle schema/snapshot/journal/registry state.

## Delivered implementation

### 1. Metric registry and semantic contract

`apps/api/src/modules/analytics/analytics-metrics.ts` contains 43 version-controlled metric definitions. Each definition records:

- stable metric key and human label;
- category, unit, and amount/count basis;
- authoritative source domain and tables;
- timestamp basis and half-open UTC range treatment;
- included and excluded source statuses;
- refund and cancellation treatment;
- supported dimensions and explicit scopes;
- freshness policy and fixed query kind.

The registry covers:

- platform accounts and platform order grain;
- retail order count, units, ordered GMV, paid orders, and status counts;
- wholesale parent order count, units, ordered GMV, and confirmed orders;
- marketplace child orders and supplier-attributed child GMV;
- supplier child orders, units, and delivered shipments;
- VIP active memberships, orders, and ordered GMV;
- current on-hand, reserved, and available inventory;
- payment submitted/confirmed/failed values and completed refunds;
- settlement pending, available, held, platform fee, withdrawal, payout-in-transit, and succeeded-payout values;
- CRM contacts and overdue tasks;
- support open cases and SLA breaches;
- notification sent, delivered, failed, and delivery-success ratio metrics.

Retail, wholesale parent, marketplace child, supplier, payment, refund, payout, and settlement grains are intentionally not collapsed into one invented KPI. Parent GMV is not added to child GMV. Confirmed payment is not called revenue or bank settlement. A succeeded payout is not called a bank statement.

### 2. Money, ratios, ranges, and freshness

- Source IRR monetary columns remain PostgreSQL `BIGINT`.
- API monetary values are decimal integer strings.
- Ratios retain `numerator`, `denominator`, and integer `basisPoints`; no floating-point monetary authority is introduced.
- Storage/query predicates use UTC timestamps.
- Calendar presets use an explicit IANA timezone with configurable `Asia/Tehran` default.
- Supported presets are `TODAY`, `YESTERDAY`, `LAST_7_DAYS`, `LAST_30_DAYS`, `MONTH_TO_DATE`, and `CUSTOM`.
- Custom UTC instants require an explicit `CUSTOM` preset and `Z`-terminated ISO instants. Custom calendar dates are interpreted at midnight in the requested IANA zone.
- Comparisons support `NONE`, `PREVIOUS_PERIOD`, and `PREVIOUS_YEAR`.
- Ranges are half-open: `[startUtc, endUtc)`.
- Current-state inventory, membership, support, and settlement-balance metrics are evaluated as of the report end; flow metrics use their declared event timestamp.
- Every report and metric result includes `dataAsOf`, `sourceMode: AUTHORITATIVE_LIVE`, and `snapshot: false`. No cache or analytics snapshot is presented as authoritative real time.

### 3. Explicit scopes and authorization

The contract supports exactly `PLATFORM`, `RETAIL`, `WHOLESALE`, `SUPPLIER`, and `VIP_ACCOUNT`.

- Admin analytics uses the existing `AdminPermissionGuard` and existing Admin RBAC. The Phase 5.5 actions are `analytics:dashboard:view`, `analytics:report:view`, `analytics:report:manage`, `analytics:export`, and `analytics:reconciliation:view`.
- Supplier scope is derived from `supplier_member.user_id`; a client-provided supplier ID is only an optional assertion and cannot broaden access.
- VIP scope is derived from `wholesale_account.user_id`; a client-provided account ID is only an optional assertion and cannot broaden access.
- Supplier and VIP cross-tenant requests fail with authorization errors.
- Admin tenant scope IDs must resolve to existing supplier or VIP account rows.
- Analytics uses the existing session guard, role metadata, Admin RBAC, and `AuditService`; it does not introduce a competing RBAC system.

### 4. API surface

The Analytics module is registered in `AppModule` and the module registry is marked live. The versioned routes are:

- `GET /api/v1/admin/analytics/overview`
- `GET /api/v1/admin/analytics/metrics`
- `GET /api/v1/admin/analytics/retail`
- `GET /api/v1/admin/analytics/wholesale`
- `GET /api/v1/admin/analytics/suppliers`
- `GET /api/v1/admin/analytics/vip`
- `GET /api/v1/admin/analytics/finance`
- `GET /api/v1/supplier/analytics/overview`
- `GET /api/v1/supplier/analytics/orders`
- `GET /api/v1/supplier/analytics/inventory`
- `GET /api/v1/supplier/analytics/settlement`
- `GET /api/v1/vip/analytics/overview`
- `GET /api/v1/vip/analytics/orders`
- `GET /api/v1/admin/analytics/reconciliation`
- `GET /api/v1/supplier/analytics/reconciliation`
- `GET /api/v1/vip/analytics/reconciliation`

All routes return live authoritative values with freshness metadata. Frontend dashboards were not wired, redesigned, or visually changed in this phase.

### 5. Validated reports and durable CSV exports

`analytics_saved_report`, `analytics_report_run`, and `analytics_export_job` are Analytics-owned metadata tables. Their business facts are rebuildable and non-authoritative.

Saved reports:

- accept only allowlisted metric keys, dimensions, range fields, scope, and report type;
- reject unknown fields and arbitrary SQL/query fragments;
- resolve supplier/VIP scope from the server before persistence;
- create durable queued/running/completed/failed report-run metadata;
- store `AUTHORITATIVE_LIVE` source mode and `dataAsOf` with completed results;
- use existing `AuditService` for report creation, deletion, and execution records.

Exports:

- are authorized against the report run and requested scope;
- accept only CSV, with a positive maximum row limit of 10,000;
- support page/row-limit selection at the bounded metric-row boundary;
- are durable and retry-safe through conditional `QUEUED` → `PROCESSING` claims;
- expire after the configured 24-hour TTL;
- expose a CSV download route with attachment content type;
- contain only metric/report rows, not card data, tokens, provider secrets, or unsafe PII;
- neutralize formula injection from `=`, `+`, `-`, `@`, tabs, and carriage returns;
- use `AuditService` for export creation.

No PDF/XLSX, GA, BigQuery, ClickHouse, Metabase, S3/CDN, or other unimplemented integration is claimed.

### 6. Reconciliation and production controls

`AnalyticsReconciliationService` reads and reports controls for:

- Orders/Marketplace parent-versus-child grain;
- Payments and refunds as separate authoritative sources;
- Shipping status and delivered timestamps;
- Inventory on-hand/reserved invariants;
- Settlement account/posting integrity without creating another ledger;
- CRM contacts/stages and CRM task truth;
- Support cases and SLA status;
- Notification delivery states;
- VIP membership and wholesale order truth.

The reconciliation API is explicitly read-only. It reports `PASS`, `WARN`, `FAIL`, or `NOT_APPLICABLE` checks and never repairs, replays, or mutates source domains. Browser `localStorage` commerce/purchase events remain non-financial and are not ingested as revenue. Behavioral ingestion remains deferred unless consent/privacy controls are sufficient.

## Tests and verification

Local verification completed on real PostgreSQL included:

- `npm run typecheck:all`;
- API typecheck and build;
- Analytics metric/range/ratio tests;
- commerce, marketplace, supplier, inventory, payment/refund, and settlement query tests;
- saved-report and durable-export tests;
- CSV formula-injection tests;
- reconciliation tests over all authoritative-domain controls;
- supplier/VIP server-derived scope and cross-tenant authorization tests;
- versioned HTTP API tests for unauthenticated, admin, and supplier access;
- module-boundary, dependency-cycle, and public-module-surface tests;
- migration, schema equivalence, architecture-freeze, infrastructure, shared, database, frontend, and existing regression suites through the recorded GitHub Actions runs.

The Analytics additions did not remove, loosen, or skip existing tests. Existing Phase 4.x and Phase 5.0–5.4 behavior, CMS behavior, supplier empty-data behavior, and frontend behavior remain unchanged. The pre-existing Phase 4.7.1 concurrency assertion noted in the repository history was not modified by this phase and is not an Analytics failure.

## Future frontend cutover map

Phase 6 can replace local/placeholder dashboard values with the new contracts without redesigning the UI:

| Surface | Backend contract |
|---|---|
| Supplier overview | `/supplier/analytics/overview` |
| Supplier orders/inventory/settlement | corresponding scoped supplier routes |
| VIP wholesale overview | `/vip/analytics/overview` |
| Admin retail/wholesale/finance | admin scoped routes |
| CRM | CRM metrics from `crm_contact` and `crm_task` |
| Support | support case/SLA metrics |
| Notifications | delivery-state metrics |
| Browser commerce events | only a future consented behavioral contract; never financial truth |

Phase 5.5 does not start that cutover.

Phase 5.6 Supplier Production / Samples / QC Backend has NOT started.
