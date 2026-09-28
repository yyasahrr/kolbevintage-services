# Phase 3.10 — Domain ownership freeze

Status: normative target contract, 2026-09-17. Baseline: `ef5c4124f2aaf436c89472bf4f1f1526802e805c`, branch `arena/01a0ad1f-kolbevintage-services`.

This freeze refines [master rules](master-architecture-rules.md), especially A2, A3, A10, A11, A17, A18 and A21. Historical phase reports describe their own checkpoints; their claims of atomic reservations are not current implementation proof. This phase changes documents and architecture tests only. It does not make the current runtime compliant with every target rule.

## Contract index

- [Order boundary](order-boundary.md)
- [Quantity and packages](quantity-and-package-model.md)
- [Inventory contract](inventory-contract.md)
- [Inventory risk register](inventory-risk-register.md)
- [Audit contract](audit-contract.md)
- [Status machines](status-machines.md)
- [Idempotency](idempotency-rules.md)
- [Existing runtime and legacy audit](pre-phase4-legacy-audit.md)
- [Phase 4 execution plan](../phase-plans/phase-4-plan.md)

## Exclusive owners

Marketplace is a business grouping, not an additional NestJS module or second table owner. Seller identity stays with Suppliers; Offers owns commercial terms; Pricing computes prices through Offers' public query contract. No registry/table transfer occurs in 3.10.

| Domain / module | Owned tables | Public services and exclusive mutations | Allowed target dependencies |
| --- | --- | --- | --- |
| Catalog / `catalog` | `brand`, `category`, `product`, `product_variant`, `product_media`, `product_variant_media`, `supplier_product_submission` | CatalogService: canonical content, variants, brand/category and moderated proposals | Audit; shared pure contracts |
| Marketplace identity / `suppliers` | `supplier`, `supplier_application`, `seller`, `supplier_permission_config` | SuppliersService: company, Seller identity/status, permissions | Auth, Audit |
| Supplier team / `supplier-team` | `supplier_member` | Future membership service: membership and role changes | Suppliers, Auth, Audit |
| Marketplace commerce / `offers` | `seller_offer`, `offer_media`, `wholesale_package`, `wholesale_package_item`, `wholesale_pricing_tier`, `rfq`, `quote` | OffersService: offers, package composition, tiers, negotiated commercial proposals | Catalog, Suppliers, Supplier-team, Audit |
| Marketplace pricing / `pricing` | No current tables | Future PricingService: authoritative integer price calculation and quote snapshots; never inventory writes | Offers |
| Inventory / `inventory` | `product_variant_inventory`, `inventory_reservation`, `inventory_ledger` | InventoryService alone: balances, holds, release, consumption, adjustments; CutoverService delegates | Offers, Catalog, Suppliers, Audit |
| VIP / `vip` | `wholesale_account`, `vip_plan`, `vip_subscription`, `wholesale_request` | VipService: entitlement, limits, requests, supplier response and request conversion marker | Auth, Customers, Pricing, Offers, Audit |
| Orders / `orders` (future) | Existing `wholesale_order`, `wholesale_order_item`, `purchase_order`, `purchase_order_item`; future `order_status_history`, `order_events` | Future OrdersService: parent and seller child orders, immutable item snapshots, transitions and history | VIP, Pricing, Offers, Inventory, Suppliers, Audit |
| Fulfillment / `fulfillment` (future) | Future fulfillment plans/allocations, not order tables | Future FulfillmentService: preparation/allocation commands; invokes Orders transitions and Inventory commands | Orders, Inventory, Audit |
| Audit / `audit` | `audit_log` | AuditService: append and authorized queries only | Database infrastructure; no business domain |
| Admin / `admin` | None | Authorized orchestration of owning services; no SQL writes | Public domain services |

These are target service dependencies, not a claim that `registry.ts` already contains every future edge. Update the registry alongside the future implementation. Orders continues owning the existing seller child order tables; do not silently assign them to Fulfillment or add parallel `supplier_order` tables.

## Direction and communication

Controllers validate concrete DTOs and obtain verified `Claims.sub`; TypeScript `{ id: string }` annotations do not transform Claims. Buyer/account and supplier/seller identity are resolved server-side. A requested resource ID is a selector, never authority.

Cross-domain access uses exported services/commands/query DTOs. Repository/table imports and cross-domain SQL writes are forbidden in the target. The transaction initiator passes one transaction executor to participant services. Only each owner writes its own tables; only the initiator commits. Database FKs to another domain do not create reverse service dependencies.

Orders calls VIP to atomically mark an accepted request ordered. VIP never imports Orders. Inventory accepts opaque allocation/reference IDs and never imports Orders. Fulfillment calls Orders; Orders never imports Fulfillment. Catalog never imports Orders, Inventory, VIP or payment/fulfillment logic. Audit has no reverse business dependency. Synchronous SQL work can share the executor; external calls cannot occur while locks are held.

Supplier submissions remain Catalog-owned proposals with explicit `commercial`, not generic attributes. Future Admin review orchestration calls Catalog to approve content and Offers to create a draft offer using one transaction; Catalog must not acquire an Offers dependency that creates a cycle. Existing Catalog direct offer inserts are a documented cutover exception, not the target.

## Frozen invariants

- Retail is KOLBE-only. Suppliers cannot set retail price or become a retail seller.
- Wholesale supports KOLBE and SUPPLIER; exclusive KOLBE products reject supplier offers.
- A supplier proposes content through `supplier_product_submission`; admin review is mandatory; matching never auto-merges or publishes.
- Migration 0010 and commercial separation remain intact.
- Inventory is keyed by `(seller_id, variant_id)` and has one writer. Supplier external stock ownership is distinct from Kolbe's authoritative local reservation accounting.
- Subscription selection is pending; client payment references cannot grant access.
- Historical order quantities, seller, prices and package composition are immutable from creation.
- Order, inventory ledger, financial ledger, payment, invoice and shipment are separate concepts.

## Measured exceptions and enforcement limits

At baseline, Inventory and Catalog have no Orders runtime dependency; VIP has no direct inventory writes; Suppliers does not write Offers tables. New architecture tests enforce those specific boundaries and full registry cycle detection without weakening existing tests.

Existing violations remain: Catalog inserts seller offers on approval; Offers creates Sellers; Suppliers inserts supplier members; Inventory inserts Audit rows directly; the Next.js handler performs inventory/order writes. Existing `READ_EXCEPTIONS` do not distinguish reads from writes and are not proof of A3. See the linked risk/legacy registers for owners and closure gates. No new general allowlist is authorized by this freeze.

Changing a frozen invariant requires a documented architecture decision, an explicit compatibility/data plan and affected tests. Phase 4 implementation has NOT started.
