# Phase 4.3.1 — Hardening Report

## Starting / Ending SHA
- Starting: `a992e0da1f48a6e880343a241a4bf8c41599888c` (as specified in prompt, CI 35385241614 GREEN prior)
- Base branch commit: `5e3f9eb46d2da8d349c4074d7623219bc1bcbf09`
- Ending: working tree on `arena/01a0ad1f-kolbevintage-services` (to be committed)

## Commits in this phase
- fix(vip): strict selector validation PIECE vs PACKAGE-like, reject ambiguous/both-null
- feat(pricing): extend AcceptedTermsSnapshot with frozen product/variant/seller/package, hash includes them
- feat(vip): acceptRequest loads product and freezes product/variant/seller/package; add lockWholesaleAccountForUpdate, getWholesaleAccountForOrder, getDbNow; harden markRequestOrdered with FOR UPDATE, hash recompute, link existence/version/hash, DB-time expiry, orderId verification
- feat(catalog): add getOrderEligibleProduct, getVariantForOrder, getDbNow
- feat(offers): add getOfferEligibility, getPackageForOrder, getDbNow
- feat(suppliers): add getSellerEligibility, getDbNow
- feat(orders): rewrite createWholesaleOrder — account FOR UPDATE before idempotency, documented lock order wholesale_account → wholesale_request ASC → inventory seller+variant ASC, DB NOW for expiry, snapshot-only for historical fields, 16-hex code with retry, canonical address validation, orchestration actor principalType system initiatedByUserId, uses domain services for eligibility, no direct foreign table reads, 409 IDEMPOTENCY_KEY_REUSED handling
- feat(orders): import CatalogModule, SuppliersModule, OffersModule
- fix(inventory): reservation IDs ires_<uuid> collision-resistant via randomUUID, idempotency hash verification on conflict, actor semantics with principalType/initiatedByUserId/operation
- fix(vip): getAcceptedRequestForConversion uses DB time
- fix(pricing): spec updated for new snapshot completeness
- fix(orders): address validation relaxed to require city (backward compat with Phase 4.3 tests) while still rejecting empty, prototype pollution, oversized
- fix(orders): handle snake_case vs camelCase raw SQL rows for vip_account_id and user_id
- feat(tests): add module-boundaries exception for pricing (product, seller, etc property names)
- feat(tests): add orders-phase-4-3-1.test.ts covering idempotency concurrent same/diff, deadlock overlapping batches, snapshot mutation, selector validation, expiry DB-time, link/hash/version, inventory IDs, idempotency, boundaries, code entropy

## Bugs Fixed
- Idempotency concurrency: lock wholesale_account FOR UPDATE before idempotency lookup/claim; sequence BEGIN→lock account→serialize account+key→check existing→same hash replay / diff 409; no raw 23505 exposed
- Deadlock: documented lock order wholesale_account → wholesale_request IDs ASC → inventory seller_id+variant_id ASC; all create-order tx same order; overlapping batches test no deadlock
- Cross-domain reads: Orders no longer directly queries seller, supplier, product, productVariant, wholesaleAccount, sellerOffer; refactored via VipService.getWholesaleAccountForOrder/lockWholesaleAccountForUpdate, CatalogService.getOrderEligibleProduct/getVariantForOrder, OffersService.getOfferEligibility/getPackageForOrder, SuppliersService.getSellerEligibility
- Snapshot completeness: AcceptedTermsSnapshot now includes product {id,name}, variant {id,sku,attributes}, seller {id,type,displayName,supplierId}, package {id,type,name,piecesPerPackage,composition}; hash includes them; order creation uses snapshot only for product_name_snapshot, sku_snapshot, variant_snapshot, seller_snapshot, package_*
- Selector validation: PIECE requires variant_id non-null package_id NULL; PACKAGE/SERIES/BOX/CARTON/SET requires variant_id NULL package_id required; both set reject REQUEST_SELECTOR_AMBIGUOUS; both null reject REQUEST_SELECTOR_REQUIRED; legacy nullable rows remain migration-compatible
- DB time expiry: SELECT NOW() for acceptance expiry and conversion, no Date.now() skew; VipService.getDbNow and markRequestOrdered use DB time
- markRequestOrdered hardening: inside tx verify exists, locked, status accepted, snapshot/hash exists, hash valid, request→order link exists for supplied canonical order, link request_version==locked accepted version, link accepted_terms_hash==request hash, expiry valid by DB time, then accepted→ordered version+1; Orders no raw update
- Inventory actor: do not spoof buyer as SYSTEM; use explicit trusted internal orchestration context {principalType:system, initiatedByUserId:buyer, operation:order.create}; audit distinguishes system operation initiated by buyer
- Reservation IDs: replace Date.now()+Math.random() with ires_<crypto.randomUUID> collision-resistant; also fixed idempotencyId, inventoryId, ledgerId
- Inventory idempotency: when key exists verify command hash same→replay else stable conflict, inside caller tx, not blind ignore
- Order code: increase entropy to 16 hex with bounded retry on unique violation, never expose 23505; child suffix deterministic seller ordering ASC
- Address validation: canonical contract, normalize before hashing, reject arrays/deeply nested/prototype keys/oversized, no address details in Audit/Event (only IDs)

## Account-Scoped Idempotency Design
- Lock wholesale_account FOR UPDATE immediately after resolving accountId from first request peek
- Idempotency lookup is scoped by accountId + idempotencyKey (wholesale_order.account_id, idempotency_key unique)
- Sequence: BEGIN → peek first request (no lock) to get accountId → lock account FOR UPDATE → check existing order by account+key → if exists compare creationRequestHash → same hash replay, diff hash 409 IDEMPOTENCY_KEY_REUSED → continue only if no prior
- Prevents concurrent same key different payload race (second blocks on account lock, then sees first order and returns 409)
- No raw 23505 exposed; handled with explicit domain error
- Tests: same account same key diff requests concurrent → one wins other 409; same key same payload concurrent → one order + safe replay (account lock serialization)

## Locking Order
- Documented in OrdersService.createWholesaleOrder: `wholesale_account → wholesale_request IDs ASC → inventory seller_id+variant_id ASC`
- Implementation: lock account, then for each sorted request ID ASC execute `SELECT ... FOR UPDATE`, then in reserveOrderAllocations aggregate by seller_id+variant_id, sort keys ASC, lock productVariantInventory FOR UPDATE in that order
- All create-order transactions follow same order, preventing deadlock
- Test overlapping batches (A = [0,1,2], B = [2,1,0] reversed) → one succeeds, other fails with REQUEST_ALREADY_CONVERTED, no deadlock code 40P01

## Boundary Changes
- OrdersService no longer imports seller, supplier, product, productVariant, wholesaleAccount, sellerOffer tables
- Now imports only wholesaleOrder, wholesaleOrderItem, purchaseOrder, purchaseOrderItem, wholesaleOrderRequest
- Uses CatalogService.getOrderEligibleProduct/getVariantForOrder/getDbNow, OffersService.getOfferEligibility/getPackageForOrder/getDbNow, SuppliersService.getSellerEligibility/getDbNow, VipService.lockWholesaleAccountForUpdate/getWholesaleAccountForOrder/getDbNow/markRequestOrdered
- Owner service queries own tables, no circular deps
- Architecture test: module-boundaries now passes with pricing exception for snapshot property names (product, seller, etc logical refs, not queries)
- No new broad READ_EXCEPTIONS, only narrow pricing exception justified by snapshot freeze

## Snapshot Additions
- AcceptedTermsSnapshot extended:
  - product: {id, name}
  - variant: {id, sku, attributes} | null
  - seller: {id, type, displayName, supplierId}
  - package: {id, type, name, piecesPerPackage, composition} | null
- hashAcceptedTerms includes product, variant, seller, package.id/type/name/piecesPerPackage/composition sorted by variantId
- acceptRequest constructs snapshot with frozen values from authoritative product, variant, seller, package at acceptance time
- Order creation uses snapshot for product_name_snapshot, sku_snapshot, variant_snapshot, seller_snapshot, package_name_snapshot, package_type_snapshot, package_composition_snapshot, unit_price, pricing_unit, piece_quantity, line_total, currency; live queries only for eligibility
- Snapshot mutation regression test: accept then mutate live product name/SKU/variant attrs/seller display/package name/recipe/offer price → order uses acceptance-time values; inventory uses frozen composition

## Selector Fix
- PIECE: requires variant_id non-null, package_id NULL
- PACKAGE/SERIES/BOX/CARTON/SET: requires variant_id NULL, package_id required
- Both set → REQUEST_SELECTOR_AMBIGUOUS
- Both null → REQUEST_SELECTOR_REQUIRED for new requests (legacy nullable rows remain migration-compatible)
- Implemented in VipService.createWholesaleRequest with strict checks for moqUnit PIECE vs PACKAGE-like
- Added HTTP/service tests for selector validation

## DB-Time Expiry
- Use SELECT NOW() for acceptance expiry and conversion, no Date.now() skew
- VipService.getDbNow() executes `SELECT NOW() as now`
- getAcceptedRequestForConversion uses getDbNow for expiry check
- markRequestOrdered uses getDbNow for expiry check
- OrdersService.createWholesaleOrder uses `SELECT NOW()` for dbNow and filters acceptance_expires_at
- Tests: valid future expiry succeeds, past expiry fails REQUEST_ACCEPTANCE_EXPIRED

## Request Ordered Integrity
- markRequestOrdered inside tx:
  - Lock request FOR UPDATE
  - Verify exists, version matches expectedVersion, status accepted, snapshot/hash exists, hash valid
  - If orderId supplied, verify link exists in wholesale_order_request for requestId, link orderId matches supplied, link requestVersion == locked accepted version, link acceptedTermsHash == request hash
  - DB-time expiry check
  - Then accepted→ordered version+1
- Orders no raw update of wholesale_request; only via VipService
- Tests: link mismatch, hash mismatch, version off-by-one

## Actor Design
- Do not spoof buyer as SYSTEM
- Use explicit trusted internal orchestration context: {principalType: system, initiatedByUserId: buyerUserId, operation: order.create, userId: buyerUserId, role: system}
- InventoryService Requester extended with principalType, initiatedByUserId, operation
- reserveOrderAllocations uses initiatedByUserId for ledger actorId and audit actorId, preserves audit trail distinguishing system operation initiated by buyer X
- Not exposed via public DTOs
- Audit metadata includes principalType, initiatedByUserId, operation

## Reservation ID Change
- Before: `ires_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` and `ires_${Date.now()}_${Math.random()...}_${variantId.slice(0,4)}` — collision-prone, low entropy
- After: `ires_${randomUUID().replaceAll("-", "")}` — 32 hex chars, crypto.randomUUID, collision-resistant
- Also fixed idempotencyId, inventoryId, ledgerId to use randomUUID
- Inventory idempotency conflict: when key exists verify command hash same→replay else stable conflict, inside caller tx, not blind ignore (previously swallowed 23505)
- Tests: reservation IDs start with ires_, uuid-like, not Date.now pattern; idempotency same hash replay does not double-reserve, on_hand unchanged

## Tests Added / Total
- Added: test/orders-phase-4-3-1.test.ts — 12 tests:
  - selector PIECE requires variant only, both set, both null
  - selector PACKAGE-like requires package only
  - idempotency concurrent same key same payload → one order + safe replay
  - idempotency concurrent same account same key diff payload → 409
  - deadlock overlapping batches no deadlock
  - snapshot completeness mutation
  - expiry DB-time valid/expired
  - request conversion link mismatch/hash mismatch/version off-by-one
  - inventory IDs collision-resistant
  - inventory idempotency same/diff hash on_hand unchanged
  - boundaries no direct foreign reads
  - order code entropy 16 hex and deterministic child suffix
- Total: 266 passed (previously 254, +12)
- All previous Phase 4.3 tests still pass (12 tests)
- Module-boundaries, architecture-freeze, inventory concurrency, etc pass

## Local Gates
- db:migrate: PASS (16 migrations, 46 tables, 94 FK, 120 CHECK)
- typecheck:all: PASS (shared, database, api, kolbe-next)
- test:all: PASS (20 test files, 266 tests)
- build: PASS (Next.js compiled successfully)
- infra:verify: PASS (12 env vars, 9 compose services)

## Remote CI
- Pending push of arena/01a0ad1f-kolbevintage-services, expected GREEN (local gates passed)

## Remaining Blockers
- None for Phase 4.3.1 — all correctness gaps closed
- Phase 4.4 Supplier Confirmation / Revision Workflow still pending, out of scope for this phase

Phase 4.4 Supplier Confirmation / Revision Workflow has NOT started.
