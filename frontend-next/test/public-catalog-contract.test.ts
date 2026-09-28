/**
 * قرارداد کاتالوگ عمومی فروشگاه — `GET /store/kolbe/catalog/products`.
 *
 * چرا این تست لازم است؟ چون این تنها مسیر **ناشناس** کاتالوگ است؛ اگر روزی کسی
 * فیلدی از لایهٔ عمده/مالی را به پروجکشن عمومی اضافه کند، این تست می‌شکند.
 * قواعد سنجیده‌شده:
 *  ۱) بدون نشست پاسخ می‌دهد (ناشناس).
 *  ۲) فقط محصول با وضعیت published را برمی‌گرداند.
 *  ۳) هیچ قیمت عمده/فیلد داخلی (wholesale_price، seller_id، supplier_id) بیرون نمی‌رود.
 *  ۴) در نبود قیمت خردهٔ رسمی، `retail_price: null` و منبع آن صریح است (هیچ عدد حدسی).
 *  ۵) مسیر تک‌محصولی برای شناسهٔ ناموجود صادقانه ۴۰۴ می‌دهد.
 */
import { describe, expect, it } from "vitest";
import { call, uniqueSuffix } from "./helpers";
import { rows } from "../server/database";

describe("قرارداد کاتالوگ عمومی", () => {
  it("بدون نشست فهرست محصولات منتشرشده را می‌دهد", async () => {
    const res = await call("catalog/products");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products.length).toBeGreaterThan(0);

    for (const product of res.body.products) {
      expect(typeof product.id).toBe("string");
      expect(typeof product.slug).toBe("string");
      expect(typeof product.name).toBe("string");
      expect(Array.isArray(product.variants)).toBe(true);
      expect(typeof product.available_total).toBe("number");
    }
  });

  it("هیچ قیمت عمده یا فیلد داخلی افشا نمی‌شود", async () => {
    const res = await call("catalog/products");
    const serialized = JSON.stringify(res.body);
    for (const forbidden of ["wholesale_price", "seller_id", "supplier_id", "created_by", "margin", "cost"]) {
      expect(serialized.includes(forbidden), `فیلد ممنوع در پاسخ عمومی: ${forbidden}`).toBe(false);
    }
  });

  it("قیمت خرده فقط از منبع رسمی می‌آید و در نبود آن صریحاً null است", async () => {
    const res = await call("catalog/products");
    for (const product of res.body.products) {
      expect(product.retail_price === null || typeof product.retail_price === "number").toBe(true);
      expect(["PENDING_RETAIL_PRICING", "RETAIL_PRICING"]).toContain(product.price_source);
      if (product.retail_price === null) expect(product.price_source).toBe("PENDING_RETAIL_PRICING");
    }
  });

  it("محصول منتشرنشده در فهرست عمومی دیده نمی‌شود", async () => {
    const id = `prod_hidden_${uniqueSuffix()}`;
    await rows("INSERT INTO product (id,name,slug,description,owner_type,is_kolbe_exclusive,status) VALUES ($1,$2,$3,$4,'KOLBE',true,'draft')", [
      id,
      "کالای پیش‌نویس آزمایشی",
      `draft-${id}`,
      "نباید در کاتالوگ عمومی دیده شود",
    ]);
    const res = await call("catalog/products");
    expect(res.body.products.some((product: any) => product.id === id)).toBe(false);
    await rows("DELETE FROM product WHERE id=$1", [id]);
  });

  it("مسیر تک‌محصولی برای شناسهٔ ناموجود ۴۰۴ می‌دهد", async () => {
    const res = await call(`catalog/products/${uniqueSuffix()}-does-not-exist`);
    expect(res.status).toBe(404);
  });
});
