# Wholesale order boundary — Phase 4 design only

Normative design under [domain ownership](domain-ownership-freeze.md). No schema or runtime changes in Phase 3.10.

## Aggregate decision

Evolve the existing `wholesale_order` and `wholesale_order_item`; they already exist. Evolve existing `purchase_order` / `purchase_order_item` as seller child orders owned by Orders. The public business name is seller order, including KOLBE. Do not create a competing `supplier_order` system. A physical rename, if later desired, needs an explicit migration and API compatibility plan.

The parent belongs to one buyer VIP account and can span sellers. Seller and nullable supplier belong to each child and immutable line snapshot, not a misleading single parent supplier field. KOLBE has a seller ID and null supplier ID; SUPPLIER has both. Future constraints must enforce that relationship. A parent API exposes seller orders as a collection, even for one seller.

## Required future records

| Record | Required fields and relationships | Indexes / constraints |
| --- | --- | --- |
| `wholesale_order` (existing, evolve) | id, unique order_code, account_id, authenticated buyer_user_id, status, currency, items/shipping/discount/tax/grand totals, pricing_version, immutable buyer/address/commercial snapshots, created/confirmed/cancelled/completed timestamps, version | account + created_at; status + created_at; nonnegative bounded totals; explicit total equation; account/user consistency through owner service |
| `wholesale_order_item` (existing, evolve) | id, order_id, seller_offer_id, seller_id, nullable supplier_id, canonical product_id, canonical variant_id, package reference and immutable recipe/group ID, ordered quantity and sale unit, expanded piece quantity, unit price + pricing unit, exact line_total, currency, product/SKU/variant/package/tier snapshots | order_id; seller_id + order_id; quantity > 0; immutable snapshots; validate product/variant/offer/seller consistency; restrictive FKs |
| `purchase_order` (existing seller child, evolve) | id/code, wholesale_order_id, seller_id, nullable supplier_id, status, currency/totals, shipping responsibility, preparation deadline, lifecycle timestamps, version | unique parent + seller for initial single-child-per-seller scope; seller + status + created_at; KOLBE/SUPPLIER consistency |
| `purchase_order_item` (existing, evolve) | parent wholesale_order_item_id, child_order_id, canonical references, allocated pieces and immutable price allocation | unique parent-item + child; allocation cannot exceed parent quantity; totals reconcile |
| `order_status_history` (new, future) | id, parent or child order FK (exactly one), from/to status, actor context, reason, command_id, version, created_at | aggregate + version unique; aggregate + created_at; append-only |
| `order_events` (new, future) | id, parent or child FK, event_type, schema_version, aggregate_version, safe payload, command_id, created_at | event identity unique; aggregate + version + event sequence; append-only |

Package orders expand into one commercial line with frozen package composition snapshot, not six variant lines. Each package line has package_id and composition snapshot, and will later create multiple InventoryReservations (one per variant in recipe). A single variant line has variant_id and no package. The selector CHECK enforces exactly one of variant_id/package_id (or both null for legacy). Allocated item totals sum exactly to the group price; repeated copies of group metadata are not summed.

Link every expanded item to Inventory-owned reservation/allocation references. **Phase 4.2.2 — Multi-request link implemented**: `wholesale_order_request` Orders-owned link table `id, order_id FK RESTRICT, request_id FK RESTRICT UNIQUE (one request→at most one order), request_version, accepted_terms_hash, created_at, UNIQUE(order_id,request_id), no CASCADE`. This is the authoritative relation for multi-request → one parent order. `wholesale_order.originating_request_id` remains as legacy compatibility pointer (single request reference) but canonical engine MUST use `wholesale_order_request`. VIP owns request state; Orders owns conversion links. Exactly one order may consume a given accepted request version, enforced by UNIQUE(request_id).

Multi-seller parent order: one wholesale_order can link to multiple accepted requests from different sellers (Supplier A + Supplier B + KOLBE) under same VIP account and buyer_user, same currency, all accepted, snapshots valid, none already linked, unexpired. Example valid: VIP A Supplier X+Y+KOLBE under one parent. Invalid: VIP A + VIP B requests in same batch must reject atomically.

## Creation and immutable history

Before creation, validate account/subscription/plan limits, verified `Claims.sub`, active seller, published offer/product, canonical relationships, unit/MOQ/tier consistency, accepted request version and confirmation deadline. Supplier acceptance is evidence of external availability, not a guarantee; Inventory rechecks local allocatable pieces under locks.

One transaction creates the order and variant snapshots, seller children, Inventory holds/ledger, VIP conversion marker, order history/events, idempotency result and Audit records. Orders orchestrates; every domain writes through its owner service using the same executor. Any failure rolls everything back. An accepted request cannot be marked ordered independently.

The persisted `draft` is already an immutable order snapshot. Browser cart/request drafts may change; a persisted order cannot be repriced or have its recipe silently edited. An amendment requires a new explicitly related revision and fresh acceptance/reservation transaction; never overwrite the old snapshot. Corrections are append-only events, not edits to history.

Current catalog IDs remain navigational/restrictive references; rendering an old order uses stored snapshots. Prices, currency, units, seller identity, addresses and package composition never come from live joins when displaying historical commercial terms.

## Payment and fulfillment boundary

`awaiting_payment` is an order execution gate, not proof of payment. Payment state/evidence remains owned by future Payments. No invoice/payment/shipping implementation is authorized here. Orders must not import Payments or Shipments back; trusted future application orchestration delivers verified release/dispatch/delivery commands to Orders.

Stock is reserved at creation and consumed once at dispatch/handoff, not at payment, acceptance or delivery. Delivery completes the order without a second decrement. Dispatched items cannot use pre-dispatch cancellation; returns belong to a later workflow. This resolves inconsistent timing descriptions in earlier phase reports.

Initial all-or-nothing request conversion does not imply single-seller orders. No automatic partial acceptance, seller substitution or partial cancellation. Parent `shipped` means every uncancelled child is shipped/delivered; parent completion means all are delivered. Future split shipment support must preserve these aggregate predicates.

## Baseline blockers

Orders is still planned in `registry.ts`. Legacy approval omits required `purchase_order_item.product_id`; KOLBE grouping produces null where `purchase_order.supplier_id` is currently NOT NULL. Legacy stock changes omit seller qualification and bypass reservations/ledger. Existing item `seller_offer_id` is nullable despite older report wording. These require explicit migration/cutover tests before the new creation endpoint is enabled; this document does not fix them.
