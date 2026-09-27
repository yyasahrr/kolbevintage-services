# Portal redesign truth audit

This audit records the current implementation boundary for the system-wide Soft UI redesign. A polished screen is not evidence of a backend-owned workflow; the owner and data source must be identified before a control can mutate business state.

| Area | Current source of truth | Active UI decision | Remaining work |
| --- | --- | --- | --- |
| VIP catalog, product series, request negotiation | Canonical wholesale API and server-owned package/offer contracts | Commerce-first catalog, color-specific series configurator and buyer request flow are active | Authenticated browser proof and visual pass across the full buyer journey |
| VIP orders, invoices, membership, addresses, support | Canonical buyer APIs | Route-driven buyer surfaces use server-derived state | Full mobile, zoom, dark-mode and failure-state audit with seeded accounts |
| Admin CRM contacts | `GET /api/v1/admin/crm/contacts` and `GET /api/v1/admin/crm/contacts/:id` | Search, stage filter, pagination and detail use protected API reads; no sample/localStorage customer records | Owner-backed VIP membership join, notes/tasks and mutation permissions |
| Admin retail overview | `GET /api/v1/admin/retail/dashboard` (`retail:dashboard:view`) | Server-derived sales, live queues and recent exceptions are active | Authenticated visual proof and deeper queue drill-down |
| Admin retail catalog/orders, returns, messaging, campaigns, reports, system | Backend domains exist, but the old active views were browser-owned or fixture-owned | Active routes show explicit integration boundaries rather than fictitious operational data | Build canonical admin reads/actions and their permission-aware interfaces |
| Supplier portal | Supplier backend plus existing portal-specific runtime and CSS | Existing operations retained; token aliases now map to the shared soft design foundation | Screen-by-screen product editor, orders, offers, finance and auth redesign |
| Retail storefront | Mixed static storefront catalog and canonical commerce APIs | Existing retail experience retained; fake email/coupon popup removed from public runtime | Canonical product/listing cutover, real promotion issuance if needed, and comprehensive commerce/auth visual redesign |

The shared design system remains `frontend-next/shared/design` (semantic tokens, foundation and components); this work does not create a second token source. Any deferred route must state its limitation explicitly instead of deriving price, entitlement, seller identity, availability or order/invoice state in the browser.
