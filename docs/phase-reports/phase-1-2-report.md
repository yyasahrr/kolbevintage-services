# Phase 1.2 report — `packages/database` becomes the only schema authority

**Repository:** `yyasahrr/kolbevintage-services` · **Branch:** `arena/01a0ad1f-kolbevintage-services`
(never `main`) · **Started from:** `83eae54` (end of phase 1.5)

| Commit | Scope |
|---|---|
| `5ebdc66` | `packages/database`: single schema authority, verifier, `state-values.ts`, constraint migration `0002`, `migrate.mjs` (+`--status`/`--verify-only`/`--adopt-legacy`), root scripts, package README |
| `03c18b9` | `frontend-next`: runtime DDL deleted, boot-time guard, `503` mapping, health route, test global setup |
| `295d9fc` | `apps/api`: schema verification at boot |
| `fa6bdad` | Tests: `packages/database/test/*` (4 new suites + fixture + helpers) and `frontend-next/test/schema-authority.test.ts`, `schema-flow-regression.test.ts` |
| `62b3bf8` | Docs: `docs/database-migrations.md`, charter §2/§6/§7, blueprint §0.2/§8/§9, roadmap, this report |

No Docker, Compose or Nginx runtime claim is made anywhere in this report; nothing in `infra/` was
executed. No production-readiness claim is made.

---

## 1. What was actually wrong

* `frontend-next/server/database.ts` carried an **11.6 KB inline DDL string** (20 `CREATE TABLE IF
  NOT EXISTS`, 9 `ALTER TABLE … ADD COLUMN`, 1 trigger, 1 function) that ran on every boot, before
  any request. It was the real schema authority: the Drizzle schema in `packages/database` was
  decorative, and drift was only caught by a parity test comparing two hand-written sources.
* Measured on the migrated database before this phase: **0 foreign keys, 0 CHECK constraints**, 15
  free-text status/role columns, 27 `*_id` columns referencing nothing.
* The `system_log` **partial unique index** that `ON CONFLICT (fingerprint) WHERE status = 'open'`
  (`kolbe-api.ts:1320`) requires existed **only in the runtime DDL**.
* Nothing failed closed: the application happily created whatever schema it wanted, so a partially
  migrated or hand-modified database was served as if healthy.

## 2. Runtime DDL removed

`frontend-next/server/database.ts`: **400 → 253 lines**, zero DDL statements
(`rg "CREATE TABLE|ALTER TABLE|CREATE INDEX|CREATE TRIGGER|CREATE OR REPLACE FUNCTION"` → no hits).
`prepareDatabase()` is now data-only; `initialize()` is:

```
assertDatabaseReady(pool())            // read-only: migrations + tables + columns
        │
        ├─ DatabaseNotMigratedError → log code + problem list → rethrow (fail closed)
        └─ ok → optional D18 demo seed (NODE_ENV !== production && KOLBE_SEED_DEMO_DATA=true)
```

Static scans assert this permanently: `packages/database/test/clean-migration.test.ts` (runtime
files of `frontend-next` and `apps/api`) and `frontend-next/test/schema-authority.test.ts`
(`server`, `app`, `storefront`, `supplier-src`) fail on any DDL outside the migration tooling.

## 3. The guard (fail closed)

`assertDatabaseReady(client)` reads `pg_catalog`/`information_schema` and throws
`DatabaseNotMigratedError` when the migration ledger is absent, when a journal entry has no ledger
row, or when a table/column from the snapshots is missing (`SCHEMA_SHAPE_MISMATCH`). It never
writes: `startup-guard.test.ts` asserts the object count is unchanged after a failure.

The public message is always `Database migrations are required. Run the documented migration command
(npm run db:migrate).` — the problem list stays in the server log (rule D26).

| Surface | Unmigrated database | Migrated database |
|---|---|---|
| `GET /api/health` | `503` `{"database":{"status":"down","detail":"migrations-required"}}` | `200` `{"status":"up","detail":"query ok"}` |
| `GET /store/kolbe/health` (legacy handler) | `503` `{"error":"SERVICE_UNAVAILABLE","reason":"migrations-required"}` | `200` |
| `GET /store/kolbe/site/hero-video` (any DB path) | `503` `{"error":"SERVICE_UNAVAILABLE"}` | normal `404 HERO_VIDEO_NOT_FOUND` |
| NestJS boot | `onModuleInit` throws → the process does not serve | logs applied/expected migrations + table count |

Both HTTP probes above were run **end-to-end against the built Next.js server** with
`DATABASE_URL` pointing at an empty database; the empty database still had **0 tables** afterwards —
no runtime repair, and no attempt to create anything.

## 4. Migration `0002` — integrity constraints

Structure: **backfill → read-only precheck → DDL**, all inside the migrator's transaction, so a
failing precheck leaves the database exactly as it was and lists every offending row-group at once.

* **Backfill:** `retail_order.payment_status = 'pending_gateway'` → `'unpaid'` (D19a semantics: with
  no provider, nothing is pending at a gateway).
* **Precheck:** 21 FK pairs (orphan rows), 18 domain pairs (values outside the code state set),
  11 range groups (negative money/quantity, `reserved > on_hand`) — raises once with the full list.
* **21 foreign keys, every one `ON DELETE RESTRICT`** (verified with `pg_get_constraintdef`), none
  on `audit_log`/`system_log` (append-only history must not depend on current rows):
  `supplier_member → supplier, account_user` · `supplier_application → account_user` ·
  `supplier_product → supplier` · `supplier_variant → supplier_product` ·
  `supplier_inventory → supplier_variant` · `wholesale_account → account_user` ·
  `wholesale_order → wholesale_account` · `wholesale_order_item → wholesale_order,
  supplier_product, supplier_variant` · `purchase_order → supplier, wholesale_order` ·
  `purchase_order_item → purchase_order, supplier_variant` · `rfq → supplier` ·
  `quote → rfq, supplier` · `support_ticket → supplier` · `retail_order → account_user` ·
  `retail_order_item → retail_order`.
  Cascade was never used; `retail_order.customer_id` is nullable (guest checkout stays valid).
* **40 CHECK constraints**, all mirroring sets that already exist in code
  (`packages/database/src/schema/state-values.ts` re-uses `@kolbe/shared` state machines):
  * status/role: `account_user.role {customer,vip,admin,supplier}`;
    `supplier.status`, `supplier_application.status`, `supplier_product.status`, and
    `wholesale_account.status` — each exactly the list the admin endpoints validate;
    `wholesale_order.status` (`WHOLESALE_ORDER_STATUSES`), `purchase_order.status`
    (`CHILD_ORDER_STATUSES`), `rfq.status {open,quoted}`, `quote.status {submitted}`,
    `support_ticket.status {open,answered,closed}` + `priority {low,normal,high}`,
    `retail_order.order_status` (`RETAIL_ORDER_STATUSES`).
  * payment/shipping/currency: `retail_order.payment_status {unpaid,pending_cod}` (the D19a set —
  **N4 closed**: the old `pending_gateway` default is gone), `pay_method`/`payment_method`
  (`RETAIL_PAYMENT_METHODS`), `shipping_method {post,pishtaz,tipax}`, currency `IRR`.
  * money: 13 range checks `>= 0 AND <= 1000000000000000` (`MAX_MONEY`) on every money column —
    `total_amount`, `items_total`, `shipping_price`, `unit_price`, `line_total`,
    `wholesale_price`, `cost`, … No `real`/`double precision` column exists in the schema
    (asserted by test).
  * quantity/inventory: `quantity >= 0` (4 tables), `on_hand >= 0`, `reserved >= 0`, and
    **`reserved <= on_hand`** — justified from the workflow, not from the column name:
    reservation happens only after `FOR UPDATE OF i` + `on_hand - reserved >= qty`
    (`kolbe-api.ts:776-795`), delivery decrements both with `GREATEST(0, …)` (`:447`), cancellation
    only lowers `reserved` (`:1156`), inserts start at `(stock, 0)` (`:572`). Data audit before the
    constraint: 0 rows violated it.
* **Uniques:** unchanged in semantics. The migrated baseline names them `*_unique` where the runtime
  DDL used PostgreSQL's automatic `*_key`; `compareShape()` deliberately ignores constraint names.
  `system_log` gained `system_log_open_fingerprint` (`UNIQUE (fingerprint) WHERE status='open'`) and
  `system_log_last_seen (last_seen_at DESC)` — the drift that had been breaking the error upsert.
  `idempotency_key` uniques stay full (fresh) as before; an adopted database keeps its partial
  variant, which is the same guarantee.

Verified count on the migrated database: **20 tables · 21 FK · 40 CHECK · 37 indexes · 1 trigger ·
1 function**, repeated by `npm run db:migrate` output and by the test suites.

## 5. Clean migration (empty database)

`packages/database/test/clean-migration.test.ts` (15 tests) recreates `kolbe_phase12_clean_test`,
runs `migrate.mjs` and asserts: guard green; snapshot parity for indexes/uniques/FKs/CHECKs; every
Drizzle model column and nullability present; model uniques indexed; all FKs `RESTRICT` and none on
history tables; real violation rejections (`23505` duplicate email, `23514` bad role / negative
price / `reserved > on_hand`, `23503` orphan membership); `MAX_MONEY` enforced at the database;
audit append-only trigger active on `UPDATE` **and** `DELETE`; the `system_log` partial upsert;
`payment_status` defaults to `unpaid`; migrations plant **no** demo data; a second run is a no-op;
no runtime DDL in scanned application files; CHECK value extraction matches `state-values.ts`.

`startup-guard.test.ts` (6) · `state-constraints.test.ts` (7) · `legacy-upgrade.test.ts` (8) cover
the guard, drift between code/snapshot/database, and the upgrade path.

## 6. Upgrade from a phase-1.5 database

The phase-1.5 schema is reproduced exactly in
`packages/database/test/fixtures/legacy-phase-1.5-schema.sql` (copied verbatim from
`frontend-next/server/database.ts` at `83eae54`, drift included) and filled with data that touches
every table. Results:

1. the fixture really is "legacy": 0 FKs, 0 CHECKs, no migration ledger;
2. a plain `db:migrate` fails (baseline `CREATE TABLE` collides) — adoption is required;
3. `--adopt-legacy` verifies the shape against the baseline snapshot, stamps `0000`/`0001`
   (`hash = legacy-adopted:<tag>`), applies `0002`, and the guard then confirms **3 migrations**;
4. **all row counts are identical before and after** (accounts, products, wholesale orders + items,
   purchase orders, retail orders + items, audit rows) and the flows still work;
5. the new constraints really are live on the adopted database (orphan insert → `23503`, illegal
   status → `23514`, `reserved > on_hand` → `23514`);
6. a second `--adopt-legacy` prints `پذیرش لازم نیست` and exits `0` (idempotent);
7. **dirty data is refused**: a `quote.status='draft'` row and a `quantity=-3` row make the precheck
   report both problems, the migration rolls back with **0 FKs added**, and after cleaning up the
   data the same command succeeds;
8. a database *older* than the baseline is refused with exit `2` and a list of the missing
   columns (documented recovery: boot the previous release once, then retry).

## 7. Business flows re-run on the migrated schema

`frontend-next/test/schema-flow-regression.test.ts` drives the whole wholesale chain through the
real HTTP handler: VIP application → admin approval → wholesale order (12 units, `transfer`) →
stock **reserved** → admin approval → supplier child order (`purchase_order` + item) →
`confirmed → preparing → shipped (tracking) → delivered` → stock decremented, reservation released,
parent order `fulfilled`, audit rows for each step, and an illegal transition still answered with
`409 INVALID_STATUS_TRANSITION`. A retail COD order is then created through the real checkout:
`payment_status=pending_cod`, `order_status=placed`, `customer_id` NULL for a guest, structured
`retail_order_item` rows.

The existing phase-1.5 suites (VIP membership, supplier moderation, reservation, supplier
fulfilment, admin approval, retail checkout, audit logging, log ingestion, Try-On quotas, session
security, error disclosure, demo-seed guard) run unchanged on top of the migrated database.

## 8. Test counts and gates

| Workspace | Before 1.2 | After 1.2 |
|---|---|---|
| `@kolbe/shared` | 21 | 21 |
| `@kolbe/database` | 4 | **36** (clean 15 · guard 6 · drift 7 · upgrade 8) |
| `@kolbe/api` | 17 | 17 |
| `kolbe-next` (frontend-next) | 85 (12 files) | **92** (14 files, +authority 5, +flow 2) |
| **Total** | **127** | **166** |

Gates, all run on the final tree from a clean install (`npm ci`, 0 failures):

| Gate | Result |
|---|---|
| `npm ci` | ✅ from `package-lock.json` |
| `npm run db:migrate` | ✅ on a **dropped and recreated** database: 3 migrations, 20 tables, 21 FK, 40 CHECK |
| `npm run db:migrate:status` | ✅ `✓ 0000 · ✓ 0001 · ✓ 0002` |
| `npm run db:migrate:verify` | ✅ shape verified |
| `npm run db:adopt-legacy` (already migrated) | ✅ `پذیرش لازم نیست`, exit 0 |
| `npm run typecheck:all` | ✅ shared · database · api · next |
| `npm run test:all` | ✅ 166 passed / 22 files |
| `npm run build` | ✅ Next.js production build, all routes |
| `npm run infra:verify` | ✅ structure only (12 env vars, 9 compose services) — **no Docker runtime proof** |

## 9. Files

* **New:** `packages/database/src/verify.ts`, `src/schema/state-values.ts`,
  `migrations/0002_oval_puff_adder.sql`, `migrations/meta/0002_snapshot.json`,
  `test/{helpers,clean-migration,startup-guard,state-constraints,legacy-upgrade}.ts`,
  `test/fixtures/legacy-phase-1.5-schema.sql`, `packages/database/README.md`,
  `frontend-next/test/schema-authority.test.ts`, `frontend-next/test/schema-flow-regression.test.ts`,
  `docs/database-migrations.md`, this report.
* **Changed:** `packages/database/{migrate.mjs,package.json}`, `src/index.ts`,
  `src/schema/{index,tables}.ts`, `migrations/meta/_journal.json`, root
  `package.json`/`package-lock.json`, `frontend-next/server/database.ts`,
  `frontend-next/server/kolbe-api.ts`, `frontend-next/app/api/health/route.ts`,
  `frontend-next/test/{global-setup,demo-seed-guard.test}.ts`,
  `apps/api/src/database/database.module.ts`, charter, blueprint, roadmap.
* **Deleted:** `packages/database/test/schema-parity.test.ts` (it compared the Drizzle model with the
  runtime DDL string — a model that no longer exists; replaced by the four suites above).

## 10. Unresolved integrity problems and new debt (N8–N12)

* **N8** `POST admin/tickets/:id` and `POST admin/supplier-applications/:id` still write
  `body.status` without validating it; an out-of-set value now returns `500` (CHECK violation)
  instead of `422`. Latent: neither has a UI caller today.
* **N9** `admin/logs/:id` writes `system_log.status` with no CHECK and no validation (free text).
* **N10** Client type unions still advertise states the server rejects
  (`AdminSupplierProduct.status` → `changes_requested`; `AdminWholesaleAccount.status` →
  `financial_blocked`, and `expired` is missing), leaving dead branches in `WholesaleAdmin.tsx`.
  Deliberately left alone to keep this phase's diff schema-scoped.
* **N11** Adopted databases keep the btree direction of their legacy `audit_log` indexes
  (`created_at DESC`); the shape comparison ignores direction on purpose.
* **N12** Status columns with no code-defined state set stay unconstrained
  (`retail_order.fulfillment_status`, `system_log.status`, `audit_log.action`).
* **Operational limits (documented, not defects):** migrations are forward-only — rollback means
  restoring a backup and reverting the code; `--adopt-legacy` refuses a database older than the
  baseline (boot the previous release once first); index-only differences on an adopted database
  (`*_key` names, partial vs full idempotency uniqueness, index direction) are accepted and can be
  normalized later if a measurement justifies it.
* **Still open from the register:** D19 (no payment/ledger domain — retail orders record the truth
  `unpaid`/`pending_cod` but nothing is collected; phase 5), D28 (wholesale totals in JS floats),
  D35 (no CSRF/Origin check), D36, D40 (no E2E browser test), D31/D30/D37 etc. unchanged.

## 11. What was **not** done (honest list)

* No Docker, Compose, Nginx or image build was run — `infra:verify` is a static check only
  (phase 1.3).
* No NestJS auth cut-over, no portal extraction, no payments/wallet/ledger/settlement/shipping
  providers, no Style Builder, no Try-On redesign (explicitly out of scope for 1.2).
* The migrated schema was **not** handed over as the production write path: the legacy Next.js
  handler still serves every domain, now on a migration-built schema (strangler preserved).
* The background/worker process (BullMQ) does not exist yet, so the "workers never create schema"
  clause is satisfied by absence, not by a guard.
* `npm run db:migrate` was exercised against local/embedded PostgreSQL only; no production-sized
  data, no long-lock measurement on `audit_log` index work.
* The `--adopt-legacy` route was tested against the reproduced 1.5 fixture and an earlier live
  `kolbe_legacy` copy, not against a customer installation.
