import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, SUPPLIER, VIP, call, cleanupUser, dbQuery, ensureInitialized, login, unique } from "./helpers";
import { passwordRecord } from "@server/database";
import { publicProductHtml, publicSitemap } from "@server/commerce-discovery";

const supplierSku = unique("sup").toUpperCase();
const buyerEmail = `${unique("migrated")}@example.test`;
let adminToken = "";
let supplierToken = "";
let supplierProductId = "";

beforeAll(async () => {
  await ensureInitialized();
  adminToken = await login(ADMIN.email, ADMIN.password);
  supplierToken = await login(SUPPLIER.email, SUPPLIER.password);
});

afterAll(async () => {
  if (supplierProductId) {
    await dbQuery("DELETE FROM supplier_inventory WHERE variant_id IN (SELECT id FROM supplier_variant WHERE product_id=$1)", [supplierProductId]);
    await dbQuery("DELETE FROM inventory_balance WHERE variant_id IN (SELECT id FROM supplier_variant WHERE product_id=$1)", [supplierProductId]);
    await dbQuery("DELETE FROM supplier_variant WHERE product_id=$1", [supplierProductId]);
    await dbQuery("DELETE FROM supplier_product WHERE id=$1", [supplierProductId]);
  }
  await cleanupUser(buyerEmail);
});

describe("channel, import, installment, warehouse and SEO", () => {
  it("refuses a supplier retail or both channel, including a direct update", async () => {
    const denied = await call("POST", "supplier/products", {
      token: supplierToken,
      body: { name: "کالای ممنوعه خرده", sku: unique("bad"), category: "پوشاک", salesChannel: "both", retailEnabled: true },
    });
    expect(denied.status).toBe(422);
    expect(denied.data.error).toBe("CHANNEL_FORBIDDEN");

    const created = await call("POST", "supplier/products", {
      token: supplierToken,
      body: { name: "کالای عمده", sku: supplierSku, category: "پوشاک", wholesalePrice: 120000, stock: 8 },
    });
    expect(created.status).toBe(201);
    supplierProductId = created.data.product.id;
    await call("POST", `admin/catalog/${supplierProductId}/status`, { token: adminToken, body: { status: "approved" } });

    const forced = await call("POST", `admin/channels/${supplierProductId}`, {
      token: adminToken,
      body: { retailEnabled: true, wholesaleEnabled: true, channel: "both" },
    });
    expect(forced.status).toBe(422);
    expect(forced.data.error).toBe("CHANNEL_FORBIDDEN");

    const [locked] = await dbQuery<any>("UPDATE supplier_product SET retail_enabled=true WHERE id=$1 RETURNING owner_type, retail_enabled, wholesale_enabled", [supplierProductId]);
    expect(locked.owner_type).toBe("supplier");
    expect(locked.retail_enabled).toBe(false);
    expect(locked.wholesale_enabled).toBe(true);

    const retail = await call("GET", `catalog/products?channel=retail&owner=supplier&sku=${supplierSku}`);
    expect(retail.status).toBe(200);
    expect(retail.data.products.some((product: any) => product.id === supplierProductId || product.sku === supplierSku)).toBe(false);
    const wholesale = await call("GET", "catalog/products?channel=wholesale");
    expect(wholesale.data.products.some((product: any) => product.id === supplierProductId)).toBe(true);

    const checkout = await call("POST", "retail/orders", {
      body: { customer: { name: "خریدار", phone: "09120000009" }, lines: [{ id: supplierProductId, qty: 1, price: 1 }] },
    });
    expect(checkout.status).toBe(422);
    expect(checkout.data.error).toBe("CHANNEL_FORBIDDEN");
  });

  it("prices installment on the server and stores a snapshot", async () => {
    const sku = unique("kolbe").toUpperCase();
    const created = await call("POST", "admin/channels", {
      token: adminToken,
      body: { name: "پیراهن اقساطی", sku, price: 200000, salePrice: 150000, channel: "retail", installmentPolicy: "disabled_when_discounted", installmentCount: 4 },
    });
    expect(created.status).toBe(201);
    const id = created.data.id;
    const blocked = await call("POST", "pricing/quote", { body: { id, payMethod: "installment", price: 1, eligibility: true } });
    expect(blocked.status).toBe(422);
    expect(blocked.data.error).toBe("INSTALLMENT_NOT_ALLOWED");

    await call("POST", `admin/channels/${id}`, { token: adminToken, body: { retailEnabled: true, wholesaleEnabled: false, installmentPolicy: "enabled", salePrice: 150000 } });
    const quoted = await call("POST", "pricing/quote", { body: { id, payMethod: "installment", price: 1, eligibility: false } });
    expect(quoted.status).toBe(200);
    expect(quoted.data.ignoredClientPrice).toBe(true);
    expect(quoted.data.snapshot.final).toBe(150000);
    expect(quoted.data.snapshot.eligibility).toBe(true);
    expect(quoted.data.snapshot.amount).toBe(37500);
    expect(quoted.data.snapshot.base).toBe(200000);

    const order = await call("POST", "retail/orders", {
      body: { customer: { name: "خریدار اقساط", phone: "09123334455" }, lines: [{ id, qty: 1, price: 1 }], payMethod: "installment" },
    });
    expect(order.status).toBe(201);
    const [stored] = await dbQuery<any>("SELECT total_amount, lines FROM retail_order WHERE order_code=$1", [order.data.orderCode]);
    expect(Number(stored.total_amount)).toBe(150000 + 59000);
    const lines = typeof stored.lines === "string" ? JSON.parse(stored.lines) : stored.lines;
    expect(lines[0].priceSnapshot.policy).toBe("enabled");
    expect(lines[0].priceSnapshot.eligibility).toBe(true);
    await dbQuery("DELETE FROM retail_order WHERE order_code=$1", [order.data.orderCode]);
    await dbQuery("DELETE FROM retail_product WHERE id=$1", [id]);
    await dbQuery("DELETE FROM supplier_product WHERE id=$1", [id]);
  });

  it("dry-runs a mapped CSV without writing, then imports users without passwords", async () => {
    const before = await dbQuery("SELECT COUNT(*)::int AS count FROM supplier_product");
    const csv = "نام محصول,sku,دسته,سایز,موجودی,تصویر\nکت مهاجرت,MIG-1,کت,M,3,http://127.0.0.1/secret.jpg\n, , ,huge,-2,http://10.0.0.8/x.jpg";
    const uploaded = await call("POST", "admin/imports", {
      token: adminToken,
      body: { filename: "catalog.csv", kind: "products", mode: "create_only", contentBase64: Buffer.from(csv).toString("base64") },
    });
    expect(uploaded.status).toBe(201);
    expect(uploaded.data.format).toBe("csv");
    expect(uploaded.data.suggestions.name).toBe("نام محصول");
    expect(uploaded.data.confirmationRequired).toBe(true);
    const unmapped = await call("POST", `admin/imports/${uploaded.data.id}/dry-run`, { token: adminToken, body: {} });
    expect(unmapped.status).toBe(422);
    await call("POST", `admin/imports/${uploaded.data.id}/map`, { token: adminToken, body: { mapping: uploaded.data.suggestions, mode: "create_only" } });
    const dry = await call("POST", `admin/imports/${uploaded.data.id}/dry-run`, { token: adminToken, body: {} });
    expect(dry.status).toBe(200);
    expect(dry.data.error_count).toBeGreaterThan(0);
    expect(dry.data.created_count).toBe(0);
    const after = await dbQuery("SELECT COUNT(*)::int AS count FROM supplier_product");
    expect(after[0].count).toBe(before[0].count);

    const users = `name,email,phone,password,legacy_id\nمهاجر,${buyerEmail},09120007788,PlainSecret!,leg-1`;
    const userJob = await call("POST", "admin/imports", {
      token: adminToken,
      body: { filename: "users.csv", kind: "users", mode: "upsert", contentBase64: Buffer.from(users).toString("base64") },
    });
    await call("POST", `admin/imports/${userJob.data.id}/map`, { token: adminToken, body: { mapping: userJob.data.suggestions } });
    const imported = await call("POST", `admin/imports/${userJob.data.id}/run`, { token: adminToken, body: {} });
    expect(imported.data.created_count).toBe(1);
    const [user] = await dbQuery<any>("SELECT password_hash, password_reset_required FROM account_user WHERE email=$1", [buyerEmail]);
    expect(user.password_reset_required).toBe(true);
    expect(user.password_hash).not.toContain("PlainSecret");
    const loginAttempt = await call("POST", "auth/login", { body: { email: buyerEmail, password: "PlainSecret!" } });
    expect(loginAttempt.status).toBe(401);
    const otp = await call("POST", "auth/password/otp", { body: { phone: "09120007788" } });
    expect(otp.data.sent).toBe(true);
    expect(otp.data.code).toMatch(/^\d{6}$/);
    const reset = await call("POST", "auth/password/reset", { body: { phone: "09120007788", code: otp.data.code, password: "ResetPass1404!" } });
    expect(reset.status).toBe(200);
    expect((await call("POST", "auth/login", { body: { email: buyerEmail, password: "ResetPass1404!" } })).status).toBe(200);
  });

  it("keeps warehouse balances as the sellable source of truth", async () => {
    const [variant] = await dbQuery<any>("SELECT id, sku FROM supplier_variant WHERE product_id=$1 LIMIT 1", [supplierProductId]);
    expect(variant).toBeTruthy();
    await dbQuery("INSERT INTO inventory_balance (variant_id, warehouse_id, on_hand, reserved) VALUES ($1,'wh_teh',5,1), ($1,'wh_isf',7,0) ON CONFLICT (variant_id, warehouse_id) DO UPDATE SET on_hand=EXCLUDED.on_hand, reserved=EXCLUDED.reserved", [variant.id]);
    const stock = await call("GET", `admin/variants/${variant.id}/inventory`, { token: adminToken });
    expect(stock.data.onHand).toBe(12);
    expect(stock.data.available).toBe(11);
    expect(stock.data.source).toBe("wms");
    const catalog = await call("GET", "wholesale/products", { token: await login(VIP.email, VIP.password) });
    const product = catalog.data.products.find((item: any) => item.id === supplierProductId);
    expect(product.product_variants.find((item: any) => item.id === variant.id).inventory.on_hand).toBe(12);
  });

  it("renders price in the initial product HTML and keeps supplier URLs out of the sitemap", async () => {
    const html = await publicProductHtml("shirt-linen", "http://localhost:3000", new URLSearchParams(), null);
    expect(html.kind).toBe("html");
    if (html.kind === "html") {
      expect(html.html).toContain('data-price="2390000"');
      expect(html.html).toContain("Product");
      expect(html.html).not.toContain("aggregateRating");
      expect(html.html).toContain("data-availability");
    }
    const hidden = await publicProductHtml(supplierSku, "http://localhost:3000", new URLSearchParams(), null);
    expect(hidden.kind).toBe("missing");
    const sitemap = await publicSitemap("products", "http://localhost:3000");
    expect(sitemap).toContain("/product/shirt-linen");
    expect(sitemap).not.toContain(supplierSku);

    const noindex = await call("POST", "admin/seo/documents", {
      token: adminToken,
      body: { entityType: "product", entityId: "shirt-linen", slug: "shirt-linen", seoTitle: "پیراهن", metaDescription: "توضیح", h1: "پیراهن", index: false },
    });
    expect(noindex.status).toBe(201);
    const after = await publicSitemap("products", "http://localhost:3000");
    expect(after).not.toContain("/product/shirt-linen");
    await dbQuery("DELETE FROM seo_document WHERE entity_id='shirt-linen'");

    const loop = await call("POST", "admin/seo/redirects", { token: adminToken, body: { source: "/a-loop", target: "/b-loop", status: 301 } });
    expect(loop.status).toBe(201);
    const back = await call("POST", "admin/seo/redirects", { token: adminToken, body: { source: "/b-loop", target: "/a-loop", status: 301 } });
    expect(back.status).toBe(422);
    expect(back.data.error).toBe("REDIRECT_LOOP");

    const { salt, passwordHash } = passwordRecord("StaffPass1404!");
    const staffId = unique("staff");
    const staffEmail = `${staffId}@example.test`;
    await dbQuery(
      "INSERT INTO account_user (id, email, password_hash, salt, role, display_name) VALUES ($1,$2,$3,$4,'admin','کارشناس سئو')",
      [staffId, staffEmail, passwordHash, salt],
    );
    await dbQuery("INSERT INTO staff_permission (id, actor_id, code) VALUES ($1,$2,'seo:read')", [unique("perm"), staffId]);
    const staffToken = await login(staffEmail, "StaffPass1404!");
    const forbidden = await call("POST", "admin/seo/documents", { token: staffToken, body: { entityType: "page", slug: "secret", seoTitle: "مخفی", h1: "مخفی" } });
    expect(forbidden.status).toBe(403);
    const robots = await call("GET", "admin/seo/robots", { token: staffToken });
    expect(robots.data.warning).toContain("noindex");
    await cleanupUser(staffEmail);
  });
});
