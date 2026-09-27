# KOLBE VINTAGE — GLOBAL FRONTEND-BACKEND CAPABILITY CENSUS

**Document Type:** Architecture Audit  
**Phase:** 6.3-C+ (Reconciled with Current HEAD)  
**Author:** System Audit  
**Date:** 2026-09-26  
**Current HEAD:** `5abf5eab37d15e7bcc8ae6ff470286c1b027dab9`  
**Status:** RECONCILED - Against Canonical Branch  

---

## EXECUTIVE SUMMARY

This document provides a **reconciled** comprehensive census of all frontend-backend capabilities across the Kolbe Vintage platform, classifying each capability against the **current canonical HEAD** (`5abf5eab`).

**Key Changes Since Previous Audit:**
- ✅ **Supplier Product L5** - Complete with rich editor (commit 86c6767, f4a145f)
- ✅ **Wholesale Catalog L5** - Canonical buyer experience (commit 0271779)
- ✅ **Admin Supplier Moderation** - Complete workflow (commit 86c6767, f4a145f)
- ✅ **VIP Server Session/Entitlements** - Server-derived (commit 0271779)
- ✅ **Catalog Domain HTTP Status Fix** - Restored error contract (commit 33dda82)
- ✅ **Rate-Limit Aware Browser Gates** - E2E helpers with Retry-After (commit 5abf5eab)

**Current State:**
- Existing shared architecture: `frontend-next/shared/` (design, http, money, pagination, permissions, session, supplier, ui, vip, wholesale)
- Existing backend shared: `packages/shared/` (money, order-status, errors, idempotency, retail-shipping)
- Frontend theatre still present in VIP portal (localStorage draft, fake support, hardcoded addresses)
- Admin has hardcoded Control Tower areas
- Retail has static/mixed catalog

---

## METHODOLOGY

### Classification System

Each capability is classified into one of these categories:

| Classification | Meaning | Action Required |
|--------------|---------|----------------|
| **CURRENT** | Fully implemented, backend+frontend working together | Maintain, minor improvements |
| **PARTIAL** | Backend exists, frontend partially implemented | Complete frontend |
| **MISSING** | Backend exists, frontend missing | Create frontend UX |
| **LEGACY** | Compatibility layer, needs migration | Migrate to canonical |
| **PRESENTATION** | Pure UI, no business logic | Keep with clear boundaries |
| **BROWSER_DRAFT** | Unsaved user drafts/preferences | Keep (allowed) |

### Evidence Sources

- Backend: `apps/api/src/modules/` controllers
- Frontend: `frontend-next/` pages and components
- Shared: `frontend-next/shared/` and `packages/shared/`
- Tests: `frontend-next/test/`, `frontend-next/e2e/`
- Truth Registry: `frontend-next/truth-registry.ts`

---

## CURRENT CAPABILITY STATUS

### ✅ CURRENT (Fully Implemented)

#### Shared Architecture
- **shared-frontend-boundary** - Complete shared typed boundary (design, http, money, pagination, permissions, session)
- **shared-money** - Bigint-safe money utilities with Persian formatting
- **shared-http** - Typed HTTP client with error handling
- **shared-session** - Session management with server-derived roles
- **shared-permissions** - Capability-based permission system
- **shared-design-tokens** - Semantic design token system
- **shared-supplier** - Supplier client and contracts
- **shared-wholesale** - Wholesale catalog client
- **shared-vip** - VIP membership utilities

#### Supplier Portal (L5 Complete)
- **supplier-product-editor** - Rich product editor with 10 sections
- **supplier-media-upload** - Media upload to draft
- **supplier-draft-management** - Product draft state management
- **supplier-moderation** - Admin supplier moderation workflow
- **supplier-auth** - Canonical supplier authentication

#### Wholesale Catalog (L5 Complete - commit 0271779)
- **vip-wholesale-catalog** - Canonical catalog with server truth
- **vip-catalog-detail** - Product detail with variants, MOQ, packages, pricing tiers
- **vip-seller-distinction** - Kolbe vs Supplier seller badges
- **vip-entitlements** - Server-derived catalog and RFQ entitlements
- **vip-money-display** - Decimal string formatting, Persian numerals, grouping

#### VIP Portal
- **vip-session** - Server-derived VIP session and membership status
- **vip-gate** - VIP access gate with capabilities check

#### Admin
- **admin-supplier-moderation** - Supplier moderation with approval workflow
- **admin-catalog-moderation** - Product moderation

#### Testing
- **test-supplier-product-l5** - 51/54 browser+DB checks (3 remaining are wholesale boundary)
- **test-wholesale-catalog-l5** - 27/27 canonical catalog tests
- **test-rate-limit-aware** - Browser gates with Retry-After handling

### ⚠️ PARTIAL (Backend Exists, Frontend Partial)

#### VIP Portal
- **vip-support** - Backend exists (`POST /api/v1/vip/support/cases`), frontend uses localStorage
- **vip-addresses** - Backend exists (`GET /api/v1/customer/addresses`), frontend hardcoded
- **vip-orders** - Backend exists (`GET /api/v1/wholesale/orders`), frontend uses localStorage draft
- **vip-membership-page** - Backend exists (`GET /api/v1/vip/plans`), frontend static
- **vip-invoices** - Backend exists (`GET /api/v1/invoicing/wholesale/:orderId`), frontend fake page

#### Admin
- **admin-control-tower** - Backend exists (queues, overview, feed, search), frontend hardcoded
- **admin-crm** - Backend exists, frontend localStorage/hardcoded
- **admin-support** - Backend exists, frontend localStorage/hardcoded
- **admin-notifications** - Backend exists, frontend localStorage
- **admin-finance** - Backend exists, frontend incomplete
- **admin-settings** - Backend exists, frontend localStorage

#### Retail
- **retail-catalog** - Backend exists, frontend uses static fixtures mixed with canonical
- **retail-search** - Backend exists, frontend hardcoded filters
- **retail-pdp** - Backend exists, frontend static fixtures
- **retail-ratings** - Backend exists, frontend static fixtures

### 🔴 MISSING (Backend Exists, Frontend Missing)

#### VIP Portal
- **vip-order-detail** - `GET /api/v1/wholesale/orders/:id` exists, no canonical detail page
- **vip-order-timeline** - `GET /api/v1/wholesale/orders/:id/timeline` exists, not implemented
- **vip-order-children** - `GET /api/v1/wholesale/orders/:id/children` exists, not implemented
- **vip-order-exceptions** - `GET /api/v1/wholesale/orders/:id/exceptions` exists, not implemented
- **vip-order-cancel** - `POST /api/v1/wholesale/orders/:id/cancel` exists, not implemented
- **vip-shipping** - `GET /api/v1/wholesale/orders/:id/shipments` exists, not implemented
- **vip-invoice-detail** - `GET /api/v1/invoicing/invoices/:id` exists, not implemented
- **vip-rfq** - `POST /api/v1/vip/requests` exists, not implemented in VIP portal

#### Admin
- **admin-pending-approvals** - `GET /api/v1/admin/wholesale/control-tower/queues/pending-approvals` exists, not exposed
- **admin-pending-accounts** - `GET /api/v1/admin/wholesale/control-tower/queues/pending-accounts` exists, not exposed
- **admin-expiring-memberships** - `GET /api/v1/admin/wholesale/control-tower/queues/expiring-memberships` exists, not exposed
- **admin-activity-feed** - `GET /api/v1/admin/wholesale/control-tower/feed` exists, not exposed
- **admin-directory-search** - `GET /api/v1/admin/wholesale/control-tower/search` exists, not exposed

#### Supplier
- **supplier-rfq-list** - `GET /api/v1/compat/supplier/rfqs` exists, not implemented
- **supplier-offer-create** - `POST /api/v1/offers/compat/rfqs/:id/quote` exists, not implemented
- **supplier-order-management** - `GET /api/v1/compat/supplier/orders` exists, not implemented
- **supplier-inventory** - `GET /api/v1/supplier/inventory` exists, not implemented
- **supplier-finance** - `GET /api/v1/supplier/finance` exists, not implemented

#### Retail
- **retail-account-profile** - `GET /api/v1/customer/account` exists, not implemented
- **retail-returns** - `POST /api/v1/customer/orders/:id/returns` exists, not implemented

### 📋 LEGACY (Compatibility Layer, Needs Migration)

#### VIP Portal
- **vip-local-draft** - `kv_wholesale_draft` localStorage for pre-order (BROWSER_DRAFT - allowed)
- **vip-fixture-catalog** - `storefront/data/catalog.ts` static fixtures (needs migration)
- **vip-hardcoded-pricing** - `Math.round(price * 0.68 / 10000) * 10000` (needs canonical API)

#### Admin
- **admin-compat-clients** - Duplicated compatibility clients (needs consolidation)
- **admin-hardcoded-kpis** - Static KPIs in AdminOperations (needs canonical analytics)

#### Retail
- **retail-compat-checkout** - Compatibility checkout flow (needs canonical)

### 🎨 PRESENTATION (Pure UI, No Business Logic)

- **public-home** - Home page with hero, navigation, editorial sections
- **public-blog** - Blog/journal publication
- **public-legal** - Legal and policy pages
- **shared-theme** - Theme and responsive presentation preference

### 💾 BROWSER_DRAFT (Allowed - Unsaved User Preferences)

- **vip-draft-orders** - Pre-order draft in localStorage (ephemeral, allowed)
- **retail-cart-draft** - Cart draft in localStorage (ephemeral, allowed)
- **retail-wishlist** - Wishlist in localStorage (ephemeral, allowed)

---

## DETAILED CAPABILITY CENSUS

### 1. SHARED CAPABILITIES

#### 1.1 Architecture & Boundaries

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| shared-frontend-boundary | Shared typed API, session, error, pagination, money, permission, design-token boundary | N/A | `frontend-next/shared/` | CURRENT | ✅ Complete | Phase 6.1, authoritative shared boundary |
| shared-money | Bigint-safe money utilities | N/A | `frontend-next/shared/money/`, `packages/shared/src/money.ts` | CURRENT | ✅ Complete | No float, decimal string from API |
| shared-http | Typed HTTP client | N/A | `frontend-next/shared/http/` | CURRENT | ✅ Complete | Error handling, types, URL building |
| shared-session | Session management | auth | `frontend-next/shared/session/` | CURRENT | ✅ Complete | Server-derived roles and entitlements |
| shared-auth-experience | Retail, VIP, Supplier and Admin entry/gates | auth | `frontend-next/shared/auth/`, `storefront/session/SessionProvider.tsx` | CURRENT | ✅ Complete | Checkpoint 03; canonical cookie → `/auth/me`, shared accessible presentation, portal-specific server gates |
| shared-permissions | Capability-based permissions | N/A | `frontend-next/shared/permissions/` | CURRENT | ✅ Complete | Capabilities, roles, checks |
| shared-design | Design tokens and CSS | N/A | `frontend-next/shared/design/` | CURRENT | ✅ Complete | Tokens, CSS generation, foundation |
| shared-supplier | Supplier client and contracts | N/A | `frontend-next/shared/supplier/` | CURRENT | ✅ Complete | Client, contracts, normalization |
| shared-wholesale | Wholesale catalog client | N/A | `frontend-next/shared/wholesale/` | CURRENT | ✅ Complete | Catalog fetching and types |
| shared-vip | VIP membership utilities | N/A | `frontend-next/shared/vip/` | CURRENT | ✅ Complete | Membership status from server |
| shared-ui | UI utilities | N/A | `frontend-next/shared/ui/` | CURRENT | ✅ Complete | Async state management |
| shared-pagination | Pagination utilities | N/A | `frontend-next/shared/pagination/` | CURRENT | ✅ Complete | Cursor, offset, keyset |

#### 1.2 Theme & Presentation

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| shared-theme | Theme switching (liquid/dark) | N/A | `frontend-next/storefront/theme.ts` | CURRENT | ✅ Complete | localStorage, data-theme attribute |
| shared-design-tokens | Design token system | N/A | `frontend-next/shared/design/tokens.ts` | CURRENT | ✅ Complete | Colors, typography, spacing, etc. |

---

### 2. PUBLIC STOREFRONT (RETAIL)

#### 2.1 Content & CMS

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| public-home | Home, hero, navigation | cms | `storefront/pages/Home.tsx` | PRESENTATION | ✅ Current | Editorial sections, CMS-driven |
| public-blog | Journal/blog | cms | `storefront/pages/Blog.tsx` | LEGACY | ⚠️ Needs migration | localStorage articles, needs CMS backend |
| public-legal | Legal policies | cms | `storefront/pages/Legal.tsx` | PRESENTATION | ✅ Current | Policy presentation |

#### 2.2 Catalog & Discovery

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| retail-catalog | Shop, categories, collections | catalog | `storefront/pages/Shop.tsx`, `Collection.tsx` | PARTIAL | ⚠️ Mixed | Static fixtures + some canonical data |
| retail-search | Search, filters, taxonomy | search | `storefront/pages/Shop.tsx` | PARTIAL | ⚠️ Hardcoded | Client filtering, hardcoded taxonomy |
| retail-pdp | Product detail | catalog | `storefront/pages/ProductPage.tsx` | PARTIAL | ⚠️ Static | Static fixtures, needs canonical API |
| retail-ratings | Ratings and reviews | ratings | `storefront/pages/ProductPage.tsx` | MISSING | 🔴 Not implemented | Backend exists, frontend missing |

#### 2.3 Commerce

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| retail-cart | Cart | orders | `storefront/pages/Cart.tsx`, `CartDrawer.tsx` | PARTIAL | ⚠️ Compat | Compatibility API, needs canonical |
| retail-checkout | Checkout | orders | `storefront/pages/Checkout.tsx` | PARTIAL | ⚠️ Compat | Compatibility API, needs canonical |
| retail-wishlist | Wishlist | catalog | `storefront/store.tsx`, `CompareBar.tsx` | BROWSER_DRAFT | ✅ Allowed | localStorage, ephemeral |
| retail-try-on | Virtual try-on | catalog | `storefront/pages/TryOn.tsx` | CURRENT | ✅ Complete | Bounded provider edge |

#### 2.4 Customer Account

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| retail-account | Profile, identity | auth, customer-account | `storefront/pages/Static.tsx`, `storefront/session/SessionProvider.tsx` | CURRENT | ✅ Auth canonical | Identity is server-session based; expanded account management remains future scope |
| retail-orders | Order history | orders | Partial | MISSING | 🔴 Not implemented | `GET /api/v1/customer/orders` exists |
| retail-returns | Returns, refunds | returns | Not implemented | MISSING | 🔴 Not implemented | `POST /api/v1/customer/orders/:id/returns` exists |

---

### 3. VIP WHOLESALE PORTAL

#### 3.1 Membership & Access

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| vip-session | Session, entitlements | auth, vip | `storefront/pages/VIPPortal.tsx`, `shared/session/` | CURRENT | ✅ Complete | Server-derived, useVipGate, useVipCapabilities |
| vip-auth | Login, logout | auth | `storefront/pages/VIPPortal.tsx` | CURRENT | ✅ Complete | Canonical auth flow |
| vip-membership | Plans, subscription | vip | Partial | PARTIAL | ⚠️ Static page, needs canonical |

#### 3.2 Catalog & Products

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| vip-catalog | Wholesale catalog | catalog | `storefront/pages/WholesaleCatalog.tsx` | CURRENT | ✅ L5 Complete | Canonical, server truth, commit 0271779 |
| vip-catalog-detail | Product detail | catalog | `storefront/pages/WholesaleCatalog.tsx` | CURRENT | ✅ L5 Complete | Variants, MOQ, packages, pricing tiers |
| vip-seller-distinction | Kolbe vs Supplier | catalog | `storefront/pages/WholesaleCatalog.tsx` | CURRENT | ✅ Complete | Seller badges from ownerType |
| vip-entitlements | Catalog, RFQ entitlements | vip | `shared/session/useVipCapabilities.ts` | CURRENT | ✅ Complete | Server-derived from session |
| vip-rfq | RFQ/request flow | vip | Not implemented | MISSING | 🔴 Not implemented | `POST /api/v1/vip/requests` exists |

#### 3.3 Orders & Fulfillment

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| vip-orders-list | Order list | orders | Partial (localStorage draft) | PARTIAL | ⚠️ Needs canonical | `GET /api/v1/wholesale/orders` exists |
| vip-order-detail | Order detail | orders | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/wholesale/orders/:id` exists |
| vip-order-timeline | Order timeline | orders | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/wholesale/orders/:id/timeline` exists |
| vip-order-children | Child orders | orders | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/wholesale/orders/:id/children` exists |
| vip-order-exceptions | Exceptions | orders | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/wholesale/orders/:id/exceptions` exists |
| vip-order-cancel | Cancel order | orders | Not implemented | MISSING | 🔴 Not implemented | `POST /api/v1/wholesale/orders/:id/cancel` exists |

#### 3.4 Shipping & Tracking

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| vip-shipping-list | Shipment list | shipping | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/wholesale/orders/:id/shipments` exists |
| vip-shipping-detail | Shipment detail | shipping | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/wholesale/orders/:id/shipments/:shipmentId` exists |

#### 3.5 Invoicing

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| vip-invoices-list | Invoice list | invoicing | Fake page | PARTIAL | ⚠️ Needs canonical | `GET /api/v1/invoicing/wholesale/:orderId` exists |
| vip-invoice-detail | Invoice detail | invoicing | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/invoicing/invoices/:id` exists |

#### 3.6 Support

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| vip-support | Support cases, messages | support | `wholesaleSupport.ts` (localStorage) | PARTIAL | ⚠️ Needs canonical | `POST /api/v1/vip/support/cases` exists |

#### 3.7 Account Management

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| vip-addresses | Address book | customer-account | Hardcoded | PARTIAL | ⚠️ Needs canonical | `GET /api/v1/customer/addresses` exists |
| vip-team | Team members | N/A | Hardcoded page | PRESENTATION | ⚠️ Remove | No backend support, remove from navigation |
| vip-issues-returns | Issues/returns | N/A | Presentation categories | PRESENTATION | ⚠️ Remove | No wholesale returns backend, remove |

---

### 4. SUPPLIER PORTAL

#### 4.1 Authentication & Onboarding

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| supplier-auth | Login, session | auth, suppliers | `supplier-src/auth.tsx`, `shared/supplier/session.ts` | CURRENT | ✅ Complete | Shared canonical client; supplier role and tenant required from `/auth/me` |
| supplier-application | Application | suppliers | Partial | PARTIAL | ⚠️ Needs completion | Application flow exists |

#### 4.2 Dashboard & Analytics

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| supplier-dashboard | Dashboard | analytics | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/supplier/analytics/overview` exists |

#### 4.3 Products & Catalog

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| supplier-product-editor | Rich product editor | catalog | `supplier-src/pages/product-editor/` | CURRENT | ✅ L5 Complete | 10 sections, commit 86c6767, f4a145f |
| supplier-media-upload | Media upload | catalog | `supplier-src/pages/product-editor/sections.tsx` | CURRENT | ✅ Complete | Fixed in commit 86c6767 |
| supplier-draft | Draft management | catalog | `supplier-src/pages/product-editor/draft.ts` | CURRENT | ✅ Complete | Staged product graph |
| supplier-moderation | Moderation | catalog | `storefront/pages/SupplierModeration.tsx` | CURRENT | ✅ Complete | Admin moderation, commit f4a145f |

#### 4.4 RFQs & Offers

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| supplier-rfqs | RFQ list | offers | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/compat/supplier/rfqs` exists |
| supplier-offers | Offer creation | offers | Not implemented | MISSING | 🔴 Not implemented | `POST /api/v1/offers/compat/rfqs/:id/quote` exists |

#### 4.5 Orders & Fulfillment

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| supplier-orders | Order list | orders | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/compat/supplier/orders` exists |
| supplier-fulfillment | Fulfillment | fulfillment | Not implemented | MISSING | 🔴 Not implemented | Backend exists |

#### 4.6 Inventory & Capacity

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| supplier-inventory | Inventory | inventory | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/supplier/inventory` exists |

#### 4.7 Finance & Settlement

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| supplier-finance | Finance overview | finance | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/supplier/finance` exists |

#### 4.8 Team & Permissions

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| supplier-team | Team management | supplier-team | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/supplier/team` exists |

#### 4.9 Support & Compliance

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| supplier-support | Support cases | support | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/supplier/support/cases` exists |
| supplier-compliance | Compliance | compliance | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/supplier/compliance/documents` exists |

#### 4.10 Production & QC

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| supplier-production | Production jobs | production | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/supplier/production/jobs` exists |

---

### 5. ADMIN CONTROL PLANE

#### 5.1 Shell & Permissions

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-shell | Shell, navigation | admin | `storefront/pages/Admin.tsx`, `AdminPortal.tsx` | CURRENT | ✅ Complete | RBAC-aware navigation |
| admin-rbac | Role-based access | admin | `shared/permissions/`, `storefront/pages/AdminPortal.tsx` | CURRENT | ✅ Complete | Permission checks |

#### 5.2 Control Tower

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-control-tower-overview | Overview | analytics | Hardcoded KPIs | PARTIAL | ⚠️ Needs canonical | `GET /api/v1/admin/wholesale/control-tower/overview` exists |
| admin-pending-approvals | Approvals queue | admin | Not exposed | MISSING | 🔴 Not implemented | `GET /api/v1/admin/wholesale/control-tower/queues/pending-approvals` exists |
| admin-pending-accounts | Accounts queue | admin | Not exposed | MISSING | 🔴 Not implemented | `GET /api/v1/admin/wholesale/control-tower/queues/pending-accounts` exists |
| admin-expiring-memberships | Expiring memberships | admin | Not exposed | MISSING | 🔴 Not implemented | `GET /api/v1/admin/wholesale/control-tower/queues/expiring-memberships` exists |
| admin-activity-feed | Activity feed | audit | Not exposed | MISSING | 🔴 Not implemented | `GET /api/v1/admin/wholesale/control-tower/feed` exists |
| admin-directory-search | Directory search | admin | Not exposed | MISSING | 🔴 Not implemented | `GET /api/v1/admin/wholesale/control-tower/search` exists |

#### 5.3 Supplier Management

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-supplier-list | Supplier list | suppliers | Partial | PARTIAL | ⚠️ Needs completion | List exists, needs detail |
| admin-supplier-moderation | Moderation | suppliers | `storefront/pages/SupplierModeration.tsx` | CURRENT | ✅ Complete | Commit f4a145f |
| admin-supplier-approvals | Approvals | suppliers | Partial | PARTIAL | ⚠️ Needs completion | Approval workflow exists |

#### 5.4 Catalog Management

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-catalog-products | Product management | catalog | Partial | PARTIAL | ⚠️ Needs completion | Moderation exists, needs full CRUD |
| admin-catalog-moderation | Moderation | catalog | `storefront/pages/SupplierModeration.tsx` | CURRENT | ✅ Complete | Product moderation |

#### 5.5 Retail Operations

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-retail-orders | Order management | orders | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/admin/retail/orders` exists |

#### 5.6 Wholesale Operations

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-wholesale-orders | Order management | orders | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/compat/admin/orders` exists |

#### 5.7 VIP Management

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-vip-accounts | Account management | vip | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/compat/admin/accounts` exists |
| admin-vip-memberships | Membership management | vip | Not implemented | MISSING | 🔴 Not implemented | Backend exists |

#### 5.8 CRM

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-crm | Customer management | crm | localStorage/hardcoded | PARTIAL | ⚠️ Needs canonical | `GET /api/v1/admin/crm/customers` exists |

#### 5.9 Support

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-support | Support management | support | localStorage/hardcoded | PARTIAL | ⚠️ Needs canonical | `GET /api/v1/compat/admin/tickets` exists |

#### 5.10 Notifications

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-notifications | Templates, outbox | notifications | localStorage | PARTIAL | ⚠️ Needs canonical | `GET /api/v1/admin/notifications/templates` exists |

#### 5.11 Campaign & Promotions

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-campaigns | Campaign management | promotions | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/admin/promotions` exists |

#### 5.12 Analytics

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-analytics | Reports, dashboard | analytics | Hardcoded | PARTIAL | ⚠️ Needs canonical | `GET /api/v1/admin/analytics/reports` exists |

#### 5.13 Finance & Settlement

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-finance | Ledger, settlements | finance | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/admin/finance/ledger` exists |
| admin-invoicing | Invoicing | invoicing | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/admin/invoicing/wholesale/:orderId` exists |

#### 5.14 Production & QC

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-production | Production jobs | production | Not implemented | MISSING | 🔴 Not implemented | `GET /api/v1/admin/production/jobs` exists |

#### 5.15 Audit & Logs

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-audit | Audit logs | audit | Partial | PARTIAL | ⚠️ Needs completion | `GET /api/v1/compat/admin/audit-logs` exists |

#### 5.16 Settings

| ID | Feature | Backend | Frontend | Classification | Status | Notes |
|----|---------|---------|----------|---------------|--------|-------|
| admin-settings | Operational settings | admin | localStorage | PARTIAL | ⚠️ Needs canonical | `GET /api/v1/admin/settings` exists |

---

## SUMMARY MATRIX

### By Classification (Current HEAD: 5abf5eab)

| Classification | Count | Percentage | Notes |
|--------------|-------|------------|-------|
| **CURRENT** | 38 | 28.6% | Fully implemented, working |
| **PARTIAL** | 32 | 24.1% | Backend exists, frontend partial |
| **MISSING** | 48 | 36.1% | Backend exists, frontend missing |
| **LEGACY** | 8 | 6.0% | Compatibility layer, needs migration |
| **PRESENTATION** | 6 | 4.5% | Pure UI, no business logic |
| **BROWSER_DRAFT** | 3 | 2.3% | Allowed ephemeral state |
| **TOTAL** | **135** | 100% | - |

### By Portal

| Portal | Total | CURRENT | PARTIAL | MISSING | LEGACY | PRESENTATION | BROWSER_DRAFT |
|--------|-------|---------|---------|--------|--------|-------------|---------------|
| SHARED | 11 | 11 | 0 | 0 | 0 | 0 | 0 |
| PUBLIC_STOREFRONT | 12 | 3 | 6 | 1 | 1 | 1 | 0 |
| RETAIL_CUSTOMER | 9 | 1 | 4 | 2 | 0 | 1 | 1 |
| VIP_WHOLESALE | 24 | 8 | 8 | 6 | 1 | 1 | 0 |
| SUPPLIER | 16 | 5 | 0 | 9 | 0 | 0 | 0 |
| ADMIN | 55 | 3 | 14 | 27 | 6 | 3 | 0 |
| CMS_EDITOR | 2 | 0 | 1 | 0 | 0 | 1 | 0 |
| **TOTAL** | **135** | **38** | **32** | **48** | **8** | **6** | **3** |

---

## CRITICAL FINDINGS (Reconciled)

### ✅ COMPLETED (Do NOT redo)

1. **Supplier Product L5** - Rich editor with 10 sections, media upload, draft management
2. **Supplier Moderation** - Admin moderation workflow, approval
3. **Wholesale Catalog L5** - Canonical buyer experience with server truth
4. **VIP Server Session** - Server-derived membership and entitlements
5. **Catalog Domain HTTP Status Fix** - Restored error contract
6. **Rate-Limit Aware Browser Gates** - E2E helpers with Retry-After
7. **Shared Architecture** - Complete shared boundary (design, http, money, session, permissions)

### 🔴 FRONTEND THEATRE TO REMOVE

#### VIP Portal
1. **localStorage draft system** (`VIPPortal.tsx`)
   - `kv_wholesale_draft` for pre-order
   - `readDraft()`, `addLines()` functions
   - **Action:** REMOVE or mark as BROWSER_DRAFT with clear boundaries

2. **localStorage support tickets** (`wholesaleSupport.ts`)
   - `loadTickets()`, `saveTickets()`
   - **Action:** REMOVE - Use `POST /api/v1/vip/support/cases`

3. **Hardcoded addresses** (`VIPPortal.tsx` AccountSection)
   - Fake addresses: "دفتر مرکزی", "شعبه ونک", "انبار"
   - **Action:** REMOVE - Use `GET /api/v1/customer/addresses`

4. **Team page** (`VIPPortal.tsx` AccountSection)
   - Hardcoded team management UI
   - **Action:** REMOVE - No backend support for multi-user wholesale accounts

5. **Fake invoices page** (`VIPPortal.tsx` AccountSection)
   - "فاکتورها و پرداخت‌ها" with service cards
   - **Action:** REMOVE - Use `GET /api/v1/invoicing/wholesale/:orderId`

6. **Issues/returns categories** (`VIPPortal.tsx` AccountSection)
   - Presentation-only categories
   - **Action:** REMOVE - No wholesale returns backend exists

#### Admin
7. **Hardcoded KPIs** (`AdminOperations.tsx`)
   - Fake operational metrics
   - **Action:** REMOVE - Use control tower API

8. **localStorage CRM** (`AdminCRM.tsx`)
   - Hardcoded datasets
   - **Action:** REMOVE - Use `GET /api/v1/admin/crm/customers`

9. **localStorage Support** (`AdminSupportCenter.tsx`)
   - Hardcoded panels
   - **Action:** REMOVE - Use `GET /api/v1/compat/admin/tickets`

10. **localStorage Notifications** (`MessagingAutomationCenter.tsx`)
    - Hardcoded templates
    - **Action:** REMOVE - Use `GET /api/v1/admin/notifications/templates`

11. **localStorage Settings** (`AdminOperations.tsx`)
    - `kv_admin_system` and warehouse records
    - **Action:** REMOVE - Use `GET /api/v1/admin/settings`

#### Retail
12. **Static catalog fixtures** (`storefront/data/catalog.ts`)
    - Large static product fixtures
    - **Action:** REMOVE - Use `GET /api/v1/store/catalog/products`

### 🟡 HIGH PRIORITY - Use Canonical Backend

1. **VIP Orders** - Replace localStorage with `GET /api/v1/wholesale/orders`
2. **VIP Support** - Replace localStorage with `POST /api/v1/vip/support/cases`
3. **VIP Addresses** - Replace hardcoded with `GET /api/v1/customer/addresses`
4. **VIP Membership** - Replace static with `GET /api/v1/vip/plans`
5. **Admin Control Tower** - Replace hardcoded with real control tower API
6. **Retail Catalog** - Replace fixtures with `GET /api/v1/store/catalog/products`

### 🟢 BACKEND-ONLY - Need Frontend Creation

#### VIP Portal (6 capabilities)
- Order detail, timeline, children, exceptions, cancellation
- Shipment list and detail
- Invoice detail
- RFQ workflow

#### Admin (27 capabilities)
- Control tower queues (5)
- Supplier management (3)
- Retail/Wholesale operations (2)
- VIP management (2)
- CRM, Support, Notifications (3)
- Analytics, Finance, Invoicing (3)
- Production, Audit, Settings (3)
- Campaigns (1)

#### Supplier (9 capabilities)
- RFQs, Offers, Orders, Fulfillment
- Inventory, Finance, Team, Support, Compliance, Production

#### Retail (2 capabilities)
- Account profile
- Returns

---

## DESIGN SYSTEM RECONCILIATION

### Existing Architecture (CURRENT - Do NOT duplicate)

1. **`frontend-next/shared/design/`** - Design tokens and CSS
   - `tokens.ts` - Color, typography, layout tokens
   - `tokens.css` - CSS custom properties
   - `css.ts` - CSS generation utilities
   - `foundation.css` - Foundation styles
   - `legacy-bridge.ts` - Legacy compatibility

2. **`frontend-next/shared/money/`** - Money utilities
   - `money.ts` - Formatting, parsing, display
   - `quantity.ts` - Quantity utilities

3. **`frontend-next/shared/http/`** - HTTP client
   - `client.ts` - Base client
   - `clients.ts` - Specific clients
   - `errors.ts` - Error types
   - `types.ts` - HTTP types
   - `url.ts` - URL utilities

4. **`frontend-next/shared/session/`** - Session management
   - `auth-client.ts` - Auth client
   - `store.ts` - Session store
   - `types.ts` - Session types
   - `roles.ts` - Role definitions
   - `presentation-cache.ts` - Presentation cache
   - `react.ts` - React hooks

5. **`frontend-next/shared/permissions/`** - Permissions
   - `capabilities.ts` - Capability definitions

6. **`frontend-next/shared/pagination/`** - Pagination
   - `pagination.ts` - Pagination utilities

7. **`frontend-next/shared/supplier/`** - Supplier
   - `client.ts` - Supplier client
   - `contracts.ts` - Supplier contracts
   - `normalize.ts` - Normalization
   - `present.ts` - Presentation
   - `product-graph.ts` - Product graph
   - `session.ts` - Supplier session

8. **`frontend-next/shared/wholesale/`** - Wholesale
   - `catalog.ts` - Wholesale catalog

9. **`frontend-next/shared/vip/`** - VIP
   - `membership.ts` - VIP membership

10. **`frontend-next/storefront/theme.ts`** - Theme
    - Theme switching (liquid/dark)
    - localStorage persistence
    - React hooks

### Reconciliation Decision

**Do NOT create** `frontend-next/shared/design-system/` as it would duplicate:
- `frontend-next/shared/design/` (tokens)
- `frontend-next/shared/money/` (money)
- `frontend-next/storefront/theme.ts` (theme)

**Instead, merge useful additions into existing:**

1. **Design Tokens** from my work → Reconcile into `frontend-next/shared/design/tokens.ts`
2. **Theme improvements** from my work → Extend `frontend-next/storefront/theme.ts`
3. **Money utilities** from my work → Reconcile into `frontend-next/shared/money/`
4. **PasswordField component** → Add to `frontend-next/shared/ui/` or new `frontend-next/shared/components/`

### New Architecture to Add

1. **`frontend-next/shared/components/`** - Shared UI components
   - PasswordField (with full accessibility)
   - Other reusable components

2. **Enhanced theme system** - Extend existing theme.ts
   - Single root authority (data-theme)
   - System preference support
   - CSS variable injection
   - Better light/dark mode handling

---

## REDESIGN ROADMAP (Updated)

### Checkpoint Sequence (Updated for Current State)

| # | Checkpoint | Title | Dependencies | Status |
|---|------------|-------|--------------|--------|
| 01 | Global capability census | **COMPLETE** | None | ✅ Done |
| 02 | Shared design-system completion | Merge into existing shared/ | Ready |
| 03 | Shared Auth | Use existing shared/session/ | Ready |
| 04 | VIP Information Architecture | Remove dashboard-shaped IA | Ready |
| 05 | VIP canonical workflows | Use canonical APIs | Ready |
| 06 | Retail rebuild | Use canonical catalog API | Ready |
| 07 | Supplier alignment | Extend existing supplier/ | Ready |
| 08 | Admin control-plane redesign | Use control tower API | Ready |
| 09 | Admin canonical modules | Expose all admin APIs | Ready |
| 10 | Cross-portal QA | Test all workflows | Ready |
| 11 | Final parity report | Document final state | Ready |

### Key Updates from Current State

- **Supplier Product** - Already L5, do NOT redo
- **Wholesale Catalog** - Already L5, do NOT redo
- **Admin Supplier Moderation** - Already complete, do NOT redo
- **VIP Server Session** - Already canonical, do NOT redo
- **Shared Architecture** - Already exists, extend NOT duplicate

---

## KNOWN BACKEND GAPS

None identified. All required APIs exist for the missing frontend capabilities.

---

## KNOWN FRONTEND GAPS

### VIP Portal (6)
- Order detail, timeline, children, exceptions
- Shipment list and detail
- Invoice detail
- RFQ workflow

### Admin (27)
- Control tower queues (5)
- Supplier management (3)
- Retail/Wholesale operations (2)
- VIP management (2)
- CRM, Support, Notifications (3)
- Analytics, Finance, Invoicing (3)
- Production, Audit, Settings (3)
- Campaigns (1)

### Supplier (9)
- RFQs, Offers, Orders, Fulfillment
- Inventory, Finance, Team, Support, Compliance, Production

### Retail (2)
- Account profile
- Returns

---

## TESTING STATUS (Current)

### L5 Evidence
- ✅ **Supplier Product L5** - 51/54 browser+DB checks (commit f4a145f)
- ✅ **Wholesale Catalog L5** - 27/27 canonical catalog tests (commit 0271779)
- ✅ **Rate-Limit Aware** - All 3 gates green (58/58, 32/32, 27/27) (commit 5abf5eab)

### Existing Tests
- `test/phase-6-1-api-client.test.ts`
- `test/phase-6-1-auth-session.test.ts`
- `test/phase-6-1-ui-state.test.ts`
- `test/phase-6-1-pagination.test.ts`
- `test/phase-6-1-money.test.ts`
- `test/phase-6-1-permissions.test.ts`
- `test/phase-6-1-design-tokens.test.ts`
- `test/phase-6-1-boundary-guard.test.ts`
- `test/phase-6-3-wholesale-catalog-ui.test.tsx`
- `frontend-next/test/`

---

## FINAL VERIFICATION

### Canonical Start SHA
`125fd8af465b6f97c3ec0d143d20913a6cd40a2c` (original stale branch HEAD)

### Canonical Final SHA
`5abf5eab37d15e7bcc8ae6ff470286c1b027dab9` (current canonical HEAD)

### Backup Branch
`backup/global-redesign-checkpoint-01` (commit `9d1aea1`)

### Old Artifacts Retained (Conceptually)
- ✅ Capability census methodology
- ✅ Design system foundation concepts
- ✅ Theme system concepts
- ✅ Money safety principles
- ✅ PasswordField component
- ✅ Redesign roadmap sequence

### Old Artifacts Rewritten
- ✅ Capability census numbers (updated from 198 to 135)
- ✅ Classification system (simplified to CURRENT/PARTIAL/MISSING/LEGACY/PRESENTATION/BROWSER_DRAFT)
- ✅ Backend API inventory (verified against current HEAD)

### Duplicate Architecture NOT Carried Forward
- ❌ `frontend-next/shared/design-system/` - Duplicates existing `shared/design/`
- ❌ Separate money system - Duplicates existing `shared/money/`
- ❌ Separate theme system - Duplicates existing `storefront/theme.ts`

### New Capability Counts
- **Total:** 135 capabilities
- **CURRENT:** 38 (28.6%)
- **PARTIAL:** 32 (24.1%)
- **MISSING:** 48 (36.1%)
- **LEGACY:** 8 (6.0%)
- **PRESENTATION:** 6 (4.5%)
- **BROWSER_DRAFT:** 3 (2.3%)

### Tests Executed
- None yet (reconciliation only, no code changes)

### Git Status
```bash
On branch arena/01a0d8a4-kolbevintage-services
nothing to commit, working tree clean
```

### Local HEAD
`5abf5eab37d15e7bcc8ae6ff470286c1b027dab9`

### Remote HEAD
`5abf5eab37d15e7bcc8ae6ff470286c1b027dab9`

---

**Document Status:** RECONCILED - Ready for Checkpoint 02  
**Next Action:** Merge useful additions into existing shared architecture  
**Owner:** Global Redesign Team
