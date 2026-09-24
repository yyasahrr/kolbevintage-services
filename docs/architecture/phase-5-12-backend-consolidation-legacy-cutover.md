# Phase 5.12 — Backend Consolidation / Legacy Cutover

**Status:** Checkpoints A, B, and C implemented; final CI closeout pending

**Start SHA:** `7383aedebbb100ae26fe154c4794f9bce3404f02`

**Invariant:** NestJS is the only business authority. The Next route remains a
request/response compatibility edge until Phase 6.

## Classification

- `COMPAT_PROXY`: retained legacy path, forwarded to a canonical Nest owner.
- `NON_BUSINESS_EDGE`: transport/provider edge with no Kolbe database authority.
- `DEPRECATED_NO_CALLERS`: removed only with repository-wide caller proof.
- `MISSING_CANONICAL_SEAM`: temporary audit state; must be zero at closeout.

## Authoritative legacy route map

The table is derived from executable branches in
`frontend-next/server/kolbe-api.ts` and repository-wide callers. `Auth` means
the existing HttpOnly cookie/Bearer input is forwarded; Nest performs identity,
role, ownership and permission decisions.

| Legacy method/path | Actor | Start implementation / business tables | Canonical owner and target | Translation | Status / parity proof |
|---|---|---|---|---|---|
| POST `auth/register` | anonymous | direct `account_user`, session | Auth `POST auth/register` | legacy body/response + cookie | COMPAT_PROXY |
| POST `auth/login` | anonymous | direct user/session/attempt | Auth `POST auth/login` | response + cookie | COMPAT_PROXY |
| POST `auth/logout` | signed-in | direct user/session | Auth `POST auth/logout` | cookie clear | COMPAT_PROXY |
| GET `auth/me` | signed-in | direct user read | Auth `GET auth/me` | passthrough | COMPAT_PROXY |
| POST `auth/totp/{enroll,verify,disable}` | signed-in | direct user write | Auth matching routes | passthrough | COMPAT_PROXY |
| POST `supplier/apply` | anonymous | direct application write | Suppliers application seam | legacy DTO | MISSING_CANONICAL_SEAM |
| POST `supplier/auth/login` | anonymous | direct auth/session | Auth `POST auth/supplier/login` | legacy response + cookie | COMPAT_PROXY |
| GET `supplier/session` | supplier | direct membership read | Auth `GET auth/me` | supplier projection | COMPAT_PROXY |
| GET/POST `supplier/products` | supplier | submission read/write | Catalog supplier submissions | legacy list/create DTO | MISSING_CANONICAL_SEAM |
| GET `supplier/orders` | supplier | purchase-order reads | Orders `GET supplier/orders` | legacy list shape | COMPAT_PROXY |
| POST `supplier/orders/:id/status` | supplier | direct PO update | Orders state-machine route | status→action | COMPAT_PROXY |
| GET `supplier/rfqs` | supplier | direct RFQ read | Offers/RFQ seam | legacy list | MISSING_CANONICAL_SEAM |
| POST `supplier/rfqs/:id/quote` | supplier | direct quote/RFQ write | Offers/RFQ seam | integer-money DTO | MISSING_CANONICAL_SEAM |
| GET/POST `supplier/tickets` | supplier | direct read; canonical write | Support `supplier/support/cases` | write maps message/category/priority; read remains legacy | COMPAT_PROXY |
| POST `wholesale/apply` | customer/VIP | direct account/user write | VIP request/membership seam | legacy application DTO | MISSING_CANONICAL_SEAM |
| GET `wholesale/account` | customer/VIP | direct account read | VIP account seam | legacy account | MISSING_CANONICAL_SEAM |
| GET `wholesale/products` | VIP | direct catalog/offer read | Catalog `GET catalog/wholesale/products` | legacy product list | COMPAT_PROXY |
| GET/POST `wholesale/orders` | VIP | direct order read; canonical write partly available | Orders `wholesale/orders` | legacy lines/response | COMPAT_PROXY |
| PUT `admin/site-settings` | admin | direct `site_setting` write | Admin settings writer absent; CMS import is read-only | key-specific DTO | MISSING_CANONICAL_SEAM |
| GET `admin/accounts` | admin | direct wholesale account read | VIP admin seams | legacy list | MISSING_CANONICAL_SEAM |
| POST `admin/accounts/:id/status` | admin | direct account/user role writes | VIP audited state machine | status→action | MISSING_CANONICAL_SEAM |
| GET `admin/supplier-applications` | admin | direct application read | Suppliers application seam | legacy list | MISSING_CANONICAL_SEAM |
| PATCH `admin/supplier-applications/:id` | admin | direct supplier/user/member writes | Suppliers approval seam | legacy decision DTO | MISSING_CANONICAL_SEAM |
| GET `admin/audit-logs` | admin | direct audit read | Audit `GET audit/logs` | filters/shape | COMPAT_PROXY |
| GET `admin/suppliers` | admin | direct supplier read | Suppliers admin read seam | legacy list | MISSING_CANONICAL_SEAM |
| GET `admin/catalog` | admin | direct product/offer read | Catalog owner | legacy composition | MISSING_CANONICAL_SEAM |
| POST `admin/catalog/:id/status` | admin | direct product write/audit | Catalog `POST catalog/products/:id/status` | legacy and canonical state sets differ | MISSING_CANONICAL_SEAM |
| POST `admin/catalog/bulk-price` | admin | direct float offer updates | Offers/Pricing safe integer seam | bulk DTO | MISSING_CANONICAL_SEAM |
| GET `admin/purchase-orders` | admin | direct PO read | Orders/admin seams | legacy list | MISSING_CANONICAL_SEAM |
| POST `admin/purchase-orders/:id/status` | admin | disabled direct mutation | Orders state machine | status→action | COMPAT_PROXY |
| GET `admin/orders` | admin | direct wholesale composition | Orders `GET admin/wholesale/orders` | legacy composition | COMPAT_PROXY |
| POST `admin/orders/:id/{approve,cancel}` | admin | canonical forward | Orders owner | action mapping | COMPAT_PROXY |
| GET/POST `admin/rfqs` | admin | direct RFQ read/write | Offers/RFQ seam | legacy DTO | MISSING_CANONICAL_SEAM |
| GET/POST `admin/tickets[/:id]` | admin | direct ticket read/write | Support status + message commands | legacy update combines status and reply atomically | MISSING_CANONICAL_SEAM |
| GET/PATCH `admin/logs[/:id]` | admin | direct system-log read/write | operational telemetry edge | filters/status | MISSING_CANONICAL_SEAM |
| GET `health` | anonymous | database readiness probe | health transport | none | NON_BUSINESS_EDGE |
| POST `logs/client` | anonymous | operational telemetry write | telemetry edge | sanitized event | NON_BUSINESS_EDGE |
| `try-on/*` | mixed | external provider proxy, quota only | Perfect Corp edge | provider contract | NON_BUSINESS_EDGE |
| GET `site/{hero-video,banner-video,settings}` | public | direct setting read | CMS public contracts | SiteBuilder shape | COMPAT_PROXY |
| GET `me` | customer | direct account read | Auth `GET auth/me` | legacy name shape | COMPAT_PROXY |
| POST `retail/orders` | customer/guest | canonical forward already | Retail Orders `POST retail/orders` | frozen checkout DTO | COMPAT_PROXY |

## Writer authority at start

| Fact | Canonical owner | Legacy direct writer at start | Required A result |
|---|---|---:|---|
| account/session/login attempt | Auth | yes | proxy only |
| supplier/application/member | Suppliers / Supplier Team | yes | proxy only |
| supplier submission | Catalog | yes | proxy only |
| RFQ/quote/offer | Offers | yes | proxy only |
| wholesale account/membership | VIP | yes | proxy only |
| wholesale/purchase orders | Orders | partial | proxy only |
| support case | Support | yes | proxy only |
| product/price | Catalog / Offers / Pricing | yes | proxy only |
| site content/settings | CMS / Admin Settings | yes | proxy only |
| domain audit | Audit through owners | yes | no compatibility audit write |

No route may fall back to SQL when Nest is unavailable. The compatibility edge
must return an honest upstream failure.

## Checkpoint B as built

All 20 `LEGACY_READ` entries now cross the Next compatibility edge into Nest.
Nest resolves the authenticated user, supplier membership, VIP account and
Admin role before reading business data. The edge only preserves legacy JSON
and video streaming shapes. Its read dispatcher runs before `database()` and
returns `503 CANONICAL_API_UNAVAILABLE` when Nest cannot be reached; it never
falls back to the old SQL branches.

The narrow canonical projections are grouped by actor at
`/api/v1/compat/account`, `/api/v1/compat/supplier`,
`/api/v1/compat/wholesale`, `/api/v1/compat/admin`, and
`/api/v1/compat/storefront`. They use server-derived tenant identity and stable
ordering. The 11 `LEGACY_WRITE` entries remain visible for later Phase 5.12
work; Checkpoint B did not claim writer convergence.

## Checkpoint C as built

The 11 remaining business commands now cross the compatibility edge to their
named owners: Suppliers, Catalog, Offers, VIP, CMS, Auth, and Support. Supplier
approval uses an explicit transactional orchestrator because its one decision
must coordinate application, supplier, seller, initial membership, account
role, and audit state. Operational-log reads and resolution use a bounded
Analytics infrastructure service rather than business-table SQL in Next.

Compatibility DTOs preserve the existing paths and response contracts. Tenant
identity is derived from the authenticated user and canonical membership;
browser-supplied supplier, VIP, user, and owner identifiers cannot select an
authority context. Monetary commands accept digit-only integer IRR or integer
basis points, and bulk pricing validates the bounded batch before its
transactional update.

Site settings accept the existing presentation key set only. Embedded videos
are validated, stored under the existing dedicated setting keys, and replaced
with their stable streaming URLs in the storefront document. Arbitrary JSON
cannot become platform or business configuration authority through this seam.

Both read and write dispatchers execute before Next database initialization.
Canonical unavailability produces `503 CANONICAL_API_UNAVAILABLE`; none of the
migrated routes falls back to its superseded SQL branch. The route inventory's
final counts are 47 total, 42 `NEXT_PROXY_TO_NEST`, 2 `DEPRECATED`, and 3
`STATIC/MOCK`, with zero `LEGACY_READ`, `LEGACY_WRITE`,
`MISSING_CANONICAL_SEAM`, or `REMOVE_LATER` entries.

`POST logs/client` remains a sanitized infrastructure telemetry ingest and
`try-on/*` remains the Perfect Corp provider edge. These are the only retained
non-business authority edges in the legacy dispatcher. All direct business
mutations have been removed from the compatibility file. Physical removal of
the remaining unreachable read-only compatibility SQL is assigned to Phase 6;
it does not participate in active request authority after the pre-database
dispatch cutover.
