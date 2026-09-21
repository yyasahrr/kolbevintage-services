# Phase 5.4 — CMS & Content Management Backend

**Status:** implemented on `arena/01a0c422-kolbevintage-services`
**Evidence date:** 2026-09-21 (Asia/Tehran workspace date)
**Implementation checkpoint:** `70b2c8de1b8323d31dcb3429e700e00474cb6b6a`
**Scope:** authoritative, versioned, auditable CMS bounded context; no storefront redesign and no Phase 5.5 work.

## Executive result

Phase 5.4 adds an authoritative CMS bounded context under `apps/api/src/modules/cms/`, registers it in both the Nest application and module registry, and introduces migration `0028_phase_5_4_cms_content_management.sql`. Editorial identity, content, publication state, navigation, articles, taxonomy, CMS public media metadata/usages, preview capabilities, and durable schedules are relationally versioned and auditable.

The CMS is not a replacement authority for Catalog, Offers/pricing, Inventory, Orders, Payments, VIP, Supplier, CRM, Support, Notifications delivery, Compliance acceptance/legal policy, or Promotions. Existing frontend behavior, legacy compatibility, and visual contracts were preserved. The architecture audit is in `docs/architecture/phase-5-4-cms-content-management.md`; the source-to-CMS parity audit is in `docs/phase-reports/phase-5-4-feature-preservation-mapping.md`.

## 1. Migration and schema evidence

### Exact migration boundary

- Added only `packages/database/migrations/0028_phase_5_4_cms_content_management.sql` for Phase 5.4.
- Updated the migration journal and generated snapshot for migration `0028`.
- Migrations `0000` through `0027` were not modified.
- The migration is included in the real-PostgreSQL clean-migration and idempotency suites.
- Current baseline after migration `0028`: **29 migrations, 155 tables, 345 foreign keys, and 424 CHECK constraints**.

### CMS tables

Migration `0028` creates these 13 CMS-owned tables:

1. `cms_page`
2. `cms_page_revision`
3. `cms_content_document`
4. `cms_content_revision`
5. `cms_navigation`
6. `cms_navigation_revision`
7. `cms_media_asset`
8. `cms_media_usage`
9. `cms_article`
10. `cms_article_taxonomy`
11. `cms_article_revision`
12. `cms_article_revision_taxonomy`
13. `cms_publication_schedule`

The database schema is mirrored in `packages/database/src/schema/tables.ts`, and CMS state/catalog constants and the Admin RBAC permission catalog are in `packages/database/src/schema/state-values.ts`. The module registry declares all 13 tables as CMS-owned and depends on existing auth/admin/audit boundaries.

### Relational invariants

- Page identities support `HOME`, `STATIC`, `LANDING`, and `EDITORIAL`; normalized stable keys and unique normalized routes prevent identity collisions.
- Content documents have explicit types: `HOME_CONFIGURATION`, `HEADER_CONFIGURATION`, `FOOTER_CONFIGURATION`, `HERO_CONFIGURATION`, and `PROMOTIONAL_CONTENT_CONFIGURATION`.
- Revision versions are unique per parent and published pointers are unique per parent through partial unique indexes.
- Revision content/source/identity columns are protected by PostgreSQL immutable triggers. Publication lifecycle columns remain mutable so publication, superseding, archival, and rollback provenance can be recorded.
- Rollback always inserts the next revision with `source_revision_id`; it never rewrites an existing revision.
- All CMS foreign keys use `ON DELETE RESTRICT`; editorial history cannot be cascaded away.
- Schedule rows use `timestamptz`, persist `UTC`, enforce one target per schedule, enforce a later unpublish time, enforce idempotency, and retain attempts, claims, execution, and error information.
- Navigation rollback provenance is stored in `cms_navigation_revision.source_revision_id` with a restricted foreign key.

## 2. Application implementation

### Module and API registration

- `CmsModule` is imported by `apps/api/src/app.module.ts`.
- `apps/api/src/modules/registry.ts` declares CMS ownership and phase status.
- Public controllers are mounted under the existing API prefix as `/api/v1/cms/public/*`.
- Admin controllers are mounted under `/api/v1/cms/admin/*`.

### Revision and publication services

- `cms-page.service.ts`: page identity, page revisions, versioning, rollback-as-new-revision, archive, media usage, and archived-media rejection.
- `cms-content.service.ts`: typed/versioned storefront documents, payload validation, revision lifecycle, rollback, archive, and media usage.
- `cms-navigation.service.ts`: versioned navigation trees, bounded nesting, rollback provenance, archive, and published-only reads.
- `cms-article.service.ts`: article identity, Persian-safe slugs, immutable revisions, taxonomy membership, structured rich content, rollback, archive, and published-only slug reads.
- `cms-publication.service.ts`: atomic publication/superseding, unpublication, UTC scheduling, idempotent due processing, PostgreSQL advisory job lock, stale-claim recovery, and schedule failure recording.
- `CmsPublicationScheduler`: opt-in lifecycle scheduler controlled by the existing recovery configuration or `ENABLE_CMS_PUBLICATION_SCHEDULER=true`; it does not run implicitly in tests or production without explicit configuration.
- Stale recovery preserves whether a crashed `PROCESSING` row was a publication or unpublication phase, is guarded by the same `JobLockService` key, and is available through the authenticated admin recovery endpoint.

### Structured content and security

`cms-validation.ts` is the service-layer validation gate for:

- `HERO`, `CATEGORY_GRID`, `NEW_ARRIVALS`, `BANNER`, `BEST_SELLERS`, `STYLE_LOOK`, `TRUST`, `EDITORIAL`, `INSTAGRAM_EDITORIAL`, `COUNTDOWN`, `POPUP_REFERENCE`, `CUSTOM_TEXT`, `MEDIA`, and `CTA` blocks.
- Strict block/document allowlists, stable IDs, bounded count/order, typed rich-text blocks, and media-reference collection.
- Persian/Unicode NFKC normalization, safe route/slug normalization, duplicate identity protection, traversal rejection, encoded separator rejection, and reserved application-route rejection.
- Safe internal paths and HTTPS external URLs only; executable schemes, protocol-relative hosts, traversal, event attributes, script tags, executable element names, and prototype-pollution keys are rejected.
- Structured rich body nodes only: paragraph, heading, image, link, list, and quote. Stored executable HTML/JS is not accepted.
- SEO metadata with bounded text, safe canonical paths/HTTPS URLs, and recursive executable-content rejection.
- Navigation trees with unique IDs and maximum depth of four levels including the root.

### Preview and public reads

- Public ordinary reads select only the current published pointer and active parent row.
- Page, typed document, navigation, and article previews require a short-lived HMAC capability containing the exact target type and revision ID.
- A token for one target cannot be used for another target, and tampering or expiry returns no preview.
- Drafts and unpublished revisions are never returned by ordinary public endpoints.

### Media boundary

- `PublicMediaStorage` is a CMS-specific port; Compliance private storage is not reused.
- Only `LOCAL_PUBLIC` is registered and implemented in this phase.
- The local provider writes to `var/cms-public-media/`, excluded from Git, and serves through `/api/v1/cms/public/media/{assetId}/file`.
- Upload validation includes allowlisted MIME, image/video byte limits, matching magic bytes, safe filename, SHA-256 metadata, positive dimensions/duration, and bounded text metadata.
- `cms_media_usage` records revision field paths. Media archive is soft and immediately removes public serving while retaining historical bytes/usages. Explicit purge is blocked while historical usage exists.
- No S3/CDN provider, bucket credential, storage secret, or production S3 claim was introduced.

### RBAC and audit

- CMS uses the existing `AdminPermissionGuard` and `RequireAdminPermission` decorators.
- The existing `ADMIN_PERMISSION_ACTIONS` catalog now includes `cms:content:view`, `cms:content:create`, `cms:content:edit`, `cms:content:publish`, `cms:content:archive`, `cms:navigation:manage`, `cms:media:manage`, `cms:seo:manage`, and `cms:blog:manage`.
- Existing `AdminRbacService.ensureSystemRoles()` seeds the expanded catalog for `super_admin`; no competing permission table or authorization subsystem was added.
- Important CMS mutations call the existing `AuditService`, generally inside the same database transaction. Stale schedule recovery records a system audit event.

## 3. Legacy import and feature preservation

`CmsLegacyImportService` provides a one-way `site_setting` bridge:

- `dryRun` reports scanned, would-create, existing, created, and failed rows.
- Deterministic `legacy:<settingKey>` keys make retries idempotent.
- Existing CMS documents are skipped rather than overwritten.
- The utility reads legacy rows only; it never updates or deletes them.
- Imported values pass typed-document allowlists and executable-content rejection before insertion.

The preservation mapping audits `siteSettings.ts`, `siteData.ts`, HeroStudio, SiteBuilder, SiteDesignCenter, Blog, Static, Legal, header/navigation, hero, banners, popups, style/look, countdown, Instagram/editorial, footer, static pages, and current media behavior. The mapping keeps legacy `kolbe-site-content-v3` and Next compatibility available during cutover, but neither remains the final CMS authority after published CMS reads are enabled.

No frontend source, visual layout, color, typography, theme, component, or UX redesign was made for Phase 5.4. CMS references other domains read-only and does not copy or mutate their commercial, inventory, order, payment, legal, or promotion authority.

## 4. Test evidence

All CMS-specific tests use real PostgreSQL for database/service lifecycle checks; no critical test is skipped or replaced with an in-memory database.

### CMS and database evidence

| Command | Result |
|---|---:|
| `npm test --workspace @kolbe/database` | **11 files, 87/87 tests passed** |
| `npm test --workspace @kolbe/api -- --run test/phase-5-4-cms-security.test.ts test/phase-5-4-cms-service.test.ts` | **2 files, 9/9 tests passed** |
| `npm run typecheck --workspace @kolbe/api` | passed |
| `npm run build --workspace @kolbe/api` | passed |

The Phase 5.4 database suite specifically verifies fresh migration creation, the full CMS table set, immutable revision UPDATE/DELETE rejection, one-published-revision enforcement, foreign keys, schedule target shape, media checksum constraints, taxonomy state constraints, and migration compatibility.

The adversarial suite specifically verifies Persian routes/slugs, traversal and encoded separators, reserved routes, all required block types, unknown-field rejection, script/event payload rejection, executable URLs, bounded navigation nesting, safe rich text, safe SEO, media magic bytes/path confinement, and target-bound expiring previews.

### Existing package and frontend preservation evidence

| Command | Result |
|---|---:|
| `npm test --workspace @kolbe/shared` | **2 files, 23/23 tests passed** |
| `npm test --workspace kolbe-next` | **15 files, 142/142 tests passed** |
| `npm run typecheck --workspace kolbe-next` | passed |
| `npm run build --workspace kolbe-next` | passed |
| `npm run build --workspace kolbe-storefront` | passed |
| `npm run build --workspace kolbe-supplier-portal` | passed |

A full API run before the final D hardening checkpoint recorded **69 files and 860/860 tests passed**. The D checkpoint adds one CMS lifecycle assertion, making the final expected total 861 tests. A subsequent local full API rerun on the shared development PostgreSQL instance hit one known pre-existing/flaky Phase 4.7.1 concurrency assertion (`late shipping fee vs payment verification`, `allocated 0n` vs `2000000n`) while all other API tests passed; the CMS targeted tests, database suite, frontend suite, and remote final CI were successful. No Phase 4 test or assertion was weakened or changed to conceal that behavior.

## 5. Remote CI evidence

The final implementation checkpoint `70b2c8de1b8323d31dcb3429e700e00474cb6b6a` was pushed to `arena/01a0c422-kolbevintage-services`. GitHub Actions run **35611782705** completed with conclusion **success**:

- [CI run 35611782705](https://github.com/yyasahrr/kolbevintage-services/actions/runs/35611782705)
- Head SHA: `70b2c8de1b8323d31dcb3429e700e00474cb6b6a`
- Completed: 2026-09-21
- `packages/database` job: success — typecheck, build, live-PostgreSQL migration equivalence tests.
- `apps/api` job: success — typecheck, build, full backend test command.
- `frontend-next` job: success — typecheck, regression tests, production build.
- `packages/shared` job: success — typecheck, build, tests.
- `infra` job: success — static Compose/Nginx verification.

Earlier checkpoint CI runs were cancelled by the workflow's branch concurrency policy when newer checkpoint pushes arrived. They are not used as final evidence.

## 6. Checkpoint history and final-state checks

Required checkpoint commits were created and pushed in order on the fixed session branch:

- **A** `a7f0f9e` — authoritative CMS schema, migration, module, registry, and implementation foundation.
- **B** `5017e29` — real-PostgreSQL CMS invariants, adversarial tests, and updated current-schema regression assertions.
- **C** `dc5a414` — architecture audit and feature-preservation/parity mapping.
- **D** `70b2c8d` — structured-content hardening, complete preview coverage, durable content scheduling fix, stale-claim phase recovery, and final checkpoint test coverage.

No main checkout, merge, rebase, reset, force-push, PR, or published-history modification was performed. The session branch remains `arena/01a0c422-kolbevintage-services`.

## 7. Explicit non-goals and rollout gates

Phase 5.4 does not start Analytics/Reporting, Promotions, Supabase Auth/RLS/PostgREST/Storage, legal-policy or acceptance authority, executable template storage, external media-provider delivery, or mutation of Catalog, Offers/pricing, Inventory, Orders, Payments, VIP, Supplier, CRM, Support, Notifications delivery, Compliance, or promotion logic.

Before production frontend cutover, operators still need an environment-specific rollout decision for the published CMS API, local public-media retention/backup, and an intentionally configured scheduler. Those operational choices are outside this backend phase; the code does not claim external S3/CDN readiness.

Phase 5.5 Analytics & Reporting Backend has NOT started.