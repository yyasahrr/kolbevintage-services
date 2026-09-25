# Phase 6.0 Frontend Truth Inventory

This deterministic inventory describes current HEAD. Its executable counterpart is `frontend-next/truth-registry.ts` and is enforced by `frontend-next/test/phase-6-0-truth-registry.test.ts`.

## Coverage totals

| Metric | Count |
|---|---:|
| Registered features | 49 |
| Canonical contract mapping | 49 / 49 (100%) |
| UNKNOWN | 0 |
| Feature deletion decisions | 0 |
| Visual redesigns | 0 |
| Backend schema changes | 0 |

### By portal

| Portal | Features |
|---|---:|
| ADMIN | 16 |
| CMS_EDITOR | 1 |
| PUBLIC_STOREFRONT | 9 |
| RETAIL_CUSTOMER | 5 |
| SHARED | 3 |
| SUPPLIER | 10 |
| VIP_WHOLESALE | 5 |

### By current truth classification

| Classification | Features |
|---|---:|
| CANONICAL_API | 1 |
| COMPAT_PROXY | 7 |
| LOCAL_STORAGE | 7 |
| STATIC_FIXTURE | 4 |
| HARDCODED_RUNTIME | 8 |
| MIXED | 17 |
| PRESENTATION_DEFAULT | 2 |
| BROWSER_EPHEMERAL | 3 |
| DEPRECATED | 0 |
| UNKNOWN | 0 |

There are seven pure localStorage business-truth features, four pure static-fixture business-truth features and eight pure hardcoded-runtime business-truth features. Mixed entries identify their decomposition in the registry instead of hiding multiple authorities under one label.

## Browser persistence audit

Business-relevant keys found in storefront and Supplier sources include:

- CMS/editorial: `kolbe-site-content-v3`, `kv_admin_articles`, `kv_homepage_journal_pins`, `kv_retail_policies_v1`.
- Catalog/commerce administration: `kv_admin_products_v2`, `kv_admin_product_trash`, `kv_catalog_taxonomy_v1`, `kv_kolbe_wholesale_catalog_v1`, `kv_campaign_center_v1`, `kv_coupon_center_v1`, `kv_vip_plans_v1`.
- CRM/Support/Notifications: `kv_admin_customers`, `kv_crm_focus_customer`, `kv_marketing_outbox_v1`, `kv_support_conversations_v1`, `kv_support_websocket_url`, `kv_sms_templates_v1`, `kv_sms_provider_v1`, `kv_marketing_messages_v1`, `kv_wholesale_tickets`.
- Wholesale/Supplier operations: `kv_wholesale_membership`, `kv_wholesale_draft`, `kv_wholesale_orders`, `kv_admin_wholesale_requests`, `kv_supplier_holidays`, plus generic feature keys in `supplier-src/features.tsx`.
- Admin operations: `kv_admin_orders`, `kv_admin_returns`, `kv_admin_warehouses`, `kv_admin_system` and page-edit markers.
- Presentation/drafts/telemetry: `kolbe-storefront-theme-v1`, `kv_cart`, `kv_wish`, `kv_compare`, `kv_commerce_events_v1`.

Theme, cart draft, compare state and bounded telemetry are not automatically business authority. Published CMS content, memberships, submitted orders, product truth, campaigns, provider secrets, customer records and operational workflows are business-relevant and have explicit replacement targets.

No IndexedDB use was found. No sessionStorage business authority was found. `BroadcastChannel` is used for same-browser site-setting/editor synchronization and does not elevate the cache to published authority. Session cookies are handled through credentialed fetch/HttpOnly behavior rather than browser-owned bearer tokens.

## Fixtures and hardcoded runtime data

Primary fixture/default sources are `storefront/siteData.ts`, `storefront/data/catalog.ts`, `supplier-src/data.ts` and hardcoded datasets embedded in Supplier/Admin page modules. Presentation defaults may remain. Product, KPI, order, finance, inventory, campaign, CRM, notification, production and QC values must be replaced by their mapped owner contracts.

Browser-generated business identifiers were found in Supplier tracking/campaign/role/holiday flows and local Wholesale order history. They remain inventoried for their assigned cutover checkpoints and are not treated as canonical IDs.

Browser-side arithmetic currently formats or previews cart, Wholesale draft, pricing and KPI values as `number`. All monetary registry entries require decimal strings from the API, formatting-only conversion and no float-based authoritative recomputation.

## API and compatibility audit

The current compatibility inventory was recalculated from `phase-5-12-route-inventory.json` and the current `kolbe-api.ts` dispatcher:

| Route status | Count |
|---|---:|
| Total | 47 |
| NEXT_PROXY_TO_NEST | 42 |
| LEGACY_READ | 0 |
| LEGACY_WRITE | 0 |
| MISSING_CANONICAL_SEAM | 0 |
| DEPRECATED | 2 |
| STATIC/MOCK | 3 |

Current compatibility callers are concentrated in `storefront/lib/siteAuthApi.ts`, `storefront/lib/wholesaleApi.ts`, `storefront/lib/wholesaleVipApi.ts`, `supplier-src/api.ts`, Checkout, TryOn and CMS site settings. Direct fetch wrappers are duplicated between storefront and Supplier clients. Phase 6.1 will consolidate them without changing runtime behavior in Phase 6.0.

The two deprecated Admin order/purchase-order actions remain terminal and are not mapped as future authority. The TryOn provider edge, health/static routes and client telemetry edge remain explicitly classified. No browser bundle directly imports PostgreSQL or writes SQL.

## Portal findings

- Supplier: API-backed auth/products/orders/RFQs coexist with fixtures and local workflows for analytics, capacity, finance, team, compliance and production/QC. Production is capability-gated; Supplier does not imply Manufacturer.
- VIP/Wholesale: membership/catalog/order APIs coexist with local membership, draft and submitted-order history. Wholesale channel ownership remains KOLBE plus Suppliers.
- Admin: compatibility-backed approvals/catalog/orders/logs coexist with local or hardcoded control-tower, Retail operations, CRM, notifications, settings, finance and production views. Every planned mutation records a granular permission.
- Retail: static product/catalog/discovery presentation coexists with canonical checkout and account/after-sales proxies. Retail seller ownership remains KOLBE.
- CMS: `kolbe-site-content-v3` contains presentation defaults, editor cache and remote-save behavior. CMS owns publication; Promotions owns discounts; Catalog owns products; Search owns discovery.

## Contract gaps and cutover risks

No backend ownership blocker was found. The frontend gaps are contract-consumption gaps assigned to later checkpoints:

1. Four duplicated API/session helpers need one shared typed boundary in 6.1.
2. Several existing response models still type money as `number`; they must consume decimal strings at formatting boundaries.
3. Local list screens assume complete in-memory datasets; their mapped OFFSET/KEYSET/CURSOR contracts need explicit UI pagination.
4. Some screens swallow compatibility errors and return empty arrays, conflating network failure with a true empty state.
5. Admin and Supplier mock/local operations need explicit permission/capability rendering when wired.
6. Browser-stored SMS provider credentials must move to server configuration; no real provider is claimed.
7. Compatibility removal requires portal E2E parity and is deferred to 6.7.

These are not schema or canonical-domain defects. Phase 6.0 changes no runtime behavior.

