import { describe, expect, it } from "vitest";
import { products } from "../storefront/data/catalog";
import { rows } from "../server/database";
import {
  PROVIDER_BACKED_PAYMENT_METHODS,
  RETAIL_PAYMENT_METHODS,
  paymentSettlementStatus,
  requiresPaymentProvider,
  type RetailPaymentMethod,
} from "../server/retail-pricing";
import { call, uniqueSuffix } from "./helpers";

/**
 * رگرسیون D19a — ادعای وصول پول بدون وجود ارائه‌دهندهٔ پرداخت.
 *
 * ── چه چیزی خراب بود ────────────────────────────────────────────────────────
 * هر سفارش خرده‌فروشی غیرِ COD وضعیت `pending_gateway` («منتظر درگاه بانکی»)
 * می‌گرفت، در حالی که **هیچ ارائه‌دهندهٔ پرداختی وجود ندارد** (نه درگاه، نه
 * SnappPay/DigiPay، نه کیف پول — دامنهٔ `payments` فاز ۵ است). یعنی سامانه ادعای
 * وصول پول می‌کرد که هیچ‌وقت وصول نمی‌شد و هیچ ردی برای تطبیق مالی نمی‌گذاشت
 * (یافتهٔ BLOCKER ممیزی: D19).
 *
 * ── اصلاح ───────────────────────────────────────────────────────────────────
 * وضعیت، واقعیت را می‌گوید: `cod` → `pending_cod` («پرداخت هنگام تحویل»، روشی که
 * واقعاً کار می‌کند) و بقیه → `unpaid` («پرداخت‌نشده»)، همراه با فیلد صریح
 * `payment.collected=false` در پاسخ API.
 *
 * دربارهٔ اینکه چرا روش‌ها حذف نشدند: اگر فقط COD می‌ماند، قاعدهٔ موجود
 * «COD ⇒ هزینهٔ ارسال صفر» باعث می‌شد هیچ سفارشی هزینهٔ ارسال نپردازد (درآمد
 * ارسال صفر) و سفارش از استان‌های خارج از محدودهٔ COD ممکن نباشد. پس روش‌ها
 * می‌مانند اما ادعای وصول شدن یا نشدن، صادق است.
 */

describe("paymentSettlementStatus — نگاشت صادق وضعیت پرداخت (D19a)", () => {
  it("تنها COD وضعیت قابل‌اجرا می‌گیرد؛ بقیه «پرداخت‌نشده» هستند", () => {
    expect(paymentSettlementStatus("cod")).toBe("pending_cod");
    for (const method of ["gateway", "installment", "wallet"] as RetailPaymentMethod[]) {
      expect(paymentSettlementStatus(method)).toBe("unpaid");
    }
  });

  it("روش‌های نیازمند ارائه‌دهنده درست علامت‌گذاری می‌شوند", () => {
    expect(requiresPaymentProvider("cod")).toBe(false);
    for (const method of PROVIDER_BACKED_PAYMENT_METHODS) {
      expect(requiresPaymentProvider(method)).toBe(true);
    }
    // هیچ روشی نباید از فهرست مجاز جا بماند.
    for (const method of RETAIL_PAYMENT_METHODS) {
      expect(typeof requiresPaymentProvider(method)).toBe("boolean");
    }
  });
});

const product = products.find((item) => item.price < 3_000_000)!;

function payload(payMethod: string, idempotencyKey: string) {
  return {
    customer: { name: "مشتری آزمون", phone: "09121234567", email: "honesty@example.test" },
    lines: [
      {
        id: product.id,
        name: product.name,
        colour: product.colours[0].name,
        size: (product.sizes.find((size) => size.inStock) ?? product.sizes[0]).label,
        price: product.price,
        qty: 1,
      },
    ],
    address: { province: "تهران", city: "تهران", address: "خیابان آزمون", plaque: "۱", unit: "۲", postal: "1234567890", note: "" },
    shipping: { id: "pishtaz", label: "پست پیشتاز", price: 89_000 },
    payMethod,
    idempotencyKey,
  };
}

describe("POST retail/orders — وضعیت واقعی پرداخت (D19a)", () => {
  it("برای درگاه، سفارش «پرداخت‌نشده» ثبت می‌شود نه «منتظر درگاه»", async () => {
    const key = `honesty-gateway-${uniqueSuffix()}`;
    const result = await call("retail/orders", {
      method: "POST",
      body: payload("gateway", key),
      headers: { "idempotency-key": key },
    });

    expect(result.status).toBe(201);
    expect(result.body.payment).toEqual({
      method: "gateway",
      status: "unpaid",
      collected: false,
      requiresManualSettlement: true,
    });

    const stored = await rows<{ payment_status: string }>(
      "SELECT payment_status FROM retail_order WHERE idempotency_key=$1",
      [key],
    );
    expect(stored[0].payment_status).toBe("unpaid");
  });

  it("برای پرداخت در محل، وضعیت «در انتظار پرداخت هنگام تحویل» ثبت می‌شود", async () => {
    const key = `honesty-cod-${uniqueSuffix()}`;
    const result = await call("retail/orders", {
      method: "POST",
      body: payload("cod", key),
      headers: { "idempotency-key": key },
    });

    expect(result.status).toBe(201);
    expect(result.body.payment).toEqual({
      method: "cod",
      status: "pending_cod",
      collected: false,
      requiresManualSettlement: false,
    });
  });

  it("هیچ سفارش تازه‌ای ادعای وصول پول یا «منتظر درگاه» ندارد", async () => {
    const keys: string[] = [];
    for (const method of ["gateway", "installment", "cod", "wallet"]) {
      const key = `honesty-all-${method}-${uniqueSuffix()}`;
      keys.push(key);
      const result = await call("retail/orders", {
        method: "POST",
        body: payload(method, key),
        headers: { "idempotency-key": key },
      });
      expect(result.status).toBe(201);
      expect(result.body.payment.collected).toBe(false);
    }

    const stored = await rows<{ pay_method: string; payment_status: string }>(
      "SELECT pay_method, payment_status FROM retail_order WHERE idempotency_key = ANY($1)",
      [keys],
    );
    expect(stored).toHaveLength(4);
    for (const row of stored) {
      expect(row.payment_status).toBe(paymentSettlementStatus(row.pay_method as RetailPaymentMethod));
      // رگرسیون دقیق: مقدار قدیمی هرگز نباید برگردد.
      expect(row.payment_status).not.toBe("pending_gateway");
    }
  });

  it("پاسخ تکرارشده (idempotent) هم وضعیت ذخیره‌شده را برمی‌گرداند", async () => {
    const key = `honesty-replay-${uniqueSuffix()}`;
    const first = await call("retail/orders", {
      method: "POST",
      body: payload("gateway", key),
      headers: { "idempotency-key": key },
    });
    const replayed = await call("retail/orders", {
      method: "POST",
      body: payload("gateway", key),
      headers: { "idempotency-key": key },
    });

    expect(first.status).toBe(201);
    expect(replayed.status).toBe(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.payment).toEqual(first.body.payment);
    expect(replayed.body.payment.collected).toBe(false);
  });

  it("روش پرداخت نامعتبر خرده‌فروشی هنوز رد می‌شود", async () => {
    const key = `honesty-bad-${uniqueSuffix()}`;
    const result = await call("retail/orders", {
      method: "POST",
      body: payload("crypto", key),
      headers: { "idempotency-key": key },
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("PAYMENT_METHOD_NOT_ALLOWED");
  });
});
