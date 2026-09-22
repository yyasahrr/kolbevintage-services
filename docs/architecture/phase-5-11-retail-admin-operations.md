# Phase 5.11 — Retail Admin & Operations Backend: Authority Graph & Design

Status: live (Phase 5.11, start SHA `6b54da86`)
Scope: BACKEND only. The Retail Admin frontend stays frozen (Phase 6 wiring is out of scope).

## 1. Purpose

Build the Retail **ADMIN / OPERATIONS control plane** over the existing canonical
Retail domains. Admin is an **orchestrator and authorization boundary**. It must
never become a second business-data authority.

The governing rule (enforced by tests, D1/D7):

```
Admin Retail API
  → owner-domain command (service surface)
  → owner-domain validation / state machine
  → owner transaction / audit
  → result
```

A Retail Admin controller/service may **read** owner facts for operational views
(read-only, pinned by `READ_EXCEPTIONS` in `module-boundaries.test.ts`) and
**delegate every write** to an owner service. It owns no business tables.

## 2. Existing authority graph (as found, before 5.11)

### 2.1 Domain owners (registry.ts, module-boundaries.test.ts)

| Domain | Owner module | Tables (authoritative) | Notes |
|---|---|---|---|
| Catalog | `catalog` | brand, category, product, product_media, product_variant, product_variant_media, supplier_product_submission | lifecycle + retail isolation |
| Offers / Pricing | `offers`, `pricing` | seller_offer (incl. `retail_price`), wholesale_package*, … | KOLBE seller row: `seller.type = 'KOLBE'` (deterministic id `seller_kolbe`) |
| Promotions | `promotions` | promotion, promotion_revision, promotion_target, promotion_coupon, … | deterministic evaluation engine |
| Inventory | `inventory` | product_variant_inventory, inventory_reservation, inventory_ledger, command_idempotency | KOLBE retail stock = rows with the KOLBE sellerId; supplier stock = everything else |
| Orders (Retail) | `orders` (retail slice: `orders/retail`) | retail_order, retail_order_item, retail_order_event (+ shared order_event) | retail state machine `placed→confirmed→packed→shipped→delivered→returned`, cancel from placed/confirmed/packed |
| Returns (Retail) | `orders` (retail slice) | retail_return_request, retail_return_item, retail_return_event | `REQUESTED→APPROVED→RECEIVED→INSPECTED→RESTOCKED` (+ REJECTED / WITHDRAWN customer-only) |
| Orders (Wholesale) | `orders` | wholesale_order, purchase_order, … | NOT touched by this phase |
| Payments / Refunds | `payments` | payment (XOR side: retail_order_id), refund (XOR side), refund_line, refund_allocation, payment_allocation, financial_ledger_entry, … | refund lifecycle `requested→approved→processing→completed|failed|cancelled` |
| Shipping | `shipping` | shipping_quote, shipment (XOR side: retail_order_id), shipment_item, shipment_event | retail lifecycle rows under the shared shipment table |
| Ratings | `ratings` | product_rating (+ dormant supplier/transaction_rating) | verified-purchase proof (XOR FK to retail/wholesale order) |
| CRM | `crm` | crm_contact, crm_tag, crm_activity, crm_task, … | Customer 360 read model |
| Support | `support` | support_case, support_case_*_history, support_case_relation, … | returns file cases in-transaction |
| Analytics | `analytics` | system_log, analytics_saved_report, analytics_report_run, analytics_export_job | **read-only metric registry**; retail metrics already exist (`retail.*`) |
| Notifications | `notifications` | notification_event, notification_template*, notification_delivery*, in_app_notification, … | owns delivery; domains emit facts |
| Auth | `auth` | account_user, login_attempt, user_session | TOTP (RFC 6238, HMAC-SHA1, 30s, ±1), scrypt passwords, token_version revocation |
| Admin (control plane) | `admin` | admin_role, admin_role_permission, admin_user_role, approval_request, business_setting(+history), admin_internal_note | RBAC + maker/checker + settings + notes |

### 2.2 Existing admin-facing surfaces (conventions)

- Admin controllers live **inside the owning module**, routed `admin/<domain>…`:
  `admin/wholesale/orders` (orders), `admin/shipping` (shipping), `admin/crm` (crm),
  `admin/analytics*` (analytics), `admin/support` (support), `admin/notifications`
  (notifications), `admin/approvals|settings|notes|rbac|wholesale/control-tower`
  (admin), …
- Session identity: `SessionGuard` (global) verifies the signed token against
  `account_user` (status, token_version, role) — never client-supplied identity.
  `@Roles("admin")` adds the coarse role gate; fine-grained RBAC is
  `AdminRbacService.assertPermission(userId, action)`.
- Pagination: keyset cursors `(created_at DESC, id)`, base64url-encoded JSON
  `[createdAtISO, id]` — used by retail customer history, wholesale admin list,
  ratings list. No offset pagination on operational lists.
- Commands: `Idempotency-Key` header required; owner services claim idempotency
  inside their own transactions (`command_idempotency`).
- Money: BIGINT end-to-end; HTTP surfaces emit decimal **strings** (`toApiJson`).

### 2.3 RBAC framework (existing, reused — not recreated)

- `ADMIN_PERMISSION_ACTIONS` (`packages/database/src/schema/state-values.ts`) is
  the closed permission catalog; the DB pins it with the
  `admin_role_permission_action_allowed` CHECK (extended per phase by
  dropping/re-adding the constraint — see 0031 for the pattern).
- Resolution (`AdminRbacService.getUserPermissions`):
  1. If the user has **granular** `admin_user_role` assignments → the union of
     the assigned roles' permissions. Unknown actions are simply absent
     (fail-closed).
  2. Else if `account_user.role = 'admin'` (no granular assignments) → the full
     catalog (bootstrap / super-admin compatibility, predates 5.11).
  3. Else → empty set.
- System roles: `super_admin` (full catalog, re-granted on boot), `commercial_ops`,
  `approver` (wholesale-scoped).
- Unknown permission strings can never be granted: the CHECK constraint rejects
  the insert, and 5.11 adds an explicit service-level rejection in
  `assignPermissionsToRole` (fail-closed, before any write).

**5.11 decision — bootstrap compatibility vs bypass.** The rule above is kept as
is: an `admin` account **without** granular role assignments is the documented
bootstrap/super-admin posture and receives the catalog (including the new
`retail:*` permissions). This is the pre-existing, documented super-admin
semantic — not a new bypass. The moment an admin account has **any** granular
role assignment, its permissions are exactly the assigned union; anything not
explicitly granted — including every new `retail:*` action — is denied
(fail-closed). Non-admin roles (customer / vip / supplier) get no `admin/*`
surface at all (route `@Roles("admin")` + empty permission set, defense in depth).

### 2.4 Canonical owner commands available to the Retail Admin surface

| Operation | Owner command (service surface) | Enforced by |
|---|---|---|
| Retail order confirm/pack/cancel | `RetailOrdersService.confirmRetailOrder / packRetailOrder / cancelRetailOrder` | retail state machine + shipment/return gates + audit |
| Retail order transition (generic) | `RetailOrdersService.transitionOrder` | `RETAIL_ORDER_TRANSITIONS` table |
| Retail payment verification (evidence reconciliation) | `RetailOrdersService.verifyPayment` → `PaymentsService.verifyRetailPaymentRow` | amount == order total, version check, idempotency; marks paid + confirms stock atomically |
| Wholesale-side payment verify/reject | `PaymentsService.verifyPayment / rejectPayment` (existing `admin` finance surface) | same |
| Retail refund request | `RetailOrdersService.requestRetailRefund` → `PaymentsService.createRetailRefund` | order-state gates, locked line basis, BIGINT, refundable-basis cap, idempotency |
| Retail refund approve/complete/fail | `RetailOrdersService.approveRetailRefund / completeRetailRefund / failRetailRefund` → `PaymentsService.*Refund` | refund state machine + ledger OUT |
| Return staff transitions | `RetailReturnsService.transitionRetailReturn` | `RETAIL_RETURN_TRANSITIONS` + inspection/restock rules |
| Retail shipment create/handoff/manual-tracking | `RetailOrdersService.createRetailShipment / markRetailShipmentHandoff / recordRetailManualTracking` | readiness gates; manual attestation only for `manual`-provider shipments (carrier truth stays with the webhook) |
| Inventory adjustment | `InventoryService.upsertVariantInventory` | role/seller ownership, no underflow, no below-reserved, ledger + audit, idempotency |
| Review moderation | `RatingsService.setReviewVisibility` (+ 5.11 owner command `staffFlagReview`) | admin-only, idempotent, audited; filing stays customer-only (no forged verified reviews) |
| Customer profile | `AuthService.getCustomerProfile / me` | auth ownership; projections exclude secrets |
| Customer block/unblock | **new owner command** `AuthService.suspendAccount / reinstateAccount` (5.11-B) | auth owns `account_user`; audited; session revocation via token_version |
| Metrics / reports | `AnalyticsQueryService.run` (+ report/export services) | read-only metric registry |
| Maker/checker | `AdminApprovalsService.createApprovalRequest / decideApprovalRequest / executeApprovedRequest` | two-person rule (maker ≠ checker), typed request |
| Audit | `AuditService.record` | append-only `audit_log` |

## 3. What 5.11 adds

### 3.1 New module `retail-admin` (orchestrator, owns no tables)

- Registered in `registry.ts` with `tables: []` — the module-boundaries test
  then forbids it from writing (or even referencing) any table except the
  explicitly listed read exceptions used for read-model/overview aggregation.
- Controllers routed `admin/retail/…` (coherent namespace per A4).
- Every route: `@Roles("admin")` + `AdminRbacService.assertPermission` with a
  single narrow action. Actor = session claims only.
- Reads: delegate to owner services; a bounded set of read-only SQL
  aggregations for the overview and list projections (documented in
  `READ_EXCEPTIONS`), always parameterized Drizzle conditions.
- Writes: strictly `ownerService.command(actor, input, idempotencyKey)`.

### 3.2 Permission catalog (A2) — 20 new actions

Every action maps to a real endpoint shipped in this phase (A = views,
B = commands, C = reporting). No action implies missing functionality:

```
retail:dashboard:view     retail:order:view        retail:order:manage
retail:payment:view       retail:payment:reconcile retail:shipment:view
retail:shipment:manage    retail:return:view       retail:return:manage
retail:refund:view        retail:refund:request    retail:refund:approve
retail:inventory:view     retail:inventory:adjust  retail:customer:view
retail:customer:manage    retail:review:view       retail:review:moderate
retail:catalog:view       retail:report:view
```

Grant model: no system role is pre-seeded with retail permissions
(commercial_ops/approver stay wholesale-scoped). Ops staff get a role with the
exact subset (e.g. a "retail ops" role: order:view+manage, payment:view,
shipment:view+manage, return:view+manage, refund:view, customer:view,
catalog:view, inventory:view, dashboard:view). Super-admin/bootstrap admins
already hold the full catalog. Migration 0043 extends the CHECK constraint.

### 3.3 Schema additions (all additive; published migrations untouched)

- **0043 (A)**: extend `admin_role_permission_action_allowed` with the 20
  `retail:*` actions.
- **0044 (B)**:
  - `retail_order` operational flag (B8) — an operational manual-review fact,
    NOT a fraud verdict: `suspicious_flagged_at timestamptz`,
    `suspicious_flagged_by text`, `suspicious_flag_reason text`,
    `suspicious_review_state text CHECK (flagged|under_review|cleared)` with a
    coherence CHECK (all set or all null except cleared state which keeps the
    flag provenance). Owner: `orders` (retail slice) — the flag is order
    metadata; Admin writes it only through `RetailOrdersService`.
  - `account_user` suspension evidence (B7): `suspension_reason text`,
    `suspension_type text CHECK (temporary|permanent)`, `suspended_at timestamptz`,
    `suspended_by text`. Owner: `auth`.
  - `review_moderation_event` (B6): append-only moderation history
    (review_id FK, action shown|hidden|flagged, from/to status, actor, role,
    reason, created_at). Owner: `ratings`. UPDATE/DELETE blocked by trigger
    (same append-only posture as `audit_log`).
  - `approval_request`: add `RETAIL_REFUND_APPROVAL` to
    `APPROVAL_REQUEST_TYPES` (B10, see 3.6).
- **0045 (C)**:
  - `inventory_stock_threshold` (C4): per (variant_id, seller_id) server-owned
    low-stock threshold (`threshold int > 0`, updated_by/updated_at). Owner:
    `inventory`. Retail low-stock views scope to the KOLBE seller only;
    supplier thresholds never leak into the retail view and vice versa.

**Deliberately NOT added (documented non-claims):**
- No `price_history` table (C5): the repo currently has **no canonical Retail
  price mutation path** — `seller_offer.retail_price` is written only at offer
  creation; the legacy Next.js `admin/catalog/bulk-price` mutates
  `wholesale_price` on the legacy surface and is not a canonical Retail price
  command. Per the approved rule, 5.11 does not invent a fake mutation just to
  populate history. What is needed later: an owner (offers) price-change
  command (single + batch, reason, actor, idempotency) plus the append-only
  history evidence it writes (old/new BIGINT IRR, actor, reason, timestamp,
  product/variant scope, currency). Tracked in the phase report.
- No Admin copies of orders/payments/shipments/returns/refunds/reviews — none.
- No branch/store-location model, no wallet, no tax engine, no distance-based
  shipping, no real SMS/email/payment providers, no production WAL/replication
  (all remain deferred infra/product items, see D8 matrix).

### 3.4 Retail Control Tower / overview (A6)

`GET admin/retail/overview` surfaces **current-state operational facts only**,
each a parameterized aggregate over canonical rows (no hardcoded KPIs, no
fabricated revenue):

- `orders_by_status` — group by `retail_order.order_status`
- `orders_requiring_action` — `placed` (awaiting staff confirm)
- `payments` — counts by `retail_order.payment_status` (unpaid / pending_cod /
  paid); unpaid+pending = collections to chase
- `shipping_exceptions` — retail-side `shipment` rows with status `failed`
- `pending_returns` — `retail_return_request` in REQUESTED/APPROVED
- `pending_refunds` — retail-side `refund` in requested/approved/processing
- `critical_stock` — KOLBE-seller variants with `on_hand - reserved <= 0`
  (C4 replaces the cutoff with the authoritative per-variant threshold)
- `reviews_awaiting_moderation` — `product_rating.status = 'flagged'`
- `flagged_orders` — orders with an active suspicious flag (B8)
- `period` facts — last 7/30 days created orders + paid GMV read through the
  existing Analytics retail metrics (no second analytics engine)

### 3.5 API surface (A4/A5, B, C)

Checkpoint A (views):

```
GET /api/v1/admin/retail/overview
GET /api/v1/admin/retail/orders            (status, paymentStatus, customerId,
                                            customerPhone, orderCode,
                                            shipmentStatus, dateFrom, dateTo,
                                            limit, cursor; `suspicious` joins
                                            this filter with B8's flag column)
GET /api/v1/admin/retail/orders/:id        (order + latest shipment fact)
GET /api/v1/admin/retail/orders/:id/timeline
GET /api/v1/admin/retail/payments          (retailOrderId, status, limit, cursor)
GET /api/v1/admin/retail/payments/:id
GET /api/v1/admin/retail/shipments         (retailOrderId, status, limit, cursor)
GET /api/v1/admin/retail/shipments/:id
GET /api/v1/admin/retail/returns           (status, orderId, limit, cursor)
GET /api/v1/admin/retail/returns/:id
GET /api/v1/admin/retail/refunds           (retailOrderId, status, limit, cursor)
GET /api/v1/admin/retail/refunds/:id
GET /api/v1/admin/retail/customers         (search, role, status, limit, cursor)
GET /api/v1/admin/retail/customers/:id     (safe profile; full 360 in C)
GET /api/v1/admin/retail/reviews           (productId, status incl. hidden, limit, cursor)
GET /api/v1/admin/retail/products          (status, search, limit, cursor)
GET /api/v1/admin/retail/products/:id      (ops view: lifecycle, variants,
                                            retail price, KOLBE stock, review aggregate)
GET /api/v1/admin/retail/inventory/low-stock
```

Checkpoint B (commands — all POST, Idempotency-Key required where the owner
command requires it):

```
POST /api/v1/admin/retail/orders/:id/confirm
POST /api/v1/admin/retail/orders/:id/pack
POST /api/v1/admin/retail/orders/:id/cancel
POST /api/v1/admin/retail/orders/:id/shipments              (create retail shipment)
POST /api/v1/admin/retail/shipments/:id/handoff
POST /api/v1/admin/retail/shipments/:id/tracking            (manual provider only)
POST /api/v1/admin/retail/orders/:id/flag-suspicious        (reason required)
POST /api/v1/admin/retail/orders/:id/flag-suspicious/review (under_review | cleared)
POST /api/v1/admin/retail/payments/:id/verify               (evidence reconciliation)
POST /api/v1/admin/retail/returns/:id/transition            (APPROVED/REJECTED/RECEIVED/INSPECTED/RESTOCKED)
POST /api/v1/admin/retail/refunds                           (request; line basis from owner)
POST /api/v1/admin/retail/refunds/:id/approve
POST /api/v1/admin/retail/refunds/:id/complete
POST /api/v1/admin/retail/refunds/:id/fail
POST /api/v1/admin/retail/inventory/adjust                  (variantId + delta + reason)
POST /api/v1/admin/retail/inventory/threshold               (C: set KOLBE threshold)
POST /api/v1/admin/retail/customers/:id/block               (temporary|permanent + reason)
POST /api/v1/admin/retail/customers/:id/unblock
POST /api/v1/admin/retail/reviews/:id/show
POST /api/v1/admin/retail/reviews/:id/hide
POST /api/v1/admin/retail/reviews/:id/flag
```

Checkpoint C (read models / workflows):

```
GET /api/v1/admin/retail/orders/:id/operations-view   (C1: order + customer
       snapshot + payment state + shipment state + promotion attribution +
       return state + refund state + support case references — one read model,
       no copied tables)
GET /api/v1/admin/retail/customers/:id/360            (C2: profile, retail
       order history, returns/refunds, support cases, review history, account
       status — retail-scoped; no VIP/supplier private fields)
GET /api/v1/admin/retail/products/:id/operations-view (C3)
GET /api/v1/admin/retail/inventory/low-stock          (C4: threshold-based)
GET /api/v1/admin/retail/reports                      (C6: composes existing
       Analytics retail metrics + date-range semantics; exports reuse the
       existing safe export jobs)
```

### 3.6 2FA policy (B9) — explicit, testable, bootstrap-safe

- New env `KOLBE_ADMIN_2FA_POLICY` = `off` (default; dev/test) | `enforced`
  (production deployments). The policy is read at auth time, documented in the
  phase report, and covered by tests in both modes.
- `off`: unchanged behavior — enrolled users (any role) must pass TOTP at
  login; unenrolled log in with password only.
- `enforced`: for `role = admin` —
  - enrolled: valid TOTP required at login (existing RFC 6238 verify, ±1 window);
  - **unenrolled: login is refused** with `ADMIN_2FA_ENROLLMENT_REQUIRED`
    (403) — no permanent bypass.
  - Other roles: unchanged (2FA remains opt-in there).
- Bootstrap path: `scripts/create-admin.mjs` gains `KOLBE_ADMIN_TOTP=true` —
  it generates the secret, shows the otpauth URL + current code **once** on the
  operator terminal, verifies a code typed back, and persists the enrolled
  state. So a fresh deployment in `enforced` mode creates its first admin
  already enrolled; afterwards every login needs the second factor.
- Web enrollment for already-logged-in admins stays available
  (`POST /auth/totp/enroll` + `/verify`), unchanged.
- Secret non-disclosure: `totp_secret` is projected nowhere in API responses
  (enroll returns it exactly once, by design). Static guard pins this.
- Recovery: there is **no** static recovery-code mechanism in this repo and
  5.11 does not invent one. Recovery = (a) the enrolled admin disables TOTP
  with a valid code, or (b) an operator resets the account out-of-band via the
  audited CLI path. Both are auditable; both are documented as the intended
  recovery surface.
- Remaining crypto-hardening debt (honest, pre-existing): `totp_secret` is
  stored unencrypted in `account_user` (the TOTP service header already marks
  phase-6 replacement with an audited library + encrypted secret); TOTP uses
  HMAC-SHA1/6-digit/±1 per the existing RFC 6238 implementation, which this
  phase does **not** replace.

### 3.7 High-risk approvals (B10)

`RETAIL_REFUND_APPROVAL` is added to the existing maker/checker catalog
(`approval_request` CHECK). Flow: the staff member who files a retail refund
(maker) gets a corresponding approval request; a **different** admin (checker)
decides it, and execution calls the owner `approveRetailRefund`. The two-person
rule is the framework's existing enforcement (maker ≠ checker); below that,
ordinary refunds still need the `retail:refund:approve` permission — the
framework is not forced onto reads or ordinary status commands.

### 3.8 Notifications (C7)

Operational commands may emit a `notification_event` fact (owner:
notifications) after the domain command has committed (post-commit,
best-effort; a provider failure can never roll back or corrupt the domain
result). Retail Admin never calls a provider directly.

### 3.9 Audit trail (C8)

Every owner command above records its own audit row (existing behavior). The
retail-admin layer adds a top-level `retail_admin.command_*` audit row with
permission, target, command, reason and the Idempotency-Key reference where
applicable. No secrets, no full PII (customer name/phone only where the
operational view already requires them, and only behind `retail:customer:view`).

## 4. Non-goals / explicit non-claims (5.11)

- No manual "mark payment paid": payment truth changes only via the verified
  payment path (evidence + amount equality + owner transaction) or provider
  webhooks. There is no endpoint to set a payment status arbitrarily.
- No forged carrier completion: provider-backed shipments advance only through
  the provider webhook/event pipeline; `recordRetailManualTracking` applies to
  `manual`-provider shipments only (owner-enforced).
- No fabricated profit/tax/margin metrics: Analytics exposes only metrics with
  an authoritative basis; 5.11 composes them, never invents cost data.
- No wallet as e-money, no tax engine, no branch model, no distance-based
  shipping, no real provider integrations — all remain deferred (D8).
- No wholesale/supplier mutation: the Retail Admin surface resolves the KOLBE
  seller server-side for every inventory command and scopes every read to
  retail-side rows; wholesale ops keep their existing `admin/wholesale/*`
  surface.
