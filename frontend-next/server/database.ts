import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
/**
 * نگهبان سازگاری اسکیما — از گام ۱.۲ جای DDL زمان‌اجرا را گرفته است.
 *
 * ⚠️ چرا import نسبی و نه `@kolbe/database`؟ چون این اپ لایهٔ گذار (strangler)
 * است و عمداً گراف وابستگی‌اش تغییر نکرده تا حذفش در فاز ۲ گران نباشد. ماژول
 * `verify` هیچ وابستگی‌ای (نه drizzle، نه pg) جز `node:fs` ندارد و تنها مصنوعات
 * **تولیدشده از اسکیمای Drizzle** را می‌خواند؛ پس «مرجع واحد اسکیما» همچنان
 * `packages/database` است. (بدهی ثبت‌شده در گزارش فاز ۱.۲.)
 */
import { assertDatabaseReady, DatabaseNotMigratedError } from "../../packages/database/src/verify";

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:55432/kolbe";

const globalDatabase = globalThis as typeof globalThis & {
  __kolbePool?: Pool;
  __kolbeDatabaseReady?: Promise<void>;
};

/**
 * رشتهٔ اتصال در زمان استفاده خوانده می‌شود (نه در زمان import).
 *
 * دلیل: تست‌های یکپارچه باید بتوانند پیش از بارگذاری ماژول، `DATABASE_URL` را به
 * دیتابیس تست تغییر دهند تا هرگز روی دیتابیس توسعه/تولید اجرا نشوند.
 */
/**
 * خطای «دیتابیس مهاجرت‌نشده» برای لایهٔ HTTP.
 *
 * بازصادر شده تا `kolbe-api.ts` فقط از یک ماژول import کند؛ خودِ تعریف در
 * `packages/database/src/verify.ts` است (تنها مرجع).
 */
export { DatabaseNotMigratedError };

export function connectionString() {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

let productionPool: Pool | undefined;

function pool(): Pool {
  if (process.env.NODE_ENV === "production") {
    productionPool ??= new Pool({ connectionString: connectionString() });
    return productionPool;
  }
  // در توسعه، Pool روی globalThis نگه داشته می‌شود تا HMR اتصال‌ها را تکثیر نکند.
  globalDatabase.__kolbePool ??= new Pool({ connectionString: connectionString() });
  return globalDatabase.__kolbePool;
}

export function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function passwordRecord(password: string) {
  const salt = randomBytes(16).toString("hex");
  return { salt, passwordHash: scryptSync(password, salt, 64).toString("hex") };
}

/**
 * تصمیم «آیا دادهٔ نمایشی/دمو کاشته شود؟» — قاعدهٔ D18 ممیزی PROMPT 1.
 *
 * ── چرا این تابع وجود دارد ───────────────────────────────────────────────────
 * `seed()` سه حساب واقعی می‌ساخت (از جمله `admin@kolbe.ir`) و `initialize()`
 * آن را در **هر محیطی** و بدون هیچ شرطی صدا می‌زد. یعنی هر استقرار تازه یک
 * حساب مدیر با رمز عبورِ موجود در مخزن داشت — چه در محیط توسعه و چه در تولید.
 *
 * ── قاعده ───────────────────────────────────────────────────────────────────
 * کاشت فقط وقتی انجام می‌شود که **هر دو** شرط برقرار باشد:
 *   ۱) `NODE_ENV !== "production"`  ← تولید هرگز، حتی با فلگ روشن
 *   ۲) `KOLBE_SEED_DEMO_DATA === "true"` ← درخواست صریح اپراتور
 *
 * حالت پیش‌فرض «کاشتن انجام نمی‌شود» است: فراموش‌کردنِ ست‌کردن متغیر یعنی
 * دیتابیس خالی می‌ماند (قابل بازیابی)، نه اینکه یک حساب مدیر با رمز عمومی
 * ساخته شود (غیرقابل جبران).
 *
 * خروجی `reason` برای لاگ و برای تست است تا معلوم باشد چرا کاشته شد/نشد.
 */
export type DemoSeedReason = "environment-is-production" | "not-requested" | "enabled";
export type DemoSeedDecision = { enabled: boolean; reason: DemoSeedReason };

export function demoSeedDecision(env: NodeJS.ProcessEnv = process.env): DemoSeedDecision {
  if (env.NODE_ENV === "production") return { enabled: false, reason: "environment-is-production" };
  if (env.KOLBE_SEED_DEMO_DATA !== "true") return { enabled: false, reason: "not-requested" };
  return { enabled: true, reason: "enabled" };
}

/**
 * کاشت دادهٔ نمایشی. **فقط** از `prepareDatabase` و پس از تأیید `demoSeedDecision`
 * صدا زده می‌شود. هرگز آن را مستقیم از کد مسیر درخواست فراخوانی نکنید.
 */
export async function seedDemoData(client: PoolClient) {
  const accounts = [
    ["admin@kolbe.ir", "KolbeAdmin1404!", "admin", "مدیر کلبه", null],
    ["vip@boutique.ir", "VipPass1404!", "vip", "سارا موسوی", "09121111111"],
    ["nilgoon@kolbe.ir", "SupplierPass1404!", "supplier", "نرگس آذر", "09120000000"],
  ] as const;

  for (const [email, password, role, name, phone] of accounts) {
    const { salt, passwordHash } = passwordRecord(password);
    await client.query(
      `INSERT INTO account_user (id,email,password_hash,salt,role,display_name,phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (email) DO NOTHING`,
      [makeId("usr"), email, passwordHash, salt, role, name, phone],
    );
  }

  const supplierId = "sup_nilgoon";
  await client.query(
    `INSERT INTO supplier (id,legal_name,display_name,city,phone,category,monthly_capacity,capabilities,status)
     VALUES ($1,$2,$2,$3,$4,$5,$6,$7,'approved') ON CONFLICT (id) DO NOTHING`,
    [supplierId, "نساجی و پوشاک نیلگون", "تهران", "09120000000", "پوشاک زنانه", 5000, JSON.stringify(["تولید پوشاک", "ارسال عمده"])],
  );
  const supplierUser = await client.query<{ id: string }>("SELECT id FROM account_user WHERE email=$1", ["nilgoon@kolbe.ir"]);
  if (supplierUser.rows[0]) {
    await client.query(
      `INSERT INTO supplier_member (id,supplier_id,user_id,title) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id) DO NOTHING`,
      [makeId("smem"), supplierId, supplierUser.rows[0].id, "مدیر تأمین"],
    );
  }

  const vipUser = await client.query<{ id: string }>("SELECT id FROM account_user WHERE email=$1", ["vip@boutique.ir"]);
  if (vipUser.rows[0]) {
    await client.query(
      // `ON CONFLICT (id) DO NOTHING` عمداً اضافه شده است: اگر ردیف عضویت با
      // همان شناسهٔ ثابت (`wacc_boutique`) از قبل برای کاربر دیگری وجود داشته
      // باشد (مثلاً پس از پاک شدن حساب‌ها)، تزریق نباید با نقض کلید اصلی بشکند.
      // این حالت در تست رگرسیون D18 کشف شد.
      `INSERT INTO wholesale_account (id,user_id,member_name,store_name,phone,city,status,activated_at,expires_at)
       SELECT $1,$2,$3,$4,$5,$6,'approved',now(),now()+interval '365 days'
       WHERE NOT EXISTS (SELECT 1 FROM wholesale_account WHERE user_id=$2)
       ON CONFLICT (id) DO NOTHING`,
      ["wacc_boutique", vipUser.rows[0].id, "سارا موسوی", "بوتیک وینتیج تهران", "09121111111", "تهران"],
    );
  }

  // Canonical marketplace seed — Phase 3.8 clean
  const sellerId = `seller_${supplierId}`;
  await client.query(
    `INSERT INTO seller (id,type,supplier_id,display_name,status) VALUES ($1,'SUPPLIER',$2,$3,'active') ON CONFLICT (id) DO NOTHING`,
    [sellerId, supplierId, "نساجی و پوشاک نیلگون"],
  );

  const products = [
    ["prod_classic", "prd_classic", "classic-short-sleeve", "پیراهن کلاسیک نیم‌آستین", "NL-CLASSIC", 890000, "شیری", "M", 60],
    ["prod_blouse", "prd_blouse", "vintage-princess-blouse", "بلوز وینتیج پرنس", "NL-BLOUSE", 1240000, "گلبهی", "L", 40],
    ["prod_skirt", "prd_skirt", "classic-pleated-skirt", "دامن پلیسه کلاسیک", "NL-SKIRT", 1580000, "سرمه‌ای", "S", 35],
  ] as const;
  const adminUserForSeed = (await client.query<{ id: string }>("SELECT id FROM account_user WHERE role='admin' LIMIT 1")).rows[0];
  const creatorId = adminUserForSeed?.id || null;
  for (const [prodId, oldId, slug, name, sku, price, color, size, stock] of products) {
    await client.query(
      `INSERT INTO product (id,name,slug,description,owner_type,is_kolbe_exclusive,status,created_by)
       VALUES ($1,$2,$3,$4,'SUPPLIER',false,'published',$5) ON CONFLICT (id) DO NOTHING`,
      [prodId, name, slug, "تولید کارخانه، کیفیت صادراتی", creatorId],
    );
    const variantId = `var_${oldId.slice(4)}`;
    await client.query(
      `INSERT INTO product_variant (id,product_id,sku,attributes,status)
       VALUES ($1,$2,$3,$4,'active') ON CONFLICT (id) DO NOTHING`,
      [variantId, prodId, `${sku}-${size}`, JSON.stringify({ color, size, color_hex: "#c9654d" })],
    );
    const offerId = `offer_${oldId.slice(4)}`;
    await client.query(
      `INSERT INTO seller_offer (id,product_id,seller_id,variant_id,sku,status,wholesale_price,currency,moq,moq_unit)
       VALUES ($1,$2,$3,$4,$5,'published',$6,'IRR',1,'PIECE') ON CONFLICT (id) DO NOTHING`,
      [offerId, prodId, sellerId, variantId, `${sku}-${size}`, price],
    );
    await client.query(
      `INSERT INTO product_variant_inventory (id,variant_id,seller_id,on_hand,reserved,status)
       VALUES ($1,$2,$3,$4,0,'active') ON CONFLICT (id) DO NOTHING`,
      [`inv_${oldId.slice(4)}`, variantId, sellerId, stock],
    );
    // Unique constraint on variant_id+seller_id also — handle second conflict
    await client.query(
      `INSERT INTO product_variant_inventory (id,variant_id,seller_id,on_hand,reserved,status)
       VALUES ($1,$2,$3,$4,0,'active') ON CONFLICT (variant_id,seller_id) DO NOTHING`,
      [`inv2_${oldId.slice(4)}`, variantId, sellerId, stock],
    );
  }
}

/**
 * کاشت دادهٔ نمایشی در صورت مجاز بودن — **بدون هیچ DDL**.
 *
 * ── تغییر گام ۱.۲ ───────────────────────────────────────────────────────────
 * پیش از این، این تابع نامش `prepareDatabase` بود و نخستین کارش اجرای رشتهٔ DDL
 * (`client.query(schema)`) بود؛ یعنی ساخت/ترمیم اسکیما در زمان اجرا. آن DDL حذف
 * شد و اسکیما فقط با `npm run db:migrate` ساخته/تغییر می‌کند. آنچه باقی مانده
 * فقط **دادهٔ نمایشی** است: نگرانی‌ای کاملاً جدا از اسکیما (قاعدهٔ D18).
 *
 * جدا بودن از `initialize` هم حفظ شده تا تست بتواند همین تابع را با یک `env`
 * صریح صدا بزند و ثابت کند در تولید هیچ حسابی کاشته نمی‌شود.
 *
 * @param env محیط تصمیم‌گیری؛ پیش‌فرض `process.env`.
 * @returns تصمیم کاشت، برای لاگ و برای تست.
 */
export async function prepareDatabase(
  client: PoolClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DemoSeedDecision> {
  const decision = demoSeedDecision(env);
  if (!decision.enabled) return decision;
  console.warn(
    "[kolbe] KOLBE_SEED_DEMO_DATA=true → کاشت دادهٔ نمایشی (حساب‌های دمو با رمز عبور عمومی). " +
      "این حالت هرگز نباید در تولید اجرا شود.",
  );
  await seedDemoData(client);
  return decision;
}

/**
 * راه‌اندازی تنبل (lazy) — «اتصال، بررسی سازگاری، سپس (شاید) کاشت دادهٔ نمایشی».
 *
 * ترتیب عمدی است:
 *   ۱) `assertDatabaseReady` فقط **می‌خواند**: مهاجرت‌ها و ستون‌ها را می‌سنجد.
 *      اگر دیتابیس مهاجرت‌نشده یا ناقص باشد، `DatabaseNotMigratedError` می‌دهد و
 *      هیچ ترافیکی سرو نمی‌شود (fail closed). هیچ جدول/ستون/ایندکس/تریگری ساخته
 *      یا ترمیم نمی‌شود.
 *   ۲) تنها کاری که می‌نویسد، کاشت دادهٔ نمایشی است و آن هم فقط با شرط دوگانهٔ
 *      D18 (`NODE_ENV !== production` و `KOLBE_SEED_DEMO_DATA=true`).
 */
async function initialize() {
  try {
    await assertDatabaseReady(pool());
  } catch (error) {
    if (error instanceof DatabaseNotMigratedError) {
      // پیام عملیاتی فقط در لاگ سرور؛ پاسخ HTTP عمومی می‌ماند (اصلاح D26).
      console.error(`[kolbe] ${error.message} (${error.code})`);
      for (const detail of error.details) console.error(`  - ${detail}`);
    }
    throw error;
  }

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await prepareDatabase(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function database() {
  globalDatabase.__kolbeDatabaseReady ??= initialize();
  await globalDatabase.__kolbeDatabaseReady;
  return pool();
}

export async function rows<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  const db = await database();
  return (await db.query<T>(sql, values)).rows;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const db = await database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
