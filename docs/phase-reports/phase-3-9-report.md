# Phase 3.9 Report — Canonical Marketplace Hardening

**Branch:** `arena/01a0ad1f-kolbevintage-services`
**Starting SHA:** `0bd2af7ec5f956a7103fbe3f99ab3b6e838fece7`
**Scope:** marketplace hardening only; Phase 4 has not started.

## Reproduced Issues

- Catalog mutations required authentication but lacked explicit role allowlists.
- Offer creation mapped every non-supplier role to KOLBE.
- Supplier identity could be taken from claims instead of verified membership.
- Suppliers created canonical Product/Variant/Offer/Inventory records directly in the strangler API.
- VIP selection immediately created an active subscription.
- Wholesale requests trusted client `vipAccountId` and did not validate product/offer/package relationships.
- PostgreSQL allowed multiple KOLBE sellers because `supplier_id` was nullable.
- Package parent/items were inserted outside a transaction.
- MOQ/package/tier/request quantities allowed zero; tier range ordering was absent.
- CHECK helper calls used TypeScript names for `minQuantity`, `unitPrice`, and `durationDays`.
- CI existed only under `infra/ci`, where GitHub would not execute it.

## Disproved / Preserved

- Phase 3.8 legacy commerce tables remain absent.
- `product_variant_inventory` remains the only inventory authority.
- Retail catalog queries already filtered to published KOLBE products; service/API regression coverage was retained.
- No payment, order engine, settlement, shipping worker, or UI redesign was introduced.

## Changes

- Added explicit `@Roles` policies to catalog, offer, package, pricing-tier, VIP subscription activation, and review endpoints.
- Supplier seller identity is derived from authenticated `supplier_member` membership and the corresponding active Seller.
- Added persistent `supplier_product_submission` with proposed content, brand references, match suggestion, review status/note, reviewer, and approved Product reference.
- Admin review explicitly creates a new canonical Product plus draft commercial data, or attaches a draft Supplier Offer to an existing non-exclusive Product. Duplicate candidates never auto-merge.
- Supplier-proposed brands remain pending and must be approved before approval-as-new.
- VIP self-subscription now creates `pending`; only an admin endpoint activates it. Pending subscriptions grant no entitlement.
- Wholesale account is derived from session user; Product/Offer/Package ownership and publish/eligibility/MOQ are validated before request insertion.
- KOLBE singleton and seller type/supplier consistency are database-enforced.
- Package creation validates ownership, variants, uniqueness and positive quantities, then inserts parent/items in one transaction.
- Pricing ranges reject zero, inverted, and overlapping tiers.
- Activated `.github/workflows/ci.yml` as the single CI definition.
- Fixed Windows ESM loading in the migration runner using `pathToFileURL`.

## Schema and Migration

- Added migration `0009_phase_3_9_marketplace_hardening.sql` and `0009_snapshot.json`.
- Table count: 41 → 42.
- Migration count: 9 → 10.
- Added `supplier_product_submission` and 9 restrictive foreign keys.
- Added partial unique index `seller_kolbe_singleton`.
- Added seller semantic CHECK and positive/range constraints.
- Migration normalizes only invalid pre-launch development commerce quantities; it does not truncate auth/config data.

**Phase 3.9.1 adds:** migration `0010_phase_3_9_1_commercial_separation.sql` (+ `0010_snapshot.json`) with explicit `commercial` jsonb column to separate catalog attributes from seller commercial terms (sku, wholesalePrice, MOQ, etc.). Migration count 10→11, table count remains 42.

## Tests

- Static test declarations: 308 before, 319 after.
- Executed total after: 323 tests — shared 21, database 42, API 140, frontend 120.
- Added authorization metadata regressions, schema hardening tests, KOLBE singleton checks, legacy-absence checks, and automatic detection of camelCase CHECK helper identifiers.

## Verification

- `npm ci` — passed; npm reported 14 dependency audit findings (7 moderate, 7 high), not auto-fixed because force upgrades are outside scope.
- focused database tests — 42/42 passed.
- focused API tests — 140/140 passed.
- `npm run db:migrate` on fresh isolated `kolbe_phase39_gate` — passed: 10 migrations, 42 tables, 74 FKs, 85 CHECKs.
- `npm run typecheck:all` — passed.
- `npm run test:all` — passed: 323/323.
- `npm run build` — passed; Next.js production build completed.
- `npm run infra:verify` — passed static verification: 12 environment variables and 9 Compose services.

Docker image builds, Compose runtime, and `nginx -t` were not executed and are not claimed.

## CI Status

CI is active in-repository at `.github/workflows/ci.yml`. It runs dependency installation, database validation, typechecks, shared/API/frontend tests, frontend production build, and static infrastructure verification. Remote GitHub execution is not claimed until a pushed workflow run completes.

### Remote CI Verification (Phase 3.9.1 update)

- Initial remote run `35247761239` at SHA `d46e7b207282228538f3f46cb0939af4277f7f4a`: shared ✅, infra ✅, database ❌ (typecheck missing shared dist), api ❌ (tests), frontend-next ❌ (tests missing database dist).
- Root cause: database job lacked `build shared` before typecheck; storefront job lacked `build shared` + `build database` before tests (migrate.mjs needs dist). Fixed in Phase 3.9.1 by building internal deps first in each job (Option A).
- Commercial separation added in 3.9.1: `supplier_product_submission.commercial` jsonb, migration 0010, separation validation `assertSubmissionSeparation`.
- Clean checkout reproduction after fix: `npm ci` + build deps → typecheck:all PASS, test:all 323 PASS (21+42+140+120), build PASS, infra:verify PASS, db:migrate 11/42/74/85.
- New remote run after 3.9.1 push expected SUCCESS (all jobs green); see `phase-3-9-1-report.md` for final run ID.

## Remaining Debt

- Drizzle Kit cannot incrementally generate from older malformed/colliding snapshot lineage; Phase 3.9 generated a clean authoritative snapshot from the current schema and supplied the forward SQL manually. Repairing historical snapshot lineage is separate debt.
- The Next.js `kolbe-api.ts` strangler remains until portal extraction.
- TOTP secret encryption and npm dependency audit findings remain outside this phase.
- Inventory reservation/order conversion belongs to Phase 4; this phase only validates request relationships.

## Completion Boundary

Phase 3.9 hardening is complete. **Phase 4 has NOT started.**
