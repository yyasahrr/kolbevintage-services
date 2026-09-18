# Phase 3.9.1 Report — CI Parity and Final Phase 3.9 Acceptance

**Repository:** `yyasahrr/kolbevintage-services`

**Branch:** `arena/01a0ad1f-kolbevintage-services`

**Starting SHA:** `eef72d38cd19be5db5a9693e68cb9b8fa4a7b724`

**Scope:** CI parity only; Phase 3.9 marketplace boundaries preserved; Phase 4 was not started.

## Failed Remote Run

GitHub Actions run `35251027851` at the starting SHA concluded `failure`:

| Job | Result | Failing command | Exact failure |
| --- | --- | --- | --- |
| shared | success | — | — |
| database | failure | `npm run typecheck --workspace @kolbe/database` | `Cannot find module '@kolbe/shared' or its corresponding type declarations.` (exit code 2) |
| api | failure | `npm test --workspace @kolbe/api` | `Command failed: ... node .../scripts/pg.mjs ensure` from `apps/api/test/api.e2e.test.ts:43` (exit code 1) |
| frontend-next | failure | `npm test --workspace kolbe-next` | test step exited with code 1 while its global setup invoked the same `scripts/pg.mjs ensure` path |
| infra | success | — | — |

GitHub's archived log download was unavailable because its Azure blob URL failed TLS/IPv6 access. The exact database and API errors above were recovered from GitHub check annotations. The frontend annotation exposed only the failing test step and exit code; the shared global-setup path and clean-state reproduction established the same PostgreSQL bootstrap boundary.

## Root Causes and Fixes

1. `@kolbe/database` imports `@kolbe/shared`, whose package exports point to `dist`. The database job started from a clean checkout but did not build shared first. The workflow now builds `@kolbe/shared` before database typecheck/build/test.
2. API and frontend test global setup both execute `scripts/pg.mjs ensure`. On non-Windows hosts that script hard-coded `/home/user/pg`, an environment-specific location that is not a reliable writable workspace path on GitHub runners. PostgreSQL data now defaults to the ignored, repository-local `.postgres-data` on every platform while preserving the `KOLBE_PG_DIR` override.
3. The frontend tests import internal workspace packages through their built exports and run database migration setup. Because GitHub Actions jobs have isolated filesystems, the frontend job now builds both `@kolbe/shared` and `@kolbe/database` before typecheck/tests/build.
4. The obsolete workflow header claiming `.github/workflows/ci.yml` still needed to be moved was removed. This remains the single canonical workflow; `infra/ci/ci.yml` was not recreated.

The API job's existing dependency build order was preserved. No test was removed, skipped, weakened, made optional, or hidden behind `continue-on-error`/`|| true`.

## Preserved Phase 3.9.1 Commercial Separation

Migration `0010_phase_3_9_1_commercial_separation.sql` and `supplier_product_submission.commercial` remain unchanged. Catalog attributes remain separate from seller SKU, wholesale price, MOQ, package type, and commercial terms. The validation that rejects commercial keys in generic attributes remains active. No migration was added or modified in this CI parity change.

The following boundaries remain covered by the existing suites: supplier wholesale-only access, KOLBE-only retail offers, KOLBE-exclusive product protection, server-derived supplier identity, admin-moderated product submissions without automatic merge/publish, canonical `product_variant_inventory`, pending VIP subscription activation, and server-derived wholesale account identity.

## Local Clean-State Verification

Ignored build/install outputs were removed before `npm ci --no-audit --no-fund`. Each CI sequence was then executed with its own required dependency builds:

- shared: typecheck/build/test — 21/21 tests passed.
- database: build shared, typecheck/build/test — 42/42 tests passed.
- api: build shared/database, typecheck/build/test — 140/140 tests passed.
- frontend-next: build shared/database, typecheck/test/build — 120/120 tests passed.
- infra: `npm run infra:verify` passed (12 environment variables, 9 Compose services checked statically).

Final aggregate gates:

- `npm run db:migrate` against empty `phase391_ci` — passed: 11 migrations, 42 tables, 74 foreign keys, 85 CHECK constraints.
- `npm run typecheck:all` — passed.
- `npm run test:all` — passed: 323/323 tests (21 shared + 42 database + 140 API + 120 frontend).
- `npm run build` — passed.
- `npm run infra:verify` — passed.

Docker image/runtime, Compose runtime, and `nginx -t` were not executed or claimed.

## Remote Verification

Corrected workflow run `35254935321` at commit `d7b968d1f385a4e8216dfb66d1551ed11c380425` concluded `success`:

| Job | Conclusion |
| --- | --- |
| shared | success |
| database | success |
| api | success |
| frontend-next | success |
| infra | success |

This is the successful remote verification run for the CI/code changes. GitHub also emitted non-blocking deprecation notices because `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node.js 20 action runtime and were forced onto Node.js 24; updating those action majors is tracked as technical debt rather than expanding this parity fix.

## Remaining Technical Debt

- Historical Drizzle snapshot lineage remains malformed; repairing that lineage is separate from this checkpoint.
- The Next.js `kolbe-api.ts` strangler remains.
- TOTP secret encryption and existing npm audit findings remain outside this scope.
- Upgrade `actions/checkout` and `actions/setup-node` after validating their next major versions; GitHub currently applies the Node.js 24 action runtime compatibility override.

Phase 4 was not started.
