/**
 * Seed دامنه کلبه - از طریق APIهای عمومی، پس از اجرای سرور مدوسا.
 * اجرا:  node scripts/seed.mjs http://127.0.0.1:9000
 * این اسکریپت همان مسیر واقعی کاربران را طی میکند (register -> apply -> approve -> order).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* بارگذاری backend/.env (مثل loadEnv مدوسا) تا رازها یکجا مدیریت شوند */
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
} catch {
  /* بدون .env ادامه میدهیم (مقادیر پیشفرض) */
}

const BASE = process.argv[2] || process.env.MEDUSA_BACKEND_URL || "http://127.0.0.1:9000";
const BOOTSTRAP = process.env.KOLBE_BOOTSTRAP_SECRET || "kolbe-bootstrap-2026";
const PK = process.env.KOLBE_PUBLISHABLE_KEY || "pk_8f89ce3f6e86e7085af4fa9f374537c7efc4bbb7f3a591406cb67fb44b3604ee";

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-publishable-api-key": PK,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log("→ bootstrap admin");
  await api("/store/kolbe/dev/bootstrap", {
    method: "POST",
    body: { secret: BOOTSTRAP, email: "admin@kolbe.ir", password: "KolbeAdmin1404!", name: "مدیر کلبه" },
  }).catch((e) => console.log("  (ادمین از قبل هست)", e.message.slice(0, 60)));
  const admin = await api("/store/kolbe/auth/login", {
    method: "POST",
    body: { email: "admin@kolbe.ir", password: "KolbeAdmin1404!", role: "admin" },
  });
  const adminToken = admin.token;

  console.log("→ ساپلایرها: درخواست + تأیید + ساخت ورود");
  const suppliers = [
    { company: "نساجی و پوشاک نیلگون", rep: "نرگس آذر", email: "nilgoon@kolbe.ir", category: "پوشاک زنانه" },
    { company: "بافت اصفهان", rep: "امیر رستگار", email: "baft@kolbe.ir", category: "پوشاک مردانه" },
  ];
  const supplierLogins = [];
  for (const s of suppliers) {
    const app = await api("/store/kolbe/supplier/apply", {
      method: "POST",
      body: { companyName: s.company, representativeName: s.rep, phone: "09120000000", category: s.category, monthlyCapacity: 5000 },
    });
    const reviewed = await api(`/store/kolbe/admin/supplier-applications/${app.id}`, {
      method: "POST",
      token: adminToken,
      body: { status: "approved", loginEmail: s.email, loginPassword: "SupplierPass1404!" },
    });
    const login = await api("/store/kolbe/supplier/auth/login", {
      method: "POST",
      body: { email: s.email, password: "SupplierPass1404!" },
    });
    supplierLogins.push(login);
    console.log("  ✓", s.company, "->", reviewed.supplier_id);
  }

  console.log("→ کاتالوگ: محصولات هر ساپلایر");
  const catalog = [
    { name: "پیراهن کلاسیک نیم‌آستین", sku: `NL-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, category: "پوشاک زنانه", price: 890000, color: "شیری", size: "M", stock: 60 },
    { name: "بلوز وینتیج پرنس", sku: `NL-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, category: "پوشاک زنانه", price: 1240000, color: "گلبهی", size: "L", stock: 40 },
    { name: "دامن پلیسه کلاسیک", sku: `NL-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, category: "پوشاک زنانه", price: 1580000, color: "سرمه‌ای", size: "S", stock: 35 },
    { name: "پیراهن مردانه آکسفورد", sku: `BF-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, category: "پوشاک مردانه", price: 1450000, color: "سفید", size: "L", stock: 50 },
    { name: "ژاکت بافت دارک آکادمیا", sku: `BF-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, category: "پوشاک مردانه", price: 2350000, color: "قهوه‌ای", size: "XL", stock: 30 },
  ];
  for (const [index, item] of catalog.entries()) {
    const login = supplierLogins[index % 2];
    const created = await api("/store/kolbe/supplier/products", {
      method: "POST",
      token: login.token,
      body: { ...item, description: "تولید کارخانه، کیفیت صادراتی", wholesalePrice: item.price, colorHex: "#c9654d" },
    });
    // ادمین تأیید میکند:
    await api(`/store/kolbe/admin/catalog/${created.product.id}/status`, {
      method: "POST",
      token: adminToken,
      body: { status: "approved" },
    });
    console.log("  ✓", item.name);
  }

  console.log("→ VIP: ثبتنام + درخواست + تأیید");
  await api("/store/kolbe/auth/register", {
    method: "POST",
    body: { email: "vip@boutique.ir", password: "VipPass1404!", name: "سارا موسوی", phone: "09121111111", role: "customer" },
  }).catch(() => {});
  const customer = await api("/store/kolbe/auth/login", {
    method: "POST",
    body: { email: "vip@boutique.ir", password: "VipPass1404!" },
  });
  await api("/store/kolbe/wholesale/apply", {
    method: "POST",
    token: customer.token,
    body: { memberName: "سارا موسوی", storeName: "بوتیک وینتیج تهران", phone: "09121111111", city: "تهران" },
  }).catch(() => {});
  const accounts = await api("/store/kolbe/admin/accounts", { token: adminToken });
  const pendingAccount = accounts.accounts.find((a) => a.store_name === "بوتیک وینتیج تهران");
  await api(`/store/kolbe/admin/accounts/${pendingAccount.id}/status`, {
    method: "POST",
    token: adminToken,
    body: { status: "approved", expiresAt: new Date(Date.now() + 365 * 864e5).toISOString() },
  });
  const vip = await api("/store/kolbe/auth/login", {
    method: "POST",
    body: { email: "vip@boutique.ir", password: "VipPass1404!" },
  });
  console.log("  ✓ نقش VIP فعال شد");

  console.log("→ RFQ برای ساپلایر اول");
  const suppliersList = await api("/store/kolbe/admin/suppliers", { token: adminToken });
  await api("/store/kolbe/admin/rfqs", {
    method: "POST",
    token: adminToken,
    body: {
      supplierId: suppliersList.suppliers[0].id,
      title: "سفارش فصلی پیراهن کلاسیک",
      customerName: "کلبه وینتیج",
      quantity: 400,
      specifications: { fabric: "نخی پنبه ۱۰۰٪", note: "تحویل دو مرحلهای" },
    },
  });

  console.log("→ سفارش عمده نمونه از سمت VIP");
  const products = await api("/store/kolbe/wholesale/products", { token: vip.token });
  const lines = products.products.slice(0, 2).map((p) => ({
    variantId: p.product_variants?.[0]?.id,
    quantity: 8,
  }));
  const order = await api("/store/kolbe/wholesale/orders", {
    method: "POST",
    token: vip.token,
    body: { lines },
  });
  console.log("  ✓ سفارش:", order.orderCode);

  console.log("\nاولیه‌سازی کامل شد ✅");
  console.log("ادمین:  admin@kolbe.ir / KolbeAdmin1404!");
  console.log("VIP:    vip@boutique.ir / VipPass1404!");
  console.log("ساپلایر: nilgoon@kolbe.ir / SupplierPass1404!");
}

main().catch((error) => {
  console.error("Seed failed:", error.message);
  process.exit(1);
});
