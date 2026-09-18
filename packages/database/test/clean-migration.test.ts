import fs from "node:fs";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as model from "../src/schema/tables";
import {
  assertDatabaseReady,
  checkValuesFromDefinition,
  compareShape,
  readActualConstraints,
  readMigrationPlan,
  readExpectedShape,
} from "../src/verify";
import {
  MIGRATIONS_DIR,
  REPO_ROOT,
  dropDatabase,
  ensurePostgres,
  expectSqlViolation,
  migrateOrFail,
  recreateDatabase,
  runMigrate,
  stripComments,
  walkFiles,
  withClient,
} from "./helpers";

/**
 * آزمون «مهاجرت روی دیتابیس خالی» — سنگ‌بنای گام ۱.۲.
 *
 * چه چیزی را اثبات می‌کند؟
 *   ۱) `npm run db:migrate` روی یک دیتابیس کاملاً خالی، کل اسکیما را می‌سازد
 *      (یعنی از این پس مهاجرت‌ها تنها منبع ساخت اسکیما هستند).
 *   ۲) شکل ساخته‌شده با **مدل Drizzle** و با **snapshot مهاجرت** یکی است
 *      (ستون‌ها، ایندکس‌ها، قیدهای یکتا، کلیدهای خارجی، CHECKها).
 *   ۳) قیدها فقط تزئینی نیستند: نقض FK/CHECK/UNIQUE/ناوردایی موجودی واقعاً رد
 *      می‌شود، و تریگر فقط-افزودنی `audit_log` کار می‌کند.
 *   ۴) مهاجرت هیچ دادهٔ نمایشی نمی‌کارد (قاعدهٔ D18؛ مهاجرت و بذرپاشی جدا هستند).
 *   ۵) هیچ کد زمان اجرایی DDL نمی‌سازد (اسکن ایستا).
 */

const FRESH_DB = "kolbe_phase12_clean_test";

type Row = Record<string, unknown>;

describe("مهاجرت روی دیتابیس خالی (گام ۱.۲)", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(FRESH_DB);
    migrateOrFail(FRESH_DB);
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(FRESH_DB);
  });

  it("اسکیما کامل ساخته می‌شود و نگهبان سازگاری را تأیید می‌کند", async () => {
    const outcome = await withClient(FRESH_DB, (client) => assertDatabaseReady(client));
    expect(outcome.tables).toBeGreaterThanOrEqual(22);
    expect(outcome.applied).toBe(outcome.expected);

    await withClient(FRESH_DB, async (client) => {
      const { rows } = await client.query<Row>(
        "SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema='public'",
      );
      expect(rows[0].tables).toBeGreaterThanOrEqual(22);
    });
  });

  it("شکل دیتابیس با snapshot مهاجرت یکی است (قیدهای یکتا/FK/CHECK)", async () => {
    const plan = readMigrationPlan(MIGRATIONS_DIR);
    const expected = readExpectedShape(plan);
    const actual = await withClient(FRESH_DB, (client) => readActualConstraints(client));
    expect(compareShape(expected, actual)).toEqual([]);
    expect(expected.foreignKeys.length).toBeGreaterThanOrEqual(23);
    expect(actual.foreignKeys.length).toBeGreaterThanOrEqual(23);
  });

  it("هر جدول/ستون مدل Drizzle در دیتابیس مهاجرت‌شده وجود دارد", async () => {
    const tables = Object.values(model) as Array<Parameters<typeof getTableConfig>[0]>;
    expect(tables.length).toBeGreaterThanOrEqual(22);

    await withClient(FRESH_DB, async (client) => {
      for (const table of tables) {
        const config = getTableConfig(table);
        const { rows } = await client.query<Row>(
          "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
          [config.name],
        );
        const actual = new Map(rows.map((row) => [String(row.column_name), String(row.is_nullable) === "YES"]));
        expect(actual.size, `جدول ${config.name} در دیتابیس نیست`).toBeGreaterThan(0);
        for (const column of config.columns) {
          expect(actual.has(column.name), `${config.name}.${column.name} موجود نیست`).toBe(true);
          expect(actual.get(column.name), `${config.name}.${column.name} nullability`).toBe(!column.notNull);
        }
      }
    });
  });

  it("قیدهای یکتای مدل Drizzle (ستونی و ایندکسی) در دیتابیس وجود دارند", async () => {
    const tables = Object.values(model) as Array<Parameters<typeof getTableConfig>[0]>;
    const actual = await withClient(FRESH_DB, (client) => readActualConstraints(client));
    const uniqueKey = (table: string, columns: string[]) => `${table}(${[...columns].sort().join(",")})`;
    const actualUniques = new Set(actual.uniques.map((item) => uniqueKey(item.table, item.columns)));

    for (const table of tables) {
      const config = getTableConfig(table);
      for (const column of config.columns.filter((item) => item.isUnique)) {
        expect(actualUniques.has(uniqueKey(config.name, [column.name])), `${config.name}.${column.name}`).toBe(true);
      }
      for (const index of config.indexes.filter((item) => item.config.unique)) {
        const columns = index.config.columns.map((column) => (column as { name: string }).name);
        expect(actualUniques.has(uniqueKey(config.name, columns)), `${config.name}(${columns.join(",")})`).toBe(true);
      }
    }
  });

  it("کلیدهای خارجی همه ON DELETE RESTRICT هستند (و روی تاریخچه قید اضافه نشده)", async () => {
    const actual = await withClient(FRESH_DB, (client) => readActualConstraints(client));
    expect(actual.foreignKeys.length).toBeGreaterThan(0);
    for (const fk of actual.foreignKeys) {
      expect(fk.deleteRule, `${fk.table} → ${fk.referencedTable}`).toBe("restrict");
    }
    // تاریخچهٔ حسابرسی/رصد عمداً هیچ FK ندارد تا حذف حساب آن را از بین نبرد
    // یا قفل نکند (قاعدهٔ A13/A16).
    const historyTables = actual.foreignKeys.filter((fk) => fk.table === "audit_log" || fk.table === "system_log");
    expect(historyTables).toEqual([]);
  });

  it("نقض قید یکتا، FK و CHECK واقعاً رد می‌شود", async () => {
    await withClient(FRESH_DB, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          "INSERT INTO account_user (id,email,password_hash,salt,role) VALUES ('usr_a','a@test.ir','h','s','customer')",
        );

        // یکتایی ایمیل
        await expectSqlViolation(
          client,
          "INSERT INTO account_user (id,email,password_hash,salt) VALUES ('usr_b','a@test.ir','h','s')",
          "23505",
        );

        // نقش خارج از مجموعهٔ مجاز
        await expectSqlViolation(
          client,
          "INSERT INTO account_user (id,email,password_hash,salt,role) VALUES ('usr_c','c@test.ir','h','s','operator')",
          "23514",
        );

        // کلید خارجی: عضویت تأمین‌کننده با تأمین‌کنندهٔ ناموجود
        await expectSqlViolation(
          client,
          "INSERT INTO supplier_member (id,supplier_id,user_id) VALUES ('smem_x','sup_missing','usr_a')",
          "23503",
        );

        await client.query("INSERT INTO supplier (id,legal_name,display_name,status) VALUES ('sup_x','x','x','approved')");

        // مبلغ منفی — canonical seller_offer + FK missing
        await client.query(`INSERT INTO product (id,name,slug,status,owner_type) VALUES ('prod_x','Test Product','test-product-x','draft','SUPPLIER')`);
        await client.query(`INSERT INTO seller (id,type,supplier_id,display_name,status) VALUES ('seller_x','SUPPLIER','sup_x','Test Seller','active')`);
        // FK violation: seller_missing
        await expectSqlViolation(
          client,
          `INSERT INTO seller_offer (id,product_id,seller_id,sku,wholesale_price) VALUES ('offer_x','prod_x','seller_missing','SKU-X',1000)`,
          "23503",
        );
        // CHECK violation: negative price
        await expectSqlViolation(
          client,
          `INSERT INTO seller_offer (id,product_id,seller_id,sku,wholesale_price) VALUES ('offer_neg','prod_x','seller_x','SKU-NEG',-1)`,
          "23514",
        );
        await client.query(`INSERT INTO product_variant (id,product_id,sku,status) VALUES ('var_y','prod_x','SKU-Y-M','active')`);
        // موجودی: رزرو بیشتر از موجودی — canonical inventory
        await expectSqlViolation(
          client,
          `INSERT INTO product_variant_inventory (id,variant_id,seller_id,on_hand,reserved) VALUES ('inv_y','var_y','seller_x',5,6)`,
          "23514",
        );
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  it("خروج از حالت‌های مجاز در سفارش‌ها رد می‌شود (CHECK روی وضعیت‌ها)", async () => {
    await withClient(FRESH_DB, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          `INSERT INTO account_user (id,email,password_hash,salt,role) VALUES ('usr_v','v@test.ir','h','s','vip')`,
        );
        await client.query(
          `INSERT INTO wholesale_account (id,user_id,member_name,store_name,phone,city,status)
           VALUES ('wacc_v','usr_v','m','s','0912','tehran','pending')`,
        );
        await expectSqlViolation(
          client,
          `INSERT INTO wholesale_order (id,order_code,account_id,buyer_user_id,status) VALUES ('word_x','KV-1','wacc_v','usr_v','paid')`,
          "23514",
        );
        await expectSqlViolation(
          client,
          `INSERT INTO retail_order (id,order_code,customer_name,phone,payment_status)
           VALUES ('rord_x','RV-1','c','0912','pending_gateway')`,
          "23514",
        );

        // مقدار پیش‌فرض پرداخت خرده‌فروشی دیگر «منتظر درگاه» نیست (بدهی N4).
        const { rows } = await client.query<Row>(
          `INSERT INTO retail_order (id,order_code,customer_name,phone) VALUES ('rord_y','RV-2','c','0912')
           RETURNING payment_status`,
        );
        expect(rows[0].payment_status).toBe("unpaid");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  it("بازهٔ مبلغ (MAX_MONEY) در سطح دیتابیس اعمال می‌شود", async () => {
    await withClient(FRESH_DB, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(`INSERT INTO product (id,name,slug,status,owner_type) VALUES ('prod_m','m','m','draft','SUPPLIER')`);
        await client.query(`INSERT INTO supplier (id,legal_name,display_name,status) VALUES ('sup_m','m','m','approved')`);
        await client.query(`INSERT INTO seller (id,type,supplier_id,display_name,status) VALUES ('seller_m','SUPPLIER','sup_m','m','active')`);
        await expect(
          client.query(
            `INSERT INTO seller_offer (id,product_id,seller_id,sku,wholesale_price) VALUES ('offer_m','prod_m','seller_m','SKU-M',1000000000000001)`,
          ),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  it("تریگر فقط-افزودنی audit_log فعال است", async () => {
    await withClient(FRESH_DB, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(`INSERT INTO audit_log (id,action,entity_type) VALUES ('aud_1','test.created','test')`);
        for (const statement of [
          "UPDATE audit_log SET action='x' WHERE id='aud_1'",
          "DELETE FROM audit_log WHERE id='aud_1'",
        ]) {
          await client.query("SAVEPOINT audit_check");
          let message = "";
          try {
            await client.query(statement);
          } catch (error) {
            message = String((error as Error).message);
          } finally {
            await client.query("ROLLBACK TO SAVEPOINT audit_check");
          }
          expect(message, statement).toMatch(/append-only/);
        }
        // ردیف اصلی دست‌نخورده مانده است (هیچ UPDATE/DELETE‌ای عبور نکرد).
        const { rows } = await client.query<Row>("SELECT action FROM audit_log WHERE id='aud_1'");
        expect(rows[0].action).toBe("test.created");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  it("ایندکس یکتای جزئی system_log همان چیزی است که upsert خطا لازم دارد", async () => {
    const { rows } = await withClient(FRESH_DB, (client) =>
      client.query<Row>(
        `SELECT pg_get_indexdef(indexrelid) AS definition FROM pg_index
         WHERE indexrelid = to_regclass('public.system_log_open_fingerprint')`,
      ),
    );
    expect(String(rows[0].definition)).toContain("WHERE");
    expect(String(rows[0].definition)).toContain("open");

    // خودِ upsert مسیر ثبت خطا: دو بار درج یک اثر انگشت باز = یک ردیف با شمارش ۲.
    await withClient(FRESH_DB, async (client) => {
      await client.query("BEGIN");
      try {
        const first = await client.query<Row>(
          `INSERT INTO system_log (id,message,fingerprint,first_seen_at,last_seen_at)
           VALUES ('log_1','boom','fp-1',now(),now())
           ON CONFLICT (fingerprint) WHERE status='open'
           DO UPDATE SET last_seen_at=now(),occurrence_count=system_log.occurrence_count+1
           RETURNING id, occurrence_count`,
        );
        const second = await client.query<Row>(
          `INSERT INTO system_log (id,message,fingerprint,first_seen_at,last_seen_at)
           VALUES ('log_2','boom','fp-1',now(),now())
           ON CONFLICT (fingerprint) WHERE status='open'
           DO UPDATE SET last_seen_at=now(),occurrence_count=system_log.occurrence_count+1
           RETURNING id, occurrence_count`,
        );
        expect(first.rows[0].id).toBe("log_1");
        expect(second.rows[0].id).toBe("log_1");
        expect(Number(second.rows[0].occurrence_count)).toBe(2);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  it("مهاجرت هیچ دادهٔ نمایشی/عملیاتی نمی‌کارد", async () => {
    await withClient(FRESH_DB, async (client) => {
      for (const table of ["account_user", "supplier", "product", "wholesale_account", "retail_order", "audit_log", "site_setting"]) {
        const { rows } = await client.query<Row>(`SELECT count(*)::int AS count FROM ${table}`);
        expect(rows[0].count, table).toBe(0);
      }
    });
  });

  it("مهاجرت روی دیتابیس مهاجرت‌شده دوباره اجرا می‌شود و بی‌اثر است (idempotent)", () => {
    const again = runMigrate(FRESH_DB);
    expect(again.code).toBe(0);
    expect(`${again.stdout}${again.stderr}`).toContain("بررسی سازگاری موفق");
  });

  it("هیچ کد زمان اجرایی DDL نمی‌سازد (اسکن ایستا)", () => {
    const ddlPattern = /\b(CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+TRIGGER|CREATE\s+OR\s+REPLACE\s+FUNCTION|DROP\s+TABLE)\b/i;
    const roots = [
      path.join(REPO_ROOT, "frontend-next", "server"),
      path.join(REPO_ROOT, "frontend-next", "app"),
      path.join(REPO_ROOT, "frontend-next", "storefront"),
      path.join(REPO_ROOT, "frontend-next", "supplier-src"),
      path.join(REPO_ROOT, "apps", "api", "src"),
      path.join(REPO_ROOT, "packages", "shared", "src"),
      path.join(REPO_ROOT, "packages", "database", "src", "verify.ts"),
      path.join(REPO_ROOT, "packages", "database", "src", "index.ts"),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      const files = fs.statSync(root).isDirectory()
        ? walkFiles(root, [".ts", ".tsx", ".mjs", ".js"], (file) => file.includes(`${path.sep}node_modules`))
        : [root];
      for (const file of files) {
        const source = stripComments(fs.readFileSync(file, "utf8"));
        const match = source.match(ddlPattern);
        if (match) offenders.push(`${path.relative(REPO_ROOT, file)} → ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("فایل DDL زمان‌اجرا در route handler قدیمی وجود ندارد", () => {
    const legacyDb = fs.readFileSync(path.join(REPO_ROOT, "frontend-next", "server", "database.ts"), "utf8");
    expect(stripComments(legacyDb)).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX|CREATE\s+TRIGGER/i);
    expect(legacyDb).not.toMatch(/export const schema\b/);
  });

  it("قیدهای CHECK شمارشی، همان مجموعهٔ مقادیر کد هستند (نمونهٔ نظامی)", async () => {
    const actual = await withClient(FRESH_DB, (client) => readActualConstraints(client));
    const checkFor = (table: string, name: string) =>
      actual.checks.find((check) => check.table === table && check.name === name);
    expect(checkValuesFromDefinition(String(checkFor("wholesale_order", "wholesale_order_status_allowed")?.definition))).toEqual(
      ["awaiting_payment", "cancelled", "completed", "confirmed", "draft", "fulfillment", "processing", "shipped"].sort(),
    );
    expect(checkValuesFromDefinition(String(checkFor("retail_order", "retail_order_payment_status_allowed")?.definition))).toEqual(
      ["pending_cod", "unpaid"],
    );
  });
});
