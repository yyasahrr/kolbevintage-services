import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:55432/kolbe";

const globalDatabase = globalThis as typeof globalThis & {
  __kolbePool?: Pool;
  __kolbeDatabaseReady?: Promise<void>;
};

const pool = globalDatabase.__kolbePool ?? new Pool({ connectionString: DATABASE_URL });
if (process.env.NODE_ENV !== "production") globalDatabase.__kolbePool = pool;

const schema = `
CREATE TABLE IF NOT EXISTS account_user (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL, salt text NOT NULL,
  role text NOT NULL DEFAULT 'customer', display_name text, phone text, status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier (
  id text PRIMARY KEY, legal_name text NOT NULL, display_name text NOT NULL, city text, phone text,
  category text, monthly_capacity integer, capabilities jsonb DEFAULT '[]', status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier_application (
  id text PRIMARY KEY, user_id text, company_name text NOT NULL, representative_name text NOT NULL,
  phone text NOT NULL, category text NOT NULL, monthly_capacity integer, status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier_member (
  id text PRIMARY KEY, supplier_id text NOT NULL, user_id text NOT NULL UNIQUE, title text NOT NULL DEFAULT 'عضو تیم',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier_product (
  id text PRIMARY KEY, supplier_id text NOT NULL, name text NOT NULL, sku text NOT NULL UNIQUE,
  category text NOT NULL, description text NOT NULL DEFAULT '', wholesale_price bigint NOT NULL DEFAULT 0,
  image_url text, status text NOT NULL DEFAULT 'draft', created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier_variant (
  id text PRIMARY KEY, product_id text NOT NULL, sku text NOT NULL UNIQUE, color text NOT NULL DEFAULT 'بدون رنگ',
  color_hex text, size text NOT NULL DEFAULT 'تک‌سایز', cost bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier_inventory (
  id text PRIMARY KEY, variant_id text NOT NULL UNIQUE, on_hand integer NOT NULL DEFAULT 0,
  reserved integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wholesale_account (
  id text PRIMARY KEY, user_id text NOT NULL, member_name text NOT NULL, store_name text NOT NULL,
  phone text NOT NULL, city text NOT NULL, plan_name text NOT NULL DEFAULT 'وی‌آی‌پی', status text NOT NULL DEFAULT 'pending',
  activated_at timestamptz, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wholesale_order (
  id text PRIMARY KEY, order_code text NOT NULL UNIQUE, account_id text NOT NULL, status text NOT NULL DEFAULT 'pending',
  total_amount bigint NOT NULL DEFAULT 0, total_units integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wholesale_order ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE TABLE IF NOT EXISTS wholesale_order_item (
  id text PRIMARY KEY, order_id text NOT NULL, product_id text NOT NULL, variant_id text NOT NULL,
  product_name text NOT NULL, sku text NOT NULL, quantity integer NOT NULL DEFAULT 1, unit_price bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_order (
  id text PRIMARY KEY, order_code text NOT NULL UNIQUE, supplier_id text NOT NULL, wholesale_order_id text,
  status text NOT NULL DEFAULT 'pending', due_date timestamptz, tracking_code text, total_amount bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IRR', notes text, shipped_at timestamptz, delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_order_item (
  id text PRIMARY KEY, purchase_order_id text NOT NULL, product_name text NOT NULL, sku text, variant_id text,
  quantity integer NOT NULL DEFAULT 1, unit_price bigint NOT NULL DEFAULT 0, total_amount bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rfq (
  id text PRIMARY KEY, supplier_id text NOT NULL, reference_code text NOT NULL UNIQUE, title text NOT NULL,
  customer_name text NOT NULL, quantity integer NOT NULL DEFAULT 0, requested_delivery_date timestamptz,
  specifications jsonb DEFAULT '{}', status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quote (
  id text PRIMARY KEY, rfq_id text NOT NULL, supplier_id text NOT NULL, unit_price bigint NOT NULL DEFAULT 0,
  lead_time_days integer NOT NULL DEFAULT 0, notes text, status text NOT NULL DEFAULT 'submitted',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_ticket (
  id text PRIMARY KEY, supplier_id text, subject text NOT NULL, category text NOT NULL DEFAULT 'عمومی',
  message text NOT NULL, priority text NOT NULL DEFAULT 'normal', status text NOT NULL DEFAULT 'open', admin_reply text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS retail_order (
  id text PRIMARY KEY, order_code text NOT NULL UNIQUE, customer_name text NOT NULL, phone text NOT NULL, email text,
  lines jsonb NOT NULL DEFAULT '[]', address jsonb NOT NULL DEFAULT '{}', shipping_method text NOT NULL DEFAULT 'post',
  shipping_price bigint NOT NULL DEFAULT 0, pay_method text NOT NULL DEFAULT 'gateway', total_amount bigint NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending_gateway', fulfillment_status text NOT NULL DEFAULT 'processing',
  amount_source text NOT NULL DEFAULT 'client', idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE retail_order ADD COLUMN IF NOT EXISTS amount_source text NOT NULL DEFAULT 'client';
ALTER TABLE retail_order ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE TABLE IF NOT EXISTS retail_product (
  id text PRIMARY KEY, name text NOT NULL, price bigint NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS system_log (
  id text PRIMARY KEY, level text NOT NULL DEFAULT 'error', source text NOT NULL DEFAULT 'system',
  event_type text NOT NULL DEFAULT 'application.error', message text NOT NULL, error_name text, stack text,
  fingerprint text NOT NULL, status text NOT NULL DEFAULT 'open', http_method text, path text, http_status integer,
  duration_ms integer, request_id text, actor_id text, actor_role text, ip text, user_agent text,
  environment text NOT NULL DEFAULT 'development', release text, metadata jsonb, first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL, occurrence_count integer NOT NULL DEFAULT 1, resolved_at timestamptz,
  resolved_by text, resolution_note text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS site_setting (
  setting_key text PRIMARY KEY, value jsonb NOT NULL DEFAULT '{}', updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS system_log_open_fingerprint ON system_log(fingerprint) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS system_log_last_seen ON system_log(last_seen_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS retail_order_idempotency ON retail_order(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wholesale_order_idempotency ON wholesale_order(account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS wholesale_order_account ON wholesale_order(account_id);
CREATE INDEX IF NOT EXISTS purchase_order_supplier ON purchase_order(supplier_id);
CREATE INDEX IF NOT EXISTS supplier_product_status ON supplier_product(status);
`;

export function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function passwordRecord(password: string) {
  const salt = randomBytes(16).toString("hex");
  return { salt, passwordHash: scryptSync(password, salt, 64).toString("hex") };
}

async function seed(client: PoolClient) {
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
      `INSERT INTO wholesale_account (id,user_id,member_name,store_name,phone,city,status,activated_at,expires_at)
       SELECT $1,$2,$3,$4,$5,$6,'approved',now(),now()+interval '365 days'
       WHERE NOT EXISTS (SELECT 1 FROM wholesale_account WHERE user_id=$2)`,
      ["wacc_boutique", vipUser.rows[0].id, "سارا موسوی", "بوتیک وینتیج تهران", "09121111111", "تهران"],
    );
  }

  const products = [
    ["prd_classic", "پیراهن کلاسیک نیم‌آستین", "NL-CLASSIC", "پوشاک زنانه", 890000, "شیری", "M", 60],
    ["prd_blouse", "بلوز وینتیج پرنس", "NL-BLOUSE", "پوشاک زنانه", 1240000, "گلبهی", "L", 40],
    ["prd_skirt", "دامن پلیسه کلاسیک", "NL-SKIRT", "پوشاک زنانه", 1580000, "سرمه‌ای", "S", 35],
  ] as const;
  for (const [id, name, sku, category, price, color, size, stock] of products) {
    await client.query(
      `INSERT INTO supplier_product (id,supplier_id,name,sku,category,description,wholesale_price,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'approved') ON CONFLICT (id) DO NOTHING`,
      [id, supplierId, name, sku, category, "تولید کارخانه، کیفیت صادراتی", price],
    );
    const variantId = `var_${id.slice(4)}`;
    await client.query(
      `INSERT INTO supplier_variant (id,product_id,sku,color,color_hex,size,cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [variantId, id, `${sku}-${size}`, color, "#c9654d", size, price],
    );
    await client.query(
      `INSERT INTO supplier_inventory (id,variant_id,on_hand,reserved) VALUES ($1,$2,$3,0)
       ON CONFLICT (variant_id) DO NOTHING`,
      [`inv_${id.slice(4)}`, variantId, stock],
    );
  }

  // Canonical retail price list — the source of truth checkout validates against.
  // Mirrors frontend-next/storefront/data/catalog.ts (ids, names, prices in IRR).
  const retailProducts = [
    ["blazer-oxford", "بلیزر آکسفورد", 4_850_000],
    ["shirt-linen", "پیراهن کتان کلبه", 2_390_000],
    ["knit-cable", "پلیور بافت کابلی", 3_180_000],
    ["trouser-pleated", "شلوار پیلی‌دار کلاسیک", 2_950_000],
    ["polo-pique", "پولوشرت پیکه", 1_890_000],
    ["coat-herringbone", "پالتو شِوِرون", 7_450_000],
    ["vest-knit", "جلیقه بافت آرگایل", 1_650_000],
    ["belt-leather", "کمربند چرم دست‌دوز", 980_000],
    ["shirt-oxford", "پیراهن آکسفورد راه‌راه", 2_150_000],
    ["scarf-wool", "شال گردن پشمی", 890_000],
    ["trouser-chino", "شلوار چینو کلبه", 1_980_000],
    ["cardigan-shawl", "ژاکت یقه شال", 3_450_000],
  ] as const;
  for (const [id, name, price] of retailProducts) {
    await client.query(
      `INSERT INTO retail_product (id,name,price) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, price=EXCLUDED.price, updated_at=now()`,
      [id, name, price],
    );
  }
}

async function initialize() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(schema);
    await seed(client);
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
  return pool;
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
