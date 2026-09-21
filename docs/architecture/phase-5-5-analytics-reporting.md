# Phase 5.5 — Analytics & Reporting Backend

## Boundary and ownership

Analytics is a read-only bounded context over the existing Orders, Retail Orders, Payments, Refunds, Shipping, Inventory, Settlement, CRM, Support, Notifications, VIP, Suppliers, and Auth domains. It does not become an alternative order ledger, payment state machine, inventory writer, settlement calculator, CRM store, support case store, notification outbox, or membership authority.

Migration `0029_phase_5_5_analytics_reporting.sql` adds only rebuildable/operational metadata:

- `analytics_saved_report` — a validated, allowlisted report definition;
- `analytics_report_run` — execution status, result metadata, source mode, and data watermark;
- `analytics_export_job` — bounded durable CSV job metadata and output for the bounded implementation.

These rows can be deleted and rebuilt without changing business truth. No business-domain row is written by an Analytics query.

## Authoritative source map

| Reporting area | Authoritative source | Grain / timestamp basis | Important non-equivalence |
|---|---|---|---|
| Platform accounts | `account_user` | account / `created_at` | Browser events are not account truth |
| Retail | `retail_order`, `retail_order_item` | order / `created_at` | Retail backend is intentionally only as complete as the existing table |
| Wholesale parent | `wholesale_order`, `wholesale_order_item` | parent order / `created_at` | Parent GMV is not added to child GMV |
| Marketplace / supplier child | `purchase_order`, `purchase_order_item`, `shipment` | child order or shipment / source timestamp | Child order is not a second parent order |
| Payments | `payment` | submitted/verified timestamp | Confirmed cash is not ordered GMV or bank settlement |
| Refunds | `refund` | `completed_at` | Refunds are separate values, not silently netted into every metric |
| Inventory | `product_variant_inventory` | current row / `updated_at` | Kolbe and supplier inventory remain separately scoped |
| Settlement | `settlement_account`, `settlement_posting`, `withdrawal_request`, `payout` | posting/request/payout timestamps | Pending, available, held, payout-transit, and succeeded payout remain distinct |
| CRM | `crm_contact`, `crm_task` | contact/task timestamps | Customer 360 remains the source for customer commerce semantics |
| Support | `support_case`, `support_case_sla` | opened/SLA timestamps | No satisfaction metric is inferred |
| Notifications | `notification_delivery` | delivered/failed/attempt timestamp | SENT is not DELIVERED |
| VIP | `wholesale_account`, `wholesale_membership`, `wholesale_order` | membership/order timestamps | Account scope is resolved from the authenticated user |

The metric registry in `apps/api/src/modules/analytics/analytics-metrics.ts` is the semantic dictionary. Every query key is version-controlled and documents amount basis, statuses, refund and cancellation treatment, timezone behavior, dimensions, and freshness.

## Money and time

All monetary source columns remain PostgreSQL `BIGINT` IRR. The API serializes money as decimal integer strings. Ratios retain numerator and denominator and expose integer basis points; no floating-point monetary authority is introduced.

Source timestamps are stored/query-bound in UTC. Every report resolves an explicit IANA timezone for calendar boundaries. The configurable default is `Asia/Tehran`; it is never taken from the server's local timezone. Custom UTC instant ranges require explicit `Z` instants, while custom calendar dates are interpreted at midnight in the requested IANA timezone. Report ranges are half-open: `[startUtc, endUtc)`.

Each result carries `dataAsOf`, `sourceMode: AUTHORITATIVE_LIVE`, and `snapshot: false`. This phase does not present a cached snapshot as real time and does not use analytics data to mutate a source domain.

## Scopes and authorization

The API contract has explicit `PLATFORM`, `RETAIL`, `WHOLESALE`, `SUPPLIER`, and `VIP_ACCOUNT` scopes. Admin scope selection is permission-protected and validated. Supplier scope is resolved from `supplier_member` for the authenticated supplier user; a browser-supplied supplier ID is never an ownership authority. VIP scope is resolved from `wholesale_account.user_id` for the authenticated VIP user; a different account ID is rejected. Empty periods return factual zero values, never seeded/sample KPIs.

The existing Admin RBAC is extended with `analytics:dashboard:view`, `analytics:report:view`, `analytics:report:manage`, `analytics:export`, and `analytics:reconciliation:view`. No second permission system is introduced.

## Existing local/fake metrics and future cutover

The current `frontend-next/storefront/lib/analytics.ts` stores `kv_commerce_events_v1` in browser `localStorage`, including a browser `purchase` event. It is not a financial source and is not ingested as revenue in Phase 5.5. `WholesaleDashboard.tsx` keeps legacy `kv_wholesale_orders` local order state; that state is not an order source for Analytics. The supplier portal contains hardcoded/empty-state presentation values; those remain visually unchanged until Phase 6.

Phase 6 will map, without redesigning this phase's frontend:

| Existing surface | Future backend contract |
|---|---|
| Supplier dashboard operational cards | `/supplier/analytics/overview` and scoped order/inventory metrics |
| Supplier financial cards | Settlement-backed supplier analytics |
| VIP/Wholesale local overview | `/vip/analytics/overview` and wholesale metrics |
| Admin retail dashboard | Admin retail analytics metrics |
| Admin wholesale dashboard | Marketplace/wholesale parent-child metrics |
| CRM dashboard | CRM metrics sourced from CRM and Customer 360 semantics |
| Support dashboard | Support case and SLA metrics |
| Messaging dashboard | Notification delivery metrics |
| `kv_commerce_events_v1` | A future consented behavioral contract, or explicit deferral; never financial truth |

No frontend dashboard is wired or visually redesigned in Phase 5.5.

## Reporting and export rules

Saved reports contain a report type, allowlisted metric keys/dimensions, a validated range, explicit scope, and ownership metadata. They cannot contain SQL, column names as executable fragments, provider secrets, card data, tokens, or unsafe PII fields. CSV export is bounded and durable, uses a row limit, pagination/chunking at the query boundary, expiry, authorization, and formula-injection neutralization for `=`, `+`, `-`, `@`, tabs, and carriage returns. PDF/XLSX, GA, BigQuery, ClickHouse, Metabase, S3/CDN, and other integrations are not claimed.

## Reconciliation and freshness policy

Analytics reports mismatches against source-domain truth; it never repairs a mismatch by writing to Orders, Payments, Inventory, Settlement, CRM, Support, Notifications, or VIP. Parent/child wholesale totals are reconciled at their declared grains. Payment-confirmed totals reconcile to `payment.status = verified`; supplier financial values reconcile to Settlement postings/accounts; payout transit is not bank-settled; notification delivery states are counted separately. A later performance snapshot is permitted only if it is versioned, scoped, rebuildable, watermark-labeled, and clearly non-authoritative.
