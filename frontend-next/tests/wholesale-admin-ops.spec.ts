import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, SUPPLIER, VIP, call, dbQuery, ensureInitialized, login, unique } from "./helpers";

let adminToken = "";
let supplierToken = "";
const createdOrderIds: string[] = [];
const createdProductIds: string[] = [];
const createdTypeIds: string[] = [];

async function vipAccountId() {
  const [row] = await dbQuery<{ id: string }>(
    `SELECT a.id FROM wholesale_account a JOIN account_user u ON u.id = a.user_id WHERE u.email = $1`,
    [VIP.email],
  );
  return row.id;
}

async function insertOrder(input: {
  code: string;
  amount: number;
  status: string;
  payment: string;
  fulfillment: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  shippedAt?: string | null;
}) {
  const id = unique("word");
  await dbQuery(
    `INSERT INTO wholesale_order
      (id, order_code, account_id, status, payment_status, fulfillment_status, operational_priority, total_amount, total_units, created_at, updated_at, shipped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,12,$9,$10,$11)`,
    [id, input.code, await vipAccountId(), input.status, input.payment, input.fulfillment, input.priority, input.amount, input.createdAt, input.updatedAt, input.shippedAt ?? null],
  );
  const [product] = await dbQuery<{ id: string; sku: string; name: string; variant_id: string }>(
    `SELECT p.id, p.sku, p.name, v.id AS variant_id
     FROM supplier_product p JOIN supplier_variant v ON v.product_id = p.id
     WHERE p.status = 'approved' ORDER BY p.id LIMIT 1`,
  );
  await dbQuery(
    `INSERT INTO wholesale_order_item (id, order_id, product_id, variant_id, product_name, sku, quantity, unit_price)
     VALUES ($1,$2,$3,$4,$5,$6,12,$7)`,
    [unique("woi"), id, product.id, product.variant_id, product.name, product.sku, Math.round(input.amount / 12)],
  );
  createdOrderIds.push(id);
  return id;
}

beforeAll(async () => {
  await ensureInitialized();
  adminToken = await login(ADMIN.email, ADMIN.password);
  supplierToken = await login(SUPPLIER.email, SUPPLIER.password);
});

afterAll(async () => {
  if (createdOrderIds.length) {
    await dbQuery("DELETE FROM wholesale_order_item WHERE order_id = ANY($1::text[])", [createdOrderIds]);
    await dbQuery("DELETE FROM wholesale_order WHERE id = ANY($1::text[])", [createdOrderIds]);
  }
  if (createdProductIds.length) {
    await dbQuery("DELETE FROM supplier_notification WHERE product_id = ANY($1::text[])", [createdProductIds]);
    const variants = await dbQuery<{ id: string }>("SELECT id FROM supplier_variant WHERE product_id = ANY($1::text[])", [createdProductIds]);
    if (variants.length) await dbQuery("DELETE FROM supplier_inventory WHERE variant_id = ANY($1::text[])", [variants.map((row) => row.id)]);
    await dbQuery("DELETE FROM supplier_variant WHERE product_id = ANY($1::text[])", [createdProductIds]);
    await dbQuery("DELETE FROM supplier_product WHERE id = ANY($1::text[])", [createdProductIds]);
  }
  if (createdTypeIds.length) {
    await dbQuery("DELETE FROM series_template_line WHERE template_id IN (SELECT id FROM series_template WHERE product_type_id = ANY($1::text[]))", [createdTypeIds]);
    await dbQuery("DELETE FROM series_template WHERE product_type_id = ANY($1::text[])", [createdTypeIds]);
    await dbQuery("DELETE FROM product_type_size WHERE product_type_id = ANY($1::text[])", [createdTypeIds]);
    await dbQuery("DELETE FROM product_type WHERE id = ANY($1::text[])", [createdTypeIds]);
  }
});

describe("wholesale admin operations", () => {
  it("keeps the sort query on the request and rejects unknown sorts", async () => {
    const bad = await call("GET", "admin/orders?sort=drop-table", { token: adminToken });
    expect(bad.status).toBe(422);
    expect(bad.data.error).toBe("INVALID_SORT");
  });

  it("sorts, searches and filters wholesale orders on the server", async () => {
    const older = unique("KV-OLD");
    const newer = unique("KV-NEW");
    await insertOrder({
      code: older, amount: 100_000, status: "pending", payment: "unpaid", fulfillment: "pending", priority: 10,
      createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-02T00:00:00Z", shippedAt: "2024-01-03T00:00:00Z",
    });
    await insertOrder({
      code: newer, amount: 900_000, status: "approved", payment: "paid", fulfillment: "shipped", priority: 90,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z", shippedAt: "2026-03-01T00:00:00Z",
    });

    const newest = await call("GET", "admin/orders?sort=newest", { token: adminToken });
    expect(newest.status).toBe(200);
    const newestCodes = newest.data.orders.map((order: { order_code: string }) => order.order_code);
    expect(newestCodes.indexOf(newer)).toBeLessThan(newestCodes.indexOf(older));

    const oldest = await call("GET", "admin/orders?sort=oldest", { token: adminToken });
    const oldestCodes = oldest.data.orders.map((order: { order_code: string }) => order.order_code);
    expect(oldestCodes.indexOf(older)).toBeLessThan(oldestCodes.indexOf(newer));

    const byAmount = await call("GET", "admin/orders?sort=amount", { token: adminToken });
    const amountCodes = byAmount.data.orders.map((order: { order_code: string }) => order.order_code);
    expect(amountCodes.indexOf(newer)).toBeLessThan(amountCodes.indexOf(older));

    const byPriority = await call("GET", "admin/orders?sort=priority", { token: adminToken });
    const priorityCodes = byPriority.data.orders.map((order: { order_code: string }) => order.order_code);
    expect(priorityCodes.indexOf(newer)).toBeLessThan(priorityCodes.indexOf(older));

    const filtered = await call("GET", `admin/orders?status=approved&payment=paid&fulfillment=shipped&q=${encodeURIComponent(newer)}`, { token: adminToken });
    expect(filtered.status).toBe(200);
    expect(filtered.data.orders.map((order: { order_code: string }) => order.order_code)).toEqual([newer]);
    expect(filtered.data.orders[0].wholesale_order_items.length).toBeGreaterThan(0);
  });

  it("updates payment, fulfillment and operational priority from the desk", async () => {
    const code = unique("KV-OPS");
    const id = await insertOrder({
      code, amount: 240_000, status: "approved", payment: "unpaid", fulfillment: "pending", priority: 0,
      createdAt: "2025-06-01T00:00:00Z", updatedAt: "2025-06-01T00:00:00Z",
    });
    const updated = await call("POST", `admin/orders/${id}/operations`, {
      token: adminToken,
      body: { paymentStatus: "paid", fulfillmentStatus: "shipped", operationalPriority: 80 },
    });
    expect(updated.status).toBe(200);
    expect(updated.data.payment_status).toBe("paid");
    expect(updated.data.fulfillment_status).toBe("shipped");
    expect(updated.data.operational_priority).toBe(80);
    expect(updated.data.shipped_at).toBeTruthy();
    expect(updated.data.status).toBe("approved");
  });

  it("requires a rejection reason, notifies the supplier, and allows resubmit", async () => {
    const sku = unique("rej").toUpperCase();
    const created = await call("POST", "supplier/products", {
      token: supplierToken,
      body: { name: "محصول ردشدنی", sku, category: "پوشاک", description: "توضیح اولیه", wholesalePrice: 1000, color: "مشکی", size: "M", stock: 12 },
    });
    expect(created.status).toBe(201);
    const productId = created.data.product.id as string;
    createdProductIds.push(productId);

    const missing = await call("POST", `admin/catalog/${productId}/status`, { token: adminToken, body: { status: "rejected" } });
    expect(missing.status).toBe(422);
    expect(missing.data.error).toBe("REJECTION_REASON_REQUIRED");

    const rejected = await call("POST", `admin/catalog/${productId}/status`, {
      token: adminToken,
      body: { status: "rejected", reasonCode: "images_unsuitable", note: "پس‌زمینه تصویر مناسب نیست." },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.data.rejection_reason_code).toBe("images_unsuitable");
    expect(rejected.data.rejection_note).toBe("پس‌زمینه تصویر مناسب نیست.");
    expect(rejected.data.reviewed_at).toBeTruthy();

    const notes = await call("GET", "supplier/notifications", { token: supplierToken });
    expect(notes.status).toBe(200);
    expect(notes.data.notifications.some((item: { product_id: string; kind: string }) => item.product_id === productId && item.kind === "product_rejected")).toBe(true);

    const mine = await call("GET", "supplier/products", { token: supplierToken });
    const product = mine.data.products.find((item: { id: string }) => item.id === productId);
    expect(product.status).toBe("rejected");
    expect(product.rejection_reason).toContain("تصاویر");
    expect(product.rejection_note).toContain("پس‌زمینه");

    const again = await call("POST", `supplier/products/${productId}/resubmit`, {
      token: supplierToken,
      body: { description: "توضیح اصلاح‌شده و تصویر جدید" },
    });
    expect(again.status).toBe(200);
    expect(again.data.status).toBe("submitted");

    const blocked = await call("POST", `supplier/products/${productId}/resubmit`, { token: supplierToken, body: {} });
    expect(blocked.status).toBe(409);
    expect(blocked.data.error).toBe("PRODUCT_NOT_RESUBMITTABLE");
  });

  it("keeps product-type sizes in sort order and uses them for series and products", async () => {
    const code = unique("ptype").replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase() || "ptypeops";
    const created = await call("POST", "admin/product-types", {
      token: adminToken,
      body: { code, name: "نوع آزمایشی", description: "برای ترتیب سایز", active: true, sortOrder: 500 },
    });
    expect(created.status).toBe(201);
    const typeId = created.data.productType.id as string;
    createdTypeIds.push(typeId);

    const first = await call("POST", `admin/product-types/${typeId}/sizes`, { token: adminToken, body: { label: "Z" } });
    const third = await call("POST", `admin/product-types/${typeId}/sizes`, { token: adminToken, body: { label: "M" } });
    const inserted = await call("POST", `admin/product-types/${typeId}/sizes`, { token: adminToken, body: { label: "A", position: 1 } });
    expect(inserted.status).toBe(201);

    const adminList = await call("GET", "admin/product-types", { token: adminToken });
    const type = adminList.data.productTypes.find((item: { id: string }) => item.id === typeId);
    expect(type.sizes.map((size: { label: string }) => size.label)).toEqual(["Z", "A", "M"]);
    expect(type.sizes.map((size: { label: string }) => size.label)).not.toEqual(["A", "M", "Z"]);

    const template = await call("POST", "admin/series-templates", {
      token: adminToken,
      body: {
        productTypeId: typeId,
        code: `${code}-std`,
        name: "قالب آزمایشی",
        lines: [{ sizeId: inserted.data.size.id, quantity: 2 }, { sizeId: third.data.size.id, quantity: 1 }],
      },
    });
    expect(template.status).toBe(201);

    const publicList = await call("GET", "catalog/product-types");
    const published = publicList.data.productTypes.find((item: { id: string }) => item.id === typeId);
    expect(published.sizes.map((size: { label: string }) => size.label)).toEqual(["Z", "A", "M"]);
    expect(published.templates[0].lines.map((line: { label: string }) => line.label)).toEqual(["A", "M"]);

    const wrong = await call("POST", "supplier/products", {
      token: supplierToken,
      body: {
        name: "سایز نامربوط", sku: unique("badsize").toUpperCase(), productTypeId: typeId, wholesalePrice: 1000,
        description: "نباید ذخیره شود", color: "آبی", seriesCount: 1,
        lines: [{ sizeId: "psz_shoe_36", quantity: 1 }],
      },
    });
    expect(wrong.status).toBe(422);
    expect(wrong.data.error).toBe("SIZE_NOT_IN_TYPE");

    const sku = unique("typed").toUpperCase();
    const product = await call("POST", "supplier/products", {
      token: supplierToken,
      body: {
        name: "محصول با سایز جدید", sku, productTypeId: typeId, seriesTemplateId: template.data.template.id,
        wholesalePrice: 2500, description: "از قالب سرور", color: "سبز", seriesCount: 2,
      },
    });
    expect(product.status).toBe(201);
    createdProductIds.push(product.data.product.id);
    const variants = await dbQuery<{ size: string; size_id: string }>(
      "SELECT size, size_id FROM supplier_variant WHERE product_id=$1 ORDER BY size",
      [product.data.product.id],
    );
    expect(variants.map((row) => row.size).sort()).toEqual(["A", "M"]);
    expect(variants.every((row) => row.size_id)).toBe(true);
    expect(first.data.size.id).toBeTruthy();
  });
});
