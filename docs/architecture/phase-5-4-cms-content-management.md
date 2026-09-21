# Phase 5.4 CMS — bounded-context architecture audit

**Status:** implemented on `arena/01a0c422-kolbevintage-services`
**Scope:** authoritative, versioned, auditable content and publication backend only
**Migration:** `packages/database/migrations/0028_phase_5_4_cms_content_management.sql`

## 1. Authority and ownership

The CMS is a NestJS bounded context under `apps/api/src/modules/cms/`. It owns only editorial identity, content documents, page/navigation/article revisions, publication state, CMS media metadata/usages, taxonomy, and schedule rows. Ownership is registered in `apps/api/src/modules/registry.ts` and the module is imported by `app.module.ts`.

CMS does **not** own or mutate Catalog, Offers/pricing, Inventory, Orders, Payments, VIP, Supplier, CRM, Support, Notifications delivery, Compliance acceptance/legal-policy authority, or Promotions. Product/category/collection references in blocks are stable read-only references resolved by the owning domain; they are not copied into CMS tables.

`site_setting` remains explicitly unassigned legacy storage. The import utility reads it only and writes typed CMS documents; it never updates or deletes the legacy row.

## 2. Relational model

Migration 0028 creates the following CMS-owned tables:

| Table | Responsibility | Immutability / pointer rule |
|---|---|---|
| `cms_page` | First-class `HOME`, `STATIC`, `LANDING`, or `EDITORIAL` identity, stable key, normalized route | Unique stable key and route; nullable published-revision pointer |
| `cms_page_revision` | Page title, validated blocks, SEO, schema version, lifecycle | Content columns are trigger-immutable; one published revision per page |
| `cms_content_document` | Typed document identity for header/footer/hero/home/promotional configuration | Unique typed key; published pointer |
| `cms_content_revision` | Versioned typed payload | Payload/version/source are trigger-immutable; one published revision per document |
| `cms_navigation` / `cms_navigation_revision` | Versioned navigations and bounded tree items | Revision content/source is trigger-immutable; one published revision |
| `cms_media_asset` | Public-media metadata, checksum, size, MIME, provider, archive marker | `LOCAL_PUBLIC` is the only implemented provider |
| `cms_media_usage` | Revision field-path references to media | Historical usage is retained; FK prevents deleting an asset with usage |
| `cms_article` / `cms_article_revision` | Article identity and Persian-safe slugged rich content | Slug/payload/source are trigger-immutable; one published article revision and unique published slug |
| `cms_article_taxonomy` / `cms_article_revision_taxonomy` | Controlled editorial categories/tags and revision membership | Restricted parent/link FKs, revision-scoped membership |
| `cms_publication_schedule` | Durable UTC publication/unpublication work item | Idempotency key, target check, processing claim, attempts, failure status |

Published pointers are foreign keys added after the revision tables exist. This avoids a TypeScript declaration cycle while preserving the database constraint.

All CMS foreign keys are `ON DELETE RESTRICT`. There is no cascade that can erase editorial history.

## 3. Revision and publication state

The allowed revision states are `DRAFT`, `IN_REVIEW`, `SCHEDULED`, `PUBLISHED`, `SUPERSEDED`, and `ARCHIVED`. The service transition matrix rejects illegal transitions. Publishing locks the parent and target revision, supersedes the previous published row, sets the published pointer atomically, and writes through the existing `AuditService` in the same transaction.

A rollback never rewrites history: it validates the source revision, inserts the next version with `sourceRevisionId`, and requires a normal publish operation. Database triggers reject UPDATE/DELETE changes to identity, version, content, creator, source, and creation time. Lifecycle columns remain mutable so publishing, superseding, and archival can be recorded.

Scheduling stores `timestamptz` values and a normalized `UTC` timezone. `JobLockService` guards the CMS worker with a PostgreSQL advisory lock. A scheduler can be enabled with the existing recovery scheduler configuration or `ENABLE_CMS_PUBLICATION_SCHEDULER=true`; stale `PROCESSING` claims are recoverable. Publication and unpublication are idempotent against the current published pointer.

## 4. Structured content and security

`cms-validation.ts` is the single service-layer validation gate for:

- all required block types: `HERO`, `CATEGORY_GRID`, `NEW_ARRIVALS`, `BANNER`, `BEST_SELLERS`, `STYLE_LOOK`, `TRUST`, `EDITORIAL`, `INSTAGRAM_EDITORIAL`, `COUNTDOWN`, `POPUP_REFERENCE`, `CUSTOM_TEXT`, `MEDIA`, and `CTA`;
- strict per-block key allowlists, stable block IDs, bounded count/order, and media reference collection;
- typed/versioned document payloads instead of a generic unvalidated settings row;
- Persian/Unicode normalization, traversal rejection, reserved CMS route roots, duplicate identity prevention, and safe internal/external URLs;
- structured rich text only (`paragraph`, `heading`, `image`, `link`, `list`, `quote`); no stored executable HTML/JS;
- SEO metadata with bounded text, safe canonical routes/HTTPS URLs, and recursive executable-content rejection;
- navigation trees with unique IDs and maximum depth of four levels including the root;
- future UTC timestamps, MIME allowlists, and media reference validation.

The public controllers return only published pointer-selected rows. Draft and revision preview requires a short-lived HMAC token containing the exact target type and revision ID; a token for one target cannot preview another.

## 5. Public media boundary

`PublicMediaStorage` is a CMS port. `LocalPublicMediaStorage` is the only registered provider and writes to a non-repository `var/cms-public-media/` directory. It is deliberately separate from Compliance storage. Uploads require an allowlisted MIME, byte-size limit, matching magic bytes, safe filename, SHA-256 checksum, and PostgreSQL metadata row. The public endpoint checks archive state before reading.

Archive is soft and removes public serving while retaining historical bytes/usages. Purge is explicit and fails if any historical revision usage exists. No S3/CDN integration, bucket secret, provider credential, or production S3 claim exists in this phase.

## 6. API surface

- Public: `/api/v1/cms/public/page?path=...`, typed documents, published navigation, published article by slug, active media file, and token-gated previews.
- Admin: `/api/v1/cms/admin/*` for identity, revisions, rollback, transition, publication, UTC scheduling, navigation, taxonomy, articles, media, dry-run legacy import, and preview-token issuance.
- Every admin endpoint is role-protected (`admin`) and uses the existing `AdminPermissionGuard` actions added to the existing permission allowlist.
- Important writes use the existing `AuditService`; CMS does not create a competing audit log.

## 7. Safe rollout and legacy coexistence

The legacy storefront files and visual behavior were not redesigned. `kolbe-site-content-v3` and legacy Next server compatibility may continue during the cutover window, but they are not CMS authority. Operators can import legacy `site_setting` values with `dryRun`, deterministic `legacy:<settingKey>` keys, idempotent retries, and no legacy deletion. The eventual frontend read cutover must consume the published CMS API without changing visual contracts.

## 8. Explicit non-goals

Phase 5.4 does not start Analytics/Reporting, Promotions, Supabase Auth/RLS/PostgREST/Storage, legal-policy or acceptance authority, executable template storage, external provider delivery, or Catalog/Offers/Inventory/Orders/Payments/VIP/Supplier/CRM/Support mutation.
