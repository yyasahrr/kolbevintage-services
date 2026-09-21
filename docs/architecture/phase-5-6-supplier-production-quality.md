# Phase 5.6 — Supplier Production / Samples / QC

Status: authoritative backend boundary and implementation plan

## Scope and audit result

Phase 5.6 extends an eligible supplier child order operationally. It does not create a second order, RFQ, offer, inventory, payment, shipping, settlement, support, notification, compliance, or catalog authority.

The completed pre-design audit covered:

- Orders and Offers: `wholesale_order` is the commercial parent. `purchase_order` is the canonical supplier child and is linked by `purchase_order.wholesale_order_id`; `purchase_order_item` links the child line to `wholesale_order_item`. Orders owns child state, versions, history, totals, and commercial snapshots. Offers owns `seller_offer`, packages, RFQ, and legacy quote records.
- Fulfillment: owns operational exceptions and replacement requests. It is not a production job or QC owner.
- Inventory: owns `product_variant_inventory`, reservations, ledger, and reservation consumption. Production never changes these tables; capacity reservations are a distinct production capability resource.
- Shipping: owns quotes, shipments, shipment items, shipment events, provider calls, and shipping handoff. Production emits a read-only handoff contract after quality release; it does not call a carrier.
- Compliance: owns legal/KYB/private compliance evidence. Production artifact metadata is a separate bounded abstraction and never asserts object storage or legal compliance.
- Settlement: owns payable accounts, journals, postings, holds, payouts, and release effects. Production never writes settlement rows.
- Support, Notifications, Analytics, Audit: these domains remain owners. Production emits append-only factual integration events and records audit entries through `AuditService`; it does not create support cases, send messages, manufacture KPIs, or write another audit log.
- Database and registry: the pre-Phase 5.6 schema had 158 tables and 30 migrations; after applying the additive migration it has 186 tables and 31 migrations. The commercial parent/child path above and legacy `rfq`/`quote` tables remain non-authoritative for production. Phase 5.6 adds only migration `0030_phase_5_6_supplier_production_quality.sql`.
- Supplier frontend: `frontend-next/supplier-src/App.tsx`, `features.tsx`, `workflows.tsx`, and `data.ts` already expose production, samples, quality, change-request, and recall concepts. Their static/demo records are not authority and remain visually and behaviorally preserved in this backend-only phase.

## Canonical linkage

A production job has exactly one `purchase_order_id` and stores the authenticated supplier linkage resolved from that child. Job creation re-reads the canonical child through the Orders owner-service contract and requires:

1. the child exists and belongs to a supplier seller;
2. the authenticated supplier member belongs to the child supplier (or the actor is an Admin);
3. the child is not cancelled or delivered and has a valid supplier-operational status;
4. target units are derived from the server-side child items, never trusted from a browser payload;
5. the child order version is snapshotted for explainability, but the child is not mutated by Production.

The legacy RFQ/quote path is deliberately not used as a production parent. A future RFQ-to-order conversion must first use the existing Offers/Orders workflow and then create the production extension from the resulting canonical child order.

## Bounded ownership

| Concern | Phase 5.6 owner | What it may do | What it must not do |
| --- | --- | --- | --- |
| Production job, milestones, capacity, samples, change requests, QC, lots, releases, recalls | `production` | Store operational records, validate transitions, publish factual event contracts | Mutate an order, offer, inventory, payment, shipment, settlement, support, notification, compliance, or catalog row |
| Commercial terms | Orders/Offers | Decide price, quantity, seller, accepted terms, and commercial changes | Be changed by Production |
| Physical inventory | Inventory | Reserve/consume/release canonical inventory | Be represented by capacity reservations |
| Carrier handoff | Shipping | Create shipments and call providers after its own gates | Be called by Production |
| Recall approval | Admin approval + Production execution | Maker-checker approval and recall lifecycle | Supplier independently activating a high-impact/global recall |
| Private evidence | Production artifact metadata abstraction | Validate metadata, MIME, size, checksum, safe key | Store raw large base64, executable content, or claim S3/object storage |

## State machines

All commands are explicit endpoints. There is no arbitrary status PATCH.

- Job: `draft -> planned -> in_progress -> blocked -> in_progress -> completed`; `draft|planned|blocked -> cancelled`. A job may not start mass production while a required final sample lacks an approved review. Completion does not imply quality release.
- Milestone: `pending -> in_progress -> completed`; `pending|in_progress -> skipped` only for an Admin with a reason. A completed/skipped milestone is immutable history.
- Capacity reservation: `reserved -> released` or `reserved -> consumed`; capacity period closure and reservation commands serialize on the same PostgreSQL advisory lock and period row lock.
- Sample: `draft -> submitted -> under_review -> changes_requested|rejected|approved`; revisions and reviews are append-only. An approved revision cannot be edited or deleted.
- Change request: `draft -> submitted -> under_review -> approved|rejected|withdrawn`; commercial and delivery requests require the owning domain's decision reference and never update terms here.
- Inspection: `draft -> in_progress -> submitted -> accepted|rejected|rework_required`; a submitted inspection is immutable.
- Defect: `open -> acknowledged -> rework|accepted|waived -> closed`; high/critical open defects block release.
- Rework: `requested -> in_progress -> completed|failed|cancelled`; failed or incomplete rework blocks release.
- Lot: `open -> in_progress -> completed -> released`; `open|in_progress|completed -> recall_hold` when a recall is active.
- Quality release: `pending -> ready -> approved|rejected|revoked`; approval requires the server-side release gate.
- Recall: `draft -> pending_approval -> approved -> active -> contained -> closed`; `pending_approval -> rejected|cancelled`. A supplier can propose/submit but cannot activate a high-impact/global recall.

## Capacity semantics and concurrency

Capacity is not supplier identity and is not inventory. For every supplier capacity period the backend distinguishes:

- `declared_units`: supplier declaration;
- `reserved_units`: active production reservations;
- `unavailable_units`: closure or planned downtime units;
- `available_units`: derived as `declared - reserved - unavailable`;
- `actual_units`: recorded output, never used to silently rewrite a declaration.

Creating a closure, creating/releasing a reservation, and recording actual units all acquire the same `pg_advisory_xact_lock` for the supplier, then lock the affected capacity period with `FOR UPDATE`. The transaction checks overlapping closures and the available-unit equation before changing counters. PostgreSQL CHECK constraints reject negative counters and over-reservation even if a caller bypasses the service.

## Samples and private evidence

Production stores metadata only: provider (`metadata_only` in this phase), sanitized object key, MIME, byte size, checksum, original filename, and evidence type. The API rejects `content`, `contentBase64`, data URLs, executables, unsafe MIME types, oversized declarations, unsafe keys, and invalid checksums. No raw artifact bytes are persisted and no S3 claim is made. Compliance's existing private document storage remains a separate owner and is not reused as a production authority.

## QC, arithmetic, traceability, and release

All factual quantities are PostgreSQL integers and all rates are integer basis points. Inspection submission validates:

`sample_size = accepted_units + defect_units + rework_units + rejected_units`

and `0 <= defect_rate_bps, pass_rate_bps <= 10,000`, with rates computed using integer `bigint` arithmetic. A checklist version is copied into each inspection; published checklist versions and submitted inspections cannot be changed. Lots carry unique lot codes and append-only trace links to child order items, variants, and source lots. Release readiness checks completed lots, submitted/accepted inspections, complete rework, no open high/critical defects, final approved sample evidence where required, and no pending commercial/delivery change request.

## Integration contracts

Production events are append-only facts with a source event id, supplier scope, entity, and safe payload. They are the handoff contract for:

- Notifications: recipient scope and event key are factual; a notification dispatcher remains the owner of delivery.
- Support: a change/quality/recall response can carry a support-case reference; Production does not create or update a support case.
- Notifications: the bounded `ProductionNotificationRelayService` reads committed production facts and invokes the existing Notifications dispatcher with factual supplier-member events. It is best-effort and failure-isolated; templates, provider delivery, and recipient preferences remain Notifications-owned.
- Analytics: the Phase 5.5 metric dictionary/query layer exposes only source-backed production job, output, quality-release, defect, rework, and recall metrics. Analytics remains read-only and never stores a production KPI.
- Audit: every command uses the existing Audit service in the same transaction where possible.
- Shipping: an approved quality release exposes a `shippingHandoff` contract containing the canonical child order, production job, released lot IDs, and release id; no carrier/provider is called.

## Supplier/Admin access

Supplier identity is resolved from `Claims.sub` and the existing `supplierMember` owner service. A supplier cannot choose a different supplier id in a body or query to widen access. Existing supplier roles are explicit:

- `owner`: all production operations for its supplier;
- `sales`: read jobs/samples/QC and create operational/commercial/delivery requests;
- `warehouse`: manage capacity, job progress, milestones, lots, inspections, and evidence;
- `finance`: read-only production context;
- `admin`: Admin routes, checklist/milestone configuration, sample review, quality release, and maker-checker recall actions.

Existing Admin RBAC and `approval_request` maker-checker infrastructure is reused for high-impact/global recalls. The recall maker and checker must differ.

## Frontend preservation and cutover map

No supplier visual component, navigation entry, localStorage demo, or static copy is removed in Phase 5.6. The mapping is recorded in `docs/architecture/phase-5-6-supplier-frontend-cutover.md`:

- `production` / `milestones` → `production_job`, `production_job_milestone`, and event-backed read APIs;
- `samples` → `production_sample`, append-only revisions/reviews, and artifact metadata;
- `quality` / `quality-docs` → checklist versions, inspections, defects, lots, releases, and recall APIs;
- `changes` → controlled change-request API;
- `profile` capacity concepts → supplier capabilities, periods, closures, and reservations;
- `data.ts` and other demo records → fixtures only, never an authority.

Full frontend cutover, upload UX, live notification presentation/templates/providers, support case creation, analytics dashboard redesign, and shipping-provider wiring remain deferred and are not claimed by this phase. The backend relay and read-only metric definitions are contracts only; they do not make browser localStorage or demo data authoritative.

## Planned migration accounting

Migration `0030` contains the production-owned tables plus additive owner-domain CHECK extensions for the existing `PRODUCTION_RECALL` approval type, production admin permissions, and factual production notification event keys. The final report will state exact PostgreSQL table, FK, and CHECK counts from the migrated database, not estimates. The migration is forward-only and all earlier files remain unchanged.
