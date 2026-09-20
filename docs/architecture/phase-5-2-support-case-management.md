# Phase 5.2 — Support / Ticket / Case Management Backend Architecture

## 1. Executive Summary & Context

Phase 5.2 builds the authoritative, unified Support, Ticket, and Case Management backend for KolbeVintage, replacing fragmented, split-brain, and mock persistence implementations across:
1. **VIP Support Center** (`frontend-kolbe/src/pages/VIPPortal.tsx`, `frontend-next/storefront/pages/VIPPortal.tsx` using `localStorage` key `kv_wholesale_tickets`).
2. **Wholesale Admin Support** (`frontend-kolbe/src/pages/WholesaleAdmin.tsx`, `frontend-next/storefront/pages/WholesaleAdmin.tsx` using `kv_wholesale_tickets` and legacy `/store/kolbe/admin/tickets`).
3. **Supplier Operations Portal** (`frontend-supplier/src/workflows.tsx`, `features.tsx`, `App.tsx` featuring messages, quality complaints, return issues `RI-xxxx`, and financial disputes `DP-xxxx`).
4. **Retail Customer Support** (authenticated consumer inquiries regarding orders, shipments, returns, and refunds).

The architecture introduces a unified case entity (`support_case`), conversation threads (`support_message`), isolated internal operational notes (`support_internal_note`), attachment security metadata (`support_attachment`), deterministic SLA policy versioning and clocks (`support_sla_policy`, `support_case_sla`), append-only escalation and status auditing (`support_case_escalation_history`, `support_case_status_history`), and safe cross-domain reference tracking (`support_case_relation`, `support_case_action`).

---

## 2. Frontend Audit & Legacy Persistence Analysis

### 2.1 VIP Portal Support Audit (`VIPPortal.tsx`)
In the legacy implementation, VIP members interacted with support through:
- **Form Submission**:
  - `subject`: text input
  - `category`: Persian strings (`سفارش`, `پرداخت`, `ارسال`, `مرجوعی`, `اشتراک`, `تولید اختصاصی`)
  - `priority`: Persian strings (`عادی` = Normal, `فوری` = Urgent)
  - `message`: multiline text input
- **Ticket Presentation**:
  - Generated tracking code: `TK-${Date.now().toString().slice(-6)}`
  - Ticket statuses: `باز` (Open), `پاسخ داده شده` (Answered), `بسته` (Closed)
  - Formatted creation date (`fa-IR`)
- **Issues Workspace** (`/vip/issues`):
  - Common issue classifications: `کسری کالا` (Missing item), `کالای اشتباه` (Wrong product), `آسیب‌دیدگی` (Damaged product), `مشکل سایز` (Size defect), `مشکل کیفیت` (Quality defect), `سایر` (Other)
- **Client-Side Persistence**:
  - `localStorage.getItem("kv_wholesale_tickets")` via helper functions `loadTickets()` and `saveTickets()`.
  - Stored purely on the local machine; lost on cache wipe or browser change; zero backend synchronization.

### 2.2 Wholesale Admin Support Audit (`WholesaleAdmin.tsx`)
In the admin wholesale dashboard, administrators interacted with tickets via:
- **Support Inbox Panel**:
  - Filter tabs: `همه` (All), `باز` (Open), `پاسخ داده شده` (Answered), `بسته` (Closed)
  - Urgent priority badge: `فوری`
  - Action buttons: `ثبت پاسخ` (Record reply), `بستن تیکت` (Close ticket)
- **KPI Metrics**:
  - Total open tickets counter (`openTickets`)
  - Urgent tickets list (`urgent`)
  - Operational action item queue (`actionCount`)
- **Hybrid Split-Brain Persistence**:
  - Loaded primarily from `kv_wholesale_tickets` in localStorage.
  - If backend configured, attempted to merge from legacy `/store/kolbe/admin/tickets` reading the old single-table `support_ticket`.
  - State changes in the UI updated `localStorage` immediately, creating a split-brain between local state and backend databases.

### 2.3 Supplier Operations Portal Audit (`frontend-supplier`)
The supplier portal features multiple communication and dispute workflows:
- **Messages** (`frontend-supplier/src/workflows.tsx`):
  - Thread list categorized by department (`تیم خرید کلبه` / Purchasing, `کنترل کیفیت` / QC, `مالی کلبه` / Finance).
  - Unread indicators, timestamps, message previews.
- **Returns & Operational Issues** (`ReturnsIssues` in `workflows.tsx`):
  - Issue ID tracking (`RI-0891`, `RI-0887`).
  - Related purchase order link (`PO-4813`).
  - Issue categories: `کسری کالا` (Missing item), `کالای اشتباه` (Wrong product), `آسیب‌دیدگی` (Damaged product).
  - Item quantities and progression status (`در بررسی` / Under review, `برطرف شد` / Resolved).
- **Dispute Center** (`DisputeCenter` in `features.tsx`):
  - Financial disputes tracking (`DP-001`, `DP-002`).
  - Subjects, claimed monetary amounts (IRR/Toman), dispute types (`settlement` / تسویه, `penalty` / جریمه, `deduction` / کسورات).
  - Resolution stages (`open` / ثبت‌شده -> `under_review` / در بررسی -> `escalated` / ارجاع به مدیر -> `resolved` / حل‌شده).
  - Stored in `localStorage.getItem("kv_disputes")`.

---

## 3. Strict Domain Ownership & Anti-Corruption Boundaries

The Support domain is a relationship, case coordination, and service workflow engine. It strictly observes the following single-writer rules:

### 3.1 What Support Owns
1. **Support Cases** (`support_case`): Core lifecycle, tracking codes, categories, priorities, assignments, SLA timestamps.
2. **Case Conversation & Messages** (`support_message`): Visible message threads between customers, suppliers, admins, and system events.
3. **Internal Operational Notes** (`support_internal_note`): Confidential admin/staff notes isolated completely from external requesters.
4. **Attachments Metadata & Access Control** (`support_attachment`): File metadata, ownership references, MIME validation, quarantine status.
5. **Assignment & Escalation Audits** (`support_case_assignment_history`, `support_case_escalation_history`, `support_case_status_history`).
6. **SLA Policies & Tracking Clocks** (`support_sla_policy`, `support_case_sla`): Versioned SLA targets and calculated breach states.
7. **Cross-Domain Relations & Action Requests** (`support_case_relation`, `support_case_action`).

### 3.2 What Support Does NOT Own (Never Second Writer)
- **Orders**: Support cannot edit order status, order items, or order financial totals in `retail_order` or `wholesale_order`.
- **Payments & Refunds**: Support cannot directly insert or modify rows in `payment`, `refund`, or `financial_ledger_entry`.
- **Settlement & Payouts**: Support cannot alter balances in `settlement_account`, post to `settlement_journal`, or trigger payouts in `payout`. Financial dispute cases reference settlement batches or adjustments; any monetary action must be executed by the Settlement engine.
- **Inventory & Fulfillment**: Support cannot manipulate stock on hand or cancel reservations in `product_variant_inventory`.
- **Auth & Account Users**: Support references requester IDs but cannot alter credentials or roles in `account_user`.
- **VIP Memberships**: Support cannot alter tier or expiration in `wholesale_membership`.

### 3.3 The Action Request Pattern (`support_case_action`)
When a support resolution requires domain mutations (e.g., initiating a return refund, requesting shipment trace, opening a settlement dispute), Support creates a strictly typed `support_case_action` record. Authorized administrators or automated domain handlers process the action through the target domain's canonical command handler.

---

## 4. Domain Data Model & State Machines

### 4.1 Requester Model
Support cases originate from four distinct caller contexts, determined strictly by authenticated server-side credentials (never client-supplied IDs):
1. `RETAIL_CUSTOMER`: Authenticated retail customer with valid user session (`requester_user_id`).
2. `VIP_BUYER`: Authenticated wholesale buyer associated with an active wholesale account (`wholesale_account_id`).
3. `SUPPLIER`: Authenticated supplier team member associated with an approved supplier (`supplier_id`).
4. `ADMIN_CREATED`: Support case opened manually by an administrator on behalf of a customer or partner.

### 4.2 Categories & Priorities
- **Categories**: Stable English domain keys:
  `ORDER`, `PAYMENT`, `SHIPPING`, `RETURN`, `REFUND`, `MEMBERSHIP`, `WHOLESALE`, `SUPPLIER`, `PRODUCT`, `QUALITY`, `CUSTOM_PRODUCTION`, `FINANCE`, `SETTLEMENT`, `ACCOUNT`, `OTHER`.
- **Priorities**:
  `LOW`, `NORMAL`, `HIGH`, `URGENT`.
  - UI mapping: Persian `عادی` -> `NORMAL`, `فوری` -> `URGENT`.
  - Priority changes are audited in `support_case_priority_history`.

### 4.3 Case Lifecycle State Machine
Explicit state machine:
- `OPEN`: Case created and awaiting agent initial triage or first response.
- `IN_PROGRESS`: Agent actively working on resolution or domain investigation.
- `WAITING_FOR_CUSTOMER`: Agent has replied; awaiting requester input, clarification, or evidence.
- `WAITING_FOR_INTERNAL`: Case blocked on internal operations, supplier confirmation, or warehouse inspection.
- `RESOLVED`: Agent provided definitive resolution; requester may confirm or reopen.
- `CLOSED`: Final administrative closure.

**Permitted Transitions**:
- `OPEN` -> `IN_PROGRESS`, `WAITING_FOR_CUSTOMER`, `WAITING_FOR_INTERNAL`, `RESOLVED`, `CLOSED`
- `IN_PROGRESS` -> `WAITING_FOR_CUSTOMER`, `WAITING_FOR_INTERNAL`, `RESOLVED`, `CLOSED`
- `WAITING_FOR_CUSTOMER` -> `IN_PROGRESS`, `OPEN`, `RESOLVED`, `CLOSED`
- `WAITING_FOR_INTERNAL` -> `IN_PROGRESS`, `WAITING_FOR_CUSTOMER`, `RESOLVED`, `CLOSED`
- `RESOLVED` -> `CLOSED`, `OPEN` (Reopen)
- `CLOSED` -> `OPEN` (Reopen under defined policy)

Every status transition creates an immutable row in `support_case_status_history`.

### 4.4 Public Tracking Reference
Every case receives a unique, human-friendly, non-sequential reference code:
- Format: `SUP-` + 8 uppercase alphanumeric characters (e.g., `SUP-7K9W2M4X`).
- Stored in `public_reference` with a database `UNIQUE` constraint.

---

## 5. Conversation, Participants, Internal Notes & Attachments

### 5.1 Conversation Threading (`support_message`)
- Author types: `CUSTOMER`, `VIP_BUYER`, `SUPPLIER`, `ADMIN`, `SYSTEM`.
- Message body is immutable once posted.
- Visibility: `PUBLIC` (visible to requester) or `INTERNAL` (staff-only system notices).

### 5.2 Internal Operational Notes (`support_internal_note`)
- Isolated from customer-facing messages.
- Stored with `author_admin_id`, `author_display_name`, `body`, and `is_pinned` flag.
- Never returned in client/VIP/supplier portal queries.

### 5.3 Attachment Security (`support_attachment`)
- Attachments store metadata only (`object_key`, `original_filename`, `content_type`, `size_bytes`, `uploader_id`, `scan_status`).
- Strict validation:
  - Max file size: 15 MB.
  - MIME type allowlist: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.
  - File extension matching content type.
- Quarantine flag: `PENDING_SCAN` by default; files marked `REJECTED` are inaccessible.

---

## 6. Assignment, SLA Engine & Operational Queues

### 6.1 Assignment & Teams
- Assignment fields on `support_case`: `assigned_admin_id`, `assigned_team_key`.
- Team keys: `RETAIL_SUPPORT`, `VIP_SUPPORT`, `SUPPLIER_OPERATIONS`, `PAYMENTS`, `SHIPPING`, `FINANCE`, `COMPLIANCE`, `QUALITY`.
- Reassignments are tracked append-only in `support_case_assignment_history`.

### 6.2 Versioned SLA Policy & Snapshot
- SLA policies (`support_sla_policy`) define `first_response_target_minutes` and `resolution_target_minutes` based on `requester_type`, `category`, and `priority`.
- When a case is opened, applicable targets are snapshotted into `support_case_sla` with the active policy version.
- Future SLA policy updates **never** retroactively modify existing case SLA snapshots.

### 6.3 SLA Clocks & Factual Breach Calculation
- Clocks tracked: `opened_at`, `first_response_due_at`, `first_response_at`, `resolution_due_at`, `resolved_at`.
- First response is recorded only when a visible `ADMIN` or `SYSTEM` message is sent to the customer (internal notes do not satisfy first response).
- Breaches are calculated dynamically based on real timestamps:
  - First response breach: `first_response_at > first_response_due_at` OR (`first_response_at IS NULL AND now() > first_response_due_at`).
  - Resolution breach: `resolved_at > resolution_due_at` OR (`resolved_at IS NULL AND now() > resolution_due_at`).

### 6.4 Operational Queues
The support control plane provides factual database-backed queues:
1. `unassigned`: Open/in-progress cases with `assigned_admin_id IS NULL`.
2. `my_open`: Cases assigned to the requesting admin.
3. `urgent`: Cases with `priority = 'URGENT'` and active status.
4. `first_response_breached`: Active cases past first response target.
5. `resolution_breached`: Active cases past resolution target.
6. `waiting_customer`: Cases in `WAITING_FOR_CUSTOMER` status.
7. `waiting_internal`: Cases in `WAITING_FOR_INTERNAL` status.
8. `recently_resolved`: Cases resolved in the last 7 days.

---

## 7. Feature Parity & No-Regression Matrix

| Existing Feature (UI / LocalStorage) | Legacy Location | New Backend Capability | Disposition | Lost Features |
|---|---|---|---|---|
| VIP Ticket Creation | `VIPPortal.tsx` / `kv_wholesale_tickets` | `POST /api/v1/vip/support/cases` | UPGRADE (Persisted in PG, verified account link) | 0 |
| VIP Tracking Code (`TK-xxxxxx`) | `VIPPortal.tsx` | Unique `public_reference` (`SUP-XXXXXXXX`) | UPGRADE (Crypto-random, clash-safe) | 0 |
| VIP Priority (`عادی` / `فوری`) | `VIPPortal.tsx` | `priority: 'NORMAL' \| 'URGENT'` | UPGRADE (Audited priority history) | 0 |
| VIP Categories (`سفارش`, `ارسال`, etc.) | `VIPPortal.tsx` | Standard English enum keys | UPGRADE (Normalized enum) | 0 |
| VIP Ticket History & Statuses | `VIPPortal.tsx` | `GET /api/v1/vip/support/cases` | UPGRADE (Real-time DB query, IDOR protected) | 0 |
| Wholesale Admin Ticket Inbox | `WholesaleAdmin.tsx` | `GET /api/v1/admin/support/cases` | UPGRADE (Server-side pagination, search, filters) | 0 |
| Wholesale Admin Status Change | `WholesaleAdmin.tsx` | `PATCH /api/v1/admin/support/cases/:id/status` | UPGRADE (Audit trail, state machine validation) | 0 |
| Wholesale Admin Reply | `WholesaleAdmin.tsx` | `POST /api/v1/admin/support/cases/:id/messages` | UPGRADE (Threaded conversation, SLA clock stop) | 0 |
| Wholesale Admin Urgent Filter | `WholesaleAdmin.tsx` | `GET /api/v1/admin/support/queues/urgent` | UPGRADE (Factual SQL query, zero synthetic metrics) | 0 |
| Supplier Messages (`Messages`) | `frontend-supplier` | `GET/POST /api/v1/supplier/support/cases` | UPGRADE (Threaded messaging with Kolbe teams) | 0 |
| Supplier Returns/Issues (`RI-xxxx`) | `frontend-supplier` | Support Case with Category `RETURN` & Order Relation | UPGRADE (Exact relation to PO, item, and qty) | 0 |
| Supplier Financial Disputes (`DP-xxxx`) | `frontend-supplier` | Support Case with Category `FINANCE` & Settlement Relation | UPGRADE (Safe reference without direct settlement mutation) | 0 |
| Supplier Quality Documents & Samples | `frontend-supplier` | `support_attachment` metadata with MIME validation | UPGRADE (Controlled upload, quarantine safety) | 0 |

**Total Lost Capabilities:** **0**.

---

## 8. Cutover & Legacy Data Mapping

When frontend integration occurs in future phases, client code will transition from `kv_wholesale_tickets` and legacy endpoints using the following field mappings:

| Legacy Client Field | Legacy Meaning | New Support Schema Field | Type / Notes |
|---|---|---|---|
| `ticket.id` | Client-generated string | `support_case.public_reference` | `SUP-XXXXXXXX` tracking code |
| `ticket.customerId` | Client phone or "supplier" | `support_case.requester_user_id` / `wholesale_account_id` | Server-authenticated identity |
| `ticket.subject` | Ticket subject | `support_case.subject` | `text NOT NULL` |
| `ticket.category` | Persian category label | `support_case.category` | Stable English category key |
| `ticket.message` | Initial message text | `support_message.body` | Initial conversation message |
| `ticket.status` | `باز` / `پاسخ داده شده` / `بسته` | `support_case.status` | `OPEN`, `WAITING_FOR_CUSTOMER`, `CLOSED` |
| `ticket.priority` | `عادی` / `فوری` | `support_case.priority` | `NORMAL`, `URGENT` |
| `ticket.createdAt` | `fa-IR` date string | `support_case.created_at` | ISO 8601 UTC timestamp |

---

## 9. Granular RBAC Permissions

Admin operations are protected using Phase 5.0 `AdminPermissionGuard` with new granular support permissions:
- `support:case:view`: View support cases, queues, and conversation threads.
- `support:case:reply`: Post public replies to requesters.
- `support:case:assign`: Reassign case owner or team.
- `support:case:priority`: Change case priority.
- `support:case:resolve`: Resolve or close cases.
- `support:internal_note:create`: Add confidential internal notes.
- `support:attachment:view`: Access and download case attachments.
- `support:sla:manage`: Create and update SLA policy definitions.
- `support:report:view`: View support control tower and SLA performance reports.
- `support:sensitive:view`: View customer privacy/dispute sensitive data.
