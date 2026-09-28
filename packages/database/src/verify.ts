/**
 * نگهبان سازگاری اسکیما — «اتصال بزن، بررسی کن، و اگر ناسازگار بود ببند».
 *
 * ── چرا این ماژول وجود دارد ──────────────────────────────────────────────────
 * تا پیش از گام ۱.۲، خودِ کد زمان اجرا اسکیما را می‌ساخت (`frontend-next/server/database.ts`).
 * با حذف آن DDL این خطر به وجود می‌آید که سرویس روی دیتابیس مهاجرت‌نشده بالا بیاید
 * و در نخستین کوئری با خطای مبهم بترکد — یا بدتر، بخشی از داده را بنویسد.
 *
 * قاعدهٔ گام ۱.۲: **کد زمان اجرا اسکیما نمی‌سازد، فقط بررسی می‌کند.**
 * پس هر نقطهٔ ورود (route handler قدیمی Next.js و سرویس NestJS) پیش از سرو
 * کردن ترافیک این تابع را صدا می‌زند:
 *
 *   - مهاجرت‌ها کامل و ستون‌ها موجود → ادامه بده.
 *   - ناقص → ببند (fail closed) با خطای عملیاتی روشن:
 *     «Database migrations are required. Run the documented migration command.»
 *
 * ── منبع حقیقت ──────────────────────────────────────────────────────────────
 * این ماژول هیچ تعریف اسکیمایی از خودش ندارد. دو مصنوعِ **تولیدشده از اسکیمای
 * Drizzle** را می‌خواند:
 *   ۱) `migrations/meta/_journal.json` — فهرست نسخه‌های مهاجرت.
 *   ۲) `migrations/meta/<idx>_snapshot.json` — شکل موردانتظار (جدول/ستون/قید).
 * پس «مرجع واحد اسکیما» همان `packages/database/src/schema` می‌ماند و این فایل
 * فقط یک **خوانندهٔ** آن است. اگر روزی این دو از هم جدا شوند، آزمون‌های
 * `test/migrations.test.ts` شکست می‌خورند.
 *
 * ── وابستگی‌ها ──────────────────────────────────────────────────────────────
 * صفر وابستگی (فقط `node:fs`/`node:path`) و فقط یک رابط ساختاری از اتصال
 * دیتابیس (`Queryable`). بنابراین هم `apps/api` (از طریق `@kolbe/database`) و هم
 * لایهٔ گذار Next.js می‌توانند بدون کشیدن `drizzle-orm`/`pg` اضافه از آن استفاده
 * کنند. در گام ۱.۲ عمداً به `frontend-next` وابستگی workspace اضافه نشد تا گراف
 * وابستگی اپ قدیمی (استراتژی strangler) دست‌نخورده بماند — بدهی ثبت‌شده در
 * گزارش فاز.
 */

import fs from "node:fs";
import path from "node:path";

/** دستور مستند و متعارف مهاجرت — همان چیزی که در پیام خطا به اپراتور گفته می‌شود. */
export const MIGRATION_COMMAND = "npm run db:migrate";

/** پیام عمومی و عملیاتی برای شکست نگهبان؛ بدون هیچ جزئیات دیتابیس. */
export const MIGRATIONS_REQUIRED_MESSAGE = `Database migrations are required. Run the documented migration command (${MIGRATION_COMMAND}).`;

/**
 * خطای «دیتابیس مهاجرت‌نشده».
 *
 * `details` برای **لاگ سرور** است، نه برای پاسخ HTTP. لایهٔ HTTP (اصلاح D26)
 * فقط پیام عمومی را برمی‌گرداند تا نام جدول/ستون یا کد SQLSTATE بیرون نریزد.
 */
export type DatabaseNotMigratedCode = "MIGRATIONS_NOT_APPLIED" | "SCHEMA_SHAPE_MISMATCH";

export class DatabaseNotMigratedError extends Error {
  /**
   * ⚠️ نکتهٔ فنی: هیچ پارامتر-ویژگی (parameter property) یا enum در این فایل نیست
   * تا Node بتواند همین فایل TS را بدون build بخواند (`node migrate.mjs` باید از
   * یک checkout تمیز و بدون مرحلهٔ کامپایل کار کند).
   */
  code: DatabaseNotMigratedCode;
  details: readonly string[];

  constructor(code: DatabaseNotMigratedCode, details: readonly string[]) {
    super(MIGRATIONS_REQUIRED_MESSAGE);
    this.name = "DatabaseNotMigratedError";
    this.code = code;
    this.details = details;
  }
}

/** خطای «مصنوعات مهاجرت در این استقرار پیدا نشد» — خطای استقرار است، نه دیتابیس. */
export class MigrationsArtifactMissingError extends Error {
  searchedPaths: readonly string[];

  constructor(searchedPaths: readonly string[]) {
    super(
      "Migration artifacts are missing in this deployment. Set KOLBE_MIGRATIONS_DIR to the " +
        "packages/database/migrations directory (or deploy it next to the application).",
    );
    this.name = "MigrationsArtifactMissingError";
    this.searchedPaths = searchedPaths;
  }
}

/** رابط ساختاری اتصال — سازگار با `pg.Pool` و `pg.PoolClient`. */
export type Queryable = {
  query: (text: string, values?: any[]) => Promise<{ rows: any[] }>;
};

export type MigrationEntry = { idx: number; tag: string; when: number };
export type MigrationPlan = { dir: string; entries: MigrationEntry[] };

/** یک قید یکتایی مورد انتظار (از snapshot). */
export type ExpectedUnique = { table: string; name: string; columns: string[]; partial: boolean };
/** یک FK مورد انتظار (از snapshot). */
export type ExpectedForeignKey = {
  table: string;
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: string;
};
/** یک CHECK مورد انتظار (از snapshot). */
export type ExpectedCheck = { table: string; name: string; value: string };

/** شکل مورد انتظار اسکیما که از snapshot استخراج می‌شود. */
export type ExpectedShape = {
  tables: Array<{ name: string; columns: Array<{ name: string; notNull: boolean }> }>;
  uniques: ExpectedUnique[];
  foreignKeys: ExpectedForeignKey[];
  checks: ExpectedCheck[];
};

/** `created_at` در درایور `pg` رشته برمی‌گردد (ستون bigint). */
const migrationTime = (value: unknown): number => Number(value);

/**
 * مسیر پوشهٔ مهاجرت‌ها را پیدا می‌کند.
 *
 * ترتیب جست‌وجو: `KOLBE_MIGRATIONS_DIR` (صریح) → مسیرهای داده‌شده → `process.cwd()`
 * → پوشهٔ والد → دو پوشهٔ والد (پوشهٔ اپ Next.js، ریشهٔ مخزن، `apps/api`).
 */
export function resolveMigrationsDir(candidates?: Array<string | undefined>): string {
  const searched: string[] = [];
  const roots = [
    process.env.KOLBE_MIGRATIONS_DIR,
    ...(candidates ?? []),
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "..", ".."),
  ].filter((value): value is string => Boolean(value));

  for (const root of roots) {
    // حالت ۱: `root` خودِ پوشهٔ مهاجرت است.
    if (fs.existsSync(path.join(root, "meta", "_journal.json"))) return root;
    // حالت ۲: `root` ریشهٔ مخزن/ورک‌اسپیس است.
    const dir = path.join(root, "packages", "database", "migrations");
    searched.push(dir);
    if (fs.existsSync(path.join(dir, "meta", "_journal.json"))) return dir;
  }
  throw new MigrationsArtifactMissingError(searched);
}

/** فهرست مهاجرت‌ها را از ژورنال می‌خواند. */
export function readMigrationPlan(dir: string): MigrationPlan {
  const journalFile = path.join(dir, "meta", "_journal.json");
  if (!fs.existsSync(journalFile)) throw new MigrationsArtifactMissingError([journalFile]);
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as {
    entries: MigrationEntry[];
  };
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  if (entries.length === 0) throw new MigrationsArtifactMissingError([dir]);
  return { dir, entries };
}

/** مسیر snapshot مربوط به یک نسخهٔ مهاجرت. */
export function snapshotPath(dir: string, entry: MigrationEntry): string {
  return path.join(dir, "meta", `${String(entry.idx).padStart(4, "0")}_snapshot.json`);
}

type RawSnapshot = {
  tables: Record<
    string,
    {
      name: string;
      columns: Record<string, { name: string; notNull: boolean }>;
      indexes?: Record<
        string,
        { name: string; columns?: Array<{ expression: string }>; isUnique?: boolean; where?: string | null }
      >;
      uniqueConstraints?: Record<string, { name: string; columns: string[] }>;
      foreignKeys?: Record<
        string,
        {
          name: string;
          columnsFrom?: string[];
          columnsTo?: string[];
          tableFrom?: string;
          tableTo?: string;
          onDelete?: string;
        }
      >;
      checkConstraints?: Record<string, { name: string; value: string }>;
    }
  >;
};

/**
 * شکل مورد انتظار را از snapshot می‌خواند (نه از خود کد — تا نگهبان مستقل بماند).
 *
 * @param entry نسخهٔ مهاجرتی که snapshot آن مرجع است؛ پیش‌فرض آخرین نسخه.
 */
export function readExpectedShape(plan: MigrationPlan, entry?: MigrationEntry): ExpectedShape {
  const target = entry ?? plan.entries[plan.entries.length - 1];
  const file = snapshotPath(plan.dir, target);
  if (!fs.existsSync(file)) throw new MigrationsArtifactMissingError([file]);
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8")) as RawSnapshot;

  const shape: ExpectedShape = { tables: [], uniques: [], foreignKeys: [], checks: [] };
  for (const table of Object.values(snapshot.tables)) {
    shape.tables.push({
      name: table.name,
      columns: Object.values(table.columns).map((column) => ({ name: column.name, notNull: column.notNull })),
    });
    for (const unique of Object.values(table.uniqueConstraints ?? {})) {
      shape.uniques.push({ table: table.name, name: unique.name, columns: unique.columns, partial: false });
    }
    for (const index of Object.values(table.indexes ?? {})) {
      // ایندکس یکتای مستقل (با یا بدون شرط جزئی) هم یک «یکتایی» است.
      if (index.isUnique) {
        shape.uniques.push({
          table: table.name,
          name: index.name,
          columns: (index.columns ?? []).map((column) => column.expression),
          partial: Boolean(index.where),
        });
      }
    }
    for (const fk of Object.values(table.foreignKeys ?? {})) {
      shape.foreignKeys.push({
        table: table.name,
        name: fk.name,
        columns: fk.columnsFrom ?? [],
        referencedTable: (fk.tableTo ?? "").replace(/^public\./, ""),
        referencedColumns: fk.columnsTo ?? [],
        onDelete: fk.onDelete ?? "no action",
      });
    }
    for (const check of Object.values(table.checkConstraints ?? {})) {
      shape.checks.push({ table: table.name, name: check.name, value: check.value });
    }
  }
  shape.tables.sort((a, b) => a.name.localeCompare(b.name));
  return shape;
}

/** وضعیت مهاجرت‌های اعمال‌شده در دیتابیس. */
export type AppliedMigrations = {
  tableExists: boolean;
  rows: Array<{ hash: string; createdAt: number }>;
};

/** دفتر مهاجرت Drizzle را می‌خواند. */
export async function readAppliedMigrations(db: Queryable): Promise<AppliedMigrations> {
  const exists = await db.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS present");
  if (!exists.rows[0]?.present) return { tableExists: false, rows: [] };
  const result = await db.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at");
  return {
    tableExists: true,
    rows: result.rows.map((row) => ({ hash: String(row.hash), createdAt: migrationTime(row.created_at) })),
  };
}

/** ستون‌های واقعی جداول `public`. */
export async function readActualColumns(db: Queryable): Promise<Map<string, Set<string>>> {
  const result = await db.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
  );
  const map = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const table = String(row.table_name);
    if (!map.has(table)) map.set(table, new Set());
    map.get(table)!.add(String(row.column_name));
  }
  return map;
}

/**
 * نگهبان زمان راه‌اندازی.
 *
 * فقط می‌خواند و مقایسه می‌کند: هیچ DDL، هیچ ترمیم خودکار و هیچ نوشتنی در دیتابیس
 * انجام نمی‌دهد. در صورت ناسازگاری `DatabaseNotMigratedError` می‌دهد تا سرویس بالا
 * نیاید (fail closed).
 */
export async function assertDatabaseReady(
  db: Queryable,
  options: { migrationsDir?: string; rootCandidates?: string[] } = {},
): Promise<{ applied: number; expected: number; tables: number }> {
  const dir = options.migrationsDir ?? resolveMigrationsDir(options.rootCandidates);
  const plan = readMigrationPlan(dir);
  const shape = readExpectedShape(plan);

  const applied = await readAppliedMigrations(db);
  const problems: string[] = [];
  if (!applied.tableExists) {
    problems.push("migration ledger 'drizzle.__drizzle_migrations' does not exist");
  } else {
    const appliedAt = new Set(applied.rows.map((row) => row.createdAt));
    for (const entry of plan.entries) {
      if (!appliedAt.has(entry.when)) problems.push(`migration not applied: ${entry.tag}`);
    }
  }

  const actual = await readActualColumns(db);
  for (const table of shape.tables) {
    const columns = actual.get(table.name);
    if (!columns) {
      problems.push(`missing table: ${table.name}`);
      continue;
    }
    const missing = table.columns.filter((column) => !columns.has(column.name)).map((column) => column.name);
    if (missing.length > 0) problems.push(`missing columns on ${table.name}: ${missing.join(", ")}`);
  }

  if (problems.length > 0) {
    /**
     * کد خطا بر اساس **نوع** مشکل انتخاب می‌شود، نه فقط وجود دفتر:
     * اگر مهاجرتی اعمال نشده باشد پیام «مهاجرت لازم است» درست است؛ اگر مهاجرت‌ها
     * کامل‌اند ولی شکل اسکیما نمی‌خواند (ستون گم‌شده، دست‌کاری دستی) پیام
     * «اسکیما ناسازگار است» دقیق‌تر است — ولی هر دو یک خطای بسته‌شدن‌اند.
     */
    const migrationMissing = problems.some((problem) => problem.startsWith("migration not applied"));
    throw new DatabaseNotMigratedError(
      !applied.tableExists || migrationMissing ? "MIGRATIONS_NOT_APPLIED" : "SCHEMA_SHAPE_MISMATCH",
      problems,
    );
  }
  return { applied: applied.rows.length, expected: plan.entries.length, tables: shape.tables.length };
}

/* ─────────────────────────────────────────────────────────────────────────────
   مقایسهٔ عمیق شکل اسکیما (برای آزمون‌ها و «بررسی پس از مهاجرت»)

   چرا مقایسهٔ معنایی و نه نام‌محور؟ چون دیتابیس‌هایی که پیش از گام ۱.۲ با DDL
   زمان‌اجرا ساخته شده‌اند، قیدهای یکتای خود را با نام خودکار Postgres
   (`account_user_email_key`) دارند، در حالی که مسیر مهاجرت نام صریح Drizzle
   (`account_user_email_unique`) می‌سازد. هر دو یک قید یکتا روی همان ستون‌ها
   هستند؛ تفاوت نام، تفاوت اسکیما نیست. (جهت ایندکس btree هم بی‌اثر است:
   PostgreSQL ایندکس btree را در هر دو جهت اسکن می‌کند.)
   ──────────────────────────────────────────────────────────────────────────── */

export type ActualUnique = { table: string; columns: string[]; partial: boolean; definition: string };
export type ActualForeignKey = {
  table: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  deleteRule: string;
};
export type ActualCheck = { table: string; name: string; definition: string };

export type ActualConstraints = {
  uniques: ActualUnique[];
  foreignKeys: ActualForeignKey[];
  checks: ActualCheck[];
};

/** قیدهای واقعی را از کاتالوگ PostgreSQL می‌خواند. */
export async function readActualConstraints(db: Queryable): Promise<ActualConstraints> {
  const uniques = await db.query(`
    SELECT cls.relname AS table_name,
           idx.indpred IS NOT NULL AS partial,
           pg_get_indexdef(idx.indexrelid) AS definition,
           (SELECT array_agg(att.attname::text ORDER BY att.attname)
              FROM pg_attribute att
              WHERE att.attrelid = idx.indrelid AND att.attnum = ANY (idx.indkey)) AS columns
    FROM pg_index idx
    JOIN pg_class cls ON cls.oid = idx.indrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE n.nspname = 'public' AND idx.indisunique AND NOT idx.indisprimary
  `);

  const fks = await db.query(`
    SELECT con.conname AS name,
           cls.relname AS table_name,
           fcls.relname AS referenced_table,
           con.confdeltype AS delete_rule,
           (SELECT array_agg(att.attname::text ORDER BY k.ord)
              FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum) AS columns,
           (SELECT array_agg(att.attname::text ORDER BY k.ord)
              FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum) AS referenced_columns
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_class fcls ON fcls.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE con.contype = 'f' AND n.nspname = 'public'
  `);

  const checks = await db.query(`
    SELECT cls.relname AS table_name, con.conname AS name, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE con.contype = 'c' AND n.nspname = 'public'
  `);

  const deleteRules: Record<string, string> = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };
  return {
    uniques: uniques.rows.map((row) => ({
      table: String(row.table_name),
      columns: (row.columns as string[]).map(String),
      partial: Boolean(row.partial),
      definition: String(row.definition),
    })),
    foreignKeys: fks.rows.map((row) => ({
      table: String(row.table_name),
      columns: (row.columns as string[]).map(String),
      referencedTable: String(row.referenced_table),
      referencedColumns: (row.referenced_columns as string[]).map(String),
      deleteRule: deleteRules[String(row.delete_rule)] ?? String(row.delete_rule),
    })),
    checks: checks.rows.map((row) => ({
      table: String(row.table_name),
      name: String(row.name),
      definition: String(row.definition),
    })),
  };
}

/**
 * مقادیر یک قید `CHECK (column IN (...))` را بیرون می‌کشد.
 *
 * هم روی متن SQL مهاجرت (اسکیمای Drizzle) کار می‌کند و هم روی
 * `pg_get_constraintdef` دیتابیس؛ پس آزمون رانش (drift) می‌تواند همین دو را
 * روبه‌روی هم بگذارد.
 */
export function checkValuesFromDefinition(definition: string): string[] {
  /**
   * دو شکل رایج این قید را می‌خوانیم:
   *   • متنی که ما می‌نویسیم:      `"role" IN ('customer', 'vip')`
   *   • چیزی که PostgreSQL می‌سازد: `"role" = ANY (ARRAY['customer'::text, 'vip'::text])`
   *     (PostgreSQL هر `IN (…)` را به `= ANY (ARRAY[…])` بازنویسی می‌کند، پس بدون
   *      پشتیبانی از شکل دوم، مقایسهٔ کد و دیتابیس همیشه خالی می‌شد.)
   */
  const inList = definition.match(/\bIN\s*\(([^()]*)\)/i);
  const anyArray = definition.match(/=\s*ANY\s*\(\s*ARRAY\s*\[([^\]]*)\]/i);
  // تک‌مقداری: PostgreSQL هر `IN ('x')` یک‌عضوی را به `= 'x'` ساده می‌کند.
  const singleValue = definition.match(/=\s*'([^']*)'(?!\s*\)?\s*\]|::text\s*,)/);
  const raw = inList?.[1] ?? anyArray?.[1] ?? singleValue?.[1];
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim().replace(/::text$/, "").replace(/^'(.*)'$/, "$1"))
    .filter(Boolean)
    .sort();
}

/**
 * مقایسهٔ عمیق و معنایی شکل مورد انتظار (snapshot اسکیمای Drizzle) با شکل واقعی
 * دیتابیس. خروجی: فهرست مشکلات؛ فهرست خالی یعنی سازگار.
 */
export function compareShape(expected: ExpectedShape, actual: ActualConstraints): string[] {
  const problems: string[] = [];
  const uniqueKey = (table: string, columns: string[]) => `${table}(${[...columns].sort().join(",")})`;
  const actualUniques = new Map(actual.uniques.map((item) => [uniqueKey(item.table, item.columns), item]));
  for (const unique of expected.uniques) {
    const found = actualUniques.get(uniqueKey(unique.table, unique.columns));
    if (!found) {
      problems.push(`missing unique constraint: ${unique.table}(${unique.columns.join(", ")}) [${unique.name}]`);
      continue;
    }
    /**
     * اگر قید موردانتظار «جزئی» باشد، دیتابیس هم باید همان شرط را داشته باشد:
     * `ON CONFLICT (fingerprint) WHERE status='open'` بدون ایندکس جزئی کار
     * نمی‌کند. عکسش لازم نیست — قید یکتای کامل روی همان ستون‌ها از نظر یکتایی
     * هم‌ارز است (NULL در PostgreSQL همیشه متمایز است) و روی دیتابیس‌های
     * مرحلهٔ ۱.۵ دقیقاً همین حالت وجود دارد.
     */
    if (unique.partial && !found.partial) {
      problems.push(
        `unique constraint ${unique.name} must be partial (WHERE ${unique.name === "system_log_open_fingerprint" ? "status = 'open'" : "…"})`,
      );
    }
  }

  const fkKey = (item: { table: string; columns: string[]; referencedTable: string; referencedColumns: string[] }) =>
    `${item.table}(${item.columns.join(",")})→${item.referencedTable}(${item.referencedColumns.join(",")})`;
  const actualFks = new Set(actual.foreignKeys.map(fkKey));
  for (const fk of expected.foreignKeys) {
    if (!actualFks.has(fkKey(fk))) {
      problems.push(
        `missing foreign key: ${fk.table}(${fk.columns.join(", ")}) → ${fk.referencedTable}(${fk.referencedColumns.join(", ")}) [${fk.name}]`,
      );
      continue;
    }
    const found = actual.foreignKeys.find((item) => fkKey(item) === fkKey(fk));
    if (found && found.deleteRule !== fk.onDelete) {
      problems.push(`foreign key ${fk.name} must be ON DELETE ${fk.onDelete} (found: ${found.deleteRule})`);
    }
  }

  for (const check of expected.checks) {
    const expectedValues = checkValuesFromDefinition(check.value);
    const matched = actual.checks.some(
      (candidate) =>
        candidate.table === check.table &&
        (candidate.name === check.name ||
          (expectedValues.length > 0 &&
            checkValuesFromDefinition(candidate.definition).join("|") === expectedValues.join("|"))),
    );
    if (!matched) problems.push(`missing check constraint: ${check.table}.${check.name} [${check.value}]`);
  }
  return problems;
}
