# `@kolbe/database` — the single schema authority

Everything that defines the PostgreSQL schema of the Kolbe Vintage platform lives here, and
nothing outside this package ever executes DDL against it.

```
src/schema/tables.ts        20 tables: columns, named FKs (ON DELETE RESTRICT), CHECKs, indexes
src/schema/state-values.ts  the single source of allowed status/payment/currency values
src/schema/index.ts          schema barrel (re-exports both of the above)
src/verify.ts               read-only compatibility guard, catalog readers + shape comparison
src/index.ts                package barrel
drizzle.config.ts           drizzle-kit config (schema + migrations folder)
migrations/                 versioned, forward-only SQL + snapshots + journal
migrate.mjs                 the migration runner (the only DDL executor)
test/                       clean migration, legacy upgrade, startup guard, drift tests
```

## Commands

```bash
npm run db:migrate              # apply + verify          (root package.json)
npm run db:migrate:status       # show the plan, change nothing
npm run db:migrate:verify       # read-only shape check
npm run db:adopt-legacy         # one-time adoption of a pre-1.2 database
npm test --workspace @kolbe/database
```

Full operational documentation — local/test/production use, exit codes, failure behaviour, recovery
limits, the constraint inventory and how to add a migration — is in
[`docs/database-migrations.md`](../../docs/database-migrations.md).

## Rules that this package enforces

* Runtime code never creates or alters schema objects; at boot it calls `assertDatabaseReady()` and
  fails closed (`DatabaseNotMigratedError` → `503`) when the database is not migrated.
* Migrations are versioned, forward-only and reproducible from an empty database **and** from a
  phase-1.5 database; there is no runtime-DDL fallback and no destructive recreation.
* Migrations never seed demo data (rule D18); demo seeding is an application concern and requires
  `NODE_ENV !== "production"` **and** `KOLBE_SEED_DEMO_DATA=true`.
* Money is `bigint` in rials, bounded by `MAX_MONEY`; no floating-point column exists.
