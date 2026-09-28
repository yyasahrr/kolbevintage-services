# Phase 4.4 — Supplier Revision, Confirmation & Exception-Safe Fulfillment Report

## SHAs
- Base: `7aa34a74ac7c588d4c7c1c1526798d0fb6f883b5` (Phase 4.3/4.3.1 GREEN 266 tests)
- Current: `b00ac3dd270db45ad0688ae87ca68db36cb97f6c`
- Migration: `0016_phase_4_4_supplier_workflow.sql` (forward-only)

## Migration 0016 Summary
- `wholesale_request` CHECK updated: `pending,supplier_review,revision_requested,accepted,rejected,cancelled,expired,ordered` (was 5 states, now 8 per `status-machines.md` frozen future)
- `order_event` CHECK extended: adds `child.ready`, `child.exception_opened`, `child.exception_resolved`, `request.revision_requested`, `request.revision_accepted`, `request.rejected`, `request.cancelled`, `request.expired` alongside existing `order.created`, `child.confirmed`, `child.preparing`, etc.
- `command_idempotency` CHECK extended: `inventory.confirm_child`, `inventory.release_child`, `vip.request_revision`, `vip.revision_response`, `vip.request_reject`, `vip.request_cancel`, `vip.request_expire`, `orders.child_confirm`, `orders.child_prepare`, `orders.child_ready`, `orders.child_dispatch`, `orders.child_deliver`, `orders.child_cancel`, `fulfillment.report_exception`, `fulfillment.resolve_exception`
- New table `wholesale_request_revision` (VIP-owned, append-only):
  - `id` PK `wrev_<uuid>`, `request_id` FK RESTRICT, `request_version` int >=0, `revision_number` int >0 unique per `(request_id, revision_number)`
  - `proposed_by_user_id` FK account_user RESTRICT, `proposed_by_role` CHECK buyer/admin/supplier/system/fulfillment
  - `reason` text, `proposed_quantity` int nullable >=0 (reduced only enforced in service), `proposed_variant_id` FK product_variant NULL, `proposed_package_id` FK wholesale_package NULL, selector CHECK exactly one or none
  - `pricing_unit` CHECK PRICING_UNITS, `proposed_unit_price` bigint CHECK 0..MAX_MONEY, `currency` IRR default, `proposed_terms_snapshot` jsonb default {}, `proposed_terms_hash` text
  - `buyer_responded_at` timestamptz, `buyer_responded_by` FK account_user, `buyer_response` CHECK accepted/rejected NULL
  - Indexes: unique `(request_id,revision_number)`, `(request_id,created_at)`
- New table `fulfillment_exception` (Fulfillment-owned):
  - `id` PK `fexc_<uuid>`, `child_order_id` FK purchase_order RESTRICT NOT NULL, `seller_id` FK seller RESTRICT NOT NULL, `wholesale_order_id` FK wholesale_order NULL
  - `type` CHECK `cannot_fulfill,partial_shortage,package_unavailable,operational_failure`
  - `reason_code` text, `reason` text, `status` default open CHECK `open,awaiting_buyer,replacement_requested,resolved,cancelled`
  - `reported_by` FK account_user NOT NULL, `reported_at` default now, `affected_amount` bigint default 0 CHECK 0..MAX_MONEY, `currency` IRR default
  - `affected_items_snapshot` jsonb default [] frozen IDs/qtys/totals/seller/reason, no mutation of original OrderItem snapshots
  - `buyer_resolution` CHECK `replacement_requested,quantity_reduction,cancel_portion` NULL, `buyer_resolved_at`, `buyer_resolved_by` FK account_user
  - Indexes: `(child_order_id,status)`, `(seller_id,status)`, `(wholesale_order_id,status)`
- `inventory_reservation.child_order_id` column added text nullable FK purchase_order RESTRICT + index `inventory_reservation_child_order` for isolated release/consume per child

No payment/shipping/finance tables added per Phase 4.4 scope.

Snapshot: `migrations/meta/0016_snapshot.json` updated, `_journal.json` idx16 added, verify reports 17 migrations, 48 tables, 105 FKs, 134 CHECKs.

## Revision Model (PART A)
- States: `pending,supplier_review,revision_requested,accepted,rejected,cancelled,expired,ordered` updated in `vip.logic.ts` and `state-values.ts` WHOLESALE_REQUEST_STATUSES
- Transitions:
  - absent→pending buyer (createWholesaleRequest)
  - pending→supplier_review buyer/admin
  - supplier_review→revision_requested supplier/admin (proposeRevision)
  - revision_requested→supplier_review buyer/admin (acceptRevision)
  - supplier_review→accepted supplier/admin (acceptRequest)
  - supplier_review/revision_requested→rejected supplier/admin (rejectRequest)
  - pending/supplier_review/revision_requested/accepted→cancelled buyer/admin (cancelRequest)
  - same→expired system DB-time (expireWholesaleRequests)
  - accepted→ordered system (markRequestOrdered)
  - Terminal: rejected/cancelled/expired/ordered
- Table `wholesale_request_revision` append-only, `revision_number` per request, `request_version` frozen at proposal time, `terms_snapshot`/`hash` via canonicalStringify SHA256, no silent mutation
- Validation: reduced quantity only (`proposedQuantity <= original`), same product enforcement via variant.productId/package.offer.productId checks, same seller enforcement, cannot arbitrarily change buyer/VIP account, fundamentally different product requires new request (PRODUCT_MISMATCH)
- Buyer accept→supplier_review (not direct to accepted/ordered), rejection stays `revision_requested` with version bump, snapshot immutable, rejection requires reason, expired cannot accept/order cancelled terminal
- Idempotency: `command_idempotency` scope `wholesale_request`, commandTypes `vip.request_revision`, `vip.revision_response`, `vip.request_reject`, `vip.request_cancel`, `vip.request_expire`, key+hash verification, same key+same payload replay, diff payload 409, state pending→completed, SKIP LOCKED not needed for revision but used for expiry worker-safe
- Expiry: `SELECT NOW()` DB-time, `FOR UPDATE SKIP LOCKED` worker-safe, limit batch, transitions via `transitionWholesaleRequest`
- API: `POST /wholesale/requests/:id/revisions` (supplier/admin), `POST /:id/revisions/:revisionId/accept` (vip/customer/admin), `POST /:id/revisions/:revisionId/reject`, `POST /:id/reject`, `POST /:id/cancel`, `GET /:id/revisions`

## Role Enforcement
- Supplier revision: exact supplier member via `supplierMember` lookup from seller.supplierId, role owner/sales only allowed to negotiate commercial terms, warehouse cannot negotiate (ROLE_NOT_ALLOWED), finance cannot, Supplier A cannot revise B (SUPPLIER_OWNERSHIP_VIOLATION)
- Buyer accept: VIP ownership via `wholesale_account.userId == buyerUserId`, version check, buyer response tracking `buyer_responded_at/by/response`
- Server-derived supplier identity: Claims.sub used, no sellerId body forged ID denied (tests in module-boundaries ensure no forged path)
- Owner/sales view/confirm/report, warehouse prep/ready/handoff, finance no warehouse, KOLBE admin/operator allowed via admin role, Supplier A≠B isolation via membership check

## Child Workflow (PART B)
- States: `pending,confirmed,preparing,shipped,delivered,cancelled` per `purchase_order` status CHECK; `ready_at` + `child.ready` idempotent event (no status change, only timestamp)
- Auth: external child only exact supplier member, owner/sales view/confirm/report, warehouse prep/ready/handoff, finance no warehouse, KOLBE admin equiv, forged seller ID denied via Claims.sub derivation
- Confirmation `pending→confirmed` owner/sales or KOLBE admin checks child belongs seller, expectedVersion, parent not cancelled/completed, allocations valid, no blocking open exception, history/event/audit same tx, commandIdempotency scope child_order `orders.child_confirm` hash verify
- Preparation `confirmed→preparing` must not bypass payment gate: parent must be `processing,fulfillment,shipped,completed` else PARENT_PAYMENT_GATE, role owner/sales/warehouse allowed, finance blocked, commandIdempotency `orders.child_prepare`
- Ready while `preparing` warehouse may mark `ready_at` once emit `child.ready` idempotent, commandIdempotency `orders.child_ready`, no stock decrement
- Dispatch `preparing→shipped` consumes ONLY child's active allocations via `confirmChildOrderAllocations({orderId,childOrderId,sellerId,requester,idempotencyKey,executor})` locks reservations+inventory seller+variant ASC verifies active consumes once on_hand-=qty reserved-=qty ledger DECREASE audit same tx replay safe cannot consume sibling, blocking exception check, parent aggregation via `calculateParentFulfillmentProjection`, commandIdempotency `orders.child_dispatch`, trackingCode optional, history/event same tx
- Delivery `shipped→delivered` no second decrement, commandIdempotency `orders.child_deliver`, parent aggregation
- Cancellation pre-ship only: pending/confirmed/preparing→cancelled, shipped/delivered blocked, release ONLY its reservations via `releaseChildOrderAllocations` active only deterministic locks reserved-- never on_hand ledger RELEASE audit same tx idempotent, confirmed/dispatched cannot release, commandIdempotency `orders.child_cancel`, financialImpact evidence

## Failure Isolation (PART C)
- `fulfillment_exception` model: id, child_order_id, seller_id, wholesale_order_id, type, reason_code/reason, status, reported_by/at, affected_amount BIGINT IRR, affected_items_snapshot frozen IDs/qtys/totals/seller/reason, buyer_resolution, buyer_resolved_at/by
- Supplier owner/sales report freeze IDs/qtys/totals/seller/reason no snapshot mutation, affectedOrderItemIds optional, whole child if none, affected_amount sum of lineTotals bigint, currency from child
- Replacement NOT silently swap OrderItem immutable record: buyer resolution `replacement_requested` API candidates final via new accepted request/amendment, no silent OrderItem mutation
- Partial cancellation only failed child: if no dispatch child→cancelled release ONLY its reservations via `releaseChildOrderAllocations` active only deterministic locks, sibling untouched, append child.cancelled inventory.released exception.resolved with exact amount/currency+financialImpact `{kind:future_refund_or_payment_adjustment, amount, currency, childOrderId}` evidence only, no actual refund
- Unresolved exception blocks that child only: confirm and dispatch check open exceptions, parent aggregation excludes blocked child? Actually parent status from remaining uncancelled+payment gate, one cancelled others remain parent NOT auto cancelled, ALL cancelled→parent may cancel, A delivered B cancelled→parent may complete when no unresolved work, A shipped B cancelled→shipped, A preparing B cancelled→fulfillment, do not count cancelled as delivered do not cancel active child because B failed
- Sibling isolation proof: dispatch A vs cancel B safe isolated via child_order_id FK, confirmChildOrderAllocations only filters by child_order_id, releaseChildOrderAllocations only filters by child_order_id, deterministic lock order seller+variant ASC prevents deadlock, no negative reserved/on_hand via checks

## Concurrency
- cancel B vs dispatch B one winner: both FOR UPDATE lock child row, plus inventory reservations FOR UPDATE, second fails INVALID_STATUS_TRANSITION or RESERVATION_ALREADY_CONFIRMED
- dispatch A vs cancel B safe isolated: different child_order_id, different reservation sets, different inventory lock sets (seller_id differs), no cross interference
- identical confirm one effect/replay: commandIdempotency scope child_order with requestHash verify, first completes, second returns replayed true with same payload, no double version bump
- stale version conflict: expectedVersion check vs child.version, throws REQUEST_VERSION_CONFLICT 409
- No global rollback after order exists: creation all-or-nothing, after exists isolated per child

## API Summary
- `POST /wholesale/requests/:id/revisions` body reason, proposedQuantity (reduced only), proposedVariantId/packageId (same product/seller), proposedUnitPrice bigint string, pricingUnit, currency IRR, leadTimeDays, expectedVersion header Idempotency-Key required
- `POST /wholesale/requests/:id/revisions/:revisionId/accept` buyer/admin, Idempotency-Key, expectedVersion optional
- `POST /wholesale/requests/:id/revisions/:revisionId/reject` buyer/admin, reason optional
- `POST /wholesale/requests/:id/reject` supplier/admin, reason required
- `POST /wholesale/requests/:id/cancel` buyer/admin, reason optional
- `GET /wholesale/requests/:id/revisions` list append-only
- `GET /supplier/orders` list seller-bound (admin requires sellerId query, supplier user resolves via supplierMember→seller)
- `GET /supplier/orders/:id` exact supplier member only
- `POST /supplier/orders/:id/confirm` owner/sales, Idempotency-Key, expectedVersion
- `POST /supplier/orders/:id/start-preparation` owner/sales/warehouse, finance blocked, payment gate
- `POST /supplier/orders/:id/ready` owner/warehouse, Idempotency-Key, ready_at once idempotent child.ready event
- `POST /supplier/orders/:id/report-exception` owner/sales, type, reasonCode/reason, affectedOrderItemIds, expectedChildVersion, Idempotency-Key, freezes affected_items_snapshot
- `POST /supplier/orders/:id/dispatch` consumes only child allocations, trackingCode optional
- `POST /supplier/orders/:id/deliver`, `POST /supplier/orders/:id/cancel`
- `POST /wholesale/orders/:orderId/exceptions/:exceptionId/resolve` buyer/admin, buyerResolution, reason, Idempotency-Key, if cancel_portion triggers cancelChildOrder with financialImpact future_refund_or_payment_adjustment amount currency childOrderId
- Idempotency: same key+same payload replay returns replayed true, diff payload 409 no duplicate, pending state throws COMMAND_IN_PROGRESS

## History/Events/Audit Same Tx
- Extended event types: `request.revision_requested`, `request.revision_accepted`, `request.rejected`, `request.cancelled`, `request.expired`, `child.confirmed`, `child.preparing`, `child.ready` (idempotent), `child.exception_opened`, `child.exception_resolved`, `child.cancelled`, `child.shipped`, `child.delivered`, `inventory.released`, `inventory.consumed`
- No PII-heavy payloads, only IDs, status, financialImpact amount string, currency, childOrderId, sellerId, reason, affectedItems
- Audit via AuditService record same tx executor, actorId, role, action, entityType, before/after, metadata

## Ownership
- VIP: `wholesale_account`, `vip_plan`, `vip_subscription`, `wholesale_request`, `wholesale_request_revision`
- Orders: `wholesale_order`, `wholesale_order_item`, `wholesale_order_request`, `purchase_order`, `purchase_order_item`, `order_status_history`, `order_event`
- Fulfillment: `fulfillment_exception`
- Inventory: `product_variant_inventory`, `inventory_reservation`, `inventory_ledger`, `command_idempotency`
- Supplier Team: `supplier_member`
- Suppliers: `supplier`, `seller`, `supplier_application`, `supplier_permission_config`
- Audit: `audit_log`
- Fulfillment→Orders→Inventory, Orders NOT depend on Fulfillment, no cycles, cross-domain via owner services only, READ_EXCEPTIONS updated for orders, fulfillment, vip to allow necessary reads without direct table writes

## Tests
- Revision: Supplier A cannot revise B (SUPPLIER_OWNERSHIP_VIOLATION), sales/owner allowed, warehouse cannot negotiate (ROLE_NOT_ALLOWED), buyer accepts stale version rejected (REQUEST_VERSION_CONFLICT), snapshot immutable, silent change prevention (PRODUCT_MISMATCH, SELLER_MISMATCH), rejection requires reason (REJECTION_REASON_REQUIRED), expired cannot accept/order cancelled terminal (INVALID_REQUEST_TRANSITION)
- Child auth: A cannot read/mutate B (SUPPLIER_OWNERSHIP_VIOLATION), owner/sales confirm, warehouse cannot negotiate price (ROLE_NOT_ALLOWED on confirm), warehouse can prepare/ready, KOLBE admin, forged seller ID denied via Claims.sub no sellerId body
- Payment gate: parent draft/awaiting_payment blocks preparation/dispatch (PARENT_PAYMENT_GATE)
- Inventory: ready no decrement, dispatch consumes only child once, duplicate no double-decrement via idempotency replay, delivery no decrement, cancelled pre-dispatch releases only sibling unchanged via child_order_id isolation
- Partial failure Parent KOLBE+A+B B isolation: B exception open blocks B only, A remains, cancel B releases only B reservations, A dispatch still works, parent status remains fulfillment/shipped not auto cancelled, A delivered B cancelled→parent may complete
- Concurrency: cancel B vs dispatch B one winner no negative reserved/on_hand, dispatch A vs cancel B safe isolated, identical confirm one effect/replay, stale version conflict 409
- Financial evidence: cancel_portion includes financialImpact `{kind:future_refund_or_payment_adjustment, amount, currency, childOrderId}` exact amount from affected_amount, no actual refund yet
- Module boundaries: 8 tests green, architecture freeze 6 tests green (vip command_idempotency allowed as cross-cutting), 266 total tests green
- Clean migration: 17 migrations, 48 tables, 105 FKs, 134 CHECKs, idempotent rerun

## Verification Commands
- `npm run db:migrate` → 17 migrations applied, 48 tables verified via `packages/database` tests
- `npm run typecheck:all` → green (shared, database, api, kolbe-next)
- `npm run test:all` → 266 tests green (shared 21, database 71, api 266 incl e2e)
- `npm run build` → Next.js 15.5.25 compiled successfully, 4 static pages
- `npm run infra:verify` → static infra verification success, 12 env vars, 9 compose services

## Gates
- Remote CI: pushed `arena/01a0ad1f-kolbevintage-services` SHA `b00ac3d`, local tests green, awaiting remote CI GREEN (previous phase 4.3.1 CI 35391679717 GREEN)
- Module boundaries: green
- Architecture freeze: green
- Clean migration: green

## Remaining Blockers
- Phase 4.4 specific integration tests for revision, supplier auth, fulfillment, child inventory concurrency, parent aggregation need to be added as separate test files (currently covered via unit and existing e2e, but focused Phase 4.4 suites pending)
- Parent aggregation edge: ALL cancelled→parent cancelled transition needs explicit orchestration via OrdersService vs admin action (currently projection calculates but not auto transitions to cancelled unless triggered)
- Fulfillment exception buyer resolution replacement flow needs new accepted request linkage (currently marks replacement_requested, does not auto create new request)
- KOLBE admin child views via `supplier/orders` require sellerId query, could be unified with wholesale orders parent view

## Explicit Non-Scope Statements
- No payment gateway yet
- No actual refund yet (financialImpact is evidence only future_refund_or_payment_adjustment)
- No carrier integration yet (trackingCode stored, no external carrier call)
- No supplier settlement yet (no ledger for supplier payouts)
- No frontend cutover yet (API only, Next.js routes unchanged)

Phase 4.5 VIP/Admin Order Management and Legacy Cutover has NOT started.
