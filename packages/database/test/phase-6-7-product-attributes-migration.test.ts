/**
 * آزمون مهاجرت ۰۰۴۷ — مقصدِ کانونیکِ ویژگی‌های سطحِ محصول.
 *
 * چه چیزی اثبات می‌شود؟
 *   ۱) مهاجرتِ تازه (fresh): روی دیتابیس خالی، `product.attributes` با نوعِ jsonb،
 *      NOT NULL و پیش‌فرضِ `'{}'::jsonb` ساخته می‌شود و **هیچ جدولِ جدیدی** اضافه
 *      نمی‌شود.
 *   ۲) مهاجرتِ ارتقا (upgrade): دیتابیسی که تا ۰۰۴۶ مهاجرت شده و **دادهٔ واقعی**
 *      دارد، با اعمالِ ۰۰۴۷ داده‌هایش را کامل نگه می‌دارد و ستونِ جدید برای
 *      ردیف‌های قدیمی `{}` می‌شود. این همان «forward-only، بدونِ پاک‌کردن» است.
 *   ۳) نگهبانِ راه‌اندازی (startup guard) پس از هر دو مسیر سبز است — یعنی snapshot
 *      دست‌نویس با مدلِ Drizzle یکی است.
 *   ۴) مهاجرت idempotent است: اجرای دوباره هیچ تغییری نمی‌دهد.
 *
 * هیچ‌کدام از این آزمون‌ها به دیتابیس توسعه (`kolbe`) دست نمی‌زنند.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_URL,
  MIGRATIONS_DIR,
  dropDatabase,
  ensurePostgres,
  guardOutcome,
  migrateOrFail,
  recreateDatabase,
  urlFor,
  withClient,
} from "./helpers";

const FRESH_DB = "kolbe_phase_6_7_attributes_fresh_test";
const UPGRADE_DB = "kolbe_phase_6_7_attributes_upgrade_test";
const MIGRATE_SCRIPT = path.resolve(import.meta.dirname, "..", "migrate.mjs");
const LAST_TAG = "0047_supplier_product_attributes";

/**
 * ساختِ یک بستهٔ مهاجرتِ موقت و **خودبسنده** که فقط تا ۰۰۴۶ را دارد.
 *
 * چرا خودبسنده؟ چون `migrate.mjs` پوشهٔ مهاجرت را از `import.meta.dirname`
 * می‌سازد (`path.resolve(import.meta.dirname, "migrations")`) و متغیرِ محیطی
 * `KOLBE_MIGRATIONS_DIR` را **نمی‌خواند** — برخلافِ آنچه `helpers.ts` فرض
 * می‌کند. پس تنها راهِ صادقانه این است که خودِ `migrate.mjs` را کنارِ یک پوشهٔ
 * `migrations` کوتاه‌شده کپی کنیم و همان را اجرا کنیم.
 *
 * `dist/src/verify.js` هم کپی می‌شود چون `migrate.mjs` آن را نسبت به مسیرِ خودش
 * بارگذاری می‌کند؛ آن فایل فقط `node:fs` و `node:path` را require می‌کند، پس
 * جابه‌جایی‌پذیر است.
 */
function buildPre0047Package(): { root: string; script: string } {
  const verifyCompiled = path.resolve(import.meta.dirname, "..", "dist", "src", "verify.js");
  if (!fs.existsSync(verifyCompiled)) {
    throw new Error("dist/src/verify.js ساخته نشده است — ابتدا `npm run build:packages` را اجرا کنید.");
  }
  /**
   * بستهٔ موقت **داخلِ node_modules** ساخته می‌شود، نه در `/tmp`.
   *
   * چرا؟ `migrate.mjs` پیمانه‌های `drizzle-orm` و `pg` را import می‌کند و Node آن‌ها
   * را با پیمایشِ پوشه‌های والد پیدا می‌کند. در `/tmp` هیچ `node_modules` ای در
   * مسیر نیست و اجرا با ERR_MODULE_NOT_FOUND می‌شکند. زیرِ `node_modules` ریشه،
   * هم تفکیکِ پیمانه کار می‌کند و هم این پوشه ذاتاً خارج از git است.
   */
  const repoNodeModules = path.resolve(import.meta.dirname, "..", "..", "..", "node_modules");
  const root = fs.mkdtempSync(path.join(repoNodeModules, ".kolbe-pre-0047-"));
  fs.copyFileSync(MIGRATE_SCRIPT, path.join(root, "migrate.mjs"));
  fs.mkdirSync(path.join(root, "dist", "src"), { recursive: true });
  fs.copyFileSync(verifyCompiled, path.join(root, "dist", "src", "verify.js"));
  fs.mkdirSync(path.join(root, "migrations", "meta"), { recursive: true });

  for (const file of fs.readdirSync(MIGRATIONS_DIR)) {
    if (!file.endsWith(".sql") || file.startsWith("0047_")) continue;
    fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(root, "migrations", file));
  }
  for (const file of fs.readdirSync(path.join(MIGRATIONS_DIR, "meta"))) {
    if (file === "0047_snapshot.json" || file === "_journal.json") continue;
    fs.copyFileSync(path.join(MIGRATIONS_DIR, "meta", file), path.join(root, "migrations", "meta", file));
  }
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));
  const truncated = { ...journal, entries: journal.entries.filter((entry: { idx: number }) => entry.idx <= 46) };
  expect(truncated.entries).toHaveLength(47);
  fs.writeFileSync(path.join(root, "migrations", "meta", "_journal.json"), JSON.stringify(truncated, null, 2));
  return { root, script: path.join(root, "migrate.mjs") };
}

function runMigrateScript(database: string, script: string) {
  const result = spawnSync(process.execPath, [script], {
    cwd: path.resolve(import.meta.dirname, "..", "..", ".."),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: urlFor(database) },
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** ستونِ `product.attributes` از دیدِ information_schema. */
async function readAttributesColumn(client: Client) {
  const { rows } = await client.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
    `SELECT data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'product' AND column_name = 'attributes'`,
  );
  return rows[0];
}

const SEED_PRODUCTS: Array<[string, string, string, string]> = [
  ["p67_old_1", "پیراهن لینن قدیمی", "old-linen-shirt", "approved"],
  ["p67_old_2", "کت تک پشمی", "old-wool-blazer", "draft"],
  ["p67_old_3", "شلوار کتان", "old-cotton-trousers", "published"],
];

async function seedLegacyProducts(database: string): Promise<void> {
  await withClient(database, async (client) => {
    // `product.created_by` کلیدِ خارجی به `account_user` دارد، پس نخست کاربرِ
    // سازنده باید وجود داشته باشد.
    await client.query(
      `INSERT INTO account_user (id, email, password_hash, salt, role) VALUES ('p67_seeder', 'p67-seeder@kolbe.test', 'h', 's', 'admin')`,
    );
    for (const [id, name, slug, status] of SEED_PRODUCTS) {
      await client.query(
        `INSERT INTO product (id, name, slug, description, owner_type, status, created_by)
         VALUES ($1, $2, $3, 'توضیحِ آزمایشی', 'KOLBE', $4, 'p67_seeder')`,
        [id, name, slug, status],
      );
    }
  });
}

describe("Phase 6.7 migration 0047: product.attributes (canonical home for product-level attributes)", () => {
  let pre0047: { root: string; script: string };

  beforeAll(async () => {
    ensurePostgres();
    pre0047 = buildPre0047Package();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      for (const db of [FRESH_DB, UPGRADE_DB]) {
        await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
        await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0 LC_COLLATE 'C.utf8' LC_CTYPE 'C.utf8'`);
      }
    } finally {
      await admin.end();
    }
    migrateOrFail(FRESH_DB);
  }, 240_000);

  afterAll(async () => {
    await dropDatabase(FRESH_DB);
    await dropDatabase(UPGRADE_DB);
    if (pre0047) fs.rmSync(pre0047.root, { recursive: true, force: true });
  });

  it("registers 0047 in the journal as the last forward-only entry", () => {
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));
    expect(journal.entries).toHaveLength(48);
    const last = journal.entries[journal.entries.length - 1];
    expect(last).toMatchObject({ idx: 47, tag: LAST_TAG });
    // journal باید صعودی و بدونِ سوراخ باشد.
    const indexes = journal.entries.map((entry: { idx: number }) => entry.idx);
    expect(indexes).toEqual([...indexes].sort((a: number, b: number) => a - b));
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it("migration file is additive only (no DROP, no DELETE, no TRUNCATE, no UPDATE)", () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, "0047_supplier_product_attributes.sql"), "utf8");
    const body = sql.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body).toMatch(/ALTER TABLE "product" ADD COLUMN "attributes"/);
    for (const forbidden of [/\bDROP\b/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /\bUPDATE\b/i]) {
      expect(body).not.toMatch(forbidden);
    }
  });

  it("fresh migrate: adds product.attributes as jsonb NOT NULL default '{}'::jsonb", async () => {
    await withClient(FRESH_DB, async (client) => {
      const column = await readAttributesColumn(client);
      expect(column).toBeDefined();
      expect(column.data_type).toBe("jsonb");
      expect(column.is_nullable).toBe("NO");
      expect(column.column_default).toBe("'{}'::jsonb");
    });
  });

  it("fresh migrate: adds no tables (still 199)", async () => {
    await withClient(FRESH_DB, async (client) => {
      const tables = await client.query(
        `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      expect(tables.rows[0].c).toBe(199);
    });
  });

  it("fresh migrate: a product inserted without attributes defaults to {} and preserves a rich payload exactly", async () => {
    await withClient(FRESH_DB, async (client) => {
      await client.query(
        `INSERT INTO product (id, name, slug) VALUES ('p67_fresh_default', 'بدونِ ویژگی', 'p67-fresh-default')`,
      );
      const defaulted = await client.query(`SELECT attributes FROM product WHERE id = 'p67_fresh_default'`);
      expect(defaulted.rows[0].attributes).toEqual({});

      const rich = { color: "مشکی", material: "لینن", fit: "regular", eu_size: "42", nested: { list: [1, 2, 3] } };
      await client.query(`INSERT INTO product (id, name, slug, attributes) VALUES ('p67_fresh_rich', 'با ویژگی', 'p67-fresh-rich', $1)`, [
        JSON.stringify(rich),
      ]);
      const stored = await client.query(`SELECT attributes FROM product WHERE id = 'p67_fresh_rich'`);
      // مقایسهٔ ساختاریِ دقیق — بدونِ هیچ تبدیلِ عددی یا از دست رفتنِ کلید.
      expect(stored.rows[0].attributes).toEqual(rich);
    });
  });

  it("fresh migrate: startup guard passes (hand-written snapshot matches the Drizzle model)", async () => {
    const outcome = await guardOutcome(FRESH_DB);
    expect(outcome.ok).toBe(true);
  });

  it("upgrade: a pre-0047 database has no product.attributes column", async () => {
    const first = runMigrateScript(UPGRADE_DB, pre0047.script);
    expect(first.code, `${first.stdout}\n${first.stderr}`).toBe(0);
    await withClient(UPGRADE_DB, async (client) => {
      expect(await readAttributesColumn(client)).toBeUndefined();
    });
    await seedLegacyProducts(UPGRADE_DB);
  }, 240_000);

  it("upgrade: applying 0047 preserves every existing row and backfills {} — nothing wiped", async () => {
    const upgrade = runMigrateScript(UPGRADE_DB, MIGRATE_SCRIPT);
    expect(upgrade.code, `${upgrade.stdout}\n${upgrade.stderr}`).toBe(0);

    await withClient(UPGRADE_DB, async (client) => {
      const column = await readAttributesColumn(client);
      expect(column?.data_type).toBe("jsonb");

      const { rows } = await client.query<{ id: string; name: string; slug: string; status: string; description: string; owner_type: string; attributes: unknown }>(
        `SELECT id, name, slug, status, description, owner_type, attributes FROM product ORDER BY id`,
      );
      // همهٔ سه ردیفِ قدیمی سرِ جایشان‌اند.
      expect(rows).toHaveLength(SEED_PRODUCTS.length);
      for (const [index, [id, name, slug, status]] of SEED_PRODUCTS.entries()) {
        const row = rows[index]!;
        expect(row.id).toBe(id);
        expect(row.name).toBe(name);
        expect(row.slug).toBe(slug);
        expect(row.status).toBe(status);
        expect(row.description).toBe("توضیحِ آزمایشی");
        expect(row.owner_type).toBe("KOLBE");
        expect(row.attributes).toEqual({});
      }

      /**
       * دفترِ مهاجرتِ drizzle ستونِ `tag` ندارد؛ کلیدِ تطبیق `created_at` است که
       * دقیقاً برابرِ `when` همان ورودیِ journal نوشته می‌شود (همان روشی که
       * `assertDatabaseReady` در `verify.ts` به کار می‌برد). پس «۰۰۴۷ اعمال شده»
       * را از راهِ همان `when` اثبات می‌کنیم.
       */
      const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));
      const entry0047 = journal.entries.find((item: { tag: string }) => item.tag === LAST_TAG);
      expect(entry0047).toBeDefined();
      const applied = await client.query<{ created_at: string }>(
        `SELECT created_at FROM drizzle.__drizzle_migrations WHERE created_at = $1`,
        [String(entry0047.when)],
      );
      expect(applied.rows).toHaveLength(1);
    });
  }, 240_000);

  it("upgrade: startup guard passes and re-running migrate is a no-op", async () => {
    const outcome = await guardOutcome(UPGRADE_DB);
    expect(outcome.ok).toBe(true);

    const again = runMigrateScript(UPGRADE_DB, MIGRATE_SCRIPT);
    expect(again.code, `${again.stdout}\n${again.stderr}`).toBe(0);
    await withClient(UPGRADE_DB, async (client) => {
      const count = await client.query(`SELECT count(*)::int AS c FROM product`);
      expect(count.rows[0].c).toBe(SEED_PRODUCTS.length);
      const ledger = await client.query(`SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations`);
      expect(ledger.rows[0].c).toBe(48);
    });
  }, 240_000);
});
