# Pre-Phase 4 legacy audit

Measured at `ef5c4124f2aaf436c89472bf4f1f1526802e805c`. Classification is by implementation, not by table name alone. No code is removed in 3.10. Canonical means the chosen model, not proof that every writer is safe.

## Inventory of implementations

| Classification | Repository path / symbol | Purpose and Phase 4 disposition |
| --- | --- | --- |
| Canonical, migration candidate | `packages/database/src/schema/tables.ts`: wholesaleOrder/Item, purchaseOrder/Item | Existing parent/child order tables with canonical FKs. Evolve in 4.2; do not create parallel order tables |
| Temporary, migration candidate | `frontend-next/server/kolbe-api.ts`: wholesaleOrders, purchaseOrders | Buyer/admin/supplier history reads; replace with scoped paginated Orders queries in 4.5 |
| Temporary, migration candidate | Same file: POST wholesale/orders (~1052) | Direct wholesale creation, minimum 12 pieces, Number totals, variant-only joins/reservation. Replace with accepted-request conversion in 4.3 |
| Temporary, migration candidate | Same file: admin/orders/:id/approve (~1423) | Supplier grouping and purchase order inserts. Omits required product_id for child items; null KOLBE supplier fails current schema. Replace under Orders |
| Temporary, migration candidate | Same file: updatePurchaseOrder (~621), supplier/orders/:id/status (~894), admin/purchase-orders/:id/status (~1390) | Fulfillment transitions/tracking, stock decrement on delivery; move to Orders/Fulfillment and consume at dispatch |
| Temporary, migration candidate | Same file: admin/orders/:id/cancel (~1464) | Direct reserved decrement by variant only; repeated cancellation can affect unrelated holds; move to idempotent Inventory release orchestration |
| Canonical foundation, incomplete | `apps/api/src/modules/vip/vip.service.ts`, vip.logic.ts/controller.ts | Requests, subscriptions and request states. No complete supplier response/order conversion API; identity sub/id mismatch, no limits/history/locking |
| Canonical foundation, unsafe transaction implementation | `apps/api/src/modules/inventory/inventory.service.ts`, cutover.service.ts, expiration.ts | Local stock/holds/ledger, package availability. Preserve owner; implement I-01–I-19 closure, not another stock engine |
| Canonical foundation | `apps/api/src/modules/offers/offers.service.ts`, catalog/catalog.logic.ts | Package creation and validation, tiers. Preserve recipes and commercial separation; add immutable query snapshots |
| Deprecated calculation, migration candidate | `apps/api/src/modules/offers/offers.logic.ts`: calculateMoqInPieces | BOX x5/CARTON x20 assumptions conflict with explicit recipe units; replace when Phase 4 consumes quantities |
| Canonical pure foundation | `packages/shared/src/order-status.ts`, money.ts, tests | Reuse transition/money primitives; future state vocabulary requires coordinated DB migration, not direct overwrite |
| Temporary retail implementation | `frontend-next/server/kolbe-api.ts`: POST retail/orders (~1807); server/retail-pricing.ts | Active retail server pricing/idempotency/snapshots; preserve retail behavior and regression tests; separate future cutover |
| Canonical current retail tables | `tables.ts`: retailOrder/Item | Retail structured snapshots, no wholesale merge; checkout owner currently in registry |
| Temporary, migration candidate | `kolbe-api.ts`: supplier/rfqs/:id/quote (~918), admin/rfqs (~1488); schema rfq/quote | Negotiated procurement. Inserts omit newer required canonical IDs; no verified quote-to-order conversion. Keep separate from wholesale_request |
| Temporary API adapters | `frontend-next/storefront/lib/wholesaleApi.ts`, wholesaleVipApi.ts; `frontend-next/supplier-src/api.ts` | Clients of legacy orders/catalog/RFQ; contract cutover needed after NestJS parity |
| Temporary presentation | `frontend-next/storefront/pages/Wholesale.tsx`, WholesaleAdmin.tsx, WholesaleDashboard.tsx, VIPPortal.tsx; supplier-src/App.tsx, workflows.tsx | Buyer/admin/supplier order surfaces; no UI changes in 3.10; replace data adapters only during planned cutover |
| Canonical client-owned draft | `frontend-next/storefront/store.tsx`, components/CartDrawer.tsx, pages/Cart.tsx, Checkout.tsx | Cart selections/localStorage are not inventory or historical order authority; server revalidates every submission |
| Temporary local/mock operational state | `frontend-next/storefront/pages/Admin.tsx`, AdminOperations.tsx, AdminCRM.tsx and `frontend-next/supplier-src/data.ts`, features.tsx | Local/demo order and CRM concepts cannot become the order database; audit actual data source before wiring future screens |
| Deprecated forks | `frontend-kolbe/`, `frontend-supplier/`, old apps supplier artifacts | Historical storefront/supplier copies. Do not develop new order flows here; extraction/deletion is separate scope |
| Historical only | `packages/database/migrations/0000*`, `0005*`, `0006*`, `0007*`, `0008*`; old phase reports | supplier_product, supplier_variant, supplier_inventory and mapping tables are historical create/drop references, not authorities to restore |

## Critical compatibility facts

- Migration 0008 removed legacy commerce tables and offer inventory columns. Current schema keeps only product_variant_inventory, inventory_reservation and inventory_ledger for inventory.
- Existing canonical FKs do not validate that a selected offer and inventory row belong to the same seller. The legacy variant-only joins can mix sellers.
- Legacy `catalog()` filters offer status `active`, but offer lifecycle uses published; this must be reconciled during API parity, not copied into new query contracts.
- `purchase_order_item.product_id` is required, but legacy approval insert omits it. `seller_offer_id` is nullable in current schema, despite older reports calling all canonical fields NOT NULL.
- Parent wholesale order has no package/price-basis snapshots, currency or status history. Existing name/SKU/unit_price snapshots are useful but insufficient.
- VIP legacy account gating and NestJS subscription+account gating differ. Resolve one eligibility query before conversion; selecting a plan must remain pending.
- `CurrentUser` returns Claims with `sub`. Several Phase 3 controllers use `user.id`; metadata-only authorization tests do not catch that endpoint identity defect.

## Cutover rule

Inventory/catalog must never gain an Orders dependency. Orders initiates conversion and invokes owner services; VIP never writes inventory. Suppliers can propose offers only through Offers; supplier membership creation is a separate existing ownership exception. Catalog's direct offer writes and Offers' Seller inserts remain measured debt, not desired patterns.

Before enabling new order writes: migrate/validate existing rows, reconcile legacy reserved balances with real holds (do not fabricate history), capture golden API scenarios, pass multi-seller/KOLBE integration and concurrency tests, switch routes to one writer, then disable superseded legacy mutations. Compatibility readers may remain until clients migrate. Rollback of routing must not re-enable the unsafe old writer after new allocation semantics are in use; use read-only mode and forward repair.

## Test coverage limitation

Current database tests verify canonical FKs/legacy absence, not legacy approve/fulfill route correctness. Inventory tests largely exercise pure helpers; wholesale-request-flow.spec.ts includes descriptive flow assertions rather than order conversion. The existing boundary test's broad READ_EXCEPTIONS and limited import regex do not prove all write ownership. Phase 3.10 adds targeted architectural checks, not a claim that all runtime violations are fixed.
