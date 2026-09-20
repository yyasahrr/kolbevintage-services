# Phase 5.1 — CRM & Customer Operations Backend Architecture

## 1. Executive Summary & Context

Phase 5.1 implements the authoritative CRM & Customer Operations backend for KolbeVintage, replacing transient client-side persistence (`kv_admin_crm_v1`, `kv_admin_crm_v2` in localStorage) with a strictly modeled, single-writer compliant, multi-domain integrated architecture.

The frontend CRM interface (located in `frontend-kolbe/src/pages/AdminCRM.tsx` and `frontend-next/storefront/pages/AdminCRM.tsx`) provides commercial staff with:
- Overview metrics (total customers, recorded value, open follow-up tasks, loyal customers, pipeline distribution).
- Customer directory with search, filtering, and stage management.
- Stage-based pipeline view ("قیف ارتباط").
- Follow-up task board ("پیگیری‌ها") with due tracking and status progression.
- Customer 360 drawer ("پروفایل ۳۶۰") containing contact details, lifecycle stage, assigned sales representative, customer interaction timeline (calls, notes, messages), follow-up actions, order summary, and marketing consent state.

Phase 5.1 builds the backend truth for every single one of these capabilities without reducing or breaking existing frontend contracts, while rigorously enforcing domain ownership boundaries.

---

## 2. Frontend Audit & Legacy Storage Analysis

### 2.1 Legacy Schema in `AdminCRM.tsx`
The legacy client-side implementation persisted data under `kv_admin_crm_v1` (with an evolution to `kv_admin_crm_v2` in Next.js storefront):

```typescript
type Stage = "سرنخ" | "در تماس" | "مذاکره" | "مشتری فعال" | "وفادار" | "ریزش";
type Activity = { id: string; type: "یادداشت" | "تماس" | "پیام" | "خرید"; text: string; at: string };
type Task = { id: string; title: string; due: string; status: "todo" | "doing" | "done"; priority: "low" | "medium" | "high"; owner: string };
type CRMCustomer = {
  name: string;
  phone: string;
  email: string;
  city: string;
  orders: number;
  total: number;
  lastOrder: string;
  stage: Stage;
  owner: string;
  tags: string[];
  consent: boolean;
  activities: Activity[];
  tasks: Task[];
  birthday?: string;
  lastOrderDays?: number;
  favoriteStyles?: string[];
  abandonedCarts?: number;
  vip?: VipProfile;
};
```

### 2.2 Shortcomings of Legacy Persistence
1. **Unauthoritative Commerce Metrics**: `orders`, `total`, and `lastOrder` were stored directly in the client-side customer record, becoming stale or fabricated whenever orders were updated, cancelled, or refunded in the backend.
2. **Identity Ambiguity**: Customers were identified solely by Persian-formatted phone numbers (`selectedPhone`) without distinguishing between registered retail accounts (`account_user`), wholesale/VIP accounts (`wholesale_account`), and unregistered commercial leads.
3. **No Audit Trails**: Stage transitions, representative reassignments, and task completions mutated JSON in place with zero historical record of who made the change or why.
4. **Fictitious Consent**: `consent: boolean` was toggled without legal notice reference, timestamp, or integration with the canonical `compliance` domain.
5. **Loss of Data on Device Clear**: All CRM data was restricted to the browser executing the session.

---

## 3. Strict Domain Ownership Boundaries

CRM does **not** own everything about a customer. The authoritative boundaries remain strictly enforced:

| Domain | Canonical Tables Owned | CRM Relationship |
|---|---|---|
| **Auth** | `account_user`, `user_session`, `login_attempt` | Identity authority. CRM references `account_user.id` via `crm_contact_identity_link`. CRM **never** duplicates passwords, email verifications, or auth credentials. |
| **Orders** | `wholesale_order`, `wholesale_order_item`, `retail_order`, `retail_order_item` | Order history & financial values. CRM **never** writes to order tables or stores mutable copies of order counts or spend. All order metrics in Customer 360 are **derived on read**. |
| **Payments** | `payment_transaction`, `offline_payment_evidence` | Payment truth. CRM reads financial execution status via Orders/Payments composition. |
| **Shipping** | `shipment`, `shipment_item`, `shipment_event` | Delivery and tracking truth. |
| **VIP** | `wholesale_account`, `wholesale_membership`, `wholesale_plan` | Wholesale membership truth. CRM displays membership tier and status by querying the VIP domain. |
| **Compliance** | `consent_event`, `legal_policy_document` | Marketing and regulatory consent. CRM reads `compliance.getConsentState(userId)` and **never** invents or defaults consent to true. |
| **Settlement** | `supplier_settlement_ledger` | Supplier financial settlements only. Completely out of scope for CRM. |
| **Audit** | `audit_log` | Central immutable operational audit logs. All CRM mutations write audit events. |
| **CRM (New)** | `crm_contact`, `crm_contact_identity_link`, `crm_stage_history`, `crm_assignment_history`, `crm_tag`, `crm_contact_tag`, `crm_activity`, `crm_task` | CRM contact profiles, leads, stage workflows, admin assignments, tags, activity timeline, follow-up tasks, and composed Customer 360 read models. |

---

## 4. CRM Domain Models & Invariants

### 4.1 CRM Contact & Identity Linking
A CRM contact (`crm_contact`) represents a relationship subject:
- May be an unregistered **Lead** (e.g. walk-in customer, phone inquiry, business card).
- May be linked to a registered retail customer (`account_user`).
- May be linked to a wholesale/VIP account (`wholesale_account`).

Identity linking (`crm_contact_identity_link`):
- A registered `account_user` can be linked to at most **one** `crm_contact` (enforced by unique index on `user_id`).
- When a customer registers later with the same phone or email, an explicit linking operation links the account to the existing lead history without destructive data loss.

### 4.2 Stable Lifecycle Stages
CRM stages are represented using stable, language-agnostic uppercase keys:
- `LEAD`: New prospect or inquiry.
- `CONTACTED`: Initial contact made by sales/support.
- `NEGOTIATION`: Active commercial or product discussion.
- `ACTIVE_CUSTOMER`: Customer with completed purchase history.
- `LOYAL`: Repeated high-satisfaction or VIP customer.
- `CHURNED`: Inactive customer or cancelled relationship.

Stage transitions are recorded immutably in `crm_stage_history`:
- `from_stage`, `to_stage`, `actor_id`, `reason`, `source` (`manual`, `system_rule`, `import`).
- Historical stage transitions are never rewritten.

### 4.3 Admin Assignment & Ownership
- Represents the sales or support representative responsible for the account.
- Replaces free-form strings with authoritative foreign keys to `account_user.id` (where role is `admin`).
- Unassigned state is explicitly supported (`assigned_admin_id IS NULL`).
- All reassignments record an immutable row in `crm_assignment_history` (`from_admin_id`, `to_admin_id`, `assigned_by`, `reason`).

### 4.4 Flexible Managed Tags
Admin-managed tags replace static strings:
- `crm_tag`: `key` (normalized lowercase slug), `label` (Persian display name), `color`, `is_active`.
- `crm_contact_tag`: Many-to-many junction with unique constraint `(contact_id, tag_id)`.
- Prevents duplicate tag assignments.

### 4.5 Activity Timeline
Captures touchpoints with the customer:
- Types: `NOTE`, `CALL`, `MESSAGE`, `EMAIL`, `MEETING`, `SYSTEM`.
- Sources: `MANUAL_ACTIVITY` (entered by agent), `SYSTEM_EVENT` (e.g. order placed, membership renewed), `PROVIDER_EVENT` (verified provider callback).
- Immutability: Activities are append-only. No silent edits.

### 4.6 Follow-Up Tasks
Structured task management for commercial follow-up:
- Statuses: `OPEN`, `IN_PROGRESS`, `DONE`, `CANCELLED`.
- Priority: `low`, `medium`, `high`, `urgent`.
- Fields: `title`, `description`, `assignee_id`, `due_at`, `completed_at`, `completed_by`.
- Queues: My open tasks, overdue tasks, due today, due soon, unassigned.

---

## 5. Authoritative Customer 360 Composed Read Model

The Customer 360 model aggregates data across canonical domain boundaries at request time without persisting mutable copies:

```
                          ┌────────────────────────┐
                          │   CRM Contact & Tags   │
                          │      (crm_contact)     │
                          └───────────┬────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
    ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
    │  Auth & Identity  │   │   Orders Domain   │   │ Compliance Domain │
    │   (account_user)  │   │(wholesale & retail│   │  (consent_event)  │
    └───────────────────┘   │      orders)      │   └───────────────────┘
                            └─────────┬─────────┘
                                      ▼
                            ┌───────────────────┐
                            │    VIP Domain     │
                            │   (memberships)   │
                            └───────────────────┘
```

### Commerce Metrics Formula
- **Total Orders**: Count of non-draft orders where buyer ID matches linked account.
- **Completed Orders**: Orders in final completed/delivered states.
- **Cancelled Orders**: Orders in cancelled/rejected states.
- **Gross Purchased (IRR)**: Sum of `grand_total` for all valid completed/processing orders (`BIGINT`).
- **Refunded Amount (IRR)**: Sum of refunded items/credits attributed to customer orders (`BIGINT`).
- **Net Recognized Spend (IRR)**: `Gross Purchased - Refunded Amount` (`BIGINT`).
- Over HTTP API, all `BIGINT` amounts are serialized as clean integer strings (e.g. `"24500000"`).

### Consent Integrity
- Read directly from `ComplianceService.getConsentState(userId)` when account is linked.
- If not linked, marketing consent is strictly `false`.
- Marketing consent is **never** defaulted to `true`.

---

## 6. No-Feature-Regression Matrix

| Legacy UI Feature | Current UI Source | Backend Phase 5.1 Replacement | Status |
|---|---|---|---|
| Customer Directory | `localStorage[kv_admin_crm_v1]` | `GET /api/v1/admin/crm/customers` (paginated, filtered, searched) | PRESERVED & ENHANCED |
| Search (Name, Phone, City, Tags) | In-memory JS `.filter()` | Database-indexed parameterized search (`searchDirectory`) | PRESERVED & ENHANCED |
| Pipeline Counts | In-memory JS count | `GET /api/v1/admin/crm/pipeline` (authoritative SQL group by stage) | PRESERVED & ENHANCED |
| Customer 360 Drawer | Local object lookup | `GET /api/v1/admin/crm/customers/:id/360` (composed read model) | PRESERVED & ENHANCED |
| Stage Change | Local object mutation | `PATCH /api/v1/admin/crm/customers/:id/stage` + `crm_stage_history` | PRESERVED & ENHANCED |
| Owner Assignment | Free-form text input | `PATCH /api/v1/admin/crm/customers/:id/assignment` + `crm_assignment_history` | PRESERVED & ENHANCED |
| Tag Assignment | String array mutation | `POST/DELETE /api/v1/admin/crm/customers/:id/tags/:tagId` | PRESERVED & ENHANCED |
| Activity Timeline | In-memory activities array | `GET/POST /api/v1/admin/crm/customers/:id/activities` (`crm_activity`) | PRESERVED & ENHANCED |
| Follow-Up Tasks | In-memory tasks array | `GET/POST/PATCH /api/v1/admin/crm/tasks` (`crm_task` state machine) | PRESERVED & ENHANCED |
| Task Kanban / Columns | In-memory status filter | `GET /api/v1/admin/crm/tasks/queue` (`OPEN`, `IN_PROGRESS`, `DONE`) | PRESERVED & ENHANCED |
| Order Count & Total Value | Hardcoded in customer item | Derived dynamically from authoritative `wholesale_order` & `retail_order` | PRESERVED & ENHANCED |
| Consent Checkbox | Mutable local boolean | Live query to `ComplianceService` consent state (audit-backed) | PRESERVED & ENHANCED |
| New Customer Lead | In-memory prompt modal | `POST /api/v1/admin/crm/customers` (creates verified `crm_contact`) | PRESERVED & ENHANCED |
| VIP Profile Details | Local mockup | Composed from `WholesaleMembershipService` live active plan snapshot | PRESERVED & ENHANCED |

**Feature Loss**: **0%** (zero loss, full authoritative preservation).
