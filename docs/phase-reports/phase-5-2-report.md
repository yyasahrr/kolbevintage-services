# Phase 5.2 — Support / Ticket / Case Management Backend — Report

**Branch:** `arena/01a0bac3-kolbevintage-services` (strictly working branch; no `main` interaction, no history rewrite, no force push, no PR)
**Starting SHA:** `3b97439c9ffdf15457c2ac9ce6c73512f99ee49f` (docs: complete phase 5.1 verification audit and exact SHA record — CI run **35532393969 SUCCESS**)
**Baseline re-verified locally before any change:** 26 migrations / 121 tables / 274 FKs / 356 CHECKs; `npm run test:all` = shared 23 / database 84 / api 755 / next 125 = **987 passed, 0 skipped, 0 failed**
**Ending SHA (code):** `614e2c5` (feat(phase-5-2-d): add multi-portal support APIs and case operations — CI run **35566416150 SUCCESS**)
**Date:** 2026-09-21
**Database Status:** 27 migrations / 133 tables / 300 FKs / 378 CHECK constraints (zero runtime DDL; migrations 0001–0025 untouched; forward-only migration `0026_phase_5_2_support_case_management.sql`)
**Location:** Falkenstein, Saxony, DE — no Iranian payment provider, carrier, tax-authority, or payout provider credential exists in this repository; no real external banking or payment call was made or claimed.

> **Phase 5.3 Notifications & Messaging Backend has NOT started.** Phase 5.2 establishes the authoritative Support, Ticket, and Case Management backend without compromising or violating the single-writer domain boundaries of Catalog, Suppliers, Orders, Inventory, Fulfillment, Payments, Shipping, Settlement, Compliance, CRM, and Audit.

---

## Exact Phase 5.2 Truth Table

| Subsystem / Capability | Checkpoint | Status | Authoritative Storage / Architecture | Evidence / Invariant |
|---|---|---|---|---|
| Domain Audit & Architecture Doc | A | VERIFIED | `docs/architecture/phase-5-2-support-case-management.md` | Formal architecture specification auditing legacy frontend mock implementations (`frontend-kolbe` wholesale tickets, `frontend-supplier` disputes) and establishing zero god-service boundaries. |
| Support Case Domain Model | A | VERIFIED | `support_case` | First-class case management supporting Retail Customer, VIP Buyer, Supplier, and Admin-created cases with explicit tenant foreign keys (`requester_user_id`, `wholesale_account_id`, `supplier_id`). |
| Public Reference Generator | A | VERIFIED | `SupportCaseService.generatePublicReference` | Human-friendly tracking references (`SUP-XXXXXXXX`) formatted with 8 uppercase alphanumeric characters, cryptographically random, collision-safe, and indexed. |
| Case Lifecycle State Machine | A | VERIFIED | `support_case`, `support_case_status_history` | Formal state machine (`OPEN`, `IN_PROGRESS`, `WAITING_FOR_CUSTOMER`, `WAITING_FOR_INTERNAL`, `RESOLVED`, `CLOSED`) with append-only immutable audit trail recording actor, source, and reason. |
| Reopening Policy | A | VERIFIED | `SupportCaseService.transitionStatus` | Reopening permitted from `RESOLVED` or `CLOSED` back to `OPEN` with explicit `reopened_at` timestamping and audit logging. |
| Audited Priority Transitions | A | VERIFIED | `support_case`, `support_case_priority_history` | Priority levels (`LOW`, `NORMAL`, `HIGH`, `URGENT`) with append-only audit trail capturing old priority, new priority, admin id, and business justification. |
| Audited Assignment Engine | A | VERIFIED | `support_case`, `support_case_assignment_history` | Case assignment and reassignment across agents and teams (`RETAIL_SUPPORT`, `VIP_SUPPORT`, `SUPPLIER_OPERATIONS`, `PAYMENTS`, `SHIPPING`, `FINANCE`, `COMPLIANCE`, `QUALITY`). |
| Constrained Domain Relations | A | VERIFIED | `support_case_relation` | Formal references linking cases to orders, order items (with quantity), shipments, payments, refunds, wholesale requests, purchase orders, and settlement withdrawals. |
| Database Safety & Migration | A | VERIFIED | Migration `0026`, Drizzle schema snapshot | 12 new tables (total 133), 26 new FKs (total 300), 22 new CHECKs (total 378), zero float money, strict RESTRICT on deletes. |
| Multi-Party Conversation Engine | B | VERIFIED | `support_message` | Multi-party messaging supporting `CUSTOMER`, `VIP_BUYER`, `SUPPLIER`, `ADMIN`, and `SYSTEM` author types with timestamps and idempotency keys. |
| Visibility Separation & Customer Isolation | B | VERIFIED | `support_message.visibility` | Messages strictly partitioned into `PUBLIC` and `INTERNAL`; internal messages and internal notes are guaranteed never to leak to customer, VIP, or supplier queries. |
| Message Idempotency | B | VERIFIED | `support_message.idempotency_key` | Idempotent message submission ensuring network retries or duplicate clicks do not produce duplicate messages. |
| Support Internal Notes | B | VERIFIED | `support_internal_note` | Admin-only internal collaboration notes with pinned status sorting (`is_pinned DESC, created_at ASC`), complete isolation from client portals, and audit log emission. |
| Participant Isolation & Security | B | VERIFIED | `SupportConversationService.verifyParticipantAccess` | Strict tenant boundary enforcement: retail customers cannot access other customers' cases, VIP buyers are scoped to their wholesale account, and suppliers to their supplier ID. |
| Secure Attachment Metadata | B | VERIFIED | `support_attachment` | Strict MIME type whitelisting, script extension prohibition (`.exe`, `.sh`, `.php`), 15MB file size limit, and signed time-bounded token URLs (no raw public S3 URLs). |
| Malware Scan Lifecycle | B | VERIFIED | `support_attachment.scan_status` | Status tracking (`PENDING_SCAN`, `CLEAN`, `SUSPICIOUS`, `REJECTED`); download blocked for suspicious or rejected files. |
| Versioned SLA Policies | C | VERIFIED | `support_sla_policy` | Configurable SLA policy definitions with versioning, target minutes for first response and resolution, and hierarchical matching (exact -> category -> priority fallback). |
| Immutable Case SLA Snapshots | C | VERIFIED | `support_case_sla` | SLA targets snapshotted immutably upon case creation; policy changes never rewrite historical case target commitments. |
| SLA Clocks & Breach Detection | C | VERIFIED | `SupportSlaService.evaluateCaseSla` | Real-time derivation of `firstResponseDueAt`, `resolutionDueAt`, `isFirstResponseBreached`, and `isResolutionBreached`. |
| Escalation Engine | C | VERIFIED | `support_case_escalation_history` | Multi-level escalation tracking (`MANUAL_ADMIN`, `SLA_BREACH`, `SYSTEM_RULE`) with priority escalation, team routing, and audit trail. |
| Operational Queues | C | VERIFIED | `SupportOperationsService` | Real-time queues: `unassigned`, `my`, `team`, `urgent`, and `breached`. |
| Support Control Tower Metrics | C | VERIFIED | `SupportOperationsService.getControlTowerMetrics` | Factual SQL aggregation of case volume, status distribution, priority distribution, team workload, and SLA compliance rate (zero mock numbers). |
| Retail Customer Portal API | D | VERIFIED | `CustomerSupportController` (`/api/v1/support/cases*`) | Authenticated retail customer endpoints for case creation, listing, details, and message replies scoped strictly to `req.user.sub`. |
| VIP Wholesale Support Portal API | D | VERIFIED | `VipSupportController` (`/api/v1/vip/support/cases*`) | Authenticated VIP buyer endpoints scoped to verified `wholesale_account` ownership. |
| Supplier Support Portal API | D | VERIFIED | `SupplierSupportController` (`/api/v1/supplier/support/cases*`) | Authenticated supplier endpoints scoped to verified `supplier_member` membership. |
| Admin Support Operations API | D | VERIFIED | `AdminSupportController` (`/api/v1/admin/support/*`) | Comprehensive admin endpoints guarded by `AdminPermissionGuard` for case triage, assignment, priority, status, notes, actions, queues, and metrics. |
| Whitelisted Cross-Domain Actions | D | VERIFIED | `support_case_action` & `SupportActionService` | Cross-domain resolutions recorded via explicit action references (`SHIPMENT_INVESTIGATION`, `REFUND_REQUEST`, `PAYMENT_RECONCILIATION`, etc.); Support never mutates foreign tables directly. |
| Legacy Cutover Foundation | D | VERIFIED | `LegacyCutoverAdapter` | Bidirectional adapters translating legacy wholesale tickets (`kv_wholesale_tickets`) and supplier disputes to canonical support cases and messages. |
| Granular Support RBAC | C, D | VERIFIED | `AdminPermissionGuard` & `admin_role_permission` | 10 new granular permissions (`support:case:view`, `support:case:reply`, `support:case:assign`, `support:case:priority`, `support:case:resolve`, `support:internal_note:create`, `support:attachment:view`, `support:sla:manage`, `support:report:view`, `support:sensitive:view`). |

---

## Commits & Remote CI Verification (all on `arena/01a0bac3-kolbevintage-services`)

| Stage | SHA | Message | CI run | Conclusion |
|---|---|---|---|---|
| Baseline | `3b97439` | `docs: complete phase 5.1 verification audit and exact SHA record` | 35532393969 | success |
| Checkpoint A | `b781444` | `feat(phase-5-2-a): add support case domain and lifecycle` | 35534093695 | success |
| Checkpoint B | `e8ecaeb` | `feat(phase-5-2-b): add support conversations participants and attachments` | 35534525804 | success |
| Checkpoint C | `13c7b57` | `feat(phase-5-2-c): add support assignment SLA and escalation operations` | 35534884299 | success |
| Checkpoint D | `614e2c5` | `feat(phase-5-2-d): add multi-portal support APIs and case operations` | 35566416150 | success |
| Final CI Record | `7a76c98` | `docs: record phase 5.2 report and verification audit` | 35567000543 | success |

---

## Test Totals (local & remote CI, PostgreSQL 55432, `NODE_ENV=test`)

| Workspace | Files | Passed | Skipped | Failed | Baseline (5.1) | Net Change |
|---|---|---|---|---|---|---|
| `@kolbe/shared` | 2 | 23 | 0 | 0 | 23 | 0 |
| `@kolbe/database` | 10 | 84 | 0 | 0 | 84 | 0 |
| `kolbe-next` | 13 | 125 | 0 | 0 | 125 | 0 |
| `apps/api` | 63 | 786 | 0 | 0 | 755 | +31 |
| **Total** | **88** | **1,018** | **0** | **0** | **987** | **+31** |

---

## Invariant Summary

1. **Single-Writer Domain Boundaries:** Support owns `support_case`, `support_case_status_history`, `support_case_priority_history`, `support_case_assignment_history`, `support_case_relation`, `support_message`, `support_internal_note`, `support_attachment`, `support_sla_policy`, `support_case_sla`, `support_case_escalation_history`, and `support_case_action`. Support never directly writes to Orders, Inventory, Fulfillment, Payments, Shipping, Settlement, Compliance, or CRM tables.
2. **Immutable Audit Trails:** All status transitions, priority shifts, team reassignments, and case escalations are stored in dedicated append-only history tables with actor attribution, timestamp, and business reasoning.
3. **Internal Note Isolation:** Internal notes are stored in a dedicated `support_internal_note` table and restricted strictly to admin personnel; endpoints for customers, VIP buyers, and suppliers never expose internal notes.
4. **SLA Invariance:** SLA targets are snapshotted into `support_case_sla` at case creation and remain immutable for the case's lifetime; subsequent updates or revisions to SLA policies do not alter historical case targets.
5. **Cross-Domain Safety:** All cross-domain resolutions happen via explicit whitelisted command adapters and are recorded in `support_case_action` with status tracking (`REQUESTED`, `IN_REVIEW`, `EXECUTED`, `REJECTED`).
6. **Zero Float Money Representation:** All monetary figures across support operations use `BIGINT` IRR integers internally and string serialization across HTTP contracts.

Phase 5.3 Notifications & Messaging Backend has NOT started.
