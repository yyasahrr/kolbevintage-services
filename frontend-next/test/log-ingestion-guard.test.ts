import { describe, expect, it } from "vitest";
import { rows } from "../server/database";
import { call, createCustomer, uniqueSuffix } from "./helpers";

/**
 * رگرسیون D21 — نوشتنِ آزاد در لاگ سرور.
 *
 * ── چه چیزی خراب بود ────────────────────────────────────────────────────────
 * `POST logs/client` بدون هیچ احراز هویتی هر درخواست را به یک ردیف `system_log`
 * تبدیل می‌کرد (پروب ممیزی: HTTP 202 بدون توکن). یعنی یک primitive نوشتنِ آزاد
 * که پیام/نشانی/نام خطای آن کاملاً در کنترل مهاجم بود:
 *   • پر شدن بی‌سقف دیسک و مسموم‌سازی گزارش خطاها (پنهان شدن خطاهای واقعی)،
 *   • و چون کلید یکتایی روی `fingerprint` است، ارسال تصادفیِ پیام‌ها ردیف‌های
 *     بی‌شمار می‌ساخت.
 *
 * ── اصلاح ───────────────────────────────────────────────────────────────────
 * نشست الزامی + سهمیهٔ ساعتی برای هر کاربر + بریدن طول فیلدها.
 */

describe("POST logs/client — نگهبان لاگ کلاینت (D21)", () => {
  it("بدون نشست، نوشتن لاگ رد می‌شود (رگرسیون D21: قبلاً 202 بود)", async () => {
    const result = await call("logs/client", {
      method: "POST",
      body: { message: "پیام آزمون", type: "frontend.error" },
    });

    expect(result.status).toBe(401);
    expect(result.body.error).toBe("UNAUTHORIZED");
  });

  it("با نشست معتبر، لاگ پذیرفته و به کاربرِ وارد‌شده نسبت داده می‌شود", async () => {
    const customer = await createCustomer();
    const message = `خطای آزمون D21 ${uniqueSuffix()}`;

    const result = await call("logs/client", {
      method: "POST",
      body: { message, type: "frontend.error", name: "TypeError", url: "/checkout", stack: "at Checkout" },
      token: customer.token,
    });

    expect(result.status).toBe(202);
    expect(result.body.accepted).toBe(true);

    const stored = await rows<{ actor_id: string | null; actor_role: string | null; message: string }>(
      "SELECT actor_id, actor_role, message FROM system_log WHERE message=$1",
      [message],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].actor_id).toBe(customer.userId);
    expect(stored[0].actor_role).toBe("customer");
  });

  it("پیام‌های بی‌پایان بریده می‌شوند (سقف ۲۰۰۰ کاراکتر)", async () => {
    const customer = await createCustomer();
    const marker = `طویل-${uniqueSuffix()}`;
    const message = marker + "ا".repeat(5000);

    const result = await call("logs/client", {
      method: "POST",
      body: { message },
      token: customer.token,
    });
    expect(result.status).toBe(202);

    const stored = await rows<{ length: number }>(
      "SELECT length(message) AS length FROM system_log WHERE message LIKE $1",
      [`${marker}%`],
    );
    expect(stored[0].length).toBe(2000);
  });

  it("سقف ساعتی هر کاربر اعمال می‌شود (۴۲۹ پس از ۶۰ رخداد)", async () => {
    const customer = await createCustomer();

    // ۶۰ رخداد مجاز در پنجرهٔ یک‌ساعته؛ رخداد ۶۱ باید رد شود.
    for (let index = 0; index < 60; index += 1) {
      const accepted = await call("logs/client", {
        method: "POST",
        body: { message: `رخداد ${index} — ${uniqueSuffix()}` },
        token: customer.token,
      });
      expect(accepted.status).toBe(202);
    }

    const overflow = await call("logs/client", {
      method: "POST",
      body: { message: `رخداد ۶۱ — ${uniqueSuffix()}` },
      token: customer.token,
    });
    expect(overflow.status).toBe(429);
    expect(overflow.body.error).toBe("LOG_QUOTA_EXCEEDED");
  });

  it("سهمیهٔ یک کاربر روی کاربر دیگر اثر نمی‌گذارد", async () => {
    const first = await createCustomer();
    const second = await createCustomer();

    for (let index = 0; index < 60; index += 1) {
      await call("logs/client", {
        method: "POST",
        body: { message: `پرکردن سهمیه ${index}` },
        token: first.token,
      });
    }
    expect((await call("logs/client", { method: "POST", body: { message: "رد" }, token: first.token })).status).toBe(429);

    const other = await call("logs/client", {
      method: "POST",
      body: { message: `کاربر دوم ${uniqueSuffix()}` },
      token: second.token,
    });
    expect(other.status).toBe(202);
  });
});
