# Database migrations — the one schema authority

**Rule A21.** `packages/database` is the only place where the PostgreSQL schema is defined and the
only way it is ever changed. Application code — the legacy Next.js handler, NestJS, workers, scripts
— never runs `CREATE`/`ALTER`/`DROP` against the business schema. At boot an application only
*verifies* that the database it is connected to matches the migrations and **fails closed** if it
does not.

| Layer | Where it lives | What it may do at runtime |
|---|---|---|
| Schema definition | `packages/database/src/schema/tables.ts` (+ `state-values.ts`) | nothing (build-time only) |
| Migrations (DDL) | `packages/database/migrations/*.sql` | nothing (applied by `npm run db:migrate`) |
| Compatibility guard | `packages/database/src/verify.ts` | read the catalog, compare, throw |
| Migration runner | `packages/database/migrate.mjs` | the only process that executes DDL |
| Legacy Next.js handler | `frontend-next/server/database.ts` | connect → guard → (optional demo seed) |
| NestJS API | `apps/api/src/database/database.module.ts` | `SELECT 1` → guard → log |

---

## 1. Commands

Run everything from the repository root.

| Command | What it does | When to use it |
|---|---|---|
| `npm run db:migrate` | applies every unapplied migration, then verifies the result | **the canonical command** — deploy, local setup, CI |
| `npm run db:migrate:status` | prints `✓`/`✗` per migration; applies nothing | before an upgrade, in an incident |
| `npm run db:migrate:verify` | read-only compatibility check (exit `3` on mismatch) | healthchecks, pre-deploy gate |
| `npm run db:adopt-legacy` | one-time adoption of a database that was built by the pre-1.2 runtime DDL | upgrading an existing 1.5 installation |

All four load the connection string from `DATABASE_URL` and build `packages/database` first
(`build:packages`), so they work from a clean checkout with no manual SQL and no `ts-node`.

```
DATABASE_URL=postgres://user:pass@host:5432/kolbe npm run db:migrate
```

Default when `DATABASE_URL` is unset: `postgres://postgres:postgres@127.0.0.1:55432/kolbe`
(the embedded development instance started by `npm run pg`).

### Exit codes

| Code | Meaning |
|---|---|
| `0` | applied and verified (or nothing to do) |
| `1` | a migration failed — the transaction was rolled back, nothing was applied |
| `2` | refused before touching the database (`--adopt-legacy` shape mismatch, or the verifier module was not built) |
| `3` | migrations applied, but the shape check afterwards found a mismatch |

On failure the runner prints the real PostgreSQL message and detail, not just Drizzle's
`Failed query: …`. A failed precheck therefore lists **every** offending row-group at once.

---

## 2. Local and test use

```
npm ci
npm run pg          # embedded PostgreSQL on :55432 (no Docker required)
npm run db:migrate  # creates the schema from migrations
```

Test suites never rely on the developer's database:

* `frontend-next/test/global-setup.ts` recreates `kolbe_test` and runs the same `migrate.mjs`
  (with `DATABASE_URL` forced) before the suite starts. `npm run build:packages` must have run at
  least once — every root test script does it for you.
* `packages/database/test/*` create and drop their own databases (`kolbe_phase12_*`).
* `apps/api/test/*` create and migrate `kolbe_api_test`.

No test recreates the schema by hand, and no test may pass because the application repaired the
schema on boot: the guard test asserts that a failed guard leaves **zero** tables behind.

---

## 3. Production use

1. **Back up first.** Migrations are forward-only; there is no automatic rollback.
2. `npm run db:migrate:status` against the production `DATABASE_URL` — read the plan.
3. `npm run db:migrate`.
4. `npm run db:migrate:verify` (or call the health endpoint: it runs the same guard).
5. Only then start/roll the application. A partially migrated database refuses traffic: the
   Next.js handler returns `503 SERVICE_UNAVAILABLE` and `GET /api/health` answers `503` with
   `database.detail = "migrations-required"`. Neither response contains table/column names,
   driver messages or SQLSTATE codes.

Migration files are additive by policy: a migration may add tables, columns, indexes, constraints
and backfills, but must not drop or rewrite data that a previous release depends on. Columns and
tables that existed before this phase are never dropped.

### Upgrading a pre-1.2 installation (`--adopt-legacy`)

Before phase 1.2 the Next.js application created the schema itself at boot. Such a database has
all the tables but **no migration ledger**, so the baseline migration would fail with
`relation "account_user" already exists`. The one-time procedure is:

```
npm run db:adopt-legacy     # verifies the current shape, then stamps 0000 + 0001
npm run db:migrate          # normally already run by the same command
```

`--adopt-legacy`:

1. compares the live columns against `migrations/meta/0000_snapshot.json`;
2. refuses (exit `2`, listing the missing tables/columns) if the database is **older** than the
   baseline — fix it by booting the previous release once so its idempotent `ALTER`s run, then retry;
3. otherwise records 0000/0001 as applied (the ledger row's hash is marked `legacy-adopted:<tag>`)
   and lets the remaining migrations run against the existing data;
4. is safe to re-run: if a ledger already exists it prints `پذیرش لازم نیست` and exits `0`.

**What it does not do:** it never runs DDL of its own, never deletes data and never repairs a
mismatched schema. It also does not re-create indexes that the legacy runtime DDL had already
created with the same definition — the later migrations create them with `IF NOT EXISTS`.

### Demo data

Migration and demo data are separate concepts (rule D18, phase 1.5). Migrations never insert demo
rows — verified by `test/clean-migration.test.ts`. The demo accounts are planted only when
`NODE_ENV !== "production"` **and** `KOLBE_SEED_DEMO_DATA=true`, by the application, after the
guard has passed.

---

## 4. What the guard checks

`assertDatabaseReady(client)` (used by `migrate.mjs`, the Next.js handler and NestJS) reads the
catalog and throws `DatabaseNotMigratedError` when:

* the migration ledger `drizzle.__drizzle_migrations` is missing, or
* any migration in `migrations/meta/_journal.json` has no ledger row
  (`MIGRATIONS_NOT_APPLIED`), or
* a table or column from the migration snapshots is missing / has the wrong nullability
  (`SCHEMA_SHAPE_MISMATCH`).

`compareShape()` additionally compares indexes, uniques, foreign keys and CHECK constraints
(key constraint *names* are not compared; a database adopted from the runtime DDL keeps its
`*_key` names, see `test/legacy-upgrade.test.ts`).

The guard is strictly read-only: it opens no transaction of its own and issues no statement other
than `SELECT` against `information_schema`/`pg_catalog`. `packages/database/test/startup-guard.test.ts`
asserts that a guard failure leaves the object count unchanged.

The public message is always
`Database migrations are required. Run the documented migration command (npm run db:migrate).`;
the per-problem detail list stays in the server log (rule A7/D26).

---

## 5. Integrity constraints added in 1.2 (migration `0002`)

Migration `0002` first **backfills** (`retail_order.payment_status: 'pending_gateway' → 'unpaid'`),
then runs a **read-only precheck** that lists every row-group that would violate a new constraint,
and only then adds the constraints. If the precheck finds anything, the whole migration rolls back
and nothing is added — the operator cleans up and re-runs.

* **21 foreign keys**, every one `ON DELETE RESTRICT` — no cascade anywhere, and no foreign key was
  added to `audit_log` / `system_log` (append-only history must not be constrained by current rows).
* **40 CHECK constraints**: account role; supplier, supplier-application, supplier-product,
  wholesale-account, wholesale-order, purchase-order, RFQ, quote, support-ticket (status +
  priority) and retail-order status; payment status/method, shipping method and currency;
  non-negative quantities and `reserved <= on_hand` for inventory; and money ranges
  (integer `bigint`, `>= 0` and `<= 1000000000000000` = `MAX_MONEY`).
* **Uniques** are unchanged in semantics; the migrated baseline names them `*_unique` where the
  runtime DDL used PostgreSQL's automatic `*_key` names — the same index, verified by
  `compareShape()`, which ignores constraint names on purpose.
* `system_log` gained the partial unique index `system_log_open_fingerprint`
  (`WHERE status = 'open'`) that the error-upsert path (`ON CONFLICT (fingerprint) WHERE status =
  'open'`) has always required, plus `system_log_last_seen (last_seen_at DESC)`.

The allowed value sets live in one place: `packages/database/src/schema/state-values.ts` (which
re-uses the state machines in `@kolbe/shared`). `test/state-constraints.test.ts` asserts that the
Drizzle model, the migration snapshot and the migrated database all agree with that file, so a
value can no longer be added to one layer only.

---

## 6. Changing the schema

1. Edit the Drizzle model in `packages/database/src/schema/`.
2. `npx drizzle-kit generate` inside `packages/database` → a new numbered `migrations/*.sql`.
3. Review it by hand: add a backfill for existing rows, a precheck `DO` block for anything that can
   fail on real data, and `IF NOT EXISTS` where the object may already exist on an adopted database.
   Never edit an already-applied migration: the ledger records what ran.
4. `npm run db:migrate` (local) and the tests:
   `npm test --workspace @kolbe/database` covers fresh migration, upgrade, guard and drift;
   `cd frontend-next && npx vitest run` covers the handler, constraints and flows.
5. Document user-visible or operational consequences in this file and in the phase report.

`test/clean-migration.test.ts` includes a static scan that fails if any runtime file under
`frontend-next/server`, `frontend-next/app`, `frontend-next/storefront`, `frontend-next/supplier-src`,
`apps/api/src` or `packages/shared/src` contains `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` /
`CREATE TRIGGER` / `CREATE OR REPLACE FUNCTION` / `DROP TABLE` outside comments.
