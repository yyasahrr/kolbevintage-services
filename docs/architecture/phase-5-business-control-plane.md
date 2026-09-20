# Phase 5.0 — Business Management & Admin Control Plane Foundation Architecture

**Status:** TECHNICAL ARCHITECTURE BASELINE  
**Branch:** `arena/01a0bac3-kolbevintage-services`  
**Date:** September 2026  
**Ownership:** `vip` & `admin` modules (coordinating with Core Domains)

---

## 1. Executive Summary & Purpose

Phase 5.0 establishes the authoritative **Business Management and Admin Control Plane Foundation** for the Kolbe Vintage multi-sided wholesale marketplace. 

Prior to Phase 5.0, several critical operational and commercial capabilities suffered from architectural friction:
1. **Plan & Membership Fragmentation:** Wholesale VIP plans were either represented by non-versioned flat rows (`vip_plan`) or mocked on the frontend (`VIP_PLANS` in `Wholesale.tsx` and `localStorage` in `wholesaleVipApi.ts`). Modifying plan pricing or terms risked altering past commitments or corrupting active subscriptions.
2. **Lack of Granular Admin RBAC:** Admin access relied almost entirely on coarse `@Roles("admin")` role checks on `account_user`, lacking fine-grained least-privilege permissions, segregation of duties, or audit attribution for sensitive operational commands.
3. **Absence of Maker/Checker Safety:** High-risk actions (e.g. manual membership activation, credit/plan overrides, business setting modifications) could be executed unilaterally without a two-person review rule.
4. **Scattered Configuration & Notes:** Business operational settings and internal CRM/operational notes lacked unified versioned schemas, schema validation, and tamper-resistant audit trails.
5. **Lack of Real-Time Wholesale Control Tower:** Operational visibility across requests, memberships, compliance holds, orders, and settlements required scattered queries without a consolidated, strictly authorized read-model projection.

Phase 5.0 resolves these challenges by introducing:
- A **versioned, immutable wholesale plan architecture** (`wholesale_plan`, `wholesale_plan_version`, `wholesale_plan_feature`, `wholesale_plan_limit`).
- A **comprehensive VIP membership lifecycle engine** with frozen feature/limit snapshots and a server-side entitlement resolver.
- An **Admin RBAC and Maker/Checker approval foundation** enforcing the two-person rule for high-risk operations.
- A **versioned Business Settings registry** and unified **Internal Admin Notes** subsystem.
- A **Wholesale Admin Control Tower** read service backed by 100% authoritative database queries.

---

## 2. Pre-Phase 5.0 Domain Audit & Gap Analysis

An exhaustive audit of the codebase across backend domains (`apps/api`), database schema (`packages/database`), and frontend applications (`frontend-next`) revealed the following domain baseline:

### 2.1 Existing VIP & Wholesale Account Domain
- `wholesale_account` (Phase 3 baseline): Stores buyer business profiles (`member_name`, `store_name`, `phone`, `city`, `plan_name`, `status`). Statuses: `pending`, `approved`, `rejected`, `suspended`, `expired`.
- `vip_plan` (Phase 3 baseline): Stores basic plan metadata (`name`, `slug`, `price`, `duration_days`, `features` jsonb, `limits` jsonb, `status`). Lacks versioning; updates overwrite existing data.
- `vip_subscription` (Phase 3 baseline): Links `user_id` to `vip_plan.id`. Statuses: `pending`, `active`, `expired`, `cancelled`.
- `wholesale_request` & `wholesale_request_revision` (Phases 3 & 4.4): Comprehensive wholesale RFQ/negotiation engine with single-writer invariants, price snapshots, and transition guards.
- **Frontend Divergence Found:** `frontend-next/storefront/pages/Wholesale.tsx` defines static plan definitions (`basic`, `pro`, `vip`), and `frontend-next/storefront/lib/wholesaleVipApi.ts` stores membership states into browser `localStorage` (`saveWholesaleMembership`). This violates the single source of truth rule. All authoritative business state must reside in PostgreSQL.

### 2.2 Domain Boundary & Invariant Audit
Across Phases 3 through 4.9.1, strict single-writer module ownership has been established:
- **Catalog (`catalog`):** Owns `brand`, `category`, `product`, `product_variant`, `product_media`, `product_variant_media`, `supplier_product_submission`.
- **Suppliers & Team (`suppliers`, `supplier-team`):** Owns `supplier`, `supplier_application`, `seller`, `supplier_permission_config`, `supplier_member`.
- **Offers & Pricing (`offers`, `pricing`):** Owns `seller_offer`, `offer_media`, `wholesale_package`, `wholesale_package_item`, `wholesale_pricing_tier`, `rfq`, `quote`.
- **Inventory (`inventory`):** Owns `product_variant_inventory`, `inventory_reservation`, `inventory_ledger`, `command_idempotency`.
- **Orders & Fulfillment (`orders`, `fulfillment`):** Owns `wholesale_order`, `wholesale_order_item`, `wholesale_order_request`, `purchase_order`, `purchase_order_item`, `order_status_history`, `order_event`, `fulfillment_exception`, `fulfillment_replacement_request`.
- **Payments & Invoicing (`payments`, `invoicing`):** Owns `wholesale_proforma`, `wholesale_proforma_line`, `payment`, `payment_allocation`, `order_financial_release`, `financial_ledger_entry`, `refund`, `refund_allocation`, `refund_line`, `payment_provider_event`, `commercial_invoice`, `commercial_invoice_line`, `fiscal_document`, `fiscal_submission_event`, `tax_configuration`.
- **Shipping (`shipping`):** Owns `shipping_quote`, `shipment`, `shipment_item`, `shipment_event`.
- **Compliance (`compliance`):** Owns 17 compliance and legal hold tables.
- **Settlement (`settlement`):** Owns 15 supplier financial ledger and payout tables.
- **Audit (`audit`):** Owns `audit_log` (append-only trigger protected).

**Architectural Rule for Phase 5.0:**
The Business Control Plane **configures and orchestrates**; it **MUST NOT** become a second writer for existing domain-owned tables. Changes to orders, payments, shipments, settlements, or compliance holds MUST continue to invoke the respective domain owner services.

---

## 3. Versioned Wholesale/VIP Plan Architecture

### 3.1 Separation of Plan Identity and Plan Version
A commercial plan has two distinct aspects:
1. **Plan Identity (`wholesale_plan`):** The persistent business entity (e.g. "همکار حرفه‌ای" / `pro`). It holds stable slugs, marketing descriptions, tier order, status (`draft`, `active`, `archived`), and a pointer to the currently published version.
2. **Plan Version (`wholesale_plan_version`):** The immutable commercial agreement specification. It defines version number (1, 2, 3...), billing duration, base membership fee, deposit requirement, publication metadata (`published_by`, `published_at`, `effective_from`, `effective_to`), and status (`draft`, `published`, `superseded`, `archived`).

```
 wholesale_plan (Identity)
   │
   ├── wholesale_plan_version (v1: published, superseded)
   │     ├── wholesale_plan_feature (matrix)
   │     └── wholesale_plan_limit (limits)
   │
   └── wholesale_plan_version (v2: active, published)
         ├── wholesale_plan_feature (matrix)
         └── wholesale_plan_limit (limits)
```

**Immutability Invariant:**
- Once a plan version is `published`, its fees, duration, features, and limits are **permanently frozen**.
- Any commercial change (e.g., fee adjustment, new limit, new feature flag) requires creating a new `draft` version and publishing it.
- Existing memberships remain anchored to their specific plan version until renewal, upgrade, or explicit migration.

### 3.2 Plan Feature Matrix (`wholesale_plan_feature`)
Features define qualitative entitlements granted by a plan. Each feature has:
- `feature_key`: Stable string identifier (e.g., `catalog.vip_pricing`, `order.rfq_access`, `support.dedicated_rep`, `shipping.free_standard`, `fulfillment.priority_queue`).
- `feature_type`: `boolean`, `limit`, or `config`.
- `is_enabled`: Boolean flag.
- `config_value`: Structured JSON configuration for complex entitlements (e.g. `{ "discount_pct": 35, "early_access_hours": 24 }`).

### 3.3 Plan Limits (`wholesale_plan_limit`)
Limits define quantitative commercial boundaries enforced at runtime:
- `limit_key`: Stable string identifier:
  - `min_order_amount`: Minimum Rial order total.
  - `max_order_amount`: Maximum single order total.
  - `max_monthly_order_amount`: Monthly spending cap.
  - `max_order_units`: Unit ceiling per order.
  - `max_team_members`: Seat count for wholesale buyer organization.
  - `max_shipping_addresses`: Registered delivery destinations.
  - `max_branches`: Authorized physical store branches.
  - `max_open_rfqs`: Concurrently open request for quotes.
- `limit_value`: `bigint` (Rial amounts or integer counts).
- `period`: `order`, `day`, `month`, `year`, `lifetime`.
- `is_enforced`: Boolean toggle allowing soft warning vs hard blocking.

---

## 4. VIP Membership Lifecycle & Entitlement Engine

### 4.1 Membership Entity & Historical Snapshots
The `wholesale_membership` table binds a `wholesale_account` to a `wholesale_plan` and `wholesale_plan_version`:
- `id`: Unique identifier (e.g., `wmem_...`).
- `account_id`: FK to `wholesale_account`.
- `plan_id` & `plan_version_id`: FKs to plan identity and version.
- `status`: `pending`, `active`, `suspended`, `expired`, `cancelled`, `scheduled_change`.
- `started_at`, `expires_at`: Validity window.
- `snapshot_features`: Complete JSON snapshot of active features frozen at the moment of activation.
- `snapshot_limits`: Complete JSON snapshot of active limits frozen at the moment of activation.
- `scheduled_plan_id` / `scheduled_plan_version_id`: Future plan target when a plan change is scheduled for the end of the billing term.
- `current_version`: Concurrency version token (optimistic locking).

### 4.2 Lifecycle Transitions
1. `activate`: Transitions `pending` -> `active`. Captures feature/limit snapshot, computes `expires_at` based on duration days.
2. `renew`: Extends `expires_at` from current expiry or now. If a scheduled plan change is queued, transitions to the new plan version and refreshes the snapshot.
3. `schedule_plan_change`: Queues a future upgrade or downgrade effective upon renewal.
4. `upgrade`: Immediate transition to higher-tier plan version. Recomputes snapshots and expiry.
5. `downgrade`: Immediate or end-of-term transition to lower-tier plan version.
6. `suspend`: Administrative suspension (`active` -> `suspended`) with mandatory reason recording.
7. `resume`: Reinstatement (`suspended` -> `active`).
8. `cancel`: Buyer or admin termination (`cancelled`).
9. `expire`: Automatic background sweep transition when `expires_at < now()`.

### 4.3 Server-Side Entitlement Resolver
The `EntitlementResolver` provides authoritative server-side checks:
- `hasFeature(accountId, featureKey)`: Evaluates whether the buyer's active membership provides the specified feature. Returns false if membership is missing, suspended, or expired.
- `getLimit(accountId, limitKey)`: Returns the numeric limit value and enforcement flag from the frozen membership snapshot.
- `assertCanPlaceOrder(accountId, orderTotal, totalUnits)`: Enforces `min_order_amount`, `max_order_amount`, and `max_order_units` before order creation.

---

## 5. Admin RBAC, Maker/Checker Workflows & Business Settings

### 5.1 Granular Operational RBAC
On top of NestJS `@Roles("admin")`, Phase 5.0 introduces fine-grained operational roles:
- `admin_role`: System and custom administrative roles (e.g., `super_admin`, `commercial_ops`, `compliance_officer`, `support_lead`, `finance_auditor`).
- `admin_role_permission`: Explicit mappings to `ADMIN_PERMISSION_ACTIONS`:
  - `wholesale:plan:view`, `wholesale:plan:manage`
  - `wholesale:membership:view`, `wholesale:membership:manage`, `wholesale:membership:override`
  - `wholesale:approval:view`, `wholesale:approval:create`, `wholesale:approval:decide`
  - `wholesale:settings:view`, `wholesale:settings:manage`
  - `wholesale:notes:view`, `wholesale:notes:create`
  - `wholesale:control_tower:view`
- `admin_user_role`: Assignment of users to administrative roles.

### 5.2 Constrained Maker/Checker Approval Engine
High-risk administrative operations require two-person verification:
- `approval_request`:
  - `request_type`: `MEMBERSHIP_OVERRIDE`, `MEMBERSHIP_PLAN_CHANGE`, `PLAN_VERSION_PUBLISH`, `BUSINESS_SETTING_CHANGE`, `MEMBERSHIP_MANUAL_ACTIVATE`, `MEMBERSHIP_TERMINATE`.
  - `target_type` & `target_id`: Affected entity.
  - `maker_id`: Admin user initiating the request.
  - `checker_id`: Admin user reviewing the request.
  - `status`: `pending`, `approved`, `rejected`, `executed`, `failed`, `cancelled`.
  - `payload`: Structured, deterministic parameters (strictly validated, no arbitrary code).
  - `idempotency_key`: Guarantees once-only execution.
- **Two-Person Rule Constraint:** Database-level constraint `CHECK (checker_id IS NULL OR checker_id != maker_id)`. The maker can never approve their own request.
- **Deterministic Dispatch:** Upon checker approval, the system dispatches the pre-validated command to the domain owner service.

### 5.3 Business Settings Registry
- `business_setting`: Versioned system configuration key-value store.
  - Categories: `wholesale`, `membership`, `operations`, `security`, `financial`.
  - Properties: `key`, `value` (jsonb), `value_type`, `description`, `is_secret`, `is_read_only`, `version`.
- `business_setting_history`: Append-only audit log tracking previous value, new value, actor, and change reason.

### 5.4 Internal Admin Notes
- `admin_internal_note`: Threaded, searchable internal operational notes across target domains:
  - Target types: `wholesale_account`, `wholesale_membership`, `wholesale_order`, `wholesale_request`, `supplier`.
  - Features: author attribution, pinned notes for critical flags, soft-archiving, structured metadata.

---

## 6. Wholesale Admin Control Tower Read Model

The Wholesale Admin Control Tower delivers real-time operational situational awareness:
1. **Authoritative Metric Aggregation:**
   - Active, pending, suspended, expired VIP memberships.
   - Pending wholesale RFQ requests and active negotiations.
   - Open commercial orders requiring fulfillment or payment action.
   - Active compliance holds and pending KYC/KYB reviews.
   - Zero hallucinated or fabricated metrics.
2. **Operational Queues:**
   - Maker/Checker pending approvals queue.
   - Expiring memberships queue (< 14 days to expiry).
   - Suspended accounts queue.
   - High-value buyer activity queue.
3. **Security & Data Protection:**
   - Enforced permission checks (`wholesale:control_tower:view`).
   - PII masking on operational queues (phone/email masked for low-privilege roles).
   - Strict pagination and cursor stability.
   - Comprehensive audit logging of all control tower queries.

---

## 7. Migration & Database Invariant Summary

- Migration: `0024_phase_5_business_control_plane.sql`
- All foreign keys enforce `ON DELETE RESTRICT`.
- All monetary amounts use `bigint` (Rial, 0 to `MAX_MONEY_RIAL` 1,000,000,000,000,000).
- Check constraints enforce enum sets across all state columns.
- Two-person rule enforced via DB `CHECK (checker_id IS NULL OR checker_id != maker_id)`.
- Existing migrations (0000–0023) and tables (0000 baseline through 0023 settlement) remain 100% untouched.
