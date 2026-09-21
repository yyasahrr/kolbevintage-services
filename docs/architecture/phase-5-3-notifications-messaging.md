# Phase 5.3 — Notifications & Messaging Backend Architecture

## 1. Executive Summary & Context

Phase 5.3 establishes the authoritative, enterprise Notifications & Messaging backend for KolbeVintage, delivering multi-channel communication orchestration across:
1. **Retail Customers** (order updates, shipping notices, payment confirmations, refund alerts, in-app notifications).
2. **VIP / Wholesale Buyers** (membership status, plan expiration reminders, proforma releases, order confirmations).
3. **Suppliers** (purchase order creation, SLA breach warnings, quality escalations, settlement releases, withdrawal updates).
4. **Administrators** (security alerts, approval requests, high-value transaction alerts, control tower notifications).

Supported channels in Phase 5.3:
- **`IN_APP`**: Real, authenticated recipient in-app notification inbox with read/unread tracking, server-side pagination, and archiving.
- **`EMAIL`**: Transactional and service emails via safe provider abstraction, CRLF header sanitization, and structured templates.
- **`SMS`**: Iranian mobile number normalization, template rendering, and safe provider abstraction.
- **`PUSH`**: Schema-modeled for forward compatibility, explicitly marked `NOT_IMPLEMENTED` in provider layer.

This architecture strictly adheres to single-writer boundaries:
- **Support Conversations** (Phase 5.2): Human case conversations, internal notes, agent assignment, and SLA tracking belong exclusively to the `Support` domain (`support_case`, `support_message`).
- **Notifications & Messaging** (Phase 5.3): Event-driven alerts, outbox orchestration, versioned templates, delivery attempts, recipient preferences, provider receipts, and in-app inboxes belong exclusively to the `Notifications` domain.
- **Business Domains**: Orders, Payments, Shipping, Settlement, and VIP Membership emit events to Notifications; failures in notification delivery never cause rollback or corruption in the originating business domain.

---

## 2. Frontend Audit & Legacy State Analysis

### 2.1 Messaging Automation Center (`frontend-next/storefront/pages/MessagingAutomationCenter.tsx`)
The existing storefront administrative UI contains a functional mock prototype with 4 tabs:
1. **`templates` (متن پیامک‌ها)**:
   - SMS template library with default triggers:
     - `birthday_offer` ("تبریک تولد", trigger: "روز تولد شمسی")
     - `winback` ("بازگشت مشتری", trigger: "۹۰ روز بدون خرید")
     - `cart_recovery` ("سبد رهاشده", trigger: "۲ ساعت پس از رهاشدن سبد")
     - `vip_drop` ("پیش‌فروش VIP", trigger: "شروع کالکشن عمده")
   - Template editor: name, trigger description, multiline body, variable buttons (`{{name}}`, `{{discount_code}}`, `{{expires_at}}`, `{{product_name}}`, `{{link}}`), automation active checkbox, live preview badge.
   - Persistence: `localStorage.getItem("kv_sms_templates_v1")`.
2. **`automation` (اتوماسیون‌ها)**:
   - List of triggers with enabled/disabled switches.
   - Persistence: updates `kv_sms_templates_v1`.
3. **`outbox` (صف ارسال)**:
   - Table displaying recipient name, phone, template/kind, status ("در صف" / "ارسال‌شده"), Persian datetime, and manual "ثبت ارسال" button.
   - Persistence: `localStorage.getItem("kv_marketing_outbox_v1")`.
4. **`provider` (اتصال درگاه)**:
   - Provider selection: `کاوه‌نگار`, `ملی پیامک`, `SMS.ir`, `سرویس اختصاصی`.
   - Sender number input (`sender`).
   - Secret API key password input (`apiKey`).
   - Webhook URL input (`webhook`).
   - Persistence: `localStorage.getItem("kv_sms_provider_v1")`.

**Security & Architectural Findings:**
- In the legacy prototype, the provider `apiKey` was stored in plaintext in the browser's `localStorage` and used directly on the client.
- The "ثبت ارسال" button mutated outbox status directly to "sent" without server-side delivery validation or provider receipts.
- Templates lacked versioning, schema validation, and safe variable whitelisting.

### 2.2 Supplier Notification Preferences (`frontend-supplier/src/features.tsx`)
The supplier portal implements event-specific multi-channel preferences:
- Events:
  - `newOrder` (سفارش جدید)
  - `slaWarning` (هشدار SLA)
  - `settlement` (تسویه مالی)
  - `quality` (کیفیت)
  - `campaign` (کمپین)
- Channels:
  - `panel` (پنل / In-App)
  - `sms` (پیامک)
  - `email` (ایمیل)
- Persistence: `localStorage.getItem("kv_supplier_notif_prefs")`.

### 2.3 Supplier Messages Capability (`frontend-supplier/src/workflows.tsx`)
The supplier portal displays a `Messages` component with thread previews:
- Threads:
  - `t1`: "تیم خرید کلبه" ("PO-4813 — تأخیر در ارسال؟")
  - `t2`: "کنترل کیفیت" ("نمونه جدید تأیید شد")
  - `t3`: "مالی کلبه" ("صورت‌حساب مرداد ارسال شد")
- **Boundary Classification**:
  1. Threads regarding PO issues, quality disputes, or settlement inquiries belong to **Phase 5.2 Support** cases (`support_case`).
  2. Transactional alerts (PO created, payment released, sample approved) belong to **Phase 5.3 Notifications**.
  3. Direct supplier-to-team chat without a formal support case or notification event is **explicitly deferred** to avoid duplicate conversational engines.

### 2.4 Admin System Center & Retail Policy Center
- `frontend-kolbe/src/pages/AdminOperations.tsx`: `SystemCenter` toggles `notifications` boolean in `kv_admin_system` and displays mock recent notifications.
- `frontend-kolbe/src/pages/RetailPolicyCenter.tsx`: `notificationPriority` ("عادی و فوری") setting.

---

## 3. Support vs. Notifications vs. Direct Messaging Boundaries

To prevent architectural drift and god-modules, clear boundaries are enforced:

| Dimension | Support Domain (Phase 5.2) | Notifications Domain (Phase 5.3) | Direct Messaging (Deferred) |
|---|---|---|---|
| **Primary Intent** | Human dispute resolution, issue triage, inquiry handling | Asynchronous system events, transactional alerts, user digests | Synchronous 1:1 supplier-buyer or buyer-agent chat |
| **Data Model** | `support_case`, `support_message`, `support_internal_note` | `notification_event`, `notification_delivery`, `in_app_notification` | Deferred |
| **Trigger Source** | User or agent manual submission | Business domain event firing via internal event dispatcher | Real-time websocket or chat session |
| **Recipients** | Case participants (customer, VIP, supplier, assigned agents) | Dynamic recipient resolution based on event payload and preferences | Active participants in room |
| **Delivery Mechanism** | Portal poll/view or support ticket API | Outbox worker pushing to Email, SMS, or In-App Inbox | Real-time socket stream |
| **Internal Notes** | Isolated `support_internal_note` table | Not applicable (never created or converted to notifications) | Not applicable |

---

## 4. Notification Event Catalog & Source Domains

Authoritative event keys are uppercase English identifiers. Persian labels are presentation concerns handled by templates.

| Event Key | Source Domain | Source Entity | Default Category | Recipient Scope |
|---|---|---|---|---|
| `AUTH_SECURITY_ALERT` | `auth` | `account_user` | `SECURITY` | `ACCOUNT_USER` |
| `ORDER_CREATED` | `orders` | `retail_order` / `wholesale_order` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` |
| `ORDER_CONFIRMED` | `orders` | `retail_order` / `wholesale_order` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` |
| `ORDER_CANCELLED` | `orders` | `retail_order` / `wholesale_order` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` |
| `ORDER_FULFILLMENT_UPDATED` | `fulfillment` | `wholesale_order` / `purchase_order` | `OPERATIONAL` | `VIP_ACCOUNT_MEMBER` / `SUPPLIER_MEMBER` |
| `SHIPMENT_CREATED` | `shipping` | `shipment` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` |
| `SHIPMENT_SHIPPED` | `shipping` | `shipment` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` |
| `SHIPMENT_DELIVERED` | `shipping` | `shipment` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` |
| `PAYMENT_PENDING` | `payments` | `payment` / `wholesale_proforma` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` |
| `PAYMENT_CONFIRMED` | `payments` | `payment` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` |
| `PAYMENT_FAILED` | `payments` | `payment` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` |
| `REFUND_REQUESTED` | `payments` | `refund` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` |
| `REFUND_COMPLETED` | `payments` | `refund` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` |
| `VIP_MEMBERSHIP_ACTIVATED` | `vip` | `wholesale_membership` | `TRANSACTIONAL` | `VIP_ACCOUNT_MEMBER` |
| `VIP_MEMBERSHIP_EXPIRING` | `vip` | `wholesale_membership` | `OPERATIONAL` | `VIP_ACCOUNT_MEMBER` |
| `VIP_MEMBERSHIP_SUSPENDED` | `vip` | `wholesale_membership` | `OPERATIONAL` | `VIP_ACCOUNT_MEMBER` |
| `SUPPLIER_ORDER_CREATED` | `orders` | `purchase_order` | `OPERATIONAL` | `SUPPLIER_MEMBER` |
| `SUPPLIER_ORDER_ACTION_REQUIRED` | `orders` | `purchase_order` | `OPERATIONAL` | `SUPPLIER_MEMBER` |
| `SUPPORT_CASE_CREATED` | `support` | `support_case` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` / `SUPPLIER_MEMBER` |
| `SUPPORT_CASE_REPLIED` | `support` | `support_case` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` / `SUPPLIER_MEMBER` |
| `SUPPORT_CASE_STATUS_CHANGED` | `support` | `support_case` | `TRANSACTIONAL` | `ACCOUNT_USER` / `VIP_ACCOUNT_MEMBER` / `SUPPLIER_MEMBER` |
| `SETTLEMENT_AVAILABLE` | `settlement` | `settlement_account` | `OPERATIONAL` | `SUPPLIER_MEMBER` |
| `WITHDRAWAL_REQUESTED` | `settlement` | `withdrawal_request` | `OPERATIONAL` | `SUPPLIER_MEMBER` |
| `WITHDRAWAL_APPROVED` | `settlement` | `withdrawal_request` | `OPERATIONAL` | `SUPPLIER_MEMBER` |
| `PAYOUT_SUBMITTED` | `settlement` | `payout` | `OPERATIONAL` | `SUPPLIER_MEMBER` |
| `PAYOUT_RECONCILIATION_REQUIRED` | `settlement` | `payout` | `SECURITY` | `ADMIN_USER` |
| `COMPLIANCE_ACTION_REQUIRED` | `compliance` | `supplier_compliance_review` | `SECURITY` | `SUPPLIER_MEMBER` / `ADMIN_USER` |

---

## 5. Template Model & Safe Variable Interpolation

### 5.1 Versioning Architecture
- `notification_template`: Identifies the logical notification template (unique `template_key`, `name`, `event_key`, `channel`, `locale`, `category`, `status`).
- `notification_template_version`: Append-only versioned snapshot containing `version`, `subject`, `body`, `variables_schema`, and lifecycle status (`DRAFT`, `PUBLISHED`, `SUPERSEDED`, `ARCHIVED`).
- **Immutability Invariant**: Once a template version has been used in at least one `notification_delivery` record, it is strictly immutable. Any modification to a published template requires authoring a new draft version and publishing it.

### 5.2 Safe Variable Interpolation
- Variables use strict double curly braces: `{{variable_name}}`.
- Only alphanumeric and underscore identifiers are parsed (`^[a-zA-Z0-9_]+$`).
- **Prohibited Syntax**:
  - JavaScript evaluation (`eval`, `${...}`).
  - Object property traversal (`user.address.street`).
  - Database queries or SQL expressions.
  - Process environment variable access (`process.env.XXX`).
- **Publish-Time Validation**:
  - The template compiler validates that all variable tags inside `body` and `subject` are explicitly declared in `variables_schema`.
- **Sensitive Field Shielding**:
  - Variables matching sensitive keywords (`password`, `secret`, `token`, `apiKey`, `card_number`, `cvv`) are strictly rejected during compilation and filtered out of payloads.
- **Missing Variable Handling**:
  - If a required variable is missing during rendering, rendering safely throws `TemplateRenderError` and halts delivery, preventing malformed messages from being dispatched.

---

## 6. Recipient Identity & Contact Resolution

Recipients are identified exclusively by authoritative server-side identity:
1. `ACCOUNT_USER`: Resolved via `account_user.id`. Email and phone are queried directly from the verified `account_user` record.
2. `VIP_ACCOUNT_MEMBER`: Resolved via `wholesale_account.id`. Contact details are retrieved from the associated primary contact or linked `account_user`.
3. `SUPPLIER_MEMBER`: Resolved via `supplier_member.id`. Scoped strictly to the verified supplier organization and associated auth user.
4. `ADMIN_USER`: Resolved via `account_user.id` verified against admin role mappings.

Client-supplied phone numbers, emails, or tenant IDs submitted in request bodies are never treated as authoritative destinations.

---

## 7. Recipient Preferences & Mandatory Policy Enforcements

### 7.1 Preference Hierarchy & Opt-Out Rules
Recipients can customize preferences per event category or specific event key across channels (`IN_APP`, `EMAIL`, `SMS`):
- **`SECURITY` Notifications** (e.g., password changes, login attempts, compliance holds): Mandatory. Cannot be disabled by recipient.
- **`TRANSACTIONAL` Notifications** (e.g., order confirmations, invoice proformas, payment receipts): Essential. System requires at least one primary notification channel enabled.
- **`OPERATIONAL` Notifications** (e.g., SLA warnings, inventory threshold alerts, batch reports): Configurable per recipient role.
- **`MARKETING` Notifications** (e.g., promotional campaigns, birthday vouchers, winback discounts):
  - **Default Opt-In is strictly `false`**.
  - Marketing messages are **never** delivered without active, verifiable consent recorded in `compliance_consent` (`consent_event`).
  - Lack of consent is strictly interpreted as refusal.

---

## 8. Outbox Architecture, Delivery Attempts & Bounded Retries

### 8.1 Outbox State Machine (`notification_delivery`)
```
               ┌─────────────┐
               │   PENDING   │
               └──────┬──────┘
                      │ (worker claim)
                      ▼
               ┌─────────────┐
               │   QUEUED    │
               └──────┬──────┘
                      │ (start dispatch)
                      ▼
               ┌─────────────┐
               │ PROCESSING  │
               └──────┬──────┘
         ┌────────────┼─────────────┐
         ▼            ▼             ▼
   ┌───────────┐ ┌──────────┐ ┌───────────────┐
   │   SENT    │ │SUPPRESSED│ │FAILED_RETRYABLE│
   └─────┬─────┘ └──────────┘ └───────┬───────┘
         │ (receipt)                  │ (backoff retry)
         ▼                            ▼
   ┌───────────┐              ┌───────────────┐
   │ DELIVERED │              │FAILED_PERMANENT│
   └───────────┘              └───────────────┘
```

- **`SENT`**: Means the external provider accepted the message for dispatch (HTTP 200/202 with provider message ID). It does NOT mean the user clicked a frontend button.
- **`DELIVERED`**: Means the provider webhook/receipt confirmed receipt on the end-user's device.
- **`SUPPRESSED`**: Notification was skipped due to recipient preference, quiet hours, or lack of marketing consent.

### 8.2 Bounded Retries & Exponential Backoff
- Deliveries support a configurable retry policy (default maximum 5 attempts).
- Exponential backoff: $T_{\text{retry}} = \text{base\_delay} \times 2^{\text{attempt}} \pm \text{jitter}$.
- Errors are normalized into:
  - **`RETRYABLE_ERROR`**: Network timeouts, 5xx server errors, temporary provider rate limits.
  - **`PERMANENT_ERROR`**: Invalid destination (unallocated phone number, bad email domain), rejected template, blacklisted recipient. Permanent errors transition immediately to `FAILED_PERMANENT` without retrying.

### 8.3 Concurrency & Distributed Claim Safety
- Deliveries are claimed by background workers using PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` or distributed locks, ensuring that multiple worker instances never process the same delivery simultaneously.

---

## 9. Crash Windows & Delivery Guarantees

| Crash Scenario | Recovery Action | Guarantees |
|---|---|---|
| **Crash after DB commit, before provider call** | Worker restarts, inspects `notification_delivery` in `PROCESSING` state with expired heartbeat lease, re-claims delivery and initiates dispatch. | At-least-once processing. |
| **Crash after provider call accepted, before DB commit** | Provider call includes deterministic `idempotency_key`. On restart, worker retries with the same idempotency key; provider returns original message ID without re-sending. | Duplicate delivery suppression. |
| **Provider does not support idempotency** | Worker inspects external receipts and marks delivery status truthfully (`SENT` with uncertain receipt if no webhook received). | Truthful state representation; no false "delivered" claims. |
| **Business domain succeeds, notification worker fails** | Business transaction (Order, Payment, Settlement) remains committed; notification delivery remains in `FAILED_RETRYABLE`. | Zero business transaction rollbacks due to notification errors. |

---

## 10. Provider Abstraction, Secret Management & Receipt Ingestion

### 10.1 Provider Abstraction Contracts
- **`SmsProvider`**:
  ```ts
  interface SmsProvider {
    send(req: SmsSendRequest): Promise<SmsSendResult>;
    verifyWebhookSignature(payload: string, signature: string): boolean;
  }
  ```
- **`EmailProvider`**:
  ```ts
  interface EmailProvider {
    send(req: EmailSendRequest): Promise<EmailSendResult>;
    verifyWebhookSignature(payload: string, signature: string): boolean;
  }
  ```

### 10.2 Provider Lifecycle & Truthfulness
Provider status is strictly categorized:
- `DISABLED`: Provider is not active.
- `MISSING_CONFIGURATION`: Required parameters missing.
- `SANDBOX`: Test/sandbox mode; real messages are not sent over public telecom networks.
- `CONFIGURED`: Configuration verified.
- `PRODUCTION`: Live production provider.

**Critical Rule**: In production environments (`NODE_ENV=production`), fake/test providers fail closed. Real SMS/Email providers are only reported as connected when genuine API credentials, contracts, and connectivity exist.

### 10.3 Secret Management Invariant
- **No secrets in frontend**: `apiKey`, passwords, and authorization tokens must never be sent to the browser or stored in `localStorage`.
- **No secrets in database**: `notification_provider_config` stores public configuration (sender identity, service name, status), never plaintext API secrets.
- **Environment variables / Secret Manager**: Secrets are injected via server environment variables (`SMS_PROVIDER_API_KEY`, `EMAIL_SMTP_PASSWORD`).
- **Redaction**: Secrets are strictly redacted from logs, error stack traces, and REST API responses.

### 10.4 Webhook / Delivery Receipt Ingestion
- Webhooks received at `/api/v1/notifications/webhooks/:provider` require signature verification.
- Incoming events are recorded in `notification_provider_event` for idempotency and auditability.
- Receipts update `notification_delivery` monotonically: state cannot transition backward (e.g. from `DELIVERED` back to `SENT`).

---

## 11. Legacy Frontend Feature Preservation & Cutover Matrix

| Legacy UI Capability | Legacy Storage Key | Phase 5.3 Backend Architecture | Action / Status |
|---|---|---|---|
| **SMS Templates Library** | `kv_sms_templates_v1` | `notification_template` & `notification_template_version` | **UPGRADE**: Migrate to versioned, safe backend templates. |
| **Template Automation Switches** | `kv_sms_templates_v1` | `notification_template.status` (`ACTIVE`/`INACTIVE`) | **BACKEND-CONNECT**: Controlled via Admin Template API. |
| **Template Variable Substitution** | Inline client `.replaceAll()` | Server-side safe variable compilation and sanitization | **UPGRADE**: Whitelisted variables; no eval/injection risks. |
| **Outbox History & Dispatch Status** | `kv_marketing_outbox_v1` | `notification_delivery` & `notification_delivery_attempt` | **UPGRADE**: Authoritative delivery states and retry history. |
| **Manual "Sent" State Mutation** | Client button in `MessagingAutomationCenter` | Server-side evidence-driven status transition | **REPLACE**: Truthful provider receipt tracking. |
| **SMS Provider Configuration** | `kv_sms_provider_v1` (with plaintext `apiKey`) | Server-side `notification_provider_config` + environment secrets | **SECURE**: Remove client-side API key; expose safe status only. |
| **Supplier Notification Preferences** | `kv_supplier_notif_prefs` (`panel`, `sms`, `email`) | `notification_preference` | **BACKEND-CONNECT**: Persisted per authenticated supplier. |
| **Supplier Messages Preview** | Hardcoded threads in `workflows.tsx` | Split: Support cases -> Phase 5.2; Notifications -> Phase 5.3 In-App | **CLASSIFY**: Clear separation; zero duplicate chat engines. |
| **Admin System Center Notification Toggle** | `kv_admin_system` (`notifications: true`) | Admin notification preference & subscription | **BACKEND-CONNECT**: Server-side settings. |

---

## 12. Single-Writer Boundaries, RBAC & Non-Regression Invariants

1. **Owned Tables**: The `notifications` module owns 9 tables:
   - `notification_event`
   - `notification_template`
   - `notification_template_version`
   - `notification_preference`
   - `notification_delivery`
   - `notification_delivery_attempt`
   - `in_app_notification`
   - `notification_provider_event`
   - `notification_provider_config`
2. **Read-Only Exceptions**: Notifications reads `account_user`, `wholesale_account`, `supplier`, `supplier_member`, `consent_event`, and `audit_log` solely for recipient resolution and consent checks. It never writes to these foreign tables.
3. **Admin RBAC**: Protected by `AdminPermissionGuard` using 7 granular permissions:
   - `notification:template:view`
   - `notification:template:manage`
   - `notification:outbox:view`
   - `notification:outbox:retry`
   - `notification:provider:view`
   - `notification:preference:manage`
   - `notification:report:view`
4. **Non-Regression Gate**: Full compatibility preserved across all previous phases (Phase 4.7.5 Compliance, Phase 4.8 Settlement, Phase 5.0 Wholesale RBAC, Phase 5.1 CRM, Phase 5.2 Support).
