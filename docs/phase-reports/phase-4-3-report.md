# Phase 4.3 — Canonical Wholesale Order Engine — Report

## Overview
Phase 4.3 implements the atomic Accepted N → draft wholesale order engine with full transactionality, idempotency, inventory reservation, and audit.

**Endpoint**: `POST /api/v1/wholesale/orders` — VIP buyer auth, `Idempotency-Key` header required, body `{requests:[{requestId,expectedVersion}], paymentMode, shippingAddress, billingAddress}`.

**GET**: `GET /api/v1/wholesale/orders/:id` — buyer owns check, admin bypass.

## Schema 0015
- `purchase_order_item.variant_id` NOT NULL → nullable: allows PACKAGE lines where variant is NULL, one commercial line represents N reservations.
- `order_status_history.from_status` NOT NULL → nullable with CHECK `IS NULL OR IN (...)`: creation history uses NULL→draft truthfully.
- `wholesale_order.creation_request_hash` + index: normalized sorted IDs/versions/paymentMode/normalized addresses canonicalStringify SHA256, used for idempotency durable (account_id,idempotency_key) unique + hash verification.

Migration: `packages/database/migrations/0015_phase_4_3_order_engine.sql`, snapshot `0015_snapshot.json` id `b0f31be0-495b-4e5c-963c-9c06c7de51ca`.

## Canonical Command — OrdersService.createWholesaleOrder

**IDs**: collision-resistant `crypto.randomUUID` prefixed `wo_`, `woi_`, `po_`, `poi_`, `wor_`, `osh_`, `oev_`, no `Date.now()+Math.random`.

**Order Code**: `KV-W-` + 8 hex upper, stable child suffix `-01 -02` sorted `seller_id ASC`, no MAX+1, immutable.

**Hash**: `hashCreationRequest` canonicalStringify sorted request IDs, expectedVersions, paymentMode, normalized addresses (trim, sort keys, remove null/undefined).

**Locking**: deterministic request lock `SELECT ... FOR UPDATE` sorted ID ASC via VipService executor, inventory lock inside `reserveOrderAllocations` aggregated by `seller::variant` sorted seller ASC variant ASC FOR UPDATE, fail entire batch if shortage.

**Validation**:
- paymentMode wholesale only (`prepaid,credit,on_delivery,transfer,cod`), rejects retail BNPL `snapppay,digipay,installment,gateway`.
- addresses size check, duplicate IDs reject.
- batch all-or-nothing same account/buyer/currency, valid snapshots/hashes/versions, not expired/converted, different sellers allowed.
- eligibility revalidation via domain query services only, no table imports: seller active, supplier active/approved, product exists, offer usable (published/active, not archived/suspended/rejected), never reprice live Offer, use accepted snapshot as commercial source, verify `hashAcceptedTerms==stored`.

**Parent draft only**: account_id, buyer_user_id, currency, items_total sum line_total bigint, shipping_total 0, grand_total sum, total_units sum piece, pricing_version `v4.3`, paymentMode, normalized address snapshots immutable, idempotency_key, creation_request_hash, version 0, originating_request_id legacy only. Totals bigint no float.

**Items**: one per request, `source_request_id`, seller/supplier, product, variant XOR package, offer/tier, snapshots frozen, moq/pricing unit, qty/package_qty/piece_qty, unit_price/line_total/currency from snapshot. PIECE variant!=NULL, PACKAGE variant NULL one line N reservations frozen composition.

**Links**: `wholesale_order_request` per request: order_id, request_id, request_version = locked ACCEPTED version (not post-ordered), accepted_terms_hash, unique request_id and order_id+request_id RESTRICT.

**Children**: `purchase_order` one per seller: KOLBE sellerId KOLBE supplier NULL shipping KOLBE, SUPPLIER sellerId supplier actual shipping SUPPLIER, stable suffix sorted seller_id ASC no MAX+1 immutable pending. `purchase_order_item` one per parent wholesale_order_item_id FK, variant NULL for package, no 6 rows, child totals reconcile.

**Inventory**: `reserveOrderAllocations` input orderId allocations[{orderItemId,sourceRequestId,sellerId,variantId,quantity,allocationId}] requester idempotencyKey executor; aggregates seller/variant before validation, locks deterministic, fails entire if shortage, reservation traceability order_id/order_item_id/request_id/allocation_id, unique order_item_id/variant_id/seller_id, reserved+=qty on_hand unchanged, ledger per aggregated, audit per reservation, command_idempotency per seller, replay via existing reservations for orderId, idempotencyKey `${idempotencyKey}:${allocationId}` per reservation and per seller, expiry from acceptance_expires_at else nullable.

**Mark ordered**: via `VipService.markRequestOrdered` same tx, executor-aware.

**History**: same tx NULL→draft v0 parent, NULL→pending children append-only.

**Events**: same tx `order.created`, `request.converted`, `inventory.reserved`, `child.created` safe payloads no PII/secrets append-only.

**Audit**: `AuditService.record(...,tx)` same tx `order.created` actor parent id request IDs child seller IDs item count total currency no raw address; failure rollback.

**Error codes**: `ORDER_IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED` 409, `REQUEST_NOT_ACCEPTED`, `VERSION_CONFLICT`, `ALREADY_CONVERTED`/`REQUEST_ALREADY_CONVERTED` 409, `ACCEPTANCE_EXPIRED`, `ACCEPTED_TERMS_MISSING`/`HASH_MISMATCH` 422, `MIXED_ACCOUNT`/`BUYER`, `CURRENCY_MISMATCH` 400, `SELLER_NOT_ELIGIBLE` 422, `INVENTORY_SHORTAGE` 409, `INVALID_SELECTOR`, `INVALID_PAYMENT_MODE` 400, no raw PG.

**Invariant**: no partial — one PG tx BEGIN→COMMIT else rollback.

## Domain Ownership
- Orders orchestrates.
- VIP writes `wholesale_request`.
- Inventory writes reservation/inventory/ledger.
- Orders writes order/item/link/child/history/event.
- Audit writes audit_log.
- Pricing pure, no direct cross writes.
- No raw `wholesale_request` writes in Orders.

## Idempotency
- Durable `(account_id,idempotency_key)` unique + `creation_request_hash`.
- Same key same → replay existing order even though requests now ordered (check before accepted-only validation via stored order/link).
- Same key diff → 409 `IDEMPOTENCY_KEY_REUSED`.
- Concurrent one order via FOR UPDATE locking.
- Address idempotency: normalized via `normalizeAddress` (trim, sort keys), same key diff normalized → 409, diff key same hash → attempts new order but fails `ALREADY_CONVERTED`.

## Package & Piece Semantics
- PIECE: variant!=NULL, qty=pieceQuantity, 1 reservation.
- PACKAGE: variant NULL, package!=NULL, one commercial line N reservations frozen composition `package.composition[] {variantId, quantity}` * orderedQty. Example Full Series S x2 M x2 L x2 XL x2 2XL x2 3XL x2 qty2 → 1 item piece24 package2 6 reservations 4 each.
- Insufficient: S enough M enough L insufficient → NO ORDER NO ITEMS NO CHILD NO RESERVATIONS NO INVENTORY CHANGE REQUESTS ACCEPTED.

## KOLBE vs Supplier
- KOLBE child `supplier_id NULL`, `shippingResponsibility KOLBE`.
- SUPPLIER child `supplier_id actual`, `shippingResponsibility SUPPLIER`.

## Rollback & Concurrency
- Stock race: 10 available, A 7 B 7 concurrent → one succeeds, reserved 7, no oversell.
- Failure injection after parent/items/child/first reservation/all reservations/first conversion/history/event/audit → rollback verified: counts before==after, no partial, request still accepted.
- No CASCADE FK: checked via `pg_constraint.confdeltype != 'c'`.

## Legacy
- Next.js legacy handlers remain, no extension, no dual-write, no frontend cutover.
- Cutover debt documented: need to switch Next retail checkout to call Nest `POST /api/v1/wholesale/orders` with session cookie, remove legacy order creation, add supplier fulfillment, payment gateway later phases.

## Tests
- `packages/database/test/phase-4-3.test.ts` 9 tests: nullable variant_id, from_status NULL check, creation_request_hash, NULL→draft history, no CASCADE, KOLBE NULL supplier, package line NULL variant, unique conversion, bigint checks.
- `apps/api/test/orders-phase-4-3.test.ts` 12 tests: PIECE reservation, PACKAGE one line N reservations, idempotency replay after ordered, same key diff 409, same request diff keys 409, stock race, snapshot mutation frozen, multi-seller KOLBE+A+B totals reconcile, package insufficient rollback, address normalization, failure injection rollback, bigint totals.
- `apps/api/test/orders-http.test.ts` 3 tests: Idempotency-Key required 400, HTTP create + replay + GET, ownership 403.
- Existing gates: `db:migrate`, `typecheck:all`, `test:all` (Next 120, Database 71, API 251+), `build`, `infra:verify` PASS.

## Remaining
- Phase 4.4+ draft→confirmed, payment gateway, shipping/tracking, supplier fulfillment.
- No production readiness until full e2e with real buyer flow.
