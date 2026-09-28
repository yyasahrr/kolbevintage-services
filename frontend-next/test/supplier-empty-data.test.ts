/**
 * رگرسیون کرش پنل ساپلایر روی دادهٔ خالی — مرز API.
 *
 * ── چه چیزی خراب بود ────────────────────────────────────────────────────────
 * بعد از بارگذاری موفق APIها، کد پنل آرایه‌های دمو را با `splice()` جایگزین
 * می‌کرد. یک تأمین‌کنندهٔ معتبر می‌تواند صفر محصول / صفر سفارش / صفر RFQ
 * داشته باشد؛ آن‌وقت رابط کاربری اندیس ۰ را می‌خواند:
 *
 *   Cannot read properties of undefined (reading 'image')   ← products[0].image
 *
 * این تست مرز API را تضمین می‌کند: یک تأمین‌کنندهٔ تأییدشدهٔ بدون داده،
 * پاسخ‌های معتبر `[]` می‌گیرد (نه خطا، نه null، نه دادهٔ جعلی).
 *
 * این تست دادهٔ نمایشی تولید را تغییر نمی‌دهد و دادهٔ جعلی هم اضافه نمی‌کند:
 * فقط یک تأمین‌کنندهٔ جدید و کاملاً خالی در دیتابیس تست درج می‌کند.
 */

import { describe, expect, it } from "vitest";
import { call, login, uniqueSuffix } from "./helpers";
import { passwordRecord, rows } from "../server/database";

/**
 * ساخت یک تأمین‌کنندهٔ تأییدشدهٔ کاملاً خالی (بدون محصول، سفارش یا RFQ).
 *
 * مسیر طی‌شده همان مسیر واقعی است: حساب کاربری + رکورد supplier با وضعیت
 * approved + عضویت. هیچ دادهٔ محصول/سفارش/RFQای ساخته نمی‌شود.
 */
async function createEmptySupplier() {
  const suffix = uniqueSuffix();
  const email = `empty-supplier-${suffix}@example.test`;
  const password = "SupplierPass1404!";
  const supplierId = `sup_empty_${suffix}`;
  const userId = `usr_empty_${suffix}`;

  const { salt, passwordHash } = passwordRecord(password);
  await rows(
    `INSERT INTO account_user (id,email,password_hash,salt,role,display_name,phone,status)
     VALUES ($1,$2,$3,$4,'supplier',$5,$6,'active')`,
    [userId, email, passwordHash, salt, `کارخانهٔ خالی ${suffix}`, "09120000000"],
  );
  await rows(
    `INSERT INTO supplier (id,legal_name,display_name,city,phone,category,monthly_capacity,status)
     VALUES ($1,$2,$2,'تهران','09120000000','پوشاک مردانه',1000,'approved')`,
    [supplierId, `نساجی خالی ${suffix}`],
  );
  await rows(
    `INSERT INTO supplier_member (id,supplier_id,user_id,title) VALUES ($1,$2,$3,'مدیر تأمین')`,
    [`smem_empty_${suffix}`, supplierId, userId],
  );

  const session = await call("supplier/auth/login", { method: "POST", body: { email, password } });
  expect(session.status).toBe(200);
  expect(session.body.supplier.supplierId).toBe(supplierId);

  return { supplierId, email, password, token: session.body.token as string };
}

describe("ساپلایر با دادهٔ خالی — مرز API", () => {
  it("ورود می‌کند و supplierId معتبر برمی‌گرداند", async () => {
    const supplier = await createEmptySupplier();
    expect(supplier.supplierId).toMatch(/^sup_empty_/);
  });

  it("صفر محصول: GET supplier/products آرایهٔ خالی برمی‌گرداند (نه خطا)", async () => {
    const supplier = await createEmptySupplier();
    const result = await call("supplier/products", { token: supplier.token });
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body.products)).toBe(true);
    expect(result.body.products).toEqual([]);
  });

  it("صفر سفارش: GET supplier/orders آرایهٔ خالی برمی‌گرداند (نه خطا)", async () => {
    const supplier = await createEmptySupplier();
    const result = await call("supplier/orders", { token: supplier.token });
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body.orders)).toBe(true);
    expect(result.body.orders).toEqual([]);
  });

  it("صفر RFQ: GET supplier/rfqs آرایهٔ خالی برمی‌گرداند (نه خطا)", async () => {
    const supplier = await createEmptySupplier();
    const result = await call("supplier/rfqs", { token: supplier.token });
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body.rfqs)).toBe(true);
    expect(result.body.rfqs).toEqual([]);
  });

  it("session برای ساپلایر خالی هم درست کار می‌کند", async () => {
    const supplier = await createEmptySupplier();
    const result = await call("supplier/session", { token: supplier.token });
    expect(result.status).toBe(200);
    expect(result.body.supplier.supplierId).toBe(supplier.supplierId);
  });

  it("ساپلایر دمو (Nilgoon) همچنان با همان قرارداد کار می‌کند — بدون حذف ویژگی", async () => {
    const demo = await login("supplier");
    const [products, orders, rfqs] = await Promise.all([
      call("supplier/products", { token: demo.token }),
      call("supplier/orders", { token: demo.token }),
      call("supplier/rfqs", { token: demo.token }),
    ]);
    expect(products.status).toBe(200);
    expect(orders.status).toBe(200);
    expect(rfqs.status).toBe(200);
    expect(Array.isArray(products.body.products)).toBe(true);
    expect(Array.isArray(orders.body.orders)).toBe(true);
    expect(Array.isArray(rfqs.body.rfqs)).toBe(true);
  });
});
